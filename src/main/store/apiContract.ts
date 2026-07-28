import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { normalizeDrift } from '../../shared/api/drift'
import type { DriftGrade, DriftResult } from '../../shared/api/drift'
import type { AbsorbChange } from '../../shared/api/absorb'

/**
 * 판정·흡수 이력 — `docs/spec/api-contract.md` § logs.
 *
 * 판정과 흡수를 **한 타임라인**에 둔다: "왜 이 필드가 명세에 있지"를 되짚으려면
 * "언제 판정했고 언제 받아들였나"가 나란히 보여야 한다.
 * 이력은 **불변**이다 — 갱신 경로를 두지 않는다.
 */

export type ContractLogKind = 'drift' | 'accept'

export interface ContractLog {
  id: string
  specId: string
  kind: ContractLogKind
  environmentId: string | null
  environmentName: string
  grade: DriftGrade | null
  summary: string
  createdAt: string
  /** `drift` 면 DriftResult, `accept` 면 흡수 변경 목록. */
  payload: DriftResult | AbsorbChange[]
}

interface Row {
  id: string
  spec_id: string
  kind: string
  environment_id: string | null
  environment_name: string
  grade: string | null
  summary: string
  payload: string
  created_at: string
}

const toLog = (r: Row): ContractLog => {
  const kind = r.kind as ContractLogKind
  const payload = JSON.parse(r.payload)
  return {
    id: r.id,
    specId: r.spec_id,
    kind,
    environmentId: r.environment_id,
    environmentName: r.environment_name,
    grade: (r.grade as DriftGrade | null) ?? null,
    summary: r.summary,
    createdAt: r.created_at,
    // **판정 결과는 JSON 통째로 저장된다** — 커버리지에 칸을 더하면 그 전에 쌓인 기록에는
    // 그 칸이 없다. 화면이 `.length` 를 부르는 순간 터지고, 렌더러에 error boundary 가
    // 없어 판정 화면이 백지가 된다(재판정 버튼까지 사라져 스스로 복구가 안 된다).
    // `api_runs` 는 컬럼 ALTER 로 막았지만 JSON 페이로드엔 마이그레이션이 닿지 않으므로
    // **읽는 자리에서** 맞춰 준다.
    payload: kind === 'drift' ? normalizeDrift(payload as DriftResult) : (payload as AbsorbChange[])
  }
}

export interface AppendLogInput {
  specId: string
  kind: ContractLogKind
  environmentId: string | null
  environmentName: string
  grade: DriftGrade | null
  summary: string
  payload: DriftResult | AbsorbChange[]
}

export function appendContractLog(input: AppendLogInput): ContractLog {
  const log: ContractLog = {
    ...input,
    id: `ct_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    createdAt: new Date().toISOString()
  }
  getDb()
    .prepare(
      'INSERT INTO api_contract_logs (id, spec_id, kind, environment_id, environment_name, grade, summary, payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    .run(
      log.id,
      log.specId,
      log.kind,
      log.environmentId,
      log.environmentName,
      log.grade,
      log.summary,
      JSON.stringify(log.payload),
      log.createdAt
    )
  return log
}

export function listContractLogs(specId: string, limit = 100): ContractLog[] {
  return (
    getDb()
      .prepare(
        'SELECT * FROM api_contract_logs WHERE spec_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'
      )
      .all(specId, limit) as unknown as Row[]
  ).map(toLog)
}

/** 가장 최근 판정 — 화면이 "지금 상태"를 보일 때 쓴다. */
export function latestDrift(specId: string): ContractLog | undefined {
  const r = getDb()
    .prepare(
      "SELECT * FROM api_contract_logs WHERE spec_id = ? AND kind = 'drift' ORDER BY created_at DESC, rowid DESC LIMIT 1"
    )
    .get(specId) as unknown as Row | undefined
  return r ? toLog(r) : undefined
}
