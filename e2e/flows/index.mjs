import * as uiux from './uiux.mjs'
import * as api from './api.mjs'
import * as db from './db.mjs'
import * as infra from './infra.mjs'
import * as mcp from './mcp.mjs'

/**
 * 서비스별 앱 구동 흐름 등록부 — 순서는 `nav/registry.ts` 의 서비스 순서를 따르되,
 * AI(mcp)를 앞에 둔다: MCP 서버 검사는 앱을 만지기 전 깨끗한 상태에서 해야 하고,
 * 뒤이은 DB 흐름이 만든 설계·연결에 영향을 받지 않아야 하기 때문이다(분할 전 순서 그대로).
 *
 * 이 배열은 새 서비스를 만들 때만 바뀐다. 흐름을 더할 때는 자기 서비스 파일만 고친다.
 */
export const FLOWS = [
  { service: 'mcp', run: mcp.run },
  { service: 'uiux', run: uiux.run },
  { service: 'api', run: api.run },
  { service: 'db', run: db.run },
  { service: 'infra', run: infra.run }
]
