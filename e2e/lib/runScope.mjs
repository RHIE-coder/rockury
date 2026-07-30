/**
 * 러너의 실행 범위 판정 — **전체 한 바퀴는 명시적으로 요청해야만 돈다.**
 *
 * 왜 막느냐: e2e 는 **사용자가 지시할 때만 도는 검증**이다(2026-07-30 지시. 그전엔 커밋 훅이
 * 자동으로 전체를 돌렸고, 그게 진절머리 난다는 지적이 반복됐다). 그냥 `npm run e2e` 가
 * 전체를 돌려 버리면 습관적으로 전수 조사를 태우게 되므로 **러너가 범위 없는 실행을 막는다.**
 * 규칙을 AGENTS.md 에 적어 두는 것만으로는 안 지켜졌다.
 *
 * 순수 함수라 화면·프로세스 없이 검증된다(`runScope.test.ts`).
 */

/** 전체 실행을 여는 열쇠 — 사용자 지시가 왔을 때 쓴다(훅은 `RUN_E2E=1` 을 이 플래그로 옮긴다). */
export const FULL_FLAG = '--all'
export const FULL_ENV = 'E2E_FULL'

/**
 * @param {{ argv?: string[], env?: Record<string, string|undefined> }} input
 * @returns {{ mode: 'only'|'full'|'blocked', only: string[]|null }}
 *   - `only`   : `--only=` 로 고른 스위트만
 *   - `full`   : 전체 (명시적 요청이 있었다)
 *   - `blocked`: 아무 범위도 안 밝힌 채 전체를 돌리려 한 경우 → 러너가 거부한다
 */
export function resolveScope({ argv = [], env = {} } = {}) {
  const only = argv
    .find((a) => a.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (only?.length) return { mode: 'only', only }

  // 빈 값(`--only=`)은 "전체"가 아니라 실수다 — 열쇠 없이는 막는다.
  const opened = argv.includes(FULL_FLAG) || isTruthy(env[FULL_ENV])
  return { mode: opened ? 'full' : 'blocked', only: null }
}

/** `E2E_FULL=0`·빈 문자열은 켠 것으로 치지 않는다 — 훅이 변수를 비워 넘겨도 안전하게. */
function isTruthy(v) {
  return !!v && v !== '0' && v.toLowerCase() !== 'false'
}

/** 거부할 때 사람이 바로 다음 수를 두게 하는 안내문. */
export function blockedMessage(listCmd = 'npm run e2e -- --list') {
  return [
    '[e2e] 전체 한 바퀴는 사용자가 지시할 때만 돕니다 — 그 밖에는 건드린 스위트만 도세요.',
    '',
    '  npm run e2e -- --only=<스위트,...>',
    `  ${listCmd}   ← 스위트 목록`,
    '',
    `정말 전체를 돌려야 하면: npm run e2e -- ${FULL_FLAG}   (또는 ${FULL_ENV}=1)`
  ].join('\n')
}
