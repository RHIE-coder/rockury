import * as Tabs from '@radix-ui/react-tabs'
import { useActive, useNav } from '../nav/useNav'
import type { Module, ModuleArea } from '../nav/types'
import { areaRuns, groupBySlot, handleLayoutFor, handlesFor, isAreaSplit } from '../nav/moduleSlots'
import { areaAccent } from './areaAccent'
import { AreaHandle, selectorsIn } from './AreaHandle'
import { cx } from '../lib/cx'

/**
 * 구획 이름표. 설계=Mercury 시안, 운영=테라코타 — globals.css 팔레트로 두 부서에 색 정체성 부여.
 * 카드 안에서는 바탕 없이 **글자색만** 쓴다: 카드가 이미 그 부서 색을 깔고 있어서, 같은 색
 * 바탕을 한 겹 더 얹으면 이름표가 카드에 묻혀 안 읽힌다.
 */
const AREA_CHIP: Partial<Record<ModuleArea, { label: string; cls: string }>> = {
  design: { label: '설계', cls: 'text-accent' },
  ops: { label: '운영', cls: 'text-accent-2' }
}

/**
 * 구획 카드의 바탕·테두리. 연한 부서색을 흰색과 섞어(`/60`) 깐다 — 원색 그대로면 흐린
 * 글자(`text-muted`)의 대비가 테라코타 쪽에서 AA(4.5:1)에 미달한다(`areaAccent.strip` 과 같은 실측).
 */
const AREA_CARD: Record<ModuleArea, string> = {
  design: 'bg-accent-soft/60 border-accent/25',
  ops: 'bg-accent-2-soft/60 border-accent-2/25',
  common: 'bg-panel border-line'
}

/**
 * L2 — 서비스 내부 모듈 탭 (상단 1차, 활성 = **그 모듈 구획 색**의 pill).
 *
 * 줄 **가운데는 이동만 한다.** 대상 고르기(설계·시점·연결·범위)는 손잡이 몫이고, 그 손잡이는
 * 2026-08-02 에 여기서 뷰 탭 줄로 내려갔다 — 여기 못박아 두었더니 지금 화면과 상관없는 대상까지
 * 늘 떠 있었기 때문이다. 이름표는 손잡이가 아니라 **묶음 이름표**다: 이 탭들이 어느 부서 것인지만
 * 말한다.
 *
 * **양끝은 다시 손잡이 자리다**(2026-08-05 사용자 요청 · `Module.handleLayout: 'sides'`). 2026-08-02
 * 의 문제는 "늘 떠 있다"였지 "이 줄에 있다"가 아니었다 — 손잡이는 지금도 그것을 쓰는 화면에서만
 * 뜬다(`handlesFor`). 가운데 카드들이 이미 줄 복판에 모여 서서 양옆이 통째로 비어 있으므로,
 * 늘 보는 대상을 거기 두면 아래 뷰 탭 줄이 자리를 다 쓴다. **지금 이 값을 쓰는 화면은 Migration
 * 하나**다: 설계·운영 손잡이가 둘 다 떠서 뷰 탭 줄이 가장 좁았던 곳이다.
 *
 * **부서마다 카드 한 장**이다(2026-08-04 사용자 요청 — "가로로 쭉 늘어트리지 말고 레이어 형식의
 * 카드로, 왼쪽은 설계 배경색 오른쪽은 운영 배경색"). 예전엔 탭들이 줄 양끝으로 밀려나고 그
 * 사이를 가는 선 하나가 잇고 있었는데, 부서가 색으로 안 말해지고 빈 줄만 넓었다.
 * 이제 세 카드가 줄 **가운데에 모여** 서고, 건너가는 문이 두 카드의 이음매 **위에 얹힌다**.
 *
 * 줄은 세 자리로 나뉜다(`Module.slot` · 2026-08-01 사용자 요청). 안 쓰는 서비스는 전부 `start`
 * 라 예전처럼 왼쪽부터 그려진다 — 카드도 부서를 쓰는 서비스에서만 생긴다(`isAreaSplit`).
 */
