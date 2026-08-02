import type { ModuleArea } from '../nav/types'

// 색조 이름은 구획 이름과 겹치되(design·ops) 하나는 다르다 — `neutral` 은 구획이 아니라
// "부서로 갈린 서비스의 공통"이라는 **상황**에 붙는 색이다.

/**
 * 구획(설계/운영/공통) → 강조색 클래스.
 *
 * **왜 있나(2026-08-01 사용자 피드백):** 활성 강조가 `accent`(설계 시안) 한 색으로 **고정**돼
 * 있어서, 운영부 모듈(Remote)을 보는 중에도 모듈 탭 채움과 뷰 탭 밑줄이 설계 색으로 켜졌다.
 * 구획 뱃지로 "색이 부서를 말한다"고 해 놓고 정작 화면은 반대로 말하니, 지금 보는 것이
 * 설계인지 운영인지가 안 갈렸다(설계·운영에 Definition·Diagram 처럼 같은 이름의 뷰가 겹쳐
 * 있어 이름으로도 못 가른다).
 *
 * 그래서 색을 여기 한 곳에 모으고 모듈 탭 줄과 뷰 탭 줄이 **같이 본다** — 두 줄이 서로 다른
 * 부서 색으로 켜지는 일이 구조적으로 못 생긴다.
 *
 * 값이 클래스 **완성형 문자열**인 이유: Tailwind v4 는 소스에 글자 그대로 있는 클래스만
 * 만든다. `'bg-' + name` 처럼 조립하면 그 유틸리티가 아예 생성되지 않아 자리가 투명해진다.
 */
export interface AreaAccent {
  /** 활성 모듈 탭 채움(흰 글자를 얹는다). */
  tab: string
  /** 건너가는 자리(`slot: 'center'`) 버튼 — 평소 테두리·글자, 활성일 때만 채움. */
  gate: string
  /**
   * 뷰 탭 줄 전체의 바탕 + 아래 테두리. **이 줄에서 부서색은 여기 한 곳뿐이다** — 활성 탭의
   * 밑줄은 없앴다(2026-08-02 피드백: 밑줄 강조 색 대신 그림자로 입체감을 준다).
   *
   * 밑줄 하나로는 부서가 안 읽힌다는 지적(2026-08-02)에 답해, **줄 자체가 색을 입는다**.
   * 바탕은 연한 부서색을 흰색과 섞어(`/60`) 깐다 — 원색 그대로면 흐린 글자(`text-muted`)의
   * 대비가 테라코타 쪽에서 4.34:1 로 AA(4.5)에 미달한다(실측). 섞으면 4.65:1 로 올라간다.
   */
  strip: string
}

/**
 * 색조 셋. 구획 이름이 아니라 **색조 이름**으로 둔다 — 같은 `common` 이 서비스에 따라
 * 다른 색조로 떨어지기 때문이다(아래 `areaAccent` 의 `split`).
 */
const TONE = {
  design: {
    tab: 'data-[state=active]:bg-accent data-[state=active]:hover:bg-accent',
    gate:
      'border-accent text-accent hover:bg-accent-soft ' +
      'data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:hover:bg-accent',
    strip: 'bg-accent-soft/60 border-accent/40'
  },
  ops: {
    tab: 'data-[state=active]:bg-accent-2 data-[state=active]:hover:bg-accent-2',
    gate:
      'border-accent-2 text-accent-2 hover:bg-accent-2-soft ' +
      'data-[state=active]:bg-accent-2 data-[state=active]:text-white data-[state=active]:hover:bg-accent-2',
    strip: 'bg-accent-2-soft/60 border-accent-2/40'
  },
  neutral: {
    tab: 'data-[state=active]:bg-ink data-[state=active]:hover:bg-ink',
    gate:
      'border-ink text-ink hover:bg-panel-strong ' +
      'data-[state=active]:bg-ink data-[state=active]:text-white data-[state=active]:hover:bg-ink',
    // 중립엔 연한 짝(`ink-soft`)이 없다 — 회색 바탕(`panel`)이 그 자리다. 어느 부서 색도 아니면서
    // 흰 바탕(`canvas`)과는 구별되므로 "부서 밖"이라는 말이 그대로 선다.
    strip: 'bg-panel border-line'
  }
} satisfies Record<string, AreaAccent>

/**
 * 구획을 안 쓰는 서비스(uiux·ai)의 색. 강조는 앱 1차(시안) 그대로 두고 **바탕만 중립 회색**이다 —
 * 부서가 없는 곳에 부서색을 깔면 요청한 적 없는 서비스가 물들지만, 바탕 자체는 있어야 한다:
 * 활성 뷰 탭이 **흰 카드**로 떠오르는 방식이라 줄이 흰색이면 그 카드가 안 보인다(2026-08-02).
 */
const PLAIN: AreaAccent = { ...TONE.design, strip: 'bg-panel border-line' }

/**
 * 이 모듈의 강조색.
 *
 * `split` 은 **그 서비스가 부서로 갈렸는가**다(`nav/moduleSlots.isAreaSplit`). 지금 갈린 것은
 * db·api·infra 셋이고, uiux·ai 는 모든 모듈이 `common` 이다. 갈린 곳에서만 공통이 중립
 * 그래파이트로 간다 — 설계 시안을 입히면 설계부로 오인되기 때문. 안 갈린 곳에 중립을 주면
 * **아무도 요청하지 않은 두 서비스의 화면 색이 통째로 바뀐다.**
 */
export function areaAccent(area: ModuleArea | undefined, split: boolean): AreaAccent {
  switch (area ?? 'common') {
    case 'design':
      return TONE.design
    case 'ops':
      return TONE.ops
    default:
      return split ? TONE.neutral : PLAIN
  }
}
