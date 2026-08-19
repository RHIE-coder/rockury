/**
 * 테이블을 **이름으로 찾고 견주는 규칙** — 렌더러(화면)와 메인(MCP 쓰기 관문)이 함께 쓴다.
 *
 * 왜 공용이냐: 규칙이 두 벌이면 한쪽만 고쳐진다. 실제로 그랬다 — 화면은
 * `schemaRef.resolveRef` 로 스키마까지 봤는데, 에이전트 쓰기 관문(`main/ai/patch`)은
 * `refTable === 이름` 하나로만 봤다. 두 스키마에 같은 이름 테이블이 있으면 관문이 엉뚱한
 * 참조를 세어 못 지우게 막거나(거짓 양성) 그 반대가 된다. 오류가 안 나고 **결과만** 틀린다.
 *
 * 규칙: **스키마가 비면 "같은 스키마"** 다. 예전 데이터와 단일 스키마 사용자는 양쪽 다 비어
 * 있어 그대로 맞아떨어진다(값을 채우는 마이그레이션 없이도 동작이 안 바뀐다).
 *
 * 여기 있는 것은 **비교뿐**이다 — 기본 스키마 이름을 지어내지 않는다(방언마다 다르다).
 */

/** 테이블을 가리키는 최소 정보. 렌더러 `TableDef` 도 메인 `TableRecord` 도 이 모양을 만족한다. */
export interface TableRef {
  schema?: string
  name: string
}

/** FK 참조를 읽는 데 필요한 최소 정보 — 두 프로세스의 제약 타입이 공통으로 갖는 부분. */
export interface FkLike {
  kind: string
  refTable?: string
  refSchema?: string
}

/** 스키마가 비었을 때 대신 쓸 이름 — `undefined` 와 `''` 를 같게 다룬다. */
const norm = (schema: string | undefined): string => schema ?? ''

/** 같은 테이블인가 — 스키마까지 본다. 둘 다 스키마가 비면 같은 스키마로 친다. */
export function sameTable(a: TableRef, b: TableRef): boolean {
  return a.name === b.name && norm(a.schema) === norm(b.schema)
}

/** FK 가 가리키는 대상을 (스키마, 이름) 으로 편다 — 목록에 없어도 무엇을 가리키는지는 안다. */
export function refTarget(from: TableRef, con: Pick<FkLike, 'refTable' | 'refSchema'>): TableRef | undefined {
  if (!con.refTable) return undefined
  return { schema: con.refSchema ?? from.schema, name: con.refTable }
}

/**
 * 자기참조인가 — 제가 걸린 테이블 자신을 가리키는 FK(댓글의 `parent_comment_id` 같은 것).
 *
 * 왜 규칙을 따로 두나: 이름만 견주면(`con.refTable === from.name`) 두 스키마에 같은 이름
 * 테이블이 있을 때 남을 가리키는 FK 를 자기참조로 잘못 읽는다. 여기서는 `refTarget` 이 편 뒤
 * `sameTable` 로 스키마까지 본다 — 다이어그램의 SELF 루프와 **같은 판정**이어야 한다.
 */
export function isSelfRef(from: TableRef, con: Pick<FkLike, 'kind' | 'refTable' | 'refSchema'>): boolean {
  if (con.kind !== 'fk') return false
  const to = refTarget(from, con)
  return !!to && sameTable(to, from)
}

/** 들어오는 참조 하나 — 어느 테이블의 어느 FK 가 나를 가리키나. */
export interface IncomingFk<T, K> {
  table: T
  constraint: K
}

/**
 * `target` 을 **가리키는** FK 들 — 지우거나 이름을 바꿀 때 함께 손봐야 하는 대상이자,
 * 화면의 "이 테이블을 참조하는 곳" 목록.
 *
 * 자기참조(자기 자신을 가리키는 FK)도 포함한다 — 거르는 것은 부르는 쪽 몫이다
 * (관문은 "남이 가리키나"를 묻고, 화면은 자기참조도 보여야 한다).
 *
 * `constraintsOf` 를 따로 받는 이유: 메인의 레코드는 제약을 `unknown[]` 으로 들고 있어
 * 부르는 쪽에서 한 번 풀어야 한다. 여기서 캐스팅하면 그 위험이 안 보이는 곳으로 숨는다.
 */
export function referencingFks<T extends TableRef, K extends FkLike>(
  tables: readonly T[],
  constraintsOf: (t: T) => readonly K[],
  target: TableRef
): IncomingFk<T, K>[] {
  const out: IncomingFk<T, K>[] = []
  for (const table of tables) {
    for (const constraint of constraintsOf(table)) {
      if (constraint.kind !== 'fk') continue
      const to = refTarget(table, constraint)
      if (to && sameTable(to, target)) out.push({ table, constraint })
    }
  }
  return out
}
