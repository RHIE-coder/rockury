# ui-shot — 스크린샷 증거 캡처 (Electron)

steward review 단계에서 "화면이 제대로 그려졌다"는 **증거(캡처물)**를 남길 때. `ui-preview` 와
같은 `_electron` 런치 위에서 스크린샷을 찍는다. "봤다"는 말이 아니라 **파일이 증거**다.

## 절차
1. `ui-preview` 절차대로 빌드 + 런치(격리 userData, CSS/text 로케이터).
2. 검증할 화면으로 이동한 뒤 `await page.screenshot({ path: '<scratchpad>/<이름>.png' })`.
3. 캡처 경로를 리뷰 산출물에 **첨부**한다.
4. 그 이동 경로가 회귀 가치가 있으면 `ui-preview` 의 축적 규칙대로 `e2e/suites/NN-*.mjs` 로 승격.
