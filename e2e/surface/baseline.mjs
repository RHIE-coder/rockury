import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 화면 품질 기준선(수용된 findings)의 저장·병합 — **서비스별 파일**로 쪼개 둔다.
 *
 * 한 덩어리 JSON 이던 시절엔 다섯 서비스가 같은 파일을 갱신해 병합 충돌이 났고,
 * 생성물이라 손으로 풀 수도 없었다. 이제 서비스마다 파일 하나라 자기 것만 바뀐다.
 */

/** 서비스 식별자 — nav registry 의 Service.id 와 같은 토큰. */
export const SERVICE_IDS = ['uiux', 'api', 'db', 'infra', 'ai']

/** 어느 서비스에도 안 속하는 findings(부팅 화면 등)가 모이는 파일 이름. */
export const SHELL_KEY = 'shell'

/**
 * finding 의 `formFactor` 첫 마디로 소유 서비스를 정한다 — `db/console/query` → `db`.
 * 서비스 이름이 아니면(`boot` 등) 공용(shell)으로 본다.
 */
export function serviceOf(formFactor) {
  const head = String(formFactor ?? '').split('/')[0]
  return SERVICE_IDS.includes(head) ? head : SHELL_KEY
}

/** findings 를 소유 서비스별로 가른다. 서비스마다 키가 반드시 하나씩 생긴다(빈 배열이라도). */
export function splitByService(findings) {
  const out = {}
  for (const k of [SHELL_KEY, ...SERVICE_IDS]) out[k] = []
  for (const f of findings) out[serviceOf(f.formFactor)].push(f)
  return out
}

/** 서비스별 기준선 파일 전부를 하나로 합친다. 폴더가 없으면 빈 배열(기준선 없음). */
export function loadBaseline(dir) {
  if (!fs.existsSync(dir)) return []
  const merged = []
  // 파일 이름 순으로 읽어 결과 순서를 결정적으로 만든다(디렉터리 순서에 의존하지 않게).
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue
    merged.push(...JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
  }
  return merged
}

/**
 * 기준선을 서비스별 파일로 갈라 쓴다.
 * 빈 서비스도 파일을 남긴다 — 그 서비스 에이전트가 "내 파일은 여기"임을 바로 알 수 있게.
 */
export function writeBaseline(dir, findings) {
  fs.mkdirSync(dir, { recursive: true })
  const groups = splitByService(findings)
  for (const [service, list] of Object.entries(groups)) {
    fs.writeFileSync(path.join(dir, `${service}.json`), JSON.stringify(list, null, 2) + '\n')
  }
  return groups
}
