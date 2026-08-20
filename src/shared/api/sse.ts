/**
 * SSE(서버가 보내는 이벤트) 프레임 파서
 *
 * 왜 손으로 쓰나: Electron 메인에는 `EventSource` 가 없고(브라우저 API), 있어도 **헤더를
 * 못 싣는다** — 우리 요청은 인증 헤더가 붙는다. 그래서 `fetch` 로 열고 본문 스트림을
 * 여기서 프레임으로 자른다.
 *
 * 이 파일이 지키는 것은 **조용한 소실 금지**다:
 *   · 청크 경계는 프레임 한가운데를 자른다 → 남은 조각을 들고 있는다
 *   · 줄바꿈이 LF · CRLF · CR 세 종류다 → CRLF 가 청크 사이에서 갈리면 한 줄로 센다
 *   · 서버가 끊겨도 마지막 프레임이 남아 있으면 `flush()` 로 꺼낸다
 *
 * 규약(WHATWG HTML § server-sent events)을 그대로 따른다 — 여기서 우리가 판단할 것은 없다.
 * 모르는 필드를 무시하는 것도 우리 추측이 아니라 규약의 규칙이다.
 */

/**
 * 한 줄·한 프레임의 글자 상한. 단발 응답의 `MAX_BODY`(2MB)와 같은 자리다 —
 * 스트림이라고 상한을 안 두면 **서버가 메인 프로세스 메모리를 채울 수 있고**, 메인이 죽으면
 * 창이 전부 사라지면서 안내 한 줄도 못 띄운다(렌더러가 오류를 그릴 프로세스가 없다).
 * 넘치면 조용히 자르지 않고 **잘랐다는 사실을 데이터에 적는다.**
 */
const MAX_LINE = 2 * 1024 * 1024
const MAX_FRAME = 4 * 1024 * 1024
const TRUNCATED = '\n…(상한을 넘어 잘렸습니다)'

export interface SseEvent {
  /** `event:` 가 없으면 규약대로 `message`. */
  event: string
  data: string
  /** 마지막으로 본 `id:`. 없으면 null — 재접속 시 `Last-Event-ID` 로 쓴다. */
  id: string | null
  /** 서버가 권한 재접속 간격(ms). 숫자가 아니면 **지어내지 않고** null. */
  retry: number | null
}

export class SseParser {
  /** 아직 줄바꿈을 못 만난 꼬리. */
  private tail = ''
  /** 직전 청크가 `\r` 로 끝났나 — 다음 청크가 `\n` 으로 시작하면 같은 줄바꿈이다. */
  private pendingCr = false
  private dataLines: string[] = []
  /** 지금 프레임에 쌓인 data 글자 수 — 프레임 상한을 세는 데 쓴다. */
  private dataLen = 0
  private eventName = ''
  private lastId: string | null = null
  private retry: number | null = null
  /** 상한에 걸려 자른 적이 있나 — 호출부가 "조용히 사라진 게 아니다"를 알 수 있게 남긴다. */
  private lineOverflowed = false

