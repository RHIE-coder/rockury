/**
 * Studio › Seed 도메인 타입 — **시드 세트**(= 시드 관리의 단위: 대상 테이블 · 자연키 ·
 * 무시 컬럼 · 관리 강도). 정본 명세 `docs/spec/db-studio.md` Surface `db-studio.seed`.
 *
 * 왜 컬럼을 id 가 아니라 **이름**으로 가리키나: 시드 행은 결국 실 DB 에 심어지고, 실 DB 에는
 * 설계의 순번 id 가 존재하지 않는다(이름이 곧 정체성). 스키마쪽 `versions/align.ts` 가 경계
 * 비교에서 이름 기반 id 로 맞추는 것과 같은 이유다.
 */

/** 관리 강도 — 시드가 실 DB 를 어디까지 통제하는가. */
export type SeedStrength = 'ensure' | 'authoritative'

export const STRENGTH_LABEL: Record<SeedStrength, string> = {
  ensure: '보장만',
  authoritative: '전권'
}

export const STRENGTH_HINT: Record<SeedStrength, string> = {
  ensure: '설계에 적힌 행만 맞추고, 실 DB 의 나머지 행은 건드리지 않아요.',
  authoritative: '설계에 없는 행은 삭제 후보가 돼요 — 실제 삭제는 반영 단계에서 확인을 받습니다.'
}

export interface SeedRow {
  /** 행 로컬 id — 그리드 편집·React key 용. 행의 **정체성은 자연키**이고 이 id 는 화면 편의값이다. */
  id: string
  /** 컬럼명 → 값. `null` 은 SQL NULL. `{{NAME}}` 문자열은 변수 자리표시자(환경차 분리). */
  values: Record<string, string | null>
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
  rows: SeedRow[]
}
