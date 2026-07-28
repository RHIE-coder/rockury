import { useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { pathToExpr } from './extract'

/**
 * 응답을 펼쳐 보여 주고 **클릭으로 경로를 집게** 하는 트리.
 *
 * 탐침 편집기의 핵심 — 사용자가 JMESPath 문법을 배우지 않아도 되게 만드는 부분이다.
 * 배열 항목을 집으면 인덱스를 전체 순회(`[]`)로 일반화해 "목록"으로 쓸 수 있게 한다.
 */

export type Path = (string | number)[]

const isLeaf = (v: unknown): boolean => v === null || typeof v !== 'object'

function preview(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `[ ${v.length}개 ]`
  if (typeof v === 'object') return `{ ${Object.keys(v as object).length}개 }`
  if (typeof v === 'string') return `"${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`
  return String(v)
}

function Row({
  label,
  value,
  path,
  depth,
  onPick,
  activeExpr,
  expandAll
}: {
  label: string
  value: unknown
  path: Path
  depth: number
  onPick: (path: Path, isArray: boolean) => void
  activeExpr: string | null
  expandAll: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(depth < 2)
  const leaf = isLeaf(value)
  const array = Array.isArray(value)
  const expr = pathToExpr(path)
  const picked = activeExpr === expr
  // 응답이 깊으면(AWS 는 목록 안에 목록이 또 있다) 손으로 서너 번 펼쳐야 값이 나온다 —
  // "전부 펼치기"가 그 수고를 없앤다. 항목 수 상한이 있어 폭발하지 않는다.
  const shown = open || expandAll

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px] hover:bg-secondary',
          picked && 'bg-primary/10 ring-1 ring-primary/40'
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {!leaf ? (
          <button
            type="button"
            className="w-3 shrink-0 cursor-pointer text-muted-foreground"
            onClick={() => setOpen(!shown)}
            aria-label={shown ? '접기' : '펼치기'}
          >
            {shown ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <button
          type="button"
          data-json-pick={expr}
          className="cursor-pointer truncate text-left"
          title={`이 자리를 집는다: ${expr}`}
          onClick={() => onPick(path, array)}
        >
          <span className="text-foreground">{label}</span>
          <span className="text-muted-foreground"> : {preview(value)}</span>
        </button>
      </div>
      {!leaf && shown && (
        <div>
          {array
            ? (value as unknown[])
                .slice(0, 20)
                .map((item, i) => (
                  <Row
                    key={i}
                    label={`[${i}]`}
                    value={item}
                    path={[...path, i]}
                    depth={depth + 1}
                    onPick={onPick}
                    activeExpr={activeExpr}
                    expandAll={expandAll}
                  />
                ))
            : Object.entries(value as Record<string, unknown>)
                .slice(0, 60)
                .map(([k, v]) => (
                  <Row
                    key={k}
                    label={k}
                    value={v}
                    path={[...path, k]}
                    depth={depth + 1}
                    onPick={onPick}
                    activeExpr={activeExpr}
                    expandAll={expandAll}
                  />
                ))}
          {array && (value as unknown[]).length > 20 && (
            <div
              className="px-1 py-0.5 font-mono text-[11px] text-muted-foreground"
              style={{ paddingLeft: (depth + 1) * 12 + 20 }}
            >
              … {(value as unknown[]).length - 20}개 더 (집을 때는 전체가 대상이다)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function JsonPicker({
  data,
  onPick,
  activeExpr,
  expandAll = false
}: {
  data: unknown
  /**
   * 집은 자리의 **경로**와 그것이 배열인지(=목록으로 쓸 수 있는지).
   * 문자열이 아니라 경로를 넘긴다 — 목록 아래 상대 경로를 문자열로 잘라 내려 하면
   * `Reservations[0]` ↔ `Reservations[]` 처럼 인덱스 표기가 달라 어긋난다.
   */
  onPick: (path: Path, isArray: boolean) => void
  activeExpr: string | null
  /** 깊은 응답에서 손으로 서너 번 펼치는 수고를 없앤다. */
  expandAll?: boolean
}): React.JSX.Element {
  const handle = (path: Path, isArray: boolean): void => onPick(path, isArray)
  if (data === undefined) {
    return <div className="p-3 text-xs text-muted-foreground">아직 실행하지 않았습니다.</div>
  }
  return (
    <div className="overflow-auto p-1">
      <Row
        label="(응답)"
        value={data}
        path={[]}
        depth={0}
        onPick={handle}
        activeExpr={activeExpr}
        expandAll={expandAll}
      />
    </div>
  )
}
