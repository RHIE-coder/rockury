# TestPlan: parallel-dev (5서비스 병렬 개발 기반 — 공용 파일 분할)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 `e2e/`.
> 회차 기록은 `docs/qa/runs/`. 규칙 정본: `AGENTS.md`(병렬 개발 규칙 절).
>
> **이 계획의 목적은 기능 검증이 아니라 "약화 안 됨" 증명이다.** 공용 파일 6곳을 서비스별로
> 쪼개면서 프로젝트의 절대 불변식(AGENTS.md §🔒 1·3·4)을 강제하던 기계 장치들이
> 조용히 눈이 멀 수 있다. 아래 케이스는 그 눈이 여전히 떠 있는지를 본다.

## Scenario S1 — e2e 안전 가드가 쪼갠 스위트 파일까지 덮는다 (불변식 1)
→ `e2e/isolation.test.ts` [자동]

분할 전 이 가드는 `smoke.mjs` **한 파일만** 읽었다. 체크를 `e2e/suites/*.mjs` 로 빼면
가드가 빈 껍데기를 검사하게 된다 — 과거 실 사용자 DB 를 파괴한 사고의 재발 통로다.

- **CASE-pdev-001** 스위트 파일에 실 앱 userData 경로(`Application Support`)가 있으면 `npm test` 실패. `smoke.mjs` 뿐 아니라 `e2e/**/*.mjs` 전부가 대상.
- **CASE-pdev-002** 스위트 파일의 `rmSync(...)` 는 임시 userData(`USER_DATA`) 대상일 때만 통과. 그 외 경로면 실패.
- **CASE-pdev-003** 검사·실행 대상 목록이 **하드코딩이 아니다** — `e2e/suites/` 에 새 파일을 놓으면 등록 없이 격리 검사와 러너 실행에 자동으로 들어온다. (하드코딩이면 새 스위트가 가드를 우회하거나 조용히 안 돌아간다.)
- **CASE-pdev-004** 안전핀: 검사한 파일이 0개면 실패한다 — 글롭이 깨져 "검사할 게 없어서 통과"하는 상태를 막는다. 러너도 스위트 0건이면 검증불가(2)로 끝난다.

## Scenario S2 — MCP 커버리지 핀이 하위 폴더까지 전수 스캔한다 (불변식 4)
→ `src/main/ai/coverage.test.ts` [자동]

분할 전 스캔 범위는 `src/main/ipc/*.ts`(한 겹)였다. IPC 를 `src/main/ipc/<서비스>/` 로
내리면 스캔이 채널을 못 찾고, 미등재 채널이 통과해 버린다.

- **CASE-pdev-010** 하위 폴더(`src/main/ipc/<서비스>/*.ts`)의 채널도 전수 수집된다 — 분할 전후 수집 채널 집합이 동일.
- **CASE-pdev-011** 미등재 채널은 여전히 실패한다 — 하위 폴더에 노출/제외 어디에도 없는 새 채널을 두면 `npm test` 실패.
- **CASE-pdev-012** 유령 등재는 여전히 실패한다 — 코드에서 사라진 채널이 지도에 남으면 실패.
- **CASE-pdev-013** 서비스별로 쪼갠 지도 파일들이 합쳐질 때 **같은 채널이 두 서비스에 중복 등재되면 실패**한다(분할이 새로 만드는 위험 — 분할 전에는 한 파일이라 불가능했다).
- **CASE-pdev-014** 안전핀: 수집 채널이 0개면 실패한다.

## Scenario S3 — 로컬 저장소 스키마가 분할 후에도 온전하다
→ `src/main/store/migrations/migrations.test.ts` [자동]

- **CASE-pdev-020** 서비스별 마이그레이션을 모두 적용하면 기존 테이블 **17개가 전수 생성**된다(분할 전 목록을 손으로 적어 둔 기준과 이름 대조). 이 대조가 "서비스 모듈 하나가 등록부에서 통째로 빠진" 경우를 잡는 유일한 그물이다 — 선언과 생성이 함께 줄면 다른 검사는 통과해 버리기 때문이다.
- **CASE-pdev-021** 이미 쓰던 DB 파일을 다시 열어도 데이터가 보존된다 — 분할 후에도 `CREATE TABLE IF NOT EXISTS` 성질 유지(사용자 로컬 데이터 무손상).
- **CASE-pdev-022** 서비스 간 **테이블 중복 선언**은 적용을 실패시킨다(`IF NOT EXISTS` 탓에 뒤에 온 쪽이 조용히 무시되는 것을 막는다). 선언한 테이블과 실제 생성된 테이블이 다르면(선언만·유령) 실패. 알 수 없는 서비스 id 도 실패. 등록부가 비어도 실패(안전핀).

