/**
 * 미리보기 바가 무엇을 보일지 정하는 **순수 판단**(입력→출력 결정적 → 테스트 의무).
 *
 * 가르는 축이 둘이라 떼어 냈다: 낼 수 있는 문(`statements`)과, 이 방언이 자동으로 못 내는
 * 변경(`unsupported`). 둘째를 안 세면 **고친 게 있는데 "변경 없음"으로 보인다** —
 * 적용이 왜 안 켜지는지 화면에 단서가 하나도 안 남는다(2026-08-05 제보).
 *
 * 파일 이름이 `PreviewBar.tsx` 와 대소문자만 다르면 안 된다 — macOS 파일시스템은 둘을
 * 같은 파일로 봐서 import 가 제 자신을 가리킨다.
 */
export interface PreviewState {
  /** 아무것도 안 고쳤다 — 이때만 "변경 없음". */
  idle: boolean
  /** 펼침 칸에 보일 게 있나(문이든 사유든). */
  hasDetail: boolean
  /** 펼침 토글 이름 — 문이 없으면 보여 줄 건 SQL 이 아니라 사유다. */
  detailLabel: 'SQL' | '이유'
  /** 왼쪽 버튼 — 고친 게 없으면 버릴 것도 없다. */
  discardLabel: '편집 종료' | '버리기'
}

export function previewState(statements: number, unsupported: number): PreviewState {
  const idle = statements === 0 && unsupported === 0
  return {
    idle,
    hasDetail: statements > 0 || unsupported > 0,
    detailLabel: statements > 0 ? 'SQL' : '이유',
    discardLabel: idle ? '편집 종료' : '버리기'
  }
}
