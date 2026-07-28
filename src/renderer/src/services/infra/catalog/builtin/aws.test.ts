import { describe, it, expect } from 'vitest'
import awsJson from './aws.json'
import samples from './awsSamples.json'
import { parseCatalog } from '../schema'
import { extractNodes, linkParents, type ExtractedNode } from '../extract'
import type { Catalog, Discover } from '../types'

/**
 * AWS 탐침을 **고정 표본** 위에서 검증한다.
 *
 * 실 계정이 없어도 "우리가 적어 둔 표현식이 진짜 AWS 응답 모양에서 무엇을 뽑는가"는 검증할 수 있다.
 * 표본(`awsSamples.json`)의 **구조와 키 이름은 실제 CLI 출력 그대로**이고 값만 지어냈다.
 *
 * 이 테스트가 덮지 **못하는** 것: 명령줄 자체가 맞는지(옵션 이름·리전 처리),
 * 권한이 있는지, 응답이 페이지로 잘려 오는지. 그건 실 계정 검증(M3)의 몫이다.
 */

const parsed = parseCatalog(awsJson as unknown)
if (!parsed.ok) throw new Error(`내장 AWS 카탈로그가 형식 검증을 통과하지 못했다: ${parsed.errors.join(', ')}`)
const catalog: Catalog = parsed.catalog

const discoverOf = (typeId: string): Discover => {
  const d = catalog.nodeTypes.find((t) => t.id === typeId)?.discover
  if (!d) throw new Error(`${typeId} 에 탐침이 없다`)
  return d
}

const run = (typeId: string, data: unknown): ReturnType<typeof extractNodes> =>
  extractNodes(discoverOf(typeId), data)

describe('AWS 탐침 — VPC', () => {
  const r = run('aws.vpc', samples['describe-vpcs'])

  it('CASE-icat-120 VPC 를 다 뽑는다', () => {
    expect(r.error).toBeUndefined()
    expect(r.nodes.map((n) => n.externalId)).toEqual(['vpc-0abc123def456', 'vpc-0default999'])
  })

  it('CASE-icat-120 이름은 Name 태그에서 온다 — 배열 속 조건부 값이라 점 표기로는 못 뽑는다', () => {
    expect(r.nodes[0].name).toBe('prod-vpc')
  })

  it('태그가 아예 없는 VPC 도 버리지 않는다 — 이름만 없다', () => {
    expect(r.nodes[1].name).toBeUndefined()
    expect(r.dropped).toEqual([])
  })

  it('CASE-icat-120 rockury:node 태그가 대조 1순위 근거로 실린다', () => {
    expect(r.nodes[0].designNodeRef).toBe('n-design-vpc')
    expect(r.nodes[1].designNodeRef).toBeUndefined()
  })

  it('상태가 사전을 거쳐 옮겨지고 원본도 남는다', () => {
    expect(r.nodes[0]).toMatchObject({ status: 'ok', rawStatus: 'available' })
  })
})

describe('AWS 탐침 — 서브넷', () => {
  const r = run('aws.subnet', samples['describe-subnets'])

  it('CASE-icat-121 부모(VpcId)가 실려 중첩이 선다', () => {
    expect(r.nodes.map((n) => [n.externalId, n.parentExternalId])).toEqual([
      ['subnet-0aaa111', 'vpc-0abc123def456'],
      ['subnet-0bbb222', 'vpc-0abc123def456']
    ])
  })

  it('pending 은 정상이 아니라 주의다', () => {
    expect(r.nodes[1]).toMatchObject({ status: 'warn', rawStatus: 'pending' })
  })
})

describe('AWS 탐침 — EC2 (목록 안 목록)', () => {
  const r = run('aws.ec2', samples['describe-instances'])

  it('CASE-icat-122 Reservations[].Instances[] 를 평평하게 편다 — 예약 단위로 묶여 오는 것을 인스턴스 단위로', () => {
    expect(r.nodes.map((n) => n.externalId)).toEqual([
      'i-0aaa111bbb222',
      'i-0ccc333ddd444',
      'i-0eee555fff666'
    ])
  })

  it('CASE-icat-122 상태는 State.Name 에서 온다(State.Code 숫자가 아니라)', () => {
    expect(r.nodes.map((n) => n.status)).toEqual(['ok', 'stopped', 'gone'])
    expect(r.nodes[2].rawStatus).toBe('terminated')
  })

  it('부모는 SubnetId 다 — VPC 가 아니라 서브넷 안에 그려진다', () => {
    expect(r.nodes[0].parentExternalId).toBe('subnet-0aaa111')
    expect(r.nodes[1].parentExternalId).toBe('subnet-0bbb222')
  })

  it('태그가 없는 인스턴스도 남는다(이름 없이)', () => {
    expect(r.nodes[2].name).toBeUndefined()
    expect(r.dropped).toEqual([])
  })

  it('사전에 없는 상태는 하나도 없다 — 있으면 사전에 추가하라는 신호다', () => {
    expect(r.unknownStatuses).toEqual([])
  })
})

