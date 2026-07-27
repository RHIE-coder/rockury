import { contextBridge } from 'electron'
import { assembleApi, type AssembledApi } from './services'

/**
 * 렌더러에 노출되는 안전한 API 표면 — 서비스별 창구를 조립한 결과다.
 *
 * 창구 자체는 `services/<서비스>.ts` 에 산다(병렬 개발 파일 소유권). 이 파일은
 * **조립과 노출만** 한다 — 새 창구가 생겨도 여기는 안 바뀐다.
 */
const api = assembleApi() as AssembledApi

export type RockuryApi = AssembledApi

// 서비스별 타입 재노출 — 기존 import 경로(`src/preload`)를 그대로 유지한다.
export type {
  DesignRecord,
  CreateDesignInput,
  TableRecord,
  SeedSetRecord,
  EnvVariableInfo,
  VersionRecord,
  CreateVersionInput,
  ConnectionGroupRecord,
  ConnectionRecord,
  ConnectionFormData,
  TestConnectionResult,
  EnvironmentRecord,
  DbType
} from './services/db'

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('rockury', api)
} else {
  ;(globalThis as unknown as { rockury: RockuryApi }).rockury = api
}
