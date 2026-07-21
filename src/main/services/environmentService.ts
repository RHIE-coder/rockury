import {
  ensureBinding,
  findBinding,
  getEnvironment,
  setAppliedVersion,
  setTargetVersion,
  type EnvironmentRecord
} from '../store/environments'

/**
 * Environment 서비스(§IA · 결정 B) — (connection × design) 바인딩 상태.
 * Migration 이 진입 시 바인딩을 확보하고, 타깃/적용 버전을 갱신한다.
 * 접속·연결 테스트는 connectionService 담당(관심사 분리).
 */
export const environmentService = {
  get(id: string): EnvironmentRecord | null {
    return getEnvironment(id)
  },

  find(connectionId: string, designId: string): EnvironmentRecord | null {
    return findBinding(connectionId, designId)
  },

  /** (connection, design) 바인딩 확보(없으면 생성). 타깃 버전을 함께 지정 가능. */
  ensure(connectionId: string, designId: string, targetVersion = ''): EnvironmentRecord {
    return ensureBinding(connectionId, designId, targetVersion)
  },

  setTarget(id: string, version: string): EnvironmentRecord {
    if (!getEnvironment(id)) throw new Error(`환경 바인딩을 찾을 수 없습니다: ${id}`)
    return setTargetVersion(id, version)
  },

  /** 반영 성공 시 적용 버전 갱신(§ops-plan Phase 3 — 지상 진실은 로컬 DB 기록). */
  setApplied(id: string, version: string): EnvironmentRecord {
    if (!getEnvironment(id)) throw new Error(`환경 바인딩을 찾을 수 없습니다: ${id}`)
    return setAppliedVersion(id, version)
  }
}
