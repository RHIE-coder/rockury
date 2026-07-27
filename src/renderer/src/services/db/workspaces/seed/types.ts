/**
 * Studio › Seed 도메인 타입 — **시드 세트**(= 시드 관리의 단위: 대상 테이블 · 자연키 ·
 * 무시 컬럼 · "설계에 없는 행" 처리). 정본 명세 `docs/spec/db-studio.md` Surface `db-studio.seed`.
 *
 * 왜 컬럼을 id 가 아니라 **이름**으로 가리키나: 시드 행은 결국 실 DB 에 심어지고, 실 DB 에는
 * 설계의 순번 id 가 존재하지 않는다(이름이 곧 정체성). 스키마쪽 `versions/align.ts` 가 경계
 * 비교에서 이름 기반 id 로 맞추는 것과 같은 이유다.
 */

/**
 * 반영할 때 **설계에 없는 행**을 어떻게 할지 — 화면에는 추상적인 이름 대신 효과를 그대로 보인다
 * (`그대로 둠` / `삭제 후보`). 내부 값 이름은 뜻을 그대로 남긴다.
 */
export type SeedStrength = 'ensure' | 'authoritative'

/** 이 선택이 무엇에 대한 것인지 — 화면의 묶음 라벨. */
export const STRENGTH_GROUP_LABEL = '설계에 없는 행'

export const STRENGTH_LABEL: Record<SeedStrength, string> = {
  ensure: '그대로 둠',
  authoritative: '삭제 후보'
}

export const STRENGTH_HINT: Record<SeedStrength, string> = {
  ensure: '설계에 적힌 행만 넣고 맞춰요. 실 DB 에 그 밖의 행이 더 있어도 건드리지 않아요.',
  authoritative:
    '설계에 없는 행은 삭제 후보가 돼요 — 목록 전체를 설계가 결정하는 표(역할·권한 등)에 씁니다. 실제 삭제는 반영 단계에서 확인을 받습니다.'
}

export interface SeedRow {
  /** 행 로컬 id — 그리드 편집·React key 용. 행의 **정체성은 짝짓기 기준**이고 이 id 는 화면 편의값이다. */
  id: string
  /**
   * **별칭** — 다른 시드 행이 이 행을 가리킬 때 쓰는 이름(`@users#admin` 의 `admin`).
   * 설계 안에서만 쓰이고 **실 DB 에는 들어가지 않는다.** 왜 짝짓기 기준 값을 그대로 쓰지 않나:
   * 기준 값(email·code)은 실제로 바뀌는데, 그때 그걸 가리키던 참조가 전부 깨진다.
   * 비어 있어도 된다(참조 대상이 아닌 행). 같은 세트 안에서는 겹칠 수 없다.
   */
  alias?: string
  /** 컬럼명 → 값. `null` 은 SQL NULL. `{{NAME}}` 문자열은 변수 자리표시자(환경차 분리). */
  values: Record<string, string | null>
}

/**
 * PK(대체키) 를 **누가 만드는가** — 반영 계약의 핵심 선언(spec `db-studio.seed.apply-contract` AC-2).
 *  - `db`   : DB 가 만든다(자동증가·`DEFAULT uuid()`) → 시드는 PK 를 담지 않는다.
 *  - `seed` : 시드가 값을 준다 — 셀에 직접 쓰거나 `pkTemplate` 으로 **결정적으로** 만든다.
 * 랜덤 생성은 허용하지 않는다: 재실행마다 값이 달라져 같은 행이 두 벌 생긴다.
 */
export type SeedPkStrategy = 'db' | 'seed'

export const PK_STRATEGY_LABEL: Record<SeedPkStrategy, string> = {
  db: 'DB 가 만든다',
  seed: '시드가 정한다'
}

export const PK_STRATEGY_HINT: Record<SeedPkStrategy, string> = {
  db: '자동증가·DEFAULT uuid() 처럼 DB 가 채워요. 시드는 PK 를 담지 않고, 환경마다 값이 달라집니다.',
  seed:
    '시드가 PK 값을 정해 세 환경이 같은 값을 갖게 해요. 셀에 직접 쓰거나 생성 규칙(템플릿)으로 만듭니다 — 규칙은 결정적이어서 몇 번 돌려도 같은 값이 나옵니다.'
}

export interface SeedSet {
  /** 소속 Design id — 시드도 설계 소유물이다(테이블과 같은 스코프 규칙). */
  designId: string
  /** 대상 테이블 이름 — 설계 안에서 유일(테이블당 세트 하나). */
  tableName: string
  /** 자연키 컬럼명. **배열 순서가 키 구성 순서**다. 비면 행 단위 비교 불가. */
  naturalKey: string[]
  /** 비교에서 뺄 컬럼명(`id`·`created_at` 류). */
  ignoredColumns: string[]
  strength: SeedStrength
  /** PK 를 누가 만드는가(기본 `db`). */
  pkStrategy?: SeedPkStrategy
  /**
   * `pkStrategy='seed'` 일 때 PK 값 생성 규칙. 비면 셀에 쓴 값을 그대로 쓴다.
   * 자리표시자: `{table}` · `{key}`(짝짓기 기준 값들을 `-` 로 이음) · `{alias}` · `{uuid}`(결정적 UUID).
   * 예: `{uuid}` · `role-{key}` · `{table}-{alias}`
   */
  pkTemplate?: string
  rows: SeedRow[]
}
