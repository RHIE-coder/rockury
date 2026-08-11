import { CreateDesignDialog } from './CreateDesignDialog'
import { ManageDesignsDialog } from './ManageDesignsDialog'
import { SchemasDialog } from './SchemasDialog'
import { VersionSync } from '../versions/VersionSync'
import { RestoreDraftDialog } from '../versions/RestoreDraftDialog'
import { ConnectionDialog } from '../connections/ConnectionDialog'
import { ImportDialog } from '../migration/ImportDialog'
import { BindingsDialog } from '../connections/BindingsDialog'

/** DB 서비스 전역 오버레이 — 설계 생성/관리 모달 + 버전 렌즈 동기화 + 연결/바인딩/가져오기/되돌리기 다이얼로그.
 *  (되돌리기는 Timeline·Definition 배너 두 곳에서 열리므로 화면이 아니라 여기 붙는다.)
 *  (연결 옵션은 connections/store 가 직접 주입 — 별도 Sync 불필요.) */
export function DesignDialogs() {
  return (
    <>
      <CreateDesignDialog />
      <ManageDesignsDialog />
      <SchemasDialog />
      <VersionSync />
      <ConnectionDialog />
      <ImportDialog />
      <BindingsDialog />
      <RestoreDraftDialog />
    </>
  )
}
