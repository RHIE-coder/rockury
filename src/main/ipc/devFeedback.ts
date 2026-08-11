import { app, BrowserWindow, ipcMain, nativeImage } from 'electron'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { envelope } from './envelope'
import {
  DRAFT_PREFIX,
  MAX_STEPS,
  PNG_DATA_URL_PREFIX,
  draftFolderName,
  draftShotFileName,
  finalFolderName,
  isDraftFolderName,
  parseFeedbackPayload,
  parseLocation,
  renderNoteMarkdown,
  shotFileName,
  type FeedbackStepResult,
  type SaveFeedbackResult
} from '../../shared/devFeedback'

/** 이 빌드가 나온 소스 루트 (electron.vite.config.ts 가 박아 넣는다). */
declare const __SOURCE_ROOT__: string

/**
 * 개발용 화면 피드백 저장 — 어느 서비스에도 속하지 않는 개발 도구다(창 제어와 같은 자리).
 *
 * 화면에 그린 표시와 메모를 소스 폴더의 `.harness/feedback/<시각>-<화면>/` 아래에 떨군다.
 * 에이전트는 그 폴더만 읽으면 어떤 요소가 왜 불만인지 바로 안다 —
 * 사람이 스크린샷을 떠서 붙여 넣는 왕복을 없애는 것이 이 도구의 목적이다.
 *
 * 세 가지가 의도적이다:
 *  (1) 배포본에서는 거절한다. 인증 없이 파일을 쓰는 통로라 개발 밖으로 나가면 안 된다.
 *      (렌더러 오버레이 자체도 개발 서버에서만 뜨지만, 통로 쪽에도 자물쇠를 둔다.)
 *  (2) 저장 위치의 기준은 `process.cwd()` 가 아니라 **빌드된 소스 루트**다. 병렬 개발에서
 *      다섯 워크트리가 각자 앱을 띄우므로, 피드백은 그 앱을 만든 폴더로 가야 한다.
 *  (3) **화면을 굳힐 때마다 바로 쓴다**(초안 폴더). 화면 여럿을 도는 동안 렌더러가 다시
 *      그려지면 — 개발 중엔 코드를 저장할 때마다 그렇다 — 메모리에 든 것은 통째로
 *      날아간다. 쌓아 두면 그걸 넘겨도 살아남고, 화면 그림 여러 장을 렌더러가 들고
 *      다니지 않아도 된다.
 */

const FEEDBACK_ROOT = join(__SOURCE_ROOT__, '.harness', 'feedback')
/** 이보다 오래 방치된 초안은 버려진 것으로 본다(앱을 그냥 끈 경우). */
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
/**
 * 훑어보기 썸네일의 가로 픽셀. 화면에는 절반 크기로 깔린다 — 고해상도 화면에서 뭉개지지
 * 않을 만큼만 크게 잡았다. 원본(창 전체)을 그대로 넘기면 화면 열둘이 수십 MB가 된다.
 */
const THUMB_WIDTH = 320

/** 데이터 URL 의 base64 부분만 잘라 파일로 쓸 바이트를 만든다. */
function pngBytes(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(PNG_DATA_URL_PREFIX.length), 'base64')
}

function devOnly(): void {
  if (app.isPackaged) throw new Error('개발 전용 기능입니다.')
}

/** 초안 폴더의 절대 경로. 이름 모양을 이미 확인한 값만 들어온다. */
function draftDir(folder: string): string {
  return join(FEEDBACK_ROOT, folder)
}

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

/**
 * 하루 넘게 방치된 초안을 치운다. 앱을 그냥 끄면 초안이 남는데, 쌓이면 "피드백 봐줘"가
 * 볼 폴더 목록이 지저분해진다. 실패해도 넘어간다 — 청소 때문에 지금 남기는 피드백을
 * 잃으면 본말이 뒤집힌다.
 */
async function sweepStaleDrafts(now: number): Promise<void> {
  try {
    const entries = await readdir(FEEDBACK_ROOT, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(DRAFT_PREFIX)) continue
      const dir = join(FEEDBACK_ROOT, entry.name)
      const info = await stat(dir)
      if (now - info.mtimeMs > DRAFT_TTL_MS) await rm(dir, { recursive: true, force: true })
    }
  } catch {
    /* 폴더가 아직 없거나 읽을 수 없으면 치울 것도 없다 */
  }
}

