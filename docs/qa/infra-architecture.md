# TestPlan: infra-architecture (설계본 · 노드 문서 · 실물 지도 · 대조)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 스위트 `e2e/suites/NN-*.mjs`.
> 명세 정본: `docs/spec/infra-architecture.md`.

## Scenario S1 — 중첩 규칙 (순수 로직) → `services/infra/design/nesting.test.ts`
- **CASE-iarch-001** `canNestIn` 이 허용하는 부모에만 들어간다. 허용 안 되면 **이유 문자열**과 함께 거부. (design.canvas AC-3)
- **CASE-iarch-002** 자기 자신·자기 자손을 부모로 삼는 순환을 막는다.
- **CASE-iarch-003** 부모 크기 계산: 자식이 늘면 부모 박스가 자식을 감싸도록 커진다. (design.canvas AC-4)
- **CASE-iarch-004** 부모 이동 시 자식 좌표가 상대 위치를 유지한다. (design.canvas AC-4)

## Scenario S2 — 중첩 자동 배치 (순수 로직) → `services/infra/design/layout.test.ts`
- **CASE-iarch-010** 한 겹 그래프 배치 — 겹치는 노드가 없다.
- **CASE-iarch-011** 두 겹 이상 중첩에서 자식이 부모 박스 밖으로 나가지 않는다. (design.canvas AC-5)
- **CASE-iarch-012** 부모가 다른 노드끼리의 간선도 겹 구조를 깨지 않고 이어진다. (design.canvas AC-5)
- **CASE-iarch-013** 노드 0개·간선 0개·고립 노드에서도 좌표를 낸다(빈 화면 크래시 금지).

## Scenario S3 — 짝짓기 (순수 로직) → `services/infra/reconcile/match.test.ts`
- **CASE-iarch-020** 태그(`rockury:node=<id>`)가 있으면 그것으로 짝짓고 근거를 `태그` 로 남긴다. (reconcile.match AC-1/AC-4)
- **CASE-iarch-021** 태그가 없으면 이름으로 짝짓고 근거를 `이름` 으로 남긴다. (reconcile.match AC-2/AC-4)
- **CASE-iarch-022** 태그 짝이 있으면 이름 짝은 보지 않는다(1순위 우선). (reconcile.match AC-2)
- **CASE-iarch-023** 한 설계 노드에 실물이 여러 개면 **전부 유지하고 개수를 낸다** — 하나로 접지 않는다. (reconcile.match AC-3)
- **CASE-iarch-024** 없어진 설계 노드를 가리키는 태그는 미등록으로 떨어진다(짝짓기 실패가 예외가 되지 않는다).
- **CASE-iarch-025** 같은 이름의 설계 노드가 둘이면 이름 짝짓기를 포기하고 그 이름을 보고한다. (reconcile.match AC-5)

## Scenario S4 — 대조 판정 (순수 로직) → `services/infra/reconcile/diff.test.ts`
- **CASE-iarch-030** 설계에만 있으면 **미구축**. (reconcile.result AC-1)
- **CASE-iarch-031** 실물에만 있으면 **미등록**. (reconcile.result AC-1)
- **CASE-iarch-032** 둘 다 있고 비교 필드가 다르면 **어긋남** — **어느 필드가 어떻게** 다른지 항목으로 낸다. (reconcile.result AC-2)
- **CASE-iarch-033** 둘 다 있고 같으면 결과에 안 뜬다(소음 없음).
- **CASE-iarch-034** 스냅샷이 없는 공급자의 노드는 **"대조 안 함"** — 미구축으로 떨어지지 않는다. (reconcile.result AC-4)
- **CASE-iarch-035** 카탈로그에 없는 종류의 실물은 '미상'으로 표에 남는다(버리지 않음). (live.sync AC-5)

