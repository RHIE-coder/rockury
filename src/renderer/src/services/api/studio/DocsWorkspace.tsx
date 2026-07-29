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
        className="overflow-auto rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-[11.5px] text-fg"
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
    return (
      <blockquote className="border-l-2 border-line pl-2.5 text-muted" data-api-md-quote>
        <Spans spans={b.spans} />
      </blockquote>
    )
  }
  if (b.t === 'table') {
    return (
      <div className="overflow-x-auto" data-api-md-table>
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
    <div
      className="flex flex-col gap-2 overflow-auto rounded-md border border-line px-3 py-2.5"
      data-api-md-preview
    >
      {blocks.map((b, i) => (
        <Block key={i} b={b} />
      ))}
    </div>
  )
}

/**
 * Studio › Docs — `docs/spec/api-studio.md` § docs.
 *
 * 핵심은 **가르는 것**이다. 자동 생성분(정의에서 나온 것)은 편집이 막혀 있고, 사람은
 * 정의에서 나올 수 없는 것만 쓴다. 손으로 쓴 파라미터 표는 반드시 썩는다 — 정의가 바뀔 때
 * 따라오지 않기 때문이다.
 */
export function DocsWorkspace() {
  useSpecSync()
  const active = useApiStore((s) => s.active)
  const selected = useApiStore((s) => s.selectedRequest)
  const saveRequests = useApiStore((s) => s.saveRequests)
  const [preview, setPreview] = useState(false)

  if (!active) {
    return (
      <PlaceholderView
        icon={BookOpen}
        depth="depth 3 · API › Studio › Docs"
        title="명세를 먼저 고르세요"
        subtitle="상단 컨텍스트 바에서 명세를 고르면 문서를 볼 수 있어요."
      />
    )
  }
  const req = active.requests.find((r) => r.name === selected) ?? active.requests[0]
  if (!req) {
    return (
      <PlaceholderView
        icon={BookOpen}
        depth="depth 3 · API › Studio › Docs"
        title="요청이 없어요"
        subtitle="Requests 에서 요청을 먼저 만들면 문서가 생깁니다."
      />
    )
  }

  const meta = interfaceMeta(active.kind)
  const signature = describeSignature(req.params)

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto px-5 py-4">
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

      <section className="flex min-h-0 flex-col gap-2" data-api-docs-authored>
        <h3 className="flex items-center gap-2 text-[12px] font-semibold text-fg">
          사람이 쓰는 문서{' '}
          <span className="font-normal text-muted">— 정의에서 나올 수 없는 것만 (Markdown)</span>
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
            <MarkdownPreview source={req.docs} />
            {/* **여기까지 그립니다** 를 화면이 말한다 — 모르는 문법은 꾸미지 않고 글자로
                남기므로, 무엇이 되는지 알아야 "왜 안 되지" 를 안 겪는다. */}
            <p className="text-[10.5px] text-muted" data-api-md-support>
              그리는 문법: {MARKDOWN_SUPPORT.join(' · ')}. 그 밖의 문법은 꾸미지 않고 원문 그대로
              보입니다. 링크는 http · https · mailto 만 열립니다.
            </p>
          </>
        ) : (
          <textarea
            value={req.docs}
            rows={12}
            data-api-docs
            placeholder={'# 왜 있는지\n\n# 언제 쓰면 안 되는지\n\n# 알려진 함정'}
            className="rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-[12px] text-fg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(e) =>
              void saveRequests(
                active.requests.map((r) => (r.name === req.name ? { ...r, docs: e.target.value } : r))
              )
            }
          />
        )}
      </section>
    </div>
  )
}
