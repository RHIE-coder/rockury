# gate run — 2026-07-28 · UI/UX Flows (화면 사이 흐름 그래프)

- 기준 커밋(HEAD=부모): ab6a562
- 범위: 흐름 —
  이벤트 모으기·계층 배치(`flows.ts`, 순수) · 요소에 전이 붙이기(`tree.ts` findNav/setNav, 순수) ·
  Screens › 속성의 "누르면" 칸(대상은 화면 목록에서 고름) · `Flows` 그래프 화면(SVG 직접) ·
  정본(spec Surface `uiux.flows` 신설 · qa S13 + CASE-uiux-048/056).
- 결과:
  - typecheck (`npm run typecheck`): PASS
  - test (`npm test`): PASS — 977 pass / 4 skip (신규 13 — 그래프 9 · 전이 4)
  - build (`npm run build`): PASS
  - e2e (`npm run e2e`): PASS — ALL PASS(13 스위트 · 체크 256). 신규 2건 —
    화면을 하나 더 만들고 요소 속성에서 **화면 목록으로** 전이를 붙인 뒤,
    Flows 에 노드 둘이 뜨고 줄이 갈리는지 확인.
  - surface-verify: status=ok · 차단 0 · 관찰 97 (Flows 가 실제 화면이 되며 placeholder 1건 감소)
- drift:
  - **건드린 정본(갱신됨)**: `docs/spec/uiux-ia.md` — Surface `uiux.flows` 신설
    (`.edit` AC-1~4 · `.graph` AC-1~6). `docs/qa/uiux-ia.md` — S13(CASE-uiux-110~114) 신설 ·
    CASE-uiux-048(전이 붙이기) · CASE-uiux-056(실 앱) 추가.
  - **의존성 추가 없음** — 그래프 라이브러리를 들이지 않고 SVG 로 직접 그렸다(`.graph` AC-6 에 근거).
    의존성 추가는 `main` 에서 한 명만 하는 일이라 서비스 브랜치에서 피하는 게 맞다.
  - **v1 한계 명시**: 한 요소에 전이 하나(`.edit` AC-3). 조건에 따라 갈리는 전이는 조건 어휘가
    선 뒤에 다룬다.
  - 기존 e2e 기대값 1건 조정: Features 화면 개수(1 → 2) — Flows 검증에서 화면을 하나 더 만들었다.
