# e2e — 빌드된 Electron 앱 구동 스모크

`npm run build` 로 만든 앱(`out/main/index.js`)을 Playwright `_electron` 으로 실제 띄워 핵심 플로우를 검증한다.
단위 로직은 `npm test`(vitest)가 덮고, 여기서는 "실제 앱이 뜨고 흐름이 돈다"를 확인한다.

## 실행
```bash
npm run build && npm run e2e
```
(스모크가 앱 로컬 DB `~/Library/Application Support/Rockury/rockury.db` 를 실행 전 초기화하므로 clean 시드로 검증됨)

## ⚠ 이 앱을 구동할 때의 함정 (실측)
- **접근성 쿼리(`getByRole` 등)는 이 Electron 창을 크래시**시킨다 → **CSS/text 로케이터만** 사용.
- Radix 메뉴아이템에서 곧바로 Dialog 를 열면 body `pointer-events:none` 이 잔존 → 앱 UI 가 코드에선 이미 `setTimeout(onSelect,0)` 로 회피(ContextBar).
- `node:sqlite` 는 ExperimentalWarning 를 stderr 로 출력(무해, 필터 가능).
- 선택 커밋은 `button[type="submit"]` 등으로 다이얼로그 버튼을 특정(타임라인의 "버전 컷"과 다이얼로그 "… 컷"이 텍스트로 겹침).

## 확장
새 플로우는 `smoke.mjs` 패턴(launch → click(CSS) → assert → screenshot)을 복사해 추가.
Electron 구동/드라이브를 프로젝트 스킬로 박제하려면 `/run-skill-generator` 사용 권장.
