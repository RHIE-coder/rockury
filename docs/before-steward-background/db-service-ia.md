# DB 서비스 — IA & 도메인 설계

> 상태: **설계 확정 / 구현 전(껍데기만)**
> 최종 갱신: 2026-07-16
> 참고(stale): `__active-box__/rockury/rky-mvp` — 이 문서의 타입 매핑(§8)은 이 프로젝트 기준

현재 리포에 반영된 것은 **nav 골격**뿐이다(모듈/뷰 트리 + 컨텍스트 바, 화면은 placeholder).
아래 도메인 모델·정책·흐름은 아직 코드로 구현되지 않았다. 구현 시 이 문서를 기준으로 한다.

---

## 1. 개념 모델

### 엔티티

| 엔티티 | 정의 | 성격 |
|---|---|---|
| **Design (설계)** | 이름 + 버전을 가진 스키마 청사진. "원하는 상태(desired)". **벤더(방언)는 생성 시 결정되는 고정 속성** — 설계 화면·DDL 은 그 방언의 네이티브 구문 그대로. | virtual · 설계부 |
| **Version** | Design 의 불변(immutable) 스냅샷. `v0.3.13` 처럼 식별. **설계↔운영의 공유 경계 객체(boundary object)** — 설계부가 생산(컷), 운영부가 소비(배포). | 전역 소유 · 단조 증가 |
| **Connection** | 원시 접속 정보(엔드포인트/자격증명). 비밀번호 로테이션 등의 생애주기. | 운영부 |
| **Environment** | 배포 바인딩 = `Connection + 타깃 Version + 마지막 적용 Version + post-apply 스냅샷 + 이력`. | 운영부 |

### 관계 (결정: ①-a)

- **Design 1 : N Environment.** 환경은 항상 한 Design 에 소속된다.
- 같은 물리 DB 서버라도 Design 이 다르면 별개 Environment 로 모델링한다.
- 멀티 설계가 한 Connection 을 공유하는 격자 모델(①-b)은 **뒤로 미룸**(§7).

### 예시 (Design A)

| Environment | 타깃 Version | Connection |
|---|---|---|
| 개발 | v0.4.0 | Connection-로컬 |
| QA | v0.4.0 | Connection-QA |
| Stage | v0.3.13 | Connection-STG |
| 운영 | v0.3.13 | Connection-REAL |

같은 A 설계를 환경마다 다른 버전으로 물려, 버전 간(v0.3.13 ↔ v0.4.0) diff 로 승격(promotion)한다.

---

## 2. 세 가지 diff (혼동 방지 — 이름을 분리한다)

| 이름 | 무엇 vs 무엇 | DB 필요? | 사는 곳 |
|---|---|---|---|
| **① 버전 diff** | 설계 vA vs 설계 vB | ❌ | Versions › Version Diff |
| **② 드리프트 diff** | 실제(now) vs 마지막 반영 스냅샷 | ✅ Reverse | Migration › Drift |
| **③ 반영 diff** | 설계(타깃) vs 실제(now) | ✅ Reverse | Migration › Plan |

---

## 3. 마이그레이션(Reconcile) 흐름 — Drift → Plan → Run → Logs

Rockury 를 거치지 않고 실 DB 를 손댄 핫픽스(드리프트)까지 흡수하는 시나리오(Stage, 마지막 반영 v0.3.13):

1. **Drift** — Connection-STG 를 Reverse(introspection) → 마지막 post-apply 스냅샷과 비교(diff ②)
   → 손으로 친 변경(예: `users.memo` 추가) 감지 → **실제 상태를 새 버전 `v0.3.14` 로 캡처**.
   드리프트 로그 객체로 기록(가칭 `v0.3.13-diff-202607160001`, 기록 시각 기반).
2. **Plan** — 타깃 v0.4.0 과 실제 STG 비교(diff ③) → apply/rollback/seed 쿼리 생성.
   - v0.4.0 에도 드리프트를 접어 넣어 **v0.4.1** 로 승격 → 최종 경로 **v0.3.14 → v0.4.1**.
   - 이로써 `memo` 는 절대 유실되지 않고 설계 계보의 정식 일원이 된다.
   - 상태: Ready.
