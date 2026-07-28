# gate run — 2026-07-28 · UI/UX Style (디자인 토큰 + 컴포넌트 매트릭스)

- 기준 커밋(HEAD=부모): d64a7ee
- 범위: 프로젝트별 디자인 토큰 —
  `uiux_projects.tokens` 칸(덮어쓴 값만) · IPC 2채널 · preload 창구 ·
  토큰 병합·차이 추리기(`preview/tokens.ts`) · `Style › Tokens`(편집 + 즉시 표본) ·
  `Style › Components`(역할별 매트릭스) · 미리보기가 프로젝트 토큰을 쓰도록 연결 ·
  MCP 2종(`get_ui_tokens` · `set_ui_tokens`) ·
  정본(spec Surface `uiux.style` 신설 + §8 도구 표 갱신 · qa S12 + CASE-uiux-055).
- 결과:
  - typecheck (`npm run typecheck`): PASS
  - test (`npm test`): PASS — 964 pass / 4 skip (신규 7 — 토큰 병합)
  - build (`npm run build`): PASS
  - e2e (`npm run e2e`): PASS — ALL PASS(13 스위트 · 체크 254). 신규 6건 —
    처음엔 전부 기본값 → 색을 바꾸면 **바꾼 개수**를 알림 → Components 매트릭스 →
    **Canvas 미리보기의 computed style 이 그 색을 쓴다**(Style 이 있는 이유) →
    에이전트가 `get_ui_tokens` 로 읽고 `set_ui_tokens` 가 준 값만 바꾼다.
  - surface-verify: status=ok · 차단 0 · 관찰 98 (Style 두 뷰가 실제 화면이 되며 placeholder 2건 감소)
- drift:
  - **건드린 정본(갱신됨)**: `docs/spec/uiux-ia.md` — Surface `uiux.style` 신설
    (`.tokens` AC-1~6 · `.components` AC-1~4 · "아직 없는 것" 3항), §6 미리보기 절에 토큰 출처를
    사실대로(조각 편집은 아직 미구현) 갱신, §8 도구 표에 토큰 2종 추가.
    `docs/qa/uiux-ia.md` — S12(CASE-uiux-100~102) 신설 · CASE-uiux-055 추가.
  - **명시한 한계**: 앱별 덮어쓰기 · 조각(HTML) 편집 · 3계층 토큰은 미구현 —
    Surface 문서의 "아직 없는 것"에 적었다(눙치지 않음).
  - 기존 커버리지 구멍(컨텍스트 바 라벨 대비)의 전제는 여전히 유효(이번에도 그 파일을 안 건드렸다).
