import { useMemo, useState } from 'react'
import { AlertTriangle, Plus, Route, Search, Trash2, Upload } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import {
  PARAM_TYPES,
  interfaceMeta,
  type ParamDef,
  type ParamType,
  type RequestDef,
  type RequestField
} from '@shared/api/types'
import { useApiStore, useSpecSync } from '../store'

/** 칸 하나의 사람 말 이름 — 인터페이스마다 나오는 칸이 다르다(spec shape AC-7). */
const FIELD_LABEL: Record<RequestField, string> = {
  method: '메서드',
  path: '경로',
  query: '쿼리',
  headers: '헤더',
  body: '본문',
  graphqlQuery: '질의문',
  graphqlVariables: '변수',
  grpcMethod: 'gRPC 메서드',
  rpcMethod: 'RPC 메서드',
  rpcParams: 'RPC 인자',
  connectUrl: '접속 주소',
  expectedBody: '기대 본문'
}

/** 여러 줄로 받아야 자연스러운 칸. */
const MULTILINE: RequestField[] = ['body', 'graphqlQuery', 'graphqlVariables', 'rpcParams', 'expectedBody']

/** 트리 검색 — 이름·경로 부분일치(대소문자 무시). 빈 질의는 전체를 원래 순서로. */
function filterRequests(requests: RequestDef[], q: string): RequestDef[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return requests
  return requests.filter(
    (r) =>
      r.name.toLowerCase().includes(needle) ||
      (r.request.path ?? '').toLowerCase().includes(needle) ||
      (r.request.connectUrl ?? '').toLowerCase().includes(needle)
  )
}

function RequestRow({
  req,
  active,
  onSelect
}: {
  req: RequestDef
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-api-request-row={req.name}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left transition-colors last:border-b-0',
        active ? 'bg-accent-soft' : 'hover:bg-panel'
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{req.name}</span>
      <span className="shrink-0 truncate font-mono text-[10.5px] text-muted">
        {req.request.method ?? req.request.rpcMethod ?? req.request.grpcMethod ?? ''}
      </span>
      {/* 판정 기록이 아직 없다 — 일치가 아니라 '미관측'이다(spec §4-①). */}
      <span
        data-api-request-state="unobserved"
        title="아직 실제로 쏴 본 적이 없습니다 — 일치 여부를 모릅니다."
        className="shrink-0 rounded-full bg-panel px-1.5 py-0.5 text-[10px] font-medium text-muted"
      >
        미관측
      </span>
    </button>
  )
}

/**
 * 이름 칸은 **다 치고 나서** 저장한다(blur·Enter).
 * 글자마다 저장하면 이름을 지우는 중간 상태(빈 이름)가 스토어 검증에 걸려 "이름이 비었다"
 * 오류가 타이핑 중에 번쩍인다 — 규칙을 화면으로 옮기는 대신 커밋 시점을 옮긴다.
 */
function NameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const shown = editing ? draft : value

  return (
    <Input
      value={shown}
      placeholder="이름"
      data-api-param-name
      className="h-7 flex-1 font-mono text-[12px]"
      onFocus={() => {
        setDraft(value)
        setEditing(true)
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false)
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          setEditing(false)
        }
      }}
    />
  )
}

