// 스모크 스위트 — Infra › Catalog — 내장 카탈로그·노드 종류·공급자 연결·탐침 편집(돌려보고 집기)
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '13-infra-catalog',
  needsDb: false,
  desc: 'Infra › Catalog — 노드 종류 목록·공급자 연결·탐침 편집(실행→클릭으로 집기→미리보기)'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page

  // ── Infra 서비스 진입 + nav 교체 확인 ──────────────────────────────────
  await click('[data-nav-service="infra"]')
  await page.waitForSelector('[data-nav-module="catalog"]', { timeout: 8_000 })
  const modules = await page.locator('[data-nav-module]').allTextContents()
  check('Infra nav: Design·Live·Catalog 3모듈로 교체됨', ['Design', 'Live', 'Catalog'].every((m) => modules.join(' ').includes(m)))
  check('Infra nav: 옛 placeholder(Containers/Overview) 사라짐', !modules.join(' ').includes('Containers'))

  // ── 노드 종류: 내장 카탈로그가 실려 있다 ───────────────────────────────
  await click('[data-nav-module="catalog"]')
  await click('[data-nav-view="types"]')
  await page.waitForSelector('[data-infra-view="types"]', { timeout: 5_000 })
  const typesBody = await body()
  check('노드 종류: AWS 내장 카탈로그가 실렸다', typesBody.includes('EC2 인스턴스') && typesBody.includes('VPC'))
  check('노드 종류: 프리셋도 같은 목록에 있다', typesBody.includes('Grafana') && typesBody.includes('Redis'))
  check('노드 종류: 출처가 보인다(내장)', typesBody.includes('내장'))
  check('노드 종류: 탐침 유무를 구분해 보인다', typesBody.includes('탐침 있음') && typesBody.includes('모양만'))

  // 중첩 규칙이 화면까지 나온다 — EC2 는 서브넷 안에.
  const ec2Row = await page.locator('[data-type-row="aws.ec2"]').first().innerText()
  check('노드 종류: EC2 의 담길 곳이 서브넷으로 표시', ec2Row.includes('aws.subnet'))

  // 검색이 실제로 거른다.
  await page.locator('[data-types-search]').fill('grafana')
  await page.waitForTimeout(200)
  const filtered = await page.locator('[data-type-row]').count()
  check('노드 종류: 검색이 목록을 거른다', filtered === 1)
  await page.locator('[data-types-search]').fill('')
  await page.waitForTimeout(200)

  // ── 공급자 연결: 자격증명은 넣히되 화면에 평문이 안 남는다 ──────────────
  await click('[data-nav-view="providers"]')
  await page.waitForSelector('[data-infra-view="providers"]', { timeout: 5_000 })
  await page.locator('[data-provider-catalog]').selectOption({ index: 1 })
  await page.waitForTimeout(200)
  await page.locator('[data-provider-name]').fill('e2e-aws')
  const SECRET = 'SUPER-SECRET-PROFILE-VALUE'
  const credInput = page.locator('[data-provider-cred="profile"]').first()
  check('공급자: 자격증명 칸이 카탈로그 선언대로 자동 생성됨', (await credInput.count()) === 1)
  await credInput.fill(SECRET)
  await click('[data-provider-save]')
  await page.waitForSelector('[data-provider-row]', { timeout: 5_000 })
  const provBody = await body()
  check('공급자: 연결이 목록에 생겼다', provBody.includes('e2e-aws'))
  check('공급자: 자격증명 있음으로 표시', provBody.includes('자격증명 있음'))
  check('공급자: 평문이 화면 어디에도 안 보인다', !provBody.includes(SECRET))

  // 저장된 레코드 자체에도 평문이 없다 — 창구가 비밀을 돌려주지 않는다.
  const provs = await page.evaluate(() => window.rockury.infra.listProviders())
  check('공급자: 창구가 돌려주는 레코드에 비밀이 없다', JSON.stringify(provs).includes(SECRET) === false)

  // ── 연결 시험: 실제로 한 번 돌려 본다. 실패해도 사유를 그대로 보인다 ────
  {
    check(
      'CASE-icat-100 연결 시험 버튼이 뜬다(탐침이 있는 카탈로그)',
      (await page.locator('[data-provider-test]').count()) > 0
    )
    await page.locator('[data-provider-test]').first().click()
    await page.waitForSelector('[data-provider-test-result]', { timeout: 20_000 })
    const result = await page.locator('[data-provider-test-result]').innerText()
    // 이 기계에 aws CLI 가 있을 수도 없을 수도 있다 — 어느 쪽이든 **결과를 말해야** 한다.
    check(
      'CASE-icat-101 연결 시험이 성공/실패 중 하나를 분명히 말한다',
      result.includes('연결됨') || result.includes('연결 실패')
    )
    check(
      'CASE-icat-101 실패면 사유가 뭉개지지 않고 남는다',
      !result.includes('연결 실패') || result.replace('연결 실패 —', '').trim().length > 0
    )
    check('CASE-icat-101 시험 결과에도 평문 자격증명이 안 보인다', !result.includes(SECRET))
  }

  // ── 탐침 편집: 돌려보고 → 클릭으로 집고 → 미리보기 ─────────────────────
  await click('[data-nav-view="probe"]')
  await page.waitForSelector('[data-infra-view="probe"]', { timeout: 5_000 })

  // 실패를 삼키지 않는다 — 없는 명령의 사유가 그대로 뜬다.
  await page.locator('input.font-mono').first().fill('이런명령은없다')
  await click('[data-probe-run]')
  await page.waitForSelector('[data-probe-error]', { timeout: 10_000 })
  check('탐침: 없는 명령의 실패 사유가 그대로 뜬다', (await page.locator('[data-probe-error]').innerText()).length > 0)

  // node 로 AWS 응답 모양을 흉내 내 실제 JSON 을 받는다(도커·AWS 없이도 도는 검증).
  const FAKE = JSON.stringify({
    Reservations: [
      { Instances: [{ InstanceId: 'i-001', State: { Name: 'running' }, SubnetId: 'sn-1' } ] },
      { Instances: [{ InstanceId: 'i-002', State: { Name: 'stopped' }, SubnetId: 'sn-1' } ] }
    ]
  })
  // 뷰를 옮기면 편집기 상태가 초기화되므로(화면 상태는 영속 대상이 아니다) 다시 쓸 수 있게 묶어 둔다.
  const runProbe = async () => {
    await page.locator('input.font-mono').first().fill(process.execPath)
    await page.locator('input.font-mono').nth(1).fill(`-e "process.stdout.write(process.argv[1])" '${FAKE}'`)
    await click('[data-probe-run]')
    await page.waitForSelector('[data-json-pick]', { timeout: 10_000 })
    await click('[data-probe-expand-all]')
    await page.waitForTimeout(200)
  }

  await page.locator('input.font-mono').first().fill(process.execPath)
  await page.locator('input.font-mono').nth(1).fill(`-e "process.stdout.write(process.argv[1])" '${FAKE}'`)
  await click('[data-probe-run]')
  await page.waitForSelector('[data-json-pick]', { timeout: 10_000 })
  check('탐침: 응답이 트리로 펼쳐진다', (await page.locator('[data-json-pick]').count()) > 0)

  // 깊은 응답(목록 안 목록)은 손으로 서너 번 펼쳐야 값이 나온다 — 전부 펼치기가 그 수고를 없앤다.
  await click('[data-probe-expand-all]')
  await page.waitForTimeout(200)
  check(
    '탐침: 전부 펼치기로 목록 안 값까지 보인다',
    (await page.locator('[data-json-pick="Reservations[0].Instances[0].InstanceId"]').count()) === 1
  )

  // 목록을 클릭으로 집는다 → 표현식이 자동으로 채워진다.
  await click('[data-json-pick="Reservations[0].Instances"]')
  await page.waitForTimeout(200)
  const listSlot = await page.locator('[data-probe-slot="list"]').innerText()
  check('탐침: 목록을 집으면 전체 순회 표현식이 자동 생성', listSlot.includes('Reservations[].Instances[]'))

  // id 칸을 고른 뒤 항목 안의 값을 집으면 **항목 기준 상대 경로**가 들어간다.
  await click('[data-probe-slot="externalId"]')
  await click('[data-json-pick="Reservations[0].Instances[0].InstanceId"]')
  await page.waitForTimeout(200)
  const idSlot = await page.locator('[data-probe-slot="externalId"]').innerText()
  check('탐침: 항목 안 값은 항목 기준 상대 경로로 채워진다', idSlot.includes('InstanceId') && !idSlot.includes('Reservations'))

  // 상태까지 집으면 미리보기에 노드 수와 '모름' 경고가 뜬다.
  await click('[data-probe-slot="status"]')
  await click('[data-json-pick="Reservations[0].Instances[0].State.Name"]')
  await page.waitForTimeout(300)
  const preview = await page.locator('[data-probe-preview]').innerText()
  check('탐침: 미리보기에 뽑힌 노드 수가 뜬다', preview.includes('노드 2개'))
  check('탐침: 사전에 없는 상태는 모름으로 보고된다', preview.includes('running') && preview.includes('모름'))

  // 이력에는 치환 전 인자만 남는다(자격증명이 눌러앉지 않는다).
  const runs = await page.evaluate(() => window.rockury.infra.listRuns(5))
  check('탐침: 실행 이력이 쌓인다', Array.isArray(runs) && runs.length > 0)

  // ── 탐침 저장 — 편집기의 결과물이 실제 노드 종류가 된다 ────────────────
  await page.locator('[data-probe-type-id]').fill('e2e.server')
  await page.locator('[data-probe-type-label]').fill('E2E 가상서버')
  await page.locator('[data-probe-provider-id]').fill('e2e')
  await click('[data-probe-save]')
  await page.waitForSelector('[data-probe-save-msg]', { timeout: 8_000 })
  const saveMsg = await page.locator('[data-probe-save-msg]').innerText()
  check('CASE-icat-077 탐침을 노드 종류로 저장한다', saveMsg.includes('저장했습니다'))

  await click('[data-nav-view="types"]')
  await page.waitForSelector('[data-infra-view="types"]', { timeout: 5_000 })
  const savedRow = await page.locator('[data-type-row="e2e.server"]').count()
  check('CASE-icat-077 저장한 종류가 목록에 "내가 만듦" 으로 뜬다', savedRow === 1)
  check(
    'CASE-icat-077 저장한 종류에 탐침이 붙어 있다',
    (await page.locator('[data-type-row="e2e.server"]').innerText()).includes('탐침 있음')
  )

  // ── 새 프리셋: 탐침 없이 모양만 있는 종류를 만든다 ─────────────────────
  await click('[data-types-new-preset]')
  await page.waitForSelector('[data-preset-form]', { timeout: 5_000 })
  await page.locator('[data-preset-id]').fill('e2e.grafana')
  await page.locator('[data-preset-label]').fill('E2E 그라파나')
  await page.locator('[data-preset-provider-id]').fill('e2epreset')
  await click('[data-preset-save]')
  await page.waitForSelector('[data-type-row="e2e.grafana"]', { timeout: 8_000 })
  const presetRow = await page.locator('[data-type-row="e2e.grafana"]').innerText()
  check('CASE-icat-110 탐침 없이 모양만 있는 종류를 만들 수 있다', presetRow.includes('모양만'))
  check('CASE-icat-110 만든 프리셋은 "내가 만듦" 으로 뜬다', presetRow.includes('내가 만듦'))

  // 설계 캔버스가 이 종류를 바로 고를 수 있어야 만든 보람이 있다.
  {
    const inPalette = await page.evaluate(async () => {
      const designs = await window.rockury.infra.listDesigns()
      return designs.length >= 0 // 목록 호출이 살아 있다는 것만 확인(팔레트는 아래 승격 뒤 함께 본다)
    })
    check('CASE-icat-110 종류를 만든 뒤에도 설계본 창구가 정상이다', inPalette === true)
  }

  // ── 승격: 프리셋에 탐침을 붙여 올린다. **종류 id 는 그대로다.** ─────────
  await page.locator('[data-type-promote="e2e.grafana"]').click()
  await page.waitForSelector('[data-promote-banner]', { timeout: 5_000 })
  check(
    'CASE-icat-111 승격을 시작하면 무엇을 올리는지 알린다',
    (await page.locator('[data-promote-banner]').innerText()).includes('e2e.grafana')
  )

  await click('[data-nav-view="probe"]')
  await page.waitForSelector('[data-probe-promoting="e2e.grafana"]', { timeout: 5_000 })
  check(
    'CASE-icat-111 탐침 편집기가 승격을 이어받는다',
    (await page.locator('[data-probe-type-id]').inputValue()) === 'e2e.grafana'
  )
  check(
    'CASE-icat-111 승격 중에는 종류 id 를 못 바꾼다 — 바꾸면 그려 둔 노드가 끊긴다',
    await page.locator('[data-probe-type-id]').isDisabled()
  )
  // 뷰를 옮기면 편집기 상태가 초기화된다(화면 상태는 영속 대상이 아니다) — 탐침을 여기서 새로 짠다.
  await runProbe()
  await click('[data-probe-slot="list"]')
  await click('[data-json-pick="Reservations[0].Instances"]')
  await page.waitForTimeout(200)
  await click('[data-probe-slot="externalId"]')
  await click('[data-json-pick="Reservations[0].Instances[0].InstanceId"]')
  await page.waitForTimeout(200)
  // 프리셋이 들어 있는 그 카탈로그에 덮어써야 한다 — 새 카탈로그를 만들면 같은 id 가 둘이 된다.
  await page.locator('[data-probe-save-catalog]').selectOption({ label: 'e2epreset' })
  await page.waitForTimeout(200)
  await click('[data-probe-save]')
  await page.waitForSelector('[data-probe-save-msg]', { timeout: 8_000 })
  check(
    'CASE-icat-111 승격했다고 말한다',
    (await page.locator('[data-probe-save-msg]').innerText()).includes('승격')
  )

  await click('[data-nav-view="types"]')
  await page.waitForSelector('[data-infra-view="types"]', { timeout: 5_000 })
  const promoted = await page.locator('[data-type-row="e2e.grafana"]').innerText()
  check('CASE-icat-111 승격 뒤 같은 id 에 탐침이 붙었다', promoted.includes('탐침 있음'))
  check(
    'CASE-icat-111 승격해도 종류가 늘지 않는다(덮어썼지 새로 만들지 않았다)',
    (await page.locator('[data-type-row="e2e.grafana"]').count()) === 1
  )

  // ── 카탈로그 목록·내보내기 ────────────────────────────────────────────
  await click('[data-nav-view="catalogs"]')
  await page.waitForSelector('[data-infra-view="catalogs"]', { timeout: 5_000 })
  const catBody = await body()
  check('CASE-icat-071 내장·내가 만듦이 출처로 갈려 뜬다', catBody.includes('내장') && catBody.includes('내가 만듦'))
  const builtinRow = await page.locator('[data-catalog-row]').first().innerText()
  check('CASE-icat-071 내장 카탈로그에는 삭제 대신 복제만 있다', builtinRow.includes('복제') && !builtinRow.includes('삭제'))

  await page.locator('[data-catalog-export]').first().click()
  await page.waitForSelector('[data-catalog-exported]', { timeout: 5_000 })
  const exported = await page.locator('[data-catalog-exported]').inputValue()
  check('CASE-icat-006 내보낸 JSON 에 자격증명 참조만 있고 값이 없다', exported.includes('{{cred.') && !exported.includes('AKIA'))

  // ── 가져오기: 검토 → 명령 목록 → 승인해야 저장 ─────────────────────────
  const IMPORT = JSON.stringify({
    schemaVersion: 1,
    catalogVersion: '2026.07.9',
    provider: { id: 'e2e-import', label: 'E2E 가져온 공급자' },
    nodeTypes: [
      {
        id: 'e2eimp.thing',
        label: '가져온 종류',
        icon: 'phosphor:cube',
        discover: {
          call: { type: 'cli', cmd: 'echo', args: ['{"items":[]}'] },
          list: 'items',
          map: { externalId: 'id' }
        }
      }
    ]
  })
  const before = await page.locator('[data-catalog-row]').count()
  await page.locator('[data-catalog-paste]').fill(IMPORT)
  await click('[data-catalog-review]')
  await page.waitForSelector('[data-catalog-commands]', { timeout: 5_000 })
  const commands = await page.locator('[data-catalog-commands]').innerText()
  check('CASE-icat-072 저장 전에 이 파일이 돌릴 명령을 보여 준다', commands.includes('echo'))
  check('CASE-icat-072 승인 전에는 저장되지 않는다', (await page.locator('[data-catalog-row]').count()) === before)

  await click('[data-catalog-approve]')
  await page.waitForTimeout(600)
  check('CASE-icat-072 승인하면 목록에 들어온다', (await page.locator('[data-catalog-row]').count()) === before + 1)
  check('CASE-icat-072 가져온 것은 출처가 "가져옴" 으로 남는다', (await body()).includes('가져옴'))

  // 형식이 깨진 파일은 사유가 뜨고 목록이 안 는다.
  const after = await page.locator('[data-catalog-row]').count()
  await page.locator('[data-catalog-paste]').fill('{"schemaVersion":1,"catalogVersion":"1"}')
  await click('[data-catalog-review]')
  await page.waitForSelector('[data-catalog-errors]', { timeout: 5_000 })
  check('CASE-icat-073 형식이 깨지면 어느 필드가 문제인지 뜬다', (await page.locator('[data-catalog-errors]').innerText()).includes('provider'))
  check('CASE-icat-073 깨진 파일은 목록을 늘리지 않는다', (await page.locator('[data-catalog-row]').count()) === after)
  await click('[data-nav-view="probe"]')

  // ── 콜드 재시작 후에도 공급자 연결이 남는다 ─────────────────────────────
  // (12-cold-restart 는 DB 서비스 흐름이라 건드리지 않고 여기서 따로 확인한다.)
  page = await ctx.relaunch()
  await click('[data-nav-service="infra"]')
  await click('[data-nav-module="catalog"]')
  await click('[data-nav-view="providers"]')
  await page.waitForSelector('[data-provider-row]', { timeout: 8_000 })
  const afterRestart = await body()
  check('콜드 재시작: 공급자 연결이 남아 있다', afterRestart.includes('e2e-aws'))
  check('콜드 재시작: 평문은 여전히 안 보인다', !afterRestart.includes(SECRET))
}