## Scenario S5 — 흡수 (순수 로직) → `services/infra/reconcile/absorb.test.ts`
- **CASE-iarch-040** 미등록 실물 하나를 설계 노드로 변환 — 종류·이름·부모가 옮겨진다. (reconcile.absorb AC-1)
- **CASE-iarch-041** 여러 개를 한 번에 흡수해도 부모-자식 중첩이 보존된다. (reconcile.absorb AC-1)
- **CASE-iarch-042** 어긋남 흡수는 지정한 필드만 바꾸고 **노드 문서는 건드리지 않는다**. (reconcile.absorb AC-2)
- **CASE-iarch-043** 흡수 결과에 **실물을 바꾸는 지시가 하나도 들어 있지 않다** — 출력이 설계본 변경분뿐이다. (공통 불변식 · reconcile.absorb AC-3)
- **CASE-iarch-044** 되돌리기: 흡수 전 상태로 정확히 복원된다. (reconcile.absorb AC-4)
- **CASE-iarch-045** 흡수로 만든 노드는 문서가 비어 `설명 없음` 표식이 붙는다. (reconcile.absorb AC-5)
- **CASE-iarch-046** 빈 설계본에 통째 흡수(부트스트랩) — 전체 중첩이 한 번에 선다. (reconcile.bootstrap AC-1)
- **CASE-iarch-047** 상태 어긋남은 흡수 대상이 아니다 — 접을 것은 구조(종류·부모)뿐. (reconcile.absorb AC-6)
- **CASE-iarch-048** 고른 것만 흡수한다 — 전부 접지 않는다. (reconcile.absorb AC-1)

## Scenario S5b — 내보내기·검색·배지 (순수 로직)
> → `services/infra/design/export.test.ts` · `search.test.ts` · `reconcile/overlay.test.ts`

- **CASE-iarch-074** 내보내기 계산 — 파일 이름(안전 문자·빈 이름 폴백) · 사각형 합집합 ·
  **중첩을 절대 좌표로 펴서** 경계를 잰다(상대 좌표 그대로 재면 자식이 원점 근처로 잡혀 캔버스에 빈 곳이 생긴다) ·
  자식이 부모 밖으로 삐져나가면 그만큼 넓힌다. (design.canvas AC-6)
- **CASE-iarch-090** 노드 검색 — 이름·종류 이름·종류 id 로 찾고, **이름이 맞은 것이 먼저** 온다.
  검색어가 비면 빈 배열(전부 주면 소음). 포커싱은 중첩된 노드의 **절대** 중심을 주고
  **확대 상한(1.2)을 지키되 이미 축소해 놓았으면 그 배율은 건드리지 않는다.** 없는 노드면 `null`. (design.canvas AC-7)
- **CASE-iarch-091** 대조 배지 지도 — 설계 노드가 있는 줄만 배지 대상이고(미등록 실물은 그릴 자리가 없다),
  '일치'와 '대조 안 함'도 각자의 배지로 남는다(미구축과 섞으면 사용자가 지우러 간다). (reconcile.result AC-3)
- **CASE-iarch-092** 채울 순서 — 문서가 빈 노드만, **담는 상자 → 자식 많은 것 → 이름 순.**
  부모 참조가 끊겨 있어도 죽지 않고, 전부 채워졌으면 빈 목록(잔소리하지 않는다). (reconcile.bootstrap AC-2)

## Scenario S6 — 노드 문서 (순수 로직) → `services/infra/design/nodeDoc.test.ts`
- **CASE-iarch-050** 정해진 칸 다섯 + 자유 서술이 함께 저장·복원된다. (node-doc.fields AC-1/AC-2)
- **CASE-iarch-051** 종류의 기본 문서 틀이 새 노드에 미리 채워진다. (node-doc.fields AC-3)
- **CASE-iarch-052** 비어 있음 판정: 정해진 칸이 전부 비고 자유 서술도 비면 `설명 없음`. 하나라도 차면 아니다. (node-doc.fields AC-5)
- **CASE-iarch-053** MCP 로 내보내는 노드 정보에 **의존과 영향이 반드시 포함**된다. (node-doc.mcp AC-3)

## Scenario S7 — 저장 계층 (임시 SQLite) → `src/main/ipc/infra/store.test.ts`
- **CASE-iarch-060** 설계본·노드·간선 CRUD 와 좌표 영속.
- **CASE-iarch-061** 카탈로그에서 사라진 종류를 가리키는 노드가 **살아남고** '알 수 없는 종류'로 표시된다. (design.data AC-4)
- **CASE-iarch-062** 스냅샷 보존 개수 제한: 오래된 회차가 정리되고 최신은 남는다. (live.data AC-3)
- **CASE-iarch-063** 일부 탐침 실패 스냅샷: 성공분은 저장되고 실패는 실패로 기록된다. (live.sync AC-4)
- **CASE-iarch-064** 탐침별 결과가 "0건이었다"와 "못 읽었다"를 구분해 남긴다. (live.data AC-4 · reconcile.result AC-4)
- **CASE-iarch-065** `agoLabel`: 방금·분·시간·일 단위, 시각이 깨졌으면 "알 수 없음"(지어내지 않는다). (live.sync AC-2)

