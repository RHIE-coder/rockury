import { APP_SCHEMA_VERSION, type Catalog, type NodeTypeDef, type ProbeCall } from './types'

/**
 * 사용자 카탈로그 만들기·고치기 — 탐침 편집기가 만든 것을 담을 그릇.
 *
 * 전부 순수 함수이고 **입력을 건드리지 않는다**. 화면이 여기서 만든 결과를 다시 `parseCatalog` 에
 * 태워 저장하므로, 사용자가 만든 것도 남에게서 가져온 것과 **똑같은 검증**을 거친다.
 */

/** 내용 버전 — 사용자가 고칠 때마다 올린다. 노드에 함께 저장돼 "언제 기준"이 남는다. */
const stamp = (): string => new Date().toISOString().slice(0, 10).replace(/-/g, '.')

export function newUserCatalog(providerId: string, label: string, nodeTypes: NodeTypeDef[]): Catalog {
  const id = providerId.trim()
  if (!id) throw new Error('공급자 id 를 입력하세요.')
  if (nodeTypes.length === 0) throw new Error('노드 종류가 하나도 없는 카탈로그는 만들 수 없습니다.')
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    catalogVersion: stamp(),
    provider: { id, label: label.trim() || id },
    nodeTypes
  }
}

/**
 * 종류를 넣거나 고친다. 같은 id 면 **자리를 지키며** 덮어쓴다 —
 * 뒤로 밀어 버리면 목록 순서가 저장할 때마다 흔들려 사용자가 자기 카탈로그를 못 알아본다.
 */
export function upsertNodeType(catalog: Catalog, type: NodeTypeDef): Catalog {
  const at = catalog.nodeTypes.findIndex((t) => t.id === type.id)
  const nodeTypes =
    at >= 0
      ? catalog.nodeTypes.map((t, i) => (i === at ? type : t))
      : [...catalog.nodeTypes, type]
  return { ...catalog, catalogVersion: stamp(), nodeTypes }
}

/** 내장 카탈로그를 내 것으로 복제한다 — 내장은 못 고치므로 이게 편집의 유일한 입구다. */
export function cloneAsMine(source: Catalog, providerId: string, label: string): Catalog {
  return newUserCatalog(providerId, label, source.nodeTypes)
}

export interface CommandRow {
  typeId: string
  typeLabel: string
  kind: '탐침' | '액션'
  /** 사람이 읽을 수 있게 만든 한 줄. 자격증명은 참조 그대로 남는다. */
  command: string
  danger?: boolean
}

const describe = (call: ProbeCall): string => {
  if (call.type === 'cli') return [call.cmd, ...call.args].join(' ')
  if (call.type === 'http') return `${call.method} ${call.url}`
  return `내장 어댑터 ${call.adapter}.${call.op}`
}

/**
 * 이 카탈로그가 **실행하게 될 모든 명령**을 목록으로 낸다.
 *
 * 가져오기 승인 화면의 알맹이다 — 남이 만든 카탈로그는 곧 남이 적어 준 명령 묶음이라,
 * 무엇이 돌아갈지 보여 주지 않고 저장하면 그건 승인이 아니라 요식이다.
 */
export function commandsOf(catalog: Catalog): CommandRow[] {
  const rows: CommandRow[] = []
  for (const t of catalog.nodeTypes) {
    if (t.discover) {
      rows.push({ typeId: t.id, typeLabel: t.label, kind: '탐침', command: describe(t.discover.call) })
    }
    for (const a of t.actions ?? []) {
      rows.push({
        typeId: t.id,
        typeLabel: t.label,
        kind: '액션',
        command: describe(a.call),
        danger: a.danger
      })
    }
  }
  return rows
}
