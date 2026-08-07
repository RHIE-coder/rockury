import { session } from 'electron'
import type { DownloadDone } from '../shared/downloads'

/**
 * 내려받기의 **끝**을 그 화면에 되쏜다.
 *
 * 렌더러가 `<a download>` 로 시작한 내려받기는 **시작만** 보이고 끝이 안 보인다. 그래서
 * 내보내기 화면이 "내보냈습니다"를 저장 창이 뜨자마자 켜고 있었다 — 사용자가 그 창에서
 * 취소해도 초록으로 남았다(2026-08-07). 끝을 아는 쪽은 메인뿐이라 여기서 알린다.
 *
 * 시작한 창에만 보낸다 — 창이 여럿일 때 남의 내보내기 결과가 이 화면에 뜨면 안 된다.
 */
export function watchDownloads(): void {
  session.defaultSession.on('will-download', (_event, item, webContents) => {
    item.once('done', (_e, state) => {
      if (webContents.isDestroyed()) return
      const done: DownloadDone = { filename: item.getFilename(), state }
      webContents.send('download:done', done)
    })
  })
}
