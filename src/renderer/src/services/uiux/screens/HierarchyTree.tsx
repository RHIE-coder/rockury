import { ChevronDown, ChevronRight, Frame, Layers, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { cx } from '@renderer/lib/cx'
import { surfaceKindLabel } from '../catalog'
import { useActiveProject, useSpecStore, useTree } from '../store'

/**
 * 위계 트리 — 앱 › 서비스 › 화면.
 *
 * 프로젝트는 여기 없다 — 상단 컨텍스트 바가 고르는 축이라 트리에 또 두면 "지금 무엇을 보고
 * 있나"가 두 곳에서 갈린다.
 */
export function HierarchyTree() {
  const tree = useTree()
  const project = useActiveProject()
  const openDialog = useSpecStore((s) => s.openDialog)
  const deleteNode = useSpecStore((s) => s.deleteNode)
  const selectSurface = useSpecStore((s) => s.selectSurface)
  const selectedSurfaceId = useSpecStore((s) => s.selectedSurfaceId)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (tree.applications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <p className="text-[13px] text-muted">앱이 아직 없어요.</p>
        <button
          className="text-[13px] font-medium text-accent hover:underline"
          onClick={() => openDialog({ level: 'application', parentId: project?.id ?? null })}
        >
          첫 앱 만들기
        </button>
      </div>
    )
  }

  return (
    <div className="py-1">
      {tree.applications.map((app) => {
        const services = tree.services.filter((s) => s.application_id === app.id)
        const appOpen = !collapsed.has(app.id)
        return (
          <div key={app.id}>
            <Row
              depth={0}
              icon={<Package size={14} />}
              label={app.name}
              hint={app.key}
              expanded={appOpen}
              onToggle={() => toggle(app.id)}
              onAdd={() => openDialog({ level: 'service', parentId: app.id })}
              addTitle="서비스 추가"
              onEdit={() =>
                openDialog({
                  level: 'application',
                  parentId: app.project_id,
                  editing: { id: app.id, key: app.key, name: app.name, description: app.description }
                })
              }
              onDelete={() => void deleteNode('application', app.id)}
              deleteTitle="앱 지우기 — 안의 서비스·화면도 함께 사라져요"
            />
            {appOpen &&
              services.map((svc) => {
                const surfaces = tree.surfaces.filter((s) => s.service_id === svc.id)
                const svcOpen = !collapsed.has(svc.id)
                return (
                  <div key={svc.id}>
                    <Row
                      depth={1}
                      icon={<Layers size={14} />}
                      label={svc.name}
                      hint={svc.key}
                      expanded={svcOpen}
                      onToggle={() => toggle(svc.id)}
                      onAdd={() => openDialog({ level: 'surface', parentId: svc.id })}
                      addTitle="화면 추가"
                      onEdit={() =>
                        openDialog({
                          level: 'service',
                          parentId: svc.application_id,
                          editing: {
                            id: svc.id,
                            key: svc.key,
                            name: svc.name,
                            description: svc.description
                          }
                        })
                      }
                      onDelete={() => void deleteNode('service', svc.id)}
                      deleteTitle="서비스 지우기 — 안의 화면도 함께 사라져요"
                    />
                    {svcOpen &&
                      surfaces.map((sf) => (
                        <Row
                          key={sf.id}
                          depth={2}
                          icon={<Frame size={14} />}
                          label={sf.name}
                          hint={sf.kind === 'page' ? sf.key : `${sf.key} · ${surfaceKindLabel(sf.kind)}`}
                          selected={sf.id === selectedSurfaceId}
                          onSelect={() => selectSurface(sf.id)}
                          onEdit={() =>
                            openDialog({
                              level: 'surface',
                              parentId: sf.service_id,
                              editing: {
                                id: sf.id,
                                key: sf.key,
                                name: sf.name,
                                description: sf.description,
                                kind: sf.kind
                              }
                            })
                          }
                          onDelete={() => void deleteNode('surface', sf.id)}
                          deleteTitle="화면 지우기"
                        />
                      ))}
                  </div>
                )
              })}
          </div>
        )
      })}

      <button
        className="mt-1 flex w-full items-center gap-1.5 px-3 py-1.5 text-[12px] text-muted hover:bg-panel-strong hover:text-fg"
        onClick={() => openDialog({ level: 'application', parentId: project?.id ?? null })}
      >
        <Plus size={13} /> 앱 추가
      </button>
    </div>
  )
}

/** 트리 한 줄 — 펼침·선택·추가·고치기·지우기가 한 모양으로 붙는다(층마다 달라 보이지 않게). */
function Row(props: {
  depth: number
  icon: React.ReactNode
  label: string
  hint?: string
  expanded?: boolean
  selected?: boolean
  onToggle?: () => void
  onSelect?: () => void
  onAdd?: () => void
  addTitle?: string
  onEdit?: () => void
  onDelete?: () => void
  deleteTitle?: string
}) {
  const { depth, icon, label, hint, expanded, selected, onToggle, onSelect } = props
  return (
    <div
      className={cx(
        'group flex h-7 items-center gap-1 pr-1 text-[13px]',
        selected ? 'bg-accent/10 text-fg' : 'text-fg/90 hover:bg-panel-strong'
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {onToggle ? (
        <button className="shrink-0 text-muted hover:text-fg" onClick={onToggle}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : (
        <span className="w-[13px] shrink-0" />
      )}
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={onSelect ?? onToggle}
      >
        <span className={selected ? 'text-accent' : 'text-muted'}>{icon}</span>
        <span className="truncate">{label}</span>
        {hint && <span className="shrink-0 truncate text-[11px] text-muted">{hint}</span>}
      </button>

      <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
        {props.onAdd && (
          <IconButton title={props.addTitle} onClick={props.onAdd}>
            <Plus size={13} />
          </IconButton>
        )}
        {props.onEdit && (
          <IconButton title="이름·주소 고치기" onClick={props.onEdit}>
            <Pencil size={12} />
          </IconButton>
        )}
        {props.onDelete && (
          <IconButton title={props.deleteTitle} onClick={props.onDelete} danger>
            <Trash2 size={12} />
          </IconButton>
        )}
      </span>
    </div>
  )
}

function IconButton({
  children,
  title,
  onClick,
  danger
}: {
  children: React.ReactNode
  title?: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      title={title}
      className={cx(
        'rounded p-1 text-muted hover:bg-panel',
        danger ? 'hover:text-destructive' : 'hover:text-fg'
      )}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

