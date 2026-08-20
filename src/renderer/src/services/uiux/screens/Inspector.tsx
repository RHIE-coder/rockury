import { Input } from '@renderer/ui/input'
import { cx } from '@renderer/lib/cx'
import { COMPONENT_KINDS, STATUS_LABEL, kindLabel, surfaceKindLabel } from '../catalog'
import { specAddress } from '../address'
import { findComponent, findNav, findSection, patchComponent, patchSection, setNav } from '../tree'
import { useActiveProject, useSpecStore, useTree } from '../store'
import { describeRule } from '../rules'
import type { Layout, NavKind, Rule, SurfaceContent } from '../types'

/**
 * 속성 — 지금 고른 조각(화면·영역·요소) 하나를 고친다.
 *
 * 배치는 **좌표가 아니라 방향과 칸 수**다. 세로로 쌓을지 가로로 늘어놓을지 격자로 나눌지만 정하고,
 * 실제 픽셀은 뷰포트가 정한다 — 그래서 화면 하나로 PC·태블릿·모바일이 모두 성립한다.
 */
export function Inspector() {
  const content = useSpecStore((s) => s.content)
  const surfaceId = useSpecStore((s) => s.selectedSurfaceId)
  const selectedNodeId = useSpecStore((s) => s.selectedNodeId)
  const editContent = useSpecStore((s) => s.editContent)
  const tree = useTree()
  const project = useActiveProject()

  const surface = tree.surfaces.find((s) => s.id === surfaceId) ?? null
  if (!surface || !content) {
    return <Empty text="고른 것이 없어요." />
  }

  const edit = (fn: (c: SurfaceContent) => SurfaceContent): void => void editContent(fn)

  const section = selectedNodeId ? findSection(content, selectedNodeId) : null
  const found = selectedNodeId ? findComponent(content, selectedNodeId) : null

  // ── 요소 ──
  if (found) {
    const { component } = found
    return (
      <Panel title="요소">
        <Field label="이름표">
          <Input
            value={component.label ?? ''}
            placeholder={kindLabel(component.type)}
            onChange={(e) => edit((c) => patchComponent(c, component.id, { label: e.target.value }))}
          />
        </Field>
        <Field label="종류">
          <select
            className="h-8 w-full rounded-md border border-line bg-canvas px-2 text-[13px]"
            value={component.type}
            onChange={(e) => edit((c) => patchComponent(c, component.id, { type: e.target.value }))}
          >
            {COMPONENT_KINDS.map((k) => (
              <option key={k.type} value={k.type}>
                {k.label}
              </option>
            ))}
            {!COMPONENT_KINDS.some((k) => k.type === component.type) && (
              <option value={component.type}>{component.type}</option>
            )}
          </select>
        </Field>
        <NavField content={content} componentId={component.id} onChange={edit} />
        <RuleField
          rule={component.rule}
          onChange={(rule) => edit((c) => patchComponent(c, component.id, { rule }))}
        />
        <Meta label="주소 조각" value={component.id} hint="흐름·규칙이 이 이름으로 가리켜요." />
      </Panel>
    )
  }

  // ── 영역 ──
  if (section) {
    return (
      <Panel title="영역">
        <Field label="이름">
          <Input
            value={section.name}
            onChange={(e) => edit((c) => patchSection(c, section.id, { name: e.target.value }))}
          />
        </Field>
        <Field label="배치">
          <LayoutPicker
            layout={section.layout}
            onChange={(layout) => edit((c) => patchSection(c, section.id, { layout }))}
          />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={section.showLabel ?? false}
            onChange={(e) => edit((c) => patchSection(c, section.id, { showLabel: e.target.checked }))}
          />
          이름을 화면에도 보이기
        </label>
        <Meta label="주소 조각" value={section.id} />
      </Panel>
    )
  }

  // ── 화면 ──
  const service = tree.services.find((s) => s.id === surface.service_id)
  const app = tree.applications.find((a) => a.id === service?.application_id)
  const address =
    project && app && service
      ? specAddress(project.key, app.key, service.key, surface.key)
      : surface.key

  return (
    <Panel title="화면">
      <Meta label="이름" value={surface.name} />
      <Meta label="종류" value={surfaceKindLabel(surface.kind)} />
      <Meta label="안정 주소" value={address} testId="uiux-address" hint="흐름·규칙·의견이 전부 이 주소에 걸려요." mono />
      {surface.description && <Meta label="설명" value={surface.description} />}
      <Field label="배치">
        <LayoutPicker layout={content.layout} onChange={(layout) => edit((c) => ({ ...c, layout }))} />
      </Field>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-[12px] text-muted">상태</span>
        <span className="rounded-full bg-panel-strong px-2 py-0.5 text-[11px] font-medium">
          {STATUS_LABEL[surface.status] ?? surface.status}
        </span>
      </div>
      <p className="text-[12px] leading-relaxed text-muted">
        상태는 사람이 손으로 바꾸는 칸이 아니에요 — 설계를 읽고 실제 코드를 본 에이전트가 확인 결과를
        적습니다.
      </p>
    </Panel>
  )
}

