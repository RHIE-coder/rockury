# gate run — 2026-08-07 · DB › Data · 쪽 넘김 재설계 + 필터 개선(표별 기억·검색 카드·켬끔·저장 필터)

- 기준 커밋(HEAD=부모): 26ffe1c
- 범위: `db-remote.data.paging`(신설) · `db-remote.data.filter`(신설) · `db-remote.data.saved-filter`(신설) ·
  `db-remote.data.toolbar` AC-1(정본 위치 이동).
  사용자 요구 6가지 — ⑴ 총 쪽수·직접 이동·처음/마지막·쪽 옮기면 맨 위로 ⑵ 조건을 표마다 기억
  ⑶ 컬럼·연산자를 검색 카드로 고르기 ⑷ 조건을 지우지 않고 전체 보기 ⑸ 이름 붙인 저장 필터(표별,
  표 삭제 시 정리) ⑹ 컬럼이 사라진 저장 필터를 빨갛게 막기.
- 결과:
  - typecheck (`npm run typecheck`): **PASS**
  - test (`npm test`): **PASS** — 2,815 pass / 12 skip (직전 2,773 → **+42**).
    새 파일: `data/paging.test.ts` · `data/savedFilter.test.ts` · `ui/searchSelect.test.ts`.
    보강: `data/sqlBuilder.test.ts`(buildCount) · `data/storeLogic.test.ts`(표별 기억·늦은 셈) ·
    `main/store/stores.test.ts`(저장 필터 저장소 왕복).
  - build (`npm run build`): **PASS**
  - surface-verify: **status=ok** · **차단 0** · 관찰 18(기존 기준선 수용).
  - e2e (`npm run e2e`): **미실행** — `e2e-runner` 미바인딩(의도). 이 프로젝트는 사용자 지시가
    있을 때만 돌린다. 대신 아래 "실측"으로 같은 흐름을 직접 조작해 확인하고, 검사는
    `e2e/suites/08-remote-query-data.mjs` 에 **28개 이상 누적**했다(CASE-remote-04K~04P).

## 실측 (ui-preview — 빌드된 앱 + docker test-db mysql)

세 번의 드라이브로 나눠 확인. **전부 통과.**

1. **쪽 넘김·필터·저장 필터 본류(28검사)** — `audit_logs` 217행에서 25/p → **총 9쪽** 계산,
   쪽 번호 직접 이동, `scrollTop` 0 으로 되돌아옴, 처음/마지막 뛰기, `9999` 입력 → 마지막 쪽 클램프.
   컬럼 검색 `ema` → `email`(그리고 `id` 는 빠짐), 연산자 검색 `비슷` → `LIKE`, Enter 로 선택.
   끄면 전체 복귀 + 조건 줄 유지, 켜면 같은 조건 재적용. 저장/목록/되살리기. 표 A→B→A 왕복에
   조건 유지 + B 에는 안 옮겨붙음.
2. **표 삭제 정리** — `filter_probe` 를 만들어 저장 필터를 붙이고 `DROP TABLE` → 새로고침 →
   그 표 것만 사라지고 `users` 것은 남음(2개 → 1개).
3. **못 쓰는 저장 필터 경고** — `ALTER TABLE … DROP COLUMN nickname` 뒤 해당 저장 필터에만 표식,
   문구 `nickname 컬럼이 없어 적용할 수 없습니다`, 적용 버튼 `disabled`, 색은
   글자 `rgb(176, 82, 76)` · 테두리/바탕 `oklab(0.55 0.11 0.05 / …)` — 모두 `destructive` 토큰.
   캡처: `.harness/steward/artifacts/main/review-saved-filter-broken.png`

## 이 회차의 핵심

- **`WHERE` 절을 두 벌로 쓰지 않았다.** 총 쪽수를 세려면 조회와 같은 조건이 필요한데, 절을
  복사해 두면 언젠가 한쪽만 고쳐져 "보이는 행"과 "총 쪽수"가 조용히 어긋난다. `whereClause()`
  하나를 `buildSelect`·`buildCount` 가 같이 쓴다(`CASE-remote-060` 이 두 문자열의 포함 관계를 고정).
- **"모름"을 1급 상태로 뒀다.** `COUNT(*)` 를 행 조회와 따로 띄우는 이상 총 쪽수는 `null` 일 수
  있다. 그 상태에서 이동을 막으면 셈이 느린 큰 표에서 아무 데도 못 간다 — 그래서 위쪽 상한만
  걸지 않고, 마지막 쪽 버튼만 꺼진다(`CASE-remote-061`).
- **경쟁 조건을 두 군데서 막았다.** 늦게 온 셈(일련번호)과 늦게 온 저장 필터 목록(주인 표식).
  둘은 같은 종류인데 처음엔 한쪽만 막고 있었고, 리뷰에서 나머지가 드러났다.
- **표별 기억의 쓰기 통로를 하나로 뒀다**(`patchView`). 예전 결함이 정확히 "화면이 든 초안과
  스토어가 어긋난 것"이었으므로, 두 자리를 따로 고칠 수 있게 두면 같은 병이 재발한다.
- **지우는 판정은 안 지우는 쪽으로 기울였다.** 표 삭제 정리는 역설계가 **성공한 뒤**, 그때 실제로
  읽은 스키마 안에서만, 표 목록이 비지 않았을 때만 돈다 — "목록에 없다"는 삭제 말고도 범위 축소·
  권한 누락·읽기 실패를 뜻할 수 있고, 잘못 지우면 되돌릴 방법이 없다(`CASE-remote-069` 가
  **아무것도 안 지우는 경우**를 함께 고정).

## 남은 것

- `COUNT(*)` 는 조건 없는 초대형 표에서 초 단위가 걸릴 수 있다(목록은 안 막힘). 거슬리면
  "행 수 세기 끄기" 손잡이가 다음 수순.
- 지금 걸린 조건의 기억은 **세션 한정**(의도). 앱을 넘겨 남기려면 저장 필터를 쓰라는 안내가
  화면에 없다.
