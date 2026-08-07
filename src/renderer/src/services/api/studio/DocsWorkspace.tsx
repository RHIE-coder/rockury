import { useState } from 'react'
import { BookOpen, Eye, Lock, Pencil } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { describeSignature } from '@shared/api/signature'
import { MARKDOWN_SUPPORT, parseMarkdown, type MdBlock, type MdSpan } from '@shared/api/markdown'
import { interfaceMeta } from '@shared/api/types'
import { useApiStore, useSpecSync } from '../store'

/**
 * markdown 미리보기 (spec docs.authored AC-2).
 *
 * **HTML 문자열을 만들지 않는다** — 토막 트리를 받아 React 요소로 그린다. 그래야
 * `dangerouslySetInnerHTML` 이 필요 없고, 가져오기로 들어온 남의 글이 섞여도 안전하다.
 */
function Spans({ spans }: { spans: MdSpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.t === 'code')
          return (
            <code key={i} className="rounded bg-panel px-1 py-0.5 font-mono text-[11.5px] text-accent-2">
              {s.text}
            </code>
          )
        if (s.t === 'strong') return <b key={i} className="font-semibold text-fg">{s.text}</b>
        if (s.t === 'em') return <i key={i}>{s.text}</i>
        if (s.t === 'link')
          return (
            <a
              key={i}
              href={s.href}
              target="_blank"
              rel="noreferrer noopener"
              data-api-md-link
              className="text-accent underline underline-offset-2"
            >
              {s.text}
            </a>
          )
        return <span key={i}>{s.text}</span>
      })}
    </>
  )
}

