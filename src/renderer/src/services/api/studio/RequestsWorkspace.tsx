import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Folder,
  Plus,
  Route,
  Search,
  Trash2,
  Upload,
  Pencil
} from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import {
  FIELD_TYPES,
  PARAM_TYPES,
  interfaceMeta,
  type FieldDef,
  type ParamDef,
  type ParamType,
  type RequestDef,
  type RequestField,
  type ResponseDef
} from '@shared/api/types'
import {
  buildRequestTree,
  canMoveFolder,
  canRenameFolder,
  folderPaths,
  moveFolder,
  moveRequest,
  normalizeFolder,
  renameFolder,
  type TreeNode
} from '@shared/api/tree'
import { renderTemplate } from '@shared/api/template'
import { buildScope } from '@shared/api/resolve'
import { rendererFunctionEnv, useActiveEnvironment } from '../ops/store'
import { useApiStore, useSpecSync } from '../store'
import { useOpsStore, useOpsSync } from '../ops/store'

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

/** 폴더 행 앞에만 붙는 글리프 폭(chevron + folder 아이콘 + 간격). 요청 행을 이만큼 민다. */
const GLYPH_LEAD = 38

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
  depth,
  observed,
  onSelect,
  onDragStart
}: {
  req: RequestDef
  active: boolean
  depth: number
  /** 이 요청으로 실제로 쏴 본(또는 받은) 기록이 있나. */
  observed: boolean
  onSelect: () => void
  onDragStart: () => void
}) {
  return (
    <button
      type="button"
      data-api-request-row={req.name}
      draggable
      onDragStart={onDragStart}
      onClick={onSelect}
      /*
        폴더 행에는 chevron(12) + gap(6) + folder 아이콘(14) + gap(6) ≈ 38px 이 앞에 붙는다.
        같은 공식을 쓰면 **자식 요청이 부모 폴더 라벨보다 왼쪽에 놓여** 트리가 뒤집혀 보인다.
        그만큼 밀어 준다.
      */
      style={{ paddingLeft: 12 + depth * 16 + GLYPH_LEAD }}
      className={cn(
        'flex w-full items-center gap-2 border-b border-line py-2 pr-3 text-left transition-colors last:border-b-0',
        active ? 'bg-accent-soft' : 'hover:bg-panel'
      )}
    >
      <span title={req.name} className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
        {req.name}
      </span>
      <span className="shrink-0 truncate font-mono text-[10.5px] text-muted">
        {req.request.method ?? req.request.rpcMethod ?? req.request.grpcMethod ?? ''}
      </span>
      {/*
        **안 쏴 본 것만 '미관측'이다.** 이 배지를 하드코딩해 두면, 쏴 본 뒤에도 계속
        "모른다"고 말해 Drift 화면(`1/1 관측`)과 어긋난다 — 서비스의 한 문장이 뒤집힌 자리다
        (모르는 것을 안다고 하는 게 아니라 **아는 것을 모른다고** 말한다).
        쏴 본 것을 '일치'라고는 하지 않는다 — 그건 판정이 할 말이다(spec §4-①).
      */}
      {observed ? (
        <span
          data-api-request-state="observed"
          title="실제로 쏴 본 기록이 있습니다. 일치 여부는 Contract › Drift 가 말합니다."
          className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
        >
          관측됨
        </span>
      ) : (
        <span
          data-api-request-state="unobserved"
          title="아직 실제로 쏴 본 적이 없습니다 — 일치 여부를 모릅니다."
          className="shrink-0 rounded-full bg-panel px-1.5 py-0.5 text-[10px] font-medium text-muted"
        >
          미관측
        </span>
      )}
    </button>
  )
}

/**
 * 폴더 이름 칸. 요청 이름 칸과 **같은 규율** — 글자마다 저장하지 않고 다 치고 나서 커밋한다
 * (중간 상태인 빈 이름이 매번 "이름이 비었다" 오류를 번쩍이게 한다).
 */
