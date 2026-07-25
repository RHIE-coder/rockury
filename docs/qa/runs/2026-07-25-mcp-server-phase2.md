# gate run — 2026-07-25 · MCP 서버 2단계(쓰기 도구 4종)

- 기준 커밋(HEAD=부모): f895182
- 범위: MCP 쓰기 도구 4종(create_design/update_design/set_schema/create_version) + 설계 스코프
  저장(replaceForDesign) + 렌더러 리하이드레이션(store:changed) + 보안/정확성 리뷰 수정(R1~R5) +
  명세(docs/spec/mcp-server.md tools.write·rehydration) + QA 정본(docs/qa/mcp-server.md) + e2e 쓰기 흐름.
- 결과:
  - typecheck (`npm run typecheck`): PASS
  - test (`npm test`): PASS — 470 pass / 4 skip (신규: stores CASE-030~033 · tools 쓰기·리하이드레이션 ·
    coverage 삭제류 핀 · http 8종 · ddl quoteId 주입차단 4 · designScope diff/merge/reconcile)
  - build (`npm run build`): PASS
  - e2e (`npm run e2e`): PASS — ALL PASS (MCP 쓰기 7체크: tools/list 쓰기4종·삭제류 부재·
    create_version→타임라인 즉시반영·set_schema→Studio 즉시반영·미상설계 isError 포함)
  - surface-verify (`npm run surface-verify`): status=ok · 차단 0 · 관찰(baseline) 99
- drift:
  - 건드린 정본: `docs/spec/mcp-server.md`(tools.write AC-1~7·rehydration AC-1~3 신설, roadmap 소거,
    공통 불변식 2건 추가) · `docs/qa/mcp-server.md`(신설 TestPlan CASE-mcp-001~073) — 이번 작업에서 갱신.
  - ddl.ts quoteId 이스케이프·저장 스코프 전환(replaceForDesign): 정상 식별자 출력·사용자 편집 지속
    동작 불변 → db-console 정본 노드 동작 변화 없음(명세 영향 없음).
  - QA 커버리지 구멍(http.lifecycle AC-1/4/5·키체인 실경로·agents 시각상태): 전부 전송/생명주기 계층으로
    이번 변경과 무관 — 전제 유효(낡지 않음).
- findings: HIGH 1(SQL 주입) + MED 4 해소(회귀 테스트 동반). 잔여 MED/LOW 는 findings.md 에 수용/후속 기록.
