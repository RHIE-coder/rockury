/**
 * 저장쿼리 SQL 자동저장기 — 늦춰 쓰기(디바운스) + **넘어가기 전 밀어내기(flush)**.
 *
 * 2026-08-12 유실 사고에서 나왔다. 예전엔 편집기의 `sql` 이 바뀌기만 하면 쓰는
 * `useEffect` + `setTimeout` 이었고, 그래서 두 가지로 글을 잃었다:
 *
 * ⑴ **여는 것도 쓰기였다.** 쿼리를 누르면 트리에 든 사본이 편집기에 실리고, 그 "바뀜"이
 *    곧바로 저장을 예약했다. 사본이 낡아 있으면(자동저장은 저장소만 고치고 트리는 안 고쳤다)
 *    낡은 글이 저장소를 덮었다 — 눌렀을 뿐인데 쓴 것이 사라졌다.
 *    → 이제 쓰기는 **사용자가 고칠 때만** 예약된다(`schedule` 을 부르는 자리는 편집뿐).
 * ⑵ **넘어갈 때 타이머가 그냥 지워졌다.** 1초 안에 다른 쿼리를 누르면 정리(cleanup)가
 *    타이머를 없애, 그사이 친 글자가 어디에도 안 남았다.
 *    → 이제 넘어가기 전에 `flush()` 로 밀어낸다.
 */
export interface SqlSaver {
  /** 사용자가 고친 SQL 을 예약한다 — 같은 쿼리를 연달아 고치면 마지막 것 한 번만 쓴다. */
  schedule: (id: string, sql: string) => void
  /** 예약된 것이 있으면 지금 쓴다(없으면 아무 일도 안 한다). */
  flush: () => Promise<void>
}

export function createSqlSaver(
  save: (id: string, sql: string) => Promise<void>,
  delayMs = 1000
): SqlSaver {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { id: string; sql: string } | null = null

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const p = pending
    pending = null
    if (p) await save(p.id, p.sql)
  }

  return {
    schedule: (id, sql) => {
      // 예약된 것이 **다른 쿼리** 것이면 먼저 내보낸다 — 안 그러면 뒤엣것이 앞엣것을 삼킨다.
      // (flush 의 앞부분은 동기라, 여기서 부르면 옛 예약을 확실히 집어간다.)
      if (pending && pending.id !== id) void flush()
      pending = { id, sql }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void flush(), delayMs)
    },
    flush
  }
}
