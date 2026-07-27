# TestPlan: db-connections (자동확인 제외 표시 + 그룹/DnD)

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
