import type { Column } from './types'

/**
 * 붙여넣은 글자를 **컬럼 목록으로 읽는** 순수 계산 (2026-08-20 사용자 요청:
 * "엑셀이라면 복사해서 붙여넣기로 처리할 텐데").
 *
 * 받아야 하는 글자가 한 가지가 아니다 — 어디서 긁어오느냐로 모양이 갈린다:
 *  · **엑셀·스프레드시트** — 칸이 탭으로 나뉜다. `created_at⇥DATETIME⇥NOT NULL⇥생성 시각`
 *  · **이 앱의 우클릭 복사** — `columnText` 가 만드는 한 줄. `id BIGINT NOT NULL DEFAULT 1 -- 주문 PK`
 *  · **DDL 조각** — 뒤에 쉼표가 붙고 이름이 따옴표·백틱에 싸일 수 있다. `` `created_at` DATETIME NOT NULL, ``
 *  · **이름만** — `created_at` 한 낱말. 타입은 기본값으로 채운다.
 *
 * 그래서 **탭이 있으면 탭으로, 없으면 공백으로** 가른다. 이게 유일한 갈림길이고, 나머지는
 * 뒤쪽 낱말들에서 `NOT NULL`·`DEFAULT`·`--` 를 주워 담는 같은 규칙을 쓴다.
 *
 * **틀리게 읽어도 조용히 넘기지 않는다** — 읽은 결과를 화면이 목록으로 보여 주고 사람이
 * 지우거나 고칠 수 있게 한다. 여기서는 못 읽은 줄을 `dropped` 로 돌려준다.
 */

/** 붙여넣기로 만들어진 컬럼 — 아직 id 가 없다(넣을 때 대상마다 새로 발급한다). */
export type PastedColumn = Omit<Column, 'id'> & { id: string }

export interface ParseResult {
  columns: PastedColumn[]
  /** 읽지 못해 버린 줄(원문 그대로) — 화면이 "이 줄은 못 읽었다"고 보인다. */
  dropped: string[]
}

/** 이름 둘레의 장식을 벗긴다 — 백틱·따옴표·대괄호(SQL Server)·뒤 쉼표. */
const bare = (s: string): string => s.replace(/[,;]+$/, '').replace(/^[`"'[]+|[`"'\]]+$/g, '').trim()

/** 머리글 줄로 보이나 — 엑셀에서 제목 줄까지 함께 긁어오는 일이 잦다. */
const looksLikeHeader = (name: string, type: string): boolean => {
  const n = name.toLowerCase()
  const t = type.toLowerCase()
  return (
    ['name', 'column', 'column_name', '이름', '컬럼', '컬럼명', '필드'].includes(n) &&
    ['type', 'datatype', 'data_type', '타입', '자료형', '형식', ''].includes(t)
  )
}

/**
 * 한 줄을 컬럼으로. 못 읽으면 `undefined`.
 * `defaultType` — 타입이 안 적힌 줄에 채울 값(`addColumn` 이 쓰는 것과 같게 부르는 쪽이 준다).
 */
function parseLine(line: string, defaultType: string): Omit<PastedColumn, 'id'> | undefined {
  // 주석은 먼저 떼어 낸다 — 안 떼면 `-- 생성 시각` 의 낱말들이 타입·기본값 자리로 흘러든다.
  const cut = line.indexOf('--')
  const comment = cut >= 0 ? line.slice(cut + 2).trim() : ''
  const body = (cut >= 0 ? line.slice(0, cut) : line).trim()
  if (body === '') return undefined

  const isTsv = body.includes('\t')
  const parts = (isTsv ? body.split('\t') : body.split(/\s+/)).map((s) => s.trim()).filter(Boolean)
  const name = bare(parts[0] ?? '')
  if (name === '') return undefined

  const rest = parts.slice(1)
  const type = bare(rest[0] ?? '')
  const after = rest.slice(1)
  /*
   * 탭으로 나뉜 글자(엑셀)는 **칸이 곧 뜻**이다 — 표식이 아닌 칸은 설명이다.
   * 이걸 안 가르면 `created_at⇥DATETIME⇥NOT NULL⇥생성 시각` 의 "생성 시각" 이 통째로 버려진다
   * (2026-08-20 실측: 붙여넣고 보니 설명 칸만 비어 있었다).
   * 공백으로 나뉜 글자에서는 안 한다 — 거기선 낱말이 표식인지 설명인지 가릴 근거가 없다.
   */
  const isFlag = (s: string): boolean =>
    /^(NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|KEY|AUTO_INCREMENT)$/i.test(s) || /^DEFAULT\b/i.test(s)
  const tail = (isTsv ? after.filter(isFlag) : after).join(' ')
  const tsvComment = isTsv ? after.filter((s) => !isFlag(s)).join(' ').trim() : ''
  const all = `${type} ${tail}`.toUpperCase()
  const notNull = /\bNOT\s+NULL\b/.test(all)
  const nullable = notNull ? false : !/\bPRIMARY\s+KEY\b/.test(all)
  const def = /\bDEFAULT\s+(.+?)(?:\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|COMMENT)\b|$)/i.exec(`${type} ${tail}`)

  // 타입 자리에 표식만 있으면(`created_at NOT NULL`) 타입이 아니라 표식이다.
  const typeIsFlag = /^(NOT|NULL|PRIMARY|DEFAULT|COMMENT|UNIQUE|KEY)$/i.test(type)
  return {
    name,
    type: type === '' || typeIsFlag ? defaultType : type,
    nullable,
    defaultValue: def ? bare(def[1]) || null : null,
    // `--` 로 적은 설명이 먼저다 — 사람이 대놓고 적은 것이니.
    comment: comment || tsvComment
  }
}

export function parseColumns(text: string, defaultType = 'VARCHAR(255)'): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  const columns: PastedColumn[] = []
  const dropped: string[] = []

  for (const [i, line] of lines.entries()) {
    const got = parseLine(line, defaultType)
    if (!got) {
      dropped.push(line.trim())
      continue
    }
    // 첫 줄만 머리글로 의심한다 — 가운데 줄이 우연히 `name type` 이면 그건 진짜 컬럼이다.
    if (i === 0 && looksLikeHeader(got.name, got.type === defaultType ? '' : got.type)) continue
    // 같은 이름이 두 번 오면 뒤엣것을 버린다 — 넣는 쪽에서 앞뒤가 서로를 덮어 헷갈린다.
    if (columns.some((c) => c.name === got.name)) {
      dropped.push(line.trim())
      continue
    }
    columns.push({ ...got, id: `paste-${columns.length}` })
  }

  return { columns, dropped }
}
