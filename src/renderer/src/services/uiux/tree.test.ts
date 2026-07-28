import { describe, expect, it } from 'vitest'
import {
  addComponent,
  addSection,
  allIds,
  findComponent,
  moveComponent,
  moveSection,
  newId,
  patchComponent,
  patchSection,
  removeNode
} from './tree'
import type { SurfaceContent } from './types'

/** 정의: `docs/qa/uiux-ia.md` S5 (CASE-uiux-040~047) · 명세: `docs/spec/uiux-ia.md` §6. */

/** 두 섹션 · 컴포넌트 3개짜리 표본. */
const sample = (): SurfaceContent => ({
  sections: [
    {
      id: 'form',
      name: '입력',
      components: [
        { id: 'email', type: 'input' },
        { id: 'password', type: 'input' }
      ]
    },
    { id: 'actions', name: '버튼', components: [{ id: 'submit', type: 'button' }] }
  ]
})

describe('id 만들기', () => {
  it('CASE-uiux-040 안 쓰인 이름은 그대로, 겹치면 번호를 붙인다', () => {
    expect(newId('input', [])).toBe('input')
    expect(newId('input', ['input'])).toBe('input-2')
    expect(newId('input', ['input', 'input-2'])).toBe('input-3')
    // 중간이 비면 그 자리를 쓴다 — 번호가 무한히 커지지 않는다.
    expect(newId('input', ['input', 'input-3'])).toBe('input-2')
  })

  it('CASE-uiux-040 섹션과 컴포넌트가 한 이름 공간을 쓴다', () => {
    expect(allIds(sample())).toEqual(['form', 'email', 'password', 'actions', 'submit'])
    // 섹션 이름과 겹치는 컴포넌트 id 는 만들어지지 않는다.
    const { id } = addComponent(sample(), 'form', 'form')
    expect(id).toBe('form-2')
  })
})

describe('더하기', () => {
  it('CASE-uiux-041 섹션은 기본으로 맨 뒤에, at 을 주면 그 자리에', () => {
    const back = addSection(sample())
    expect(back.content.sections.map((s) => s.id)).toEqual(['form', 'actions', 'section'])
    const front = addSection(sample(), { at: 0, name: '머리말' })
    expect(front.content.sections[0].name).toBe('머리말')
  })

  it('CASE-uiux-041 컴포넌트 id 는 종류에서 딴다 (사람이 읽는 손잡이)', () => {
    const { content, id } = addComponent(sample(), 'form', 'checkbox', { label: '자동 로그인' })
    expect(id).toBe('checkbox')
    expect(findComponent(content, 'checkbox')?.component.label).toBe('자동 로그인')
    expect(findComponent(content, 'checkbox')?.section.id).toBe('form')
  })

  it('CASE-uiux-041 없는 섹션에 넣으면 아무 일도 없다 (사라진 섹션을 가리킬 수 있다)', () => {
    const before = sample()
    const { content, id } = addComponent(before, '없음', 'input')
    expect(id).toBeNull()
    expect(content).toEqual(before)
  })

  it('CASE-uiux-042 입력을 고치지 않는다 (되돌리기·변경 감지의 전제)', () => {
    const before = sample()
    const snapshot = JSON.stringify(before)
    addSection(before)
    addComponent(before, 'form', 'input')
    removeNode(before, 'email')
    moveComponent(before, 'email', 'actions')
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('지우기', () => {
  it('CASE-uiux-043 컴포넌트 하나만 지운다', () => {
    const c = removeNode(sample(), 'email')
    expect(c.sections[0].components.map((x) => x.id)).toEqual(['password'])
    expect(c.sections).toHaveLength(2)
  })

  it('CASE-uiux-043 섹션을 지우면 그 안 컴포넌트도 함께 사라진다', () => {
    const c = removeNode(sample(), 'form')
    expect(c.sections.map((s) => s.id)).toEqual(['actions'])
    expect(allIds(c)).toEqual(['actions', 'submit'])
  })

  it('CASE-uiux-043 없는 id 는 아무 일도 없다', () => {
    expect(removeNode(sample(), '없음')).toEqual(sample())
  })
})

describe('옮기기', () => {
  it('CASE-uiux-044 다른 섹션으로 옮긴다', () => {
    const c = moveComponent(sample(), 'email', 'actions', 0)
    expect(c.sections[0].components.map((x) => x.id)).toEqual(['password'])
    expect(c.sections[1].components.map((x) => x.id)).toEqual(['email', 'submit'])
  })

  it('CASE-uiux-045 같은 섹션 안 순서 바꾸기 — 자리 기준은 "뽑아낸 뒤"다', () => {
    // email 을 뽑으면 [password] 가 되고, 그 1번 자리에 넣으면 [password, email].
    const down = moveComponent(sample(), 'email', 'form', 1)
    expect(down.sections[0].components.map((x) => x.id)).toEqual(['password', 'email'])
    const up = moveComponent(down, 'email', 'form', 0)
    expect(up.sections[0].components.map((x) => x.id)).toEqual(['email', 'password'])
  })

  it('CASE-uiux-045 자리를 넘겨 주면 끝으로 붙인다 (드래그가 범위를 넘겨도 안 깨진다)', () => {
    const c = moveComponent(sample(), 'email', 'form', 99)
    expect(c.sections[0].components.map((x) => x.id)).toEqual(['password', 'email'])
    const neg = moveComponent(sample(), 'password', 'form', -5)
    expect(neg.sections[0].components.map((x) => x.id)).toEqual(['password', 'email'])
  })

  it('CASE-uiux-045 자리를 안 주면 맨 뒤로', () => {
    const c = moveComponent(sample(), 'email', 'actions')
    expect(c.sections[1].components.map((x) => x.id)).toEqual(['submit', 'email'])
  })

  it('CASE-uiux-044 없는 컴포넌트·없는 섹션이면 아무 일도 없다', () => {
    expect(moveComponent(sample(), '없음', 'form', 0)).toEqual(sample())
    expect(moveComponent(sample(), 'email', '없음', 0)).toEqual(sample())
  })

  it('CASE-uiux-046 섹션 순서도 같은 기준으로 바꾼다', () => {
    const c = moveSection(sample(), 'actions', 0)
    expect(c.sections.map((s) => s.id)).toEqual(['actions', 'form'])
    expect(moveSection(sample(), '없음', 0)).toEqual(sample())
    expect(moveSection(sample(), 'form', 99).sections.map((s) => s.id)).toEqual(['actions', 'form'])
  })
})

describe('고치기', () => {
  it('CASE-uiux-047 속성만 바꾸고 id 는 그대로 둔다 (이벤트가 가리키고 있다)', () => {
    const s = patchSection(sample(), 'form', { name: '로그인 정보', showLabel: true })
    expect(s.sections[0].name).toBe('로그인 정보')
    expect(s.sections[0].id).toBe('form')
    expect(s.sections[0].components).toHaveLength(2)

    const c = patchComponent(sample(), 'email', { label: '이메일', props: { required: true } })
    const found = findComponent(c, 'email')
    expect(found?.component).toEqual({ id: 'email', type: 'input', label: '이메일', props: { required: true } })
  })

  it('CASE-uiux-047 없는 id 는 아무 일도 없다', () => {
    expect(patchSection(sample(), '없음', { name: 'x' })).toEqual(sample())
    expect(patchComponent(sample(), '없음', { label: 'x' })).toEqual(sample())
  })
})
