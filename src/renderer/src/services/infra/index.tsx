import { useEffect } from 'react'
import { Boxes, Cloud, FileText, Layers, Network, Radar, Server, Share2, Terminal } from 'lucide-react'
import type { Service } from '@renderer/nav/types'
import { DiagramWorkspace } from './design/DiagramView'
import { NodeDocWorkspace } from './design/NodeDocView'
import { ProbeView } from './catalog/ProbeView'
import { LiveView } from './reconcile/LiveView'
import { ReconcileView } from './reconcile/ReconcileView'
import { CatalogsView } from './catalog/CatalogsView'
import { MiddlewareView } from './middleware/MiddlewareView'
import { ProvidersView } from './catalog/ProvidersView'
import { TypesView } from './catalog/TypesView'
import { useInfraStore } from './store'

/**
 * Infra 서비스 IA.
 *
 *   설계부(design) : 아키텍처 설계본을 그리고 **왜 있는지**를 적는다. 이 서비스의 정본.
 *   운영부(ops)    : 실물을 읽어 설계와 대조한다. (M2 — 지금은 자리만)
 *   공통(common)   : 카탈로그 — 노드 종류·공급자 연결·탐침.
 *
 * Rockury 는 인프라를 **구축하지 않는다.** 구축은 밖에서(사람 또는 MCP 로 읽은 에이전트) 일어나고,
 * 여기는 설계를 들고 있다가 실물과 맞는지 본다. 그래서 "적용"의 방향이 DB 서비스와 반대다 —
 * 실물이 아니라 **설계본**을 고친다.
 */

/** 서비스가 활성인 동안 한 번 하이드레이션. 오버레이는 서비스가 활성일 때만 마운트된다. */
function InfraBootstrap(): null {
  const loaded = useInfraStore((s) => s.loaded)
  useEffect(() => {
    if (!loaded) void useInfraStore.getState().init()
  }, [loaded])
  return null
}

export const infraService: Service = {
  id: 'infra',
  label: 'Infra',
  icon: Server,
  Overlay: InfraBootstrap,
  modules: [
    {
      id: 'design',
      label: 'Design',
      icon: Layers,
      area: 'design',
      views: [
        { id: 'diagram', label: '다이어그램', icon: Network, workspace: DiagramWorkspace },
        { id: 'document', label: '노드 문서', icon: FileText, workspace: NodeDocWorkspace }
      ]
    },
    {
      id: 'live',
      label: 'Live',
      icon: Radar,
      area: 'ops',
      views: [
        { id: 'map', label: '실물 지도', icon: Cloud, workspace: LiveView },
        { id: 'reconcile', label: '대조', icon: Network, workspace: ReconcileView }
      ]
    },
    {
      id: 'middleware',
      label: 'Middleware',
      icon: Share2,
      area: 'ops',
      views: [{ id: 'console', label: '접속·콘솔', icon: Terminal, workspace: MiddlewareView }]
    },
    {
      id: 'catalog',
      label: 'Catalog',
      icon: Boxes,
      area: 'common',
      views: [
        { id: 'catalogs', label: '카탈로그', icon: Boxes, workspace: CatalogsView },
        { id: 'providers', label: '공급자', icon: Cloud, workspace: ProvidersView },
        { id: 'types', label: '노드 종류', icon: Layers, workspace: TypesView },
        { id: 'probe', label: '탐침', icon: Terminal, workspace: ProbeView }
      ]
    }
  ]
}
