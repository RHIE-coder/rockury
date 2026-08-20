import type { Catalog, Discover } from './types'

/**
 * `연결 시험` 의 순수 계산 — 무엇으로 시험하고, 실패를 어떻게 말할 것인가.
 *
 * 실제 실행은 메인 프로세스(`infra:runProbe`)가 한다. 여기 있는 것은 **고르기와 말하기**뿐이라
 * 전부 입력→출력이 결정적이다.
 */

export interface TestProbe {
  typeId: string
  /** 무엇으로 시험했는지 화면이 말할 수 있어야 한다 — "성공"만 뜨면 무엇이 성공인지 모른다. */
  label: string
  discover: Discover
}

/**
 * 이 카탈로그를 시험할 탐침 하나. **지금 실제로 돌릴 수 있는 것만** 고른다 —
 * 아직 못 돌리는 호출 방식(http · builtin)을 골라 두면 눌러도 안 되는 버튼이 된다.
 */
export function pickTestProbe(catalog: Catalog): TestProbe | null {
  for (const t of catalog.nodeTypes) {
    if (t.discover?.call.type === 'cli') {
      return { typeId: t.id, label: t.label, discover: t.discover }
    }
  }
  return null
}

/** 실행이 남긴 실패 단서들. */
export interface FailureClues {
  timedOut: boolean
  exitCode: number | null
  stderr: string
  error: string
}

/**
 * 실패 이유를 **그대로** 옮긴다. 종료 코드와 표준 오류를 삼키고 "실패했습니다"로 뭉개면
 * 사용자는 자격증명이 틀린 건지, 명령이 없는 건지, 권한이 없는 건지 알 길이 없다.
 * 단서가 하나도 없으면 지어내지 않고 모른다고 말한다.
 */
export function describeTestFailure(clues: FailureClues): string {
  if (clues.timedOut) return '시간 초과'
  const parts: string[] = []
  if (clues.exitCode !== null) parts.push(`종료 코드 ${clues.exitCode}`)
  const detail = clues.stderr.trim() || clues.error.trim()
  if (detail) parts.push(detail)
  return parts.length ? parts.join(' · ') : '이유를 알 수 없습니다.'
}