export function registerDevFeedbackIpc(): void {
  /**
   * 화면 한 장을 초안에 굳힌다. 첫 화면이면 초안 폴더를 새로 판다.
   *
   * 그림 이름은 **뜬 순서**(`screen-N.png`)를 따른다. 흐름 순서는 나중에 바뀔 수 있어서,
   * 여기서 차례에 맞춰 이름을 지으면 순서를 바꿀 때마다 이미 쓴 파일을 옮겨야 한다.
   */
  ipcMain.handle('shell:devFeedbackStep', async (event, raw: unknown) =>
    envelope(async (): Promise<FeedbackStepResult> => {
      devOnly()

      const input = raw as { draft?: unknown; seq?: unknown; location?: unknown } | null
      const location = parseLocation(input?.location)
      if (!location) throw new Error('화면 위치(location)가 없습니다')

      const seq = input?.seq
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1 || seq > MAX_STEPS) {
        throw new Error('화면 번호가 잘못됐습니다')
      }

      let folder: string
      if (input?.draft == null) {
        folder = draftFolderName(new Date(), location.route)
      } else if (isDraftFolderName(input.draft)) {
        folder = input.draft
      } else {
        throw new Error('초안 이름이 잘못됐습니다')
      }

      const png = await capturePng(BrowserWindow.fromWebContents(event.sender))
      const dir = draftDir(folder)
      await mkdir(dir, { recursive: true })
      if (png) await writeFile(join(dir, draftShotFileName(seq)), png)

      return { draft: folder, hasImage: png !== null }
    })
  )

  /**
   * 초안을 끝내 최종 폴더로 만든다.
   *
   * 이때 화면 그림을 **흐름 순서로 다시 이름 짓는다**(`screen-2.png` → `shot-1.png`).
   * 접두어가 달라 서로 덮어쓸 일이 없다. 폴더를 열었을 때 파일 이름만 보고 순서를 알게
   * 하는 것이 이 도구의 값이라, 이 한 번의 정리는 값을 한다.
   */
  ipcMain.handle('shell:saveDevFeedback', async (_event, raw: unknown) =>
    envelope(async (): Promise<SaveFeedbackResult> => {
      devOnly()

      const body = raw as { draft?: unknown; seqs?: unknown } | null
      if (!isDraftFolderName(body?.draft)) throw new Error('초안 이름이 잘못됐습니다')
      const dir = draftDir(body.draft)

      const parsed = parseFeedbackPayload(raw)
      if (!parsed.ok) throw new Error(parsed.error)

      // 렌더러가 준 화면 순서를 그림 파일 이름에 반영한다. `seqs[i]` 가 i+1단계의 뜬 순서.
      const seqs = Array.isArray(body.seqs) ? body.seqs : []
      if (seqs.length !== parsed.value.steps.length) throw new Error('화면 순서가 맞지 않습니다')

      const at = new Date()
      const finalFolder = finalFolderName(body.draft)
      const finalDir = join(FEEDBACK_ROOT, finalFolder)

      for (const [i, seq] of seqs.entries()) {
        if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) {
          throw new Error('화면 순서가 잘못됐습니다')
        }
        const step = parsed.value.steps[i]
        if (!step.imageFile) continue
        try {
          await rename(join(dir, draftShotFileName(seq)), join(dir, shotFileName(i + 1)))
        } catch (err) {
          // 그림 한 장이 없어졌다고(청소됐거나 손으로 지웠거나) 피드백을 통째로 버리지 않는다.
          // 좌표와 요소만으로도 값이 있고, 그게 이 도구의 본체다. 대신 있는 척은 안 한다.
          console.warn('[dev-feedback] 화면 그림을 못 찾았습니다', step.location.route, err)
          step.imageFile = null
        }
      }
      // 제안 그림 — 이름은 검증이 정했다(묶음 번호와 같은 순서). note.json 엔 이름만 남는다.
      for (const sketch of parsed.sketches) {
        await writeFile(join(dir, sketch.file), pngBytes(sketch.dataUrl))
      }
      await writeFile(
        join(dir, 'note.md'),
        renderNoteMarkdown(parsed.value, { at, sourceRoot: __SOURCE_ROOT__ }),
        'utf8'
      )
      await writeFile(join(dir, 'note.json'), JSON.stringify(parsed.value, null, 2), 'utf8')
      // 이름 바꾸기가 마지막이다. 앞이 실패하면 초안으로 남아 다시 시도할 수 있고,
      // 반쯤 쓰인 폴더가 완성된 피드백인 척 목록에 서지 않는다.
      await rename(dir, finalDir)

      await sweepStaleDrafts(at.getTime())

      const saved = `.harness/feedback/${finalFolder}`
      // 개발 서버 터미널에도 남긴다 — 앱을 띄워 둔 채로 경로를 바로 집어갈 수 있게.
      console.log(`[dev-feedback] ${saved} 에 저장했습니다`)
      return {
        folder: finalFolder,
        saved,
        missingImages: parsed.value.steps.filter((s) => s.imageFile === null).length
      }
    })
  )

  /**
   * 초안에 쌓아 둔 화면 그림을 **작게 줄여** 돌려준다 — 훑어보기 목록에 깔 썸네일.
   *
   * 왜 렌더러가 들고 다니지 않나: 그림은 굳힐 때 이미 파일로 나갔고(초안 폴더), 개발 중엔
   * 화면이 수시로 다시 그려져 메모리에 든 것은 어차피 날아간다. 볼 때 다시 읽는 편이
   * 이어받기(sessionStorage)에 수십 MB 를 얹지 않는 유일한 길이다.
   */
  ipcMain.handle('shell:devFeedbackShot', async (_event, raw: unknown) =>
    envelope(async (): Promise<string | null> => {
      devOnly()

      const input = raw as { draft?: unknown; seq?: unknown } | null
      if (!isDraftFolderName(input?.draft)) throw new Error('초안 이름이 잘못됐습니다')
      const seq = input.seq
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1 || seq > MAX_STEPS) {
        throw new Error('화면 번호가 잘못됐습니다')
      }

      // 그림 한 장을 못 읽는다고 훑어보기가 죽지는 않는다 — 목록의 본체는 메모와 요소다.
      const image = nativeImage.createFromPath(join(draftDir(input.draft), draftShotFileName(seq)))
      if (image.isEmpty()) return null
      return image.resize({ width: THUMB_WIDTH, quality: 'good' }).toDataURL()
    })
  )

  /** 그만뒀다. 쌓아 둔 초안을 지운다 — 안 지우면 미완성이 목록에 남는다. */
  ipcMain.handle('shell:devFeedbackDiscard', async (_event, draft: unknown) =>
    envelope(async () => {
      devOnly()
      if (!isDraftFolderName(draft)) throw new Error('초안 이름이 잘못됐습니다')
      await rm(draftDir(draft), { recursive: true, force: true })
    })
  )
}
