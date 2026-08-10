import { useRemoteStore } from './store'

/**
 * 못 읽은 것을 알리는 줄. 오류 배너와 다르다 — 결과는 왔고, 그 안이 일부 빈다.
 * 조용히 두면 사용자는 있는 것을 없다고 믿는다(권한에 가려진 제약이 실제로 그랬다).
 * 읽을 게 없으면 아무것도 그리지 않는다.
 *
 * 기본은 introspection 경고(스토어)를 읽고, `warnings` 를 주면 그걸 그린다 —
 * Grant 화면처럼 다른 출처의 경고도 **같은 한 벌**로 보이기 위해서(복붙 금지, 리뷰 지적).
 */
export function IntrospectNotice({
  connId,
  warnings
}: {
  connId: string | null
  warnings?: string[]
}) {
  const stored = useRemoteStore((s) => (connId ? s.warnings[connId] : undefined))
  const list = warnings ?? stored
  if (!list || list.length === 0) return null

  return (
    <div
      role="status"
      data-introspect-notice
      className="shrink-0 border-b border-warning/30 bg-warning-soft px-5 py-1.5"
    >
      {list.map((w) => (
        <p key={w} className="font-mono text-[11px] leading-5 text-warning">
          {w}
        </p>
      ))}
    </div>
  )
}
