import { describe, expect, it } from 'vitest'
import {
  BADGE_RADIUS,
  FEEDBACK_CHANNEL_MISSING,
  MAX_LOGS,
  appendCapped,
  badgeCenter,
  badgeHit,
  draftFolderName,
  draftShotFileName,
  feedbackFailureMessage,
  feedbackFolderName,
  feedbackKeyAction,
  finalFolderName,
  formatClock,
  formatStamp,
  isDraftFolderName,
  isNoiseComponentName,
  markLabel,
  parseFeedbackPayload,
  probePoints,
  renderNoteMarkdown,
  shotFileName,
  sketchFileName,
  slugifyRoute,
  type FeedbackLocation,
  type FeedbackMark,
  type FeedbackPayload,
  type FeedbackStep
} from './devFeedback'

/**
 * 개발용 화면 피드백의 순수 로직 회귀 테스트.
 * 여기서 지키는 선은 셋이다 — ⑴ 저장이 조용히 덮이거나 폴더 밖으로 새지 않는다,
 * ⑵ note.md 만 읽어도 "어디의 무엇이 왜 불만인지"를 알 수 있다,
 * ⑶ 화면 여럿을 걸친 이야기가 한 화면짜리로 납작해지지 않는다.
 */

function location(over: Partial<FeedbackLocation> = {}): FeedbackLocation {
  return { route: '/db/design/schema', label: 'DB › Design › Schema', context: [], ...over }
}

function step(over: Partial<FeedbackStep> = {}): FeedbackStep {
  return {
    index: 1,
    location: location(),
    viewport: { width: 1440, height: 900 },
    imageFile: 'shot-1.png',
    ...over
  }
}

function mark(over: Partial<FeedbackMark> = {}): FeedbackMark {
  return {
    memo: '여백이 좁다',
    parts: [
      {
        kind: 'shape',
        bounds: { x: 10, y: 20, width: 30, height: 40 },
        target: null,
        step: 1
      }
    ],
    sketchFile: null,
    ...over
  }
}

function payload(over: Partial<FeedbackPayload> = {}): FeedbackPayload {
  const steps = over.steps ?? [step()]
  return { location: steps[0].location, steps, marks: [mark()], logs: [], ...over }
}

/** 렌더러가 보내는 모양(검증 대상). 저장된 것과 갈리는 칸은 그림과 화면 이름뿐이다. */
function input(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    draft: '_draft-20260729-153012-db-design-schema',
    seqs: [1],
    steps: [{ location: location(), viewport: { width: 1440, height: 900 }, hasImage: true }],
    marks: [
      {
        memo: '여백이 좁다',
        sketch: null,
        parts: [{ kind: 'shape', bounds: { x: 10, y: 20, width: 30, height: 40 }, step: 1 }]
      }
    ],
    logs: [],
    ...over
  }
}