  feed(chunk: string): SseEvent[] {
    // 빈 청크는 아무것도 아니다. 여기서 그냥 흘려보내지 않으면 아래 `pendingCr` 가
    // 지워져 CRLF 한 개가 두 줄로 갈리고 프레임이 두 쪽 난다.
    if (chunk === '') return []

    let text = chunk
    // 앞 청크가 '\r' 로 끝났고 이번이 '\n' 으로 시작하면 CRLF 하나다 — 두 줄로 세면
    // 프레임이 한가운데서 두 쪽 난다.
    if (this.pendingCr && text.startsWith('\n')) text = text.slice(1)
    this.pendingCr = text.endsWith('\r')
    if (this.pendingCr) text = text.slice(0, -1)

    // **새로 온 것만 자른다.** 예전엔 `(this.tail + text).split(...)` 이었는데, 줄바꿈 없는
    // 큰 본문이 오면 매 청크마다 누적 꼬리 전체를 다시 훑어 O(n²) 가 됐다 —
    // 16KB 청크로 16MB 한 줄이 오면 2.4초간 메인 프로세스가 멈춘다(실측).
    // 이어 붙이기만 남기면 V8 이 문자열을 밧줄(rope)로 이어 상수 시간이 된다.
    const lines = text.split(/\r\n|\r|\n/)
    // 첫 조각은 지난 꼬리의 연장이다.
    lines[0] = this.tail + lines[0]
    // 마지막 조각은 줄바꿈을 아직 못 만난 새 꼬리다.
    this.tail = lines.pop() ?? ''
    if (this.pendingCr) {
      // '\r' 로 끝났다는 것은 그 자리가 줄 끝이라는 뜻이다. 꼬리를 지금 줄로 확정한다.
      lines.push(this.tail)
      this.tail = ''
    }
    // 줄바꿈을 안 주고 계속 흘리는 서버로부터 메모리를 지킨다. 자른 사실은 줄에 적힌다.
    if (this.tail.length > MAX_LINE) {
      lines.push(this.tail.slice(0, MAX_LINE) + TRUNCATED)
      this.tail = ''
      this.lineOverflowed = true
    }

    const out: SseEvent[] = []
    for (const line of lines) {
      const ev = this.line(line)
      if (ev) out.push(ev)
    }
    return out
  }

  /** 스트림이 끝났을 때 남은 프레임을 꺼낸다. 두 번 불러도 같은 것이 두 번 나오지 않는다. */
  flush(): SseEvent[] {
    const out: SseEvent[] = []
    if (this.tail) {
      const ev = this.line(this.tail)
      this.tail = ''
      if (ev) out.push(ev)
    }
    const last = this.dispatch()
    if (last) out.push(last)
    return out
  }

  private line(raw: string): SseEvent | null {
    if (raw === '') return this.dispatch()
    // `:` 로 시작하면 주석이다 — 하트비트가 메시지로 둔갑하지 않게 버린다.
    if (raw.startsWith(':')) return null

    const colon = raw.indexOf(':')
    const field = colon === -1 ? raw : raw.slice(0, colon)
    // 값 앞 공백은 **하나만** 벗긴다. 두 칸을 다 벗기면 원문이 바뀐다.
    let value = colon === -1 ? '' : raw.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'data') {
      // 프레임 상한. 넘치면 버리되 **잘랐다고 적는다** — 조용히 사라지면 안 된다.
      if (this.dataLen >= MAX_FRAME) {
        if (!this.lineOverflowed) {
          this.dataLines.push(TRUNCATED)
          this.lineOverflowed = true
        }
      } else {
        this.dataLines.push(value)
        this.dataLen += value.length + 1
      }
    } else if (field === 'event') this.eventName = value
    // 서버가 준 id 를 재접속 헤더에 그대로 싣는다 — 길이 상한이 없으면 요청이 부풀려진다.
    // NUL 은 규약이 금지한다(CR/LF 는 줄 분해 때문에 애초에 들어올 수 없다).
    else if (field === 'id' && !value.includes('\0') && value.length <= 512) this.lastId = value
    else if (field === 'retry' && /^\d+$/.test(value)) this.retry = Number(value)
    // 그 밖의 필드는 규약대로 무시한다. **프레임을 버리지는 않는다** — 모르는 칸 하나 때문에
    // 메시지를 통째로 잃는 편이 더 나쁘다.
    return null
  }

  private dispatch(): SseEvent | null {
    const hadData = this.dataLines.length > 0
    const event = this.eventName || 'message'
    const data = this.dataLines.join('\n')
    // event 는 프레임마다 초기화, id 는 다음 프레임까지 유지 — 규약이 정한 비대칭이다.
    this.eventName = ''
    this.dataLines = []
    this.dataLen = 0
    this.lineOverflowed = false
    // `data:` 가 한 줄도 없는 프레임은 이벤트가 아니다(규약). 빈 줄만 반복돼도 여기서 걸린다.
    if (!hadData) return null
    return { event, data, id: this.lastId, retry: this.retry }
  }
}
