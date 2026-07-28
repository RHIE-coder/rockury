/**
 * 미들웨어 콘솔의 **순수 로직** — 명령 줄 가르기 · 기본 포트 · 빠른 명령 · 종류 목록.
 * 명세: `docs/spec/infra-architecture.md` §middleware.
 *
 * 미들웨어(= 앱과 앱 사이에서 메시지·캐시를 나르는 서버)는 아키텍처 그림의 노드이면서
 * 동시에 **접속해서 안을 들여다보는 작은 콘솔**이다 — 성격이 DB 서비스의 Console 과 같다.
 */

export interface MwKind {
  id: string
  label: string
  defaultPort: number
  /** 지금 실제로 붙을 수 있나. */
  ready: boolean
  /** 못 붙는 종류가 왜 못 붙는지 — 있는 척하지 않기 위해 반드시 적는다. */
  note?: string
}

/**
 * 명세가 정한 순서(`middleware.scope` AC-1): **Redis → RabbitMQ → Kafka → MQTT.**
 * 단순하고 흔한 것부터. 아직 안 만든 것은 목록에 **못 붙는다고 표시해 둔다** —
 * 목록에서 빼면 "지원 안 하나?"를 사용자가 짐작해야 하고, 표시 없이 두면 눌러 보고 나서 안다.
 */
export const MW_KINDS: MwKind[] = [
  { id: 'redis', label: 'Redis', defaultPort: 6379, ready: true },
  {
    id: 'rabbitmq',
    label: 'RabbitMQ',
    defaultPort: 5672,
    ready: false,
    note: '다음 순서입니다. 관리 API(HTTP)로 붙을 예정 — AMQP 이진 규약을 직접 구현하지 않습니다.'
  },
  {
    id: 'kafka',
    label: 'Kafka',
    defaultPort: 9092,
    ready: false,
    note: '아직 못 붙습니다. 이진 규약(Metadata 요청)을 직접 구현해야 합니다.'
  },
  {
    id: 'mqtt',
    label: 'MQTT',
    defaultPort: 1883,
    ready: false,
    note: '아직 못 붙습니다. MQTT 3.1.1 이진 규약을 직접 구현해야 합니다.'
  }
]

/** 종류의 기본 포트. 모르면 0 — 지어내지 않는다. */
export function defaultPortOf(kind: string): number {
  return MW_KINDS.find((k) => k.id === kind)?.defaultPort ?? 0
}

/**
 * 콘솔에 친 한 줄을 인자 배열로 가른다.
 *
 * **셸을 거치지 않는다** — 여기서 가른 배열이 그대로 규약의 벌크 문자열이 되므로,
 * 값에 공백·줄바꿈이 있어도 명령이 쪼개지지 않는다(CLI 쪽과 같은 성질).
 * 따옴표로 묶은 덩어리는 한 인자다 — 공백이 든 값을 넣을 길이 없으면 콘솔이 반쪽이 된다.
 */
export function parseCommandLine(line: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

export interface QuickCommand {
  label: string
  line: string
}

/**
 * 처음 붙은 사람이 누를 것들. **전부 읽기다** — 콘솔을 열자마자 데이터가 바뀌면 안 된다.
 * 아직 안 만든 종류는 빈 목록이다(있는 척하지 않는다).
 */
export function quickCommandsOf(kind: string): QuickCommand[] {
  if (kind !== 'redis') return []
  return [
    { label: '살아 있나', line: 'PING' },
    { label: '어떤 서버인가', line: 'INFO server' },
    { label: '메모리', line: 'INFO memory' },
    { label: '키 몇 개', line: 'DBSIZE' },
    { label: '키 훑기(20개)', line: 'SCAN 0 COUNT 20' },
    { label: '접속 수', line: 'INFO clients' }
  ]
}
