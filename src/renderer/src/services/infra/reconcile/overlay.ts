import { isDocEmpty } from '../design/nodeDoc'
import type { DesignNode } from '../design/types'
import type { DiffRow } from './diff'
import type { Verdict } from './types'

/**
 * 대조 결과를 **설계 다이어그램 위에 겹쳐 보이기** 위한 순수 계산.
 * 명세: `docs/spec/infra-architecture.md` §reconcile.result AC-3 · §reconcile.bootstrap AC-2.
 *
 * 표(대조 뷰)와 그림(설계 뷰)이 **같은 계산을 본다.** 그림 쪽에서 판정을 다시 계산하면
 * 두 화면이 서로 다른 답을 말할 수 있고, 그러면 사용자는 어느 쪽을 믿어야 할지 모른다.
 */

/**
 * 설계 노드 id → 판정. 그릴 노드가 있는 줄만 담는다
 * (미등록 실물은 설계에 아직 없으므로 배지를 붙일 자리가 없다).
 */
export function verdictByNode(rows: DiffRow[]): Record<string, Verdict> {
  const out: Record<string, Verdict> = {}
  for (const r of rows) {
    if (r.designNode) out[r.designNode.id] = r.verdict
  }
  return out
}

/**
 * 문서가 빈 노드를 **채울 순서대로** 줄 세운다.
 *
 * 통째 흡수로 만든 초안은 노드가 전부 설명이 없다. "설명 없음" 배지만 뿌려 놓으면
 * 사용자는 수십 개를 앞에 두고 어디부터 손댈지 못 정한다 — 그래서 순서를 우리가 정해 준다:
 *
 * 1. **담는 상자부터**(깊이 얕은 것). 큰 그림을 먼저 적어야 안쪽 것을 적기 쉬워진다.
 * 2. 같은 깊이면 **자식을 많이 담은 것부터**. 죽었을 때 파급이 크다.
 * 3. 그래도 같으면 **이름 순** — 순서가 실행마다 흔들리면 "아까 그거"를 다시 못 찾는다.
 */
export function docQueue(nodes: DesignNode[]): DesignNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kids = new Map<string, number>()
  for (const n of nodes) {
    if (!n.parentId) continue
    kids.set(n.parentId, (kids.get(n.parentId) ?? 0) + 1)
  }
  const depth = (n: DesignNode): number => {
    let d = 0
    let cur = n.parentId
    const seen = new Set<string>()
    // 부모 참조가 끊겨 있어도(지워진 노드를 가리켜도) 멈춘다.
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      d++
      cur = byId.get(cur)?.parentId ?? null
    }
    return d
  }
  return nodes
    .filter((n) => isDocEmpty(n.doc))
    .sort(
      (a, b) =>
        depth(a) - depth(b) ||
        (kids.get(b.id) ?? 0) - (kids.get(a.id) ?? 0) ||
        a.name.localeCompare(b.name)
    )
}
