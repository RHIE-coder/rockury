# gate run — 2026-07-28 · UI/UX Screens › Review (요소에 붙는 의견)

- 기준 커밋(HEAD=부모): 85c0d3f
- 범위: 화면 위 요소에 의견을 남기고 에이전트가 읽는 경로 —
  `uiux_notes` 테이블 · IPC 4채널 · preload 창구 · `Screens › Review` 화면
  (미리보기 + 의견 목록, 셸의 오른쪽만 교체) · 미리보기에 "의견 있음" 점선 표시 ·
  MCP 2종(`list_ui_notes` 읽기 · `resolve_ui_note` 해결) ·
  정본(spec Surface `uiux.screens.review` 신설 + §8 도구 표 갱신 · qa CASE-uiux-054).
- 결과:
  - typecheck (`npm run typecheck`): PASS
  - test (`npm test`): PASS — 957 pass / 4 skip (신규 0 — 순수 로직 추가 없음, 아래 drift 참고)
  - build (`npm run build`): PASS
  - e2e (`npm run e2e`): PASS — ALL PASS(13 스위트 · 체크 248). 신규 6건 —
    요소를 골라 의견 남기기 → 목록에 쌓임 → **미리보기에 점선 표시**(computed style 로 확인) →
    에이전트가 `list_ui_notes` 로 **요소 주소째** 읽기 → `resolve_ui_note` 로 넘기면 미해결에서 빠짐.
  - surface-verify: status=ok · 차단 0 · 관찰 100 (Review 가 실제 화면이 되며 placeholder 1건 감소)
- drift:
  - **건드린 정본(갱신됨)**: `docs/spec/uiux-ia.md` — Surface `uiux.screens.review` 신설
    (`.pin` AC-1~5 · `.list` AC-1~6), §8 열린 도구 표에 의견 2종 추가 + "의견은 사람 → 에이전트
    방향이라 만들기를 열지 않는다" 근거 명시. `docs/qa/uiux-ia.md` — CASE-uiux-054 신설.
  - **순수 로직 신규 없음** — 의견은 저장·조회·표시가 전부이고 판정 로직이 없다. 화면 동작은
    Surface 인수조건이 덮고 실 앱 흐름은 e2e 6건이 덮는다(CLAUDE.md 테스트 의무 4항).
  - **연쇄 삭제 확장**: 화면을 지우면 그 의견도 지운다(INV-4 와 같은 이유 — 가리킬 곳이 없으면
    유령이 된다). `uiux.screens.review.list` AC-5 에 명시.