export function ModuleTabs() {
  const { service, module } = useActive()
  const selectModule = useNav((s) => s.selectModule)

  const zones = groupBySlot(service.modules)
  const crossing = zones.center.length > 0
  const split = isAreaSplit(service.modules)

  // 이 화면이 손잡이를 **이 줄에** 세우는가(`Module.handleLayout: 'sides'` · 2026-08-05 사용자 요청).
  // 이 줄은 가운데 몇 칸만 서 있고 양옆이 통째로 비어 있다 — 늘 보는 대상을 거기 두면 아래
  // 뷰 탭 줄이 자리를 다 쓴다. 셀렉터가 안 붙은 구획은 거른다(api·infra 는 컨텍스트 바를 쓴다).
  const sideHandles =
    handleLayoutFor(module) === 'sides'
      ? handlesFor(module).filter((a) => selectorsIn(service, a).length > 0)
      : []
  const handleAt = (area: ModuleArea) =>
    sideHandles.includes(area) && (
      // 부서 색은 테두리·아이콘에만 — 이 줄의 **채운 카드는 "이동"의 뜻**이라 겹치면 안 된다.
      <AreaHandle key={area} service={service} area={area} tinted />
    )

  return (
    <Tabs.Root value={module.id} onValueChange={selectModule} className="shrink-0">
      {/*
        손잡이는 탭 목록 **바깥**에 둔다 — 안에 넣으면 radix 의 화살표 이동(roving focus)이
        드롭다운 단추까지 탭으로 셈해, 좌우 키로 모듈을 넘기다 손잡이에 걸린다.
      */}
      <div className="flex items-center border-b border-line bg-canvas px-3 py-2.5">
        {/*
          양옆 자리는 **남는 폭을 정확히 반씩** 먹는다(`flex-1 basis-0`). 손잡이 내용이 길든 짧든,
          한쪽만 있든 둘 다 있든 두 자리의 폭이 같으므로 **가운데 묶음이 늘 같은 자리에 선다**.
          2026-08-05 사용자 제보: 화면을 옮길 때마다 Migration 문이 좌우로 튀어 "정신없다" —
          Design 화면은 왼쪽 손잡이만, Remote 는 오른쪽만 있어서 가운데가 그만큼 밀렸다.
          자리가 모자라면 **손잡이가 말줄임으로 줄어든다**(`min-w-0` + 안쪽 `truncate`) — 가운데를
          미는 대신 자기가 줄어든다. 탭 이름은 고정폭이라 안 줄어든다.

          `@container/handle` — 손잡이가 "좁으면 접기"를 판정하는 **자**다. 접기 기준은 원래 화면
          폭(`max-[1599px]`)이었는데, 손잡이가 실제로 받는 자리는 화면 폭이 아니라 **여기서 남는
          폭**(= (화면폭 − 사이드바 − 가운데묶음) ÷ 2)이라 둘이 어긋났다. 그 어긋남이 1600~1679px
          구간에 구멍을 냈다(2026-08-07 사용자 제보): 화면이 1600을 넘는 순간 접기가 풀리는데
          정작 자리는 559px 뿐이라 581px 짜리 손잡이가 안 들어가 글자가 개행됐다. 화면 검사기는
          1440px 에서 돌아 늘 접힌 쪽만 보고 있었다.
          이 자리를 자로 삼으면 가운데 묶음이 넓어지거나 탭 이름이 길어져도 임계값이 따라온다 —
          마법의 숫자를 손으로 다시 맞출 일이 없다. (자리 폭은 `basis-0` 이라 **안쪽 내용과 무관**
          하게 정해지므로, 접혀서 좁아지고 좁아져서 또 접히는 되먹임이 생기지 않는다.)
        */}
        <span className="@container/handle flex min-w-0 flex-1 basis-0 justify-start">{handleAt('design')}</span>
        <Tabs.List aria-label="모듈" className="flex shrink-0 items-center">
          {/*
         * 건너가는 문이 **줄의 한가운데**에 선다(2026-08-04 사용자 요청). 양옆 자리가 남는 폭을
         * 같은 몫으로 먹고(`flex-1`) 각각 문 쪽으로 붙어서, 왼쪽 묶음이 오른쪽보다 길어도 문은
         * 안 밀린다. 자리 자체는 내용만큼만 차지하므로(`shrink-0`) 탭은 안 잘린다 — 남는 폭이
         * 먼저 줄어든다.
         */}
        <Zone
          modules={zones.start}
          split={split}
          chipSide="trailing"
          className={crossing ? 'flex-1 justify-end' : 'shrink-0 justify-start'}
        />
        {crossing ? (
          // 문은 양옆 카드 위로 얹힌다(`-mx-2` + `z-10`) — 겹쳐야 "두 카드를 잇는 층"으로 읽힌다.
          <Zone modules={zones.center} split={split} chipSide="leading" className="z-10 -mx-2 shrink-0" />
        ) : (
          <span aria-hidden className="flex-1" />
        )}
        <Zone
          modules={zones.end}
          split={split}
          chipSide="leading"
          className={crossing ? 'flex-1 justify-start' : 'shrink-0 justify-end'}
        />
        </Tabs.List>
        <span className="@container/handle flex min-w-0 flex-1 basis-0 justify-end">{handleAt('ops')}</span>
      </div>
    </Tabs.Root>
  )
}

