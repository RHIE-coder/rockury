# gate run — 2026-07-28 · UI/UX Rules + Versions (남은 두 모듈)

- 기준 커밋(HEAD=부모): (Flows 커밋)
- 범위:
  **Rules** — 규칙을 문장으로 푸는 순수 로직(`rules.ts`) · 속성의 규칙 편집(형식·최대 길이·활성·문구,
  고치는 즉시 문장으로) · `Rules` 모아보기(화면별로 묶음).
  **Versions** — 스냅샷 뜨기·비교·번호 매기기(`versions.ts`, 순수) · `uiux_versions` 저장 경로
  (IPC 4채널) · `Versions › Timeline`(굳히기·이력) · `Versions › Diff`(고른 버전 ↔ 지금 설계) ·
  MCP 2종(`list_ui_versions` · `get_ui_version` — 읽기만).
  그리고 **placeholder 화면이 하나도 남지 않아** 서비스 선언에서 PlaceholderView 를 걷어냈다.
- 결과:
  - typecheck (`npm run typecheck`): PASS
  - test (`npm test`): PASS — 996 pass / 4 skip (신규 19 — 규칙 9 · 버전 10)
  - build (`npm run build`): PASS
  - e2e (`npm run e2e`): PASS — ALL PASS(13 스위트 · 체크 265). 신규 9건 —
    규칙을 붙이면 그 자리에서 문장으로 → Rules 에 모임 /
    설계를 굳히고 → 이름을 고친 뒤 → 비교에서 **"이름 A → B"** 로 짚힘, 볼 것이 위로 /
    에이전트는 버전을 읽지만 **컷·삭제는 못 한다**.
  - surface-verify: status=ok · 차단 0 · 관찰 94 (남은 placeholder 3건이 실제 화면이 되며 감소)
- drift:
  - **건드린 정본(갱신됨)**: `docs/spec/uiux-ia.md` — Surface `uiux.rules`(`.edit`/`.list`) ·
    `uiux.versions`(`.timeline`/`.diff`) 신설, 흡수 현황 표에 **"placeholder 는 하나도 남지 않았다"** 명시.
    `docs/qa/uiux-ia.md` — S14(120~123) · S15(130~134) 신설 · CASE-uiux-057/058 추가.
  - **v1 한계 명시**: Rules 는 **요소에 직접 붙은 것만** — 계층에서 흘러내리는 기본값은 스코프 편집이
    선 뒤에(`uiux.rules.list` AC-4 와 화면 문구 양쪽에 적었다).
  - **에이전트에 안 여는 것**: 버전 컷·삭제 — "여기까지가 한 덩어리"는 사람의 판단이라
    에이전트가 임의로 끊으면 경계의 뜻이 사라진다(coverage 사유에 기록).
