#!/usr/bin/env node
// steward validator — .harness/steward/config.yaml(Config) + steward/project/phases/ 를 계약(contract §4)으로 점검.
// 소유본: .harness/steward/project/impl/validate.mjs (steward 회귀 가드 포함 — canonical 에 없는 것).
//   build-skills 재빌드가 .harness/steward/core/validate.mjs 사본을 canonical 로 덮으므로,
//   finish-build 가 이 소유본을 사본으로 복원한다. 수정은 반드시 이 소유본에.
// 사용법: node validate.mjs [--check] [path/to/.harness/steward/config.yaml]   (기본: .harness/steward/config.yaml)
//   --check: 읽기 전용 — 검사만 하고 lock.json 을 갱신하지 않는다 (훅 등 관찰자용).
// 종료코드: 오류 0건이면 0, 있으면 1, config 없으면 2.
// 셸·외부 의존 없음(Node 빌트인만) → mac·linux·windows 동일.
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const c = { r: "\x1b[31m", y: "\x1b[33m", g: "\x1b[32m", d: "\x1b[2m", x: "\x1b[0m" };
let errors = 0, warns = 0;
const err = (m) => { console.log(`  ${c.r}✗${c.x} ${m}`); errors++; };
const warn = (m) => { console.log(`  ${c.y}⚠${c.x} ${m}`); warns++; };
const ok = (m) => { console.log(`  ${c.g}✓${c.x} ${m}`); };

// YAML 스칼라 값에서 인라인 주석(#)을 떼되 따옴표 안의 #는 보존(build-skills.mjs 와 동치 — parity 검사기가 강제).
function stripComment(s) {
  let inS = false, inD = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    else if (ch === "#" && !inS && !inD) {
      if (i === 0 || /\s/.test(s[i - 1])) return s.slice(0, i);
    }
  }
  return s;
}
const clean = (s) => stripComment(s).trim().replace(/^["']|["']$/g, "");
const splitList = (s) => stripComment(s).replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);

const DUMP_CFG = process.env.PARSECONFIG_DUMP || null; // 동치 검사용: parseConfig 결과만 덤프하고 종료(아래 훅)
const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes("--check"); // 읽기 전용 — 검사기가 검사 중 상태를 바꾸지 않는다
const cfgPath = argv.find((a) => a !== "--check") ?? ".harness/steward/config.yaml";
let stewardDir = null, harnessDir = null, ROOT = null, raw = null;
if (!DUMP_CFG) {
  console.log(`steward validate → ${cfgPath}`);
  if (!existsSync(cfgPath)) { err("config.yaml 없음"); process.exit(2); }
  stewardDir = dirname(cfgPath);
  harnessDir = dirname(stewardDir);
  ROOT = dirname(harnessDir);
  raw = readFileSync(cfgPath, "utf8");
}

// ---------- config.yaml 파서 (라인 기반, 이 양식 전용) ----------
// (build-skills.mjs 의 parseConfig 와 동치 — bindings/impl 블록 파싱을 둘 다에 똑같이 둔다.)
function parseConfig(text) {
  const lines = text.split(/\r?\n/);
  const cfg = { scalars: {}, values: {}, bindings: {}, impl: {}, phases: [] };
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === "" || /^\s*#/.test(l)) { i++; continue; }
    if (/^phases:\s*(#.*)?$/.test(l)) { i = parsePhases(lines, i + 1, cfg); continue; }
    if (/^values:\s*(#.*)?$/.test(l)) { i = parseBlock(lines, i + 1, cfg.values); continue; }
    if (/^bindings:\s*(#.*)?$/.test(l)) { i = parseBlock(lines, i + 1, cfg.bindings); continue; }
    if (/^impl:\s*(#.*)?$/.test(l)) { i = parseBlock(lines, i + 1, cfg.impl); continue; }
    const m = l.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m && m[2].trim() !== "") cfg.scalars[m[1]] = clean(m[2]);
    i++;
  }
  return cfg;
}
// 1-depth 평평한 블록(`키: 값` 한 줄들)을 target 맵에 채운다. values·bindings·impl 공용.
function parseBlock(lines, i, target) {
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === "" || /^\s*#/.test(l)) { i++; continue; }
    if (!/^\s+/.test(l)) break;
    const m = l.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) target[m[1]] = clean(m[2]);
    i++;
  }
  return i;
}
function parsePhases(lines, i, cfg) {
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === "" || /^\s*#/.test(l)) { i++; continue; }
    if (!/^\s+-/.test(l)) break;
    const v = (l.match(/^\s*-\s*(.+?)\s*$/) || [])[1];
    if (!v) { i++; continue; }
    if (/^loop:/.test(v)) {
      const loop = { type: "loop", do: [], until: null, max: null };
      const inline = v.match(/\{(.+)\}/);
      if (inline) {
        const dm = inline[1].match(/do:\s*\[([^\]]*)\]/); if (dm) loop.do = splitList(dm[1]);
        const um = inline[1].match(/until:\s*"([^"]*)"|until:\s*'([^']*)'|until:\s*([^,}]+)/); if (um) loop.until = (um[1] ?? um[2] ?? um[3]).trim();
        const mm = inline[1].match(/max:\s*(\d+)/); if (mm) loop.max = +mm[1];
        i++;
      } else {
        const base = l.search(/\S/); i++;
        while (i < lines.length && (lines[i].trim() === "" || lines[i].search(/\S/) > base)) {
          const dm = lines[i].match(/do:\s*\[([^\]]*)\]/); if (dm) loop.do = splitList(dm[1]);
          const um = lines[i].match(/^\s*until:\s*(.+)$/); if (um) loop.until = clean(um[1]);
          const mm = lines[i].match(/max:\s*(\d+)/); if (mm) loop.max = +mm[1];
          i++;
        }
      }
      cfg.phases.push(loop);
    } else if (/^\{/.test(v)) {
      const nm = v.match(/name:\s*([^,}\s]+)/);
      const sm = v.match(/sync:\s*([^,}\s]+)/);
      cfg.phases.push({ type: "card", name: nm ? nm[1] : null, sync: sm ? sm[1] : null });
      i++;
    } else {
      cfg.phases.push({ type: "card", name: clean(v) });
      i++;
    }
  }
  return i;
}

