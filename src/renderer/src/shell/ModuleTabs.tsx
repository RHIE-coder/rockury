import { Fragment } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { useActive, useNav } from '../nav/useNav'
import type { Module, ModuleArea } from '../nav/types'
import { chipSide, groupBySlot, isAreaSplit } from '../nav/moduleSlots'
import { areaAccent } from './areaAccent'
import { cx } from '../lib/cx'

/**
 * 구획 그룹 뱃지. 붙는 끝은 `chipSide` 가 정한다(다리가 있으면 다리 쪽 끝). common 은 뱃지 없이
 * 구분선만. 설계=Mercury 시안, 운영=테라코타 — globals.css 팔레트로 두 부서에 색 정체성 부여.
 */
const AREA_CHIP: Partial<Record<ModuleArea, { label: string; cls: string }>> = {
  design: { label: '설계', cls: 'bg-accent-soft text-accent' },
  ops: { label: '운영', cls: 'bg-accent-2-soft text-accent-2' }
}

/**
 * L2 — 서비스 내부 모듈 탭 (상단 1차, 활성 = **그 모듈 구획 색**의 pill). 구획이 바뀌는 자리에
 * 구분선과 그 구획의 뱃지.
 *
 * 이 줄은 **이동만 한다.** 대상 고르기(설계·시점·연결·범위)는 뷰 탭 줄 오른쪽 끝의 손잡이가
 * 맡는다(`AreaHandle` · 2026-08-02 사용자 요청) — 여기 못박아 두었더니 지금 화면과 상관없는
 * 대상까지 늘 떠 있었다. 남은 뱃지는 손잡이가 아니라 **묶음 이름표**다: 이 탭들이 어느 부서
 * 것인지만 말한다.
 *
 * **줄은 세 자리로 나뉜다**(`Module.slot` · 2026-08-01 사용자 요청). 안 쓰는 서비스는 전부
 * `start` 라 예전과 똑같이 그려진다 — 가운데는 건너가는 모듈 하나가 차지한다.
 */
export function ModuleTabs() {
  const { service, module } = useActive()
  const selectModule = useNav((s) => s.selectModule)

  const zones = groupBySlot(service.modules)
  // 잇는 선은 건너갈 자리가 실제로 있을 때만 — 가운데가 빈 서비스에 선만 덩그러니 남지 않게.
  const crossing = zones.center.length > 0
  const split = isAreaSplit(service.modules)

  return (
    <Tabs.Root value={module.id} onValueChange={selectModule} className="shrink-0">
      <Tabs.List
        aria-label="모듈"
        className="flex items-center overflow-x-auto border-b border-line bg-canvas px-3 py-2"
      >
        {/*
         * 자리는 내용만큼만 차지하고(`shrink-0`), 남는 폭은 **잇는 선이 양쪽 같은 몫으로**
         * 먹는다. 그래서 건너가는 버튼은 줄의 한가운데가 아니라 **두 묶음 사이의 한가운데**에
         * 선다 — 그게 이 버튼이 실제로 뜻하는 자리다(설계 묶음과 운영 묶음을 잇는 문).
         *
         * 줄 한가운데에 못박던 예전 규칙(`flex-1 basis-0`)은 버렸다: 왼쪽 묶음이 오른쪽보다
         * 훨씬 길어서 버튼이 늘 오른쪽으로 밀렸고, 선을 그리자 왼쪽 다리 8px·오른쪽 300px 로
         * 그 어긋남이 눈에 드러났다(실측). 탭 잘림 걱정은 그대로 막힌다 — 자리가 내용 폭을
         * 지키고 선이 먼저 줄어든다.
         */}
        <Zone
          modules={zones.start}
          split={split}
          chipSide={chipSide('start', crossing)}
          className="shrink-0 justify-start"
        />
        {crossing ? (
          <>
            <Bridge side="trailing" />
            <Zone
              modules={zones.center}
              split={split}
              chipSide={chipSide('center', crossing)}
              className="shrink-0"
            />
            <Bridge side="leading" />
          </>
        ) : (
          <span aria-hidden className="flex-1" />
        )}
        <Zone
          modules={zones.end}
          split={split}
          chipSide={chipSide('end', crossing)}
          className="shrink-0 justify-end"
        />
      </Tabs.List>
    </Tabs.Root>
  )
}

/**
 * 건너가는 버튼과 양옆 묶음을 잇는 선. 남는 자리를 양쪽이 같은 몫으로 먹어(`flex-1`) 버튼이
 * **다리 위의 문**으로 읽히게 한다 — 버튼 자체를 늘리자는 안(2026-08-01 피드백)은 뒤집었다:
 * 누를 표적 크기가 창 폭따라 출렁이고, 넓어진 채움이 활성 탭보다 무거워져 "지금 여기"를 또 흐린다.
 *
 * 선은 문을 **경유해** 설계에서 운영으로 흐른다: 왼쪽은 시안→중립, 오른쪽은 중립→테라코타.
 * 문 자체가 중립색이라(어느 부서도 아니다) 양쪽 선이 그 색에서 만나야 한 줄로 이어져 보인다.
 */
const BRIDGE: Record<'leading' | 'trailing', string> = {
  /** 왼쪽 다리 — 설계 묶음 **뒤에** 붙는다. */
  trailing: 'bg-linear-to-r from-accent/20 to-ink/30',
  /** 오른쪽 다리 — 운영 묶음 **앞에** 붙는다. */
  leading: 'bg-linear-to-r from-ink/30 to-accent-2/40'
}

