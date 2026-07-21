import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Lock, XCircle } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/ui/select'
import { cn } from '@renderer/lib/utils'
import { dialectInfo } from '../dialects'
import { useDesignsStore } from '../designs/store'
import { useDesignVersions } from '../versions/store'
import { useEnvironmentsStore, type EnvFormInput } from './store'
import { defaultPort, isFileBased, validateEnvForm, type EnvDbType } from './validate'

interface TestState {
  state: 'idle' | 'testing' | 'ok' | 'error'
  message?: string
  latencyMs?: number
  serverVersion?: string
}

/**
 * 환경 생성/수정 다이얼로그(§ops-plan Phase 1).
 * dbType 은 설계 방언(dialect)에 고정 — 표시만 하고 편집 불가(§IA 벤더 일치 불변식).
 * sqlite 는 파일 경로만, 나머지는 host/port/database/user + SSL. 연결 테스트로 serverVersion 확인.
 */
export function EnvironmentDialog() {
  const open = useEnvironmentsStore((s) => s.dialogOpen)
  const designId = useEnvironmentsStore((s) => s.dialogDesignId)
  const editing = useEnvironmentsStore((s) => s.editing)
  const closeDialog = useEnvironmentsStore((s) => s.closeDialog)
  const createEnv = useEnvironmentsStore((s) => s.create)
  const updateEnv = useEnvironmentsStore((s) => s.update)

  const design = useDesignsStore((s) => s.designs.find((d) => d.id === designId) ?? null)
  const dbType: EnvDbType = (design?.dialect ?? 'postgresql') as EnvDbType
  const versions = useDesignVersions(designId)

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [database, setDatabase] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [sslEnabled, setSslEnabled] = useState(false)
  const [targetVersion, setTargetVersion] = useState('')
  const [test, setTest] = useState<TestState>({ state: 'idle' })

  const fileBased = isFileBased(dbType)

  // 다이얼로그가 열릴 때(또는 편집 대상이 바뀔 때) 폼 시드.
  useEffect(() => {
    if (!open) return
    setTest({ state: 'idle' })
    if (editing) {
      setName(editing.name)
      setHost(editing.host)
      setPort(String(editing.port || ''))
      setDatabase(editing.database)
      setUser(editing.user)
      setPassword('')
      setSslEnabled(editing.sslEnabled)
      setTargetVersion(editing.targetVersion)
    } else {
      setName('')
      setHost(fileBased ? '' : 'localhost')
      setPort(fileBased ? '' : String(defaultPort(dbType)))
      setDatabase('')
      setUser('')
      setPassword('')
      setSslEnabled(false)
      setTargetVersion('')
    }
    // fileBased/dbType 은 designId 로부터 파생 — designId 를 dep 으로.
  }, [open, editing, designId, dbType, fileBased])

  const portNum = fileBased ? 0 : parseInt(port, 10)
  const { ok } = validateEnvForm(
    { name, dbType, host, port: portNum, database, user },
    { designDialect: dbType }
  )

  const buildForm = (): EnvFormInput => ({
    designId: designId!,
    name: name.trim(),
    dbType,
    host: fileBased ? '' : host.trim(),
    port: fileBased ? 0 : portNum,
    database: database.trim(),
    user: fileBased ? '' : user.trim(),
    password,
    sslEnabled: fileBased ? false : sslEnabled,
    targetVersion
  })

  const runTest = async () => {
    if (!ok || !designId) return
    setTest({ state: 'testing' })
    try {
      const r = await window.rockury.environments.test(buildForm())
      setTest({
        state: r.success ? 'ok' : 'error',
        message: r.message,
        latencyMs: r.latencyMs,
        serverVersion: r.serverVersion
      })
    } catch (e) {
      setTest({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const submit = async () => {
    if (!ok || !designId) return
    const form = buildForm()
    if (editing) await updateEnv(editing.id, form)
    else await createEnv(form)
    closeDialog()
  }

  const info = dialectInfo(dbType)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? '환경 편집' : '새 환경'}</DialogTitle>
          <DialogDescription>
            {design ? `“${design.name}” 설계의 배포 환경입니다.` : '배포 환경을 정의합니다.'} 벤더는
            설계 방언에 고정됩니다.
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-3 flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex items-end gap-3">
            <label className="flex flex-1 flex-col gap-1.5 text-[12px] font-semibold text-fg">
              환경 이름
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 개발 / QA / Stage / 운영"
                className="h-8 text-[13px] font-normal"
              />
            </label>
            <span
              title="벤더는 설계의 고정 속성 — 환경마다 다를 수 없어요"
              className="mb-1 flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] font-medium text-muted"
            >
              <span className="size-2 rounded-full" style={{ background: info.dot }} />
              {info.label}
              <Lock className="size-3 opacity-60" />
            </span>
          </div>

          {fileBased ? (
            <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
              DB 파일 경로
              <Input
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="/path/to/db.sqlite"
                className="h-8 font-mono text-[13px] font-normal"
              />
            </label>
          ) : (
            <>
              <div className="flex gap-3">
                <label className="flex flex-[2] flex-col gap-1.5 text-[12px] font-semibold text-fg">
                  호스트
                  <Input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="localhost"
                    className="h-8 font-mono text-[13px] font-normal"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1.5 text-[12px] font-semibold text-fg">
                  포트
                  <Input
                    value={port}
                    onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
                    inputMode="numeric"
                    placeholder={String(defaultPort(dbType))}
                    className="h-8 font-mono text-[13px] font-normal"
                  />
                </label>
              </div>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1.5 text-[12px] font-semibold text-fg">
                  데이터베이스
                  <Input
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                    placeholder="testdb"
                    className="h-8 font-mono text-[13px] font-normal"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1.5 text-[12px] font-semibold text-fg">
                  사용자
                  <Input
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder="test"
                    className="h-8 font-mono text-[13px] font-normal"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
                비밀번호 {editing && <span className="font-normal text-muted">(비우면 유지)</span>}
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editing ? '••••••• (변경하려면 입력)' : ''}
                  className="h-8 text-[13px] font-normal"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-fg">
                <Checkbox
                  checked={sslEnabled}
                  onCheckedChange={(c) => setSslEnabled(c === true)}
                />
                SSL 사용
              </label>
            </>
          )}

          <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
            타깃 버전 <span className="font-normal text-muted">(선택 — 반영 대상, Phase 3)</span>
            <Select value={targetVersion || undefined} onValueChange={setTargetVersion}>
              <SelectTrigger size="sm" className="w-full font-mono">
                <SelectValue placeholder={versions.length ? '버전 선택' : '컷된 버전 없음'} />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.number} value={v.number}>
                    {v.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {/* 연결 테스트 결과 배너 — 시맨틱 컬러 */}
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
                    {test.serverVersion && (
                      <span className="mt-0.5 block truncate font-mono text-[11px] opacity-80">
                        {test.serverVersion}
                      </span>
                    )}
                  </>
                )}
                {test.state === 'error' && (test.message || '연결 실패')}
              </span>
            </div>
          )}

          <DialogFooter className="mt-1 items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!ok || test.state === 'testing'}
              onClick={() => void runTest()}
            >
              연결 테스트
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={closeDialog}>
                취소
              </Button>
              <Button type="submit" size="sm" disabled={!ok}>
                {editing ? '저장' : '환경 만들기'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