function Block({ b }: { b: MdBlock }) {
  if (b.t === 'heading') {
    const size = ['text-[15px]', 'text-[14px]', 'text-[13px]'][Math.min(b.level, 3) - 1] ?? 'text-[12.5px]'
    return (
      <p className={cn('font-semibold text-fg', size)} data-api-md-heading={b.level}>
        <Spans spans={b.spans} />
      </p>
    )
  }
  if (b.t === 'code') {
    return (
      <pre
        data-api-md-code
        // 가로만 넘치게 둔다 — 세로로 자르면 코드가 몇 줄에서 끊긴다(표와 같은 자리).
        className="overflow-x-auto rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-[11.5px] text-fg"
      >
        {b.text}
      </pre>
    )
  }
  if (b.t === 'list') {
    const Tag = b.ordered ? 'ol' : 'ul'
    return (
      <Tag className={cn('flex flex-col gap-0.5 pl-5', b.ordered ? 'list-decimal' : 'list-disc')} data-api-md-list>
        {b.items.map((it, i) => (
          <li key={i}>
            <Spans spans={it} />
          </li>
        ))}
      </Tag>
    )
  }
  if (b.t === 'quote') {
    // 인용은 본문과 같은 크기다 — 크게 두면 h2 와 동급이 되어 위계가 뒤집힌다.
    return (
      <blockquote className="border-l-2 border-line pl-2.5 text-[12px] text-muted" data-api-md-quote>
        <Spans spans={b.spans} />
      </blockquote>
    )
  }
  if (b.t === 'table') {
    // `overflow-x: auto` 는 규정상 `overflow-y` 도 auto 로 만든다 — 세로 flex(`min-h-0`)
    // 안에서 이 상자가 스크롤 주체가 되어 **표 본문이 0행 보이는** 일이 있었다(실측).
    // 가로만 넘치게 두고 세로는 안 자른다.
    return (
      <div className="overflow-x-auto overflow-y-visible" data-api-md-table>
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr>
              {b.head.map((c, i) => (
                <th key={i} className="border border-line bg-panel px-2 py-1 text-left font-semibold text-fg">
                  <Spans spans={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((row, i) => (
              <tr key={i}>
                {row.map((c, j) => (
                  <td key={j} className="border border-line px-2 py-1 align-top">
                    <Spans spans={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (b.t === 'rule') return <hr className="border-line" />
  return (
    <p className="text-[12px] leading-relaxed text-fg">
      <Spans spans={b.spans} />
    </p>
  )
}

function MarkdownPreview({ source }: { source: string }) {
  const blocks = parseMarkdown(source)
  if (blocks.length === 0) {
    return (
      <p className="rounded-md border border-line px-2.5 py-2 text-[11.5px] text-muted" data-api-md-empty>
        아직 쓴 것이 없어요.
      </p>
    )
  }
  return (
    // **미리보기 상자 하나만 스크롤 주체다.** 안쪽 표·코드가 각자 세로 스크롤을 가지면
    // 바깥 페이지를 내려도 안 나오는 내용이 생긴다(실측: 표 3행 중 0행).
    <div
      className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto rounded-md border border-line px-3 py-2.5"
      data-api-md-preview
    >
      {blocks.map((b, i) => (
        <Block key={i} b={b} />
      ))}
    </div>
  )
}

/**
 * 사람이 쓰는 문서 칸 — 명세용과 요청용이 **같은 물건**이라 한 곳에 둔다.
 * 갈라 두면 한쪽에만 고친 동작(미리보기 규칙·문법 안내)이 다른 쪽에서 조용히 어긋난다.
 */
function AuthoredDocs({
  value,
  onChange,
  scopeHint,
  placeholder,
  marker
}: {
  value: string
  onChange: (next: string) => void
  /** 이 문서가 무엇에 걸리는지 — 명세 전체인지 요청 하나인지. */
  scopeHint: string
  placeholder: string
  marker: string
}) {
  const [preview, setPreview] = useState(false)

  return (
    <section className="flex min-h-0 flex-col gap-2" data-api-docs-authored>
      <h3 className="flex items-center gap-2 text-[12px] font-semibold text-fg">
        사람이 쓰는 문서 <span className="font-normal text-muted">— {scopeHint} (Markdown)</span>
        <span className="flex-1" />
        {/* 미리보기는 **원문 옆이 아니라 자리를 바꿔** 보인다 — 좁은 패널에서 둘을 나란히
            두면 양쪽 다 못 읽는다. */}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px]"
          data-api-docs-preview-toggle
          onClick={() => setPreview((v) => !v)}
        >
          {preview ? <Pencil className="size-3" /> : <Eye className="size-3" />}
          {preview ? '고치기' : '미리보기'}
        </Button>
      </h3>

      {preview ? (
        <>
          <MarkdownPreview source={value} />
          {/* **여기까지 그립니다** 를 화면이 말한다 — 모르는 문법은 꾸미지 않고 글자로
              남기므로, 무엇이 되는지 알아야 "왜 안 되지" 를 안 겪는다. */}
          <p className="text-[10.5px] text-muted" data-api-md-support>
            그리는 문법: {MARKDOWN_SUPPORT.join(' · ')}. 그 밖의 문법은 꾸미지 않고 원문 그대로
            보입니다. 링크는 http · https · mailto 만 열립니다.
          </p>
        </>
      ) : (
        <textarea
          value={value}
          rows={12}
          {...{ [marker]: true }}
          placeholder={placeholder}
          className="rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-[12px] text-fg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </section>
  )
}

/** 문서의 대상 — 명세 전체냐, 고른 요청 하나냐. */
type DocsTarget = 'spec' | 'request'

const TARGET_LABEL: Record<DocsTarget, string> = { spec: '명세', request: '요청' }

/**
 * Studio › Docs — `docs/spec/api-studio.md` § docs.
 *
 * 핵심은 **가르는 것**이다. 자동 생성분(정의에서 나온 것)은 편집이 막혀 있고, 사람은
 * 정의에서 나올 수 없는 것만 쓴다. 손으로 쓴 파라미터 표는 반드시 썩는다 — 정의가 바뀔 때
 * 따라오지 않기 때문이다.
 *
 * 대상이 둘(명세 전체 · 요청 하나)인데 **한 번에 하나만 보인다** — 둘을 한 화면에 쌓으면
 * 어느 요청을 보든 명세 문서가 자리를 차지하고, 지금 읽는 글이 무엇에 걸리는지도 흐려진다.
 */
export function DocsWorkspace() {
  useSpecSync()
  const active = useApiStore((s) => s.active)
  const selected = useApiStore((s) => s.selectedRequest)
  const saveRequests = useApiStore((s) => s.saveRequests)
  const saveSpecDocs = useApiStore((s) => s.saveSpecDocs)
  const [target, setTarget] = useState<DocsTarget>('request')

  if (!active) {
    return (
      <PlaceholderView
        icon={BookOpen}
        title="명세를 먼저 고르세요"
        subtitle="상단 컨텍스트 바에서 명세를 고르면 문서를 볼 수 있어요."
      />
    )
  }

  const meta = interfaceMeta(active.kind)
  const req = active.requests.find((r) => r.name === selected) ?? active.requests[0]

  const switcher = (
    <div className="flex w-fit items-center gap-0.5 rounded-md border border-line bg-panel p-0.5" data-api-docs-target>
      {(Object.keys(TARGET_LABEL) as DocsTarget[]).map((t) => (
        <button
          key={t}
          type="button"
          data-api-docs-target-option={t}
          aria-pressed={target === t}
          onClick={() => setTarget(t)}
          className={cn(
            'rounded px-2.5 py-1 text-[12px] font-medium transition-colors',
            target === t ? 'bg-canvas text-fg shadow-sm' : 'text-muted hover:text-fg'
          )}
        >
          {TARGET_LABEL[t]}
        </button>
      ))}
    </div>
  )

  if (target === 'spec') {
    return (
      <div className="flex h-full flex-col gap-5 overflow-auto px-5 py-4">
        {switcher}
        <header className="flex items-center gap-2">
          <BookOpen className="size-4 text-muted" />
          <span className="text-[14px] font-semibold text-fg">{active.name}</span>
          <span className="rounded-full bg-panel px-2 py-0.5 text-[10.5px] font-medium text-muted">
            {meta.label}
          </span>
        </header>

        <AuthoredDocs
          value={active.docs}
          onChange={(next) => void saveSpecDocs(next)}
          scopeHint="어느 요청을 부르든 걸리는 것만"
          placeholder={'# 인증\n\n# 요금과 한도\n\n# 이용 조건'}
          marker="data-api-spec-docs"
        />
      </div>
    )
  }

  if (!req) {
    return (
      <div className="flex h-full flex-col gap-5 overflow-auto px-5 py-4">
        {switcher}
        <PlaceholderView
          icon={BookOpen}
          title="요청이 없어요"
          subtitle="Requests 에서 요청을 먼저 만들면 문서가 생깁니다."
        />
      </div>
    )
  }

  const signature = describeSignature(req.params)

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto px-5 py-4">
      {switcher}
      <header className="flex items-center gap-2">
        <BookOpen className="size-4 text-muted" />
        <span className="text-[14px] font-semibold text-fg">{req.name}</span>
        <span className="rounded-full bg-panel px-2 py-0.5 text-[10.5px] font-medium text-muted">
          {meta.label}
        </span>
      </header>

      <section className="flex flex-col gap-2" data-api-docs-generated>
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
          <Lock className="size-3.5 text-muted" />
          자동 생성 <span className="font-normal text-muted">— 정의에서 나옵니다 (편집 불가)</span>
        </h3>

        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-[12px]">
            <thead className="bg-panel text-muted">
              <tr>
                <th className="px-2.5 py-1.5 text-left font-medium">파라미터</th>
                <th className="px-2.5 py-1.5 text-left font-medium">타입</th>
                <th className="px-2.5 py-1.5 text-left font-medium">필수</th>
                <th className="px-2.5 py-1.5 text-left font-medium">기본값</th>
                <th className="px-2.5 py-1.5 text-left font-medium">설명</th>
              </tr>
            </thead>
            <tbody>
              {signature.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2.5 py-2 text-muted">
                    파라미터 없음
                  </td>
                </tr>
              ) : (
                signature.map((p) => (
                  <tr key={p.name} className="border-t border-line">
                    <td className="px-2.5 py-1.5 font-mono text-fg">{p.name}</td>
                    <td className="px-2.5 py-1.5 text-muted">{p.type}</td>
                    <td className="px-2.5 py-1.5 text-muted">{p.required ? '필수' : '선택'}</td>
                    <td className="px-2.5 py-1.5 font-mono text-muted">{p.defaultValue ?? '—'}</td>
                    <td className="px-2.5 py-1.5 text-muted">{p.description ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-[12px]">
            <thead className="bg-panel text-muted">
              <tr>
                <th className="px-2.5 py-1.5 text-left font-medium">응답 상태</th>
                <th className="px-2.5 py-1.5 text-left font-medium">필드</th>
              </tr>
            </thead>
            <tbody>
              {req.responses.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-2.5 py-2 text-muted">
                    선언 없음 — 아직 응답 모양을 적지 않았습니다(응답이 없다는 뜻이 아닙니다).
                  </td>
                </tr>
              ) : (
                req.responses.map((r) => (
                  <tr key={r.status} className="border-t border-line">
                    <td className="px-2.5 py-1.5 font-mono text-fg">{r.status}</td>
                    <td className="px-2.5 py-1.5 text-muted">
                      {r.fields.map((f) => `${f.name}: ${f.type}`).join(' · ') || '없음'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AuthoredDocs
        value={req.docs}
        onChange={(next) =>
          void saveRequests(active.requests.map((r) => (r.name === req.name ? { ...r, docs: next } : r)))
        }
        scopeHint="정의에서 나올 수 없는 것만"
        placeholder={'# 왜 있는지\n\n# 언제 쓰면 안 되는지\n\n# 알려진 함정'}
        marker="data-api-docs"
      />
    </div>
  )
}
