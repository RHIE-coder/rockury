import { FolderKanban, Plus, RotateCcw } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { cx } from '@renderer/lib/cx'
import { Button } from '@renderer/ui/button'
import { COMPONENT_KINDS, ROLE_LABEL, type ComponentRole } from '../catalog'
import { isolateTemplate } from '../preview/render'
import { renderTemplate } from '../preview/template'
import { templateFor } from '../preview/components'
import {
  DEFAULT_TOKENS,
  mergeTokens,
  tokenCss,
  tokenGroup,
  type TokenMap
} from '../preview/tokens'
import { useActiveProject, useSpecStore } from '../store'

/**
 * Style — 이 프로젝트의 색·간격·글자. 명세 정본 `docs/spec/uiux-ia.md` Surface `uiux.style`.
 *
 * **덮어쓴 값만 저장한다.** 기본 한 벌을 통째로 복사해 두면 나중에 기본이 좋아져도 이 프로젝트만
 * 옛 값에 묶인다. 그래서 저장은 차이만, 화면은 병합 결과를 보인다.
 *
 * 토큰을 바꾸면 **오른쪽 컴포넌트가 즉시 따라 바뀐다** — 값만 보고는 그게 무슨 뜻인지 알 수 없다.
 */
export function StyleWorkspace({ view }: { view: 'tokens' | 'components' }) {
  const project = useActiveProject()
  const openDialog = useSpecStore((s) => s.openDialog)

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
          <FolderKanban size={24} strokeWidth={1.8} />
        </div>
        <h2 className="text-lg font-semibold">프로젝트를 고르세요</h2>
        <p className="max-w-md text-[13px] leading-relaxed text-muted">
          디자인 토큰은 프로젝트마다 다릅니다. 위쪽 <span className="font-medium">Project</span> 에서
          고르거나 새로 만드세요.
        </p>
        <Button size="sm" onClick={() => openDialog({ level: 'project', parentId: null })}>
          <Plus size={14} /> 새 프로젝트
        </Button>
      </div>
    )
  }

  return view === 'tokens' ? <TokensView /> : <ComponentsView />
}

