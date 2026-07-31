import { useCallback, useEffect, useState } from 'react'
import { reconcileScope, scopeModel } from '../scope'
import { useActiveConnection, useConnectionsStore } from '../connections/store'
import { useRemoteStore } from './store'

/**
 * 범위(scope)를 쓰는 화면들의 공용 배선 — 고를 수 있는 스키마 목록 + "범위에 더하기".
 *
 * 왜 훅으로 빼나: Diagram·Definition 이 **같은 목록**을 봐야 한다. 화면마다 따로 읽으면
 * 한쪽에선 켤 수 있다고 하고 다른 쪽에선 못 켠다고 하는 상태가 생긴다.
 * (손잡이 자체는 `ScopeSelector` 가 그린다 — 여기서는 "범위 밖 카드"가 쓸 재료만 낸다.)
 */
export function useScope(): {
  /** 이 연결에서 고를 수 있는 스키마 목록. 아직 못 읽었으면 빈 배열. */
  availableSchemas: string[]
  /** 화면이 이 층을 뭐라 부르나 — PostgreSQL "스키마" · MySQL "데이터베이스". */
  schemaLabel: string
  /** 그 스키마를 범위에 더하고 곧바로 다시 읽는다. 이미 켜져 있으면 아무 일도 안 한다. */
  addSchema: (schema: string) => void
} {
  const conn = useActiveConnection()
  const connId = conn?.id ?? null
  const model = conn ? scopeModel(conn.dbType) : null
  const setSchemas = useConnectionsStore((s) => s.setSchemas)
  const reload = useRemoteStore((s) => s.load)
  const [availableSchemas, setAvailable] = useState<string[]>([])

  useEffect(() => {
    if (!connId || !model?.selectable) {
      setAvailable([])
      return
    }
    let alive = true
    void window.rockury.introspection
      .schemas(connId)
      // 못 읽으면 빈 목록 — "켤 수 있다"고 잘못 말하는 것보다 안전하다(카드가 이유를 다르게 적는다).
      .then((list) => alive && setAvailable(list))
      .catch(() => alive && setAvailable([]))
    return () => {
      alive = false
    }
  }, [connId, model?.selectable])

  const addSchema = useCallback(
    (schema: string) => {
      if (!conn) return
      // 지금 범위가 비어 있으면 "기본 스키마 하나"를 보고 있는 것이다. 그 상태에서 하나를 더하면
      // 보고 있던 것이 사라지므로, 화면에 올라온 스키마들을 먼저 채워 넣고 더한다.
      const base = conn.schemas.length > 0 ? conn.schemas : currentSchemasOf(conn.id)
      if (base.includes(schema)) return
      const next = reconcileScope([...base, schema], availableSchemas)
      void setSchemas(conn.id, next)
      void reload(conn.id, conn.id, true, next)
    },
    [conn, availableSchemas, setSchemas, reload]
  )

  return { availableSchemas, schemaLabel: model?.schemaLabel ?? '스키마', addSchema }
}

/** 지금 화면에 올라온 테이블들의 스키마 — 범위가 비어 있을 때의 "지금 보고 있는 것". */
function currentSchemasOf(connId: string): string[] {
  const loaded = useRemoteStore.getState().byEnv[connId] ?? []
  return [...new Set(loaded.map((t) => t.schema).filter((s): s is string => !!s))]
}