3. **Run** — Forward 반영 → Validation(v0.4.1 설계 일치·seed 검증)
   → 성공 시 반영 로그 기록 / 실패 시 rollback 쿼리로 원복 + 실패 리포트.
4. **Logs** — 드리프트 로그 + 반영 로그가 체인으로 엮인 **환경별 변경 이력**.

---

## 4. 불변 규칙 · 정책 (합의된 것)

- **두 부서는 정의된 문으로만 오간다.**
  - 설계→운영(Forward): Versions 에서 컷한 버전을 Migration 이 Environment 에 반영.
  - 운영→설계(Backward): Migration/Drift 가 캡처한 변경을 Versions 에 새 버전으로 되먹임.
- **버전은 설계가 전역 소유 · 단조 증가 · 불변.** 환경발 드리프트 흡수도 하나의 메인라인에 다음 버전을 찍는다. 환경별 포크 금지. 이미 배포된 버전은 lock.
- **드리프트 흡수 = KEEP + 새 버전으로 편입.** additive(비겹침)면 자동, **겹치면 conflict 게이트(사람 머지)**.
- **파괴적 변경(DROP 등)은 항상 사람 승인 게이트.** 자동 DROP 금지 → 신뢰 유지.
- **"적용 버전"의 지상 진실은 Rockury 로컬 DB 의 기록**(반영 성공 시 저장), DB 에서 읽지 않는다.
  "실제 구조"는 Reverse 로 읽고, **둘의 스냅샷 비교로 드리프트를 판정**한다.
- **드리프트 기준선 = 마지막 post-apply 스냅샷**(설계 문서가 아니라 "우리가 마지막에 남긴 실제 모습"). 스냅샷 checksum 으로 1차 빠른 비교.
- **Seed/Mock 은 환경 스코프.** 참조/룩업 데이터(항상)와 목업/픽스처(dev·qa)를 분리 — REAL 에 목업 INSERT 금지.
- **롤백은 엔진 종속.** MySQL = DDL 암묵 커밋 → 보상 DDL(rollback 쿼리)만 가능 / PostgreSQL = DDL 트랜잭션 가능. 엔진별 전략 분기.

---

## 5. IA (확정본)

```
DB (service)
│  모듈 줄 한 줄에 다 있다(결정 D — 컨텍스트 바는 없어졌다):
│    [ 설계 | Design ▾ | Draft/커밋본 ▾ ]  Design  Versions
│  │ [ 운영 | Connection ▾ ]  Remote  Migration               │ Reference
│    └ 구획 뱃지가 자기 구획의 대상을 든다. 시점 렌즈는 설계 뱃지 안(설계에 귀속되므로).
│
│  ── 설계부 (design) ──  Env 무관, 버전 중심
├─ Design      ┬ Diagram · Definition · Seed · Mocking · Documenting · Validation
├─ Versions    ┬ Timeline(컷/락) · Version Diff            [diff ①]
│
│  ── 운영부 (ops) ──  active Env 중심, Connection 바인딩
├─ Environments   개발/QA/STG/REAL 카드 → 클릭 시 active Env 설정 · Connection 자격증명도 여기
├─ Remote     ┬ Connections(맨 왼쪽 — 대상 고르기) · Definition · Diagram(real) · Data · Query · Collection · History · Object
├─ Migration   ┬ Drift[diff ②] · Plan[diff ③] · Run · Logs  가교
│
└─ Reference                             공통 · 데이터 사전/문서
```

- **depth = Service→Module→View 3단.** Design/Connection/시점은 nav 계층이 아니라 **모듈 줄 구획 뱃지**가 든 ambient 셀렉터(결정 ②-a → **D 로 자리 개정**) → depth 를 늘리지 않는다.

### Version 은 경계 객체, 조율자는 Migration (결정 ③-a · 조율자 중 Overview 는 **D 로 삭제**)

Version 은 어느 한 모듈이 "소유"하지 않는다. 설계부가 **생산**하고 운영부가 **소비**하는 공유 객체이며, 영역마다 역할이 다르다:

