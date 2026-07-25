# gate run — 2026-07-26 · Studio › Seed (시드 세트 저작 + 버전 Diff)

- 기준 커밋(HEAD=부모): f895182
- 범위: Studio·Console 네비 순서 변경(`Definition → Diagram → …`) + Studio › Seed 신설 —
  시드 세트 선언(자연키·무시 컬럼·관리 강도) · 행 저작 그리드 · 변수 자리표시자 ·
  설계 스코프 저장(`seed_sets` + IPC 2채널 + MCP 커버리지 등재) · 버전 스냅샷에 시드 동봉 ·
  Version Diff 시드 섹션 + 정본(`docs/spec/db-studio.md` 신설 · `docs/qa/db-studio.md` 신설) + e2e 누적.
  (주의: 작업 트리에 이전 작업 MCP 서버 2단계 등 **미커밋 변경이 함께 있다** — 커밋 범위는 사용자 판단.)
- 결과:
  - typecheck (`npm run typecheck`): PASS
  - test (`npm test`): PASS — 574 pass / 4 skip
    (신규 79: `workspaces/seed/seedSet` 20 · `workspaces/seed/seedRows` 21 · `versions/seedDiff` 34 ·
     `main/store/stores`(시드 세트 왕복·스코프 격리·혼입 롤백·설계 삭제 연쇄) 4)
  - build (`npm run build`): PASS
  - e2e (`npm run e2e`): PASS — ALL PASS(137 체크). 신규 23:
    빈 상태 CTA · 등록 후보에서 뷰 제외 · 세트 등록 · 자동증가 PK 자연키 경고 · 자연키 지정 후 경고 해제 ·
    무시 컬럼 · 셀 입력 · 중복 자연키 두 행 오류 · 중복 해소 · 변수 셀·변수 목록 · 전권 경고 ·
    저장소 반영 · 컷 시 시드 행 수 · Version Diff 시드 섹션·세트 델타 · 콜드 재시작 후 잔존(세트·행·변수) ·
    **재시작 직후 편집 반영(no-op 회귀)**
  - surface-verify (`npm run surface-verify`): status=ok · 차단 0 · 관찰(baseline) 96
- drift:
  - 건드린 정본(이번 작업에서 갱신): `docs/spec/db-studio.md` 신설(Service + Surface `db-studio.seed` +
    Section 6개, 리뷰 결과로 AC-1b·AC-3b·persistence AC-4·version-diff AC-1 보강) ·
    `docs/qa/db-studio.md` 신설(CASE-studio-001~045) · `docs/spec/db-console.md`(Definition 의 nav 위치 문구를
    새 순서로) · `docs/glossary.md`(시드·시드 세트·자연키·무시 컬럼·관리 강도·변수 자리표시자).
  - `designScope.changedDesignIds` 제네릭화: 알고리즘·동작 동일(시드가 같은 저장 스코프 판정을 재사용) →
    mcp-server 정본 `tools.write AC-4` 동작 변화 없음(명세 영향 없음).
  - `SchemaDiffPanel` 의 표기 컴포넌트 export: 렌더 결과 불변(중복 제거 목적) → 명세 영향 없음.
  - 네비 순서 변경: 각 뷰의 동작은 불변, 기본 진입 뷰만 Definition 으로 바뀜 → 문구 갱신으로 정본 정렬 완료.
  - QA 커버리지 구멍(`docs/qa/mcp-server.md`): http.lifecycle AC-1/4/5 · 키체인 실경로 · agents 시각상태 —
    전부 MCP 전송/생명주기 계층으로 이번 변경과 무관, 전제 유효(낡지 않음).
  - 미커버 영역 알림: **Studio 의 Definition·Diagram Surface 는 여전히 정본 미흡수**다(구현만 존재).
    `docs/spec/db-studio.md` 의 흡수 현황 표에 그 사실을 명시해 뒀다 — 후속에서 흡수할지는 사용자 판단.
- findings: HIGH 1(재시작 직후 편집 no-op) + MED 4(비교불가 세트 침묵 · 패널 중복 · 헤더 배지/토글 중복 ·
  비활성 토글 대비) **전부 해소**(회귀 테스트·정본 AC 동반). 잔여 LOW 4건은 `findings.md` 에 근거와 함께 수용.
- 판정: **PASS**
