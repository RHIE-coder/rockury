import { useMemo } from 'react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { DOC_FIELDS, type DocLink } from '../catalog/types'
import { InfraIcon } from '../catalog/iconMap'
import { isDocEmpty } from './nodeDoc'
import { typesOf, useInfraStore } from '../store'

/**
 * 노드 문서 — 이 서비스의 무기.
 *
 * "EC2 하나 떠 있고 3000번 리스닝 중… 그래서 어쩌라고" 를 없애는 화면이다.
 * 정해진 칸 다섯 + 자유 서술을 함께 둔다 — 자유 서술만 두면 아무도 안 쓰고,
 * 칸만 두면 의도가 안 담긴다.
 */
export function NodeDocWorkspace(): React.JSX.Element {
  const store = useInfraStore()
  const types = useMemo(() => typesOf(store.catalogs), [store.catalogs])
  const selected = store.nodes.find((n) => n.id === store.selectedNodeId) ?? null

  const emptyCount = store.nodes.filter((n) => isDocEmpty(n.doc)).length

  if (store.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        다이어그램에서 노드를 먼저 놓으세요.
      </div>
    )
  }

  const setField = (key: string, value: string): void => {
    if (!selected) return
    store.setDoc(selected.id, { ...selected.doc, [key]: value })
  }

  const setLinks = (links: DocLink[]): void => {
    if (!selected) return
    store.setDoc(selected.id, { ...selected.doc, links })
  }

  return (
    <div className="flex h-full min-h-0" data-infra-view="node-doc">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border">
        <header className="border-b border-border px-3 py-2 text-xs">
          노드 {store.nodes.length}개
          {emptyCount > 0 && (
            <span className="text-sky-700" data-doc-empty-count>
              {' '}
              · 설명 없음 {emptyCount}개
            </span>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-1.5">
          {store.nodes.map((n) => {
            const t = n.typeId ? types[n.typeId] : undefined
            return (
              <button
                key={n.id}
                type="button"
                data-doc-node={n.id}
                onClick={() => store.select(n.id)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs',
                  store.selectedNodeId === n.id ? 'bg-primary/10' : 'hover:bg-secondary'
                )}
              >
                <span style={{ color: t?.color }}>
                  <InfraIcon icon={t?.icon ?? 'phosphor:cube'} size={14} />
                </span>
                <span className="min-w-0 flex-1 truncate">{n.name}</span>
                {isDocEmpty(n.doc) && (
                  <span className="shrink-0 rounded bg-sky-100 px-1 text-[9px] text-sky-800">없음</span>
                )}
              </button>
            )
          })}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-auto p-4">
        {!selected && <p className="text-sm text-muted">왼쪽에서 노드를 고르세요.</p>}
        {selected && (
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            <h2 className="text-sm font-medium">{selected.name}</h2>
            <p className="-mt-2 text-[11px] text-muted">
              이 글은 <strong>설계 노드</strong>에 붙습니다. 실물은 다시 만들어지면 식별자가 바뀌므로,
              실물에 매달면 재배포 한 번에 사라집니다.
            </p>

            {DOC_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-xs font-medium">
                  {f.label}
                  <span className="ml-1.5 font-normal text-muted">— {f.hint}</span>
                </span>
                {f.key === 'notes' ? (
                  <textarea
                    className="min-h-32 rounded-md border border-input bg-background p-2 text-sm"
                    value={selected.doc.notes}
                    onChange={(e) => setField('notes', e.target.value)}
                    data-doc-field="notes"
                  />
                ) : (
                  <Input
                    value={selected.doc[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                    data-doc-field={f.key}
                  />
                )}
              </label>
            ))}

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">관련 링크 — 런북·대시보드·티켓</span>
              {selected.doc.links.map((l, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input
                    className="w-40"
                    placeholder="이름"
                    value={l.label}
                    onChange={(e) =>
                      setLinks(selected.doc.links.map((x, j) => (i === j ? { ...x, label: e.target.value } : x)))
                    }
                  />
                  <Input
                    placeholder="https://"
                    value={l.url}
                    onChange={(e) =>
                      setLinks(selected.doc.links.map((x, j) => (i === j ? { ...x, url: e.target.value } : x)))
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setLinks(selected.doc.links.filter((_, j) => j !== i))}
                  >
                    빼기
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => setLinks([...selected.doc.links, { label: '', url: '' }])}
              >
                링크 추가
              </Button>
            </div>

            <Button
              className="self-start"
              onClick={() => void store.save()}
              disabled={!store.dirty}
              data-doc-save
            >
              {store.dirty ? '저장' : '저장됨'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