```
   설계부(design)              [ VERSION ]            운영부(ops)
   Design  ──produce(cut)──▶  불변 스냅샷   ◀──consume── Environments (env가 타깃 Version 바인딩)
   · draft 편집               (공유 경계 객체)          Remote (실제 DB · 역설계)
   · 커밋본 읽기전용 열람                                Migration ◀─ 액션 조율자(가교)
   Versions (관리 홈:                                    · Forward: Version→환경 반영
    Timeline·Diff)                                       · Backward: 드리프트→새 Version
                          (대시보드 조율자 Overview 는 결정 D 로 삭제 — 아래 참조)
```

- **설계 영역**: Version = "보는 렌즈". **‘설계’ 구획 뱃지 안의 시점 손잡이**(Draft=편집 / 커밋본=읽기전용)가 운반하고, Design 전체가 그 스냅샷을 렌더한다(결정 C 이전에는 컨텍스트 바 셀렉터였다). Version 의 관리 홈은 **Versions 모듈**이지 Design 이 아니다.
- **운영 영역**: Version = "환경이 가리키는 배포 대상". 자유 선택이 아니라 Environment 가 타깃/적용 버전을 바인딩하고 **Env 셀렉터**가 운반한다.
- **조율자**: **Migration**(액션 — Forward/Backward 의 "정의된 문"). 대시보드 조율자로 두려던 **Overview 는 결정 D 로 없앴다** — 그 일을 Connections 의 바인딩 목록과 Migration › Drift 가 이미 나눠 갖고 있었다. 별도 코디네이터 서비스를 만들지 않는다.
- **레벨 주의**: Version 은 L1 서비스가 아니라 DB 서비스 내 설계↔운영 경계의 도메인 객체다.
- **Env 는 명시적으로 고를 때까지 비어 있다**(REAL 오조작 방지). 설계부/공통에선 비활성(툴팁).
- 모듈 탭은 area(설계/운영/공통)가 **시작하는 자리마다** 칩(badge)으로 구획되고, 그 칩이 자기 구획의 대상을 든다(결정 D).
- **Design › Definition** 은 같은 테이블 정의를 **Table(컬럼·제약 그리드) / SQL(DDL)** 두 형식으로 편집한다. 뷰 하나 + L4 툴바 토글(단일 소스 → 그리드↔SQL 상호 갱신).

### 데이터 구동 (구현 메모)

nav 는 "깊이는 데이터다" 원칙. 관련 타입은 `src/renderer/src/nav/types.ts`:
- `Module.area: 'design' | 'ops' | 'common'` — 탭 그룹 칩 + 컨텍스트 활성 판정
- `Service.context: ContextSelector[]` — ambient 셀렉터. `area` 가 붙으면 모듈 줄의 구획 뱃지로, 없으면 컨텍스트 바로 간다(api·uiux 는 아직 바). `Render` 를 주면 서비스가 그 칸을 직접 그린다(DB 시점 렌즈)
- 선택 상태는 `nav/useNav.ts` 의 `contextValues` (서비스 전환 시 기본값으로 리셋)

---

## 6. 결정 로그

