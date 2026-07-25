import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { Checkbox } from '@renderer/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { DIALECTS } from '../dialects'
import { useConnectionsStore, type ConnFormInput } from './store'
import { defaultPort, isFileBased, validateConnForm, type ConnDbType } from './validate'

interface TestState {
  state: 'idle' | 'testing' | 'ok' | 'error'
  message?: string
  latencyMs?: number
  serverVersion?: string
}

/**
 * 연결 생성/수정 다이얼로그(§IA · 결정 B). Connection 은 설계 무관 —
 * **dbType 을 여기서 자유 선택**(설계 방언에 고정되지 않음). Console 이 이 접속을 쓴다.
 */
export function ConnectionDialog() {
  const open = useConnectionsStore((s) => s.dialogOpen)
  const editing = useConnectionsStore((s) => s.editing)
  const closeDialog = useConnectionsStore((s) => s.closeDialog)
  const createConn = useConnectionsStore((s) => s.create)
  const updateConn = useConnectionsStore((s) => s.update)
  const reveal = useConnectionsStore((s) => s.reveal)

  const [name, setName] = useState('')
  const [dbType, setDbType] = useState<ConnDbType>('mysql')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [database, setDatabase] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [sslEnabled, setSslEnabled] = useState(false)
  const [autoCheckDisabled, setAutoCheckDisabled] = useState(false)
  const [test, setTest] = useState<TestState>({ state: 'idle' })

  const fileBased = isFileBased(dbType)

  useEffect(() => {
    if (!open) return
    setTest({ state: 'idle' })
    setShowPassword(false) // 열 때마다 가림 상태로 초기화 — 드러난 채 다음 편집에 새지 않게
    if (editing) {
      setName(editing.name)
      setDbType(editing.dbType)
      setHost(editing.host)
      setPort(String(editing.port || ''))
      setDatabase(editing.database)
      setUser(editing.user)
      setPassword('')
      setSslEnabled(editing.sslEnabled)
      setAutoCheckDisabled(editing.autoCheckDisabled)
      // 저장된 비번을 복호화해 프리필 — 눈 아이콘으로 확인 가능하게. 비우면 유지 규약은 유지됨(빈 값=변경 안 함).
      let cancelled = false
      void reveal(editing.id).then((pw) => {
        if (!cancelled) setPassword(pw)
      })
      return () => {
        cancelled = true
      }
    } else {
      setName('')
      setDbType('mysql')
      setHost('localhost')
      setPort(String(defaultPort('mysql')))
      setDatabase('')
      setUser('')
      setPassword('')
      setSslEnabled(false)
      setAutoCheckDisabled(false)
    }
    return undefined
  }, [open, editing, reveal])

  // dbType 변경 시 기본 포트 자동 반영(비어있거나 다른 벤더 기본값일 때).
  const pickDbType = (t: ConnDbType): void => {
    setDbType(t)
    if (!isFileBased(t)) {
      const cur = parseInt(port, 10)
      if (!port || Object.values({ p: 3306, q: 5432 }).includes(cur) || cur === 0) {
        setPort(String(defaultPort(t)))
      }
    }
  }

  const portNum = fileBased ? 0 : parseInt(port, 10)
  const { ok } = validateConnForm({ name, dbType, host, port: portNum, database, user })

  const buildForm = (): ConnFormInput => ({
    name: name.trim(),
    dbType,
    host: fileBased ? '' : host.trim(),
    port: fileBased ? 0 : portNum,
    database: database.trim(),
    user: fileBased ? '' : user.trim(),
    password,
    sslEnabled: fileBased ? false : sslEnabled,
    autoCheckDisabled
  })

  const runTest = async () => {
    if (!ok) return
    setTest({ state: 'testing' })
    try {
      const r = await window.rockury.connections.test(buildForm())
      setTest({ state: r.success ? 'ok' : 'error', message: r.message, latencyMs: r.latencyMs, serverVersion: r.serverVersion })
    } catch (e) {
      setTest({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const submit = async () => {
    if (!ok) return
    const form = buildForm()
    if (editing) await updateConn(editing.id, form)
    else await createConn(form)
    closeDialog()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? '연결 편집' : '새 연결'}</DialogTitle>
          <DialogDescription>
            DB 접속 정보입니다. 설계와 무관하게 이 연결만으로 Console(조회·쿼리)을 쓸 수 있어요.
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-3 flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
            연결 이름
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 운영 DB / 로컬" className="h-8 text-[13px] font-normal" />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-fg">벤더</span>
            <div className="grid grid-cols-4 gap-1.5">
              {DIALECTS.map((dd) => {
                const selected = dbType === dd.id
                return (
                  <button
                    key={dd.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => pickDbType(dd.id)}
                    className={cn(
                      'flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[12px] font-medium outline-none transition-colors',
                      selected ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:bg-panel'
                    )}
                  >
                    <span className="size-2 rounded-full" style={{ background: dd.dot }} />
                    {dd.id}
                  </button>
                )
              })}
            </div>
          </div>

          {fileBased ? (
            <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
              DB 파일 경로
              <Input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="/path/to/db.sqlite" className="h-8 font-mono text-[13px] font-normal" />
            </label>
          ) : (
            <>
              <div className="flex gap-3">
                <label className="flex flex-[2] flex-col gap-1.5 text-[12px] font-semibold text-fg">
                  호스트
                  <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" className="h-8 font-mono text-[13px] font-normal" />
                </label>
                <label className="flex flex-1 flex-col gap-1.5 text-[12px] font-semibold text-fg">
                  포트
                  <Input value={port} onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder={String(defaultPort(dbType))} className="h-8 font-mono text-[13px] font-normal" />
                </label>
              </div>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1.5 text-[12px] font-semibold text-fg">
                  데이터베이스
                  <Input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="testdb" className="h-8 font-mono text-[13px] font-normal" />
                </label>
                <label className="flex flex-1 flex-col gap-1.5 text-[12px] font-semibold text-fg">
                  사용자
                  <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="test" className="h-8 font-mono text-[13px] font-normal" />
                </label>
              </div>
              <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
                비밀번호 {editing && <span className="font-normal text-muted">(비우면 유지)</span>}
                <div className="relative">
                  <Input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editing ? '••••••• (변경하려면 입력)' : ''} className="h-8 pr-9 text-[13px] font-normal" />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? '비밀번호 가리기' : '비밀번호 보기'}
                    title={showPassword ? '가리기' : '보기'}
                    className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted outline-none hover:text-fg"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-fg">
                <Checkbox checked={sslEnabled} onCheckedChange={(c) => setSslEnabled(c === true)} />
                SSL 사용
              </label>
            </>
          )}

          <label className="flex cursor-pointer items-start gap-2 text-[12px] font-medium text-fg">
            <Checkbox className="mt-0.5" checked={autoCheckDisabled} onCheckedChange={(c) => setAutoCheckDisabled(c === true)} />
            <span className="flex flex-col">
              자동 확인에서 제외
              <span className="font-normal text-muted">Connections 페이지 진입·새로고침 시 이 연결은 확인하지 않습니다 (SSH 터널 등 상시연결 아닌 경우)</span>
            </span>
          </label>

          {test.state !== 'idle' && (
            <div
              className={cn(
                'flex items-start gap-2 rounded-md px-3 py-2 text-[12px] leading-relaxed',
                test.state === 'testing' && 'bg-panel text-muted',
                test.state === 'ok' && 'bg-success-soft text-success',
                test.state === 'error' && 'bg-destructive/10 text-destructive'
              )}
            >
              {test.state === 'testing' && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />}
              {test.state === 'ok' && <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />}
              {test.state === 'error' && <XCircle className="mt-0.5 size-3.5 shrink-0" />}
              <span className="min-w-0">
                {test.state === 'testing' && '연결 확인 중…'}
                {test.state === 'ok' && (
                  <>
                    연결 성공 · {test.latencyMs}ms
                    {test.serverVersion && <span className="mt-0.5 block truncate font-mono text-[11px] opacity-80">{test.serverVersion}</span>}
                  </>
                )}
                {test.state === 'error' && (test.message || '연결 실패')}
              </span>
            </div>
          )}

          <DialogFooter className="mt-1 items-center sm:justify-between">
            <Button type="button" variant="outline" size="sm" disabled={!ok || test.state === 'testing'} onClick={() => void runTest()}>
              연결 테스트
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={closeDialog}>
                취소
              </Button>
              <Button type="submit" size="sm" disabled={!ok}>
                {editing ? '저장' : '연결 만들기'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