function FolderNameInput({
  initial,
  onCommit,
  onCancel
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  return (
    <Input
      autoFocus
      value={text}
      data-api-folder-name
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(text)
        if (e.key === 'Escape') onCancel()
      }}
      className="h-6 flex-1 text-[12px]"
    />
  )
}

/**
 * 폴더 트리 (spec requests.tree).
 *
 * 끌어 옮기기는 **요청도 폴더도** 된다. 자기 자손으로 넣는 실수와 이름이 겹쳐 합쳐지는 것은
 * `canMoveFolder` 한 곳이 막고, 막힌 이유는 트리 위에 글자로 뜬다 — 조용히 안 옮겨지면
 * "왜 안 되지"가 된다.
 */
function TreeView({
  nodes,
  depth,
  selected,
  collapsed,
  observedNames,
  renaming,
  onToggleFolder,
  onSelect,
  onDragStart,
  onDragFolder,
  onDropInto,
  onStartRename,
  onCommitRename
}: {
  nodes: TreeNode[]
  depth: number
  selected: string | null
  collapsed: Set<string>
  observedNames: Set<string>
  /** 지금 이름을 고치고 있는 폴더 경로. 하나뿐이다. */
  renaming: string | null
  onToggleFolder: (path: string) => void
  onSelect: (name: string) => void
  onDragStart: (name: string) => void
  onDragFolder: (path: string) => void
  onDropInto: (folder: string) => void
  onStartRename: (path: string | null) => void
  onCommitRename: (path: string, name: string) => void
}) {
  return (
    <>
      {nodes.map((n) =>
        n.t === 'request' ? (
          <RequestRow
            key={n.request.name}
            req={n.request}
            depth={depth}
            observed={observedNames.has(n.request.name)}
            active={n.request.name === selected}
            onSelect={() => onSelect(n.request.name)}
            onDragStart={() => onDragStart(n.request.name)}
          />
        ) : (
          <div key={n.path}>
            {/*
              행 전체가 버튼이면 그 안에 다른 버튼·입력칸을 넣을 수 없다(중첩 금지).
              그래서 껍데기는 div 로 두고, 여닫기만 버튼으로 남긴다.
            */}
            <div
              data-api-folder={n.path}
              draggable={renaming !== n.path}
              onDragStart={(e) => {
                e.stopPropagation()
                onDragFolder(n.path)
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDropInto(n.path)
              }}
              style={{ paddingLeft: 12 + depth * 16 }}
              className="group flex w-full items-center gap-1.5 border-b border-line py-1.5 pr-2 hover:bg-panel"
            >
              <button
                type="button"
                data-api-folder-toggle={n.path}
                onClick={() => onToggleFolder(n.path)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                {collapsed.has(n.path) ? (
                  <ChevronRight className="size-3 shrink-0 text-muted" />
                ) : (
                  <ChevronDown className="size-3 shrink-0 text-muted" />
                )}
                <Folder className="size-3.5 shrink-0 text-muted" />
                {renaming === n.path ? null : (
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg">
                    {n.name}
                  </span>
                )}
              </button>
              {renaming === n.path ? (
                <FolderNameInput
                  initial={n.name}
                  onCommit={(name) => onCommitRename(n.path, name)}
                  onCancel={() => onStartRename(null)}
                />
              ) : (
                <button
                  type="button"
                  data-api-folder-rename={n.path}
                  title="폴더 이름 바꾸기"
                  onClick={() => onStartRename(n.path)}
                  // 호버로만 나타나면 키보드만 쓰는 사람은 닿지 못한다 — 초점이 오면 같이 보인다.
                  className="shrink-0 rounded px-1 py-0.5 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-fg"
                >
                  <Pencil className="size-3" />
                </button>
              )}
            </div>
            {!collapsed.has(n.path) && (
              <TreeView
                nodes={n.children}
                depth={depth + 1}
                selected={selected}
                collapsed={collapsed}
                observedNames={observedNames}
                renaming={renaming}
                onToggleFolder={onToggleFolder}
                onSelect={onSelect}
                onDragStart={onDragStart}
                onDragFolder={onDragFolder}
                onDropInto={onDropInto}
                onStartRename={onStartRename}
                onCommitRename={onCommitRename}
              />
            )}
          </div>
        )
      )}
    </>
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
  /**
   * `enum` 으로 바꾸는 중인 파라미터 이름.
   *
   * **빈 허용 목록은 정의 오류라 저장이 거부된다**(signature AC-2) — 옳은 규칙이다.
   * 그런데 저장을 글자마다 하면 `string → enum` 으로 가는 길 자체가 막힌다(허용 값을 치기
   * 전에 반드시 빈 상태를 지나기 때문). 그래서 **타입과 허용 값을 함께 커밋한다** —
   * 규칙을 화면으로 옮기는 대신 커밋 시점을 옮기는, `NameInput` 과 같은 수법이다.
   */
  const [becomingEnum, setBecomingEnum] = useState<Set<string>>(new Set())
  const markEnum = (name: string, on: boolean): void =>
    setBecomingEnum((cur) => {
      const next = new Set(cur)
      if (on) next.add(name)
      else next.delete(name)
      return next
    })

  /** 화면에 보이는 모양 — 아직 커밋 안 한 `enum` 전환이 얹힌다. */
  const shown = params.map((p) => (becomingEnum.has(p.name) ? { ...p, type: 'enum' as const } : p))
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
      {shown.map((p, i) => (
        <div key={p.name} data-api-param-row={p.name} className="flex items-center gap-1.5">
          <NameInput
            value={p.name}
            onCommit={(name) => onChange(params.map((x, j) => (j === i ? { ...x, name } : x)))}
          />
          <select
            value={p.type}
            data-api-param-type
            className="h-7 rounded-md border border-line bg-canvas px-1.5 text-[12px] text-fg"
            onChange={(e) => {
              const type = e.target.value as ParamType
              // enum 으로 가는 길은 허용 값이 생겨야 열린다 — 그때까지 화면에만 얹어 둔다.
              if (type === 'enum' && (params[i].enumValues ?? []).length === 0) {
                markEnum(p.name, true)
                return
              }
              markEnum(p.name, false)
              onChange(params.map((x, j) => (j === i ? { ...x, type } : x)))
            }}
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
      {/* enum 허용 값 — 타입이 enum 인 파라미터에만 나온다(그 밖에는 의미가 없다).
          **빈 목록은 정의 오류다**(signature AC-2) — 그러면 어떤 값도 통과 못 해서 요청이
          영영 안 나간다. 화면이 그 사실을 말한다. */}
      {shown.map((p, i) =>
        p.type !== 'enum' ? null : (
          <label
            key={`enum:${p.name}`}
            data-api-param-enum={p.name}
            className="flex items-center gap-1.5 pl-2 text-[11.5px] text-muted"
          >
            <span className="w-28 shrink-0 font-mono text-fg">{p.name} 허용 값</span>
            <Input
              value={(p.enumValues ?? []).join(', ')}
              placeholder="쉼표로 구분 — 예: asc, desc"
              className="h-7 flex-1 font-mono text-[12px]"
              onChange={(e) => {
                const list = e.target.value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean)
                // 값이 아직 없으면 저장을 미룬다 — 빈 허용 목록은 저장이 거부되고,
                // 그 거부가 타이핑 중에 오류 배너로 번쩍이면 고칠 수가 없다.
                if (list.length === 0) return
                markEnum(p.name, false)
                onChange(
                  params.map((x, j) => (j === i ? { ...x, type: 'enum', enumValues: list } : x))
                )
              }}
            />
            {(p.enumValues ?? []).length === 0 && (
              <span className="shrink-0 text-danger" data-api-param-enum-empty>
                허용 값을 넣어야 저장됩니다 — 비면 어떤 값도 못 통과합니다
              </span>
            )}
          </label>
        )
      )}
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

/**
 * 응답 모양 손편집 (spec requests.response AC-1·AC-4).
 *
 * 두 가지를 화면이 지킨다:
 *   · **상태별로 갈라 둔다** — 200 과 404 의 모양은 다른 선언이다
 *   · **선언 안 한 상태는 `선언 없음`이지 `응답 없음`이 아니다** — 빈 필드 목록을 만들면
 *     "이 상태는 본문이 없다"는 뜻이 되어 판정이 거짓말을 한다. 그래서 상태를 지우는 것과
 *     필드를 비우는 것을 갈라 놓는다.
 */
function FieldRows({
  fields,
  depth,
  onChange
}: {
  fields: FieldDef[]
  depth: number
  onChange: (next: FieldDef[]) => void
}) {
  const patch = (i: number, next: Partial<FieldDef>): void =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...next } : f)))

  return (
    <>
      {fields.map((f, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5" data-api-response-field={f.name} style={{ paddingLeft: depth * 14 }}>
            <Input
              value={f.name}
              placeholder="필드 이름"
              className="h-7 flex-1 font-mono text-[12px]"
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <select
              value={f.type}
              data-api-response-type
              className="h-7 rounded-md border border-line bg-canvas px-1.5 text-[12px] text-fg"
              onChange={(e) => patch(i, { type: e.target.value as FieldDef['type'] })}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={f.requiredness}
              data-api-response-requiredness
              title="`모름`은 판정에서 빠지고, 몇 개 뺐는지가 결과에 실립니다."
              className="h-7 rounded-md border border-line bg-canvas px-1.5 text-[12px] text-fg"
              onChange={(e) => patch(i, { requiredness: e.target.value as FieldDef['requiredness'] })}
            >
              <option value="required">필수</option>
              <option value="nullable">없을 수 있음</option>
              <option value="unknown">모름</option>
            </select>
            {(f.type === 'object' || f.type === 'array') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-1.5 text-[11px]"
                title="안쪽 필드 추가"
                data-api-add-subfield
                onClick={() =>
                  patch(i, {
                    fields: [...(f.fields ?? []), { name: 'field', type: 'string', requiredness: 'unknown' }]
                  })
                }
              >
                <Plus className="size-3" /> 안쪽
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              title="필드 삭제"
              onClick={() => onChange(fields.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          {f.fields && f.fields.length > 0 && (
            <FieldRows fields={f.fields} depth={depth + 1} onChange={(next) => patch(i, { fields: next })} />
          )}
        </div>
      ))}
    </>
  )
}

function ResponseEditor({
  responses,
  onChange
}: {
  responses: ResponseDef[]
  onChange: (next: ResponseDef[]) => void
}) {
  const [newStatus, setNewStatus] = useState('')

  return (
    <div className="flex flex-col gap-3">
      {responses.length === 0 && (
        <p className="rounded-md bg-panel px-2.5 py-2 text-[11.5px] text-muted" data-api-empty="no-response">
          선언한 응답 모양이 없어요. <b>선언 없음</b>은 <b>응답 없음</b>과 다릅니다 — 판정은 선언한
          것만 대조하므로, 여기가 비어 있으면 그 상태는 판정에서 빠집니다. 실제로 쏴 본 뒤
          Contract › Accept 에서 흡수할 수도 있어요.
        </p>
      )}

      {responses.map((r, i) => (
        <div key={r.status} className="flex flex-col gap-1.5 rounded-md border border-line p-2.5" data-api-response={r.status}>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-panel px-2 py-0.5 font-mono text-[11px] font-medium text-fg">
              {r.status}
            </span>
            <span className="text-[11px] text-muted">{r.fields.length}개 필드</span>
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              data-api-add-response-field
              onClick={() =>
                onChange(
                  responses.map((x, j) =>
                    j === i
                      ? { ...x, fields: [...x.fields, { name: 'field', type: 'string', requiredness: 'unknown' }] }
                      : x
                  )
                )
              }
            >
              <Plus className="size-3" /> 필드
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="이 상태 선언 통째로 지우기 — 지우면 `선언 없음`으로 돌아갑니다"
              data-api-remove-response
              onClick={() => onChange(responses.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
          <FieldRows
            fields={r.fields}
            depth={0}
            onChange={(fields) => onChange(responses.map((x, j) => (j === i ? { ...x, fields } : x)))}
          />
        </div>
      ))}

      <div className="flex items-center gap-1.5">
        <Input
          value={newStatus}
          placeholder="상태 추가 — 200 · 404 · gRPC 코드 · 이벤트 이름"
          data-api-new-response-status
          className="h-7 w-72 font-mono text-[12px]"
          onChange={(e) => setNewStatus(e.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[12px]"
          data-api-add-response
          disabled={!newStatus.trim() || responses.some((r) => r.status === newStatus.trim())}
          onClick={() => {
            onChange([...responses, { status: newStatus.trim(), fields: [] }])
            setNewStatus('')
          }}
        >
          <Plus className="size-3.5" /> 상태
        </Button>
      </div>
    </div>
  )
}

/**
 * 편집 중 치환 미리보기 (spec requests.template AC-6).
 *
 * Runner 까지 가야 결과를 볼 수 있으면 `{{now()}}` 하나 확인하려고 화면을 두 번 옮겨야 한다.
 * **비밀은 여기서도 가린다** — 편집 화면이라고 예외를 두면 화면 공유로 샌다.
 */
function TemplatePreview({ text, req }: { text: string; req: RequestDef }) {
  const env = useActiveEnvironment()
  const preview = useMemo(() => {
    if (!text.includes('{{')) return null
    const scope = buildScope({ params: req.params, env, call: {} })
    return renderTemplate(text, { scope, env: rendererFunctionEnv, maskSecrets: true })
  }, [text, req.params, env])

  if (!preview) return null
  const issues = preview.issues.filter((i) => i.kind !== 'deferred')
  return (
    <div className="flex flex-col gap-0.5 pt-0.5" data-api-template-preview>
      <span className="font-mono text-[11px] break-all text-accent-2">{preview.text}</span>
      {issues.length > 0 && (
        <span className="text-[10.5px] text-muted" data-api-template-issue>
          {issues.map((i) => i.message).join(' · ')}
        </span>
      )}
      {/* 값이 없어 못 채운 것은 **비었다고 말한다** — 조용히 빈 글자로 두면 실행할 때 놀란다. */}
      {!env && preview.used.some((u) => u.origin === 'environment') && (
        <span className="text-[10.5px] text-muted">환경을 고르면 환경 값도 채워집니다.</span>
      )}
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

  /**
   * 자기 폴더를 자기 안으로 넣는 실수를 **글자로 막는다**(CASE-apistudio-051).
   * 요청 하나를 옮기는 것은 고리를 만들지 않지만, 폴더 경로를 손으로 칠 때는
   * `결제` → `결제/결제` 처럼 자기 밑으로 파고드는 경로가 쉽게 나온다.
   */
  const folderWarning = useMemo(() => {
    const f = normalizeFolder(req.folder)
    if (!f) return null
    const seen = new Set<string>()
    for (const part of f.split('/')) {
      if (seen.has(part)) return `'${part}' 가 경로에 두 번 있습니다 — 자기 안으로 파고든 것 같아요.`
      seen.add(part)
    }
    // 다른 요청이 만든 폴더 구조와 충돌하는지도 같은 판정으로 본다.
    const clash = active.requests
      .filter((r) => r.name !== req.name)
      .some((r) => canMoveFolder(normalizeFolder(r.folder), f).reason?.includes('자기 안'))
    return clash ? '다른 요청의 폴더를 자기 안으로 끌어들이는 경로입니다.' : null
  }, [req.folder, req.name, active.requests])

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
        {/* 폴더는 엔티티가 아니라 요청이 들고 있는 경로다 — 그래서 여기서 고친다.
            빈 폴더라는 상태가 안 생기고, 옮기면 트리가 알아서 접히고 펴진다. */}
        <Input
          value={req.folder}
          placeholder="폴더 — 결제/환불"
          data-api-request-folder
          className="h-7 w-52 font-mono text-[11.5px]"
          onChange={(e) => patch({ folder: normalizeFolder(e.target.value) })}
        />
        {folderWarning && (
          <span className="shrink-0 text-[11px] text-danger" data-api-folder-warning>
            {folderWarning}
          </span>
        )}
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
                {/* 편집 중에 치환 결과가 보인다 — Runner 까지 가야 알 수 있으면 화면을 두 번 옮긴다. */}
                <TemplatePreview text={text} req={req} />
              </label>
            )
          })}
        </section>

        <section className="flex flex-col gap-2" data-api-section="responses">
          <h3 className="text-[12px] font-semibold text-fg">
            응답 모양{' '}
            <span className="font-normal text-muted">
              — 상태별로 갈라 선언합니다. 선언 없음 ≠ 응답 없음
            </span>
          </h3>
          <ResponseEditor responses={req.responses} onChange={(responses) => patch({ responses })} />
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
  // 관측 여부는 실행 기록에서 온다 — 배지가 사실을 말하려면 그 기록을 읽어야 한다.
  useOpsSync()
  const active = useApiStore((s) => s.active)
  const selected = useApiStore((s) => s.selectedRequest)
  const selectRequest = useApiStore((s) => s.selectRequest)
  const saveRequests = useApiStore((s) => s.saveRequests)
  const error = useApiStore((s) => s.error)
  const clearError = useApiStore((s) => s.clearError)
  const openCreate = useApiStore((s) => s.openCreate)
  const openTransfer = useApiStore((s) => s.openTransfer)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  /** 지금 끌고 있는 요청 이름. 드롭 대상이 어디인지는 폴더 행이 안다. */
  /** 끌고 있는 것 — 요청인지 폴더인지. 드롭 자리가 같아서 무엇인지 알아야 한다. */
  const [dragging, setDragging] = useState<{ kind: 'request' | 'folder'; id: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  /** 막힌 이유. 조용히 안 옮겨지면 "왜 안 되지"가 된다. */
  const [treeError, setTreeError] = useState<string | null>(null)
  const runs = useOpsStore((s) => s.runs)
  const observedNames = useMemo(() => new Set(runs.map((r) => r.requestName)), [runs])

  const shown = useMemo(() => filterRequests(active?.requests ?? [], q), [active?.requests, q])
  // **검색 중에는 평평하게 보인다** — 걸린 것만 남는데 폴더 껍데기가 남아 있으면
  // "여기 뭐가 더 있나" 하고 폴더를 여닫게 된다.
  const tree = useMemo(() => (q.trim() ? null : buildRequestTree(shown)), [shown, q])
  const current = active?.requests.find((r) => r.name === selected) ?? null

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4" data-api-empty="no-spec">
        {/*
          PlaceholderView 는 자기 혼자 화면을 채우도록 `h-full` 이다. 여기처럼 CTA 와 나란히
          두면 그 높이 100% 가 세로를 통째로 먹어 버튼이 창 맨 밑으로 밀린다(실측 — 안내문과
          버튼이 화면 반쯤 떨어져 보였다). 높이가 자동인 블록으로 한 겹 감싸면 100% 가
          auto 로 풀려 안내문·버튼이 한 덩어리로 가운데 선다.
        */}
        <div>
          <PlaceholderView
            icon={Route}
            title="명세를 먼저 고르세요"
            subtitle="상단 컨텍스트 바에서 명세를 고르거나 새로 만들면 요청을 지을 수 있어요."
          />
        </div>
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

  /** 끌어다 놓은 것의 소속을 바꾼다. 같은 자리면 아무 일도 안 한다. */
  const drop = (folder: string): void => {
    const held = dragging
    setDragging(null)
    setTreeError(null)
    if (!held) return

    if (held.kind === 'request') {
      const req = active.requests.find((r) => r.name === held.id)
      if (!req || normalizeFolder(req.folder) === normalizeFolder(folder)) return
      void saveRequests(moveRequest(active.requests, held.id, folder))
      return
    }

    // 폴더째 옮기기 — 자기 자손으로 넣기·이름 겹침을 **판정 한 곳**이 막고 이유를 준다.
    const check = canMoveFolder(held.id, folder, folderPaths(active.requests))
    if (!check.ok) {
      setTreeError(check.reason)
      return
    }
    void saveRequests(moveFolder(active.requests, held.id, folder))
  }

  /** 폴더 이름 바꾸기 — 자손 경로가 함께 따라간다. */
  const commitRename = (path: string, name: string): void => {
    setRenaming(null)
    const check = canRenameFolder(path, name, folderPaths(active.requests))
    if (!check.ok) {
      // "이름이 그대로"는 사용자가 그냥 빠져나온 것이라 알릴 것이 없다.
      setTreeError(check.reason === '이름이 그대로입니다.' ? null : check.reason)
      return
    }
    setTreeError(null)
    void saveRequests(renameFolder(active.requests, path, name))
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
              {/* 못 옮긴 이유 — 조용히 아무 일도 안 일어나면 "왜 안 되지"가 된다. */}
              {treeError && (
                <p
                  data-api-tree-error
                  className="border-b border-line bg-danger-soft px-3 py-1.5 text-[11.5px] text-danger"
                >
                  {treeError}
                </p>
              )}
              {shown.length === 0 ? (
                <p className="px-3 py-4 text-[12px] text-muted" data-api-empty="no-request">
                  {active.requests.length === 0
                    ? '아직 요청이 없어요. 위 + 로 하나 만들어 보세요.'
                    : '검색에 걸리는 요청이 없어요.'}
                </p>
              ) : tree === null ? (
                shown.map((r) => (
                  <RequestRow
                    key={r.name}
                    req={r}
                    depth={0}
                    observed={observedNames.has(r.name)}
                    active={r.name === selected}
                    onSelect={() => selectRequest(r.name)}
                    onDragStart={() => setDragging({ kind: 'request', id: r.name })}
                  />
                ))
              ) : (
                <div
                  /* 최상위로 되돌리는 드롭 자리 — 폴더 밖으로 꺼낼 길이 없으면 한 번 넣은 것을
                     못 뺀다. 빈 자리 전체가 그 자리다. */
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => drop('')}
                  className="min-h-full"
                  data-api-tree-root
                >
                  <TreeView
                    nodes={tree}
                    depth={0}
                    selected={selected}
                    collapsed={collapsed}
                    observedNames={observedNames}
                    onToggleFolder={(p) =>
                      setCollapsed((cur) => {
                        const next = new Set(cur)
                        if (next.has(p)) next.delete(p)
                        else next.add(p)
                        return next
                      })
                    }
                    renaming={renaming}
                    onSelect={selectRequest}
                    onDragStart={(name) => setDragging({ kind: 'request', id: name })}
                    onDragFolder={(path) => setDragging({ kind: 'folder', id: path })}
                    onDropInto={drop}
                    onStartRename={setRenaming}
                    onCommitRename={commitRename}
                  />
                </div>
              )}
            </div>
          }
        >
          {current ? (
            <RequestDetail req={current} />
          ) : (
            <PlaceholderView
              icon={Route}
              title="요청을 고르세요"
              subtitle="왼쪽 목록에서 요청을 고르면 파라미터·요청 내용·문서를 볼 수 있어요."
            />
          )}
        </WorkspacePanels>
      </div>
    </div>
  )
}
