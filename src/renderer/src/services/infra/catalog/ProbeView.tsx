import { useEffect, useMemo, useState } from 'react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { JsonPicker, type Path } from './JsonPicker'
import { extractNodes, parseResponse, pathToExpr } from './extract'
import { mergePromotion } from './presets'
import {
  STATUS_LABEL,
  type Discover,
  type NodeStatus,
  type NodeTypeDef,
  type ResponseFormat
} from './types'
import { useInfraStore } from '../store'

/**
 * 탐침 편집기 — **한 번 돌려보고 클릭으로 집는다.**
 *
 * 이 화면이 없으면 "지원 안 하는 클라우드를 사용자가 붙인다"는 요구가 통째로 죽는다.
 * JSON 을 손으로 쓰라고 하면 아무도 안 쓰기 때문이다. 그래서 순서를 뒤집었다 —
 * 명령을 먼저 돌려 **실제 응답**을 보여 주고, 거기서 집으면 표현식이 채워진다.
 * JSON 은 이 과정의 결과물이지 입력이 아니다.
 */

type Slot = 'list' | 'externalId' | 'name' | 'status' | 'parentExternalId' | 'designNodeRef'

const SLOTS: { key: Slot; label: string; hint: string }[] = [
  { key: 'list', label: '목록', hint: '반복되는 배열을 집으세요' },
  { key: 'externalId', label: 'id', hint: '항목의 고유 식별자 (필수)' },
  { key: 'name', label: '이름', hint: '화면에 뜰 이름' },
  { key: 'status', label: '상태', hint: '살아있음/멈춤을 나타내는 칸' },
  { key: 'parentExternalId', label: '부모', hint: '무엇 안에 담겨 있나' },
  { key: 'designNodeRef', label: '설계 매칭', hint: 'rockury:node 태그 자리' }
]

