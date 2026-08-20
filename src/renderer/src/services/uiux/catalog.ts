/**
 * 기본 컴포넌트 어휘 — 미리보기 렌더.
 *
 * 원형(flare)은 조각을 하나도 들지 않고 프로젝트가 공급하게 했지만, rockury 는 배포되는 앱이라
 * 사용자가 **빈손으로 시작**한다. 기본 한 벌이 없으면 첫 화면에 놓을 것이 없다.
 * 여기 없는 종류를 써도 모델은 안 깨진다(`type` 은 열린 문자열) — 이건 "고르기 쉬운 기본값"일 뿐이다.
 *
 * 역할(role)은 인스턴스에 저장하지 않는다 — 목록을 묶어 보여 주기 위한 분류일 뿐이라
 * 여기 한 곳에만 둔다(같은 정보를 두 곳에 두면 어긋난다).
 */

export type ComponentRole = 'input' | 'action' | 'display' | 'layout'

export interface ComponentKind {
  type: string
  label: string
  role: ComponentRole
}

export const ROLE_LABEL: Record<ComponentRole, string> = {
  input: '입력',
  action: '동작',
  display: '표시',
  layout: '구성'
}

export const COMPONENT_KINDS: ComponentKind[] = [
  { type: 'input', label: '입력칸', role: 'input' },
  { type: 'textarea', label: '여러 줄 입력', role: 'input' },
  { type: 'select', label: '고르기', role: 'input' },
  { type: 'checkbox', label: '체크박스', role: 'input' },
  { type: 'radio', label: '라디오', role: 'input' },
  { type: 'switch', label: '스위치', role: 'input' },
  { type: 'button', label: '버튼', role: 'action' },
  { type: 'link', label: '링크', role: 'action' },
  { type: 'text', label: '글', role: 'display' },
  { type: 'heading', label: '제목', role: 'display' },
  { type: 'image', label: '이미지', role: 'display' },
  { type: 'badge', label: '배지', role: 'display' },
  { type: 'table', label: '표', role: 'display' },
  { type: 'list', label: '목록', role: 'display' },
  { type: 'card', label: '카드', role: 'layout' },
  { type: 'divider', label: '구분선', role: 'layout' }
]

/** 종류 → 사람이 읽는 이름. 모르는 종류는 그 이름을 그대로 쓴다(열린 어휘라 막지 않는다). */
export function kindLabel(type: string): string {
  return COMPONENT_KINDS.find((k) => k.type === type)?.label ?? type
}

/** 화면 종류 — 모달·드로어는 섹션이 아니라 화면과 동급이다(§2). */
export const SURFACE_KINDS: { kind: string; label: string }[] = [
  { kind: 'page', label: '화면' },
  { kind: 'modal', label: '모달' },
  { kind: 'dialog', label: '대화상자' },
  { kind: 'drawer', label: '드로어' },
  { kind: 'toast', label: '알림' }
]

export function surfaceKindLabel(kind: string): string {
  return SURFACE_KINDS.find((k) => k.kind === kind)?.label ?? kind
}

/** 설계가 어디까지 왔나(§8) — 판정은 에이전트가 하고 앱은 받아 적는다. */
export const STATUS_LABEL: Record<string, string> = {
  designed: '설계됨',
  implemented: '구현됨',
  verified: '확인됨'
}