/** 1×1 투명 PNG. 그림이 "형식이 맞는가"만 보는 검증에 실물 크기는 필요 없다. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('표시 번호와 배지', () => {
  it('스무 개까지는 동그라미 숫자, 넘으면 괄호 숫자로 떨어진다', () => {
    expect(markLabel(0)).toBe('①')
    expect(markLabel(19)).toBe('⑳')
    expect(markLabel(20)).toBe('(21)')
  })

  it('배지는 표시 영역의 좌상단 모서리에 얹힌다', () => {
    expect(badgeCenter({ x: 100, y: 50, width: 80, height: 40 })).toEqual({
      x: 100 + BADGE_RADIUS,
      y: 50 + BADGE_RADIUS
    })
  })

  it('배지를 누르면 그 표시가 잡히고, 멀리 누르면 아무것도 안 잡힌다', () => {
    const marks = [{ id: 7, parts: [{ bounds: { x: 0, y: 0, width: 50, height: 50 } }] }]
    expect(badgeHit(marks, BADGE_RADIUS, BADGE_RADIUS)).toEqual({ id: 7, part: 0 })
    expect(badgeHit(marks, 300, 300)).toBeNull()
  })

  it('배지가 겹치면 나중에 그린 것이 이긴다 — 화면에서 위에 보이는 것과 같아야 한다', () => {
    const marks = [
      { id: 1, parts: [{ bounds: { x: 0, y: 0, width: 50, height: 50 } }] },
      { id: 2, parts: [{ bounds: { x: 2, y: 2, width: 50, height: 50 } }] }
    ]
    expect(badgeHit(marks, BADGE_RADIUS + 1, BADGE_RADIUS + 1)?.id).toBe(2)
  })

  // 묶음의 표시는 전부 같은 번호를 달고, 어느 것을 눌러도 같은 메모가 열린다.
  it('묶음 안 어느 표시를 눌러도 그 묶음이 잡힌다', () => {
    const marks = [
      {
        id: 5,
        parts: [
          { bounds: { x: 0, y: 0, width: 20, height: 20 } },
          { bounds: { x: 200, y: 200, width: 20, height: 20 } }
        ]
      }
    ]
    expect(badgeHit(marks, 211, 211)).toEqual({ id: 5, part: 1 })
  })

  it('지난 화면의 배지는 안 잡힌다 — 눈에 안 보이는 것을 만지면 유령을 만지는 셈이다', () => {
    const marks = [
      {
        id: 1,
        parts: [
          { bounds: { x: 0, y: 0, width: 20, height: 20 }, screen: 1 },
          { bounds: { x: 100, y: 100, width: 20, height: 20 }, screen: 2 }
        ]
      }
    ]
    expect(badgeHit(marks, 111, 111, 2)).toEqual({ id: 1, part: 1 })
    expect(badgeHit(marks, 11, 11, 2)).toBeNull()
  })
})

describe('요소 찾기 보조', () => {
  it('가운데를 가장 먼저 찔러 본다 — 둘러싸게 그리는 것이 자연스러운 동작이라', () => {
    const [first] = probePoints({ x: 0, y: 0, width: 100, height: 200 })
    expect(first).toEqual([50, 100])
  })

  it('가운데가 빈 자리일 때를 대비해 안쪽 네 점을 더 준다', () => {
    expect(probePoints({ x: 0, y: 0, width: 100, height: 100 })).toHaveLength(5)
  })

  it('배선용 껍데기 컴포넌트 이름은 사슬에서 걸러낸다', () => {
    expect(isNoiseComponentName('NavProvider')).toBe(true)
    expect(isNoiseComponentName('ErrorBoundary')).toBe(true)
    expect(isNoiseComponentName('Fragment')).toBe(true)
    // 소문자로 시작하면 컴포넌트가 아니라 DOM 태그다.
    expect(isNoiseComponentName('div')).toBe(true)
    expect(isNoiseComponentName('SchemaCanvas')).toBe(false)
  })
})

describe('키 판정', () => {
  const key = (
    k: string,
    mods: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}
  ): { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean } => ({
    key: k,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false
  })
  const closed = { open: false, fromOverlay: false }
  const openApp = { open: true, fromOverlay: false }
  const openMemo = { open: true, fromOverlay: true }

  it('⌘/Ctrl+Shift+F 는 열려 있든 닫혀 있든 도구를 여닫는다', () => {
    expect(feedbackKeyAction(key('f', { meta: true, shift: true }), closed)).toBe('toggle')
    // 대문자로 오는 경우(Shift 를 같이 눌렀으니 실제로 이렇게 온다)
    expect(feedbackKeyAction(key('F', { ctrl: true, shift: true }), openApp)).toBe('toggle')
  })

  it('닫혀 있으면 앱의 키를 건드리지 않는다', () => {
    expect(feedbackKeyAction(key('Escape'), closed)).toBe('pass')
    expect(feedbackKeyAction(key('Enter', { meta: true }), closed)).toBe('pass')
    expect(feedbackKeyAction(key('a'), closed)).toBe('pass')
  })

  it('열려 있으면 앱은 키를 못 본다 — 얼린 화면 뒤에서 상태가 바뀌지 않게', () => {
    expect(feedbackKeyAction(key('a'), openApp)).toBe('shield')
    expect(feedbackKeyAction(key('Tab'), openApp)).toBe('shield')
  })

  it('메모창에 친 글자는 그대로 흘려보낸다', () => {
    expect(feedbackKeyAction(key('a'), openMemo)).toBe('pass')
    expect(feedbackKeyAction(key('Backspace'), openMemo)).toBe('pass')
  })

  it('Escape 는 메모창에서 쳤어도 오버레이가 먹는다 — 지적하던 모달이 같이 닫히면 안 된다', () => {
    // 회귀: Radix 겹층은 Escape 를 document 캡처에서 듣는다. 여기서 'pass' 로 새면
    // 메모창을 접으려는 순간 지적 대상이 사라진다(2026-07-30 사용자 제보).
    expect(feedbackKeyAction(key('Escape'), openMemo)).toBe('close')
    expect(feedbackKeyAction(key('Escape'), openApp)).toBe('close')
  })

  it('⌘/Ctrl+Enter 는 메모창 안에서도 보내기다', () => {
    expect(feedbackKeyAction(key('Enter', { meta: true }), openMemo)).toBe('send')
    expect(feedbackKeyAction(key('Enter', { ctrl: true }), openApp)).toBe('send')
    // 맨 Enter 는 메모창이 먹는다(확인).
    expect(feedbackKeyAction(key('Enter'), openMemo)).toBe('pass')
  })
})

describe('콘솔 기록 버퍼', () => {
  it('상한을 넘으면 오래된 것부터 버린다', () => {
    let list: number[] = []
    for (let i = 0; i < 5; i += 1) list = appendCapped(list, i, 3)
    expect(list).toEqual([2, 3, 4])
  })
})

describe('저장 폴더 이름', () => {
  it('경로 구분자와 특수문자를 없애 폴더 밖으로 새지 않게 한다', () => {
    expect(slugifyRoute('/db/design/schema')).toBe('db-design-schema')
    expect(slugifyRoute('/../../etc/passwd')).toBe('etc-passwd')
    expect(slugifyRoute('///')).toBe('root')
  })

  it('초까지 넣어, 같은 화면에서 연달아 남긴 피드백이 서로를 덮지 않는다', () => {
    const a = feedbackFolderName(new Date(2026, 6, 29, 15, 30, 12), '/db/design/schema')
    const b = feedbackFolderName(new Date(2026, 6, 29, 15, 30, 13), '/db/design/schema')
    expect(a).toBe('20260729-153012-db-design-schema')
    expect(a).not.toBe(b)
  })

  it('사람이 읽는 시각은 로컬 시계를 따른다', () => {
    expect(formatStamp(new Date(2026, 6, 29, 9, 5, 3))).toBe('2026-07-29 09:05:03')
    expect(formatClock(new Date(2026, 6, 29, 9, 5, 3))).toBe('09:05:03')
  })
})

describe('쌓는 중인 초안', () => {
  it('초안은 밑줄로 시작한다 — "최신 폴더를 읽는" 습관이 미완성에 낚이지 않게', () => {
    const name = draftFolderName(new Date(2026, 6, 29, 15, 30, 12), '/db/design/schema')
    expect(name).toBe('_draft-20260729-153012-db-design-schema')
  })

  it('최종 이름은 접두어만 뗀다 — 시각은 흐름이 시작한 때로 남는다', () => {
    expect(finalFolderName('_draft-20260729-153012-db-design-schema')).toBe(
      '20260729-153012-db-design-schema'
    )
  })

  // 이 값이 그대로 파일 경로가 된다. 화이트리스트가 유일하게 안전한 길이다.
  it('우리가 지은 모양이 아닌 초안 이름은 거절한다 — 저장 위치가 폴더 밖으로 샌다', () => {
    expect(isDraftFolderName('_draft-20260729-153012-db-design-schema')).toBe(true)
    expect(isDraftFolderName('_draft-../../etc')).toBe(false)
    expect(isDraftFolderName('_draft-20260729-153012-db/design')).toBe(false)
    expect(isDraftFolderName('20260729-153012-db-design-schema')).toBe(false)
    expect(isDraftFolderName(null)).toBe(false)
  })

  // 흐름 순서를 나중에 바꿀 수 있어서, 쌓을 때는 뜬 순서를 쓰고 보낼 때 한 번 고쳐 짓는다.
  it('쌓는 중 이름과 최종 이름을 가른다 — 순서를 바꿔도 이미 쓴 파일을 안 옮긴다', () => {
    expect(draftShotFileName(2)).toBe('screen-2.png')
    expect(shotFileName(1)).toBe('shot-1.png')
  })
})

describe('보낸 내용 검증', () => {
  it('제대로 된 내용은 통과한다', () => {
    expect(parseFeedbackPayload(input()).ok).toBe(true)
  })

  it('화면 위치가 없거나 nav 경로 꼴이 아니면 거절한다', () => {
    expect(parseFeedbackPayload(input({ steps: [{ viewport: { width: 1, height: 1 } }] }))).toEqual({
      ok: false,
      error: '1번째 화면 정보가 잘못됐습니다'
    })
    expect(
      parseFeedbackPayload(
        input({
          steps: [
            {
              location: { route: 'db/design', label: '', context: [] },
              viewport: { width: 1, height: 1 },
              hasImage: true
            }
          ]
        })
      ).ok
    ).toBe(false)
  })

  it('표시가 하나도 없으면 거절한다 — 빈 피드백은 저장할 값이 없다', () => {
    expect(parseFeedbackPayload(input({ marks: [] }))).toEqual({
      ok: false,
      error: '표시가 하나도 없습니다'
    })
  })

  it('묶음이 스무 개를 넘으면 거절한다', () => {
    const one = (input().marks as unknown[])[0]
    expect(parseFeedbackPayload(input({ marks: Array.from({ length: 21 }, () => one) })).ok).toBe(
      false
    )
  })

  it('화면이 열둘을 넘으면 거절한다 — 그쯤이면 말로 적는 편이 낫다', () => {
    const one = (input().steps as unknown[])[0]
    expect(parseFeedbackPayload(input({ steps: Array.from({ length: 13 }, () => one) })).ok).toBe(
      false
    )
  })

  it('표시 영역에 숫자가 아닌 값이 섞이면 거절한다', () => {
    expect(
      parseFeedbackPayload(
        input({ marks: [{ memo: '', parts: [{ bounds: { x: 'a', y: 0, width: 1, height: 1 } }] }] })
      ).ok
    ).toBe(false)
  })

  it('콘솔 로그는 상한까지만 남기고, 모르는 level 은 error 로 본다', () => {
    const logs = Array.from({ length: MAX_LOGS + 5 }, (_, i) => ({
      level: 'nope',
      at: '00:00:00',
      text: `L${i}`
    }))
    const res = parseFeedbackPayload(input({ logs }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.logs).toHaveLength(MAX_LOGS)
    expect(res.value.logs[0]).toEqual({ level: 'error', at: '00:00:00', text: 'L5' })
  })

  it('요소 정보가 깨져 있어도 표시 자체는 살린다 — 좌표만으로도 쓸모가 있다', () => {
    const res = parseFeedbackPayload(
      input({
        marks: [
          {
            memo: 'x',
            parts: [{ bounds: { x: 0, y: 0, width: 1, height: 1 }, target: { tag: 'div' } }]
          }
        ]
      })
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.marks[0].parts[0].target).toBeNull()
  })

  it('갈래를 안 보내는 옛 본문도 받는다 — 그리기만 있던 시절의 표시는 전부 그린 표시다', () => {
    const res = parseFeedbackPayload(
      input({ marks: [{ memo: 'x', parts: [{ bounds: { x: 0, y: 0, width: 1, height: 1 } }] }] })
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.marks[0].parts[0].kind).toBe('shape')
  })

  it('콕 집은 표시는 핀으로 들어온다', () => {
    const res = parseFeedbackPayload(
      input({
        marks: [
          { memo: 'x', parts: [{ kind: 'pin', bounds: { x: 0, y: 0, width: 22, height: 22 } }] }
        ]
      })
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.marks[0].parts[0].kind).toBe('pin')
  })

  // 파일 이름을 렌더러가 정하게 두면 그게 곧 경로 조작 구멍이다.
  it('화면 그림 이름은 검증이 짓는다 — 있었는지만 받는다', () => {
    const res = parseFeedbackPayload(
      input({
        seqs: [1, 2],
        steps: [
          { location: location(), viewport: { width: 1, height: 1 }, hasImage: true },
          {
            location: location({ route: '/db/remote' }),
            viewport: { width: 1, height: 1 },
            hasImage: false
          }
        ]
      })
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.steps.map((s) => s.imageFile)).toEqual(['shot-1.png', null])
  })

  it('없는 단계를 가리키는 표시는 1단계로 떨어진다 — 흐름을 모르던 옛 본문이 그렇다', () => {
    const res = parseFeedbackPayload(
      input({
        marks: [{ memo: 'x', parts: [{ bounds: { x: 0, y: 0, width: 1, height: 1 }, step: 9 }] }]
      })
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.marks[0].parts[0].step).toBe(1)
  })

  it('묶음을 모르던 옛 본문은 표시 하나짜리 묶음으로 읽는다', () => {
    const res = parseFeedbackPayload(
      input({ marks: [{ memo: 'x', kind: 'pin', bounds: { x: 0, y: 0, width: 22, height: 22 } }] })
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.marks[0].parts).toHaveLength(1)
    expect(res.value.marks[0].parts[0].kind).toBe('pin')
  })

  it('폴더 이름의 재료는 첫 화면이다 — 흐름은 거기서 출발했다', () => {
    const res = parseFeedbackPayload(
      input({
        seqs: [1, 2],
        steps: [
          { location: location({ route: '/db/design' }), viewport: { width: 1, height: 1 }, hasImage: true },
          { location: location({ route: '/api/studio' }), viewport: { width: 1, height: 1 }, hasImage: true }
        ]
      })
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.location.route).toBe('/db/design')
  })
})

describe('제안 그림', () => {
  it('번호는 배지 번호와 같은 순서다', () => {
    expect(sketchFileName(0)).toBe('sketch-1.png')
    expect(sketchFileName(2)).toBe('sketch-3.png')
  })

  it('그림이 붙은 묶음만 파일 목록에 오르고, 본문에는 이름만 남는다', () => {
    const one = (input().marks as Record<string, unknown>[])[0]
    const res = parseFeedbackPayload(
      input({ marks: [{ ...one, sketch: null }, { ...one, sketch: TINY_PNG }] })
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sketches).toEqual([{ file: 'sketch-2.png', dataUrl: TINY_PNG }])
    expect(res.value.marks[0].sketchFile).toBeNull()
    expect(res.value.marks[1].sketchFile).toBe('sketch-2.png')
    // 그림 자체(base64)는 본문에 안 담는다 — 담으면 note.json 이 사람이 못 여는 크기가 된다.
    expect(JSON.stringify(res.value)).not.toContain('base64')
  })

  it('형식이 틀리면 조용히 버리지 않고 거절한다 — 그렸는데 파일이 없으면 원인을 못 찾는다', () => {
    const one = (input().marks as Record<string, unknown>[])[0]
    const res = parseFeedbackPayload(
      input({ marks: [{ ...one, sketch: 'data:image/jpeg;base64,AAAA' }] })
    )
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('①')
  })

  it('상한을 넘는 그림은 거절한다 — 무한정 받아 메모리를 밀어내지 않게', () => {
    const one = (input().marks as Record<string, unknown>[])[0]
    const huge = `data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}`
    expect(parseFeedbackPayload(input({ marks: [{ ...one, sketch: huge }] })).ok).toBe(false)
  })
})

describe('저장 실패 안내', () => {
  // 회귀 — 실패했는데 화면에 아무 말도 안 나오면 "보내기가 안 먹는다"로 보인다(2026-07-29 실측).
  it('통로가 없을 때는 앱을 다시 띄우라고 말한다 — "저장 실패"만으로는 다시 그리게 만든다', () => {
    expect(feedbackFailureMessage(new Error("No handler registered for 'shell:saveDevFeedback'"))).toBe(
      FEEDBACK_CHANNEL_MISSING
    )
    expect(feedbackFailureMessage(new TypeError('window.rockury.devFeedback.step is not a function'))).toBe(
      FEEDBACK_CHANNEL_MISSING
    )
  })

  it('그 밖의 실패는 원문을 보여 주고, 표시가 남아 있다는 것을 알린다', () => {
    const msg = feedbackFailureMessage(new Error('EACCES: permission denied'))
    expect(msg).toContain('EACCES: permission denied')
    expect(msg).toContain('다시 보내')
  })

  it('Error 가 아닌 것이 던져져도 문자열로 만든다', () => {
    expect(feedbackFailureMessage('그냥 문자열')).toContain('그냥 문자열')
  })
})

describe('note.md — 화면 하나', () => {
  const at = new Date(2026, 6, 29, 15, 30, 12)

  it('메모·좌표·컴포넌트·컨텍스트를 한 파일에서 다 읽을 수 있다', () => {
    const md = renderNoteMarkdown(
      payload({
        steps: [step({ location: location({ context: [{ label: 'Design', value: '주문 도메인' }] }) })],
        marks: [
          mark({
            memo: '버튼이 잘린다',
            parts: [
              {
                kind: 'shape',
                bounds: { x: 10.4, y: 20.6, width: 30, height: 40 },
                step: 1,
                target: {
                  tag: 'button',
                  className: 'rounded px-2',
                  testId: 'save-btn',
                  text: '저장',
                  cssPath: 'div > button',
                  components: ['SaveButton', 'SchemaToolbar'],
                  rect: { x: 10, y: 20, width: 30, height: 40 }
                }
              }
            ]
          })
        ]
      }),
      { at, sourceRoot: '/Users/me/rockury' }
    )
    expect(md).toContain('# 화면 피드백 · DB › Design › Schema')
    expect(md).toContain('- 남긴 시각: 2026-07-29 15:30:12')
    expect(md).toContain('- Design: 주문 도메인')
    expect(md).toContain('- 소스 폴더: `/Users/me/rockury`')
    expect(md).toContain('## ① 버튼이 잘린다')
    expect(md).toContain('- 컴포넌트: SaveButton ‹ SchemaToolbar')
    expect(md).toContain('- 테스트 아이디: `save-btn`')
    // 소수점 좌표는 반올림해 보여 준다 — 읽는 사람에게 0.4px 은 의미가 없다.
    expect(md).toContain('x=10 y=21')
  })

  // 대부분이 화면 하나짜리다. 거기에 흐름 절과 단계 꼬리표를 붙이면 흔한 경우가 되레 읽기 나빠진다.
  it('화면이 하나뿐이면 흐름 절도 단계 꼬리표도 안 붙는다', () => {
    const md = renderNoteMarkdown(payload(), { at })
    expect(md).not.toContain('## 흐름')
    expect(md).not.toContain('단계 ')
    expect(md).toContain('- 화면 이미지: shot-1.png')
  })

  it('캡처가 실패했으면 "이미지 없음"을 분명히 적는다 — 조용히 빠지면 없는 그림을 찾게 된다', () => {
    const md = renderNoteMarkdown(payload({ steps: [step({ imageFile: null })] }), { at })
    expect(md).toContain('화면 이미지: 없음')
  })

  it('메모를 안 적었으면 그렇다고 적는다', () => {
    expect(renderNoteMarkdown(payload({ marks: [mark({ memo: '   ' })] }), { at })).toContain(
      '## ① (메모 없음)'
    )
  })

  // 안 밝히면 배지 지름(22px)이 "이만한 영역이 문제"로 읽힌다 — 핀의 뜻은 한 점이다.
  it('핀은 영역이 아니라 한 점이라고 밝힌다', () => {
    const md = renderNoteMarkdown(
      payload({
        marks: [
          mark({
            memo: '여기',
            parts: [
              { kind: 'pin', bounds: { x: 89, y: 189, width: 22, height: 22 }, target: null, step: 1 }
            ]
          })
        ]
      }),
      { at }
    )
    expect(md).toContain('- 콕 집은 자리: x=100 y=200')
    expect(md).not.toContain('표시한 영역')
  })

  it('제안 그림이 있으면 그 파일을 가리킨다 — 없으면 그 줄 자체가 없다', () => {
    expect(
      renderNoteMarkdown(payload({ marks: [mark({ sketchFile: 'sketch-1.png' })] }), { at })
    ).toContain('- 제안 그림: sketch-1.png')
    expect(renderNoteMarkdown(payload(), { at })).not.toContain('제안 그림')
  })

  it('콘솔 오류가 있으면 뒤에 붙는다', () => {
    const md = renderNoteMarkdown(
      payload({ logs: [{ level: 'error', at: '15:30:01', text: 'boom\nat foo' }] }),
      { at }
    )
    expect(md).toContain('## 콘솔 (피드백 직전까지)')
    expect(md).toContain('`15:30:01` **error** boom ⏎ at foo')
  })

  it('콘솔이 조용했으면 그 절은 아예 없다', () => {
    expect(renderNoteMarkdown(payload(), { at })).not.toContain('## 콘솔')
  })
})

describe('note.md — 묶음(메모 하나가 표시 여럿을 덮는다)', () => {
  const at = new Date(2026, 6, 29, 15, 30, 12)

  const grouped = mark({
    memo: '이 카드를 저 목록으로',
    parts: [
      { kind: 'shape', bounds: { x: 0, y: 0, width: 40, height: 40 }, target: null, step: 1 },
      { kind: 'pin', bounds: { x: 100, y: 100, width: 22, height: 22 }, target: null, step: 1 }
    ]
  })

  // 안 밝히면 화살표 하나에 대한 메모로 읽히고, 같이 가리킨 나머지가 딴 이야기로 떨어져 나간다.
  it('표시가 여럿이면 "한 요청"임을 먼저 밝히고 번호를 매겨 단다', () => {
    const md = renderNoteMarkdown(payload({ marks: [grouped] }), { at })
    expect(md).toContain('## ① 이 카드를 저 목록으로')
    expect(md).toContain('아래 표시 2개가 **한 요청**이다')
    expect(md).toContain('- 1) 표시한 영역')
    expect(md).toContain('- 2) 콕 집은 자리')
  })

  it('표시가 하나뿐이면 예전 그대로 평평하게 적는다 — 흔한 경우에 군더더기를 안 붙인다', () => {
    const md = renderNoteMarkdown(payload(), { at })
    expect(md).not.toContain('한 요청')
    expect(md).not.toContain('- 1) ')
  })
})

describe('note.md — 흐름(화면 여럿을 걸친 한 이야기)', () => {
  const at = new Date(2026, 6, 29, 15, 30, 12)

  const twoScreens = payload({
    steps: [
      step({ index: 1, location: location({ label: 'DB › Design', route: '/db/design' }) }),
      step({
        index: 2,
        location: location({ label: 'DB › Remote', route: '/db/remote' }),
        imageFile: 'shot-2.png'
      })
    ],
    marks: [
      mark({
        memo: '여기서 저장하면 저기에 안 나온다',
        parts: [
          { kind: 'pin', bounds: { x: 0, y: 0, width: 22, height: 22 }, target: null, step: 1 },
          { kind: 'pin', bounds: { x: 50, y: 50, width: 22, height: 22 }, target: null, step: 2 }
        ]
      })
    ]
  })

  it('흐름 절이 맨 먼저 오고, 화면마다 그림과 표시가 적힌다', () => {
    const md = renderNoteMarkdown(twoScreens, { at })
    expect(md).toContain('# 화면 피드백 · DB › Design 외 화면 1개')
    expect(md).toContain('## 흐름 (화면 2개)')
    expect(md).toContain('1. DB › Design `/db/design` · shot-1.png')
    expect(md).toContain('2. DB › Remote `/db/remote` · shot-2.png')
    // 흐름 절이 첫 묶음보다 앞에 온다 — 순서가 곧 이야기다.
    expect(md.indexOf('## 흐름')).toBeLessThan(md.indexOf('## ①'))
  })

  it('표시마다 몇 단계 것인지 꼬리표가 붙는다 — 다른 단계 좌표를 같은 그림에서 찾지 않게', () => {
    const md = renderNoteMarkdown(twoScreens, { at })
    expect(md).toContain('[1단계 DB › Design]')
    expect(md).toContain('[2단계 DB › Remote]')
  })

  it('화면을 걸친 묶음은 그 사실을 밝힌다', () => {
    expect(renderNoteMarkdown(twoScreens, { at })).toContain('**화면 2개에 걸쳐 있다**')
  })

  it('표시가 없는 화면도 흐름에 그대로 적는다 — 조용히 빠지면 이야기에 구멍이 난다', () => {
    const md = renderNoteMarkdown(
      payload({
        steps: [step({ index: 1 }), step({ index: 2, imageFile: 'shot-2.png' })],
        marks: [mark()]
      }),
      { at }
    )
    expect(md).toContain('· (표시 없음)')
  })

  it('화면마다 컨텍스트 바 선택값이 따로 실린다 — 같은 화면도 무엇을 보고 있었는지로 갈린다', () => {
    const md = renderNoteMarkdown(
      payload({
        steps: [
          step({ index: 1, location: location({ context: [{ label: 'Design', value: '주문' }] }) }),
          step({
            index: 2,
            imageFile: 'shot-2.png',
            location: location({ context: [{ label: 'Design', value: '결제' }] })
          })
        ]
      }),
      { at }
    )
    expect(md).toContain('Design: 주문')
    expect(md).toContain('Design: 결제')
  })
})
