# gate run — 2026-07-29 · Infra · main(UI/UX 합류) 위로 rebase 후 통합 검증

- 기준 커밋(HEAD=부모): af43c64 (main 끝 — UI/UX 서비스 5커밋 + DB Diagram 1커밋)
- rebase 전 `feat/infra` 끝: **d077184** (되돌릴 지점)
- 범위: `git merge --ff-only feat/infra` 가 "갈라져서 못 한다"로 막혀, `AGENTS.md` 병합 절차대로
  이 워크트리에서 `git rebase main` 을 하고 **UI/UX + Infra 가 합쳐진 상태를 처음으로 통째 검증**했다.

## 무엇이 갈라져 있었나
main 이 6커밋 앞서 있었다 — UI/UX 서비스 전체(Screens·Review·Style·Flows·Rules·Versions)와
DB Diagram(그룹·상세보기 서랍). 양쪽이 다 건드린 파일은 **5개**뿐이었다(새 파일 위주라 충돌이 적다는
병렬 개발 전제가 실제로 지켜졌다).

| 파일 | 어떻게 합쳤나 |
|---|---|
| `docs/glossary.md` | 양쪽 용어를 다 남김(DB 2개 + Infra 9개) |
| `src/main/ai/tools.ts` | 두 서비스의 도구를 다 이어 붙임 — import 는 자동 병합됨 |
| `migrations.test.ts` | 의미가 같았다(양쪽 다 "정확히 일치" → 포함 검사). 실패 메시지가 구체적인 쪽(`expectNoTableLost`)을 취함 |
| `assemble.test.ts` | **의미 병합이 필요했던 자리** — 아래 참조 |
| `e2e/surface/baseline/uiux.json` | 생성물이라 손대지 않고 main 것을 취한 뒤, rebase 후 재수립으로 다시 잼 |

### ⭐ `assemble.test.ts` — 한쪽만 취하면 반드시 깨지는 자리였다
"빈 서비스는 표면에 아무 키도 더하지 않는다" 검사의 목록을 **main 은 `uiux` 를, 나는 `infra` 를**
각각 뺐다. 어느 한쪽을 그대로 취하면 다른 서비스가 "아직 창구가 없어야 한다"에 걸려 깨진다.
둘 다 창구를 열었으므로 남는 빈 서비스는 **`api` 하나**다 — 그렇게 합치고 그 자리에서 두 테스트를
돌려 확인한 뒤 rebase 를 이어 갔다.

## 결과
- typecheck: **PASS**
- test (`npm test`): **PASS** — **1,400 pass** / 4 skip (내 1,215 + UI/UX 쪽 185, 충돌 0)
- build: **PASS**
- e2e (`npm run e2e`): **PASS** — **18/18 스위트 · 468체크 실패 0 · 미실행 0**
  (`--no-db` 없이 — 도커를 실제로 읽고 쓰는 스위트 넷이 다 돌았다)
- surface-verify: **status=ok** · 화면 **47개**(leaf 46) · **차단 0** · 관찰 23

## 이 회차에서 드러난 사실
- **내 대비 수정이 UI/UX 화면 열 곳을 함께 고쳤다.** rebase 후 기준선을 재수립하니 `uiux.json` 이
  **10건 → 0건**이 됐고, 사라진 10건은 전부 `depth N · …` 문구의 `--color-muted` 대비 문제였다.
  **새로 생긴 수용은 0건** — 내 색 변경이 UI/UX 의 새 화면 어느 것도 깨뜨리지 않았다.
  (색을 어둡게 한 것이 밝은 배경 위 대비를 높이기만 한다는 예상이 47개 화면에서 실측으로 확인됐다.)
- `db.json` 은 좌표만 흔들려 **되돌렸다**(`AGENTS.md` 규칙). 지난 회차에 실측한 재수립 잡음
  (같은 코드로 두 번 돌려도 23건 중 8건의 `bounds` 가 달라진다)과 같은 현상이고, 판정 키
  (`check|formFactor|role|text`)는 좌표를 보지 않으므로 의미 변화가 아니다.

## ⚠ main 에 넘길 발견 — e2e 스위트 번호가 겹쳤다
`13-infra-catalog.mjs` 와 `13-uiux-spec.mjs` 가 **둘 다 13번**이다. 러너가 파일 이름 순으로 돌려
실행 순서는 결정적이고(`i` < `u`) 이번 실행도 18/18 통과했지만, "번호가 곧 실행 순서"라는 규칙이
흐려졌다. **남의 서비스 파일이라 이 브랜치에서 renumber 하지 않았다** — 다음 서비스(api)가 또 겪을
문제이므로 번호를 어떻게 배분할지는 `main` 에서 정하는 것이 맞다.

## 판정: **PASS** — `git merge --ff-only feat/infra` 가능
