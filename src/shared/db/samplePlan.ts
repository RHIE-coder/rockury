/**
 * 샘플 DB 판정 — 무엇을 만들고 무엇을 건너뛸지.
 *
 * 파일 입출력·화면과 분리해 둔다. 메인(만들기·다시 만들기)과 렌더러(버튼 라벨)가 같은 규칙을
 * 봐야 하는데, 규칙이 양쪽에 흩어지면 "버튼은 만들기라는데 눌러도 아무 일이 없는" 어긋남이 난다.
 */

/** userData 아래 샘플이 놓이는 자리. 경로 조립은 userData 를 아는 메인이 한다. */
export const SAMPLE_DIR = 'samples'
export const SAMPLE_FILE = 'sample.sqlite'

/** 만들어지는 접속의 이름. 사용자가 바꿔도 되며, 판정은 이 이름을 안 쓴다(경로로 한다). */
export const SAMPLE_CONNECTION_NAME = '샘플 DB'

/** SQLite 를 WAL 모드로 열면 함께 생기는 곁 파일. 지울 때 남기면 새 파일에 옛 내용이 섞인다. */
const SIDECAR_SUFFIXES = ['-wal', '-shm'] as const

export interface SampleStatus {
  /** 샘플 파일의 절대경로. 비교가 문자열이므로 부르는 쪽이 이미 정규화해서 넘긴다. */
  path: string
  fileExists: boolean
  /** 그 경로를 가리키는 접속의 id. 없으면 null. */
  connectionId: string | null
}

/**
 * `create-both` 둘 다 만든다 · `create-connection` 파일은 그대로 두고 접속만 ·
 * `create-file` 접속은 그대로 두고 파일만 · `reset` 이미 다 있다(다시 만들기의 몫).
 */
export type SampleAction = 'create-both' | 'create-connection' | 'create-file' | 'reset'

export interface SampleResult {
  status: SampleStatus
  /** 이번에 **실제로** 만든 것 — 화면 알림이 사실대로 말하기 위한 근거. */
  made: 'both' | 'connection' | 'file' | 'none'
}

export function planSample(status: SampleStatus): SampleAction {
  const { fileExists, connectionId } = status
  if (connectionId) return fileExists ? 'reset' : 'create-file'
  return fileExists ? 'create-connection' : 'create-both'
}

interface ConnectionLike {
  id: string
  dbType: string
  database: string
}

/**
 * 샘플 접속 찾기 — **이름이 아니라 경로**로 판정한다.
 * 이름으로 찾으면 사용자가 카드 이름만 바꿔도 못 찾아 두 개째가 생긴다.
 */
export function findSampleConnection(rows: ConnectionLike[], path: string): string | null {
  const hit = rows.find((r) => r.dbType === 'sqlite' && r.database === path)
  return hit ? hit.id : null
}

/** 지우기 대상 — 본 파일과 곁 파일. */
export function samplePaths(path: string): string[] {
  return [path, ...SIDECAR_SUFFIXES.map((s) => `${path}${s}`)]
}

/** 버튼은 자기가 무슨 일을 할지 말한다 — 눌러도 아무 일이 없는 상태를 만들지 않는다. */
export function sampleButtonLabel(status: SampleStatus): string {
  return status.connectionId ? '샘플 DB 다시 만들기' : '샘플 DB 만들기'
}
