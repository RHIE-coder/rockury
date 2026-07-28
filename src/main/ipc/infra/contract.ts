/**
 * Infra IPC 의 **선을 넘는 타입**(메인 ↔ preload ↔ 렌더러).
 *
 * 여기 있는 것만 프로세스 경계를 건넌다. 카탈로그의 풍부한 도메인 모델
 * (`src/renderer/src/services/infra/catalog/types.ts`)은 렌더러에 남는다 —
 * 검증·표현식·아이콘 해석이 전부 화면 쪽 일이라 메인이 알 필요가 없다.
 * 메인이 아는 것은 "원문 JSON 한 덩어리와 그 출처" 뿐이다.
 */

/** 카탈로그가 어디서 왔나. 가져온 것은 화면에서 계속 '가져옴'으로 보인다(신뢰 경계). */
export type CatalogSource = 'builtin' | 'mine' | 'imported'

/** 렌더러로 나가는 공급자 연결 — **암호문도 평문도 담지 않는다.** */
export interface ProviderPublic {
  id: string
  catalogId: string
  name: string
  /** 읽기 전용 표시. 진짜 통제는 클라우드 쪽 권한 설정(IAM)이고 이건 보조선이다. */
  readOnly: boolean
  /** 자격증명이 채워져 있나(값은 주지 않는다). */
  hasCredentials: boolean
}

/** 탐침·액션 한 번 실행의 결과. */
export interface RunOutcome {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  error?: string
  /** 실제로 돌린 명령 — 자격증명은 참조 그대로다(화면에 보여도 된다). */
  displayCommand: string
}
