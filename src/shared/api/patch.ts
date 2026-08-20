import { interfaceMeta } from './types'
import type { FieldDef, ParamDef, RequestDef, RequestFields, SpecDef } from './types'

/**
 * 명세 부분 수정.
 *
 * 통째 반영(`set`)만 있으면 주석 한 줄을 고치려도 명세 전체를 다시 만들어 보내야 하고,
 * 그 왕복에서 새 오타가 섞인다 — DB 서비스가 33개 테이블 설계에서 실제로 겪은 일이다
 * (`ai-server.md` § tools.write 2026-07-26 결정). 그래서 처음부터 짝으로 낸다.
 *
 * 조준은 **이름**으로 한다 — 내부 id 를 알기 위해 먼저 읽을 필요가 없고,
 * 손대지 않은 부분은 id 까지 그대로 남는다.
 */

export type PatchOp =
  | { op: 'add_request'; name: string; shape?: RequestDef['shape']; folder?: string; request?: RequestFields; params?: ParamDef[]; responses?: RequestDef['responses']; docs?: string }
  | { op: 'remove_request'; name: string }
  | { op: 'rename_request'; name: string; to: string }
  | { op: 'set_docs'; request: string; docs: string }
  | { op: 'add_param'; request: string; param: ParamDef }
  | { op: 'update_param'; request: string; name: string; patch: Partial<ParamDef> }
  | { op: 'remove_param'; request: string; name: string }
  | { op: 'set_request_fields'; request: string; fields: RequestFields }
  | { op: 'set_response_schema'; request: string; status: string; fields: FieldDef[] }

export const PATCH_OP_NAMES = [
  'add_request',
  'remove_request',
  'rename_request',
  'set_docs',
  'add_param',
  'update_param',
  'remove_param',
  'set_request_fields',
  'set_response_schema'
] as const

export interface PatchResult {
  spec: SpecDef
  /** 바뀐 것 한 줄씩 — 응답 요약에 그대로 실린다. */
  changes: string[]
}

/** 몇 번째 연산에서 왜 실패했는지 밝힌다 — 목록으로 보내는 도구라 위치가 없으면 못 고친다. */
export class PatchError extends Error {
  constructor(
    public readonly index: number,
    message: string
  ) {
    super(`연산 ${index + 1}번(${message})`)
  }
}

function findRequest(spec: SpecDef, name: string, index: number): RequestDef {
  const r = spec.requests.find((x) => x.name === name)
  if (!r)
    throw new PatchError(
      index,
      `요청 '${name}' 이(가) 없습니다 — 이 명세의 요청: ${spec.requests.map((x) => x.name).join(', ') || '(없음)'}`
    )
  return r
}

function findParam(req: RequestDef, name: string, index: number): ParamDef {
  const p = req.params.find((x) => x.name === name)
  if (!p)
    throw new PatchError(
      index,
      `요청 '${req.name}' 에 파라미터 '${name}' 이(가) 없습니다 — 있는 것: ${req.params.map((x) => x.name).join(', ') || '(없음)'}`
    )
  return p
}

/**
 * 연산 목록을 순서대로 적용한다. **하나라도 실패하면 전부 미반영** —
 * 사본에 적용하고 끝까지 성공했을 때만 돌려주므로 부분 반영이 구조적으로 불가능하다.
 */
export function applyPatch(
  spec: SpecDef,
  ops: PatchOp[],
  newId: () => string = () => `req_${Math.random().toString(36).slice(2, 10)}`
): PatchResult {
  const next: SpecDef = structuredClone(spec)
  const changes: string[] = []

  ops.forEach((raw, i) => {
    switch (raw.op) {
      case 'add_request': {
        if (next.requests.some((r) => r.name === raw.name))
          throw new PatchError(i, `요청 '${raw.name}' 이(가) 이미 있습니다.`)
        next.requests.push({
          id: newId(),
          name: raw.name,
          folder: raw.folder ?? '',
          // 모양을 안 적었으면 그 인터페이스의 **첫 모양**이 기본이다(화면이 새 요청을 만들 때와
          // 같은 규칙). 'unary' 로 박아 두면 SSE·WebSocket 명세에서는 저장이 통째로 거부되고,
          // 그 이유가 "모양을 안 적었다"가 아니라 "없는 모양이다"로 나와 헤매게 된다.
          shape: raw.shape ?? interfaceMeta(spec.kind).shapes[0],
          params: raw.params ?? [],
          request: raw.request ?? {},
          responses: raw.responses ?? [],
          docs: raw.docs ?? ''
        })
        changes.push(`요청 추가: ${raw.name}`)
        break
      }
      case 'remove_request': {
        findRequest(next, raw.name, i)
        next.requests = next.requests.filter((r) => r.name !== raw.name)
        changes.push(`요청 삭제: ${raw.name}`)
        break
      }
      case 'rename_request': {
        const r = findRequest(next, raw.name, i)
        if (next.requests.some((x) => x.name === raw.to))
          throw new PatchError(i, `요청 '${raw.to}' 이(가) 이미 있습니다.`)
        r.name = raw.to
        changes.push(`요청 이름: ${raw.name} → ${raw.to}`)
        break
      }
      case 'set_docs': {
        findRequest(next, raw.request, i).docs = raw.docs
        changes.push(`문서 수정: ${raw.request}`)
        break
      }
      case 'add_param': {
        const r = findRequest(next, raw.request, i)
        if (r.params.some((p) => p.name === raw.param.name))
          throw new PatchError(i, `요청 '${raw.request}' 에 파라미터 '${raw.param.name}' 이(가) 이미 있습니다.`)
        r.params.push(raw.param)
        changes.push(`파라미터 추가: ${raw.request}.${raw.param.name}`)
        break
      }
      case 'update_param': {
        const r = findRequest(next, raw.request, i)
        const p = findParam(r, raw.name, i)
        // 이름 변경은 rename 이 아니라 update 로도 들어올 수 있다 — 중복만 막는다.
        if (raw.patch.name && raw.patch.name !== p.name && r.params.some((x) => x.name === raw.patch.name))
          throw new PatchError(i, `파라미터 '${raw.patch.name}' 이(가) 이미 있습니다.`)
        Object.assign(p, raw.patch)
        changes.push(`파라미터 수정: ${raw.request}.${raw.name}`)
        break
      }
      case 'remove_param': {
        const r = findRequest(next, raw.request, i)
        findParam(r, raw.name, i)
        r.params = r.params.filter((p) => p.name !== raw.name)
        changes.push(`파라미터 삭제: ${raw.request}.${raw.name}`)
        break
      }
      case 'set_request_fields': {
        findRequest(next, raw.request, i).request = raw.fields
        changes.push(`요청 칸 수정: ${raw.request}`)
        break
      }
      case 'set_response_schema': {
        const r = findRequest(next, raw.request, i)
        const existing = r.responses.find((x) => x.status === raw.status)
        if (existing) existing.fields = raw.fields
        else r.responses.push({ status: raw.status, fields: raw.fields })
        changes.push(`응답 스키마: ${raw.request} [${raw.status}]`)
        break
      }
      default: {
        const bad = raw as { op?: string }
        throw new PatchError(i, `모르는 연산 '${String(bad.op)}' — 허용: ${PATCH_OP_NAMES.join(', ')}`)
      }
    }
  })

  return { spec: next, changes }
}
