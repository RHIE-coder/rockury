# Service: db-connections (Connections — 운영부)

> 원시 DB 접속(Connection)의 목록·상태 확인·그룹 분류를 담당하는 화면 명세 정본.
> 위계: Service > Surface > Section > Component. ID 는 코드·테스트와 기계 대조용 안정 키.
> 코드: `src/renderer/src/services/db/connections/` · 저장 `src/main/store/connections.ts`.

공통 불변식
- 비밀번호 평문은 카드/목록에 절대 노출하지 않는다(편집 다이얼로그 눈 아이콘만).
- 그룹은 표시·분류 상태일 뿐 — 어떤 연결 능력(테스트·바인딩·Console)에도 영향이 없다.

---

## Surface: db-connections.list (Connections 뷰)

### Section db-connections.list.auto-check — 진입·새로고침 자동 확인
- **AC-1** 뷰 진입(마운트)·`새로고침` 버튼은 모든 연결을 병렬로 확인한다 — 단, `자동 확인에서 제외` 연결은 건너뛴다.
- **AC-2** 건너뛴 연결의 이전 확인 결과는 **'미확인'으로 되돌린다**. 옛 "실패/연결됨"이 남아
  방금 확인된 것처럼 읽히면 안 된다(2026-07 사용자 실측 혼동 → 회귀 금지).
- **AC-3** 편집에서 제외로 바꾸는 즉시 그 카드 상태도 '미확인'으로 초기화한다.
- **AC-4** 카드별 수동 테스트(플러그 버튼)는 제외 여부와 무관하게 항상 동작한다(탈출구).
- **AC-5** 제외 연결 카드에는 `자동확인 제외` 배지를 표시한다.

### Section db-connections.list.groups — Connection 그룹
- **AC-1** `새 그룹` 버튼으로 그룹 생성 — 생성 직후 인라인 이름 입력이 열린다(Enter/blur 확정, Esc 취소).
- **AC-2** 그룹 섹션 헤더: 폴더 아이콘 + 이름 + 카드 수 + 이름변경(연필)/삭제(휴지통, 인라인 확인).
- **AC-3** 그룹 삭제 시 소속 연결은 **지워지지 않고 미분류로** 돌아간다.
- **AC-4** 그룹은 1단계(중첩 없음). 화면 순서: 그룹들(sort_order) → 미분류.
- **AC-7** 그룹 헤더 왼쪽 **그립 손잡이(⠿)를 끌어 그룹의 위아래 순서를 바꾼다** — 카드 DnD 와 동일한 방식:
  드래그 중 **원본 섹션은 목록에서 빠지고 그 자리(놓일 위치)에 점선 자리표시(가상 배치)가 들어가며**,
  그룹 축약본 고스트가 마우스를 따라온다. Esc/스크롤 영역 밖 놓기는 취소. 순서는 `connectionGroups:reorder` 로 영속. (미분류는 항상 마지막)
- **AC-5** 미분류 섹션은 그룹이 하나라도 있을 때만 `미분류` 라벨을 보인다(그룹 0개면 기존 평면 그리드 그대로).
- **AC-6** 사라진 그룹을 가리키는 연결은 미분류로 취급한다(카드 증발 금지 — `bucketByGroup` 안전망).

### Section db-connections.list.dnd — 카드 드래그 앤 드롭
- **AC-1** 카드를 6px 이상 끌면 드래그 시작(그 미만은 평범한 클릭=활성 연결 선택). 카드 안 버튼 위에서는 시작하지 않는다.
- **AC-2** 드래그 중 **고스트(카드 축약본)가 마우스를 따라온다**. 원본 카드는 목록에서 빠진다.
- **AC-3** 놓일 자리는 **점선 플레이스홀더(가상 요소)** 로 대상 섹션의 삽입 위치에 미리 보인다.
  대상 섹션에는 강조 테두리를 준다.
- **AC-4** 드롭으로 그룹 넣기/빼기(미분류)/같은 섹션 내 순서 변경이 된다. 섹션 밖에서 놓거나 Esc 를 누르면 취소.
- **AC-5** 순서 캐논: 전역 sort_order 하나로 관리 — [그룹들(그룹 순서)의 카드…, 미분류 카드…] 평탄화.
  그룹-로컬 순서 컬럼을 따로 두지 않는다(`applyMove` 가 전역 순서를 재계산, 이동+정렬은 단일 트랜잭션 `connections:move`).
- **AC-6** 기하 판정(`insertionIndex`)은 그리드 행(수직 겹침)으로 묶고 행 안에서 카드 가로 중심으로 앞/뒤를 가른다.

### Section db-connections.list.data — 저장 모델
- **AC-1** `connection_groups(id, name, sort_order, created_at, updated_at)` + `connections.group_id`(NULL=미분류).
- **AC-2** 신규 IPC 채널(`connections:move`, `connectionGroups:*`)은 MCP coverage 지도에 등재한다(현재: 전부 제외 — UI 분류 상태).
