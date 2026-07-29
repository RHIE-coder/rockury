import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { envelope } from './envelope'
import { feedbackFolderName, parseFeedbackPayload, renderNoteMarkdown } from '../../shared/devFeedback'

/** 이 빌드가 나온 소스 루트 (electron.vite.config.ts 가 박아 넣는다). */
declare const __SOURCE_ROOT__: string

/**
 * 개발용 화면 피드백 저장 — 어느 서비스에도 속하지 않는 개발 도구다(창 제어와 같은 자리).
 *
 * 화면에 그린 표시와 메모를 소스 폴더의 `.harness/feedback/<시각>-<화면>/` 아래에 떨군다.
 * 에이전트는 그 폴더만 읽으면 어떤 요소가 왜 불만인지 바로 안다 —
 * 사람이 스크린샷을 떠서 붙여 넣는 왕복을 없애는 것이 이 도구의 목적이다.
 *
 * 두 가지가 의도적이다:
 *  (1) 배포본에서는 거절한다. 인증 없이 파일을 쓰는 통로라 개발 밖으로 나가면 안 된다.
 *      (렌더러 오버레이 자체도 개발 서버에서만 뜨지만, 통로 쪽에도 자물쇠를 둔다.)
 *  (2) 저장 위치의 기준은 `process.cwd()` 가 아니라 **빌드된 소스 루트**다. 병렬 개발에서
 *      다섯 워크트리가 각자 앱을 띄우므로, 피드백은 그 앱을 만든 폴더로 가야 한다.
 */

const FEEDBACK_ROOT = join(__SOURCE_ROOT__, '.harness', 'feedback')

/** 화면 이미지를 뜬다. 실패해도 null 로 삼키고 표시·메모는 그대로 저장한다. */
async function capturePng(win: BrowserWindow | null): Promise<Buffer | null> {
  if (!win) return null
  try {
    const image = await win.webContents.capturePage()
    // 창이 최소화·가려짐 상태면 빈 이미지가 온다. 그걸 저장하면 "왜 검은 화면이지"로 헤맨다.
    if (image.isEmpty()) return null
    return image.toPNG()
  } catch (err) {
    console.warn('[dev-feedback] 화면 캡처 실패', err)
    return null
  }
}

export function registerDevFeedbackIpc(): void {
  ipcMain.handle('shell:saveDevFeedback', async (event, raw: unknown) =>
    envelope(async () => {
      if (app.isPackaged) throw new Error('개발 전용 기능입니다.')

      const parsed = parseFeedbackPayload(raw)
      if (!parsed.ok) throw new Error(parsed.error)

      const png = await capturePng(BrowserWindow.fromWebContents(event.sender))
      const at = new Date()
      const folder = feedbackFolderName(at, parsed.value.location.route)
      const dir = join(FEEDBACK_ROOT, folder)

      await mkdir(dir, { recursive: true })
      if (png) await writeFile(join(dir, 'shot.png'), png)
      await writeFile(
        join(dir, 'note.md'),
        renderNoteMarkdown(parsed.value, {
          at,
          imageFile: png ? 'shot.png' : null,
          sourceRoot: __SOURCE_ROOT__
        }),
        'utf8'
      )
      await writeFile(join(dir, 'note.json'), JSON.stringify(parsed.value, null, 2), 'utf8')

      const saved = `.harness/feedback/${folder}`
      // 개발 서버 터미널에도 남긴다 — 앱을 띄워 둔 채로 경로를 바로 집어갈 수 있게.
      console.log(`[dev-feedback] ${saved} 에 저장했습니다`)
      return { folder, saved, hasImage: png !== null }
    })
  )
}
