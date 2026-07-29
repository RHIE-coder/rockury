# docs/qa — 테스트 정의 정본 (steward)

steward `spec` 단계가 관리하는 **테스트 정의**가 자라는 곳이다
(위계: TestPlan > TestScenario > TestSuite > TestCase).
새/변경 동작을 다룰 때 점진적으로 채워진다.

- **정의(무엇을 검증하나)**는 여기.
- **실제 테스트 코드**는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 구동 스위트 `e2e/suites/NN-*.mjs`(러너: `e2e/smoke.mjs` — 폴더를 읽어 자동 실행).
- **스위트 번호는 서비스별 구간을 쓴다** — 등록 목록이 없어서(러너가 폴더를 읽는다) 번호를 누가
  쓰는지 아무도 안 알려 주기 때문이다. 실제로 세 서비스가 동시에 13번을 잡은 적이 있다.
  구간은 `e2e/isolation.test.ts` 의 `SUITE_BANDS` 가 정본이고 그 파일이 겹침을 막는다.
- 시나리오의 원천: `docs/before-steward-background/db-service-ia.md` §4 불변 규칙·정책(필드 제약·중복 금지·필수값 등).