function Bridge({ side }: { side: 'leading' | 'trailing' }) {
  return <span aria-hidden className={cx('mx-2 h-px min-w-2 flex-1', BRIDGE[side])} />
}

/**
 * 줄의 한 자리(`Module.slot`). 구획이 바뀌는 자리마다 구분선이 서고, 뱃지는 그 구획 묶음의
 * `chipSide` 쪽 끝에 붙는다.
 *
 * 뱃지는 "구획마다 하나"다 — 구획이 **바뀌는 지점**에만 그리면 첫 구획이 뱃지를 잃는다
 * (DB 에서 Overview 를 뺀 순간 설계 뱃지가 조용히 사라졌다). 구분선은 뱃지가 어느 끝으로 가든
 * 늘 묶음이 시작하는 자리다 — 경계를 긋는 것이지 이름표가 아니다.
 */
function Zone({
  modules,
  split,
  chipSide,
  className
}: {
  modules: Module[]
  /** 이 서비스가 부서로 갈렸는가 — 공통 모듈의 강조색이 갈린다(`areaAccent`). */
  split: boolean
  /** 뱃지가 묶음의 어느 끝에 붙는가(`nav/moduleSlots.chipSide`). */
  chipSide: 'leading' | 'trailing'
  className?: string
}) {
  if (!modules.length) return null

  return (
    <span className={cx('flex items-center gap-1', className)}>
      {modules.map((m, i) => {
        const area: ModuleArea = m.area ?? 'common'
        const prevArea: ModuleArea | null = i > 0 ? modules[i - 1].area ?? 'common' : null
        const nextArea: ModuleArea | null =
          i < modules.length - 1 ? modules[i + 1].area ?? 'common' : null
        const groupStart = prevArea === null || area !== prevArea
        const groupEnd = nextArea === null || area !== nextArea
        const chip = AREA_CHIP[area]
        const chipHere = chip && (chipSide === 'leading' ? groupStart : groupEnd)

        return (
          <Fragment key={m.id}>
            {groupStart && prevArea !== null && (
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line" />
            )}
            {chipHere && chipSide === 'leading' && <AreaChip area={area} chip={chip} />}
            <ModuleTrigger module={m} split={split} />
            {chipHere && chipSide === 'trailing' && <AreaChip area={area} chip={chip} />}
          </Fragment>
        )
      })}
    </span>
  )
}

function AreaChip({ area, chip }: { area: ModuleArea; chip: { label: string; cls: string } }) {
  return (
    <span
      // e2e 훅 — 뱃지가 다리 쪽 끝에 서 있는지(자리)를 검사가 잡는다.
      data-area-chip={area}
      className={cx(
        'mx-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
        chip.cls
      )}
    >
      {chip.label}
    </span>
  )
}

/**
 * 탭 하나. 활성 색은 **모듈이 속한 구획**이 정한다(`areaAccent`) — 설계=시안, 운영=테라코타,
 * 공통=그래파이트. 한 색으로 고정돼 있던 동안은 운영 화면이 설계 색으로 켜져, 지금 보는 것이
 * 어느 부서인지가 색으로 반대로 읽혔다(2026-08-01 피드백).
 *
 * `slot: 'center'` 인 모듈만 모양이 다르다 — **테두리 두른 문**이다. 평소엔 속을 비우고
 * 테두리·글자만 자기 목적지 색을 입어, 누르기 전에 어디로 가는지가 색으로 먼저 보인다.
 * 채움은 활성일 때만 준다: 늘 채워 두었더니 같은 줄에서 채움이 "지금 여기"와 "건너가는 성격"
 * 두 뜻을 갖게 돼, 채워진 덩어리 둘 중 어느 쪽이 현재 위치인지 안 갈렸다(같은 피드백).
 * 눌린 입체(1px 내려앉음 + 안쪽 그림자)는 활성일 때만 남는다 — 지금 여기가 곧 눌린 버튼이다.
 * 흰 글자 대비 5.49:1(AA 통과).
 */
function ModuleTrigger({ module: m, split }: { module: Module; split: boolean }) {
  const Icon = m.icon
  const accent = areaAccent(m.area, split)
  const gate = m.slot === 'center'

  return (
    <Tabs.Trigger
      value={m.id}
      // surface-verify 자동 순회 훅(전 모듈 캡처) — 지우면 UI 게이트가 화면을 잃는다.
      data-nav-module={m.id}
      // 테두리 폭은 모든 탭이 함께 잡아 둔다(색은 문만 넣는다) — 문에만 주면 그 탭 하나가
      // 2px 높아져 줄의 밑선이 어긋난다.
      className={cx(
        'flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px]',
        gate
          ? [
              'font-semibold transition-[background-color,color,box-shadow,transform] duration-100',
              accent.gate,
              'active:translate-y-px',
              'data-[state=active]:translate-y-px data-[state=active]:shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)]'
            ]
          : [
              'border-transparent font-medium transition-colors',
              'text-muted hover:bg-panel-strong hover:text-fg',
              'data-[state=active]:text-white',
              accent.tab
            ]
      )}
    >
      <Icon size={16} />
      {m.label}
    </Tabs.Trigger>
  )
}