function TokensView() {
  const overrides = useSpecStore((s) => s.tokens)
  const setToken = useSpecStore((s) => s.setToken)
  const merged = mergeTokens(overrides)

  const groups = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const path of Object.keys(DEFAULT_TOKENS)) {
      const g = tokenGroup(path)
      out.set(g, [...(out.get(g) ?? []), path])
    }
    // 기본에 없는데 프로젝트가 더한 토큰도 보여 준다(열린 어휘라 있을 수 있다).
    for (const path of Object.keys(overrides)) {
      if (DEFAULT_TOKENS[path] !== undefined) continue
      const g = tokenGroup(path)
      out.set(g, [...(out.get(g) ?? []), path])
    }
    return [...out.entries()]
  }, [overrides])

  const changed = Object.keys(overrides).length

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="text-[12px] font-semibold tracking-wide text-muted">토큰</span>
          <span className="text-[11px] text-muted" data-uiux-token-changed={changed}>
            {changed === 0 ? '전부 기본값' : `${changed}개 바꿈`}
          </span>
        </div>
        <div className="p-3">
          {groups.map(([group, paths]) => (
            <section key={group} className="mb-4 last:mb-0">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {group}
              </h3>
              <div className="flex flex-col gap-1">
                {paths.map((path) => (
                  <TokenRow
                    key={path}
                    path={path}
                    value={merged[path] ?? ''}
                    base={DEFAULT_TOKENS[path]}
                    overridden={overrides[path] !== undefined}
                    onChange={(v) => void setToken(path, v)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="w-[320px] shrink-0 overflow-auto border-l border-line bg-panel">
        <div className="flex h-9 items-center border-b border-line px-3">
          <span className="text-[12px] font-semibold tracking-wide text-muted">이렇게 보여요</span>
        </div>
        <div className="p-3">
          <Sample tokens={merged} types={['heading', 'text', 'input', 'button', 'badge', 'card']} />
        </div>
      </div>
    </div>
  )
}

function TokenRow({
  path,
  value,
  base,
  overridden,
  onChange
}: {
  path: string
  value: string
  base?: string
  overridden: boolean
  onChange: (value: string) => void
}) {
  const isColor = /^#|^rgb|^hsl/i.test(value)
  return (
    <div className="flex items-center gap-2" data-uiux-token={path}>
      <span className={cx('w-40 shrink-0 truncate font-mono text-[12px]', overridden && 'text-accent')}>
        {path}
      </span>
      {isColor && (
        <span className="size-4 shrink-0 rounded border border-line" style={{ background: value }} />
      )}
      <input
        className="min-w-0 flex-1 rounded border border-line bg-canvas px-2 py-1 font-mono text-[12px] outline-none focus:border-accent"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        title={overridden ? `기본값(${base})으로 되돌리기` : '기본값'}
        disabled={!overridden}
        className={cx('rounded p-1', overridden ? 'text-muted hover:text-fg' : 'text-muted/30')}
        onClick={() => onChange('')}
      >
        <RotateCcw size={12} />
      </button>
    </div>
  )
}

function ComponentsView() {
  const overrides = useSpecStore((s) => s.tokens)
  const merged = mergeTokens(overrides)
  const roles: ComponentRole[] = ['input', 'action', 'display', 'layout']

  return (
    <div className="h-full overflow-auto">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[12px] font-semibold tracking-wide text-muted">컴포넌트</span>
        <span className="text-[11px] text-muted">지금 토큰으로 그린 모습이에요</span>
      </div>
      <div className="p-4">
        {roles.map((role) => (
          <section key={role} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {ROLE_LABEL[role]}
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {COMPONENT_KINDS.filter((k) => k.role === role).map((kind) => (
                <div key={kind.type} className="rounded-md border border-line bg-panel p-2">
                  <div className="mb-1.5 flex items-baseline gap-1.5">
                    <span className="text-[12px] font-medium">{kind.label}</span>
                    <span className="font-mono text-[10px] text-muted">{kind.type}</span>
                  </div>
                  <Sample tokens={merged} types={[kind.type]} variants={VARIANTS[kind.type]} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

/** 변형이 있는 종류만 여러 벌 그린다 — 없는 것을 억지로 늘리면 같은 그림이 반복될 뿐이다. */
const VARIANTS: Record<string, string[]> = {
  button: ['', 'outline', 'ghost', 'danger']
}

/** 표본 값 — 빈 컴포넌트는 무엇인지 알 수 없으니 그럴듯한 값을 넣어 보인다. */
const SAMPLE_PROPS: Record<string, { label: string; props?: Record<string, unknown> }> = {
  heading: { label: '제목이 이렇게 보여요' },
  text: { label: '본문 글은 이런 크기와 줄 간격입니다.' },
  input: { label: '이메일', props: { placeholder: 'you@site.com' } },
  textarea: { label: '메모', props: { placeholder: '내용을 적어 주세요' } },
  select: { label: '분류', props: { options: ['전체', '진행 중'] } },
  checkbox: { label: '자동 로그인' },
  radio: { label: '결제 수단', props: { options: ['카드', '계좌'] } },
  switch: { label: '알림 받기' },
  button: { label: '버튼' },
  link: { label: '링크' },
  image: { label: '이미지' },
  badge: { label: '새로 나옴' },
  table: { label: '', props: { columns: ['이름', '상태'] } },
  list: { label: '', props: { items: ['첫째', '둘째'] } },
  card: { label: '카드 제목' },
  divider: { label: '' }
}

/**
 * 조각을 그림자 뿌리에 그려 보인다 — Style 화면도 미리보기와 **같은 격리**를 쓴다.
 * 앱 CSS 와 섞이면 여기서 본 모습과 실제 미리보기가 달라져 판단이 어긋난다.
 */
function Sample({
  tokens,
  types,
  variants
}: {
  tokens: TokenMap
  types: string[]
  variants?: string[]
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const shadowRef = useRef<ShadowRoot | null>(null)

  const html = useMemo(() => {
    const styles: string[] = []
    const body: string[] = []
    for (const type of types) {
      const scope = `t-${type.replace(/[^\w-]/g, '_')}`
      const { markup, style } = isolateTemplate(templateFor(type), scope)
      styles.push(style)
      const sample = SAMPLE_PROPS[type] ?? { label: type }
      for (const variant of variants ?? ['']) {
        const props = { ...(sample.props ?? {}), ...(variant ? { variant } : {}) }
        body.push(`<div class="cell">${renderTemplate(markup, { label: sample.label, props })}</div>`)
      }
    }
    return `<style>:host{${tokenCss(tokens)};display:block}
.wrap{display:flex;flex-direction:column;gap:var(--t-space-sm);font-family:inherit}
.cell{min-width:0}
${styles.join('\n')}</style><div class="wrap">${body.join('')}</div>`
  }, [tokens, types.join(','), (variants ?? []).join(',')])

  if (hostRef.current) {
    if (!shadowRef.current) shadowRef.current = hostRef.current.attachShadow({ mode: 'open' })
    shadowRef.current.innerHTML = html
  }

  return (
    <div
      ref={(el) => {
        hostRef.current = el
        if (el) {
          if (!shadowRef.current) shadowRef.current = el.attachShadow({ mode: 'open' })
          shadowRef.current.innerHTML = html
        }
      }}
    />
  )
}
