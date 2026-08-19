import {
  FIRST_VERSION,
  compareVersion,
  formatVersion,
  highestVersion,
  nextVersion,
  parseVersion,
  type BumpLevel
} from '@shared/versionNumber'
import type { TableDef } from '../workspaces/definition/types'

/**
 * "운영 DB → 설계 버전업" 가져오기의 순수 판정 로직(§IA 운영→설계 관문).
 * 실 DB 역설계 결과를 설계의 새 버전으로 되먹일 때, 어느 갈래인지와 제안 번호를 결정한다.
 * (실제 역설계·컷·바인딩은 store 오케스트레이션이 담당 — 여기서는 DB 를 건드리지 않는다.)
 *
 *  - new-design  : 연결에 물린 설계가 없음 → 새 Design 을 만들고 첫 버전(v0.1.0)을 컷.
 *  - version-up  : 이미 설계가 있음 → 최신 버전 대비 다음 번호로 컷(버전이 없으면 첫 버전).
 */
export type ImportMode = 'new-design' | 'version-up'

export interface ImportContext {
  /** 활성 설계가 있는가(없으면 새 설계 부트스트랩). */
  hasDesign: boolean
  /** 활성 설계의 최신 버전 번호(없으면 null — 빈 설계). */
  latestVersionNumber: string | null
}

export interface ImportPlan {
  mode: ImportMode
  /** 컷할 새 버전 번호 제안(다이얼로그에서 편집 가능). */
  suggestedNumber: string
}

export function planImport(ctx: ImportContext, level: BumpLevel = 'patch'): ImportPlan {
  if (!ctx.hasDesign) return { mode: 'new-design', suggestedNumber: FIRST_VERSION }
  if (!ctx.latestVersionNumber) return { mode: 'version-up', suggestedNumber: FIRST_VERSION }
  return { mode: 'version-up', suggestedNumber: nextVersion(ctx.latestVersionNumber, level) }
}

/** 번호 칸 판정 결과 — 저장할 정규형과, 못 쓸 때의 사유(칸 아래에 그대로 보인다). */
export interface NumberCheck {
  /** 정규형으로 고친 번호. 형식이 아니면 null. */
  number: string | null
  error: string | null
}

/**
 * 가져오기 창 "버전 번호" 칸 판정 — **사람이 번호를 직접 적는 유일한 컷 입구**라 여기서 막는다
 * (버전 컷 모달은 Patch/Minor/Major 버튼으로만 고르고, MCP `create_version` 은 제 손으로 검증한다).
 * 적힌 그대로가 아니라 정규형으로 **고쳐서** 돌려준다 — `0.2` 로 적어도 `v0.2.0` 으로 저장된다.
 */
export function checkImportNumber(raw: string, existing: string[]): NumberCheck {
  const p = parseVersion(raw ?? '')
  if (!p) return { number: null, error: (raw ?? '').trim() ? 'v0.1.0 형태여야 합니다' : '버전 번호 필요' }
  const number = formatVersion(p)
  if (existing.includes(number)) return { number, error: '이미 있는 번호' }
  // 번호는 뒤로 못 간다 — 저장소도 같은 규칙으로 거절한다(`main/store/versions`).
  const top = highestVersion(existing)
  if (top && compareVersion(number, top) < 0) return { number, error: `${top} 보다 높아야 합니다` }
  return { number, error: null }
}

/** 새 설계 이름 기본값 — 연결 이름에서 파생(편집 가능). */
export function defaultImportDesignName(connectionName: string): string {
  const base = (connectionName ?? '').trim()
  return base ? `${base} (imported)` : 'imported'
}

/**
 * 역설계 결과의 id 를 설계 스코프로 접두(prefix)해 전역 유일하게 만든다(순수 → 테스트 의무).
 * 역설계 id 는 이름 기반(`t:users`)이라 설계별 Draft 를 전역 `tables` 테이블(PK=id)에 넣으면
 * 다른 설계와 충돌할 수 있다. 설계 id 를 접두로 붙여 유일성을 보장하고, 제약의 컬럼 참조도
 * 같은 매핑으로 갱신한다(refTable/refColumns 는 이름이라 그대로 둔다).
 */
export function scopeTableIds(tables: TableDef[], prefix: string): TableDef[] {
  return tables.map((t) => {
    const colIdMap = new Map<string, string>()
    const columns = t.columns.map((c) => {
      const nid = `${prefix}:${c.id}`
      colIdMap.set(c.id, nid)
      return { ...c, id: nid }
    })
    const constraints = t.constraints.map((k) => ({
      ...k,
      id: `${prefix}:${k.id}`,
      columns: k.columns.map((r) => ({ ...r, columnId: colIdMap.get(r.columnId) ?? `${prefix}:${r.columnId}` }))
    }))
    return { ...t, id: `${prefix}:${t.id}`, columns, constraints }
  })
}
