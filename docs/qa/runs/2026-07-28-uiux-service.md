# gate run — 2026-07-28 · UI/UX 서비스 (위계·구조 편집·미리보기·끌어놓기·능력 인덱스·MCP)

- 기준 커밋(HEAD=부모): 069875d
- 범위: UI/UX 서비스 신설 —
  위계 6층(Project>Application>Service>Surface>Section>Component) + 안정 주소 ·
  저장소(`uiux_*` 5테이블) · IPC 7채널 · preload 창구 ·
  `Screens › Spec`(위계 편집 + 화면 구조 편집) · `Screens › Canvas`(미리보기 + 끌어놓기) ·
  `Features`(능력 인덱스 + 완성 상태 집계) ·
  미리보기 엔진(논리 없는 조각 치환 · 기본 토큰 한 벌 · 그림자 뿌리 격리 · 뷰포트 폭) ·
  MCP 6종(읽기 3 · 쓰기 3, 지목은 안정 주소) ·
  정본(spec `uiux-ia.md` 신설 §1~§9 + Surface 4개 · qa `uiux-ia.md` S1~S11).
  공용 테스트 2건 수정(아래 drift 참고).
- 결과:
  - typecheck (`npm run typecheck`): PASS
  - test (`npm test`): PASS — 957 pass / 4 skip (신규 96: 주소 8 · 내용 10 · 트리 17 ·
    선언 9 · 치환 10 · 렌더 17 · 끌어놓기 13 · 집계 9 · 기타 3)
  - build (`npm run build`): PASS
  - e2e (`npm run e2e`): PASS — ALL PASS(13 스위트 · 체크 242). 신규 스위트 `13-uiux-spec` 31건(2026-07-29 번호 구간 규칙으로 **`20-uiux-spec` 으로 개명**) —
    프로젝트→앱→서비스→화면 만들기 · **주소 중복 거절** · 영역·요소 편집 · 저장 잔존 ·
    미리보기 렌더(그림자 뿌리 안까지 확인, 토큰 변수 상속) · **실제 마우스로 끌어 순서 바꾸기**
    (가이드 선 표시 → 놓기 → Spec 구조에 반영) · **MCP 한 바퀴**(도구 목록 · 안정 주소로 위계 읽기 ·
    화면 구조 읽기 · 상태 기록 · 없는 주소는 안내로 반환) · 그 기록이 Features 집계에 나타남
  - surface-verify: status=ok · 차단 0 · 관찰 101. uiux 기준선은 화면이 2→10 leaf 로 늘며
    placeholder 배지 대비(4.35) 항목이 늘었다가, 실제 화면(Spec·Canvas·Features)이 들어오면서
    다시 줄었다. **다른 서비스 기준선은 되돌렸다** — 갱신이 좌표만 흔든 노이즈였고(x −90·y −58,
    7/27 이후 커밋들이 만든 기존 어긋남) 판정기가 좌표를 매칭에 쓰지 않아 옛 값으로도 전부 수용된다.
- drift:
  - **건드린 정본(신설·갱신됨)**: `docs/spec/uiux-ia.md` — Service `uiux` 신설.
    §1 정체 · §2 위계 6층 + 이름 충돌(두 개의 "Service") · §3 세 축 · §4 nav · §5 정본 저장 ·
    §6 화면 편집 모델(자유 배치를 안 쓰는 근거 · 미리보기 렌더 · 끌어놓기) · §7 데이터 모델(INV-1~4) ·
    §8 검증(판정=에이전트/기록=앱 + 열린 도구 표) · §9 원형(flare) 대조.
    Surface `uiux.shell` · `uiux.screens.spec` · `uiux.screens.canvas` · `uiux.features`.
    `docs/qa/uiux-ia.md` — S1~S11 신설(CASE-uiux-001~093).
  - **공용 테스트 2건 수정** → `docs/qa/parallel-dev.md` CASE-pdev-020 정의 갱신.
    `migrations.test.ts`·`assemble.test.ts` 가 "목록이 줄면 실패"라는 의도를 **정확히 일치**로
    구현해, 어떤 서비스든 자기 테이블·창구를 더하면 깨졌다(병렬 개발 규칙과 정면 충돌).
    포함 검사로 바꿔 의도를 보존했고, 유령·중복 검사는 기존 케이스(CASE-pdev-022·032)가 맡는다.
    UI/UX 가 DB 다음으로 처음 테이블·창구를 만드는 서비스라 지금까지 드러나지 않았다.
  - **명세가 코드보다 앞서 있던 곳 2건을 이번 게이트에서 맞췄다**:
    ① 내보내기(§5) — 방향만 확정이고 미구현이라 그 사실을 명시.
    ② 뷰포트 덮어쓰기(§4) — 지금 구현은 **폭까지**이고 덮어쓰기 자체는 모델에 자리만 있음을 명시.
  - **미구현으로 명시된 것**(명세 흡수 현황 표): `uiux.screens.review` · `uiux.flows` ·
    `uiux.rules` · `uiux.style` · `uiux.versions` — placeholder 이며 각 화면을 지을 때 인수조건을 채운다.
  - **커버리지 구멍(전제 재확인)**: `docs/qa/uiux-ia.md` 기준선 메모의 "컨텍스트 셀렉터 라벨
    대비 4.35" — 원인이 공용 `shell/ContextBar.tsx` 의 `text-muted` 라는 전제는 **지금도 유효**하다
    (이번 변경이 그 파일을 건드리지 않았다). `main` 에서 다섯 서비스 영향을 보며 고칠 사안.
</content>
