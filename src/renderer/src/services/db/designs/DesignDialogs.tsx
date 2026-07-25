import { CreateDesignDialog } from './CreateDesignDialog'
import { ManageDesignsDialog } from './ManageDesignsDialog'
import { VersionSync } from '../versions/VersionSync'
import { ConnectionDialog } from '../connections/ConnectionDialog'
import { ImportDialog } from '../migration/ImportDialog'
import { BindingsDialog } from '../connections/BindingsDialog'

/** DB 서비스 전역 오버레이 — 설계 생성/관리 모달 + 버전 렌즈 동기화 + 연결/바인딩/가져오기 다이얼로그.
 *  (연결 옵션은 connections/store 가 직접 주입 — 별도 Sync 불필요.) */
export function DesignDialogs() {
  return (
    <>
      <CreateDesignDialog />
      <ManageDesignsDialog />
      <VersionSync />
      <ConnectionDialog />
      <ImportDialog />
      <BindingsDialog />
    </>
  )
}