| # | 결정 | 근거 |
|---|---|---|
| Environment > Package | 배포 바인딩의 이름을 **Environment** 로 | 네 4줄이 곧 환경. rky `IPackage`(리소스 번들)와 이름 충돌 해소 |
| Connection ≠ Environment | Connection(접속) 과 Environment(배포+이력) 를 계층 분리 | 생애주기가 다름 |
| ①-a | 환경은 Design 소속(1:N) | 단순 · 예시가 전부 단일 설계 |
| ②-a | Env 는 컨텍스트 스위처(드롭다운) | depth 안 늘림 |
| rky `IPackage` 폐기 | 리소스 번들 개념 미사용 | Environment 가 중심 |
| dialect ⊂ Design | 벤더(방언)는 Design 생성 시 1회 결정되는 고정 속성. 설계 화면·DDL 은 네이티브 구문 그대로("표를 보면 그 벤더다"), 벤더 이동은 명시적 **포팅**(리포트 딸린 새 Design 생성)으로만 | 벤더 전용 타입(INET·JSONB 등) 자유도 + DBA 가독성. 중립 모델의 손실·혼란 회피. Design 1:N Env 라 전 환경 동일 벤더가 구조적으로 보장되고, Env 생성 시 Connection 벤더 일치 검증이 공짜 |
| Design 생성 진입점 | nav 모듈이 아니라 **컨텍스트 바 Design 드롭다운의 "새 설계…" 액션**(+ 빈 상태 CTA). 관리(이름변경·삭제·포팅)는 같은 드롭다운의 "설계 관리…" 가 담당(원래 Overview 몫이었으나 **D 로 삭제**) | ②-a 유지(depth 안 늘림) · 워크스페이스 스위처 관례 |
| ③-a Version=경계 객체 (렌즈 자리는 **C 로 개정** — 컨텍스트 바 → Design 도구줄) | Version 은 설계↔운영이 공유하는 경계 객체. 설계=**렌즈**(당시엔 컨텍스트 바 Version 셀렉터, Draft/커밋본 읽기전용), 운영=**환경 바인딩**(Env 가 운반). 관리 홈=Versions 모듈. 조율자=**Migration**(액션)+**Overview**(대시보드). 별도 L1 서비스로 승격하지 않음 | 사용자 지적("양쪽에서 바인딩, 중간에서 조율") 반영. Design 이 Version 을 소유하지 않고 렌더만 |
| **C — Version 렌즈를 Design 도구줄로** (구현됨, `③-a` 의 "컨텍스트 바 셀렉터" 부분 대체) | 시점 렌즈(Draft ↔ 커밋본)를 상단 컨텍스트 바에서 빼고 **Design 세 뷰(Definition·Diagram·Seed)의 도구줄**로 내렸다. 상태는 `versions/store.ts` 의 `lens`. 컨텍스트 바에는 Design·Connection 만 남는다. Version 의 관리 홈이 **Versions 모듈**이라는 것과 경계 객체 성격(`③-a`)은 그대로 | 사용자 지적(2026-07-29): "Version 은 Design 에 귀속되고 운영은 참조만 하는데 상단에서 고르는 게 의미가 있나". 실측으로도 **운영부는 이 셀렉터를 안 읽었다**(Migration 은 화면 안에서 타깃 버전을 따로 고른다). 컨텍스트 바의 나머지 칸은 "무엇을 대상으로 하느냐"인데 렌즈만 "언제 시점으로 보느냐"라 성격이 달라 한 줄에 섞이면 위계가 흐려진다 |
| **D — 상단 한 줄: 구획 뱃지가 대상을 든다 · Overview 삭제** (구현됨, `②-a`/`C` 의 자리 부분 대체) | 상단 컨텍스트 바를 없애고, 모듈 줄의 **‘설계’ 뱃지가 Design+시점**을, **‘운영’ 뱃지가 Connection** 을 들게 했다. Overview 모듈은 삭제(Reference 는 유지). 좁은 창(<1600)에서는 손잡이의 상태말·벤더 글자부터 접어 탭 글자를 지킨다 | 사용자 지적(2026-07-30): 버전을 공통 자리에 두면 "설계에서 작업 중인 버전"과 "운영에 적용된 버전"이 헷갈린다 — 연결은 설계를 0..N 개 가질 수 있어 연결 칩에 버전을 붙일 수도 없다. 소속을 글자로 설명하는 대신 **자리로** 말한다. Overview 는 빈 화면인 채 첫 자리를 차지해 DB 첫인상이 빈 화면이었고, 하려던 일은 Connections 바인딩 목록 + Migration › Drift 가 이미 갖고 있었다 |
| **E — 모듈 이름 개정 + Connections 를 Remote 안으로** (구현됨, 2026-07-30 사용자 지시) | 모듈 이름을 화면이 하는 일에 맞췄다: **Studio → Design**(설계를 짓는 자리), **Console → Remote**(원격 실 DB 를 보는 자리). 형제 모듈이던 **Connections 는 Remote 의 첫(맨 왼쪽) 뷰**로 들어갔다. 옛 이름은 코드 id·폴더(`services/db/remote/`)·정본 파일(`db-design.md`·`db-remote.md`)·spec/CASE id(`db-remote.*`·`CASE-design-*`)·e2e 스위트 이름까지 전부 옮겼다 — **날짜가 붙은 실행 기록(`docs/qa/runs/**`)만 그때 이름을 그대로 둔다**(그 시점의 증빙이라 고치면 기록이 아니게 된다). 표기 규율: 모듈을 가리킬 때는 `Design`/`Remote`, 대상(스키마 청사진)을 가리킬 때는 `설계(Design)` — 한 줄에 둘이 같이 나오면 모듈 쪽에 "모듈"을 붙인다 | 사용자 지시: "좀 더 직관적인 이름으로". Studio·Console 은 도구 이름이라 무엇을 다루는 자리인지 말하지 않는다(Console 은 특히 "터미널"로도 읽힌다). Design ↔ Remote 는 **설계 대 실물**이라는 이 서비스의 축을 이름만으로 드러낸다. 연결 고르기는 Remote 가 무엇을 보여줄지 정하는 일이라 형제 모듈이 아니라 첫 뷰가 맞다 |
| **B — Connection 1급 분리** (구현됨, `①-a`/`dialect⊂Design` 일부 대체) | **Connection**(접속, 설계 무관)을 1급으로 승격. **Remote 는 Connection 만으로 동작**(설계 없이 모니터링/조회). **Environment = (connection × design) 바인딩**으로 Migration 에서만 필요. 컨텍스트 바 ops 셀렉터는 **Env → Connection**. dbType 은 Connection 속성(폼 자유선택); 벤더-설계 일치 검증은 Migration 바인딩 시점으로 이동 | 사용자 지적: "운영 DB 모니터링만 할 수도 있는데 왜 Design 강제?". Remote(Reverse/조회)는 접속만 필요하고, 설계는 Migration(diff 대상)에만 필요 — 관심사 분리. IA 원안 "Connection ≠ Environment" 복원 |

