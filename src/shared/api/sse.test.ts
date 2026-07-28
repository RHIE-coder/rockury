import { describe, expect, it } from 'vitest'
import { SseParser } from './sse'

/**
 * TestPlan: api-runner · Scenario S5 — 스트림 프레임 파싱
 * (CASE-apirunner-041 의 밑돌: 타임라인에 들어갈 항목이 여기서 만들어진다)
 *
 * SSE 는 "줄 단위 텍스트"라 대충 `split('\n\n')` 로도 되는 것처럼 보인다. 안 된다 —
 * 청크 경계가 프레임 한가운데를 자르고, 줄바꿈이 세 종류이며, `data:` 는 누적이다.
 * 여기서 틀리면 화면이 **조용히 메시지를 잃는다**.
 */

/** 여러 청크를 순서대로 먹이고 나온 이벤트를 전부 모은다. */
function feedAll(chunks: string[]): ReturnType<SseParser['feed']> {
  const p = new SseParser()
  return chunks.flatMap((c) => p.feed(c))
}

describe('SseParser', () => {
  it('빈 줄이 와야 이벤트가 나간다 — 그 전까지는 아무것도 안 준다', () => {
    const p = new SseParser()
    expect(p.feed('data: hello\n')).toEqual([])
    expect(p.feed('\n')).toEqual([{ event: 'message', data: 'hello', id: null, retry: null }])
  })

  it('청크가 프레임 한가운데를 잘라도 이어 붙인다', () => {
    // 실제 소켓은 프레임 경계로 안 끊긴다 — 이걸 못 버티면 메시지가 통째로 사라진다.
    expect(feedAll(['data: he', 'llo wor', 'ld\n\n'])).toEqual([
      { event: 'message', data: 'hello world', id: null, retry: null }
    ])
  })

  it('data 여러 줄은 줄바꿈으로 이어지고 마지막 줄바꿈은 뺀다', () => {
    expect(feedAll(['data: a\ndata: b\n\n'])).toEqual([
      { event: 'message', data: 'a\nb', id: null, retry: null }
    ])
  })

  it('event · id · retry 를 각각 읽는다', () => {
    expect(feedAll(['event: tick\nid: 7\nretry: 2500\ndata: {"n":1}\n\n'])).toEqual([
      { event: 'tick', data: '{"n":1}', id: '7', retry: 2500 }
    ])
  })

  it('id 는 다음 이벤트까지 유지되고 event 는 매번 초기화된다 (SSE 규약)', () => {
    const out = feedAll(['id: 7\nevent: tick\ndata: a\n\n', 'data: b\n\n'])
    expect(out).toEqual([
      { event: 'tick', data: 'a', id: '7', retry: null },
      // event 는 안 물려받아 'message' 로 돌아가고, id 는 물려받는다.
      { event: 'message', data: 'b', id: '7', retry: null }
    ])
  })

  it('줄바꿈 세 종류(LF · CRLF · CR)를 모두 줄 끝으로 본다', () => {
    expect(feedAll(['data: a\r\n\r\n'])).toEqual([
      { event: 'message', data: 'a', id: null, retry: null }
    ])
    expect(feedAll(['data: b\r\r'])).toEqual([
      { event: 'message', data: 'b', id: null, retry: null }
    ])
  })

  it('CRLF 가 청크 사이에서 갈려도 빈 줄을 두 번 세지 않는다', () => {
    // '\r' 로 끝난 청크 다음에 '\n' 이 오면 같은 줄바꿈이다 — 두 줄로 세면 프레임이 두 쪽 난다.
    expect(feedAll(['data: a\r', '\n\r\n'])).toEqual([
      { event: 'message', data: 'a', id: null, retry: null }
    ])
  })

  it('주석(`:` 로 시작하는 줄)은 버린다 — 하트비트가 메시지로 둔갑하지 않는다', () => {
    expect(feedAll([': keep-alive\n\ndata: real\n\n'])).toEqual([
      { event: 'message', data: 'real', id: null, retry: null }
    ])
  })

  it('data 없는 프레임은 이벤트를 만들지 않는다 (SSE 규약)', () => {
    expect(feedAll(['event: ping\n\n'])).toEqual([])
  })

  it('값 앞 공백 하나만 벗기고 나머지 공백은 원문으로 둔다', () => {
    expect(feedAll(['data:  두칸\n\n'])).toEqual([
      { event: 'message', data: ' 두칸', id: null, retry: null }
    ])
  })

  it('콜론 없는 줄은 값이 빈 필드로 읽는다 (모르는 구문이라고 프레임을 버리지 않는다)', () => {
    expect(feedAll(['data\ndata: x\n\n'])).toEqual([
      // 첫 줄은 값이 빈 data → 빈 줄 하나가 누적된다.
      { event: 'message', data: '\nx', id: null, retry: null }
    ])
  })

  it('규약에 없는 필드는 조용히 무시한다 — 다만 그것 때문에 프레임을 잃지는 않는다', () => {
    expect(feedAll(['weird: 1\ndata: ok\n\n'])).toEqual([
      { event: 'message', data: 'ok', id: null, retry: null }
    ])
  })

  it('retry 가 숫자가 아니면 값을 지어내지 않고 null 로 둔다', () => {
    expect(feedAll(['retry: 곧\ndata: ok\n\n'])).toEqual([
      { event: 'message', data: 'ok', id: null, retry: null }
    ])
  })

  it('빈 청크가 CRLF 를 두 줄로 갈라 놓지 않는다', () => {
    // `TextDecoderStream` 이 지금은 빈 청크를 안 내지만, 파서 계약에 구멍을 남기지 않는다.
    expect(feedAll(['data: a\r', '', '\ndata: b\r\n\r\n'])).toEqual([
      { event: 'message', data: 'a\nb', id: null, retry: null }
    ])
  })

  it('줄바꿈 없이 계속 흘리는 서버에 메모리를 다 내주지 않는다 — 자르고 잘랐다고 적는다', () => {
    const p = new SseParser()
    // 2MB 상한을 넘기도록 1MB 씩 세 번(줄바꿈 없음).
    const chunk = 'x'.repeat(1024 * 1024)
    expect(p.feed(chunk)).toEqual([])
    expect(p.feed(chunk)).toEqual([])
    const out = p.feed(chunk)
    // 상한에서 줄이 강제로 끝나고, 그 줄은 `data` 필드가 아니라 알 수 없는 필드라 이벤트가 아니다.
    expect(out).toEqual([])
    // 다음 프레임은 정상으로 돌아온다 — 상한 하나 때문에 세션이 죽지 않는다.
    expect(p.feed('\ndata: 다시\n\n')).toEqual([
      { event: 'message', data: '다시', id: null, retry: null }
    ])
  })

  it('한 프레임의 data 상한을 넘기면 잘랐다는 사실이 본문에 남는다', () => {
    const p = new SseParser()
    // 512KB 짜리 data 줄 열 개 = 5MB > 4MB 상한.
    for (let i = 0; i < 10; i += 1) p.feed(`data: ${'y'.repeat(512 * 1024)}\n`)
    const [ev] = p.feed('\n')
    expect(ev.data).toContain('상한을 넘어 잘렸습니다')
    expect(ev.data.length).toBeLessThan(5 * 1024 * 1024)
  })

  it('길이가 상식을 넘는 id 는 안 물려받는다 — 재접속 헤더가 부풀지 않게', () => {
    const long = 'i'.repeat(1_000)
    expect(feedAll([`id: ${long}\ndata: a\n\n`])).toEqual([
      { event: 'message', data: 'a', id: null, retry: null }
    ])
    // 상식적인 길이는 그대로 쓴다.
    expect(feedAll(['id: abc\ndata: a\n\n'])[0].id).toBe('abc')
  })

  it('긴 한 줄이 여러 청크로 와도 이차식으로 느려지지 않는다', () => {
    // 예전 구현은 매 청크마다 **누적 꼬리 전체**를 다시 split 했다. 실측: 4MB 한 줄 184ms,
    // 16MB 한 줄 2,399ms(데이터 4배에 시간 13배 — 이차식). 지금은 새 청크만 자르므로 ~30ms.
    // 비율 비교는 짧은 쪽이 1ms 미만이라 실행마다 뒤집혀서(실측 flake) **절대 상한**으로 둔다.
    // 2MB 상한에서 줄이 끊기므로 그 뒤는 새 줄로 이어진다 — 총 스캔량은 같다.
    const p = new SseParser()
    const chunk = 'z'.repeat(16 * 1024)
    const started = performance.now()
    for (let i = 0; i < (16 * 1024) / 16; i += 1) p.feed(chunk)
    const elapsed = performance.now() - started
    // 이차식이 돌아오면 초 단위가 된다. 느린 기계에서도 안 뒤집히게 넉넉히 잡되,
    // 예전 구현(2.4초)은 확실히 걸리는 자리로.
    expect(elapsed).toBeLessThan(600)
  })

  it('끝나지 않은 마지막 프레임은 flush 로 꺼낸다 — 서버가 끊어도 마지막 메시지를 안 잃는다', () => {
    const p = new SseParser()
    expect(p.feed('data: 마지막\n')).toEqual([])
    expect(p.flush()).toEqual([{ event: 'message', data: '마지막', id: null, retry: null }])
    // 두 번 부르면 빈 배열 — 같은 메시지가 두 번 들어가지 않는다.
    expect(p.flush()).toEqual([])
  })
})
