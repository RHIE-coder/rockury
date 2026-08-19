import { useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { cn } from '@renderer/lib/utils'
import { useAiStore } from './store'
import { ToolsPane } from './ToolsPane'

/**
 * AI › Agents — 에이전트 연동 화면. **한 화면 두 칸**이다.
 *
 *   왼쪽 "연결"  — 등록 명령 복사 1회(프로젝트 무관 전역) + 접속 키 관리
 *   오른쪽       — 이으면 무엇을 쓸 수 있나(에이전트에게 열어 둔 도구 목록)
 *
 * 도구 목록을 별도 모듈 탭으로 두지 않는 이유는 `ToolsPane` 머리주석 참고 —
 * 요약하면 "Tools" 라는 탭 이름만으로는 MCP 도구인지 범용 유틸리티인지 갈리지 않는다.
 *
 * 앱은 사용자 프로젝트 파일을 건드리지 않는다.
 * 시그니처: 왼쪽 칸 맨 위 ink 밴드 "에이전트 게이트웨이" — 살아있으면 초록 점이 깜빡인다.
 */

/** 복사 버튼 — 누르면 2초간 "복사됨"으로 바뀐다. tone: ink 밴드(dark) | 카드(light). */
function CopyCommand({
  label,
  command,
  tone = 'dark'
}: {
  label: string
  command: string | null
  tone?: 'dark' | 'light'
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      disabled={!command}
      onClick={() => {
        if (!command) return
        void navigator.clipboard.writeText(command)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors outline-none',
        tone === 'dark'
          ? cn(
              'border-white/20 focus-visible:ring-[3px] focus-visible:ring-white/40',
              copied ? 'border-transparent bg-white/15 text-white' : 'text-white/85 hover:bg-white/10'
            )
          : cn(
              'focus-visible:ring-[3px] focus-visible:ring-accent/30',
              copied ? 'border-accent/30 bg-accent/10 text-accent' : 'border-line text-fg hover:bg-panel'
            ),
        !command && 'cursor-not-allowed opacity-40'
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? '복사됨' : label}
    </button>
  )
}

/**
 * 재등록 버튼 묶음 — 접속 키를 바꾼 뒤 기존 등록을 새 키로 다시 잇는다(remove→add).
 * Claude Code 는 재등록이 꼭 필요하고, Codex 는 토큰을 환경변수로 참조해 사실상 새 키만 반영하면 된다.
 */
function ReregisterButtons({
  claude,
  codex
}: {
  claude: string | null
  codex: string | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <CopyCommand label="Claude Code 재등록 복사" command={claude} tone="light" />
        <CopyCommand label="Codex 재등록 복사" command={codex} tone="light" />
      </div>
      <span className="text-[11px] leading-relaxed break-keep text-muted">
        붙여넣어 실행하면 기존 등록을 지우고 새 키로 다시 등록해요. Codex 는 접속 키를 환경변수로
        참조해서 사실상 새 키만 반영하면 됩니다.
      </span>
    </div>
  )
}

/** 접속 키 관리 카드 — 마스킹 표시 + 보기/복사/재발급. */
function TokenCard() {
  const st = useAiStore()
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // 재발급 직후 — 재등록 안내를 바로 그 자리에 펼쳐 준다("키가 달라졌으니 이렇게 다시 등록").
  const [justRotated, setJustRotated] = useState(false)
  const token = st.status?.token ?? null

  const masked = token ? `••••••••••••${token.slice(-4)}` : '—'

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-canvas p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-muted" />
        <span className="text-[13px] font-semibold text-fg">접속 키 (Bearer)</span>
        <span className="text-[11px] text-muted">등록 명령에 자동으로 들어가요 — 값은 필요할 때만 확인</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code
          className={cn(
            'min-w-0 flex-1 truncate rounded-md bg-panel px-2.5 py-1.5 font-mono text-[12px] text-fg',
            !token && 'text-muted'
          )}
          title={st.revealed ? undefined : '가려져 있어요 — 눈 버튼으로 확인'}
        >
          {st.revealed && token ? token : masked}
        </code>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost" size="icon" className="size-7 text-muted hover:text-fg"
            title={st.revealed ? '가리기' : '값 보기'} disabled={!token} onClick={st.toggleReveal}
          >
            {st.revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button
            variant="ghost" size="icon" className="size-7 text-muted hover:text-accent" title="키 복사"
            disabled={!token}
            onClick={() => {
              if (!token) return
              void navigator.clipboard.writeText(token)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </Button>
        </div>
      </div>

      {confirming ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-destructive/10 px-3 py-2">
          <span className="text-[12px] text-destructive">
            기존에 등록한 에이전트 연결이 모두 끊겨요 — 재발급 후 다시 등록해야 해요.
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setConfirming(false)}>
              취소
            </Button>
            <Button
              variant="destructive" size="sm" className="h-6 px-2 text-[11px]" disabled={st.rotating}
              onClick={() => {
                void useAiStore
                  .getState()
                  .rotate()
                  .then(() => {
                    setConfirming(false)
                    if (!useAiStore.getState().error) setJustRotated(true)
                  })
              }}
            >
              {st.rotating ? <Loader2 className="size-3 animate-spin" /> : null} 재발급 진행
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-[11px] leading-relaxed break-keep text-muted">
            키는 이 컴퓨터의 안전 저장소(키체인)에 암호화돼 보관돼요. 유출이 의심되면 재발급하세요.
          </span>
          <Button
            variant="outline" size="sm" className="h-7 shrink-0 px-2.5 text-[12px]"
            disabled={!token} onClick={() => setConfirming(true)}
          >
            <RotateCcw className="size-3.5" /> 재발급
          </Button>
        </div>
      )}

      {/* 재발급 직후 — 접속 키가 달라졌으니 여기서 바로 재등록 명령을 준다. */}
      {justRotated && !confirming && (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
          <span className="text-[12px] font-medium text-fg">
            새 접속 키가 적용됐어요 — 기존에 등록한 에이전트를 새 키로 다시 등록하세요.
          </span>
          <ReregisterButtons claude={st.status?.claudeReregisterCommand ?? null} codex={st.status?.codexReregisterCommand ?? null} />
        </div>
      )}
    </div>
  )
}

/** 왼쪽 칸 — 잇는 일 전부(게이트웨이 상태 · 등록 명령 · 접속 키 · 연결 방법). */
function ConnectPane() {
  const st = useAiStore()

  // 화면에 들어올 때마다 상태 재점검(+접속 키는 다시 마스킹).
  useEffect(() => {
    void useAiStore.getState().refresh()
  }, [])

  const running = st.status?.running === true

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-5 py-3">
        <h2 className="text-[14px] font-bold text-fg">Agents</h2>
        <p className="text-[12px] break-keep text-muted">
          AI 에이전트(Claude Code·Codex)가 이 컴퓨터의 Rockury 를 도구로 쓰도록 연결합니다.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-4 px-5 py-4">
          {/* 시그니처 — 에이전트 게이트웨이 상태 밴드(ink). 살아있으면 초록 점 깜빡임.
              주소와 버튼을 **한 줄에 같이 두지 않는다.** 한 줄이면 좁은 칸에서 버튼이 폭을
              가져가 주소가 잘리는데, 주소는 잘리면 쓸모가 없다(surface 게이트 실측). */}
          <div className="flex flex-col gap-3 rounded-xl bg-ink px-4 py-3.5 text-white">
            <div className="flex items-start gap-3">
              <span className="relative mt-1 flex size-2.5 shrink-0">
                {running && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 motion-reduce:animate-none" />
                )}
                <span className={cn('relative inline-flex size-2.5 rounded-full', running ? 'bg-emerald-400' : 'bg-white/25')} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13px] font-semibold">
                  {running ? '에이전트 게이트웨이 열림' : '게이트웨이 준비 중'}
                </span>
                <span className="font-mono text-[11.5px] break-all text-white/55">
                  {running ? st.status?.url : '앱이 자동으로 다시 열어요 — 잠시 후 새로고침하세요'}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <CopyCommand label="Claude Code 등록 복사" command={st.status?.claudeCommand ?? null} />
              <CopyCommand label="Codex 등록 복사" command={st.status?.codexCommand ?? null} />
            </div>
          </div>

          {st.error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{st.error}</div>
          )}

          {/* 접속 키 관리 */}
          <TokenCard />

          {/* 연결 방법 — 등록은 1회, 프로젝트 무관 전역.
              칸 배경이 panel 이라 카드도 panel 계열이면 경계가 사라진다 → canvas 로 띄운다. */}
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-canvas p-4">
            <span className="text-[12px] font-semibold text-fg">연결 방법</span>
            <ol className="flex list-inside list-decimal flex-col gap-1 text-[12px] leading-relaxed break-keep text-muted">
              <li>위에서 쓰는 에이전트의 <b className="font-semibold text-fg">등록 복사</b> 버튼을 누르고, 터미널에 붙여넣어 실행해요(1회).</li>
              <li>등록은 전역이라 어느 프로젝트 폴더에서든 바로 적용돼요 — 프로젝트에 파일이 생기지 않아요.</li>
              <li>이후 에이전트에게 &ldquo;rockury 의 설계 목록 보여줘&rdquo;, &ldquo;스키마 검토해줘&rdquo;처럼 요청하면 됩니다.</li>
            </ol>

            {/* 키를 바꾼 뒤 — 재발급하면 기존 등록이 끊기므로 다시 등록해야 한다. */}
            <div className="mt-1 flex flex-col gap-2 border-t border-line pt-3">
              <span className="text-[12px] font-semibold text-fg">접속 키를 바꾼 뒤 (재발급 후)</span>
              <span className="text-[12px] leading-relaxed break-keep text-muted">
                접속 키를 재발급하면 이전 키로 등록한 에이전트는 연결이 끊겨요. 아래 재등록 명령을
                붙여넣어 실행하면 새 키로 다시 이어집니다.
              </span>
              <ReregisterButtons
                claude={st.status?.claudeReregisterCommand ?? null}
                codex={st.status?.codexReregisterCommand ?? null}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 두 칸을 좌우로 놓는다 — 왼쪽 "연결", 오른쪽 "열어 둔 도구".
 * 칸 너비는 사람이 끌어 정하고 그 선택이 기억된다(autoSaveId) — 도구 목록을 넓게 보고 싶은
 * 날과 연결만 손보는 날의 필요가 다르다.
 */
export function AgentsWorkspace() {
  return (
    // 제목은 안 준다 — `ConnectPane` 이 이미 `Agents` 머리를 갖고 있어 두 번 적히면 시끄럽다.
    // 머리줄에는 접기 손잡이만 선다.
    <WorkspacePanels autoSaveId="ai-agents" defaultSize={40} collapsible sidebar={<ConnectPane />}>
      <ToolsPane />
    </WorkspacePanels>
  )
}
