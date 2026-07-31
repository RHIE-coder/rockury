import { getDb } from './db'
import { decrypt, encrypt } from '../infra/crypto'

/**
 * 환경 변수 값 — 시드의 `{{NAME}}` 자리표시자를 반영할 때 채우는 값.
 * 정본: `docs/spec/db-design.md` Section `db-design.seed.variables` / `.apply-contract`.
 *
 * **값은 평문으로 저장하지 않는다** — 연결 비밀번호와 같은 OS 키체인 경로(`infra/crypto`)로
 * 암호화해 넣는다. 시드는 관리자 비밀번호 해시 같은 비밀값을 담는 자리라서, 설계 정본(설계 저장소)에
 * 평문이 남으면 그 자체가 사고다.
 *
 * 스코프는 **환경(environment = connection×design 바인딩)** — 같은 설계를 DEV·PROD 에 반영할 때
 * 서로 다른 값을 갖는 게 이 기능의 목적이다.
 */
export interface EnvVariableInfo {
  envId: string
  name: string
  /** 값이 들어 있는가 — **평문은 절대 목록에 실어 보내지 않는다.** */
  hasValue: boolean
  updatedAt: string
}

interface EnvVariableRow {
  env_id: string
  name: string
  encrypted_value: string
  updated_at: string
}

/** 목록(값 없음) — 화면은 "무엇이 필요한지·채워졌는지"만 알면 된다. */
export function listEnvVariables(envId: string): EnvVariableInfo[] {
  const rows = getDb()
    .prepare('SELECT env_id, name, encrypted_value, updated_at FROM env_variables WHERE env_id = ? ORDER BY name')
    .all(envId) as unknown as EnvVariableRow[]
  return rows.map((r) => ({
    envId: r.env_id,
    name: r.name,
    hasValue: r.encrypted_value !== '',
    updatedAt: r.updated_at
  }))
}

export function setEnvVariable(envId: string, name: string, value: string): void {
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO env_variables (env_id, name, encrypted_value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(env_id, name) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = excluded.updated_at`
    )
    .run(envId, name, value === '' ? '' : encrypt(value), now)
}

export function deleteEnvVariable(envId: string, name: string): void {
  getDb().prepare('DELETE FROM env_variables WHERE env_id = ? AND name = ?').run(envId, name)
}

/**
 * 반영 직전에만 쓰는 평문 조회 — 이름 → 값.
 * 복호화가 실패한 항목은 **빼고** 돌려준다(그 변수는 "값 없음"으로 취급되어 반영이 막힌다 —
 * 조용히 빈 문자열을 넣어 잘못된 값을 심는 것보다 낫다).
 */
export function resolveEnvVariables(envId: string): Record<string, string> {
  const rows = getDb()
    .prepare('SELECT env_id, name, encrypted_value, updated_at FROM env_variables WHERE env_id = ?')
    .all(envId) as unknown as EnvVariableRow[]
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (r.encrypted_value === '') continue
    try {
      out[r.name] = decrypt(r.encrypted_value)
    } catch {
      // 키체인이 바뀌었거나 다른 사용자 계정 — 값 없음으로 둔다.
    }
  }
  return out
}
