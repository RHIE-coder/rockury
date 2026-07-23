import { tokenizeSqlLine } from './sqlHighlight'

/** DDL 한 줄을 구문 강조해 렌더. 빈 줄은 공백 하나(레이아웃 유지). Studio·Console SQL 뷰 공용. */
export function HighlightedSqlLine({ line }: { line: string }) {
  const tokens = tokenizeSqlLine(line)
  if (tokens.length === 0) return <span>{' '}</span>
  return (
    <>
      {tokens.map((t, i) =>
        t.className ? (
          <span key={i} className={t.className}>
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        )
      )}
    </>
  )
}
