import { CreateDesignDialog } from './CreateDesignDialog'
import { ManageDesignsDialog } from './ManageDesignsDialog'
import { VersionSync } from '../versions/VersionSync'
import { EnvSync } from '../environments/EnvSync'
import { EnvironmentDialog } from '../environments/EnvironmentDialog'

/** DB 서비스 전역 오버레이 — 설계 생성/관리 모달 + 버전 렌즈·Env 옵션 동기화 + 환경 다이얼로그. */
export function DesignDialogs() {
  return (
    <>
      <CreateDesignDialog />
      <ManageDesignsDialog />
      <VersionSync />
      <EnvSync />
      <EnvironmentDialog />
    </>
  )
}
