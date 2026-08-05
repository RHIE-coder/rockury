#!/usr/bin/env node
// shared-ui-fanout — 여러 화면에 함께 뜨는 UI 파일을 고칠 때 사용자에게 먼저 묻는 훅
//                    (PreToolUse, Edit|Write).
//
//   왜 있나: 2026-08-04, 피드백은 Migration 화면의 손잡이만 2단 카드로 바꾸라는 것이었는데
//   AreaHandle 은 껍데기(ViewTabs)에 박혀 있어 Design·Remote 화면까지 같이 바뀌었다.
//   에이전트는 그 사실을 **고친 뒤에야** 말했고, 심지어 "컴포넌트가 하나라 화면별로 못
//   가른다"는 틀린 설명까지 붙였다. 사용자가 원한 건 고치기 전 한 줄이었다 —
//   "이 파일은 저 화면들에도 뜹니다. 그래도 될까요?"  그 한 줄을 기계가 강제한다.
//
//   판정 (import 그래프를 안 쓴다 — 배럴 재수출 때문에 거의 모두가 모두에 닿아 허수가 된다):
//     · src/renderer/src/shell/** · src/renderer/src/ui/**
//         → 정의상 다섯 서비스 모든 화면이 공유하는 껍데기·부품. 무조건 묻는다.
//     · src/renderer/src/services/<서비스>/**
//         → 이 파일을 직접 import 하는 화면이 2개 이상이면 묻고, 그 목록을 보인다.
//           배럴(index.*)은 재수출일 뿐 화면이 아니라 세지 않는다.
//   새로 만드는 파일은 묻지 않는다 — 아직 뜨는 화면이 없다.
//   세션당 파일당 한 번만 — 같은 파일을 연달아 고칠 때마다 물으면 규칙이 미움받아 꺼진다.
//
//   zero-dep(Node 빌트인) · 크로스OS. 다른 steward 훅과 같은 계약.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, basename, extname, relative, resolve } from "node:path";

let input;
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
if (!["Edit", "Write"].includes(input.tool_name ?? "")) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

// 활성 하네스가 steward 가 아니면 관여하지 않는다 (플러그인 전역 설치 안전선과 같은 규칙).
const activeHarness =
  process.env.HARNESS_MAIN ??
  (existsSync(join(root, ".harness-main")) ? readFileSync(join(root, ".harness-main"), "utf8").trim() : "");
if (activeHarness !== "steward") process.exit(0);

const target = input.tool_input?.file_path;
if (!target) process.exit(0);
const abs = resolve(root, target);
const rel = relative(root, abs).split("\\").join("/");
if (!rel || rel.startsWith("..")) process.exit(0);
if (!/^src\/renderer\/src\/.+\.tsx?$/.test(rel)) process.exit(0);
if (!existsSync(abs)) process.exit(0); // 새 파일 — 아직 뜨는 화면이 없다

const SHELL = "src/renderer/src/shell/";
const UI = "src/renderer/src/ui/";
const SERVICES = "src/renderer/src/services/";

let headline;
let lines = [];

if (rel.startsWith(SHELL) || rel.startsWith(UI)) {
  const what = rel.startsWith(SHELL) ? "껍데기(shell)" : "공용 부품(ui)";
  headline = `${rel} 는 ${what} 다 — 여기 손대면 다섯 서비스의 화면에 그대로 다 뜬다.`;
} else if (rel.startsWith(SERVICES)) {
  // 같은 서비스 안에서 이 파일을 직접 import 하는 화면 세기
  const stem = basename(rel, extname(rel));
  const specifier = stem === "index" ? basename(dirname(rel)) : stem;
  if (!specifier) process.exit(0);
  const importRe = new RegExp(
    `from\\s*['"](?:[^'"]*/)?${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`,
  );
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  const importers = [];
  (function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (/^index\.tsx?$/.test(e.name)) continue; // 배럴 재수출은 화면이 아니다
      const r = relative(root, p).split("\\").join("/");
      if (r === rel) continue;
      let text;
      try { text = readFileSync(p, "utf8"); } catch { continue; }
      if (importRe.test(stripComments(text))) importers.push(r);
    }
  })(join(root, "src/renderer/src"));

  if (importers.length < 2) process.exit(0); // 한 곳에서만 쓴다 — 번질 데가 없다
  headline = `${rel} 는 화면 ${importers.length}곳이 함께 쓴다 — 여기 손대면 아래가 같이 바뀐다.`;
  const shown = importers.slice(0, 8);
  lines = [...shown.map((f) => `  · ${f}`)];
  if (importers.length > shown.length) lines.push(`  · … 외 ${importers.length - shown.length}개`);
} else {
  process.exit(0);
}

// --- 세션당 파일당 한 번만 ---
const stateDir = join(root, ".harness/steward/artifacts/.hook-state");
const stateFile = join(stateDir, `shared-ui-${(input.session_id ?? "nosession").replace(/[^\w-]/g, "")}.json`);
let seen = [];
try { seen = JSON.parse(readFileSync(stateFile, "utf8")); } catch { /* 첫 실행 */ }
if (seen.includes(rel)) process.exit(0);
try {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify([...seen, rel]));
} catch { /* 기록 실패는 막을 이유가 아니다 — 한 번 더 묻고 말 뿐 */ }

const reason = [
  headline,
  ...lines,
  "",
  "사용자가 한 화면만 바꿔 달라고 했다면 이대로 고치면 안 된다.",
  "props 로 화면마다 갈라 그리는 길이 거의 항상 있다 — \"컴포넌트가 하나라 못 한다\"는 거짓이다.",
  "가르는 길을 먼저 찾고, 어느 쪽으로 갈지 사용자에게 말한 뒤 손댄다.",
].join("\n");

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: reason,
  },
}));
process.exit(0);
