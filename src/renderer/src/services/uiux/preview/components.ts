/**
 * 기본 컴포넌트 조각 한 벌
 *
 * 규율 셋(테스트가 강제한다 — `components.test.ts`):
 *   1. **논리 없는 마크업.** 슬롯·있으면보이기·반복만(`template.ts` 문법). 조건식·스크립트 금지.
 *   2. **색·길이는 토큰 변수로만.** 하드코딩하면 사용자가 토큰을 바꿔도 안 따라오고, 그 순간
 *      토큰의 뜻이 사라진다. 검사기가 리터럴을 찾아 실패시킨다.
 *   3. **변형·상태는 CSS 가 가른다.** `data-variant="{{props.variant}}"` 를 두고
 *      `[data-variant=outline]` 로 받는다 — 마크업은 슬롯까지만.
 *
 * 사용자·에이전트가 이 조각을 덮어쓸 수 있게 되면(Style 모듈) 여기 값은 기본값이 된다.
 */

/** 조각이 공통으로 깔고 가는 것 — 미리보기 뿌리에서 상속된다. */
const BASE = `font:inherit;color:var(--t-color-fg);box-sizing:border-box`

/** 입력류가 공유하는 껍데기. 같은 CSS 를 여섯 번 적지 않는다. */
const FIELD = `${BASE};width:100%;min-width:0;height:var(--t-control-height);padding:0 var(--t-space-sm);border:var(--t-border-width) solid var(--t-color-line);border-radius:var(--t-radius-sm);background:var(--t-color-bg)`

const LABEL = `${BASE};display:block;font-size:var(--t-font-small);color:var(--t-color-muted);margin-bottom:var(--t-space-xs)`

