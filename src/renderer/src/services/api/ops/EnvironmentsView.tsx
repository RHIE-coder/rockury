import { useState } from 'react'
import { AlertTriangle, Copy, Eye, EyeOff, Plus, Server, Trash2 } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { useNav } from '@renderer/nav/useNav'
import { envHealth } from '@shared/api/envHealth'
import type { EnvValue, EnvironmentDef, RequestDef } from '@shared/api/types'
import { useOpsStore, useOpsSync } from './store'
import { useApiStore } from '../store'

/**
 * Environments — `docs/spec/api-runner.md` § environments.
 *
 * 여기 있는 값은 **환경 값**이다: 환경마다 다르고 호출마다 같다(base URL·키).
 * 호출마다 달라지는 값은 여기가 아니라 요청의 **호출 파라미터** 쪽이다 — 이 갈래가
 * 흐려지면 컬렉션이 커졌을 때 무엇이 무엇인지 모르게 된다(spec §2).
 */

/** 운영 표식 환경이 골라져 있으면 화면 어디서든 보이는 띠. */
export function OpsGuardBand() {
  const env = useOpsStore((s) => s.environments)
  const id = useNav((s) => s.contextValues['env'])
  const active = env.find((e) => e.id === id)
  if (!active?.production) return null
  return (
    <div
      data-api-prod-band
      className="flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-4 py-1.5 text-[12px] font-medium text-danger"
    >
      <AlertTriangle className="size-3.5 shrink-0" />
      운영 환경 <b>{active.name}</b> 이(가) 골라져 있습니다 — 보내는 요청이 실제 서비스에 갑니다.
    </div>
  )
}

