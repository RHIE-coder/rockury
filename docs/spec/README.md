# docs/spec — 살아있는 기획 정본 (steward)

steward `spec` 단계가 관리하는 **정책·화면 명세 정본 트리**가 자라는 곳이다
(위계: Application > Service > Surface > Section > Component). 지금은 비어 있고,
**기능을 `spec` 단계로 다룰 때 그 부분부터 점진적으로 채워진다** — 한 번에 대이동하지 않는다.

## 흡수 원칙 (원문 보존 · 점진 링크)
steward 도입 전의 설계 근거·로드맵 원문은 **`docs/before-steward-background/` 에 그대로 보존**한다.
이 spec 트리는 원문을 잘게 부숴 넣는 게 아니라 **링크하며** 자란다 —
원문의 방향성·로드맵·의도를 해치지 않기 위해서다.

- **`docs/before-steward-background/db-service-ia.md`** — 설계 근거·IA·결정 로그·불변 규칙.
  - §5 IA(확정본) = 이 구조 트리의 씨앗.
  - §4 불변 규칙·정책 = `docs/qa/` 테스트 시나리오의 원천.
- **`docs/before-steward-background/ops-implementation-plan.md`** — 로드맵·진행·인수인계(재개점).

## 자립성
`docs/before-steward-background/` 는 근거·로드맵 아카이브일 뿐, steward 트리의 일부가 아니다.
불필요하다고 판단되면 그 폴더째 지워도 이 spec 트리는 자립한다(그 시점엔 필요한 내용이
이미 여기로 흡수돼 있어야 한다 — 지우기 전 링크가 0인지 확인).
