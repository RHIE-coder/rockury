# gate run — 2026-07-29 · Infra · 명세에만 있던 인수조건 채우기 + AWS 표본 + 자격증명 누출 차단

- 기준 커밋(HEAD=부모): f59c4a3
- 범위: 직전 게이트가 찾아 낸 **미구현 인수조건 일곱**을 채웠다 —
  `design.canvas` AC-6(PNG/SVG 내보내기)·AC-7(노드 검색·포커싱) ·
  `reconcile.result` AC-3(대조 배지) · `reconcile.bootstrap` AC-2(채울 순서) ·
  `providers.credentials` AC-4(연결 시험) · `types.presets` AC-3(프리셋 만들기)·AC-4(승격).
  더해서 AWS 탐침 고정 표본 검증과 **자격증명 누출 차단**(아래 ⭐).
- 결과:
  - typecheck (`npm run typecheck`): **PASS**
  - test (`npm test`): **PASS** — 1,150 pass / 4 skip (직전 1,060 → **+90**).
    신규 모듈 옆 테스트: `design/export` · `design/search` · `reconcile/overlay` ·
    `catalog/connectionTest` · `catalog/presets` · `catalog/builtin/aws`(표본 22건) ·
    `ipc/infra/command`(가리기 7건).
  - build (`npm run build`): **PASS**
  - e2e (`npm run e2e`): **PASS** — 15/15 스위트 · **315체크 실패 0 · 미실행 0**(직전 289 → +26).
    `--no-db` 없이 돌려 도커를 실제로 읽었다.
  - surface-verify: **status=ok** · 차단 0.
- ⭐ 이 회차의 핵심 — **e2e 가 실제 보안 결함을 잡았다**:
  연결 시험 버튼을 붙이자 `CASE-icat-101`("시험 결과에 평문 자격증명이 안 보인다")이 **FAIL** 했다.
  원인은 우리 코드가 아니라 **상대편**이었다 — AWS CLI 가 프로필을 못 찾으면
  `The config profile (<값>) could not be found` 라고 **자격증명 값을 되뱉는다.**
  명령 조립 단계의 비밀 제거(`display`)는 *우리가 만든 문자열*에만 통하므로 이 길이 열려 있었다.
  → `redactSecrets` 가 표준출력·표준오류·실행오류를 **프로세스 경계를 넘기 전에** 훑어
  값을 참조 표기(`{{cred.<id>}}`)로 바꾼다. **가리되 자리는 남긴다.**
  이 사건은 "실패 사유를 그대로 보인다(AC-4)"와 "평문은 어디에도 없다(AC-3)"가 부딪히는 자리였고,
  명세에 **AC-6 을 신설**해 해법을 못박았다.
- drift:
  - **갱신된 정본**: `docs/spec/infra-architecture.md` — 마일스톤 M1·M2 를 ✅ 로 되돌리고
    **✅ 의 뜻을 못박았다**(인수조건이 전부 코드에 있고 테스트가 덮을 때만 ✅). 「아직 구현 안 된
    인수조건」 표는 비었으므로 제거하고, 대신 「의식적으로 미룬 것」과 「AWS 는 어디까지
    검증됐나」 절로 대체했다. `design.canvas` AC-6·AC-7, `reconcile.result` AC-3,
    `reconcile.bootstrap` AC-2 에 왜 그렇게 만들었는지를 적었다.
  - `docs/spec/infra-catalog.md` — `providers.credentials` **AC-6 신설**,
    AC-4(연결 시험) 확장, `types.presets` AC-3·4 의 `(미구현)` 표기 제거 + 구현 규칙 명시.
  - `docs/qa/infra-catalog.md` — 시나리오 **S1c**(프리셋·승격) · **S1d**(연결 시험) ·
    **S5b**(AWS 고정 표본) 신설, `CASE-icat-102`(가리기) 추가, 앱 흐름 케이스 보강.
  - `docs/qa/infra-architecture.md` — 시나리오 **S5b**(내보내기·검색·배지·채울 순서) 신설,
    `CASE-iarch-074` 를 **실제로 검증하는 것에 맞게** 고쳐 적었다(캡처 성공까지 — 내려받기는
    브라우저 계층이라 확인하지 않는다). `CASE-iarch-090~092` 추가.
  - **커버리지 구멍 해소**: 직전 회차에 "정의만 있고 도는 코드가 없다"로 남겨 둔
    `CASE-iarch-074` 가 이번에 켜졌다.
  - 남은 미구현(명세가 앞선 자리)은 **0** 이다. 의식적으로 미룬 것(`node-doc.mcp` AC-4 ·
    `design.versions` AC-1 · M4 · M5)은 각자 자기 자리에 사유와 함께 적혀 있다.
- 판정: **PASS**
