# TestPlan: shell-project-scope (프로젝트 범위)

> 명세 정본: `docs/spec/shell-project-scope.md`.
> 어느 서비스에도 속하지 않는 공용 기능이라 여기 따로 둔다.

## Scenario S1 — 거르기 규칙 (순수 로직) → `src/renderer/src/shell/projectScope.test.ts`

이 기능의 핵심은 함수 하나(`inScope`)다. 화면마다 조건을 다시 쓰면 한 곳만 고쳐지므로,
규칙은 여기서 못박고 화면은 부르기만 한다.

- **CASE-scope-001** `전체` 는 소속과 무관하게 전부 통과시킨다. (filter AC-3)
- **CASE-scope-002** 프로젝트를 고르면 그 프로젝트 것만 통과한다 — 남의 것은 두 갈래 모두에서 숨는다. (filter AC-1/AC-2)
- **CASE-scope-003** strict(설계류)에서 무소속은 **숨는다**. (filter AC-1)
- **CASE-scope-004** shared(접속류)에서 무소속은 **남는다**. (filter AC-2)
- **CASE-scope-005** `프로젝트 없음` 은 무소속만 통과시킨다(두 갈래 공통). (filter AC-3)
- **CASE-scope-006** 빈 소속의 세 모양(`null` · `undefined` · `''`)과 칸 자체가 없는 행을 모두
  무소속으로 다룬다 — 저장소는 NULL, 폼은 빈 문자열, 옛 행은 칸이 없다.
- **CASE-scope-007** 범위 값을 셀렉터 옵션 id 로 접었다 펴도 같다. 빈 값은 `전체` 로 떨어진다. (selector AC-2/AC-5)

## Scenario S2 — 저장소 (프로젝트 · 소속) → `src/main/store/projects.test.ts` · `scopedItems.test.ts`

- **CASE-scope-010** 프로젝트를 만들고 고치고 지운다. 이름이 비면 `key` 를 이름으로 쓴다.
- **CASE-scope-011** `key` 가 겹치면 **사람이 읽을 수 있는 문구**로 거부한다 — UNIQUE 인덱스가 던지는
  문구는 화면에 그대로 올릴 수 없다. 자기 키를 다시 저장하는 것은 통과한다. (INV-1)
- **CASE-scope-012** `key` 규칙(소문자·숫자로 시작, 소문자·숫자·`-`·`_`)에 어긋나면 거부한다. (INV-1)
- **CASE-scope-013** **프로젝트를 지워도 설계·접속은 남고 소속만 풀린다.** 다른 프로젝트의 소속은
  건드리지 않는다. (INV-2)
- **CASE-scope-014** 소속 목록이 여섯 종류를 모두 다루고, 종류마다 제 테이블만 고친다. (organize AC-1)
- **CASE-scope-015** 무소속을 공용으로 다루는 종류인지 함께 알려 준다 — 화면의 `공용`/`없음` 표시가
  여기서 갈린다. (organize AC-2)
- **CASE-scope-016** 없는 프로젝트로는 못 옮긴다. 모르는 종류도 거부한다. (organize AC-4)

## Scenario S3 — 마이그레이션 (공용 자리 · 소속 칸) → `src/main/store/migrations/migrations.test.ts` · `promoteProjects.test.ts`

- **CASE-scope-020** 공용 소유 자리(`shell`)가 열려 있고 `projects` 테이블이 생긴다. 접두어 규칙은
  공용에만 예외다 — 접두어의 목적은 서비스끼리의 충돌 회피인데 공용은 상대가 없다.
- **CASE-scope-021** 공용도 서비스도 아닌 이름을 선언하면 여전히 실패한다 — 오타가 조용히 새 소유자를
  만들지 않는다.
- **CASE-scope-022** 여섯 테이블에 소속 칸이 있고 **비워 둘 수 있다**(NOT NULL 아님). (§5)
- **CASE-scope-023** UI/UX 전용이던 프로젝트가 공용으로 옮겨질 때 **id 가 보존된다** — 안 그러면
  화면 설계 트리 전체가 부모를 잃는다. 디자인 토큰은 `uiux_project_tokens` 로 갈라진다.
- **CASE-scope-024** 이관은 몇 번을 돌려도 결과가 같다(앱을 켤 때마다 지나간다). 반쯤 이관된 DB 에서
  다시 돌 때 사용자가 그 사이 고친 값을 옛 값으로 되돌리지 않는다.

## Scenario S4 — 실 앱 흐름 → `e2e/suites/60-project-scope.mjs`

- **CASE-scope-030** 셀렉터가 타이틀바에 하나 있고 기본은 `전체` 다. (selector AC-1/AC-2)
- **CASE-scope-031** 도입 전 데이터(시드 설계)는 무소속으로 시작한다 — 소급해서 답할 것이 없다. (§5)
- **CASE-scope-032** 프로젝트를 만들면 그 프로젝트로 범위가 옮겨간다. (selector AC-6)
- **CASE-scope-033** 프로젝트를 고르면 무소속 설계가 셀렉터에서 숨는다. (filter AC-1)
- **CASE-scope-034** 소속 정리 창이 설계·접속을 함께 다루고, 접속의 무소속은 `공용` 으로 보인다. (organize AC-1/AC-2)
- **CASE-scope-035** 소속 정리에서 옮긴 결과가 **그 자리에서** 서비스 목록에 반영된다. (organize AC-3 · 회귀)
- **CASE-scope-036** 프로젝트를 지워도 설계는 남고 소속만 풀린다. (INV-2)

> **미검증(의식적)**: N:M 소속은 만들지 않았으므로 대상이 없다(§6). 인프라 설계본·클라우드 계정·
> 미들웨어 접속의 실 앱 좁히기는 로컬에 데이터가 0건이라 e2e 로 덮지 못했다 — 규칙 자체는
> S1·S2 가 종류와 무관하게 덮는다.