function ParamEditor({
  params,
  onChange
}: {
  params: ParamDef[]
  onChange: (next: ParamDef[]) => void
}) {
  /** 새 파라미터는 이름을 갖고 태어난다 — 빈 이름은 정의 오류라 저장 자체가 안 된다. */
  const addParam = (): void => {
    const taken = new Set(params.map((p) => p.name))
    let name = 'param'
    for (let n = 2; taken.has(name); n++) name = `param${n}`
    onChange([...params, { name, type: 'string', required: false }])
  }

  return (
    <div className="flex flex-col gap-1.5">
      {params.length === 0 && (
        <p className="rounded-md bg-panel px-2.5 py-2 text-[11.5px] text-muted">
          아직 파라미터가 없어요. 호출할 때마다 달라지는 값을 여기 둡니다 — 서버 주소나 키처럼
          환경마다 다른 값은 아래가 아니라 <b>환경</b>에 둡니다.
        </p>
      )}
      {params.map((p, i) => (
        <div key={p.name} data-api-param-row={p.name} className="flex items-center gap-1.5">
          <NameInput
            value={p.name}
            onCommit={(name) => onChange(params.map((x, j) => (j === i ? { ...x, name } : x)))}
          />
          <select
            value={p.type}
            data-api-param-type
            className="h-7 rounded-md border border-line bg-canvas px-1.5 text-[12px] text-fg"
            onChange={(e) =>
              onChange(params.map((x, j) => (j === i ? { ...x, type: e.target.value as ParamType } : x)))
            }
          >
            {PARAM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label className="flex shrink-0 items-center gap-1 text-[11.5px] text-muted">
            <input
              type="checkbox"
              checked={p.required}
              data-api-param-required
              onChange={(e) =>
                onChange(params.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))
              }
            />
            필수
          </label>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            title="파라미터 삭제"
            onClick={() => onChange(params.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 self-start text-[12px]"
        data-api-add-param
        onClick={addParam}
      >
        <Plus className="size-3.5" /> 파라미터
      </Button>
    </div>
  )
}

function RequestDetail({ req }: { req: RequestDef }) {
  const active = useApiStore((s) => s.active)!
  const saveRequests = useApiStore((s) => s.saveRequests)
  const meta = interfaceMeta(active.kind)

  const patch = (next: Partial<RequestDef>): void => {
    void saveRequests(active.requests.map((r) => (r.name === req.name ? { ...r, ...next } : r)))
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Route className="size-4 text-muted" />
        <span className="text-[14px] font-semibold text-fg" data-api-detail-name>
          {req.name}
        </span>
        <span className="rounded-full bg-panel px-2 py-0.5 text-[10.5px] font-medium text-muted">
          {meta.label}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[12px]"
          data-api-remove-request
          onClick={() => void saveRequests(active.requests.filter((r) => r.name !== req.name))}
        >
          <Trash2 className="size-3.5" /> 요청 삭제
        </Button>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        {/*
          두 바구니를 화면에서 갈라 놓는다(spec §2) — Postman 이 "변수" 하나로 뭉쳐서
          컬렉션이 커지면 무엇이 무엇인지 모르게 되는 지점이다.
        */}
        <section className="flex flex-col gap-2" data-api-section="signature">
          <h3 className="text-[12px] font-semibold text-fg">
            호출 파라미터{' '}
            <span className="font-normal text-muted">— 호출할 때마다 달라지는 값</span>
          </h3>
          <ParamEditor params={req.params} onChange={(params) => patch({ params })} />
        </section>

        <section className="flex flex-col gap-2" data-api-section="fields">
          <h3 className="text-[12px] font-semibold text-fg">
            요청 내용{' '}
            <span className="font-normal text-muted">
              — {meta.label} 이(가) 쓰는 칸만 보입니다
            </span>
          </h3>
          {meta.fields.map((f) => {
            const value = (req.request as Record<string, unknown>)[f]
            const text = typeof value === 'string' ? value : value ? JSON.stringify(value) : ''
            return (
              <label key={f} className="flex flex-col gap-1 text-[11.5px] text-muted" data-api-field={f}>
                {FIELD_LABEL[f]}
                {MULTILINE.includes(f) ? (
                  <textarea
                    value={text}
                    rows={4}
                    className="rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-[12px] text-fg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onChange={(e) => patch({ request: { ...req.request, [f]: e.target.value } })}
                  />
                ) : (
                  <Input
                    value={text}
                    className="h-7 font-mono text-[12px]"
                    onChange={(e) => patch({ request: { ...req.request, [f]: e.target.value } })}
                  />
                )}
              </label>
            )
          })}
        </section>

        <section className="flex flex-col gap-2" data-api-section="docs">
          <h3 className="text-[12px] font-semibold text-fg">
            문서 <span className="font-normal text-muted">— 정의에서 나올 수 없는 것만</span>
          </h3>
          <textarea
            value={req.docs}
            rows={5}
            data-api-docs
            placeholder="이 API 가 왜 있는지 · 언제 쓰면 안 되는지 · 알려진 함정"
            className="rounded-md border border-line bg-canvas px-2 py-1.5 text-[12px] text-fg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(e) => patch({ docs: e.target.value })}
          />
        </section>
      </div>
    </div>
  )
}

/** Studio › Requests — 명세의 요청을 짓는 화면. */
export function RequestsWorkspace() {
  useSpecSync()
  const active = useApiStore((s) => s.active)
  const selected = useApiStore((s) => s.selectedRequest)
  const selectRequest = useApiStore((s) => s.selectRequest)
  const saveRequests = useApiStore((s) => s.saveRequests)
  const error = useApiStore((s) => s.error)
  const clearError = useApiStore((s) => s.clearError)
  const openCreate = useApiStore((s) => s.openCreate)
  const openTransfer = useApiStore((s) => s.openTransfer)
  const [q, setQ] = useState('')

  const shown = useMemo(() => filterRequests(active?.requests ?? [], q), [active?.requests, q])
  const current = active?.requests.find((r) => r.name === selected) ?? null

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" data-api-empty="no-spec">
        <PlaceholderView
          icon={Route}
          depth="depth 3 · API › Studio › Requests"
          title="명세를 먼저 고르세요"
          subtitle="상단 컨텍스트 바에서 명세를 고르거나 새로 만들면 요청을 지을 수 있어요."
        />
        <span className="flex items-center gap-2">
          <Button onClick={openCreate} data-api-create-spec>
            <Plus className="size-4" /> 새 API 명세
          </Button>
          <Button variant="secondary" onClick={openTransfer} data-api-open-transfer>
            <Upload className="size-4" /> 기존 문서 가져오기
          </Button>
        </span>
      </div>
    )
  }

  const addRequest = (): void => {
    const taken = new Set(active.requests.map((r) => r.name))
    let name = 'newRequest'
    for (let n = 2; taken.has(name); n++) name = `newRequest${n}`
    const shape = interfaceMeta(active.kind).shapes[0]
    void saveRequests([
      ...active.requests,
      { id: `r_${Date.now().toString(36)}`, name, folder: '', shape, params: [], request: {}, responses: [], docs: '' }
    ]).then((okDone) => okDone && selectRequest(name))
  }

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div
          data-api-error
          className="flex items-start gap-2 border-b border-line bg-danger-soft px-4 py-2 text-[12px] text-danger"
        >
          <AlertTriangle className="mt-[2px] size-3.5 shrink-0" />
          <span className="flex-1 whitespace-pre-wrap">{error}</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={clearError}>
            닫기
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <WorkspacePanels
          autoSaveId="api-studio-requests"
          sidebarTitle="요청"
          sidebarActions={
            <span className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title="가져오기 · 내보내기 — OpenAPI·proto·GraphQL"
                data-api-open-transfer
                onClick={openTransfer}
              >
                <Upload className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-6" title="요청 추가" data-api-add-request onClick={addRequest}>
                <Plus className="size-3.5" />
              </Button>
            </span>
          }
          sidebar={
            <div className="flex flex-col">
              <div className="relative border-b border-line p-2">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="이름·경로 검색"
                  data-api-search
                  className="h-7 pl-7 text-[12px]"
                />
              </div>
              {shown.length === 0 ? (
                <p className="px-3 py-4 text-[12px] text-muted" data-api-empty="no-request">
                  {active.requests.length === 0
                    ? '아직 요청이 없어요. 위 + 로 하나 만들어 보세요.'
                    : '검색에 걸리는 요청이 없어요.'}
                </p>
              ) : (
                shown.map((r) => (
                  <RequestRow
                    key={r.name}
                    req={r}
                    active={r.name === selected}
                    onSelect={() => selectRequest(r.name)}
                  />
                ))
              )}
            </div>
          }
        >
          {current ? (
            <RequestDetail req={current} />
          ) : (
            <PlaceholderView
              icon={Route}
              depth="depth 3 · API › Studio › Requests"
              title="요청을 고르세요"
              subtitle="왼쪽 목록에서 요청을 고르면 파라미터·요청 내용·문서를 볼 수 있어요."
            />
          )}
        </WorkspacePanels>
      </div>
    </div>
  )
}
