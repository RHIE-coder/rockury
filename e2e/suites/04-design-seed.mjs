// 스모크 스위트 — Design › Seed 시드 세트 저작(선언·행·변수) + Versions 시드 버전/Diff
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '04-design-seed',
  needsDb: false,
  desc: 'Design › Seed 시드 세트 저작(선언·행·변수) + Versions 시드 버전/Diff'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page
  // ── Design › Seed — 시드 세트 저작(선언 → 행 → 변수). CASE-design-040~044 (docs/qa/db-design.md) ──
  {
    await click('button:has-text("Seed")')
    await page.waitForSelector('text=아직 시드 세트가 없어요', { timeout: 8_000 })
    check('Design › Seed: 세트 없을 때 빈 상태 CTA', (await body()).includes('테이블에서 시드 세트 만들기'))

    // 테이블 고르기 — orders 의 PK 는 AUTO_INCREMENT 라 짝짓기 기준 기본값이 비어야 한다(사람이 고름).
    await click('button:has-text("테이블에서 시드 세트 만들기")')
    await page.waitForSelector('[data-seed-candidate]', { timeout: 8_000 })
    // 뷰는 데이터를 담지 않으므로 세트 후보에서 빠진다 — 앞서 Definition 에서 만든 뷰로 실제 검증.
    check('Design › Seed: 등록 후보에 뷰가 없다', (await page.locator('[data-seed-candidate^="new_view"]').count()) === 0)
    check('Design › Seed: 등록 후보에 테이블은 있다', (await page.locator('[data-seed-candidate]').count()) > 0)
    await click('[data-seed-candidate="orders"]')
    await page.waitForSelector('[data-seed-set-row="orders"]', { timeout: 8_000 })
    check('Design › Seed: 세트 등록(orders)', (await page.locator('[data-seed-set-row="orders"]').count()) === 1)
    check('Design › Seed: 자동증가 PK → 짝짓기 기준 경고', (await page.locator('[data-seed-needs-key]').count()) === 1)

    // 컬럼 역할 토글 1개로 짝짓기 기준 지정 → 경고 해제. 기본은 '포함'이라 한 번 누르면 '무시', 두 번이면 '짝짓기'.
    check(
      'Design › Seed: 컬럼 역할 토글은 컬럼당 1개',
      (await page.locator('[data-seed-role-toggle="order_number"]').count()) === 1
    )
    check(
      'Design › Seed: 컬럼 기본 역할은 포함',
      (await page.locator('[data-seed-role-toggle="order_number"][data-seed-col-role="include"]').count()) === 1
    )
    await click('[data-seed-role-toggle="order_number"]')
    await page.waitForTimeout(200)
    check(
      'Design › Seed: 역할 순환 포함 → 무시',
      (await page.locator('[data-seed-role-toggle="order_number"][data-seed-col-role="ignore"]').count()) === 1
    )
    await click('[data-seed-role-toggle="order_number"]')
    await page.waitForTimeout(300)
    check(
      'Design › Seed: 역할 순환 무시 → 짝짓기',
      (await page.locator('[data-seed-role-toggle="order_number"][data-seed-col-role="key"]').count()) === 1
    )
    check('Design › Seed: 짝짓기 기준 지정 → 경고 해제', (await page.locator('[data-seed-needs-key]').count()) === 0)

    // DB 가 값을 만드는 컬럼(orders.id = AUTO_INCREMENT)은 짝짓기 기준으로 갈 수 없다 — 역할 순환이 건너뛴다.
    {
      for (let i = 0; i < 3; i++) {
        await click('[data-seed-role-toggle="id"]')
        await page.waitForTimeout(150)
      }
      check(
        'Design › Seed: DB 생성 컬럼은 짝짓기 기준으로 갈 수 없다(역할 순환 건너뜀)',
        (await page.locator('[data-seed-role-toggle="id"][data-seed-col-role="key"]').count()) === 0
      )
      // 원복 — 이후 저장 검증이 무시 컬럼 목록을 전제로 한다(id 를 무시로 남기면 순서가 달라진다).
      while ((await page.locator('[data-seed-role-toggle="id"][data-seed-col-role="include"]').count()) === 0) {
        await click('[data-seed-role-toggle="id"]')
        await page.waitForTimeout(150)
      }
    }

    // 짝짓기 기준을 UNIQUE 가 뒷받침하는지 안내 — order_number 엔 UK 가 있어 조용하고,
    // UNIQUE 없는 구성(order_number+status)으로 바꾸면 반영 단계 함의를 알린다.
    check(
      'Design › Seed: UNIQUE 가 뒷받침하는 짝짓기 기준엔 안내 없음',
      (await page.locator('[data-seed-key-unbacked]').count()) === 0
    )
    const cycleTo = async (column, role) => {
      for (let i = 0; i < 3; i++) {
        if ((await page.locator(`[data-seed-role-toggle="${column}"][data-seed-col-role="${role}"]`).count()) === 1) return
        await click(`[data-seed-role-toggle="${column}"]`)
        await page.waitForTimeout(200)
      }
    }
    await cycleTo('status', 'key')
    check(
      'Design › Seed: UNIQUE 없는 짝짓기 기준 구성 → UPSERT 불가 안내',
      (await page.locator('[data-seed-key-unbacked]').count()) === 1
    )
    await cycleTo('status', 'include') // 원복

    // 무시 컬럼 지정(비교 소음 제거)
    await cycleTo('ordered_at', 'ignore')
    check(
      'Design › Seed: 무시 컬럼 지정 표시',
      (await page.locator('[data-seed-role-toggle="ordered_at"][data-seed-col-role="ignore"]').count()) === 1
    )

    // 무시 컬럼 감추기 토글 — 표에서만 빠진다(선언은 그대로). 끝에 반드시 원복해야
    // 이후 흐름(컬럼 이름으로 셀 찍기)이 감춰진 컬럼을 못 찾는 일이 없다.
    {
      const colsShown = await page.locator('[data-seed-col]').count()
      check('Design › Seed: 무시 컬럼이 있으면 감추기 버튼이 나온다',
        (await page.locator('[data-seed-hide-ignored="false"]').count()) === 1)
      await click('[data-seed-hide-ignored]')
      await page.waitForTimeout(200)
      check(
        'Design › Seed: 감추기 → 무시 컬럼이 표에서 빠진다',
        (await page.locator('[data-seed-col="ordered_at"]').count()) === 0 &&
          (await page.locator('[data-seed-col]').count()) === colsShown - 1
      )
      // 선언 바는 이름을 늘어놓지 않고 **개수만** 보인다(UI 소음) — 이름은 설명(title)에 남는다.
      // 확인할 것은 "표에서 감춰도 선언은 안 바뀐다"이므로 개수와 설명으로 가른다.
      const ignoredChip = page.locator('[data-seed-ignored-count]')
      check(
        'Design › Seed: 감춰도 선언은 그대로(무시 개수 유지 · 이름은 설명에 남는다)',
        (await ignoredChip.getAttribute('data-seed-ignored-count')) === '1' &&
          ((await ignoredChip.getAttribute('title')) ?? '').includes('ordered_at')
      )
      await click('[data-seed-hide-ignored]')
      await page.waitForTimeout(200)
      check(
        'Design › Seed: 다시 보이기 → 컬럼 수 원복',
        (await page.locator('[data-seed-col]').count()) === colsShown &&
          (await page.locator('[data-seed-hide-ignored="false"]').count()) === 1
      )
    }

    // 행 추가 + 셀 입력
    const fill = async (rowIdx, column, value) => {
      const cell = page.locator('[data-seed-row]').nth(rowIdx).locator(`[data-seed-cell="${column}"]`)
      await cell.click()
      await page.waitForTimeout(150)
      // 기존 값이 있으면 지우고 쓴다 — 안 지우면 입력이 덧붙어 값이 뒤섞인다.
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type(value)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)
    }
    await click('button:has-text("행 추가")')
    await page.waitForSelector('[data-seed-row]', { timeout: 5_000 })
    await fill(0, 'order_number', 'SEED-0001')
    check('Design › Seed: 셀 입력 반영', (await body()).includes('SEED-0001'))

    // 중복 짝짓기 기준 값 → 두 행 모두 오류 표시
    await click('button:has-text("행 추가")')
    await page.waitForTimeout(200)
    await fill(1, 'order_number', 'SEED-0001')
    check('Design › Seed: 중복 짝짓기 기준 → 두 행 오류 표시',
      (await page.locator('[data-seed-row-issue="duplicate-key"]').count()) === 2)

    // 값을 바꿔 중복 해소 → 오류 사라짐
    await fill(1, 'order_number', 'SEED-0002')
    check('Design › Seed: 중복 해소 → 오류 없음', (await page.locator('[data-seed-row-issue]').count()) === 0)

    // 컬럼 머리에 제약이 보인다 — Definition 화면과 왕복하지 않게(grid AC-7)
    check('Design › Seed: 컬럼 머리 PK 배지', (await page.locator('[data-seed-col-badge="PK"]').count()) === 1)
    check('Design › Seed: 필수 컬럼 배지', (await page.locator('[data-seed-col-required]').count()) >= 1)

    // 필수인데 빈 셀 → 행 표시, 채우면 해제(grid AC-8). orders 는 user_id 가 NOT NULL·기본값 없음.
    const missingBefore = await page.locator('[data-seed-row-missing]').count()
    check('Design › Seed: 필수 값 빈 행 표시', missingBefore === 2)
    await fill(0, 'user_id', '1001')
    check(
      'Design › Seed: 필수 값 채우면 표시 해제',
      (await page.locator('[data-seed-row-missing]').count()) === missingBefore - 1
    )

    // ── 별칭 + 시드 행끼리의 참조 (CASE-design-042c) ──
    {
      // 별칭 칸은 **이름 훅**으로 찍는다 — 위치(`td` nth)로 찍으면 앞에 칸이 하나 늘어날 때
      // 엉뚱한 칸(행 삭제)을 눌러 행이 지워진다(실제로 그렇게 깨졌다).
      const setAlias = async (rowIdx, v) => {
        await page.locator('[data-seed-alias-cell]').nth(rowIdx).click()
        await page.waitForTimeout(150)
        await page.keyboard.type(v)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(200)
      }
      await setAlias(0, 'first-order')
      check('Design › Seed: 별칭 저장', (await page.locator('[data-seed-row-alias="first-order"]').count()) === 1)

      // 겹치는 별칭 → 양쪽 다 오류
      await setAlias(1, 'first-order')
      check(
        'Design › Seed: 겹치는 별칭 → 두 행 오류',
        (await page.locator('[data-seed-row-alias-issue="duplicate-alias"]').count()) === 2
      )
      await setAlias(1, 'second-order')
      check('Design › Seed: 별칭 중복 해소', (await page.locator('[data-seed-row-alias-issue]').count()) === 0)

      // user_id 는 users 를 가리키는 FK — orders 를 가리키면 관계 불일치로 잡힌다
      await fill(1, 'user_id', '@orders#first-order')
      check('Design › Seed: 참조 셀 표식', (await page.locator('[data-seed-ref-cell]').count()) === 1)
      check(
        'Design › Seed: FK 가 가리키는 테이블과 다른 참조 → 오류',
        (await page.locator('[data-seed-row-ref-issue="true"]').count()) === 1
      )

      // 깨진 참조(없는 별칭)도 오류 — users 세트가 없으니 unknown-table 로 잡힌다
      await fill(1, 'user_id', '@users#ghost')
      check(
        'Design › Seed: 세트 없는 테이블 참조 → 오류 유지',
        (await page.locator('[data-seed-row-ref-issue="true"]').count()) === 1
      )
      // 원복 — 이후 흐름(저장 검증)은 평범한 값을 전제
      await fill(1, 'user_id', '2002')
      check('Design › Seed: 참조 지우면 오류 해제', (await page.locator('[data-seed-row-ref-issue]').count()) === 0)
    }

    // 행 삭제 버튼 — 호버 없이 항상 보여야 한다(Remote › Data 와 같은 문법).
    // (회귀: opacity-0 + group-hover 라 표 오른쪽 끝의 빈 컬럼으로만 보였고 발견할 방법이 없었다.)
    check(
      'Design › Seed: 행 삭제 버튼이 호버 없이 보인다',
      await page.locator('[data-seed-row-delete]').first().isVisible()
    )
    // 머리와 본문의 칸 수가 같아야 한다 — 칸을 하나 끼워 넣을 때 한쪽만 고치면 표 전체가
    // 한 칸씩 밀린다(실제로 그렇게 깨졌고 "보인다" 검사만으로는 안 잡혔다).
    check(
      'Design › Seed: 표 머리와 본문 칸 수 일치(열 밀림 방지)',
      (await page.locator('thead tr th').count()) ===
        (await page.locator('[data-seed-row]').first().locator('td').count())
    )

    // 변수 자리표시자 — 환경마다 다른 값은 값 대신 변수로
    await fill(0, 'memo', '{{ADMIN_PASSWORD_HASH}}')
    check('Design › Seed: 변수 셀 표식', (await page.locator('[data-seed-variable-cell]').count()) === 1)
    check('Design › Seed: 세트가 요구하는 변수 목록',
      (await page.locator('[data-seed-variable="ADMIN_PASSWORD_HASH"]').count()) === 1)

    // PK 생성 규칙 — 자유 입력이 아니라 **고르기**다. 목록은 PK 컬럼 타입으로 걸러진다.
    // orders.id 는 BIGINT 자동증가라 문자열 규칙이 목록에 아예 없어야 한다(사고를 목록에서 없앤다).
    check('Design › Seed: PK 가 DB 담당이면 규칙 줄이 없다', (await page.locator('[data-seed-pk-rule]').count()) === 0)
    await click('[data-seed-pk-strategy="seed"]')
    await page.waitForSelector('[data-seed-pk-rule]', { timeout: 5_000 })
    check(
      'Design › Seed: 규칙이 비면 미리보기가 셀 값 없음을 알린다',
      (await page.locator('[data-seed-pk-preview-from="none"]').count()) === 1
    )
    await click('[data-seed-pk-rule]')
    await page.waitForSelector('[data-seed-pk-rule-option]', { timeout: 5_000 })
    // 숫자 PK → `셀에 직접 쓴 값` + `직접 입력…` 둘뿐. {uuid}·{key} 는 고를 수 없다.
    check(
      'Design › Seed: 숫자 PK 는 문자열 규칙을 목록에 안 내놓는다',
      (await page.locator('[data-seed-pk-rule-option]').count()) === 2 &&
        (await page.locator('[data-seed-pk-rule-option="{uuid}"]').count()) === 0
    )
    // `직접 입력…` 으로 가면 자유 입력칸 + 조각 칩이 열린다(접두사가 필요한 드문 경우).
    await click('[data-seed-pk-rule-option="__custom__"]')
    await page.waitForSelector('[data-seed-pk-template]', { timeout: 5_000 })
    check('Design › Seed: 직접 입력 → 조각 칩 4개 노출', (await page.locator('[data-seed-pk-token]').count()) === 4)
    await click('[data-seed-pk-token="{table}"]')
    await page.waitForTimeout(200)
    await click('[data-seed-pk-token="{alias}"]')
    await page.waitForTimeout(250)
    check(
      'Design › Seed: 칩이 규칙 끝에 붙는다',
      (await page.locator('[data-seed-pk-template]').inputValue()) === '{table}{alias}'
    )
    check(
      'Design › Seed: 미리보기가 규칙 결과를 보인다',
      (await page.locator('[data-seed-pk-preview-from="template"]').count()) === 1
    )
    // 직접 입력 경로에만 남는 사고들 — 오타 · 타입 불일치 · 상수 규칙(전 행 같은 PK).
    await page.locator('[data-seed-pk-template]').fill('{uuidd}')
    await page.waitForTimeout(250)
    check('Design › Seed: 모르는 자리표시자 경고', (await page.locator('[data-seed-pk-unknown]').count()) === 1)
    await page.locator('[data-seed-pk-template]').fill('{uuid}')
    await page.waitForTimeout(250)
    check('Design › Seed: 숫자 PK 에 UUID → 타입 경고', (await page.locator('[data-seed-pk-type-issue]').count()) === 1)
    await page.locator('[data-seed-pk-template]').fill('fixed-1')
    await page.waitForTimeout(250)
    check('Design › Seed: 상수 규칙 → 전 행 같은 PK 경고', (await page.locator('[data-seed-pk-constant]').count()) === 1)
    await page.locator('[data-seed-pk-template]').fill('u-{alias}')
    await page.waitForTimeout(250)
    check(
      'Design › Seed: 행마다 달라지는 규칙이면 경고 해제',
      (await page.locator('[data-seed-pk-constant]').count()) === 0
    )
    // 원복 — 이후 버전 컷·Diff 검증이 보는 세트 상태를 바꾸지 않는다.
    await page.locator('[data-seed-pk-template]').fill('')
    await page.waitForTimeout(200)
    await click('[data-seed-pk-strategy="db"]')
    await page.waitForTimeout(200)
    check('Design › Seed: DB 담당으로 되돌리면 규칙 줄이 사라진다', (await page.locator('[data-seed-pk-rule]').count()) === 0)

    // '설계에 없는 행 = 삭제 후보' 선택 → 경고 문구
    await click('[data-seed-strength="authoritative"]')
    await page.waitForTimeout(200)
    check('Design › Seed: 삭제 후보 선택 시 경고 문구', (await body()).includes('삭제 후보'))

    // 저장(설계 스코프) — 디바운스 후 저장소에 남는다
    await page.waitForTimeout(600)
    const saved = await page.evaluate(async () => {
      const list = await window.rockury.seedSets.list()
      const s = list.find((x) => x.designId === 'commerce-core' && x.tableName === 'orders')
      return s ? { key: s.naturalKey, ignored: s.ignoredColumns, strength: s.strength, rows: s.rows.length } : null
    })
    check('Design › Seed: 선언·행이 설계 스코프로 저장',
      saved?.key?.[0] === 'order_number' && saved?.ignored?.[0] === 'ordered_at' &&
      saved?.strength === 'authoritative' && saved?.rows === 2)
  }

  // Definition 으로 복귀(이후 흐름 원복)
  await click('button:has-text("Definition")')
  await page.waitForTimeout(200)

  // Design › Versions — 시드 버전 (2026-08-03 부터 Design 안 뷰다)
  await click('button:has-text("Versions")')
  await page.waitForSelector('text=버전 타임라인', { timeout: 5_000 })
  await page.waitForTimeout(300)
  const tl = await body()
  check('Timeline: 시드 버전 v0.3.14 표시', tl.includes('v0.3.14'))

  // 버전 컷 (Patch → v0.3.15)
  await click('button:has-text("버전 컷")')
  await page.waitForSelector('text=증가 유형', { timeout: 5_000 })
  await click('button[aria-pressed]:has-text("Patch")')
  await click('button[type="submit"]')
  await page.waitForTimeout(500)
  check('버전 컷 후 v0.3.15 등장', (await body()).includes('v0.3.15'))
  check('버전 컷: 시드 행 수 표시(스냅샷에 시드 동봉)', (await page.locator('[data-version-seed-rows]').count()) >= 1)

  // ⭐ 버전 비교에 시드 섹션 — 시드 없던 옛 버전(v0.3.14)↔시드 담긴 새 버전(v0.3.15).
  //    CASE-design-045: 옛 스냅샷 폴백이 깨지지 않고 시드 델타가 보인다.
  //    2026-08-03 — 따로 뜨던 Version Diff 화면이 사라지고, 타임라인에서 두 줄을 고르면 아래에 열린다.
  await click('[data-version-pick="v0.3.14"]')
  await click('[data-version-pick="v0.3.15"]')
  await page.waitForSelector('[data-version-diff]', { timeout: 8_000 })
  await page.waitForTimeout(400)
  check('버전 비교: 시드 섹션 렌더', (await page.locator('[data-seed-diff]').count()) === 1)
  check('버전 비교: 시드 세트(orders) 델타 표시', (await page.locator('[data-seed-diff-set="orders"]').count()) === 1)
  // 고름을 풀어 놓는다 — 뒤 검사가 타임라인만 보고 판단한다.
  await click('[data-version-pick="v0.3.14"]')
  await click('[data-version-pick="v0.3.15"]')
  await page.waitForTimeout(300)
  check('버전 비교: 고름을 풀면 비교가 닫힌다', (await page.locator('[data-version-diff]').count()) === 0)

  // ⭐ 시드는 버전에 귀속된다 — 렌즈로 읽을 때도, 되돌릴 때도. (2026-08-18 사용자 제보)
  //    핵심은 "시드 0개"와 "시드 기록 없음"을 가르는 것: 기록이 없는 옛 버전(v0.3.14)을 보면서
  //    Draft 시드가 "이 버전의 시드"인 척 보이면 안 되고, 그 버전으로 되돌린다고 지워져도 안 된다.
  {
    await click('button:has-text("Seed")')
    await page.waitForTimeout(300)

    // 시드를 담기 전 컷된 버전 → 기록 없음(Draft 로 새지 않는다)
    await click('[data-version-lens]')
    await click('[data-version-lens-option="v0.3.14"]')
    await page.waitForTimeout(400)
    check('Seed(옛 버전): 시드 기록 없음 상태', (await page.locator('[data-seed-unrecorded]').count()) === 1)
    check(
      'Seed(옛 버전): Draft 시드가 이 버전 것처럼 보이지 않는다',
      (await page.locator('[data-seed-set-row="orders"]').count()) === 0
    )

    // 시드를 담아 컷한 버전 → 그 버전의 시드가 보인다
    await click('[data-version-lens]')
    await click('[data-version-lens-option="v0.3.15"]')
    await page.waitForTimeout(400)
    check('Seed(시드 담긴 버전): 기록 없음 상태가 아니다', (await page.locator('[data-seed-unrecorded]').count()) === 0)
    check('Seed(시드 담긴 버전): 그 버전의 세트가 보인다', (await page.locator('[data-seed-set-row="orders"]').count()) === 1)

    await click('[data-version-lens]')
    await click('[data-version-lens-option="draft"]')
    await page.waitForTimeout(400)

    // 되돌리기 창 — 기록 없는 버전이면 "시드는 그대로 둔다"고 밝힌다(조용히 지우지 않는다).
    await click('button:has-text("Versions")')
    await page.waitForSelector('text=버전 타임라인', { timeout: 5_000 })
    await click('[data-restore-version="v0.3.14"]')
    await page.waitForSelector('[data-restore-confirm]', { timeout: 8_000 })
    await page.waitForTimeout(300)
    check(
      '되돌리기(옛 버전): 시드 기록 없음을 밝힌다',
      (await page.locator('[data-restore-seed-unrecorded]').count()) === 1
    )
    // 되돌리진 않는다 — 뒤 스위트가 지금 Draft 를 그대로 본다(상태 의존 순서).
    await click('button:has-text("취소")')
    await page.waitForTimeout(300)
  }

  // ⭐ CASE-design-065 — 커밋 버전을 **열람**하는 동안에는 배치·그룹을 저장하지 않는다.
  //    지나간 버전의 화면을 만졌다고 정본이 바뀌면 안 된다(정본 db-design.diagram.scope AC-2).
  {
    const savedLayout = () =>
      page.evaluate(async () => {
        const l = await window.rockury.diagram.getLayout('design:commerce-core')
        return JSON.stringify({ p: l?.positions ?? {}, g: l?.groups ?? [] })
      })
    // 시점 손잡이는 뷰 탭 줄 오른쪽 끝 '설계' 손잡이 안에 있다
    // (자리 이력: 컨텍스트 바 → Design 도구줄 → 모듈 줄 설계 뱃지 → 뷰 탭 줄 · 2026-08-02).
    // 설계부 어느 화면에서나 같은 자리라, 화면을 옮겨도 하나만 떠 있어야 한다.
    await click('button:has-text("Design")')
    await click('button:has-text("Diagram")')
    await page.waitForSelector('.react-flow__node[data-id]', { timeout: 10_000 })
    check('Design › Diagram: 설계 손잡이에 시점 칸이 하나 있다', (await page.locator('[data-version-lens]').count()) === 1)
    await click('[data-version-lens]')
    await click('[data-version-lens-option="v0.3.15"]')
    await page.waitForTimeout(400)
    await page.waitForSelector('.react-flow__node[data-id]', { timeout: 10_000 })
    await page.waitForTimeout(500)
    check('Design › Diagram(커밋 버전): 읽기 전용 배지', (await body()).includes('읽기 전용'))

    const before = await savedLayout()
    const nd = page.locator('.react-flow__node:not([data-id^="grp:"])').first()
    const box = await nd.boundingBox()
    const tfPre = await nd.evaluate((el) => el.style.transform)
    await page.mouse.move(box.x + box.width / 2, box.y + 8)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + 88, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(700)
    check(
      'Design › Diagram(커밋 버전): 노드가 안 움직인다(배치 잠금)',
      (await nd.evaluate((el) => el.style.transform)) === tfPre
    )
    check('Design › Diagram(커밋 버전): 저장본이 그대로', (await savedLayout()) === before)
    // 그룹 패널을 펼친 상태에서 센다 — 안 펼치면 읽기 전용이 아니어도 0 이라 검증이 안 된다.
    await page.locator('[data-side-tab="groups"]').first().click()
    await page.waitForTimeout(300)
    check(
      'Design › Diagram(커밋 버전): 그룹 만들기 버튼 없음',
      (await page.locator('[data-diagram-group-panel]').count()) > 0 &&
        (await page.locator('[data-group-create]').count()) === 0
    )

    // 렌즈를 Draft 로, 화면을 Design › Versions 로 되돌린다 —
    // 다음 스위트(05-mcp-write)는 타임라인이 열린 채로 시작한다고 본다(상태 의존 순서).
    await click('[data-version-lens]')
    await click('[data-version-lens-option="draft"]')
    await page.waitForTimeout(400)
    // 그룹 패널을 실제로 펼쳐서 본다 — `data-group-create` 는 그 패널 안에만 있어서,
    // 안 펼치고 세면 읽기 전용이든 아니든 0 이라 아무것도 검증하지 못한다.
    await page.locator('[data-side-tab="groups"]').first().click()
    await page.waitForTimeout(300)
    check('Design › Diagram: Draft 로 돌아오면 편집이 풀린다(그룹 만들기 복귀)',
      (await page.locator('[data-group-create]').count()) > 0)
    check('Design › Diagram: Draft 로 돌아오면 읽기 전용 배지가 사라진다',
      !(await body()).includes('읽기 전용(커밋 버전)'))
    await click('button:has-text("Versions")')
    await page.waitForTimeout(400)
  }
}
