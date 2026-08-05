# TestPlan: db-connections (자동확인 제외 표시 + 그룹/DnD + 샘플 DB)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 스위트 `e2e/suites/NN-*.mjs`.

## Scenario S1 — 자동 확인 판정 (순수 로직)
- **CASE-conn-001** 제외 플래그가 꺼진 연결만 확인 대상으로 남긴다. (auto-check AC-1) → `connections/autoCheck.test.ts`
- **CASE-conn-002** 대상/제외를 갈라 담는다 — 제외 목록은 상태 초기화('미확인')에 쓰인다. (auto-check AC-2) → `connections/autoCheck.test.ts`

## Scenario S2 — DnD 기하·순서 계산 (순수 로직) → `connections/dnd.test.ts`
- **CASE-conn-010** 삽입 인덱스: 한 행/여러 행/행 사이 간격/전체 위·아래 경계에서 올바른 위치. (dnd AC-6)
- **CASE-conn-011** 그룹 버킷: 그룹 순서대로 + 미분류 null 키, 사라진 그룹은 미분류로(카드 증발 금지). (groups AC-6)
- **CASE-conn-012** 이동 결과 전역 순서: 그룹 중간 삽입/미분류로 빼기/같은 섹션 재정렬/인덱스 클램프/캐논 평탄화. (dnd AC-5)
- **CASE-conn-013** 세로 삽입 인덱스: 세로 스택 위 포인터 y → 각 요소 중심 기준 삽입 위치(경계·전체 위/아래·빈 목록). (groups AC-7)
- **CASE-conn-014** reorderList: movedId 제거 후 클램프 삽입 — 앞/뒤 이동·제자리·범위 밖. (groups AC-7)

## Scenario S3 — 저장 계층 (임시 SQLite) → `src/main/store/stores.test.ts`
- **CASE-conn-020** 그룹 CRUD: 생성 순 정렬·이름변경·삭제 시 소속 연결 group_id 해제(연결 보존). (groups AC-3)
- **CASE-conn-021** moveConnection: group_id + 전역 sort_order 를 단일 트랜잭션 반영, 없는 그룹/연결 거부. (dnd AC-5)
- **CASE-conn-022** reorderConnectionGroups: 그룹 sort_order 재부여로 목록 순서 변경. (groups AC-7)

## Scenario S4 — 앱 구동 흐름 (e2e/suites/06-connections, CSS/text 로케이터만)
- **CASE-conn-030** `새 그룹` → 인라인 이름 입력 → Enter → 그룹 섹션 표시. (groups AC-1)
- **CASE-conn-031** 카드를 그룹 영역으로 마우스 드래그 → `connections.list()` 에 groupId 저장. (dnd AC-4)
- **CASE-conn-032** 카드를 미분류 영역으로 드래그 아웃 → groupId null 복귀. (dnd AC-4)
- **CASE-conn-033** 그룹 삭제(인라인 확인) → 그룹 0개, 연결은 보존. (groups AC-3)
- **CASE-conn-035** 그룹 그립 핸들 드래그로 순서 변경 → `connectionGroups.list()` 순서 반영·영속. (groups AC-7)
- **CASE-conn-034** 편집에서 `자동 확인에서 제외` 체크 → 카드에 배지, `새로고침` 후 상태 '미확인'(재확인 안 함). (auto-check AC-2/3/5)

## Scenario S5 — 샘플 DB 판정 (순수 로직) → `connections/samplePlan.test.ts`
- **CASE-conn-040** 파일·접속 유무 네 조합 → 각각 `둘 다 만들기`/`접속만`/`파일만`/`다시 만들기로` 로 갈린다. (sample.create AC-3)
- **CASE-conn-041** 샘플 접속 찾기는 **경로 기준** — 이름이 `내 샘플` 로 바뀌어 있어도 같은 것으로 보고 새로 만들지 않는다. (sample.create AC-4)
- **CASE-conn-042** 이름이 `샘플 DB` 여도 경로가 다르면 남의 접속이다 — 건드리지 않는다. (sample.create AC-4)
- **CASE-conn-043** 지울 파일 목록에 곁 파일(`-wal`·`-shm`)이 함께 들어간다. (sample.reset AC-5)
- **CASE-conn-044** 버튼 라벨 판정: 샘플 접속 없음 → `만들기`, 있음 → `다시 만들기`. (sample.entry AC-3)

## Scenario S6 — 파일·저장 계층 (임시 폴더) → `src/main/store/stores.test.ts`
- **CASE-conn-045** 빈 폴더에 만들기 → 파일이 생기고 표 23개와 초기 행이 들어 있다. (sample.source AC-3)
- **CASE-conn-046** 파일이 이미 있는데 접속만 없을 때 → **파일을 덮지 않고** 접속만 생긴다(기존 행 그대로). (sample.create AC-3)
- **CASE-conn-047** 다시 만들기 → 사용자가 넣은 행이 사라지고 초기 상태로 돌아오며, **접속 id·그룹·순서·이름은 그대로**. (sample.reset AC-4)
- **CASE-conn-048** 쓰기가 막히면(읽기 전용 폴더) 접속이 생기지 않는다 — 반쪽 등록 금지. (sample.errors AC-1)
- **CASE-conn-049** 다시 만들기 도중 생성이 실패해도 **기존 샘플 파일이 살아 있다**(바꿔치기 순서). (sample.reset AC-6)
- **CASE-conn-050** 새 채널 셋이 MCP coverage 지도에 등재돼 있다(전부 제외). (sample.data AC-2)

## Scenario S7 — 앱 구동 흐름 (e2e/suites/52-db-sample, `meta.needsDb: false`)
> **도커를 쓰지 않는다** — 이 스위트가 도커 없이 통과한다는 것 자체가 이 기능의 핵심 약속이다.
- **CASE-conn-055** 빈 상태에서 `샘플 DB 만들기` → 카드 1개가 생기고 활성 연결로 선택된다. (sample.create AC-5)
- **CASE-conn-056** 접속이 생긴 뒤 툴바 라벨이 `샘플 DB 다시 만들기` 로 바뀐다. (sample.entry AC-3)
- **CASE-conn-057** Remote 로 들어가면 목록에 **25행**(표 23 + 뷰 2)이 뜨고 뷰도 읽힌다. (sample.source AC-3)
- **CASE-conn-058** `다시 만들기` → 확인 문구에 **파일 경로와 데이터가 사라진다는 사실**이 있다. 취소하면 아무것도 안 바뀐다. (sample.reset AC-2)
- **CASE-conn-059** 확인하면 파일이 새로 만들어지고, 카드는 그 자리(그룹·순서) 그대로다. (sample.reset AC-4)
- **CASE-conn-060** 다시 만든 뒤 그 카드 상태가 `미확인` 이다. (sample.reset AC-7)
- **CASE-conn-061** 샘플 접속을 지워도 개발용 `scripts/test-db/data/` 는 그대로다 — 앱이 개발 환경을 안 건드린다. (공통 불변식)
