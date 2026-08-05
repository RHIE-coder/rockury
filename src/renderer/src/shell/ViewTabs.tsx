import { Fragment } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { useActive, useNav } from '../nav/useNav'
import { handleLayoutFor, handlesFor, isAreaSplit } from '../nav/moduleSlots'
import type { ModuleArea } from '../nav/types'
import { groupViews, hasGroupLabels } from '../nav/viewGroups'
import { areaAccent } from './areaAccent'
import { AreaHandle, selectorsIn } from './AreaHandle'
import { cx } from '../lib/cx'

/**
 * 묶음 이름표의 색조 — 그 흐름이 **출발하는** 부서 색이다(설계=시안, 운영=테라코타).
 * 방향을 글자로만 적으면(`설계 → 실제`) 탭 사이에 묻히는데, 출발 색이 붙으면 위 모듈 줄의
 * 부서 카드와 같은 색이라 어디서 어디로 가는 일인지가 눈으로 이어진다.
 */
const GROUP_TONE: Record<ModuleArea, string> = {
  design: 'text-accent',
  ops: 'text-accent-2',
  common: 'text-muted'
}

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
  // 손잡이가 **어느 줄에 서는가**는 모듈이 정한다(`Module.handleLayout`).
  //   `end`   — 이 줄(뷰 탭 줄) 오른쪽 끝. 안 적은 화면의 기본값이다.
  //   `sides` — 이 줄이 아니라 **위 모듈 줄의 양옆**(2026-08-05 사용자 요청) → 여기선 안 그린다.
  //             모듈 줄은 가운데 몇 칸만 서 있고 양옆이 통째로 비어 있어서, 늘 보는 대상을
  //             거기 두면 뷰 탭이 자리를 다 쓴다(`ModuleTabs` 가 그린다).
  const rightHandles = handleLayoutFor(module) === 'sides' ? [] : handles

  const handleRow = (areas: ModuleArea[], side: 'left' | 'right') =>
    areas.length > 0 && (
      <span
        className={cx(
          'flex shrink-0 items-center gap-1.5 py-1.5',
          side === 'left' ? 'pl-3 pr-1' : 'pl-2 pr-3'
        )}
      >
        {areas.map((a) => (
          <AreaHandle key={a} service={service} area={a} />
        ))}
      </span>
    )

  const row = (
    <div className={cx('flex shrink-0 items-stretch border-b', accent.strip)}>
      {hasViews ? (
        <Tabs.List
          aria-label="뷰"
          // 카드끼리는 좁게(gap-1) — 예전 gap-5 는 밑줄만 있을 때의 간격이라, 카드가 되면
          // 탭 사이가 벌어져 한 벌로 안 읽힌다.
          className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-3 pt-1.5"
        >
          {/*
           * 뷰는 **묶음 단위**로 선다(`nav/viewGroups`). 이름표를 안 쓴 모듈은 묶음이 하나뿐이라
           * 예전과 똑같이 그려진다 — 구분선도 이름표 단도 안 생긴다(높이가 그대로다).
           */}
          {groupViews(module.views!).map((run, i, runs) => (
            <Fragment key={run.label ?? `-${i}`}>
              {i > 0 && <span aria-hidden className="mx-1 mb-2 w-px shrink-0 self-stretch bg-line" />}
              {/*
                이름표는 **탭 위 단**이고 탭은 그 아래다(2026-08-04 사용자 요청 — "진단,
                설계→실제 이런 걸 위에 그리고 그 아래 해당 네비"). 한 줄에 나란히 두었더니
                이름표가 탭 사이에 끼어 어느 탭까지가 그 묶음인지가 안 갈렸다.
                묶음마다 세로로 쌓아서 이름표가 **자기 탭들 위에만** 걸리게 한다.
              */}
              <span className="flex min-w-0 flex-col">
                {/*
                  이름표 단은 **이름표를 쓰는 화면에만** 선다. 안 쓰는 화면(지금은 Migration 말고 전부)에
                  빈 줄이라도 세우면 다섯 서비스 모든 탭 줄이 한 단씩 높아진다 — 2026-08-05 피드백 네 건이
                  전부 그 말이었다("이걸 왜 높여"). 밑선 맞춤은 이름표를 쓰는 줄 **안에서만** 필요한 문제다.
                */}
                {hasGroupLabels(runs) && (
                  <span
                    // e2e·화면 게이트 훅 — 방향 묶음이 줄에 섰는지를 모양이 아니라 역할로 집는다.
                    data-view-group={run.label}
                    className={cx(
                      'px-2 pb-1 text-[10px] font-semibold tracking-wide',
                      GROUP_TONE[run.tone ?? 'common']
                    )}
                  >
                    {run.label ?? ' '}
                  </span>
                )}
                <span className="flex min-w-0 items-end gap-1">
                  {run.views.map((v) => {
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
                </span>
              </span>
            </Fragment>
          ))}
        </Tabs.List>
      ) : (
        <span aria-hidden className="flex-1" />
      )}

      {handleRow(rightHandles, 'right')}
    </div>
  )

  if (!hasViews) return row

  return (
    <Tabs.Root value={view!.id} onValueChange={selectView} className="shrink-0">
      {row}
    </Tabs.Root>
  )
}
