# docs/qa — 테스트 정의 정본 (steward)

steward `spec` 단계가 관리하는 **테스트 정의**가 자라는 곳이다
(위계: TestPlan > TestScenario > TestSuite > TestCase). 지금은 비어 있고,
새/변경 동작을 다룰 때 점진적으로 채워진다.

- **정의(무엇을 검증하나)**는 여기.
- **실제 테스트 코드**는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 구동 흐름 `e2e/flows/<서비스>.mjs`(러너: `e2e/smoke.mjs`).
- 시나리오의 원천: `docs/before-steward-background/db-service-ia.md` §4 불변 규칙·정책(필드 제약·중복 금지·필수값 등).
