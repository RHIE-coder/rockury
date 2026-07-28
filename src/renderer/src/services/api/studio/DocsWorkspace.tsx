import { BookOpen, Lock } from 'lucide-react'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { describeSignature } from '@shared/api/signature'
import { interfaceMeta } from '@shared/api/types'
import { useApiStore, useSpecSync } from '../store'

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
        <h3 className="text-[12px] font-semibold text-fg">
          사람이 쓰는 문서{' '}
          <span className="font-normal text-muted">— 정의에서 나올 수 없는 것만 (Markdown)</span>
        </h3>
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
      </section>
    </div>
  )
}
