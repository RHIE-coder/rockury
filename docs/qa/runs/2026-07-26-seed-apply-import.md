# gate run — 2026-07-26 · 시드 반영(설계→운영) + 되먹임(운영→설계)

- 기준 커밋(HEAD=부모): 510e444
- 범위: (b) 설계→운영 반영 + (c) 운영→설계 되먹임 구현 —
  PK 획득 방식 선언(`db`/`seed` + 생성 규칙 템플릿·결정적 UUID) · 반영 계획 생성기(`seedApplyPlan`) ·
  되먹임 후보 생성기(`seedImportPlan`) · 환경 변수 값 저장(OS 키체인 암호화, IPC 4채널·MCP 제외 등재) ·
  `Migration › Seed` 화면(계획 미리보기 → 트랜잭션 게이트 → 커밋 / 실 DB 읽기 → 선별 채택) ·
  정본(spec `db-migration.seed` 신설 + `apply-contract` AC-2/7/8/9 보강 · qa S6~S8 · 용어사전).
  (주의: 작업 트리에 다른 세션의 미커밋 변경이 함께 있다 — 커밋 범위는 사용자 판단.)
- 결과:
  - typecheck (`npm run typecheck`): PASS
  - test (`npm test`): PASS — 733 pass / 4 skip (신규 34: seedApplyPlan 24 · seedImportPlan 9 · 기본 기준값 회귀 1)
  - build (`npm run build`): PASS
  - e2e (`npm run e2e`): PASS — ALL PASS(183). 신규 11 — **실 MySQL 왕복**:
    역설계 설계에 `roles` 세트 등록 → 짝짓기 기준(name) → 계획(넣기 1·막는 것 0) → 적용 →
    **커밋 전 실 DB 에 없음** → 커밋 후 심어짐 → 재계획 시 할 일 없음(멱등) →
    실 DB 값 변경 후 되먹임 `값이 다름` 후보 → 채택 → 설계 시드 반영 → **심은 행 삭제로 DB 원복**
  - surface-verify: status=ok · 차단 0 · 관찰 96. 기준선 갱신 내역은 **신규 leaf(db/migration/seed)의
    상속 크롬 2건 추가 + 더 이상 발생하지 않는 4건 제거**뿐임을 diff 로 확인했다.
- drift:
  - 건드린 정본(갱신됨): `docs/spec/db-studio.md` — `db-migration.seed` Surface 신설(AC-1~6),
    `apply-contract` 를 "구현됨"으로 바꾸고 AC-2(PK 획득·결정적 UUID 한계 명시)·AC-7(자동 채택 금지)·
    AC-8(게이트)·AC-9(변수 값 암호화) 추가. `docs/qa/db-studio.md` — S6(CASE-070~077)·S7(080~084)·
    S8(090~094) 신설. `docs/glossary.md` — 반영 계획 · PK 획득 방식.
  - `MigrationLogKind` 에 `seed-apply` 추가: 기존 종류(baseline/drift/apply) 동작 불변 → 명세 영향 없음.
  - `defaultNaturalKey` 회귀 수정(자동증가만 걸러 `DEFAULT (UUID())` PK 가 기본 기준으로 들어갔다):
    declaration AC-8 이 이미 규정한 판정과 코드를 일치시킨 것 → 정본 변경 없음, 회귀 테스트 추가.
- findings: 실 앱 드라이브에서 발견한 결함 1건(위 `defaultNaturalKey`) 해소 + 회귀 테스트.
  구조적 안전장치 확인: 커밋 전 미반영·막는 것 있으면 반영 거부·삭제 후보 기본 제외·평문 비밀 미저장.
- 판정: **PASS**