## Scenario S4 — 렌더러에 노출되는 API 표면이 안 바뀐다
→ `src/preload/services/assemble.test.ts` (electron 모킹) [자동]

`preload/index.ts` 분할은 순수한 재배치여야 한다 — `window.rockury.*` 경로가 하나라도
바뀌면 렌더러 전체가 조용히 깨진다.

- **CASE-pdev-030** 조립된 api 객체의 최상위 키 집합이 분할 전과 동일(`window`·`designs`·`tables`·`seedSets`·`envVars`·`store`·`versions`·`connections`·`connectionGroups`·`environments`·`introspection`·`query`·`savedQueries`·`collections`·`migration`·`mcp`·`diagram`).
- **CASE-pdev-031** 각 그룹의 함수 이름 집합이 분할 전과 동일 — 메서드가 조용히 빠지지 않는다.
- **CASE-pdev-032** 두 서비스 파일이 같은 최상위 키를 내놓으면 조립이 실패한다(덮어쓰기로 한쪽이 사라지는 것을 막음).

## Scenario S5 — 화면 품질 기준선이 쪼개져도 같은 판정을 낸다
→ `e2e/surface/checks.test.ts` 확장 또는 신규 [자동] + `npm run surface-verify` [수동]

- **CASE-pdev-040** 서비스별로 쪼갠 기준선 파일을 합치면 분할 전 `baseline.json` 96건과 **같은 집합**이 된다(누락·중복 0).
- **CASE-pdev-041** `--update-baseline` 이 findings 를 `formFactor` 첫 마디 기준으로 서비스별 파일에 갈라 쓴다. 서비스에 안 붙는 것(`boot`)은 공용 파일로.
- **CASE-pdev-042** `npm run surface-verify` 가 분할 전과 같은 판정(통과)을 낸다 — 수용된 96건은 여전히 차단 제외, 새 회귀만 차단. [수동]

## Scenario S6 — 앱 구동 흐름이 분할 전과 같은 검사를 한다 (불변식 3)
→ `npm run e2e` [수동 — docker test-db 필요]

- **CASE-pdev-050** 분할 후 `npm run e2e` 의 PASS 라벨 집합이 분할 전과 **동일**하다(개수만이 아니라 라벨 대조 — 조용히 사라진 검사 0).
- **CASE-pdev-051** 흐름 파일 하나가 실패해도 나머지 흐름이 계속 돌고, 전체 종료 코드는 실패다(한 서비스의 깨짐이 다른 서비스 검사를 가리지 않는다).

## Scenario S7 — 워크트리 준비 스크립트
→ `scripts/parallel/*.test.ts`(계획 계산 순수 로직) [자동] + 실제 실행 [수동]

- **CASE-pdev-060** 계획 계산: 서비스 목록 → (브랜치명, 폴더경로) 대응이 결정적이고, 이미 존재하는 워크트리는 "건너뜀"으로 분류된다.
- **CASE-pdev-061** 멱등: 두 번 실행해도 오류 없이 같은 최종 상태가 된다(이미 있는 브랜치·폴더를 다시 만들려 하지 않는다). [수동]
- **CASE-pdev-062** 준비된 폴더에 `node_modules` 와 `.harness-main` 이 있고, 그 폴더에서 `npm test` 가 통과한다 — 실제로 개발 가능한 상태임의 증명. [수동]
- **CASE-pdev-063** 정리 명령이 워크트리를 지울 때 **커밋 안 된 변경이 있으면 멈추고 알린다** — 작업물을 말없이 날리지 않는다.

## 범위 밖
- 각 서비스의 기능 동작 — 해당 서비스 TestPlan(`db-studio`·`db-console`·`db-connections`·`ai-server`)의 몫.
- 병합 충돌이 "실제로" 줄었는지 — 여러 브랜치를 실제로 굴려야 나오는 결과라 자동 검증 대상이 아니다. 분할이 구조적으로 충돌 지점을 없앴는지는 파일 소유권 표(`AGENTS.md`)로 확인한다.