## Scenario S8 — 앱 구동 흐름 · 설계 (e2e/suites/14-infra-design, CSS/text 로케이터만)
> ⚠ 접근성 쿼리(`getByRole` 등)는 이 Electron 창을 크래시시킨다 → CSS/text 로케이터만.

- **CASE-iarch-070** Design/Live 모듈의 뷰가 열리고 nav 훅이 붙어 있다. (nav AC-1/AC-3)
- **CASE-iarch-071** 노드를 놓고 이름을 주고 저장 → 재진입 시 좌표까지 남아 있다. (design.canvas AC-1)
- **CASE-iarch-072** 허용된 부모 안에 노드를 넣으면 중첩되고, 허용 안 되는 조합은 **이유가 뜬다**. (design.canvas AC-3)
- **CASE-iarch-073** 노드 문서 다섯 칸을 채우고 저장 → 다이어그램의 `설명 없음` 표식이 사라진다. (node-doc.fields AC-1/AC-5)
- **CASE-iarch-074**(앱) PNG·SVG 내보내기가 **캔버스 캡처에 성공한다**(`data-export-status=ok`).
  내려받기 자체는 브라우저 계층이라 여기서 파일까지 확인하지 않는다 — 확인하는 것을 그대로 적는다. (design.canvas AC-6)
- **CASE-iarch-090**(앱) 놓인 노드를 이름으로 찾아 고르면 **화면이 그 노드로 옮겨가고** 검색칸이 비워진다.
  못 찾으면 못 찾았다고 말한다. (design.canvas AC-7)
- **CASE-iarch-091**(앱) 대조 배지를 켜면 노드에 판정이 붙고, 끄면 사라진다.
  **실물을 안 읽은 상태에서는 '미구축'이 하나도 없고 전부 '대조 안 함'** 이며 그 사실을 화면이 알린다. (reconcile.result AC-3)
- **CASE-iarch-075** 콜드 재시작 후 설계본·노드 문서가 남아 있다(이 스위트 안에서 `ctx.relaunch()`).
- **CASE-iarch-076** MCP: infra 읽기 도구 3종만 노출되고 실행·쓰기 도구가 없다. (node-doc.mcp AC-2)
- **CASE-iarch-053** MCP 로 나가는 노드에 **영향·의존**이 실린다. 설명이 빈 노드는 비었다고 표시된다. (node-doc.mcp AC-3)

## Scenario S9 — 앱 구동 흐름 · 실물/대조 (e2e/suites/15-infra-reconcile, `meta.needsDb: true`)
> 도커가 전제다. `npm run db:up` 이 띄운 test-db 컨테이너들이 그대로 **읽기 대상 fixture** 가 된다.
> `--no-db` 로 건너뛰면 러너가 **"미검증"으로 표시**한다(조용한 통과 금지).

- **CASE-iarch-080** 도커 공급자 새로고침 → 컨테이너가 실물 지도에 뜨고 상태 색이 칠해진다. (live.sync AC-1)
- **CASE-iarch-081** 화면에 **"○분 전 기준"** 이 표시된다. (live.sync AC-2)
- **CASE-iarch-082** 설계본이 빈 상태에서 대조 → 전부 **미등록**으로 뜬다. (reconcile.result AC-1)
- **CASE-iarch-083** 통째 흡수 → 설계본에 노드가 생기고 전부 `설명 없음`. (reconcile.bootstrap AC-1)
- **CASE-iarch-092**(앱) 흡수 뒤 **무엇부터 채울지 목록**이 뜨고, 항목을 누르면 그 노드가 골라지며
  목록은 그대로 남는다(연달아 채울 수 있다). (reconcile.bootstrap AC-2)
- **CASE-iarch-084** 다시 대조 → 어긋남 0. 컨테이너 하나를 멈추면 **어긋남**으로 뜨고 상태 필드가 다르다고 나온다. (reconcile.result AC-2)
- **CASE-iarch-085** 설계에만 있는 노드를 하나 추가 → **미구축**으로 뜬다. (reconcile.result AC-1)
- **CASE-iarch-086** 흡수를 되돌리면 설계본이 이전 상태로 돌아온다. (reconcile.absorb AC-4)
- **CASE-iarch-087** 대조·흡수 전후로 **도커 컨테이너 상태가 변하지 않는다** — Rockury 가 실물을 건드리지 않는다는 것을 실측으로 못 박는다. (공통 불변식)
