// 스모크 스위트 — Remote › Diagram/Definition — 실 DB 역설계 ERD·정의·라이브 스키마 편집
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '07-remote-schema',
  needsDb: true,
  desc: 'Remote › Diagram/Definition — 실 DB 역설계 ERD·정의·라이브 스키마 편집'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page

  /**
   * 테이블 이름 → ERD 노드 id. 역설계 id 는 `t:<스키마>.<이름>` 이라 **연결마다 스키마가 다르다**
   * (MySQL 은 database 이름이 스키마 자리). 스위트가 id 를 글자로 박아 두면 스키마가 생기거나
   * 바뀔 때마다 통째로 깨진다(2026-07-31 실측: `t:users` → `t:testdb.users`).
   * 그래서 이름으로 찾아 그 자리에서 id 를 읽는다.
   */
  const nodeId = async (name) =>
    page.evaluate((n) => {
      const nodes = [...document.querySelectorAll('.react-flow__node[data-id^="t:"]')]
      const hit = nodes.find((el) => {
        const id = el.getAttribute('data-id') || ''
        return id === `t:${n}` || id.endsWith(`.${n}`)
      })
      return hit ? hit.getAttribute('data-id') : null
    }, name)
  /** 이름으로 노드 셀렉터를 만든다(없으면 절대 안 맞는 셀렉터 — 대기가 정직하게 실패한다). */
  const nodeSel = async (name) => {
    const id = await nodeId(name)
    return id ? `.react-flow__node[data-id="${id}"]` : '.react-flow__node[data-id="__none__"]'
  }
  /** 그 이름의 노드가 그려질 때까지 기다린다 — id 를 먼저 읽으려 하면 아직 아무것도 없다. */
  const waitNode = async (name) => {
    await page.waitForSelector('.react-flow__node[data-id^="t:"]', { timeout: 15_000 })
    await page.waitForFunction(
      (n) =>
        [...document.querySelectorAll('.react-flow__node[data-id^="t:"]')].some((el) => {
          const id = el.getAttribute('data-id') || ''
          return id === `t:${n}` || id.endsWith(`.${n}`)
        }),
      name,
      { timeout: 15_000 }
    )
    return nodeSel(name)
  }
  // Remote › Diagram — 같은 introspection TableDef[] 를 ERD 그래프로(Phase 2e · @xyflow+dagre).
  await click('button:has-text("Diagram")')
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
  await page.waitForTimeout(400)
  const diag = await body()
  check(
    'Remote › Diagram: ERD 노드(users/user_roles) 렌더',
    (await page.locator('.react-flow__node').count()) > 0 && diag.includes('users') && diag.includes('user_roles')
  )
  // FK 관계가 엣지로 그려진다(예: user_roles → users).
  check('Remote › Diagram: 관계 엣지(react-flow__edge) 존재', (await page.locator('.react-flow__edge').count()) > 0)

  // ⭐ v2 레이아웃 영속 — 노드를 드래그하면 위치가 저장되고, 탭을 벗어났다 와도 복원된다.
  const nodeTf = async (id) =>
    page.locator(`.react-flow__node[data-id="${id}"]`).first().evaluate((el) => el.style.transform)
  {
    const nd = page.locator(await nodeSel('users')).first()
    // ⚠ 오버레이(미니맵·컨트롤)에 덮이면 mousedown 이 그쪽으로 가 드래그가 조용히 안 되고,
    //   그 뒤 "왕복 후 복원" 비교는 둘 다 안 움직인 값이라 **거짓 통과**한다 → 먼저 집힘을 확인.
    const grab = await ctx.nodeGrabPoint(nd)
    check('Remote › Diagram: 드래그 대상(users)이 오버레이에 안 덮임', !!grab)
    const tfPre = await nodeTf(await nodeId('users'))
    await page.mouse.move(grab.from.x, grab.from.y)
    await page.mouse.down()
    await page.mouse.move(grab.from.x + 160, grab.from.y + 110, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(500) // onNodeDragStop → saveLayout(IPC)
    const dragged = await nodeTf(await nodeId('users'))
    check('Remote › Diagram: 드래그로 노드가 실제로 움직임', dragged !== tfPre)
    const savedCount = await page.evaluate(async () => {
      const cid = (await window.rockury.connections.list())[0].id
      const l = await window.rockury.diagram.getLayout(cid)
      return l && l.positions ? Object.keys(l.positions).length : 0
    })
    check('Remote › Diagram: 드래그 → 레이아웃 저장(getLayout 비어있지 않음)', savedCount > 0)
    // Object 탭으로 나갔다가 Diagram 으로 복귀 → 저장된 위치로 복원(dagre 기본이 아님)
    await click('button:has-text("Object")')
    await page.waitForTimeout(300)
    await click('button:has-text("Diagram")')
    await waitNode('users')
    await page.waitForTimeout(400)
    const restored = await nodeTf(await nodeId('users'))
    check('Remote › Diagram: 탭 왕복 후 드래그 위치 복원', restored === dragged)
  }

  // ⭐ CASE-remote-04C — 화면 이동(줌) **직후** 다른 화면으로 떠나도 저장된다.
  //    지연 저장(0.8초)을 취소만 하던 시절엔 마지막 조작이 통째로 날아갔다(정본 diagram.layout AC-2).
  const savedViewport = async () =>
    page.evaluate(async () => {
      const cid = (await window.rockury.connections.list())[0].id
      const l = await window.rockury.diagram.getLayout(cid)
      return l?.viewport ? `${Math.round(l.viewport.zoom * 1000)}` : null
    })
  {
    const before = await savedViewport()
    const canvas = await page.locator('.react-flow__pane').first().boundingBox()
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    await page.mouse.wheel(0, -400) // 줌 → onMoveEnd(지연 저장 예약)
    await page.waitForTimeout(150) // 지연이 끝나기 **전에** 떠난다
    await click('button:has-text("Object")')
    await page.waitForTimeout(1200)
    const after = await savedViewport()
    check('Remote › Diagram: 화면 이동 직후 떠나도 저장됨(지연 저장 마무리)', !!after && after !== before)
    await click('button:has-text("Diagram")')
    await waitNode('users')
    await page.waitForTimeout(400)
    check('Remote › Diagram: 왕복 후 화면 위치도 복원', (await savedViewport()) === after)
  }

  // ⭐ 그룹(레이어) — 정본 §db-remote.diagram.group / .group-panel
  const nodeXY = async (id) => {
    const tf = await page
      .locator(`.react-flow__node[data-id="${id}"]`)
      .first()
      .evaluate((el) => el.style.transform)
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(tf)
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null
  }
  /** 전체가 보이게 맞춘다 — 노드가 미니맵·컨트롤 밑으로 들어가면 클릭이 조용히 가로채인다. */
  const fitView = async () => {
    await page.locator('.react-flow__controls-fitview').first().click()
    await page.waitForTimeout(600)
  }
  /** 그 요소를 실제로 누를 수 있나(오버레이에 안 덮였나) — 덮였으면 클릭은 30초 대기 후 스위트를 죽인다. */
  const clickable = async (sel) => {
    const box = await page.locator(sel).first().boundingBox()
    if (!box) return null
    const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const hit = await page.evaluate(
      ({ x, y, sel }) => !!document.elementFromPoint(x, y)?.closest(sel),
      { ...pt, sel }
    )
    return hit ? pt : null
  }

  {
    await page.locator('[data-side-tab="groups"]').first().click()
    await page.waitForTimeout(200)
    check('Remote › Diagram: 좌측 `그룹` 탭 존재', (await page.locator('[data-diagram-group-panel]').count()) > 0)

    await page.locator('[data-group-create]').first().click()
    await page.keyboard.press('Escape') // 이름 바꾸기 입력 닫기(기본 이름 유지)
    await page.waitForTimeout(250)
    check('Remote › Diagram: 그룹 만들기 → 목록에 뜬다', (await page.locator('[data-group-row="그룹 1"]').count()) > 0)

    // 소속은 명시 멤버십 — 패널에서 넣어도 캔버스에서 끌어 넣은 것과 같은 것을 건드린다.
    for (const t of ['users', 'user_roles']) {
      await page.locator(`[data-group-member="${t}"] select`).first().selectOption('g1')
      await page.waitForTimeout(150)
    }
    check(
      'Remote › Diagram: 패널에서 그룹에 넣기 → 캔버스에 그룹 영역이 그려진다',
      (await page.locator('[data-erd-group="그룹 1"]').count()) > 0
    )
    await page.waitForTimeout(600) // 그룹 저장은 지연(0.35초) — 저장본으로 소속을 확인한다
    const savedPos = async (id) =>
      page.evaluate(async (nid) => {
        const cid = (await window.rockury.connections.list())[0].id
        const l = await window.rockury.diagram.getLayout(cid)
        return l?.positions?.[nid] ?? null
      }, id)
    /** 저장본의 `그룹 1` 한 줄 — 소속 수·손 크기까지. */
    const savedGroup = async () =>
      page.evaluate(async () => {
        const cid = (await window.rockury.connections.list())[0].id
        const l = await window.rockury.diagram.getLayout(cid)
        const g = (l?.groups ?? []).find((x) => x.id === 'g1')
        return g ? { n: g.tableIds.length, w: g.w ?? null, h: g.h ?? null } : null
      })
    const savedGroups = async () =>
      page.evaluate(async () => {
        const cid = (await window.rockury.connections.list())[0].id
        const l = await window.rockury.diagram.getLayout(cid)
        return (l?.groups ?? []).map((g) => ({ id: g.id, name: g.name, n: g.tableIds.length }))
      })
    check(
      'Remote › Diagram: 소속이 저장본에 2개로 들어간다',
      (await savedGroups()).some((g) => g.id === 'g1' && g.n === 2)
    )

    // AC-1 — 그룹 상자는 테이블·관계선보다 **뒤에** 깔린다(내용을 가리지 않는다).
    {
      const z = await page
        .locator('[data-erd-group="그룹 1"]')
        .first()
        .evaluate((el) => getComputedStyle(el.closest('.react-flow__node')).zIndex)
      check('Remote › Diagram: 그룹 상자가 테이블·관계선보다 뒤에 깔린다', Number(z) < 0)
    }

    const near = (a, b) => Math.abs(a - b) < 6

    // 그룹 안 테이블 하나만 끌면 그것만 움직인다(개별 이동도 그대로 된다).
    await fitView()
    {
      const grab = await ctx.nodeGrabPoint(page.locator(await nodeSel('users')).first())
      check('Remote › Diagram: 그룹 안 테이블을 집을 수 있음', !!grab)
      if (grab) {
        const before = await nodeXY(await nodeId('user_roles'))
        await page.mouse.move(grab.from.x, grab.from.y)
        await page.mouse.down()
        await page.mouse.move(grab.from.x - 50, grab.from.y - 40, { steps: 8 })
        await page.mouse.up()
        await page.waitForTimeout(400)
        const after = await nodeXY(await nodeId('user_roles'))
        check(
          'Remote › Diagram: 그룹 안 테이블 하나만 끌면 그것만 움직인다',
          near(before.x, after.x) && near(before.y, after.y)
        )
      }
      // 이 드래그는 영역 밖으로 나갈 수 있어(배율 0.1 에서 50px = 500 좌표) 소속이 풀린다 —
      // 뒤 검사들은 소속 2개를 전제하므로 패널로 되돌려 놓는다.
      if (!(await savedGroups()).some((g) => g.id === 'g1' && g.n === 2)) {
        await page.locator('[data-side-tab="groups"]').first().click()
        await page.locator('[data-group-member="users"] select').first().selectOption('g1')
        await page.waitForTimeout(600)
      }
      check(
        'Remote › Diagram: 개별 이동 뒤 소속 2개 전제 회복',
        (await savedGroups()).some((g) => g.id === 'g1' && g.n === 2)
      )
    }

    // ⭐ 작은 표적(그룹 접기 버튼·크기 조절 손잡이·상자 안쪽)은 **확대된 상태에서만** 만진다.
    //   전체 배율은 최소(0.1)까지 내려가고 — 테이블이 32개다 — 그때 이름표 안 버튼은 1~2px 이라
    //   눌리는 게 운에 달린다(실측 flake). `그룹만 보기` 로 그 그룹만 남기면 배율이 크게 오른다.
    {
      await page.locator('[data-group-only="그룹 1"]').first().click()
      await page.waitForTimeout(400)
      await fitView()
      const boxOf = async () => page.locator('[data-erd-group="그룹 1"]').first().boundingBox()

      // AC-6a — 상자 크기 손조절 → 저장 → `자동 크기` 로 되돌리기.
      {
        const h = await page
          .locator('[data-erd-group="그룹 1"] .react-flow__resize-control.handle.bottom.right')
          .first()
          .boundingBox()
        check('Remote › Diagram: 그룹 크기 조절 손잡이 존재', !!h)
        if (h) {
          await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
          await page.mouse.down()
          await page.mouse.move(h.x + h.width / 2 + 120, h.y + h.height / 2 + 90, { steps: 10 })
          await page.mouse.up()
          await page.waitForTimeout(700)
          const sized = await savedGroup()
          check('Remote › Diagram: 손으로 조절한 크기가 저장된다', !!sized && sized.w > 0 && sized.h > 0)
          await page.locator('[data-group-autosize="그룹 1"]').first().click()
          await page.waitForTimeout(600)
              check('Remote › Diagram: `자동 크기` 로 손 크기가 지워진다', (await savedGroup())?.w == null)
          // 회귀 — 크기 조절의 **투명한 변**이 pointer-events 를 잡으면 상자 가장자리에 걸친
          //   테이블을 누를 수 없다(실측: 편집 진입 후 노드 클릭이 30초 대기 후 실패했다).
          const edgeEatsClick = await page.evaluate(() => {
            const box = document.querySelector('[data-erd-group]')?.getBoundingClientRect()
            if (!box) return 'no-box'
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height - 1)
            return hit?.classList.contains('react-flow__resize-control') ? 'line-eats' : 'ok'
          })
          check('Remote › Diagram: 그룹 상자 가장자리가 클릭을 가로채지 않는다', edgeEatsClick === 'ok')
        }
      }

      // CASE-remote-04E — 캔버스 이름표의 접기 버튼으로 접고 펴기.
      {
        const pt = await clickable('[data-erd-group-toggle="그룹 1"]')
        check('Remote › Diagram: 캔버스 그룹 접기 버튼을 누를 수 있음', !!pt)
        if (pt) {
          const posBefore = await nodeXY(await nodeId('users'))
          await page.mouse.click(pt.x, pt.y)
          await page.waitForTimeout(600)
          check(
            'Remote › Diagram: 그룹 접기 → 소속 노드 숨고 상자만 남는다',
            (await page.locator(await nodeSel('users')).count()) === 0 &&
              (await page.locator('[data-erd-group-collapsed="true"]').count()) > 0
          )
          const back = await clickable('[data-erd-group-toggle="그룹 1"]')
          if (back) await page.mouse.click(back.x, back.y)
          await page.waitForTimeout(700)
          check(
            'Remote › Diagram: 그룹 펴기 → 소속 노드 복귀',
            (await page.locator(await nodeSel('users')).count()) === 1
          )
          // AC-5a 회귀 — 펴면 **접기 전 자리**로 돌아와야 한다(자동 배치 자리로 튀면 배치가 사라진다).
          const posAfter = await nodeXY(await nodeId('users'))
          check(
            'Remote › Diagram: 펴면 접기 전 자리로 돌아온다',
            !!posBefore && !!posAfter && near(posBefore.x, posAfter.x) && near(posBefore.y, posAfter.y)
          )
        }
      }

      // CASE-remote-04I — 영역 밖으로 끌어내면 소속이 풀린다(멤버십을 바꾸므로 이 구간 마지막에).
      //   ⚠ 반대 방향(안으로 끌어 넣기)은 앱 흐름으로 안 덮는다 — 사유는 CASE-remote-04I 주석 참고.
      {
        const out = await boxOf()
        // ⚠ id 는 **끌기 전에** 읽어 둔다 — 소속이 풀리면 `그룹만 보기` 가 노드를 화면에서
        //   지우고, 그때 이름으로 id 를 찾으면 null 이 돼 저장본 조회가 조용히 빈손이 된다.
        const usersId = await nodeId('users')
        const grabOut = await ctx.nodeGrabPoint(page.locator(await nodeSel('users')).first())
        check('Remote › Diagram: 끌어내기 검사용 노드·상자 확보', !!grabOut && !!out && !!usersId)
        if (grabOut && out) {
          const before = await savedPos(usersId)
          await page.mouse.move(grabOut.from.x, grabOut.from.y)
          await page.mouse.down()
          await page.mouse.move(grabOut.from.x + out.width + 80, grabOut.from.y, { steps: 12 })
          await page.mouse.up()
          await page.waitForTimeout(800)
          // 드래그가 정말 일어났는지 먼저 가른다 — 안 움직였는데 "빠졌다"로 읽히면 거짓 통과다.
          // 소속이 풀리면 `그룹만 보기` 가 노드를 숨기므로 화면이 아니라 **저장본 좌표**로 본다.
          const moved = await savedPos(usersId)
          check('Remote › Diagram: 끌어내기 드래그가 실제로 일어남', !!before && !!moved && moved.x > before.x + 20)
          check('Remote › Diagram: 영역 밖으로 끌어내면 그룹에서 빠진다', (await savedGroup())?.n === 1)
        }
      }

      // 필터를 끄고 소속을 되돌린다 — 뒤 검사들은 소속 2개를 전제한다.
      await page.locator('[data-group-only="그룹 1"]').first().click()
      await page.waitForTimeout(400)
      if ((await savedGroup())?.n !== 2) {
        await page.locator('[data-group-member="users"] select').first().selectOption('g1')
        await page.waitForTimeout(600)
      }
      check('Remote › Diagram: 패널로 다시 넣으면 소속 복귀', (await savedGroup())?.n === 2)
    }

    // CASE-remote-04D — 이름표를 끌면 소속 테이블이 같은 거리만큼 함께 움직인다.
    await fitView()
    {
      const u0 = await nodeXY(await nodeId('users'))
      const r0 = await nodeXY(await nodeId('user_roles'))
      const pt = await clickable('[data-erd-group="그룹 1"] .erd-group-handle')
      check('Remote › Diagram: 그룹 이름표가 오버레이에 안 덮임', !!pt)
      if (pt) {
        await page.mouse.move(pt.x, pt.y)
        await page.mouse.down()
        await page.mouse.move(pt.x + 70, pt.y + 50, { steps: 12 })
        await page.mouse.up()
        await page.waitForTimeout(500)
        const u1 = await nodeXY(await nodeId('users'))
        const r1 = await nodeXY(await nodeId('user_roles'))
        check(
          'Remote › Diagram: 그룹 이름표를 끌면 소속 테이블이 같이 움직인다',
          u1.x - u0.x > 30 && near(u1.x - u0.x, r1.x - r0.x) && near(u1.y - u0.y, r1.y - r0.y)
        )
      }
    }

    // CASE-remote-04F — 그룹만 보기 / 그룹 삭제는 테이블을 지우지 않는다.
    const tableNodes = async () => page.locator('.react-flow__node[data-id^="t:"]').count()
    const allTables = await tableNodes()
    await page.locator('[data-group-only="그룹 1"]').first().click()
    await page.waitForTimeout(450)
    const onlyCount = await tableNodes()
    check('Remote › Diagram: 그룹만 보기 → 그 그룹 소속만 남는다', onlyCount === 2 && onlyCount < allTables)
    await page.locator('[data-group-only="그룹 1"]').first().click()
    await page.waitForTimeout(450)
    check('Remote › Diagram: 그룹만 보기 끄면 전체 복귀', (await tableNodes()) === allTables)

    // 지우기는 **버리는 그룹**으로 확인한다 — `그룹 1` 은 콜드 재시작 영속 검사(12)까지 남긴다.
    await page.locator('[data-group-create]').first().click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    check('Remote › Diagram: 버리는 그룹(그룹 2) 생성', (await page.locator('[data-group-row="그룹 2"]').count()) === 1)
    // AC-4 — `자동 배치` 는 배치만 되돌리고 **그룹은 남긴다**(소속은 위치와 무관한 멤버십).
    await click('button:has-text("자동 배치")')
    await waitNode('users')
    await page.waitForTimeout(900)
    // 방금 만든 그룹 2 는 아직 저장 대기 중일 수 있다 — 자동 배치가 그걸 날리지 않아야 한다(회귀).
    const afterReset = await savedGroups()
    check(
      'Remote › Diagram: 자동 배치 후에도 그룹·소속이 남는다',
      afterReset.some((g) => g.id === 'g1' && g.n === 2) && afterReset.some((g) => g.id === 'g2')
    )
    await page.locator('[data-side-tab="groups"]').first().click()
    await page.waitForTimeout(200)

    // 지우기는 확인 창을 띄운다(정본 group-panel AC-2a). 운영부 창에는 **테이블 동반 삭제가 없다**(AC-2b)
    //  — 실 DB 테이블을 지우는 길은 편집 모드의 DDL·트랜잭션 게이트뿐이어야 한다.
    //  소속이 있는 `그룹 1` 로 열어 그 사실을 확인하고 취소한 뒤, 버리는 `그룹 2` 를 지운다.
    await page.locator('[data-group-delete="그룹 1"]').first().click()
    await page.waitForTimeout(400)
    check(
      'Remote › Diagram: 지우기 → 확인 창이 뜨고 아직 안 지워진다',
      (await page.locator('[data-group-delete-dialog="그룹 1"]').count()) === 1 &&
        (await page.locator('[data-group-row="그룹 1"]').count()) === 1
    )
    check(
      'Remote › Diagram: 운영부 확인 창에는 테이블 동반 삭제가 없다',
      (await page.locator('[data-group-delete-with-tables]').count()) === 0
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    check('Remote › Diagram: 취소하면 그룹이 그대로', (await page.locator('[data-group-row="그룹 1"]').count()) === 1)

    await page.locator('[data-group-delete="그룹 2"]').first().click()
    await page.waitForTimeout(400)
    await page.locator('[data-group-delete-only]').first().click()
    await page.waitForTimeout(500)
    check(
      'Remote › Diagram: 그룹만 지우기 → 그룹은 사라지고 테이블은 남는다',
      (await page.locator('[data-group-row="그룹 2"]').count()) === 0 && (await tableNodes()) === allTables
    )
    await page.locator('[data-side-tab="tables"]').first().click()
    await page.waitForTimeout(150)
    await fitView()
  }

  // ⭐ CASE-remote-04G — 상세보기 서랍(내용은 Definition 화면 그대로) + SQL + FK 이동 + 크게 보기.
  {
    await page.locator(await nodeSel('user_roles')).first().click()
    await page.waitForTimeout(400)
    check('Remote › Diagram: 노드 클릭 → 아래 상세 서랍이 열린다', (await page.locator('[data-diagram-drawer="open"]').count()) > 0)
    const drawer = page.locator('[data-diagram-drawer="open"]')
    const drawerText = await drawer.innerText()
    check(
      'Remote › Diagram: 서랍에 컬럼·제약이 뜬다(Definition 화면 그대로)',
      /constraints/i.test(drawerText) && drawerText.includes('user_id')
    )

    await page.locator('[data-drawer-form="sql"]').first().click()
    await page.waitForTimeout(300)
    check('Remote › Diagram: 서랍 SQL 토글 → CREATE 문', (await drawer.innerText()).includes('CREATE'))
    await page.locator('[data-drawer-form="table"]').first().click()
    await page.waitForTimeout(250)

    await page.locator('[data-fk-jump="users"]').first().click()
    await page.waitForTimeout(900)
    check(
      'Remote › Diagram: 상세의 FK 참조를 누르면 그 테이블로 이동하고 서랍도 바뀐다',
      (await page.locator('[data-diagram-drawer="open"]').innerText()).includes('users')
    )

    await page.locator('[data-drawer-expand]').first().click()
    await page.waitForTimeout(400)
    check('Remote › Diagram: 크게 보기 → 모달', (await page.locator('[data-drawer-modal]').count()) > 0)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    check('Remote › Diagram: 모달 닫힘', (await page.locator('[data-drawer-modal]').count()) === 0)
    await page.locator('[data-drawer-toggle]').first().click() // 서랍 접기(뒤 검사에 자리 양보)
    await page.waitForTimeout(250)
  }

  // 검색 — 매칭 테이블만 강조(data-erd-match). 'user' → users/user_roles 매칭.
  await page.locator('input[placeholder="테이블/컬럼 검색"]').fill('user')
  await page.waitForTimeout(300)
  check('Remote › Diagram: 검색 매칭 강조', (await page.locator('[data-erd-match="true"]').count()) > 0)
  await page.locator('input[placeholder="테이블/컬럼 검색"]').fill('')
  await page.waitForTimeout(200)
  check('Remote › Diagram: 검색 지우면 강조 해제', (await page.locator('[data-erd-match="true"]').count()) === 0)

  // 간략 토글 — 컬럼 접힘(data-erd-compact).
  await click('button:has-text("간략")')
  await page.waitForTimeout(200)
  check('Remote › Diagram: 간략 토글 → 컬럼 접힘', (await page.locator('[data-erd-compact="true"]').count()) > 0)
  await click('button:has-text("간략")') // 원복
  await page.waitForTimeout(150)

  // 좌측 테이블 목록 패널 — Data 사이드바와 같은 구성. 항목을 누르면 그 테이블로 캔버스가 이동한다.
  {
    const panel = page.locator('[data-diagram-table-panel]')
    check('Remote › Diagram: 좌측 테이블 목록 패널 존재', (await panel.count()) > 0)
    const viewport = page.locator('.react-flow__viewport').first()
    const before = await viewport.getAttribute('style')
    await panel.locator('[data-table-row="user_roles"]').first().click()
    await page.waitForTimeout(900) // fitView 애니메이션(400ms) 여유
    const after = await viewport.getAttribute('style')
    check('Remote › Diagram: 목록 클릭 → 해당 테이블로 캔버스 이동(포커싱)', before !== after)
  }

  // 내보내기 — PNG 클릭 → html-to-image 캡처 성공(toolbar data-export-status=ok).
  // (Electron 에선 data-URL 다운로드 이벤트가 Playwright 로 안 잡혀, 캡처 성공 여부를 상태로 검증.)
  await page.locator('.react-flow__panel button:has-text("PNG")').first().click()
  await page.waitForSelector('[data-export-status="ok"]', { timeout: 15_000 })
  check('Remote › Diagram: PNG 내보내기(html-to-image 캡처 성공)', (await page.locator('[data-export-status="ok"]').count()) > 0)

  // Remote › Diagram 편집 — 편집 진입 → 노드 선택 시 편집 패널 → 캔버스 + 로 테이블 추가(노드 증가·대기 변경) → 버리기.
  // (적용 파이프라인은 Definition 에서 실 DB 왕복으로 검증됨 — 여기선 다이어그램 편집 UI 만 확인, DB 무변경.)
  await click('button:text-is("편집")')
  await page.waitForSelector('.react-flow__node', { timeout: 10_000 })
  await page.waitForTimeout(300)
  // 그룹 상자도 노드로 그려지므로 **테이블 노드만** 센다(`t:` 접두어).
  const editNodes0 = await page.locator('.react-flow__node:not([data-id^="grp:"])').count()
  // ⚠ `.first()` 로 집으면 안 된다 — 첫 노드가 캔버스 밖(좌측 패널 아래)에 놓여 있으면
  //   클릭이 패널에 가로채여 30초 대기 끝에 스위트가 죽는다(실측). 하네스의 hit-test 로 고른다.
  const editTarget = await ctx.pickDraggableNode('.react-flow__node[data-id^="t:"]')
  check('Remote › Diagram 편집: 누를 수 있는 테이블 노드 확보', !!editTarget)
  if (editTarget) await page.mouse.click(editTarget.from.x, editTarget.from.y)
  await page.waitForTimeout(500)
  check(
    'Remote › Diagram 편집: 노드 선택 → 상세 서랍이 Definition 편집 화면을 그대로 연다',
    (await page.locator('[data-diagram-drawer="open"]').count()) > 0 &&
      /constraints/i.test(await page.locator('[data-diagram-drawer="open"]').innerText())
  )
  await page.locator('.react-flow__panel button:has-text("테이블")').first().click()
  await page.waitForTimeout(400)
  check(
    'Remote › Diagram 편집: 캔버스 + → 노드 증가 + 대기 변경',
    (await page.locator('.react-flow__node:not([data-id^="grp:"])').count()) > editNodes0 &&
      (await body()).includes('대기 변경')
  )
  await click('button:has-text("버리기")')
  await page.waitForSelector('button:text-is("편집")', { timeout: 10_000 })
  check('Remote › Diagram 편집: 버리기 → 읽기 모드 복귀', (await page.locator('button:text-is("편집")').count()) > 0)

  // Remote › Definition — 같은 introspection TableDef[] 를 Design Definition 형태(목록 | 상세/DDL)로.
  await click('button:has-text("Definition")')
  await page.waitForSelector('text=user_roles', { timeout: 15_000 })
  const defBody = await body()
  check(
    'Remote › Definition: 사이드바 실 DB 테이블 목록(users/user_roles)',
    defBody.includes('users') && defBody.includes('user_roles')
  )
  // 목록은 테이블과 뷰(view)를 갈라 보인다 — 테스트 DB 의 v_user_summary 가 뷰 묶음에 들어간다.
  check(
    'Remote › Definition: 목록이 테이블/뷰를 가른다(v_user_summary 는 뷰)',
    (await page.locator('[data-table-row="v_user_summary"]').count()) > 0 && defBody.includes('뷰')
  )

  // 사이드바에서 테이블 선택 → SQL(DDL) 뷰 토글 → 실 introspection + generateDdl 로 CREATE 문 렌더.
  // NOTE: 토글은 :text-is 로 정확 일치 — has-text 는 ContextBar 의 "MySQL" 버튼까지 잡는다.
  await page.locator('[data-table-row="user_roles"]').first().click()
  await page.waitForTimeout(200)

  // FK 정책은 ON DELETE·ON UPDATE 를 **둘 다** 보인다(실 DB 는 두 값을 다 주는데 전엔 삭제 쪽만 그렸다).
  {
    const fkBody = await body()
    check(
      'Remote › Definition: FK 정책 ON DELETE·ON UPDATE 동시 표기',
      fkBody.includes('ON DELETE CASCADE') && fkBody.includes('ON UPDATE CASCADE')
    )
  }
  await click('button:text-is("SQL")')
  await page.waitForSelector('text=CREATE TABLE', { timeout: 10_000 })
  const ddlBody = await body()
  check(
    'Remote › Definition: SQL 뷰 DDL(CREATE TABLE user_roles) 렌더',
    ddlBody.includes('CREATE TABLE') && ddlBody.includes('user_roles')
  )
  await click('button:text-is("Table")') // Table 폼으로 복귀
  await page.waitForTimeout(150)

  // ⭐ 고른 표는 뷰를 옮겨도 유지된다(2026-08-04 사용자 요청 — "자꾸 초기화되니까 보기가 쉽지 않네").
  //    Definition·Diagram·Data 가 각자 로컬 state 를 들고 있던 동안은 옮길 때마다 첫 표로 돌아갔다.
  //    색으로만 드러나는 종류라 다른 게이트가 못 잡는다 → 여기서 못박는다.
  {
    const activeRow = async () =>
      page.locator('[data-table-active="true"]').first().getAttribute('data-table-row').catch(() => null)
    check('Remote › Definition: 고른 표(user_roles)가 활성으로 표시된다', (await activeRow()) === 'user_roles')

    await click('button:has-text("Diagram")')
    await page.waitForTimeout(1_500)
    check(`Remote › Diagram: 고른 표가 유지된다 (${await activeRow()})`, (await activeRow()) === 'user_roles')

    await click('button:has-text("Data")')
    await page.waitForTimeout(2_500)
    check(`Remote › Data: 고른 표를 그대로 연다 (${await activeRow()})`, (await activeRow()) === 'user_roles')

    // 반대 방향도 같다 — Data 에서 고르면 Definition 이 따라온다.
    await page.locator('[data-table-row="users"]').first().click()
    await page.waitForTimeout(1_500)
    await click('button:has-text("Definition")')
    await page.waitForTimeout(1_500)
    check(`Remote › Definition: Data 에서 고른 users 로 따라온다 (${await activeRow()})`, (await activeRow()) === 'users')

    // 뒤 검사가 user_roles 를 전제하므로 되돌려 놓는다.
    await page.locator('[data-table-row="user_roles"]').first().click()
    await page.waitForTimeout(300)
  }

  // Remote › Definition 편집 — 라이브 스키마 편집: 대기 변경 → DDL 미리보기 → tx 게이트 적용 → 재역설계.
  // 공유 테스트 DB 를 오염시키지 않도록 rky_probe 를 만들었다 되지운다(생성/삭제 왕복 = 클린).
  await click('button:text-is("편집")')
  await page.waitForTimeout(200)
  await page.locator('button[aria-label="테이블 추가"]').first().click()
  await page.waitForTimeout(200)
  await page.locator('input[placeholder="테이블명"]').fill('rky_probe')
  await page.locator('button:has-text("컬럼 추가")').first().click()
  await page.waitForTimeout(150)
  await page.locator('input[placeholder="컬럼명"]').last().fill('note')
  await page.waitForTimeout(150)
  check('Remote › Definition 편집: 대기 변경 미리보기', (await body()).includes('대기 변경'))
  await click('button:text-is("적용")')
  await page.waitForSelector('button:text-is("편집")', { timeout: 15_000 }) // 편집 종료 = 적용 완료
  await page.waitForTimeout(500)
  check('Remote › Definition 편집: 생성 적용 → 재역설계에 rky_probe 반영', (await body()).includes('rky_probe'))

  // 파괴적 편집(테이블 삭제) — 경고 후 적용, DB 를 원상 복구(rky_probe 제거).
  await click('button:text-is("편집")')
  await page.waitForTimeout(200)
  await page.locator('[data-table-row="rky_probe"]').first().click()
  await page.waitForTimeout(200)
  await page.locator('button[aria-label="테이블 메뉴"]').first().click()
  await page.waitForTimeout(150)
  await click('[role="menuitem"]:has-text("테이블 삭제")')
  await page.waitForTimeout(200)
  check('Remote › Definition 편집: 삭제는 파괴적 경고 표시', (await body()).includes('파괴적'))
  await click('button:text-is("적용")') // window.confirm 은 acceptDialogs 로 자동 수락
  await page.waitForSelector('button:text-is("편집")', { timeout: 15_000 })
  await page.waitForTimeout(500)
  check('Remote › Definition 편집: 삭제 적용 → rky_probe 사라짐(DB 원복)', !(await body()).includes('rky_probe'))

}
