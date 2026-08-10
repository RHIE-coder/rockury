# gate run — 2026-08-09 · DB › Remote › Grant (권한 현황·세트·대조·적용)

- 기준 커밋(HEAD=부모): b724afc
- 범위: `db-remote.grants`(신설 Surface) — vendor · accounts · privileges · sets · diff · apply.
  사용자 요구 4가지 — ⑴ 계정 리스트 ⑵ 계정별 접근 가능한 DB·스키마·테이블 ⑶ 객체별 권한(층 표시)
  ⑷ 세트 저장·적용·대조(모니터링). QA: S8(070~073)·S8b(074~078)·S8c(079)·S9(07A~07E).
- 결과:
  - typecheck (`npm run typecheck`): **PASS**
  - test (`npm test`): **PASS** — 2,895 pass / 14 skip (직전 2,879 → **+16**).
    새 파일: `grants/mysql.test.ts` · `grants/pg.test.ts` · `grants/statements.test.ts`(main) ·
    `remote/grants/effective.test.ts` · `pattern.test.ts` · `diff.test.ts` · `gridModel.test.ts`(renderer).
    보강: `main/store/stores.test.ts`(세트 저장소 왕복 + 연결 삭제 생존 회귀).
  - build (`npm run build`): **PASS**
  - surface-verify: **status=ok** · **차단 0** · 관찰 **11**(직전 18 — `--color-info` 대비 개선으로
    다른 화면 uk/info 배지도 함께 통과, Grant 뷰 신규 관찰 0). 화면 60개(신규 Grant 포함).
  - 통합 (`GRANTS_IT=1 npx vitest run grants.integration`): **PASS** — 2개(MySQL·PG 실 DB
    GRANT/REVOKE 왕복·원복). docker test-db 전제라 기본 `npm test` 에서는 skip.
  - e2e (`npm run e2e`): **미실행** — `e2e-runner` 미바인딩(의도, 사용자 지시 시에만).
    대신 아래 "실측"으로 직접 조작해 확인, 검사는 `e2e/suites/53-db-grants.mjs`(신설, 07A~07E)에 누적.

## drift 판정

- 바뀐 코드는 전부 **`db-remote.grants`** Surface(이번 spec 에서 신설·갱신)에 걸린다 —
  어긋남 없음. IR·문장 생성기·저장소·화면·순수 로직이 스펙의 vendor/accounts/privileges/sets/diff/apply
  Section 과 1:1 대응.
- `src/renderer/src/styles/globals.css` 의 `--color-info` 조정(#3f72a8→#3a6b9e)은 **디자인 토큰**이라
  명세 노드가 없다. 전역 토큰이라 다른 화면(uk/info 배지)에도 미치지만 **대비를 높이는 방향**이라
  회귀가 아니고 surface-verify 관찰 감소로 확인됨.
- QA 정본에 "커버리지 구멍"으로 적힌 항목 없음 — 낡은 전제 점검 대상 없음.
- **명세 영향**: 신규 Surface 전 Section 이 이번 작업에서 함께 수립됨(spec-delta 참조). 미커버 신설 없음.

## 실측 (ui-preview — 빌드된 앱 + docker test-db mysql)

빌드 앱을 격리 userData 로 띄워 직접 조작. **전부 통과.**

1. **기능 본류(드라이브 8검사)** — Grant 탭 진입 → root 연결로 전 계정 목록 → 계정 선택 시
   객체×권한 표에 **층 배지**(전역/DB/테이블) → '계정에서 뜨기'로 세트 시작점 → 저장 →
   대조(요구 2·확인 1, 모자람 셀 배지) → REVOKE 기본 꺼짐 → SQL 미리보기 GRANT 문 →
   **실제 적용 → 재조회로 모자람 해소(확인 2)**. 스크린샷: `.harness/steward/artifacts/main/surface-db-remote-grant.png`.
2. **UI 감사 3회(재채점 PASS)** — 계정 현황·세트·대조·적용 흐름을 실기동으로 채점.
   1차 FAIL(mustFix 6) → 2차 NEEDS WORK(신규 3) → **3차 PASS**(12축 ≤2 없음, 실패 모드 0,
   드라이브 21/21, 콘솔 에러 0). 상세: `findings.md`.

## 남은 것

- e2e 스위트 `53-db-grants.mjs` 는 작성·누적만 — 실행은 사용자 지시 시
  (`RUN_E2E=1 git commit` 또는 `npm run e2e -- --only=53-db-grants`).
- 승인→실제 실행의 e2e 는 의도적 미검증(스모크 픽스처 권한 오염 방지) — 077·078·079 가 대신 고정.
- 후속 묶음(수용): 계정별 SHOW GRANTS 순차(대규모 병렬화) · 좁은 서버 설정 파싱(partial_revokes·
  ANSI_QUOTES·루틴 권한) · PG 컬럼 ACL.
