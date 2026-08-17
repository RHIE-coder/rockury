import { tableLabel } from '../ids'
import type { SchemaDiff } from '../versions/diff'

/**
 * 계획 관문 — **이 계획이 실 DB 에서 없앨 것이 있으면 계획을 그리기 전에 진단으로 돌려보낸다.**
 *
 * 예전엔 기준선(마지막으로 확인해 둔 DB 모습)과 지금 DB 를 견줘 "남이 손댔나"로 막았다.
 * 기준선을 없애면서(2026-08-12 사용자) 그 판정 근거가 사라졌고, 남은 근거는 하나다:
 * **설계에 없는데 실 DB 에 있는 것.** 그것이 남이 만든 것이든 우리가 지우기로 한 것이든,
 * 계획이 밀면 사라진다는 사실은 같다.
 *
 * 그렇다고 무조건 막을 수는 없다 — 진단의 "계획 만들기"가 보내는 곳이 계획이라, 그 길까지
 * 막으면 두 화면을 왕복하는 막다른 골목이 된다. 그래서 **없앨 것의 모양에 승인을 묶는다**:
 * 진단을 거쳐 넘어온 그 목록만 통과하고, 목록이 달라지면 승인이 저절로 풀린다.
 *
 * 그 앞에 관문이 하나 더 있다 — **맵핑**. "이 실 DB 가 설계의 몇 버전인가"를 모르면 계획은
 * 근거 없이 선다: 설계에 없는 것 전부가 "없앨 것"으로 서서, 사람이 아직 아무것도 정하지
 * 않았는데 스무 개짜리 삭제 목록이 뜬다(2026-08-17 사용자 제보: "판단할 기준도 없고 준비도
 * 돼있지 않은데 이렇게 화면이 뜨는건 아닌거같아").
 */

/**
 * 이 계획이 실 DB 에서 없앨 것들 — 사람이 읽는 이름으로.
 *
 * 이름에 **스키마를 붙인다.** 안 붙이면 `service1.members` 와 `service2.members` 가 둘 다
 * `members` 로 나와, 지워질 목록을 보고도 어느 쪽인지 못 가른다. 그 이름이 곧 화면의 React
 * key 이자 승인 표식(`removalSignature`)이라, 겹치면 목록이 한 줄을 삼키고 서로 다른 두 계획이
 * 같은 승인으로 통과할 수도 있었다(2026-08-14 콘솔 중복 키 오류).
 */
export function removals(diff: SchemaDiff): string[] {
  const out: string[] = []
  for (const t of diff.tables) {
    const table = tableLabel(t.schema, t.name)
    if (t.status === 'removed') {
      out.push(table)
      continue
    }
    for (const c of t.columns) if (c.status === 'removed') out.push(`${table}.${c.name}`)
    for (const k of t.constraints) if (k.status === 'removed') out.push(`${table}:${k.name}`)
  }
  return out.sort()
}

/**
 * 그 목록을 가리키는 표식. 이름을 다 든다 — 개수만으로는 "하나가 다른 하나로 바뀐" 경우를
 * 못 가른다(지울 것이 A 에서 B 로 바뀌었는데 승인이 살아 있으면 안 된다).
 */
export function removalSignature(diff: SchemaDiff): string {
  return removals(diff).join('\u0000')
}

export type PlanGate =
  /** 계획을 그려도 된다. */
  | 'ok'
  /** 이 실 DB 가 몇 버전인지 모른다 — 맵핑이 먼저다. */
  | 'unmapped'
  /** 없앨 것이 있다 — 진단이 먼저다. */
  | 'removes'

/**
 * @param mapped 이 실 DB 가 설계의 몇 버전인지 못박았나(`remoteVersion`).
 * @param diff 지금 DB → 타깃 설계 버전의 차이. 못 냈으면 null.
 * @param passed 진단에서 승인해 온 없앨 것 목록의 표식.
 */
export function planGate({
  mapped,
  diff,
  passed
}: {
  mapped: boolean
  diff: SchemaDiff | null
  passed: string | null
}): PlanGate {
  // 맵핑이 먼저다 — 없앨 것을 세기 전에 "무엇을 기준으로 세는가"가 정해져 있어야 한다.
  if (!mapped) return 'unmapped'
  if (!diff) return 'ok'
  const sig = removalSignature(diff)
  if (sig === '') return 'ok'
  return passed === sig ? 'ok' : 'removes'
}