/**
 * 줄의 한 자리(`Module.slot`). 자리 안에서 **구획이 바뀔 때마다 카드 한 장**이 선다.
 *
 * 카드는 부서를 쓰는 서비스에서만 그린다 — 안 쓰는 곳(uiux·ai)에 회색 카드를 두르면 요청한 적
 * 없는 서비스의 첫 줄이 통째로 바뀐다(`areaAccent` 가 색을 가르는 것과 같은 이유).
 *
 * **이름표는 Migration 쪽 끝에 붙는다**(2026-08-05 사용자 요청 — "Design 이랑 '설계' 문구 위치를
 * 서로 바꿔"). 왼쪽 카드는 뒤에, 오른쪽 카드는 앞에 — 그래야 두 이름표가 **가운데를 마주 보고**
 * 좌우가 대칭이 된다. 둘 다 앞머리에 두었을 때는 왼쪽 것만 바깥을 보고 서서 한쪽으로 쏠려 보였다.
 */
function Zone({
  modules,
  split,
  chipSide,
  className
}: {
  modules: Module[]
  /** 이 서비스가 부서로 갈렸는가 — 카드 유무와 공통 모듈의 강조색이 갈린다. */
  split: boolean
  /** 이름표가 카드의 어느 끝에 붙는가 — 가운데(Migration)를 향하는 쪽이다. */
  chipSide: 'leading' | 'trailing'
  className?: string
}) {
  if (!modules.length) return null

  return (
    <span className={cx('flex min-w-0 items-center gap-1.5', className)}>
      {areaRuns(modules).map((run, i) => {
        const chip = AREA_CHIP[run.area]
        // 건너가는 문은 카드를 두르지 않는다 — 문 자신이 이미 떠 있는 한 장이다(`ModuleTrigger`).
        const gate = run.modules.some((m) => m.slot === 'center')
        const card = split && !gate

        return (
          <span
            key={`${run.area}-${i}`}
            // e2e·화면 게이트가 "어느 부서 카드가 떴나"를 모양이 아니라 역할로 집게 하는 훅.
            data-area-card={card ? run.area : undefined}
            className={cx(
              'flex shrink-0 items-center gap-1',
              card && ['rounded-xl border px-2 py-1', AREA_CARD[run.area]]
            )}
          >
            {card && chip && chipSide === 'leading' && <AreaChip area={run.area} chip={chip} />}
            {run.modules.map((m) => (
              <ModuleTrigger key={m.id} module={m} split={split} />
            ))}
            {card && chip && chipSide === 'trailing' && <AreaChip area={run.area} chip={chip} />}
          </span>
        )
      })}
    </span>
  )
}

function AreaChip({ area, chip }: { area: ModuleArea; chip: { label: string; cls: string } }) {
  return (
    <span
      // e2e 훅 — 이름표가 자기 카드 안에 서 있는지(자리)를 검사가 잡는다.
      data-area-chip={area}
      className={cx('shrink-0 px-1 text-[10px] font-semibold tracking-wide', chip.cls)}
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
 * `slot: 'center'` 인 모듈만 모양이 다르다 — **두 카드 위에 얹힌 한 장**이다. 흰 바탕에 그림자를
 * 지어 양옆 카드보다 한 켜 위로 떠오르고, 평소엔 테두리·글자만 자기 목적지 색을 입어 누르기 전에
 * 어디로 가는지가 색으로 먼저 보인다. 채움은 활성일 때만 준다: 늘 채워 두었더니 같은 줄에서
 * 채움이 "지금 여기"와 "건너가는 성격" 두 뜻을 갖게 돼, 채워진 덩어리 둘 중 어느 쪽이 현재
 * 위치인지 안 갈렸다(2026-08-01 피드백).
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
              'rounded-xl bg-canvas px-4 font-semibold',
              'shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_-2px_rgba(0,0,0,0.18)]',
              'transition-[background-color,color,box-shadow,transform] duration-100',
              accent.gate,
              'active:translate-y-px',
              'data-[state=active]:translate-y-px data-[state=active]:shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)]'
            ]
          : [
              'border-transparent font-medium transition-colors',
              'text-muted hover:bg-canvas/70 hover:text-fg',
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
