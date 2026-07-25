# TestPlan: db-studio (Studio › Seed — 시드 세트 저작 + 버전 Diff)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 `e2e/smoke.mjs`.
> 회차 기록은 `docs/qa/runs/`. 명세 정본: `docs/spec/db-studio.md`.

## Scenario S1 — 세트 선언 판정 (순수 로직) → `services/db/workspaces/seed/seedSet.test.ts`
- **CASE-studio-001** 자연키 기본값: PK 컬럼들을 기본값으로 주되, PK 가 자동증가(`AUTO_INCREMENT`·`serial`·`identity`)면 빈 배열을 준다. PK 가 복합이면 전부, PK 가 없으면 빈 배열. (declaration AC-1)
- **CASE-studio-002** 무시 컬럼 상호 배타: 자연키로 고른 컬럼은 무시 컬럼 후보에서 빠지고, 이미 무시 컬럼인 것을 자연키로 고르면 무시 목록에서 빠진다. (declaration AC-3)
- **CASE-studio-003** 세트 완전성 판정: 자연키 없는 세트는 `비교 불가`로, 있는 세트는 정상으로 분류한다. (set-list AC-5 / declaration AC-2)
- **CASE-studio-004** 세트 등록 후보: 이미 세트가 있는 테이블과 뷰(`isView`)를 후보에서 제외한다. 후보가 없으면 빈 목록. (set-list AC-2)

## Scenario S2 — 행 저작 판정 (순수 로직) → `services/db/workspaces/seed/seedRows.test.ts`
- **CASE-studio-010** 자연키 값 만들기: 여러 컬럼을 선언 순서대로 이어 하나의 키로 만들고, NULL 과 빈 문자열을 다르게 취급한다. (grid AC-3)
- **CASE-studio-011** 중복·빈 자연키 검출: 같은 키를 가진 행들을 모두 오류로 지목하고, 키 컬럼이 빈 행도 오류로 지목한다. 정상 행은 오류가 없다. (grid AC-3)
- **CASE-studio-012** 변수 자리표시자 추출: bare `{{X}}` 만 변수로 뽑고 `'{{X}}'`(따옴표 안)는 제외. 여러 행·여러 컬럼에서 뽑은 뒤 중복 제거·이름순. 변수가 없으면 빈 목록. (variables AC-1/AC-2)
- **CASE-studio-013** 행 짝짓기: 자연키로 두 시드 목록의 행을 짝지어 `양쪽/왼쪽만/오른쪽만` 으로 가른다. 키 컬럼 선언이 다르면 비교하지 않는다. (version-diff AC-3)

## Scenario S3 — 시드 Diff (순수 로직) → `services/db/versions/seedDiff.test.ts`
- **CASE-studio-020** 세트 단위 차이: 세트 추가·삭제를 잡는다. 양쪽에 다 있는 세트는 행 비교로 내려간다. (version-diff AC-3)
- **CASE-studio-021** 행 단위 차이: 행 추가·삭제·값 변경(어느 컬럼이 무엇에서 무엇으로)을 잡는다. (version-diff AC-3)
- **CASE-studio-022** 무시 컬럼 제외: 무시 컬럼 값만 다른 행은 차이가 아니다. (version-diff AC-3)
- **CASE-studio-023** 변수 이름 비교: 같은 변수 이름끼리는 차이가 아니고, 변수 이름이 바뀌면 차이다. (variables AC-3)
- **CASE-studio-024** 선언 변경: 자연키·무시 컬럼·`설계에 없는 행` 처리 변경을 차이로 잡는다(차이 라벨도 화면과 같은 말: `설계에 없는 행  그대로 둠 → 삭제 후보`). (version-diff AC-4)
- **CASE-studio-025** 옛 스냅샷 폴백: `seeds` 없는 스냅샷을 빈 목록으로 읽어 비교가 깨지지 않는다. 한쪽만 시드가 있으면 전부 추가/삭제로 잡힌다. (version-diff AC-2)
- **CASE-studio-026** 자연키 없는(또는 양쪽 선언이 다른) 세트: 행을 짝짓지 않고 `비교 불가`로 표시한다. 행 개수/값이 실제로 다르면 **침묵하지 않고** 그 세트를 변경으로 올린다(행 delta 는 비우고). 내용이 완전히 같으면 조용하다. 행 로컬 id 차이는 차이가 아니다. (declaration AC-2 / version-diff AC-3b)
- **CASE-studio-027** 요약 집계: 스키마 변경이 0 이고 시드 변경만 있을 때 "변경 없음"이 되지 않는다. (version-diff AC-5)

## Scenario S4 — 저장 계층 (임시 SQLite) → `src/main/store/stores.test.ts`
- **CASE-studio-030** 시드 세트 라운드트립: 선언(자연키·무시 컬럼·`설계에 없는 행` 처리)과 행이 저장→조회에서 보존된다. (persistence AC-1/AC-2)
- **CASE-studio-031** 설계 스코프 교체: 설계 X 의 세트를 저장해도 설계 Y 의 세트가 남는다. (persistence AC-1)
- **CASE-studio-032** MCP 커버리지: 새 IPC 채널이 노출 또는 제외 사유로 등재돼 `coverage.test.ts` 가 통과한다. (persistence AC-3) → `src/main/mcp/coverage.test.ts`

## Scenario S5 — 앱 구동 흐름 (e2e/smoke.mjs, CSS/text 로케이터만)
- **CASE-studio-040** Studio › Seed 진입 → 시드 세트 없을 때 빈 상태 CTA 표시. (set-list AC-4)
- **CASE-studio-041** 테이블에서 세트 등록(후보에 뷰 없음) → **자동증가 PK 라 자연키 경고** → 자연키 지정으로 경고 해제 → 무시 컬럼 지정 → 행 추가·값 입력 → 목록에 행 수 반영. (set-list AC-1/AC-2/AC-5, declaration AC-1/AC-2/AC-3, grid AC-2)
- **CASE-studio-042** 중복 자연키 입력 → 두 행 모두 오류 표시, 값을 바꿔 해소하면 오류 사라짐. (grid AC-3)
- **CASE-studio-043** 셀에 `{{ADMIN_PASSWORD_HASH}}` 입력 → 변수 표식 + 세트 머리의 변수 목록에 등장. (variables AC-1/AC-2)
- **CASE-studio-044** 저장소(`seedSets.list`)에 선언·행 반영 + **콜드 재시작**(앱 종료→재기동) 후 세트·행·변수 잔존. (persistence AC-1/AC-2)
- **CASE-studio-044b** `설계에 없는 행` 을 `삭제 후보` 로 고르면 그 뜻을 경고로 보인다. (declaration AC-4)
- **CASE-studio-045** 시드를 담아 버전 컷 → 타임라인에 시드 행 수 표시 + Versions › Version Diff 에 시드 섹션(시드 없던 옛 버전과 비교 → 세트/행 추가) 표시. (version-diff AC-1/AC-2/AC-3/AC-5) — 행 값 변경 케이스는 단위테스트 CASE-studio-021 이 덮는다.