export const COMPONENT_TEMPLATES: Record<string, string> = {
  input: `<label class="w"><span class="l">{{label}}</span>
<input class="f" type="{{props.inputType}}" placeholder="{{props.placeholder}}" /></label>
<style>.w{${BASE};display:block;width:100%}.l{${LABEL}}.f{${FIELD}}</style>`,

  textarea: `<label class="w"><span class="l">{{label}}</span>
<textarea class="f" placeholder="{{props.placeholder}}"></textarea></label>
<style>.w{${BASE};display:block;width:100%}.l{${LABEL}}.f{${FIELD};height:auto;min-height:calc(var(--t-control-height) * 2);padding:var(--t-space-sm);line-height:var(--t-line-body);resize:vertical}</style>`,

  select: `<label class="w"><span class="l">{{label}}</span>
<select class="f">{{#props.options}}<option>{{.}}</option>{{/props.options}}</select></label>
<style>.w{${BASE};display:block;width:100%}.l{${LABEL}}.f{${FIELD}}</style>`,

  checkbox: `<label class="w"><input type="checkbox" class="b" /><span>{{label}}</span></label>
<style>.w{${BASE};display:flex;align-items:center;gap:var(--t-space-sm);font-size:var(--t-font-body)}.b{width:var(--t-font-body);height:var(--t-font-body);accent-color:var(--t-color-primary)}</style>`,

  radio: `<div class="w"><span class="l">{{label}}</span>
{{#props.options}}<label class="r"><input type="radio" class="b" /><span>{{.}}</span></label>{{/props.options}}</div>
<style>.w{${BASE};display:block}.l{${LABEL}}.r{display:flex;align-items:center;gap:var(--t-space-sm);font-size:var(--t-font-body);margin-bottom:var(--t-space-xs)}.b{accent-color:var(--t-color-primary)}</style>`,

  switch: `<label class="w"><span class="t"></span><span>{{label}}</span></label>
<style>.w{${BASE};display:flex;align-items:center;gap:var(--t-space-sm);font-size:var(--t-font-body)}
.t{width:calc(var(--t-space-lg) + var(--t-space-xs));height:var(--t-space-lg);border-radius:var(--t-radius-pill);background:var(--t-color-line);position:relative;flex:none}
.t::after{content:"";position:absolute;top:var(--t-border-width);left:var(--t-border-width);width:calc(var(--t-space-lg) - var(--t-space-xs));height:calc(var(--t-space-lg) - var(--t-space-xs));border-radius:var(--t-radius-pill);background:var(--t-color-bg)}</style>`,

  button: `<button class="c" data-variant="{{props.variant}}">{{label}}</button>
<style>.c{${BASE};height:var(--t-control-height);padding:0 var(--t-space-md);border:var(--t-border-width) solid var(--t-color-primary);border-radius:var(--t-radius-sm);background:var(--t-color-primary);color:var(--t-color-primaryText);font-weight:var(--t-font-weightBold);font-size:var(--t-font-body);cursor:pointer}
.c[data-variant="outline"]{background:transparent;color:var(--t-color-primary)}
.c[data-variant="ghost"]{background:transparent;border-color:transparent;color:var(--t-color-primary)}
.c[data-variant="danger"]{background:var(--t-color-danger);border-color:var(--t-color-danger)}</style>`,

  link: `<a class="c" href="#">{{label}}</a>
<style>.c{${BASE};color:var(--t-color-primary);font-size:var(--t-font-body);text-decoration:underline}</style>`,

  text: `<p class="c">{{label}}</p>
<style>.c{${BASE};margin:0;font-size:var(--t-font-body);line-height:var(--t-line-body)}</style>`,

  heading: `<h2 class="c">{{label}}</h2>
<style>.c{${BASE};margin:0;font-size:var(--t-font-heading);font-weight:var(--t-font-weightBold);line-height:var(--t-line-body)}</style>`,

  image: `<div class="c"><span>{{label}}</span></div>
<style>.c{${BASE};display:flex;align-items:center;justify-content:center;width:100%;min-height:calc(var(--t-control-height) * 3);border:var(--t-border-width) dashed var(--t-color-line);border-radius:var(--t-radius-sm);background:var(--t-color-surface);color:var(--t-color-muted);font-size:var(--t-font-small)}</style>`,

  badge: `<span class="c">{{label}}</span>
<style>.c{${BASE};display:inline-block;padding:var(--t-space-xs) var(--t-space-sm);border-radius:var(--t-radius-pill);background:var(--t-color-surface);color:var(--t-color-muted);font-size:var(--t-font-small)}</style>`,

  table: `<table class="c"><thead><tr>{{#props.columns}}<th>{{.}}</th>{{/props.columns}}</tr></thead>
<tbody><tr>{{#props.columns}}<td></td>{{/props.columns}}</tr><tr>{{#props.columns}}<td></td>{{/props.columns}}</tr></tbody></table>
<style>.c{${BASE};width:100%;border-collapse:collapse;font-size:var(--t-font-body)}
.c th,.c td{border:var(--t-border-width) solid var(--t-color-line);padding:var(--t-space-sm);text-align:left}
.c th{background:var(--t-color-surface);color:var(--t-color-muted);font-size:var(--t-font-small);font-weight:var(--t-font-weightBold)}
.c td{height:var(--t-control-height)}</style>`,

  list: `<ul class="c">{{#props.items}}<li>{{.}}</li>{{/props.items}}</ul>
<style>.c{${BASE};margin:0;padding-left:var(--t-space-lg);font-size:var(--t-font-body);line-height:var(--t-line-body)}</style>`,

  card: `<div class="c"><span class="t">{{label}}</span></div>
<style>.c{${BASE};width:100%;padding:var(--t-space-md);border:var(--t-border-width) solid var(--t-color-line);border-radius:var(--t-radius-md);background:var(--t-color-bg)}
.t{font-weight:var(--t-font-weightBold);font-size:var(--t-font-body)}</style>`,

  divider: `<hr class="c" />
<style>.c{${BASE};width:100%;border:0;border-top:var(--t-border-width) solid var(--t-color-line);margin:var(--t-space-sm) 0}</style>`
}

/**
 * 모르는 종류를 위한 대체 조각. `type` 은 열린 문자열이라 언제든 모르는 것이 온다 —
 * 그때 아무것도 안 그리면 화면에 구멍이 생겨 무엇이 빠졌는지 알 수 없다.
 */
export const FALLBACK_TEMPLATE = `<div class="c"><b>{{label}}</b></div>
<style>.c{${BASE};width:100%;padding:var(--t-space-sm);border:var(--t-border-width) dashed var(--t-color-line);border-radius:var(--t-radius-sm);background:var(--t-color-surface);color:var(--t-color-muted);font-size:var(--t-font-small)}</style>`

export function templateFor(type: string): string {
  return COMPONENT_TEMPLATES[type] ?? FALLBACK_TEMPLATE
}
