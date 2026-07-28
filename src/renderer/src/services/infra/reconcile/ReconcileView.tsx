import { useMemo, useState } from 'react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { InfraIcon } from '../catalog/iconMap'
import { isDocEmpty } from '../design/nodeDoc'
import { reconcileRows, typesOf, useInfraStore } from '../store'
import { docQueue } from './overlay'
import { BASIS_LABEL, VERDICT_LABEL, type Verdict } from './types'
import { agoLabel } from './LiveView'

/**
 * 대조 — 설계본과 실물을 나란히 놓고 어긋난 곳을 짚는다.
 *
 * **여기서 나가는 유일한 쓰기는 "설계본에 흡수"다.** 실물을 고치는 버튼은 없다 —
 * Rockury 는 인프라를 구축하지 않기로 했고, 그 결정이 화면에서도 그대로 보여야 한다.
 * 구축은 밖에서(사람 또는 MCP 로 설계본을 읽은 에이전트) 일어난다.
 */

const verdictTone: Record<Verdict, string> = {
  missing: 'bg-violet-100 text-violet-900',
  unregistered: 'bg-amber-100 text-amber-900',
  drift: 'bg-rose-100 text-rose-900',
  ok: 'bg-emerald-100 text-emerald-800',
  'not-checked': 'bg-neutral-200 text-neutral-700'
}

export function ReconcileView(): React.JSX.Element {
  const store = useInfraStore()
  const types = useMemo(() => typesOf(store.catalogs), [store.catalogs])
  const rows = useMemo(
    () => reconcileRows({ nodes: store.nodes, catalogs: store.catalogs, snapshot: store.snapshot }),
    [store.nodes, store.catalogs, store.snapshot]
  )
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1
    return acc
  }, {})

  const absorbable = rows.filter((r) => r.verdict === 'unregistered' || r.verdict === 'drift')
  // 흡수 뒤 무엇부터 채우면 되나. 흡수한 적이 있을 때만 보인다 —
  // 손으로 그리는 중인 사람에게 "설명 채우세요" 목록을 들이밀면 잔소리가 된다.
  const toDocument = store.beforeAbsorb ? docQueue(store.nodes) : []
  const keyOf = (r: (typeof rows)[number]): string =>
    r.verdict === 'unregistered' ? (r.resources[0]?.externalId ?? '') : (r.designNode?.id ?? '')

  const toggle = (k: string): void => {
    const next = new Set(picked)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setPicked(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-4" data-infra-view="reconcile">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground" data-reconcile-basis>
          {store.snapshot ? agoLabel(store.snapshot.takenAt) : '실물을 아직 읽지 않았습니다'}
        </span>
        {(['missing', 'drift', 'unregistered', 'not-checked'] as Verdict[]).map((v) => (
          <span
            key={v}
            className={cn('rounded px-1.5 py-0.5 text-[11px]', verdictTone[v])}
            data-reconcile-count={v}
          >
            {VERDICT_LABEL[v]} {counts[v] ?? 0}
          </span>
        ))}
        <div className="ml-auto flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={absorbable.length === 0}
            onClick={() => store.absorb(picked.size ? picked : undefined)}
            data-reconcile-absorb
          >
            {picked.size ? `고른 ${picked.size}건 설계본에 흡수` : '전부 설계본에 흡수'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!store.beforeAbsorb}
            onClick={() => store.undoAbsorb()}
            data-reconcile-undo
          >
            되돌리기
          </Button>
          <Button size="sm" onClick={() => void store.save()} disabled={!store.dirty} data-reconcile-save>
            {store.dirty ? '저장' : '저장됨'}
          </Button>
        </div>
      </div>

      <p className="mb-2 text-[11px] text-muted-foreground">
        <strong>흡수는 설계본만 고칩니다.</strong> 실물은 이 화면에서 바뀌지 않습니다 — 구축·수정은 밖에서
        하고, 여기서는 그 결과를 다시 읽어 확인합니다.
      </p>

      {toDocument.length > 0 && (
        <div className="mb-2 rounded-md border border-sky-200 bg-sky-50 p-2" data-absorb-todo>
          <p className="text-[11px] text-sky-900">
            흡수로 만든 노드는 <strong>설명이 비어 있습니다</strong> — 담는 것부터 차례로 채우면 안쪽이
            쉬워집니다. 남은 <span data-absorb-todo-count>{toDocument.length}</span>개:
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {toDocument.slice(0, 12).map((n) => (
              <button
                key={n.id}
                type="button"
                className="cursor-pointer rounded bg-white px-1.5 py-0.5 text-[10px] text-sky-900 ring-1 ring-sky-200 hover:bg-sky-100"
                onClick={() => store.select(n.id)}
                data-absorb-todo-item={n.id}
              >
                {n.name}
              </button>
            ))}
            {toDocument.length > 12 && (
              <span className="px-1 py-0.5 text-[10px] text-sky-900">외 {toDocument.length - 12}개</span>
            )}
          </div>
          <p className="mt-1 text-[10px] text-sky-800">
            고른 노드는 <strong>Design › 노드 문서</strong>에서 채웁니다.
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-secondary/60 text-left">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 font-medium">판정</th>
              <th className="px-3 py-2 font-medium">설계</th>
              <th className="px-3 py-2 font-medium">실물</th>
              <th className="px-3 py-2 font-medium">차이</th>
              <th className="px-3 py-2 font-medium">짝짓기 근거</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.verdict !== 'ok')
              .map((r, i) => {
                const t = r.designNode?.typeId ? types[r.designNode.typeId] : types[r.resources[0]?.typeId]
                const k = keyOf(r)
                const canPick = r.verdict === 'unregistered' || r.verdict === 'drift'
                return (
                  <tr key={`${r.verdict}:${k}:${i}`} className="border-t border-border" data-reconcile-row={r.verdict}>
                    <td className="px-2 py-1.5">
                      {canPick && (
                        <input
                          type="checkbox"
                          checked={picked.has(k)}
                          onChange={() => toggle(k)}
                          data-reconcile-pick={k}
                        />
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px]', verdictTone[r.verdict])}>
                        {VERDICT_LABEL[r.verdict]}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      {r.designNode ? (
                        <span className="flex items-center gap-1.5">
                          <span style={{ color: t?.color }}>
                            <InfraIcon icon={t?.icon ?? 'phosphor:cube'} size={14} />
                          </span>
                          {r.designNode.name}
                          {isDocEmpty(r.designNode.doc) && (
                            <span className="rounded bg-sky-100 px-1 text-[9px] text-sky-800">설명 없음</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {r.resources.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span>
                          {r.resources[0].name || r.resources[0].externalId}
                          {r.resources.length > 1 && (
                            <span className="ml-1 text-muted-foreground" data-reconcile-multi>
                              외 {r.resources.length - 1}개
                            </span>
                          )}
                          {r.unknownType && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1 text-[9px] text-amber-800">
                              미상 종류
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {r.fields.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {r.fields.map((f) => (
                            <li key={f.field}>
                              <span className="font-mono text-[10px] text-muted-foreground">{f.field}</span>{' '}
                              설계 &ldquo;{f.design}&rdquo; ↔ 실물 &ldquo;{f.live}&rdquo;
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {r.basis ? BASIS_LABEL[r.basis] : '—'}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
        {rows.filter((r) => r.verdict !== 'ok').length === 0 && (
          <p className="p-4 text-xs text-muted-foreground" data-reconcile-clean>
            어긋난 곳이 없습니다.
          </p>
        )}
      </div>
    </div>
  )
}
