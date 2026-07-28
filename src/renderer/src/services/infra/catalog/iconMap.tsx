import type { ComponentType } from 'react'
import { BroadcastIcon } from '@phosphor-icons/react/dist/csr/Broadcast'
import { ChartLineIcon } from '@phosphor-icons/react/dist/csr/ChartLine'
import { CloudIcon } from '@phosphor-icons/react/dist/csr/Cloud'
import { CubeIcon } from '@phosphor-icons/react/dist/csr/Cube'
import { DatabaseIcon } from '@phosphor-icons/react/dist/csr/Database'
import { FilesIcon } from '@phosphor-icons/react/dist/csr/Files'
import { FlameIcon } from '@phosphor-icons/react/dist/csr/Flame'
import { FunnelIcon } from '@phosphor-icons/react/dist/csr/Funnel'
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix'
import { GitBranchIcon } from '@phosphor-icons/react/dist/csr/GitBranch'
import { GlobeIcon } from '@phosphor-icons/react/dist/csr/Globe'
import { HardDriveIcon } from '@phosphor-icons/react/dist/csr/HardDrive'
import { HardDrivesIcon } from '@phosphor-icons/react/dist/csr/HardDrives'
import { LightningIcon } from '@phosphor-icons/react/dist/csr/Lightning'
import { NetworkIcon } from '@phosphor-icons/react/dist/csr/Network'
import { PackageIcon } from '@phosphor-icons/react/dist/csr/Package'
import { PathIcon } from '@phosphor-icons/react/dist/csr/Path'
import { QueueIcon } from '@phosphor-icons/react/dist/csr/Queue'
import { RectangleIcon } from '@phosphor-icons/react/dist/csr/Rectangle'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import { ShieldCheckIcon } from '@phosphor-icons/react/dist/csr/ShieldCheck'
import { SignpostIcon } from '@phosphor-icons/react/dist/csr/Signpost'
import { TreeStructureIcon } from '@phosphor-icons/react/dist/csr/TreeStructure'
import { UsersIcon } from '@phosphor-icons/react/dist/csr/Users'
import { WifiHighIcon } from '@phosphor-icons/react/dist/csr/WifiHigh'
import { FALLBACK_ICON, parseIconRef } from './icon'

/**
 * phosphor 아이콘 지도 — **쓰는 것만 낱개로 들여온다.**
 *
 * 아이콘 이름이 카탈로그의 문자열이라 빌드 도구가 무엇이 쓰이는지 정적으로 못 읽는다.
 * 통짜로 `import * from '@phosphor-icons/react'` 하면 1,500개가 통째로 번들에 들어간다 →
 * 여기서 낱개 경로(`dist/csr/<이름>`)로 명시해 그 길을 막는다.
 *
 * 새 아이콘을 카탈로그에 쓰면 여기에도 한 줄 더해야 한다. 빠뜨리면
 * `builtin/builtin.test.ts` 가 잡는다(기본 아이콘으로 조용히 떨어지는 것을 막는다).
 */
export type PhosphorIcon = ComponentType<{ size?: number; weight?: 'regular' | 'bold' | 'fill'; className?: string }>

export const PHOSPHOR_ICONS: Record<string, PhosphorIcon> = {
  broadcast: BroadcastIcon,
  'chart-line': ChartLineIcon,
  cloud: CloudIcon,
  cube: CubeIcon,
  database: DatabaseIcon,
  files: FilesIcon,
  flame: FlameIcon,
  funnel: FunnelIcon,
  'gear-six': GearSixIcon,
  'git-branch': GitBranchIcon,
  globe: GlobeIcon,
  'hard-drive': HardDriveIcon,
  'hard-drives': HardDrivesIcon,
  lightning: LightningIcon,
  network: NetworkIcon,
  package: PackageIcon,
  path: PathIcon,
  queue: QueueIcon,
  rectangle: RectangleIcon,
  robot: RobotIcon,
  'shield-check': ShieldCheckIcon,
  signpost: SignpostIcon,
  'tree-structure': TreeStructureIcon,
  users: UsersIcon,
  'wifi-high': WifiHighIcon
}

/**
 * 아이콘 참조 문자열 하나를 그린다.
 * 참조가 깨져도 **절대 던지지 않는다** — 카탈로그 하나가 잘못됐다고 다이어그램이 안 그려지면 안 된다.
 */
export function InfraIcon({
  icon,
  size = 18,
  className
}: {
  icon: string
  size?: number
  className?: string
}): React.JSX.Element {
  const ref = parseIconRef(icon)

  if (ref.kind === 'data') {
    return <img src={ref.name} width={size} height={size} alt="" className={className} />
  }
  // 팩(사용자가 넣은 공식 아이콘 묶음)은 아직 붙이지 않았다 — 기본 아이콘으로 그린다.
  const Cmp = (ref.kind === 'phosphor' && PHOSPHOR_ICONS[ref.name]) || PHOSPHOR_ICONS[FALLBACK_ICON]
  return <Cmp size={size} className={className} />
}
