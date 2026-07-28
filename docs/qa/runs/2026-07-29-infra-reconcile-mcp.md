# gate run — 2026-07-29 · Infra · 대조 결과 MCP 노출 + 순수 로직 공용 자리 이전

- 기준 커밋(HEAD=부모): 4c2dafb
- 범위: `node-doc.mcp` AC-4 — **대조 결과를 MCP 로 읽기 전용 노출**.
  전제 작업으로 짝짓기·판정 순수 로직을 `src/shared/infra/reconcile/` 로 옮기고,
  상태 사전·비교 필드를 `src/shared/infra/types.ts` 로 올렸다.
- 결과:
  - typecheck (`npm run typecheck`): **PASS**
  - test (`npm test`): **PASS** — 1,215 pass / 4 skip (건수 동일: 테스트가 **옮겨졌을 뿐** 잃지 않았다).
    `match.test.ts`·`diff.test.ts` 가 `src/shared/infra/reconcile/` 로 이동(21건).
  - build (`npm run build`): **PASS**
  - e2e (`npm run e2e`): **PASS** — 17/17 스위트 · **359체크 실패 0**(직전 351 → +8 · `CASE-iarch-095`·`096`).
  - surface-verify: **status=ok** · 차단 0.
- 이 회차의 핵심:
  - **규칙을 두 벌 들지 않았다.** 메인에 대조 판정을 다시 쓰는 것이 가장 쉬웠지만, 그러면
    **화면과 에이전트가 서로 다른 답을 말한다.** 규칙 자체를 공용으로 올리고 양쪽이 같은 함수를 부른다.
    `CASE-iarch-095` 가 "판정 종류가 화면과 같다"를 확인한다.
  - **입력을 최소 모양으로 선언해** 렌더러 타입을 공용으로 끌어올리지 않았다 —
    TypeScript 는 구조로 판정하므로 `DesignNode`(좌표·문서까지)와 메인의 SQLite 행이 **변환 없이**
    들어간다. 노드 타입을 열어 둔 덕에 화면은 넘긴 객체를 그대로 돌려받아 `설명 없음` 을 이어서 본다.
  - **원본 스냅샷은 계속 닫아 뒀다.** 통째로 주면 판정 규칙 없이 에이전트가 스스로 해석하고
    그 해석이 화면과 갈린다 → 판정을 거친 결과만 나간다(`CASE-iarch-096`).
  - **`snapshotTakenAt` 과 못 읽은 탐침이 함께 나간다.** 안 실으면 에이전트가 오래된 값을 방금 것으로
    읽고, "못 읽었다"를 "없다"로 읽는다.
  - **연결이 여럿일 때 `providerId` 없이 부르면 거부한다.** 아무거나 골라 견준 답은 "답 없음"보다 나쁘다
    (대조의 "이름 중복이면 짝짓기 포기"와 같은 원칙).
  - **`CASE-iarch-087`(대조·흡수 전후로 컨테이너 불변)이 MCP 로 대조를 읽은 뒤에도 통과한다** —
    읽기 노출이 실물에 손대지 않는다는 실측.
- drift:
  - `spec/infra-architecture.md` §node-doc.mcp — AC-2 를 도구 **넷**으로, **AC-4 를 구현으로** 고치고
    왜 규칙을 올렸는지·원본 스냅샷을 왜 계속 닫는지·무엇을 함께 실어 보내는지를 적었다.
    「의식적으로 미룬 것」에서 AC-4 를 뺐다(남은 것은 `design.versions` AC-1 뿐).
  - `qa/infra-architecture.md` — S3·S4 의 테스트 경로를 공용 자리로 갱신하고 **이전 사실과 이유**를
    문서 머리에 적었다. `CASE-iarch-076` 을 3종 → **4종**으로, `CASE-iarch-095`·`096` 신설.
  - 옮긴 모듈을 가리키던 문서 참조를 전수 검색해 **0건** 확인.
  - 공용 파일: 없음(`src/shared/infra/**` 는 새 폴더이고 Infra 서비스 전용이다).
- 판정: **PASS**
