import * as Tabs from '@radix-ui/react-tabs'
import { useActive, useNav } from '../nav/useNav'
import { handlesFor, isAreaSplit } from '../nav/moduleSlots'
import { areaAccent } from './areaAccent'
import { AreaHandle, selectorsIn } from './AreaHandle'
import { cx } from '../lib/cx'

/**
 * L3 — 모듈 내부 뷰 탭 (상단 2차, 활성 = **줄에서 떠오른 흰 카드**).
 *
 * 줄에는 두 가지가 선다: 왼쪽은 **이동**(뷰 탭), 오른쪽 끝은 **대상 고르기**(구획 손잡이).
 * 손잡이는 맨 위 줄에 못박혀 있었는데, 지금 화면과 상관없는 대상까지 늘 떠 있어서
 * 이리로 내렸다(2026-08-02 사용자 요청). 오른쪽 끝인 이유: 탭이 줄 맨 왼쪽에 고정돼야
 * 대상 이름 길이(설계·연결 이름)가 바뀌어도 탭 자리가 안 흔들린다 — 탭은 매번 누르는 것이고
 * 손잡이는 가끔 확인하는 것이라, 자주 쓰는 쪽이 안 움직이는 자리를 갖는다.
 *
 * **활성 탭은 밑줄이 아니라 그림자로 말한다**(2026-08-02 피드백 — "밑줄 강조 색 없애고 그림자로,
 * 입체감 있게"). 흰 카드가 색 깔린 줄 위로 떠오르고, 그림자는 **위·옆에만** 지고 아래로는 안
 * 진다 — 아래는 지금 보는 화면으로 이어지는 면이라, 거기 그림자가 지면 카드가 화면에서 떨어져
 * 나와 "이 탭 아래가 지금 보는 화면"이라는 말이 끊긴다. 그림자가 잘리지 않게 줄 위쪽에
 * 6px(`pt-1.5`)을 비워 둔다: 가로 스크롤 상자(`overflow-x-auto`)는 세로로도 잘라 낸다.
 *
 * 부서는 **줄 전체**(바탕 + 아래 테두리 · `areaAccent.strip`)가 말한다 — 밑줄은 활성 탭 하나에만
 * 걸리는 가는 선이라 그것만으로는 부서가 안 읽혔다(2026-08-02 피드백). 위 모듈 탭 줄은 같은
 * 방식으로 못 칠한다: 거기엔 설계와 운영이 한 줄에 같이 서 있어 한 색으로 덮을 수 없다.
 */
export function ViewTabs() {
  const { service, module, view } = useActive()
  const selectView = useNav((s) => s.selectView)

  // 셀렉터가 하나도 안 붙은 구획은 손잡이를 안 그린다 — api·infra 는 구획을 쓰지만 대상은
  // 컨텍스트 바가 든다. 걸러 두지 않으면 그 두 서비스에 빈 테두리만 남는다.
  const handles = handlesFor(module).filter((a) => selectorsIn(service, a).length > 0)
  const hasViews = Boolean(module.views?.length && view)
  if (!hasViews && !handles.length) return null

  const accent = areaAccent(module.area, isAreaSplit(service.modules))

  const row = (
    <div className={cx('flex shrink-0 items-stretch border-b', accent.strip)}>
      {hasViews ? (
        <Tabs.List
          aria-label="뷰"
          // 카드끼리는 좁게(gap-1) — 예전 gap-5 는 밑줄만 있을 때의 간격이라, 카드가 되면
          // 탭 사이가 벌어져 한 벌로 안 읽힌다.
          className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-3 pt-2.5"
        >
          {module.views!.map((v) => {
            const Icon = v.icon
            return (
              <Tabs.Trigger
                key={v.id}
                value={v.id}
                // surface-verify 자동 순회 훅(전 뷰 캡처) — 지우면 UI 게이트가 화면을 잃는다.
                data-nav-view={v.id}
                className={cx(
                  // 위 모서리만 둥글다 — 아래는 작업 영역으로 이어져야 해서 각지게 둔다.
                  'flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-2.5 text-[13px] font-medium',
                  'transition-[background-color,color,box-shadow]',
                  'text-muted hover:bg-canvas/50 hover:text-fg',
                  'data-[state=active]:bg-canvas data-[state=active]:text-fg',
                  // 아래로 안 지는 그림자 — 세 켜다. 가까운 1px 이 카드의 윤곽을 세우고,
                  // 가운데가 들린 높이를, 넓게 퍼지는 쪽이 그 높이의 여운을 만든다.
                  // 켜를 하나로 줄여 봤더니 줄 바탕이 워낙 연해서(`accent-soft/60`) 그림자가
                  // 있는지도 모를 만큼 묻혔다(실측).
                  'data-[state=active]:shadow-[0_-1px_2px_rgba(0,0,0,0.07),0_-3px_6px_-1px_rgba(0,0,0,0.16),0_-8px_16px_-3px_rgba(0,0,0,0.16)]'
                )}
              >
                <Icon size={15} />
                {v.label}
              </Tabs.Trigger>
            )
          })}
        </Tabs.List>
      ) : (
        <span aria-hidden className="flex-1" />
      )}

      {handles.length > 0 && (
        <span className="flex shrink-0 items-center gap-1.5 py-1.5 pl-2 pr-3">
          {handles.map((a) => (
            <AreaHandle key={a} service={service} area={a} />
          ))}
        </span>
      )}
    </div>
  )

  if (!hasViews) return row

  return (
    <Tabs.Root value={view!.id} onValueChange={selectView} className="shrink-0">
      {row}
    </Tabs.Root>
  )
}