---

## 7. 열린 질문 / 뒤로 미룬 것

- **①-b 멀티 설계 × Connection 격자** — 한 DB 서버에 설계 A·B 공존 시. 필요해지면 Environment = (Design × Connection).
- **conflict 머지 UX** — 드리프트가 타깃 변경과 겹칠 때 사람이 결정하는 화면.
- **드리프트 로그 객체 정식 명명** — 현재 가칭 `v0.3.13-diff-<timestamp>`.
- **그룹 라벨 크롬** — 현재 칩으로 반영. 추후 조정 가능.

---

## 8. rky-mvp 타입 매핑 (구현 참고)

| 개념 | rky-mvp 타입 (`src/shared/types/db.ts`) |
|---|---|
| Design / virtual·real | `IDiagram` (`type: 'virtual' \| 'real'`, `version`, `connectionId`) |
| Version | `IDiagramVersion` (`versionNumber`, `ddlContent`, `schemaSnapshot`, `isLocked`) |
| Connection | `IConnection`, `IConnectionFormData`, `TConnectionStatus` |
| 반영 diff / 마이그레이션 | `IDiffResult`, `IMigration`, `IMigrationPack`(`status`, `updateDdl`/`rollbackDdl`/`seedDml`, `pre/postSnapshotId`, `IMigrationLog`) |
| 드리프트 | `IDriftEvent`, `IDriftCheckResult`, `TDriftStatus: fresh\|stale\|drifted\|archived` |
| 스냅샷(기준선) | `ISchemaSnapshot` / `ISnapshot` (`checksum`, `status`) |
| Validation | `IValidationReport`, `IValidationResult`, `IValidationSuite/Run` |
| 이력(체인) | `ISchemaChangelog`, `ISchemaChange` |
| Seed / Mock 환경 스코프 | `ISeedFile`, `IMockingProfile`(`TMockingEnvironment: local\|dev\|qa\|production`) |
| 엔진 분기 | `DIALECT_INFO` (mysql/mariadb/postgresql/sqlite 별 supportedObjects) |
