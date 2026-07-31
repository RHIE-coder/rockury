/**
 * JSON 셀 표시 로직(§ops 향상 — Data). 순수 함수 → 테스트 의무.
 *
 * 그리드 한 줄에 원본 JSON 을 그대로 흘리면 `{"a":1,"b":[...` 처럼 잘려서
 * "무엇이 들어 있는지"를 못 읽는다. 그래서 셀에는 **구조 요약**(객체/배열 + 개수)과
 * 공백을 정리한 미리보기를 보이고, 전체는 뷰어에서 정렬해 본다.
 */

export type JsonShape = 'object' | 'array' | 'scalar' | 'empty' | 'invalid'

export interface JsonSummary {
  shape: JsonShape
  /** 객체면 키 수, 배열이면 항목 수. 그 외 undefined. */
  count?: number
  /** 셀 왼쪽 칩에 찍는 짧은 표식 — `{} 5`, `[] 12`, `""`, `잘못된 JSON`. */
  chip: string
  /** 셀에 흘리는 한 줄 미리보기(공백 정리 + 길이 제한). */
  preview: string
  /** 뷰어 제목에 쓰는 사람 말 요약 — `객체 · 키 5개`. */
  label: string
}

const SHAPE_LABEL: Record<JsonShape, string> = {
  object: '객체',
  array: '배열',
  scalar: '값',
  empty: '빈 값',
  invalid: '잘못된 JSON'
}

/** JSON 텍스트를 파싱해 본다. 실패하면 오류 메시지를, 성공하면 null 을 준다. */
export function jsonError(text: string): string | null {
  if (text.trim() === '') return null
  try {
    JSON.parse(text)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : '형식을 읽을 수 없습니다'
  }
}

/** 공백·줄바꿈을 한 칸으로 눌러 한 줄로 만든다(미리보기용). */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function summarizeJson(text: string, previewLimit = 160): JsonSummary {
  const raw = text ?? ''
  if (raw.trim() === '') {
    return { shape: 'empty', chip: '""', preview: '', label: SHAPE_LABEL.empty }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const preview = oneLine(raw)
    return {
      shape: 'invalid',
      chip: '!',
      preview: preview.length > previewLimit ? `${preview.slice(0, previewLimit)}…` : preview,
      label: SHAPE_LABEL.invalid
    }
  }

  // 압축 형태를 미리보기의 바탕으로 쓴다 — 저장된 원본이 이미 정렬돼 있어도 한 줄로 보인다.
  const compact = oneLine(JSON.stringify(parsed))
  const preview = compact.length > previewLimit ? `${compact.slice(0, previewLimit)}…` : compact

  if (Array.isArray(parsed)) {
    return {
      shape: 'array',
      count: parsed.length,
      chip: `[] ${parsed.length}`,
      preview,
      label: `${SHAPE_LABEL.array} · 항목 ${parsed.length}개`
    }
  }
  if (parsed !== null && typeof parsed === 'object') {
    const n = Object.keys(parsed as Record<string, unknown>).length
    return {
      shape: 'object',
      count: n,
      chip: `{} ${n}`,
      preview,
      label: `${SHAPE_LABEL.object} · 키 ${n}개`
    }
  }
  return { shape: 'scalar', chip: '·', preview, label: SHAPE_LABEL.scalar }
}

/** 보기 좋게 2칸 들여쓰기. 파싱 못 하면 원문 그대로(사용자가 고칠 수 있게). */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** 한 줄로 압축. 파싱 못 하면 원문 그대로. */
export function compactJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return text
  }
}
