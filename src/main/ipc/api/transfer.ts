import { ipcMain } from 'electron'
import { createSpec, getSpec, listRequests, replaceRequests } from '../../store/apiSpecs'
import { importOpenapi, type ImportResult } from '../../../shared/api/importOpenapi'
import { importProto } from '../../../shared/api/importProto'
import { importGraphql } from '../../../shared/api/importGraphql'
import { exportSpec, type ExportFormat, type ExportResult } from '../../../shared/api/exportSpec'
import type { InterfaceKind, RequestDef } from '../../../shared/api/types'

/**
 * 가져오기·내보내기 IPC
 *
 * **가져오기는 기존 명세를 덮지 않는다**(AC-4). 먼저 미리보기를 만들고, 무엇이 추가·충돌인지
 * 보인 뒤에야 사람이 수락한다. 못 옮긴 것은 조용히 버리지 않고 목록으로 함께 나간다(AC-5).
 */

export type ImportSourceKind = 'openapi' | 'proto' | 'graphql'

export interface ImportPreview extends ImportResult {
  kind: InterfaceKind
  /** 기존 명세에 합칠 때 이름이 겹치는 요청. 덮지 않고 사람에게 보인다. */
  conflicts: string[]
  /** 겹치지 않아 그대로 들어갈 요청 이름. */
  additions: string[]
}

const KIND_OF: Record<ImportSourceKind, InterfaceKind> = {
  openapi: 'rest',
  proto: 'grpc',
  graphql: 'graphql'
}

function parseSource(kind: ImportSourceKind, source: string): ImportResult {
  if (kind === 'proto') return importProto(source)
  if (kind === 'graphql') return importGraphql(source)
  return importOpenapi(source)
}

export function registerApiTransferIpc(): void {
  ipcMain.handle(
    'api:previewImport',
    (_e, kind: ImportSourceKind, source: string, intoSpecId?: string): ImportPreview => {
      const parsed = parseSource(kind, source)
      const existing = intoSpecId ? listRequests(intoSpecId).map((r) => r.name) : []
      const names = parsed.requests.map((r) => r.name)
      return {
        ...parsed,
        kind: KIND_OF[kind],
        conflicts: names.filter((n) => existing.includes(n)),
        additions: names.filter((n) => !existing.includes(n))
      }
    }
  )

  ipcMain.handle(
    'api:import',
    (_e, kind: ImportSourceKind, source: string, intoSpecId?: string): { specId: string; added: number } => {
      const parsed = parseSource(kind, source)

      if (!intoSpecId) {
        const spec = createSpec({ name: parsed.name, kind: KIND_OF[kind] })
        replaceRequests(spec.id, parsed.requests)
        return { specId: spec.id, added: parsed.requests.length }
      }

      const target = getSpec(intoSpecId)
      if (!target) throw new Error(`명세 "${intoSpecId}" 가 없습니다.`)
      if (target.kind !== KIND_OF[kind]) {
        throw new Error(
          `${target.kind} 명세에 ${KIND_OF[kind]} 문서를 합칠 수 없습니다 — 인터페이스 종류는 명세의 고정 속성입니다.`
        )
      }

      // 겹치는 이름은 **기존 것을 남긴다** — 가져오기가 사람이 손본 정의를 덮으면 안 된다.
      const existing = new Set(target.requests.map((r) => r.name))
      const fresh: RequestDef[] = parsed.requests.filter((r) => !existing.has(r.name))
      replaceRequests(intoSpecId, [...target.requests, ...fresh])
      return { specId: intoSpecId, added: fresh.length }
    }
  )

  ipcMain.handle('api:export', (_e, specId: string, format: ExportFormat): ExportResult => {
    const spec = getSpec(specId)
    if (!spec) throw new Error(`명세 "${specId}" 가 없습니다.`)
    return exportSpec(spec, format)
  })
}
