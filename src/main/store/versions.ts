import { getDb } from './db'
import { compareVersion, highestVersion, isVersionNumber } from '../../shared/versionNumber'

/**
 * Version — Design 의 불변(immutable) 스냅샷(IA). `v0.3.13` 처럼 식별, 설계별 단조 증가.
 * snapshot 은 컷 시점의 스키마 전체(테이블·컬럼·제약)를 담은 JSON.
 */
export interface VersionRecord {
  id: string
  designId: string
  number: string
  note: string
  snapshot: unknown
  locked: boolean
  createdAt: string
}

export interface CreateVersionInput {
  designId: string
  number: string
  note?: string
  snapshot: unknown
}

interface VersionRow {
  id: string
  design_id: string
  number: string
  note: string
  snapshot: string
  locked: number
  created_at: string
}

const toRecord = (r: VersionRow): VersionRecord => ({
  id: r.id,
  designId: r.design_id,
  number: r.number,
  note: r.note,
  snapshot: JSON.parse(r.snapshot),
  locked: r.locked === 1,
  createdAt: r.created_at
})

// created_at 은 ms 해상도라 연속 컷이 같은 값이 될 수 있다 — rowid(삽입 순) DESC 를 tiebreak 로
// 두어 "가장 최근 컷"이 결정적으로 정해지게 한다(latestVersion·자동 patch 기준의 비결정성 제거).
const VERSION_ORDER = 'ORDER BY created_at DESC, rowid DESC'

export function listVersions(designId: string): VersionRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, design_id, number, note, snapshot, locked, created_at FROM versions WHERE design_id = ? ${VERSION_ORDER}`
    )
    .all(designId) as unknown as VersionRow[]
  return rows.map(toRecord)
}

/** 버전 삭제 — 잘못 컷된 버전 회수용. 스냅샷 JSON 이 버전 행에 담겨 있어 행 삭제로 완결. */
export function deleteVersion(id: string): void {
  getDb().prepare('DELETE FROM versions WHERE id = ?').run(id)
}

/**
 * 버전 **메모** 수정 — 컷하고 나서야 무엇을 담았는지 적고 싶어진다(2026-08-05 사용자 요청).
 *
 * 여기서 고칠 수 있는 것은 메모뿐이다. **불변인 것은 스냅샷과 번호**다 —
 * 스냅샷은 "그때 설계가 이랬다"는 증거라 고치면 증거가 아니게 되고, 번호(`v0.1.1`)는 id
 * (`<설계>@<번호>`)의 일부이자 단조 증가의 근거라 바꾸면 이미 그 번호를 가리키는 것들
 * (버전 렌즈·Diff 선택·마이그레이션 로그)이 통째로 떠 버린다. 메모는 사람이 읽는 이름표라
 * 그런 매달림이 없다.
 */
export function updateVersionNote(id: string, note: string): void {
  getDb().prepare('UPDATE versions SET note = ? WHERE id = ?').run(note.trim(), id)
}

export function createVersion(input: CreateVersionInput): VersionRecord {
  const d = getDb()
  /*
   * 번호는 이름표가 아니라 **뼈대**다 — id(`<설계>@<번호>`)의 일부이고, 타임라인 정렬·다음 번호
   * 제안·버전 렌즈가 전부 세 자리 비교에 기댄다. 형식이 어긋난 번호가 한 줄만 섞여도 그 줄은
   * `v0.0.0` 으로 취급돼 정렬이 조용히 어긋난다. 입구가 여럿(모달·가져오기·MCP)이라
   * **마지막 문인 여기서** 막는다 — 화면 검증은 사람에게 먼저 알리는 몫이고, 이 줄이 보증이다.
   */
  if (!isVersionNumber(input.number))
    throw new Error(`버전 번호 형식이 아닙니다("${input.number}") — v0.1.0 같은 형태여야 합니다.`)
  const existing = listVersions(input.designId).map((v) => v.number)
  // PK 충돌로도 막히지만 그 오류문(UNIQUE constraint)은 사람에게 아무 말도 안 한다.
  if (existing.includes(input.number))
    throw new Error(`버전 "${input.number}" 가 이미 있습니다 — 다른 번호로 확정하세요.`)
  /*
   * 번호는 **뒤로 못 간다.** 타임라인은 컷한 시각 순으로 그려지는데 번호가 내려가면 두 순서가
   * 어긋나, 맨 위 줄에 붙는 "최신" 배지가 실제 최신 번호가 아닌 줄을 가리킨다. 무엇보다
   * 마이그레이션 이력(`v0.1.0 → v0.2.0`)이 계보를 잃는다 — 되돌리기는 버전 삭제가 맡는다.
   */
  const top = highestVersion(existing)
  if (top && compareVersion(input.number, top) < 0)
    throw new Error(
      `버전 번호는 뒤로 갈 수 없습니다("${input.number}") — 최신이 "${top}" 이라 그보다 높아야 합니다.`
    )
  const record: VersionRecord = {
    id: `${input.designId}@${input.number}`,
    designId: input.designId,
    number: input.number,
    note: (input.note ?? '').trim(),
    snapshot: input.snapshot,
    locked: false,
    createdAt: new Date().toISOString()
  }
  d.prepare(
    'INSERT INTO versions (id, design_id, number, note, snapshot, locked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  ).run(
    record.id,
    record.designId,
    record.number,
    record.note,
    JSON.stringify(record.snapshot),
    record.createdAt
  )
  return record
}
