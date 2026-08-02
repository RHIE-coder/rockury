import type { DatabaseSync } from 'node:sqlite'

/**
 * 잃어버린 스키마 되살리기 — 저장이 `schema` 를 흘려 `schema_name` 이 빈 채로 굳은 행을,
 * **id 안에 남아 있는 스키마**로 되돌린다.
 *
 * 왜 id 로 되나: 그 버그는 `schema` 필드 하나만 빠뜨렸고 **id 는 멀쩡히 저장했다.** 역설계로
 * 들어온 테이블의 id 는 `t:<스키마>.<테이블>`(설계 Draft 는 앞에 `<설계>:` 가 더 붙는다)이라,
 * 스키마 이름이 통째로 id 안에 남아 있다. 그래서 버전 스냅샷이 없는 설계도 되살아난다.
 *
 * 손대지 않는 것: `t:users` 처럼 점이 없는 id 는 **원래 스키마가 없던** 테이블이다(`ids.ts` 는
 * 스키마가 없으면 통째로 뺀다). 그것까지 고치려 들면 없던 값을 지어내게 된다.
 */

/** id 에서 스키마를 되찾는다. 되찾을 수 없으면 null — 없던 값을 지어내지 않는다. */
export function schemaFromTableId(id: string): string | null {
  // 설계 Draft 는 `<설계>:t:…` 라 접두가 붙는다 — 마지막 `t:` 부터가 이름 부분이다.
  const at = id.lastIndexOf('t:')
  if (at < 0) return null
  const rest = id.slice(at + 2)
  const dot = rest.indexOf('.')
  // 점이 없으면 스키마가 없던 것, 맨 앞이 점이면 스키마 이름이 빈 것 — 둘 다 되찾을 게 없다.
  if (dot <= 0) return null
  const schema = rest.slice(0, dot)
  const name = rest.slice(dot + 1)
  return name ? schema : null
}

/**
 * 빈 `schema_name` 을 id 에서 되찾아 채운다. 채운 행 수를 돌려준다.
 * 몇 번을 돌려도 결과가 같다(이미 값이 있는 행은 안 건드린다) — 앱을 켤 때마다 지나가도 된다.
 */
export function recoverLostTableSchemas(d: DatabaseSync): number {
  const rows = d.prepare(`SELECT id FROM tables WHERE schema_name = ''`).all() as unknown as {
    id: string
  }[]
  if (rows.length === 0) return 0

  const update = d.prepare('UPDATE tables SET schema_name = ? WHERE id = ?')
  let fixed = 0
  for (const r of rows) {
    const schema = schemaFromTableId(r.id)
    if (!schema) continue
    update.run(schema, r.id)
    fixed++
  }
  return fixed
}