// 동치 검사 훅: PARSECONFIG_DUMP=<config> 면 parseConfig 결과만 JSON 으로 찍고 종료.
//   (bin/check-parseconfig-parity.mjs 가 build-skills.mjs 의 parseConfig 와 동작 일치를 자식 프로세스로 대조.)
if (DUMP_CFG) {
  process.stdout.write(JSON.stringify(parseConfig(readFileSync(DUMP_CFG, "utf8"))));
  process.exit(0);
}

// ---------- phase 파일 frontmatter 파서 ----------
// requires 항목 한 개를 {key, optional, kind} 로 푼다. `:capability` 접미사 = 능력-빈자리, 없으면 값-빈자리.
// (`needs:` 는 값-빈자리의 옛 이름 — 파서에서 같은 풀로 흡수한다.)
function parseRequire(token) {
  const optional = /\?$/.test(token);
  let key = token.replace(/\?$/, "");
  let kind = "value";
  if (/:capability$/.test(key)) { kind = "capability"; key = key.replace(/:capability$/, ""); }
  return { key, optional, kind };
}
// phase 소스 위치 해석 (`core:` 적재 배선 — build-skills.mjs 의 phaseSourceFile 과 *동치*여야 한다).
//   - `core:` 없으면(단독 하네스): .harness/steward/project/phases/<name>.md 만.
//   - `core: <name>` 있으면(재사용 모드): 1) steward/project/phases/<name>.md(있으면 오버라이드 우선) →
//       2) <root 에서 위로 탐색>/.agentoppa/plugins/<core>/phases/<name>.md(Core 묶음이 든 phase 소스).
//   root = dirname(dirname(stewardDir)) (stewardDir=<root>/.harness/steward).
//   위로 탐색하는 이유: 한 Core 묶음을 여러 프로젝트가 공유(가리켜 재사용)하면 공통 상위에 한 벌 → 단일소스.
function kebab(s) { return String(s).trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""); }
function findCorePhasesDir(startDir, core) {
  let dir = resolve(startDir);
  for (;;) {
    const cand = join(dir, ".agentoppa", "plugins", core, "phases");
    if (existsSync(cand)) return cand;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
function phaseSourceFile(name) {
  const local = join(stewardDir, "project", "phases", `${name}.md`);
  if (existsSync(local)) return local;
  const core = C && C.scalars && C.scalars.core ? kebab(C.scalars.core) : null;
  if (core) {
    const dir = findCorePhasesDir(ROOT, core); // <root> 에서 위로.
    if (dir) {
      const fromCore = join(dir, `${name}.md`);
      if (existsSync(fromCore)) return fromCore;
    }
  }
  return null;
}
function parsePhase(name) {
  const file = phaseSourceFile(name);
  if (!file) return null;
  const fm = readFileSync(file, "utf8").match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const card = { name, consumes: [], produces: null, requires: [], hasWorkers: false };
  if (!fm) return card;
  for (const l of fm[1].split(/\r?\n/)) {
    let m;
    if ((m = l.match(/^produces:\s*(.+)$/))) { const x = clean(m[1]); card.produces = (x === "~" || x === "") ? null : x; }
    // consumes: ~ (YAML null = 아무것도 안 받음) · 빈값 → 빈 리스트. produces 가드와 대칭(안 그러면 팬텀 역할 '~' 생김).
    else if ((m = l.match(/^consumes:\s*(.+)$/))) { const x = clean(m[1]); card.consumes = (x === "~" || x === "") ? [] : splitList(m[1]).map((r) => ({ role: r.replace(/\?$/, ""), optional: /\?$/.test(r) })); }
    // requires 와 needs(옛 이름) 둘 다 requires 풀로 모은다. needs 항목은 항상 값-빈자리(kind:"value").
    else if ((m = l.match(/^requires:\s*(.+)$/))) card.requires.push(...splitList(m[1]).map(parseRequire));
    else if ((m = l.match(/^needs:\s*(.+)$/))) card.requires.push(...splitList(m[1]).map((r) => ({ ...parseRequire(r), kind: "value" })));
    else if (/^workers:\s*$/.test(l)) card.hasWorkers = true;
  }
  return card;
}

const C = parseConfig(raw);
if (C.scalars.core !== "steward") {
  err("이 검증기는 steward 전용이다 — .harness/steward/config.yaml 의 core 가 steward 가 아니므로 중단");
}

// 줄단위 파서가 조용히 먹는 미지원 YAML 문법 사전 차단(조용한 누락 방지).
//   블록 스칼라(|·>)는 멀티라인이라 이 양식 파서는 마커만 값으로 먹고 본문 줄을 흘린다 → error 로 알린다.
//   (이 config 는 한 줄 스칼라·1-depth 블록·phases 리스트 전용. 멀티라인이 필요하면 한 줄+따옴표로.)
raw.split(/\r?\n/).forEach((l, li) => {
  if (/^\s*[A-Za-z_][\w-]*:\s*[|>][+-]?\d*\s*(#.*)?$/.test(l))
    err(`${li + 1}행 블록 스칼라(|·>) 미지원 — 파서가 한 줄 값만 읽어 본문이 조용히 누락된다. 한 줄로 쓰거나 따옴표로: '${l.trim()}'`);
});

// --- steward 회귀 가드 ---
// 무시해야 하는 설계 초안 참조와 작업 바통 main 고정을 다시 들이지 않게 막는다.
const ignoredDoc = "about-" + "steward";
const fixedArtifactDir = ".harness/steward/artifacts/" + "main";
function listFiles(p, out = []) {
  if (!existsSync(p)) return out;
  const entries = readdirSync(p, { withFileTypes: true });
  for (const ent of entries) {
    const fp = join(p, ent.name);
    if (ent.isDirectory()) {
      if ([".git", "node_modules", "dist"].includes(ent.name)) continue;
      listFiles(fp, out);
    } else {
      out.push(fp);
    }
  }
  return out;
}
const scanRoots = [
  join(ROOT, ".harness"),
  join(ROOT, ".agentoppa", "plugins", "steward"),
  join(ROOT, "docs", "steward"),
  join(ROOT, "AGENTS.md"),
  join(ROOT, "CLAUDE.md"),
];
const scanFiles = [];
for (const p of scanRoots) {
  if (!existsSync(p)) continue;
  if (p.endsWith(".md")) scanFiles.push(p);
  else listFiles(p, scanFiles);
}
if (existsSync(join(ROOT, ignoredDoc + ".md"))) err(`${ignoredDoc}.md 는 steward 정본이 아니므로 레포 루트에 두지 않는다`);
// 자기 자신 판별 — import.meta.filename 은 Node 20.11 미만에서 undefined 라 가드가
// 조용히 꺼진다. fileURLToPath 폴백으로 어떤 Node 에서도 SELF 가 잡히게 한다.
const SELF = resolve(import.meta.filename ?? fileURLToPath(import.meta.url));
const ownValidate = resolve(ROOT, ".harness", "steward", "project", "impl", "validate.mjs");
const artifactsPrefix = resolve(ROOT, ".harness", "steward", "artifacts") + sep;
for (const file of scanFiles) {
  const fp = resolve(file);
  if (fp === SELF) continue;
  // 소유본 스캔 제외 — 금지 문자열은 연결로 회피돼 있고, 아래 동기 가드는 사본과의
  // 바이트 동일성만 본다(금지 문자열 스캔이 아니다).
  if (fp === ownValidate) continue;
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  if (text.includes(ignoredDoc)) err(`무시 문서 참조 금지: ${file}`);
  // 바통 경로 고정 금지는 스킬·정본·훅에 대한 가드다 — 런타임 바통 문서(작업 산출물)는
  // 자기 경로를 서술할 수 있으므로 이 검사에서 제외한다.
  if (fp.startsWith(artifactsPrefix)) continue;
  if (text.includes(fixedArtifactDir)) err(`작업 바통 경로 main 고정 금지: ${file}`);
}
// validate 소유본-사본 동기 가드 — 사본(.harness/steward/core/validate.mjs)을 직접 고치면 다음
// 재빌드(canonical 덮어쓰기)가 지운다. 어긋나면 소유본을 고치고 finish-build 로 반영하라.
if (existsSync(ownValidate) && SELF !== ownValidate) {
  if (readFileSync(SELF, "utf8") !== readFileSync(ownValidate, "utf8"))
    err("validate.mjs 사본이 소유본(.harness/steward/project/impl/validate.mjs)과 다름 — 수정은 소유본에, 반영은 finish-build 로");
}
for (const rules of [
  join(ROOT, ".agentoppa", "plugins", "steward", "steward-rules.md"),
  join(stewardDir, "project", "hooks", "steward-rules.md"),
]) {
  if (!existsSync(rules)) continue;
  const text = readFileSync(rules, "utf8");
  if (!text.includes("첫 응답의 첫 줄은 반드시 판정 태그"))
    err(`경로 판정 자기 점검 문구 없음: ${rules}`);
  if (!text.includes("[consult]"))
    err(`작업 아님 판정 태그 [consult] 없음: ${rules}`);
}
// 훅 배선 가드 — "재빌드 후 finish-build 누락"을 잡는다. build-skills 는 묶음의 hooks.json 을
// 기본 게이트(gate-review)로 덮고 always-on.md 를 AgentOppa 정본으로 되돌리므로,
// 묶음이 있는 한 steward 훅 배선·규칙 소유가 온전해야 한다.
const bundleDir = join(ROOT, ".agentoppa", "plugins", "steward");
if (existsSync(bundleDir)) {
  const hooksJsonPath = join(bundleDir, "hooks", "hooks.json");
  if (!existsSync(hooksJsonPath)) err(`묶음에 hooks/hooks.json 없음 — finish-build.mjs 미실행?: ${hooksJsonPath}`);
  else {
    const hooksText = readFileSync(hooksJsonPath, "utf8");
    for (const needed of ["inject-steward-rules.mjs", "gate-commit.mjs"])
      if (!hooksText.includes(needed))
        err(`hooks.json 이 ${needed} 를 안 가리킴 — build-skills 가 기본 게이트로 덮은 상태. finish-build.mjs 로 복구하라`);
  }
  if (existsSync(join(bundleDir, "hooks", "gate-review.mjs")))
    err("기본 가드 gate-review.mjs 잔존 — steward 미사용 훅. finish-build.mjs 가 제거한다");
  if (!existsSync(join(bundleDir, "steward-rules.md")))
    err("묶음 루트에 steward-rules.md 없음 — finish-build.mjs 로 복구하라");
  // setup 동봉 검증기 동기 가드 — scaffold 가 소비 프로젝트에 까는 사본이 소유본과 어긋나면
  // "AgentOppa 없이 자급" 경로가 구식 검증기를 배포하게 된다.
  const bundledValidate = join(bundleDir, "skills", "setup", "validate.mjs");
  if (!existsSync(bundledValidate))
    err("Core 동봉 검증기 없음(skills/setup/validate.mjs) — setup 자급이 깨진다. finish-build.mjs 로 동기화하라");
  else if (existsSync(ownValidate) && readFileSync(bundledValidate, "utf8") !== readFileSync(ownValidate, "utf8"))
    err("Core 동봉 검증기(skills/setup/validate.mjs)가 소유본과 다름 — finish-build.mjs 로 동기화하라");
  const alwaysOnPath = join(bundleDir, "always-on.md");
  if (existsSync(alwaysOnPath) && readFileSync(alwaysOnPath, "utf8").includes("AgentOppa 플러그인이 깔린 세션이면"))
    err("always-on.md 가 AgentOppa 정본 그대로(주어 미정정) — finish-build.mjs 가 steward 소유본으로 되돌린다");
  // 단계 스킬은 작업 바통 폴더를 실행 시점에 정한다({artifact_dir} 산문 — cb9923b 강화).
  // 빌더가 컴파일 시점 feature 로 경로를 박으면(이름이 main·default 뭐든) 재빌드 회귀 — 잡는다.
  const skillsRoot = join(bundleDir, "skills");
  if (existsSync(skillsRoot)) {
    for (const f of listFiles(skillsRoot)) {
      if (!f.endsWith(".md")) continue;
      const m = readFileSync(f, "utf8").match(/\.harness\/steward\/artifacts\/(?!<작업이름>)[A-Za-z0-9_-]+\//);
      if (m) err(`단계 스킬에 작업 바통 경로가 컴파일 시점 이름으로 박힘(${m[0]}) — 빌더 회귀. 런타임 결정 산문으로 되돌리라: ${f}`);
    }
  }
  // 선택 능력 꼬리 문구 회귀 가드 — 빌더가 선택(?) 능력에도 "못 찾으면 멈춤" 정형 문구를
  // emit 하면 본문의 "미바인딩이면 건너뛰되 명시"와 모순된다(점검 지적 2번). 선택 능력은
  // "건너뜀+미바인딩 명시"여야 한다.
  const ifacePath = join(bundleDir, "interface.json");
  if (existsSync(ifacePath) && existsSync(skillsRoot)) {
    try {
      const iface = JSON.parse(readFileSync(ifacePath, "utf8"));
      const optCaps = (iface.capabilities || []).filter((c) => c.optional).map((c) => c.key);
      for (const f of listFiles(skillsRoot)) {
        if (!f.endsWith(".md")) continue;
        const t = readFileSync(f, "utf8");
        for (const k of optCaps)
          if (t.includes(`바인딩 없음: ${k}`))
            err(`선택 능력 '${k}'에 "못 찾으면 멈춤" 꼬리 문구 잔존(빌더 회귀) — "건너뜀+미바인딩 명시"로 되돌리라: ${f}`);
      }
    } catch {
      warn(`interface.json 파싱 실패 — 선택 능력 꼬리 문구 가드 건너뜀: ${ifacePath}`);
    }
  }
}

// --- 스칼라 ---
const sync = C.scalars.sync ?? "medium";
if (["loose", "medium", "strict"].includes(sync)) ok(`sync=${sync}`);
else warn(`sync '${sync}' — loose|medium|strict 권장`);
if (C.scalars.routing && !["budget", "balanced", "premium"].includes(C.scalars.routing))
  warn(`routing '${C.scalars.routing}' — budget|balanced|premium 권장`);

// --- phases 펼침 + loop 점검 ---
const seq = [];
for (const p of C.phases) {
  if (p.type === "loop") {
    if (!p.do.length) err("loop에 do[] 없음");
    if (!p.until) err("loop에 until 없음");
    for (const n of p.do) { if (n === "loop") err("loop 중첩 금지 (v1)"); seq.push(n); }
  } else if (!p.name) err("phase 항목에 name 없음");
  else seq.push(p.name);
}
if (!seq.length) err("phases 비어 있음");
else ok(`phases ${seq.length}단계: ${seq.join(" → ")}`);

// --- phase 정의 로드 ---
const cards = {};
for (const name of seq) {
  if (cards[name]) continue;
  const card = parsePhase(name);
  if (!card) warn(`phase '${name}' 정의 없음: steward/project/phases/${name}.md (steward/project/phases 미정의?)`);
  else cards[name] = card;
}

// --- 연결 점검 (contract §4) ---
const produced = new Set(), producedBy = {}, consumed = new Set(), boundCaps = new Set();
for (const name of seq) {
  const card = cards[name];
  if (!card) continue;
  for (const cns of card.consumes) {
    consumed.add(cns.role);
    if (!produced.has(cns.role) && !cns.optional) err(`dangling: '${name}'이 '${cns.role}'를 consumes하는데 앞에서 produces 안 함`);
  }
  if (card.produces) {
    if (produced.has(card.produces)) err(`중복 produces: '${card.produces}' (${producedBy[card.produces]} & ${name})`);
    produced.add(card.produces); producedBy[card.produces] = name;
  }
  // requires 점검 — 값-빈자리는 config.values, 능력-빈자리는 config.bindings(+impl) 가 채워야 한다.
  //   (needs 흡수분 포함. 선택(?) 빈자리는 미충족이어도 통과 — 본문이 '있으면 쓴다'.)
  for (const rq of card.requires) {
    // 선택 빈자리도 '사용 중'으로 먼저 표시 — 안 하면 아래 orphan 바인딩 warn 이 실사용 선택 능력을 오탐한다.
    boundCaps.add(rq.key);
    if (rq.optional) continue;
    if (rq.kind === "value") {
      if (!(rq.key in C.values)) err(`'${name}'의 값-빈자리 '${rq.key}'가 config.values 에 없음`);
      else if (C.values[rq.key] === "") err(`'${name}'의 값-빈자리 '${rq.key}'가 비어 있음`);
    } else { // capability
      if (!(rq.key in C.bindings)) {
        err(`'${name}'의 능력-빈자리 '${rq.key}'가 config.bindings 에 없음 (미바인딩)`);
      } else {
        const impl = C.bindings[rq.key];
        const looksLikeKey = /^[A-Za-z0-9][\w-]*$/.test(impl); // 'playwright' 처럼 단일 토큰 = impl 키 추정.
        if (looksLikeKey && !(impl in C.impl) && !(impl in C.values))
          err(`'${name}'의 능력 '${rq.key}' → '${impl}' 구현 정의 없음 (config.impl 에 '${impl}' 없음)`);
        // 우변이 명령("npx ...")·경로("./.harness/steward/project/impl/..")면 인라인으로 보고 통과.
      }
    }
  }
}
for (const role of produced) if (!consumed.has(role)) warn(`orphan 산출물: '${role}' (${producedBy[role]}) — 아무도 소비 안 함 (종착이면 무시)`);
// orphan 바인딩: config.bindings 에 있는데 어느 phase 의 requires 도 안 가리키는 능력 (종착 orphan 과 동급 — warn).
for (const cap of Object.keys(C.bindings)) if (!boundCaps.has(cap)) warn(`orphan 바인딩: '${cap}' — 어느 phase 의 requires 도 안 가리킴`);

// impl 모듈 frontmatter `provides:` 일치 점검 (엉뚱한 모듈 연결 방지).
//   바인딩이 .md 모듈 경로로 풀리면 그 파일의 provides: 를 능력명과 대조 → 불일치면 warn.
//   파일 미존재는 적재 전일 수 있어 error 아님(부재 단정 금지 가드와 정합) — 그냥 건너뛴다.
for (const cap of boundCaps) {
  if (!(cap in C.bindings)) continue;
  const rhs = C.bindings[cap];
  // 모듈 경로 결정: 우변이 경로면 그것, 단일 토큰이면 impl[토큰] 이 경로일 때.
  const path = /[./]/.test(rhs) ? rhs : (C.impl[rhs] || null);
  if (!path || !/\.md$/.test(path)) continue; // 인라인 명령·.mjs 실행기는 provides 점검 대상 아님.
  const abs = /^\.\/?\.harness\//.test(path) || path.startsWith(".harness/") ? join(ROOT, path.replace(/^\.\//, "")) : join(stewardDir, path);
  if (!existsSync(abs)) continue; // 부재 단정 금지 — 적재 전일 수 있음.
  const pm = readFileSync(abs, "utf8").match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const prov = pm && (pm[1].split(/\r?\n/).map((l) => l.match(/^provides:\s*(.+)$/)).find(Boolean) || [])[1];
  if (prov && clean(prov) !== cap) warn(`impl 모듈 '${path}' 의 provides: '${clean(prov)}' 가 능력 '${cap}' 와 불일치`);
}
if (errors === 0) ok("연결 OK (dangling·중복·requires 빈자리 없음)");

// --- 신선도 (산출물 있을 때만, contract §3) ---
// feature 해석은 contract §1 과 동일(config → git 브랜치 슬러그 → default) — gate-commit.mjs 와 같은 규칙.
function currentFeature() {
  if (C.scalars.feature) return C.scalars.feature;
  const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  const branch = (r.stdout ?? "").trim();
  if (branch && branch !== "HEAD") return branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return "default";
}
const fdir = join(stewardDir, "artifacts", currentFeature());
if (existsSync(fdir)) {
  const lockPath = join(fdir, "lock.json");
  let lock = null;
  if (existsSync(lockPath)) { try { lock = JSON.parse(readFileSync(lockPath, "utf8")); } catch { warn("lock.json 파싱 실패"); } }
  // 현재 지문 수집 — 역할 .md 만 (lock.json 등 비역할 파일 제외).
  const current = {};
  for (const f of readdirSync(fdir)) {
    if (!f.endsWith(".md")) continue;
    current[f.replace(/\.md$/, "")] = createHash("sha256").update(readFileSync(join(fdir, f))).digest("hex").slice(0, 12);
  }
  let stale = 0;
  if (lock) {
    // "입력이 바뀌었는데 산출물이 안 따라감"만 stale — 바뀐 역할에서 consumes 그래프를 따라 연쇄 전파(§3).
    const changed = new Set(Object.keys(current).filter((r) => lock[r] && lock[r] !== current[r]));
    const downstream = {}; // 입력 역할 → 그걸 먹는 phase 들의 produces
    for (const name of seq) {
      const card = cards[name];
      if (!card || !card.produces) continue;
      for (const cns of card.consumes) (downstream[cns.role] ??= []).push(card.produces);
    }
    const reach = new Set();
    const stack = [...changed];
    while (stack.length) {
      const r = stack.pop();
      for (const d of downstream[r] ?? []) if (!reach.has(d)) { reach.add(d); stack.push(d); }
    }
    for (const r of reach) {
      if (changed.has(r)) continue; // 입력과 같이 갱신됨 = 신선
      if (!(r in current)) continue; // 아직 산출 전 — 연결 점검(§4)의 몫
      warn(`stale: '${r}' — 입력이 바뀌었는데 산출물이 안 따라감 (다시 만든 뒤 validate 로 lock 갱신)`);
      stale++;
    }
    if (!stale) ok("신선도 OK (입력 변경을 안 따라간 산출물 없음)");
  }
  // 통과 시 lock 갱신(§3) — 오류·stale 이 남아 있으면 스냅샷을 안 옮긴다(신호 보존).
  // --check 에선 갱신도 안 한다 — 훅처럼 커밋 도중 끼어드는 관찰자가 작업 트리를 바꾸면 안 됨.
  if (!CHECK_ONLY && Object.keys(current).length && errors === 0 && stale === 0) {
    writeFileSync(lockPath, JSON.stringify(current, null, 2) + "\n");
    if (!lock) ok(`lock 초기화: 역할 ${Object.keys(current).length}개 지문 기록`);
  }
}

console.log(`result: ${errors} error(s), ${warns} warning(s)`);
process.exit(errors === 0 ? 0 : 1);