function ValueRow({
  v,
  health,
  onChange,
  onRemove
}: {
  v: EnvValue
  /** 고아·구멍 판정 결과. 정상이면 null — 정상인 것을 나열하면 목록이 시끄러워 아무도 안 읽는다. */
  health: 'orphan' | 'hole' | null
  onChange: (next: EnvValue) => void
  onRemove: () => void
}) {
  const [reveal, setReveal] = useState(false)
  return (
    <div className="flex items-center gap-1.5" data-api-env-value={v.name}>
      {health && (
        <span
          data-api-env-health={health}
          title={
            health === 'orphan'
              ? '어느 요청도 이 값을 참조하지 않습니다 — 지워도 되는지 확인해 보세요.'
              : '요청이 참조하는데 값이 비었습니다 — 이대로면 실행이 막힙니다.'
          }
          className={cn(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
            health === 'orphan' ? 'bg-panel text-muted' : 'bg-danger-soft text-danger'
          )}
        >
          {health === 'orphan' ? '고아' : '구멍'}
        </span>
      )}
      <Input
        value={v.name}
        placeholder="이름"
        className="h-7 w-40 font-mono text-[12px]"
        onChange={(e) => onChange({ ...v, name: e.target.value })}
      />
      <Input
        value={v.value}
        type={v.secret && !reveal ? 'password' : 'text'}
        placeholder={v.secret ? '••••' : '값'}
        data-api-env-input
        className="h-7 flex-1 font-mono text-[12px]"
        onChange={(e) => onChange({ ...v, value: e.target.value })}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        title={v.secret ? '비밀 표식 끄기' : '비밀로 표시 — 화면·기록·내보내기에서 가려집니다'}
        data-api-env-secret
        onClick={() => onChange({ ...v, secret: !v.secret })}
      >
        {v.secret ? <EyeOff className="size-3.5 text-danger" /> : <Eye className="size-3.5" />}
      </Button>
      {v.secret && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          title="잠깐 보기"
          onClick={() => setReveal((r) => !r)}
        >
          <Eye className={cn('size-3.5', reveal && 'text-accent')} />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="size-7 shrink-0" title="값 삭제" onClick={onRemove}>
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

function EnvironmentCard({ env, requests }: { env: EnvironmentDef; requests: RequestDef[] }) {
  const save = useOpsStore((s) => s.saveEnvironment)
  const duplicate = useOpsStore((s) => s.duplicateEnvironment)
  const remove = useOpsStore((s) => s.deleteEnvironment)
  const activeId = useNav((s) => s.contextValues['env'])
  const setContextValue = useNav((s) => s.setContextValue)
  const [draft, setDraft] = useState(env)
  const dirty = JSON.stringify(draft) !== JSON.stringify(env)

  // 고아·구멍은 **저장된 값이 아니라 지금 편집 중인 값** 기준으로 본다 — 값을 지우자마자
  // 구멍이 뜨는 게 저장 뒤에 뜨는 것보다 낫다(spec values AC-4).
  const health = envHealth(requests, draft.values)
  const healthOf = (name: string): 'orphan' | 'hole' | null =>
    health.orphans.includes(name) ? 'orphan' : health.holes.includes(name) ? 'hole' : null

  const usedNames = new Set(draft.values.map((v) => v.name))
  const addValue = (): void => {
    let name = 'value'
    for (let n = 2; usedNames.has(name); n++) name = `value${n}`
    setDraft({ ...draft, values: [...draft.values, { name, value: '', secret: false }] })
  }

  return (
    <section
      data-api-env-card={env.name}
      className={cn(
        'flex flex-col gap-2.5 rounded-lg border p-3',
        activeId === env.id ? 'border-accent bg-accent-soft/40' : 'border-line'
      )}
    >
      <header className="flex items-center gap-2">
        <Input
          value={draft.name}
          className="h-7 w-44 text-[13px] font-semibold"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <Input
          value={draft.baseUrl}
          placeholder="https://dev.example.com"
          className="h-7 flex-1 font-mono text-[12px]"
          onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
        />
        <label className="flex shrink-0 items-center gap-1 text-[11.5px] text-muted" title="켜면 상시 경고 띠 + 실행 확인 게이트">
          <input
            type="checkbox"
            checked={draft.production}
            data-api-env-production
            // 잘못 눌리면 실서비스로 요청이 나가는 스위치다 — 기본 13×13 은 너무 작다.
            className="size-4"
            onChange={(e) => setDraft({ ...draft, production: e.target.checked })}
          />
          운영
        </label>
      </header>

      <div className="flex flex-col gap-1.5">
        {draft.values.map((v, i) => (
          <ValueRow
            key={i}
            v={v}
            health={healthOf(v.name)}
            onChange={(next) => setDraft({ ...draft, values: draft.values.map((x, j) => (j === i ? next : x)) })}
            onRemove={() => setDraft({ ...draft, values: draft.values.filter((_, j) => j !== i) })}
          />
        ))}
        <Button variant="ghost" size="sm" className="h-7 self-start text-[12px]" data-api-add-env-value onClick={addValue}>
          <Plus className="size-3.5" /> 환경 값
        </Button>
        {(health.orphans.length > 0 || health.holes.length > 0) && (
          <p className="text-[11px] text-muted" data-api-env-health-summary>
            {health.holes.length > 0 && (
              <span className="text-danger">
                구멍 {health.holes.length}개 — 요청이 쓰는데 값이 비었습니다.{' '}
              </span>
            )}
            {health.orphans.length > 0 && <>고아 {health.orphans.length}개 — 어느 요청도 안 씁니다.</>}
          </p>
        )}
      </div>

      <footer className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 text-[12px]"
          disabled={!dirty}
          data-api-env-save
          onClick={() => void save({ ...draft, id: env.id })}
        >
          저장
        </Button>
        {dirty && (
          <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => setDraft(env)}>
            되돌리기
          </Button>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[12px]"
          title="구조만 복사합니다 — 값·주소는 따라오지 않아요"
          data-api-env-duplicate
          onClick={() => void duplicate(env.id, `${env.name} 복사본`)}
        >
          <Copy className="size-3.5" /> 복제
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[12px]"
          data-api-env-delete
          onClick={() => void remove(env.id)}
        >
          <Trash2 className="size-3.5" /> 삭제
        </Button>
        <Button
          variant={activeId === env.id ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-[12px]"
          data-api-env-select
          onClick={() => setContextValue('env', env.id)}
        >
          {activeId === env.id ? '고른 환경' : '이 환경 고르기'}
        </Button>
      </footer>
    </section>
  )
}

export function EnvironmentsView() {
  useOpsSync()
  const spec = useApiStore((s) => s.active)
  const envs = useOpsStore((s) => s.environments)
  const save = useOpsStore((s) => s.saveEnvironment)
  const error = useOpsStore((s) => s.error)
  const clearError = useOpsStore((s) => s.clearError)

  if (!spec) {
    return (
      <PlaceholderView
        icon={Server}
        title="명세를 먼저 고르세요"
        subtitle="환경은 명세에 속합니다 — 상단 컨텍스트 바에서 명세를 고르세요."
      />
    )
  }

  const addEnvironment = (): void => {
    const taken = new Set(envs.map((e) => e.name))
    let name = 'DEV'
    for (const candidate of ['DEV', 'STG', 'PROD']) if (!taken.has(candidate)) { name = candidate; break }
    while (taken.has(name)) name = `${name}2`
    void save({ specId: spec.id, name, baseUrl: '', production: false, values: [] })
  }

  return (
    <div className="flex h-full flex-col">
      <OpsGuardBand />
      {error && (
        <div data-api-error className="flex items-start gap-2 border-b border-line bg-danger-soft px-4 py-2 text-[12px] text-danger">
          <AlertTriangle className="mt-[2px] size-3.5 shrink-0" />
          <span className="flex-1 whitespace-pre-wrap">{error}</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={clearError}>
            닫기
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Server className="size-4 text-muted" />
        <span className="text-[14px] font-semibold text-fg">환경</span>
        <span className="text-[11.5px] text-muted">— 환경마다 다르고 호출마다 같은 값</span>
        <span className="flex-1" />
        <Button size="sm" className="h-7 text-[12px]" data-api-add-env onClick={addEnvironment}>
          <Plus className="size-3.5" /> 환경 추가
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        {envs.length === 0 ? (
          <p className="text-[12px] text-muted" data-api-empty="no-env">
            아직 환경이 없어요. DEV·STG·PROD 처럼 보낼 곳을 만들면 요청을 쏠 수 있습니다.
          </p>
        ) : (
          envs.map((e) => <EnvironmentCard key={e.id} env={e} requests={spec.requests} />)
        )}
      </div>
    </div>
  )
}
