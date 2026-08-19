// 스크립트 사용법 출력 — 설명의 원본은 **파일 머리 주석 하나뿐**이다.
//
//   const { helpIfAsked } = require('../lib/usage.cjs')
//   helpIfAsked(__filename)                        // .cjs
//   helpIfAsked(fileURLToPath(import.meta.url))    // .mjs
//
// 도움말 문자열을 따로 두면 주석과 둘로 갈라져 한쪽만 고쳐진다. 그래서 파일을 다시 읽어
// 머리 주석을 그대로 뱉는다 — dev 스크립트는 언제나 소스 그대로 실행되므로 안전하다.
// .cjs 인 이유: Electron 으로 도는 .cjs 스크립트가 동기 require 로 이걸 써야 한다.

const { readFileSync } = require('node:fs')

/** 파일 맨 앞의 `//` 주석 덩어리를 사용법 텍스트로 뽑는다(shebang 은 건너뛴다). */
function extractUsage(source) {
  const out = []
  for (const line of source.split('\n')) {
    if (out.length === 0 && line.startsWith('#!')) continue
    if (!line.startsWith('//')) break
    out.push(line.replace(/^\/\/ ?/, ''))
  }
  // 꼬리 빈 줄만 떨어낸다 — 주석 안의 빈 줄은 문단 구분이라 살린다.
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return out.join('\n')
}

/** argv 에 도움말 요청이 들어 있나. 명령 판정보다 **먼저** 봐야 한다. */
function wantsHelp(argv) {
  return argv.includes('--help') || argv.includes('-h')
}

/** 그 파일의 머리 주석을 사용법 텍스트로 읽어 온다. */
function usageOf(file) {
  return extractUsage(readFileSync(file, 'utf8'))
}

/** 도움말 요청이면 사용법만 찍고 끝낸다 — 다른 일은 하지 않는다. */
function helpIfAsked(file, argv = process.argv.slice(2)) {
  if (!wantsHelp(argv)) return false
  console.log(usageOf(file))
  process.exit(0)
}

module.exports = { extractUsage, usageOf, wantsHelp, helpIfAsked }
