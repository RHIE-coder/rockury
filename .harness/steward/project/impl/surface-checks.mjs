#!/usr/bin/env node
// surface-checks — surface-verify 판정기 (steward 계약). 커밋 훅(surface-gate.mjs)이
//   `node surface-checks.mjs <record>` 로 직접 재실행해 통과를 기계로 확인한다
//   (에이전트의 "통과했다" 주장을 안 믿는다).
//   순수 검사 로직은 e2e/surface/checks.mjs 에 있고(vitest 로 테스트됨), 여기선 얇게 부른다 —
//   판정 로직과 그 테스트가 앱 테스트 글롭(e2e/**) 안에 함께 살도록.
//   입력: 어댑터(e2e/surface/verify.mjs)가 남긴 기록 JSON — CaptureResult[] 또는 {captures,baseline?}.
//   출력(stdout): { status, blockingCount, findings, caveats }.  종료: 0 통과 · 1 차단 · 2 검증불가.
import { readFileSync } from 'node:fs'
import { runChecks, exitCodeFor } from '../../../../e2e/surface/checks.mjs'

const recordPath = process.argv[2]
if (!recordPath) {
  console.error('사용법: node surface-checks.mjs <surface-verify.json>')
  process.exit(2)
}

let data
try {
  data = JSON.parse(readFileSync(recordPath, 'utf8'))
} catch (e) {
  console.log(JSON.stringify({ status: 'cannot-verify', blockingCount: 0, findings: [], caveats: ['기록을 읽거나 파싱할 수 없음: ' + e.message] }))
  process.exit(2) // 검증불가 ≠ 통과
}

const captures = Array.isArray(data) ? data : (data.captures ?? [])
const baseline = Array.isArray(data) ? [] : (data.baseline ?? [])
const result = runChecks(captures, { baseline })
console.log(JSON.stringify(result))
process.exit(exitCodeFor(result.status))
