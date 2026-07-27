import { registerWindowIpc } from './window'
import { registerUiuxIpc } from './uiux'
import { registerApiIpc } from './api'
import { registerDbIpc } from './db'
import { registerInfraIpc } from './infra'
import { registerAiIpc } from './ai'

/**
 * 서비스별 IPC 등록부 — 순서는 `nav/registry.ts` 의 서비스 순서를 따른다.
 *
 * `src/main/index.ts` 가 이 배열을 순회하므로, **새 채널을 만들 때 진입점을 건드릴 일이 없다.**
 * 이 배열 자체는 새 서비스를 만들 때만 바뀐다(병렬 개발 충돌 지점 제거).
 */
export const SERVICE_IPC: { service: string; register: () => void }[] = [
  { service: 'uiux', register: registerUiuxIpc },
  { service: 'api', register: registerApiIpc },
  { service: 'db', register: registerDbIpc },
  { service: 'infra', register: registerInfraIpc },
  { service: 'ai', register: registerAiIpc }
]

/**
 * 앱이 쓰는 IPC 채널 전부를 등록한다.
 * 창 제어(`window:*`)는 어느 서비스에도 안 속하는 셸 기능이라 서비스 순회 밖에서 먼저 건다.
 */
export function registerAllIpc(): void {
  registerWindowIpc()
  for (const s of SERVICE_IPC) s.register()
}