describe('AWS 탐침 — RDS · ALB · Lambda · S3', () => {
  it('CASE-icat-123 RDS 의 부모는 DBSubnetGroup.VpcId 에 중첩돼 있다', () => {
    const r = run('aws.rds', samples['describe-db-instances'])
    expect(r.nodes.map((n) => [n.externalId, n.parentExternalId, n.status])).toEqual([
      ['prod-mysql', 'vpc-0abc123def456', 'ok'],
      ['analytics-pg', 'vpc-0abc123def456', 'warn']
    ])
  })

  it('CASE-icat-123 ALB 의 상태는 State.Code 다 — EC2 와 이름이 같은 키인데 뜻이 다르다', () => {
    const r = run('aws.alb', samples['describe-load-balancers'])
    expect(r.nodes[0]).toMatchObject({
      externalId:
        'arn:aws:elasticloadbalancing:ap-northeast-2:123456789012:loadbalancer/app/prod-alb/0a1b2c3d4e5f',
      name: 'prod-alb',
      status: 'ok',
      parentExternalId: 'vpc-0abc123def456'
    })
  })

  it('Lambda 는 ARN 을 식별자로, 이름을 표시명으로 쓴다', () => {
    const r = run('aws.lambda', samples['list-functions'])
    expect(r.nodes[0]).toMatchObject({
      externalId: 'arn:aws:lambda:ap-northeast-2:123456789012:function:image-resizer',
      name: 'image-resizer'
    })
  })

  it('S3 는 상태를 안 읽는다 — 없는 상태를 지어내지 않고 모름으로 둔다', () => {
    const r = run('aws.s3', samples['list-buckets'])
    expect(r.nodes.map((n) => n.externalId)).toEqual(['prod-assets', 'prod-backups'])
    expect(r.nodes[0].status).toBe('unknown')
    expect(r.nodes[0].rawStatus).toBe('')
  })
})

describe('AWS 탐침 — 여러 탐침 결과를 합쳐 중첩을 세운다', () => {
  const all: ExtractedNode[] = [
    ...run('aws.vpc', samples['describe-vpcs']).nodes,
    ...run('aws.subnet', samples['describe-subnets']).nodes,
    ...run('aws.ec2', samples['describe-instances']).nodes,
    ...run('aws.rds', samples['describe-db-instances']).nodes,
    ...run('aws.alb', samples['describe-load-balancers']).nodes
  ]
  const linked = linkParents(all)

  it('CASE-icat-124 VPC > 서브넷 > EC2 3겹이 실제 응답에서 그대로 선다', () => {
    const ec2 = linked.nodes.find((n) => n.externalId === 'i-0aaa111bbb222')
    const subnet = linked.nodes.find((n) => n.externalId === ec2?.parentExternalId)
    expect(subnet?.externalId).toBe('subnet-0aaa111')
    expect(subnet?.parentExternalId).toBe('vpc-0abc123def456')
  })

  it('CASE-icat-124 부모를 못 찾아 최상위로 올라간 노드가 하나도 없다 — 탐침들이 서로를 채운다', () => {
    expect(linked.danglingParents).toEqual([])
  })

  it('한 탐침만 돌리면 부모가 끊긴다 — 그래서 뽑기 단계에서 부모를 지우면 안 된다', () => {
    // EC2 만 읽으면 서브넷이 목록에 없다. 그래도 노드는 살아남고, 끊긴 사실이 보고된다.
    const only = linkParents(run('aws.ec2', samples['describe-instances']).nodes)
    expect(only.nodes).toHaveLength(3)
    expect(only.danglingParents).toEqual(['subnet-0aaa111', 'subnet-0bbb222'])
  })
})

describe('AWS 탐침 — 응답이 우리 기대와 다를 때', () => {
  it('빈 응답은 오류가 아니라 0건이다', () => {
    const r = run('aws.vpc', { Vpcs: [] })
    expect(r.nodes).toEqual([])
    expect(r.error).toBeUndefined()
  })

  it('목록 자리가 배열이 아니면 사유를 남기고 0건으로 두지 않는다 — 0건과 못 읽음을 가른다', () => {
    const r = run('aws.vpc', { Vpcs: null })
    expect(r.error).toContain('Vpcs[]')
    expect(r.nodes).toEqual([])
  })

  it('키 이름이 바뀌면(우리 표현식이 낡으면) 전부 버려지고 이유가 남는다 — 조용히 0건이 되지 않는다', () => {
    const r = run('aws.vpc', { Vpcs: [{ VpcIdentifier: 'vpc-1' }] })
    expect(r.nodes).toEqual([])
    expect(r.dropped).toEqual([{ index: 0, reason: 'externalId 가 비어 노드로 만들 수 없습니다' }])
  })
})