/**
 * 규칙 — 어떤 값이 유효하고 언제 켜지나. **구조로 저장하고 문장으로 보인다**(§3).
 * 구조 그대로 보이면 비개발자는 못 읽고 개발자도 한눈에 안 들어온다.
 */
function RuleField({ rule, onChange }: { rule?: Rule; onChange: (rule: Rule | undefined) => void }) {
  const lines = describeRule(rule)
  const patch = (part: Partial<Rule>): void => {
    const next: Rule = { ...rule, ...part }
    // 아무것도 안 말하는 규칙은 아예 지운다 — 빈 껍데기가 목록을 채우면 "규칙이 많다"는 착시가 생긴다.
    onChange(describeRule(next).length > 0 ? next : undefined)
  }

  return (
    <Field label="규칙">
      <div className="flex flex-col gap-1.5" data-uiux-rule-field>
        <div className="flex gap-1.5">
          <select
            data-uiux-rule-format
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 text-[13px]"
            value={rule?.constraints?.format ?? ''}
            onChange={(e) =>
              patch({ constraints: { ...rule?.constraints, format: e.target.value || undefined } })
            }
          >
            <option value="">형식 제한 없음</option>
            <option value="email">이메일</option>
            <option value="url">주소(URL)</option>
            <option value="number">숫자</option>
            <option value="tel">전화번호</option>
            <option value="date">날짜</option>
          </select>
          <Input
            className="h-8 w-20"
            type="number"
            min={1}
            placeholder="최대"
            value={rule?.constraints?.maxLength ?? ''}
            onChange={(e) =>
              patch({
                constraints: {
                  ...rule?.constraints,
                  maxLength: e.target.value ? Number(e.target.value) : undefined
                }
              })
            }
          />
        </div>

        <select
          className="h-8 w-full rounded-md border border-line bg-canvas px-2 text-[13px]"
          value={rule?.enabled?.requires === 'all-required' ? 'all-required' : ''}
          onChange={(e) =>
            patch({
              enabled: e.target.value
                ? { ...rule?.enabled, default: 'disabled', requires: 'all-required' }
                : undefined
            })
          }
        >
          <option value="">항상 켜져 있음</option>
          <option value="all-required">필수 칸이 다 채워지면 켜짐</option>
        </select>

        <Input
          className="h-8"
          placeholder="어긋나면 보일 문구"
          value={rule?.validation?.message ?? ''}
          onChange={(e) =>
            patch({
              validation: e.target.value
                ? { on: rule?.validation?.on ?? 'blur', message: e.target.value }
                : undefined
            })
          }
        />

        {lines.length > 0 && (
          <ul className="rounded border border-line bg-canvas p-2">
            {lines.map((line, i) => (
              <li key={i} className="text-[12px] leading-relaxed text-muted">
                · {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  )
}

/**
 * 누르면 어디로 가나 — 여기서 붙인 전이가 Flows 그래프의 화살표가 된다.
 * 대상은 **같은 프로젝트의 화면 목록**에서 고른다(주소를 손으로 적으면 오타가 조용히 끊긴다).
 */
function NavField({
  content,
  componentId,
  onChange
}: {
  content: SurfaceContent
  componentId: string
  onChange: (fn: (c: SurfaceContent) => SurfaceContent) => void
}) {
  const tree = useTree()
  const project = useActiveProject()
  const nav = findNav(content, componentId)

  const targets = tree.surfaces
    .map((sf) => {
      const svc = tree.services.find((s) => s.id === sf.service_id)
      const app = svc && tree.applications.find((a) => a.id === svc.application_id)
      if (!svc || !app || !project) return null
      return { address: `${project.key}.${app.key}.${svc.key}.${sf.key}`, name: sf.name }
    })
    .filter((t): t is { address: string; name: string } => t !== null)

  const kinds: { value: NavKind; label: string }[] = [
    { value: 'navigate', label: '이동' },
    { value: 'open', label: '열기' },
    { value: 'close', label: '닫기' }
  ]

  return (
    <Field label="누르면">
      <select
        data-uiux-nav-to
        className="h-8 w-full rounded-md border border-line bg-canvas px-2 text-[13px]"
        value={nav?.to ?? ''}
        onChange={(e) =>
          onChange((c) =>
            setNav(c, componentId, e.target.value ? { to: e.target.value, kind: nav?.kind ?? 'navigate' } : null)
          )
        }
      >
        <option value="">아무 일도 안 함</option>
        {targets.map((t) => (
          <option key={t.address} value={t.address}>
            {t.name}
          </option>
        ))}
      </select>
      {nav && (
        <div className="flex gap-1">
          {kinds.map((k) => (
            <button
              key={k.value}
              className={cx(
                'flex-1 rounded border px-2 py-1 text-[12px]',
                nav.kind === k.value ? 'border-accent text-accent' : 'border-line text-muted hover:text-fg'
              )}
              onClick={() => onChange((c) => setNav(c, componentId, { to: nav.to, kind: k.value }))}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
    </Field>
  )
}

/** 방향(세로·가로·격자)과 칸 수만 정한다 — 픽셀은 뷰포트가 정한다. */
function LayoutPicker({
  layout,
  onChange
}: {
  layout: Layout | undefined
  onChange: (layout: Layout) => void
}) {
  const type = layout?.type ?? 'stack'
  const options: { value: NonNullable<Layout['type']>; label: string }[] = [
    { value: 'stack', label: '세로' },
    { value: 'row', label: '가로' },
    { value: 'grid', label: '격자' }
  ]
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            className={cx(
              'flex-1 rounded border px-2 py-1 text-[12px]',
              type === o.value ? 'border-accent text-accent' : 'border-line text-muted hover:text-fg'
            )}
            onClick={() => onChange({ ...layout, type: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>
      {type === 'grid' && (
        <label className="flex items-center gap-2 text-[12px] text-muted">
          칸 수
          <Input
            className="h-7 w-16"
            type="number"
            min={1}
            max={6}
            value={layout?.columns ?? 2}
            onChange={(e) => onChange({ ...layout, type: 'grid', columns: Number(e.target.value) })}
          />
        </label>
      )}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-line px-3">
        <span className="text-[12px] font-semibold tracking-wide text-muted">{title}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] text-muted">{label}</span>
      {children}
    </label>
  )
}

function Meta({
  label,
  value,
  hint,
  mono,
  testId
}: {
  label: string
  value: string
  hint?: string
  mono?: boolean
  testId?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] text-muted">{label}</span>
      <span data-testid={testId} className={cx('text-[13px]', mono && 'font-mono text-[12px]')}>
        {value}
      </span>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-[13px] text-muted">
      {text}
    </div>
  )
}
