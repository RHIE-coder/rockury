import { useRemoteStore } from './store'

/**
 * 역설계가 **못 읽은 것**을 알리는 줄. 오류 배너와 다르다 — 결과는 왔고, 그 안이 일부 빈다.
 * 조용히 두면 사용자는 있는 것을 없다고 믿는다(권한에 가려진 제약이 실제로 그랬다).
 * 읽을 게 없으면 아무것도 그리지 않는다.
 */
export function IntrospectNotice({ connId }: { connId: string | null }) {
  const warnings = useRemoteStore((s) => (connId ? s.warnings[connId] : undefined))
  if (!warnings || warnings.length === 0) return null

  return (
    <div
      role="status"
      data-introspect-notice
      className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-1.5"
    >
      {warnings.map((w) => (
        <p key={w} className="font-mono text-[11px] leading-5 text-amber-800">
          {w}
        </p>
      ))}
    </div>
  )
}
