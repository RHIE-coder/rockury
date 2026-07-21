import { useEffect, useRef } from 'react'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  placeholder as cmPlaceholder
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { sql, PostgreSQL, MySQL, MariaSQL, SQLite, type SQLDialect } from '@codemirror/lang-sql'
import { json } from '@codemirror/lang-json'
import type { DialectId } from '@renderer/services/db/dialects'

/**
 * CodeMirror 6 기반 코드 에디터(§ops 향상 — 공유 기반). SQL/JSON 공용.
 * SQL 은 방언별 하이라이트 + **스키마 인지 자동완성**(introspection TableDef 에서 주입).
 * 화이트 테마에 맞춰 라이트 하이라이트. ⌘/Ctrl+Enter → onRun.
 */
export interface SqlEditorProps {
  value: string
  onChange: (v: string) => void
  onRun?: () => void
  /** SQL 자동완성용 스키마: 테이블명 → 컬럼명[]. */
  schema?: Record<string, string[]>
  dialect?: DialectId
  language?: 'sql' | 'json'
  placeholder?: string
  className?: string
}

const SQL_DIALECT: Record<DialectId, SQLDialect> = {
  postgresql: PostgreSQL,
  mysql: MySQL,
  mariadb: MariaSQL,
  sqlite: SQLite
}

function langExtension(props: SqlEditorProps) {
  if (props.language === 'json') return json()
  return sql({
    dialect: props.dialect ? SQL_DIALECT[props.dialect] : undefined,
    schema: props.schema,
    upperCaseKeywords: true
  })
}

export function SqlEditor(props: SqlEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const langComp = useRef(new Compartment())
  // 최신 콜백을 ref 로 참조 — 에디터 재생성 없이 항상 최신 핸들러 호출.
  const onChangeRef = useRef(props.onChange)
  const onRunRef = useRef(props.onRun)
  onChangeRef.current = props.onChange
  onRunRef.current = props.onRun

  // 마운트 시 1회 생성.
  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: props.value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.lineWrapping,
        props.placeholder ? cmPlaceholder(props.placeholder) : [],
        langComp.current.of(langExtension(props)),
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                onRunRef.current?.()
                return true
              }
            }
          ])
        ),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
        }),
        EditorView.theme({
          '&': { fontSize: '13px', backgroundColor: 'transparent', height: '100%' },
          '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
          '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--color-muted)' },
          '&.cm-focused': { outline: 'none' },
          '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-panel) 60%, transparent)' },
          '.cm-activeLineGutter': { backgroundColor: 'transparent' }
        })
      ]
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 외부 value 변경 반영(피드백 루프 방지 — 다를 때만).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (props.value !== cur) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: props.value } })
    }
  }, [props.value])

  // 방언/스키마/언어 변경 시 언어 확장만 재구성.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: langComp.current.reconfigure(langExtension(props)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dialect, props.language, props.schema])

  return <div ref={hostRef} className={props.className} />
}
