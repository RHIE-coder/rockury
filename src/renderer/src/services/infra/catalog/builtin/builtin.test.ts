import { describe, it, expect } from 'vitest'
import { loadBuiltins } from './index'
import { collectIconNames, parseIconRef } from '../icon'
import { PHOSPHOR_ICONS } from '../iconMap'
import { serializeCatalog } from '../schema'

const { ok, failed } = loadBuiltins()

describe('내장 카탈로그', () => {
  it('CASE-icat-001 내장 카탈로그도 같은 검증을 통과한다 — 우리 파일이라고 봐주지 않는다', () => {
    expect(failed.map((f) => `${f.id}: ${f.errors.join(' / ')}`)).toEqual([])
    expect(ok.length).toBeGreaterThan(0)
  })

  it('AWS · 도커 · 프리셋이 다 들어 있다', () => {
    expect(ok.map((c) => c.id).sort()).toEqual(['builtin-aws', 'builtin-docker', 'builtin-presets'])
  })

  it('도커 탐침은 줄마다 JSON(ndjson) 이라고 선언돼 있다 — 통짜 JSON 으로 읽으면 깨진다', () => {
    const docker = ok.find((c) => c.id === 'builtin-docker')?.catalog
    for (const t of docker?.nodeTypes ?? []) {
      expect(t.discover?.format, t.id).toBe('ndjson')
      expect(t.discover?.list, t.id).toBe('[]')
    }
  })

  it('도커 명령의 출력 서식(`{{json .}}`)이 우리 자리표시자로 오해되지 않는다', () => {
    const docker = ok.find((c) => c.id === 'builtin-docker')?.catalog
    const args = (docker?.nodeTypes ?? []).flatMap((t) =>
      t.discover?.call.type === 'cli' ? t.discover.call.args : []
    )
    expect(args).toContain('{{json .}}')
    // 우리 이름공간(cred/node/arg)은 안 쓰므로 자격증명 참조 검사에도 안 걸린다.
    expect(args.some((a) => /\{\{(cred|node|arg)\./.test(a))).toBe(false)
  })

  it('CASE-icat-003 내장 카탈로그에 자격증명 값이 박혀 있지 않다', () => {
    for (const c of ok) expect(() => serializeCatalog(c.catalog)).not.toThrow()
  })

  it('CASE-icat-032 쓰인 아이콘이 전부 아이콘 지도에 있다 — 기본 아이콘으로 조용히 떨어지지 않는다', () => {
    const missing: string[] = []
    for (const c of ok) {
      for (const t of c.catalog.nodeTypes) {
        const ref = parseIconRef(t.icon)
        if (ref.warning) missing.push(`${t.id}: 참조가 깨졌다 (${t.icon})`)
        else if (ref.kind === 'phosphor' && !PHOSPHOR_ICONS[ref.name]) {
          missing.push(`${t.id}: 지도에 없는 아이콘 '${ref.name}' — iconMap.tsx 에 한 줄 더하세요`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('아이콘 지도에 안 쓰는 아이콘이 쌓이지 않는다(번들만 불린다)', () => {
    const used = new Set(collectIconNames(ok.map((c) => c.catalog), { includeFallback: true }))
    const unused = Object.keys(PHOSPHOR_ICONS).filter((n) => !used.has(n))
    expect(unused).toEqual([])
  })

  it('중첩 규칙이 실제로 겹을 이룬다 — AWS 는 VPC ⊃ 서브넷 ⊃ EC2', () => {
    const aws = ok.find((c) => c.id === 'builtin-aws')?.catalog
    const byId = Object.fromEntries((aws?.nodeTypes ?? []).map((t) => [t.id, t]))
    expect(byId['aws.subnet'].canNestIn).toContain('aws.vpc')
    expect(byId['aws.ec2'].canNestIn).toContain('aws.subnet')
    expect(byId['aws.vpc'].canNestIn ?? []).toEqual([]) // VPC 는 최상위
  })

  it('묶음 상자류는 부모 쪽 허가로 무엇이든 담는다', () => {
    const presets = ok.find((c) => c.id === 'builtin-presets')?.catalog
    const group = presets?.nodeTypes.find((t) => t.id === 'preset.group')
    expect(group?.canContain).toContain('*')
  })

  it('탐침이 있는 종류는 externalId 표현식을 반드시 갖는다', () => {
    for (const c of ok) {
      for (const t of c.catalog.nodeTypes) {
        if (!t.discover) continue
        expect(t.discover.map.externalId, `${t.id}`).toBeTruthy()
        expect(t.discover.list, `${t.id}`).toBeTruthy()
      }
    }
  })

  it('실물을 바꾸는 액션은 전부 danger 로 표시돼 있다', () => {
    for (const c of ok) {
      for (const t of c.catalog.nodeTypes) {
        for (const a of t.actions ?? []) {
          // M1 의 내장 액션은 재시작뿐이고, 그건 실물을 건드린다.
          expect(a.danger, `${t.id}.${a.id}`).toBe(true)
        }
      }
    }
  })
})