/** 인자 문자열을 배열로 — 따옴표로 묶은 덩어리는 한 칸으로 둔다(셸이 아니라 여기서 가른다). */
export function splitArgs(text: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

const statusTone: Record<NodeStatus, string> = {
  ok: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  stopped: 'bg-neutral-200 text-neutral-700',
  gone: 'bg-rose-100 text-rose-800',
  unknown: 'bg-sky-100 text-sky-800'
}

export function ProbeView(): React.JSX.Element {
  const store = useInfraStore()
  const providers = store.providers
  const [providerId, setProviderId] = useState<string>('')
  const [cmd, setCmd] = useState('docker')
  const [argText, setArgText] = useState('version --format "{{json .}}"')
  const [running, setRunning] = useState(false)
  const [raw, setRaw] = useState<unknown>(undefined)
  const [rawText, setRawText] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [exprs, setExprs] = useState<Partial<Record<Slot, string>>>({})
  const [listPath, setListPath] = useState<Path | null>(null)
  const [active, setActive] = useState<Slot>('list')
  const [expandAll, setExpandAll] = useState(false)
  const [format, setFormat] = useState<ResponseFormat>('json')
  // 저장 — 편집기의 결과물이 카탈로그의 노드 종류가 되는 지점.
  const [saveTo, setSaveTo] = useState('')
  const [typeId, setTypeId] = useState('')
  const [typeLabel, setTypeLabel] = useState('')
  const [newProviderId, setNewProviderId] = useState('')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // 노드 종류 목록에서 '승격'을 눌러 왔으면 그 프리셋의 모양을 이어받는다.
  const promoting = store.promoting
  useEffect(() => {
    if (!promoting) return
    setTypeId(promoting.id)
    setTypeLabel(promoting.label)
  }, [promoting])

  const run = async (): Promise<void> => {
    setRunning(true)
    setFailure(null)
    try {
      const r = await window.rockury.infra.runProbe({
        providerId: providerId || null,
        cmd,
        args: splitArgs(argText)
      })
      setRawText(r.stdout)
      if (!r.ok) {
        // 삼키지 않는다 — 종료 코드와 표준 오류를 그대로 보인다.
        setFailure(
          [
            r.timedOut ? '시간 초과로 중단했습니다.' : `종료 코드 ${r.exitCode ?? '(없음)'}`,
            r.error ?? '',
            r.stderr
          ]
            .filter(Boolean)
            .join('\n')
        )
      }
      const parsed = parseResponse(r.stdout, format)
      setRaw(parsed.data)
      // 실행은 성공했는데 못 읽은 경우에만 파싱 사유를 덮어쓴다(실행 실패 사유가 더 중요하다).
      if (r.ok && parsed.error) setFailure(parsed.error)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const pick = (path: Path, isArray: boolean): void => {
    if (active === 'list') {
      if (!isArray) {
        setFailure('목록 칸에는 배열을 집어야 합니다 — 반복되는 항목이 담긴 자리를 고르세요.')
        return
      }
      setFailure(null)
      setListPath(path)
      // 배열 자체를 집었으므로 뒤에 `[]` 를 붙여 전체를 순회하게 한다.
      setExprs((prev) => ({ ...prev, list: `${pathToExpr(path, { wildcardArrays: true })}[]` }))
      return
    }
    setExprs((prev) => ({ ...prev, [active]: relativeExpr(path, listPath) }))
  }

  const discover: Discover | null = useMemo(() => {
    if (!exprs.list || !exprs.externalId) return null
    return {
      call: { type: 'cli', cmd, args: splitArgs(argText) },
      format,
      list: exprs.list,
      map: {
        externalId: exprs.externalId,
        name: exprs.name,
        status: exprs.status,
        parentExternalId: exprs.parentExternalId,
        designNodeRef: exprs.designNodeRef
      }
    }
  }, [exprs, cmd, argText, format])

  const result = useMemo(() => (discover && raw !== undefined ? extractNodes(discover, raw) : null), [discover, raw])

  // 내 카탈로그만 저장 대상 — 내장은 못 고친다(복제해서 쓴다).
  const mine = store.catalogs.filter((c) => c.source === 'mine')

  const save = async (): Promise<void> => {
    setSaveMsg(null)
    if (!discover) {
      setSaveMsg('목록과 id 를 먼저 고르세요.')
      return
    }
    // 승격이면 프리셋의 모양(아이콘·색·담길 곳·문서 틀)을 그대로 이어받는다 —
    // 여기서 새로 만들면 이미 그려 둔 노드가 모양을 잃는다.
    const type: NodeTypeDef = promoting
      ? mergePromotion({ ...promoting, label: typeLabel.trim() || promoting.label }, discover)
      : {
          id: typeId.trim(),
          label: typeLabel.trim() || typeId.trim(),
          icon: 'phosphor:cube',
          discover
        }
    if (!type.id) {
      setSaveMsg('종류 id 를 입력하세요.')
      return
    }
    try {
      await store.saveNodeType({
        catalogId: saveTo || null,
        providerId: newProviderId.trim() || type.id.split('.')[0],
        providerLabel: newProviderId.trim() || type.id.split('.')[0],
        type
      })
      setSaveMsg(
        promoting
          ? `승격했습니다 — '${type.label}' 에 읽어 오는 법이 붙었습니다(종류 id 는 그대로라 그려 둔 노드는 남아 있습니다).`
          : `저장했습니다 — '${type.label}' 이 노드 종류 목록에 들어갔습니다.`
      )
      if (promoting) store.clearPromotion()
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4" data-infra-view="probe">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          공급자 연결(선택)
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          >
            <option value="">— 자격증명 없이 —</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          명령
          <Input className="w-40 font-mono" value={cmd} onChange={(e) => setCmd(e.target.value)} />
        </label>
        <label className="flex min-w-[280px] flex-1 flex-col gap-1 text-xs text-muted">
          인자
          <Input
            className="font-mono"
            value={argText}
            onChange={(e) => setArgText(e.target.value)}
            placeholder="ec2 describe-instances --output json"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          응답 형식
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={format}
            onChange={(e) => setFormat(e.target.value as ResponseFormat)}
            data-probe-format
          >
            <option value="json">통짜 JSON</option>
            <option value="ndjson">줄마다 JSON (도커)</option>
          </select>
        </label>
        <Button onClick={run} disabled={running || !cmd.trim()} data-probe-run>
          {running ? '실행 중…' : '한 번 돌려보기'}
        </Button>
      </div>

      {failure && (
        <pre
          className="max-h-32 shrink-0 overflow-auto rounded-md border border-destructive/40 bg-destructive/5 p-2 font-mono text-[11px] whitespace-pre-wrap text-destructive"
          data-probe-error
        >
          {failure}
        </pre>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <section className="flex min-w-0 flex-1 flex-col rounded-md border border-border">
          <header className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs font-medium">
            <span>응답 — 집을 자리를 클릭하세요</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px]"
              onClick={() => setExpandAll(!expandAll)}
              data-probe-expand-all
            >
              {expandAll ? '접기' : '전부 펼치기'}
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">
            {raw === undefined && rawText ? (
              <pre className="p-2 font-mono text-[11px] whitespace-pre-wrap">{rawText.slice(0, 4000)}</pre>
            ) : (
              <JsonPicker
                data={raw}
                onPick={pick}
                activeExpr={exprs[active] ?? null}
                expandAll={expandAll}
              />
            )}
          </div>
        </section>

        <section className="flex w-[340px] shrink-0 flex-col gap-2 rounded-md border border-border p-3">
          <h3 className="text-xs font-medium">무엇을 어디서 읽나</h3>
          {SLOTS.map((s) => (
            <button
              key={s.key}
              type="button"
              data-probe-slot={s.key}
              onClick={() => setActive(s.key)}
              className={cn(
                'cursor-pointer rounded-md border px-2 py-1.5 text-left',
                active === s.key ? 'border-primary bg-primary/5' : 'border-border'
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium">{s.label}</span>
                <span className="text-[10px] text-muted">{s.hint}</span>
              </div>
              <div className="truncate font-mono text-[11px] text-muted">
                {exprs[s.key] || '— 클릭해서 고르세요 —'}
              </div>
            </button>
          ))}
          <Input
            className="font-mono text-[11px]"
            placeholder="표현식 직접 고치기"
            value={exprs[active] ?? ''}
            onChange={(e) => setExprs((prev) => ({ ...prev, [active]: e.target.value }))}
            data-probe-expr
          />

          {/* 저장 — 여기서 편집기의 결과물이 실제 노드 종류가 된다.
              이게 없으면 편집기는 메모장이고, "지원 안 하는 클라우드를 붙인다"가 끝나지 않는다. */}
          <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
            <h3 className="text-xs font-medium">{promoting ? '프리셋 승격' : '노드 종류로 저장'}</h3>
            {promoting && (
              <p className="rounded bg-sky-50 p-1.5 text-[11px] text-sky-900" data-probe-promoting={promoting.id}>
                &lsquo;{promoting.label}&rsquo; 에 읽어 오는 법을 붙입니다. <strong>종류 id 는 그대로</strong>
                이므로 이미 그려 둔 노드는 남습니다.
              </p>
            )}
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              어느 카탈로그에
              <select
                className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"
                value={saveTo}
                onChange={(e) => setSaveTo(e.target.value)}
                data-probe-save-catalog
              >
                <option value="">— 새 카탈로그 만들기 —</option>
                {mine.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.catalog.provider.label}
                  </option>
                ))}
              </select>
            </label>
            {!saveTo && (
              <Input
                className="h-8 font-mono text-[11px]"
                placeholder="새 공급자 id (예: ktcloud)"
                value={newProviderId}
                onChange={(e) => setNewProviderId(e.target.value)}
                data-probe-provider-id
              />
            )}
            <Input
              className="h-8 font-mono text-[11px]"
              placeholder="종류 id (예: ktcloud.server)"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              disabled={Boolean(promoting)}
              data-probe-type-id
            />
            <Input
              className="h-8 text-[11px]"
              placeholder="표시 이름 (예: 가상서버)"
              value={typeLabel}
              onChange={(e) => setTypeLabel(e.target.value)}
              data-probe-type-label
            />
            <Button size="sm" onClick={() => void save()} disabled={!discover} data-probe-save>
              저장
            </Button>
            {saveMsg && (
              <p className="text-[11px] whitespace-pre-wrap text-muted" data-probe-save-msg>
                {saveMsg}
              </p>
            )}
          </div>
        </section>

        <section className="flex w-[280px] shrink-0 flex-col rounded-md border border-border">
          <header className="border-b border-border px-3 py-2 text-xs font-medium">미리보기</header>
          <div className="min-h-0 flex-1 overflow-auto p-2" data-probe-preview>
            {!result && <p className="text-xs text-muted">목록과 id 를 고르면 여기 뜹니다.</p>}
            {result?.error && <p className="text-xs text-destructive">{result.error}</p>}
            {result && !result.error && (
              <>
                <p className="mb-2 text-xs" data-probe-count>
                  노드 {result.nodes.length}개
                  {result.dropped.length > 0 && (
                    <span className="text-amber-700"> · 버린 항목 {result.dropped.length}개</span>
                  )}
                </p>
                {result.unknownStatuses.length > 0 && (
                  <p className="mb-2 rounded bg-sky-50 p-1.5 text-[11px] text-sky-900" data-probe-unknown>
                    사전에 없는 상태값: {result.unknownStatuses.join(', ')} — 그대로 두면 &lsquo;모름&rsquo;으로 뜹니다.
                  </p>
                )}
                <ul className="flex flex-col gap-1">
                  {result.nodes.slice(0, 30).map((n) => (
                    <li key={n.externalId} className="flex items-center gap-1.5 text-[11px]">
                      <span className={cn('rounded px-1 py-0.5 text-[10px]', statusTone[n.status])}>
                        {STATUS_LABEL[n.status]}
                      </span>
                      <span className="truncate font-mono">{n.name || n.externalId}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

/**
 * 목록 아래 항목의 경로는 **항목 기준 상대 경로**여야 한다.
 * 사용자가 트리에서 집은 것은 응답 루트 기준이므로 목록 앞부분을 떼어 낸다.
 *
 * 경로(배열)로 비교하는 이유: 문자열로 자르면 `Reservations[0]` 과 `Reservations[]` 의
 * 인덱스 표기가 달라 접두어 판정이 어긋난다. 인덱스 자리는 값이 무엇이든 같은 자리로 본다.
 */
export function relativeExpr(picked: Path, listPath: Path | null): string {
  if (!listPath || picked.length <= listPath.length) return pathToExpr(picked)
  for (let i = 0; i < listPath.length; i++) {
    const a = listPath[i]
    const b = picked[i]
    if (typeof a === 'number' && typeof b === 'number') continue
    if (a !== b) return pathToExpr(picked) // 목록 밖을 집었다 — 조용히 왜곡하지 않는다
  }
  const rest = picked.slice(listPath.length)
  // 목록 바로 아래 항목 인덱스는 떼어 낸다(`[0].InstanceId` → `InstanceId`).
  if (typeof rest[0] === 'number') rest.shift()
  return rest.length ? pathToExpr(rest) : pathToExpr(picked)
}
