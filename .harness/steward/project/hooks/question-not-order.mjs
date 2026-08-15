#!/usr/bin/env node
// question-not-order — 사용자의 **물음**을 지시로 알아듣고 곧장 파일을 고치는 것을 막는 훅
//                      (PreToolUse, Edit|Write|NotebookEdit).
//
//   왜 있나: 2026-08-13, 사용자가 "그러니까 그냥 없애면 되는거냐고"라고 물었다. 답은
//   "네, 없애면 됩니다. 진행할까요?" 한 줄이어야 했는데, 에이전트는 "바로 한다"며 아홉 개
//   파일을 고쳤다. 앞선 두 턴도 물음이었다("갑자기 또 기준선을 살린다고?"). 사용자가
//   답답해하는 말투를 **승인**으로 잘못 읽은 것이다 — 답답함은 승인이 아니다.
//
//   "물음엔 답, 지시엔 실행"은 이미 항상 지키는 규칙에 글로 있었다. 글로 있어도 안 지켜졌으니
//   기계로 내린다.
//
//   판정 (마지막 사용자 발화의 **끝 문장**만 본다 — 요청의 결론이 거기 있다):
//     · 어미형 물음(…냐고 · …되나 · …인가 · …맞아 …)  → 무조건 멈춘다.
//         지시 어미가 섞여 있어도 멈춘다. "없애면 되는거냐고"의 "없애"는 조건절이지 지시가 아니다.
//     · `?` 로 끝남 + 끝에 지시 어미 없음(…필요해? · …왜 이래?) → 멈춘다.
//     · `?` 로 끝남 + 끝이 지시 어미(…고쳐줄래? · …지워줄 수 있어?) → 통과. 이건 부탁이다.
//     · 슬래시 커맨드 호출 → 통과. 커맨드는 그 자체가 지시다.
//   멈춤은 차단이 아니라 `ask` 다 — 사용자가 그 자리에서 승인하면 그대로 간다.
//   **세션당 발화당 한 번만** 묻는다. 승인 뒤 파일마다 또 물으면 규칙이 미움받아 꺼진다.
//
//   zero-dep(Node 빌트인) · 크로스OS. 다른 steward 훅과 같은 계약.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 끝이 물음인가 — `?` 없이 어미만으로 묻는 한국어를 따로 잡는다(`…되는거냐고`). */
const ASKS_BY_ENDING =
  /(?:냐고|느냐|나요|가요|까요|을까|ㄹ까|는가|은가|인가|건가|되나|되냐|맞아|맞나|맞지|어때|어떤가|뭐야|뭔데|뭐지|왜지|아닌가|없나|있나|해야하나|해야 하나)\s*[.…!~]*$/;

/**
 * 끝이 부탁·지시인가. **종결 위치에서만** 본다 —
 * "고쳐야 하나?"의 '고쳐'까지 지시로 세면 이 가드가 통째로 헐거워진다.
 */
const ENDS_WITH_ORDER =
  /(?:줘|줄래|주라|주세요|주실래|달라|해라|하자|해봐|봐줘|줄 수 있어|해 줄래|가자|고고|ㄱㄱ|진행해|시작해|정리해|적용해|수정해|반영해|추가해|삭제해|실행해|고쳐|지워|바꿔|없애|만들어|해도 돼|해도돼|go ahead|do it|fix it|just do it|proceed)\s*[.?!…~]*$/i;

/** 사용자에게 보이지 않는 껍데기(도구 결과·리마인더·커맨드 출력)를 걷어낸다. */
function cleanUserText(content) {
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((p) => p && p.type === "text" && typeof p.text === "string")
            .map((p) => p.text)
            .join("\n")
        : "";
  return raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .trim();
}

/** 판정 — 이 발화에서 곧장 파일을 고쳐도 되나. */
export function shouldPause(text) {
  if (!text) return false;
  if (/<command-name>/.test(text)) return false; // 슬래시 커맨드는 그 자체가 지시다

  // 끝 문장만 본다. 앞은 사정 설명이고 요청의 결론은 마지막에 온다.
  const sentences = text.split(/(?<=[.!?。？！\n])\s*/).filter((s) => s.trim());
  const last = (sentences[sentences.length - 1] ?? text).trim();
  if (!last) return false;

  if (ASKS_BY_ENDING.test(last)) return true; // 어미형 물음 — 지시 어미가 섞여도 물음이다
  if (!/[?？]\s*$/.test(last)) return false; // 물음표도 물음 어미도 없다 → 평서·지시
  return !ENDS_WITH_ORDER.test(last); // "고쳐줄래?" 는 부탁이라 통과
}

/** 트랜스크립트에서 **마지막 실제 사용자 발화**를 꺼낸다(도구 결과 턴은 건너뛴다). */
function lastUserSay(transcriptPath) {
  let lines;
  try {
    lines = readFileSync(transcriptPath, "utf8").split("\n");
  } catch {
    return "";
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (row?.type !== "user" || row?.message?.role !== "user") continue;
    const text = cleanUserText(row.message.content);
    if (text) return text;
  }
  return "";
}

// --- 훅 본체 (import 로 불릴 때는 안 돈다 — 테스트가 판정만 가져다 쓴다) ---
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  if (!["Edit", "Write", "NotebookEdit"].includes(input.tool_name ?? "")) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

  // 활성 하네스가 steward 가 아니면 관여하지 않는다 (플러그인 전역 설치 안전선과 같은 규칙).
  const activeHarness =
    process.env.HARNESS_MAIN ??
    (existsSync(join(root, ".harness-main"))
      ? readFileSync(join(root, ".harness-main"), "utf8").trim()
      : "");
  if (activeHarness !== "steward") process.exit(0);

  const say = lastUserSay(input.transcript_path ?? "");
  if (!shouldPause(say)) process.exit(0);

  // --- 세션당 발화당 한 번만 ---
  const key = createHash("sha1").update(say).digest("hex").slice(0, 12);
  const stateDir = join(root, ".harness/steward/artifacts/.hook-state");
  const stateFile = join(
    stateDir,
    `question-${(input.session_id ?? "nosession").replace(/[^\w-]/g, "")}.json`,
  );
  let seen = [];
  try {
    seen = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    /* 첫 실행 */
  }
  if (seen.includes(key)) process.exit(0);
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify([...seen, key]));
  } catch {
    /* 기록 실패는 막을 이유가 아니다 — 한 번 더 묻고 말 뿐 */
  }

  const quoted = say.length > 120 ? `${say.slice(0, 120)}…` : say;
  const reason = [
    "사용자의 마지막 말은 **물음**으로 끝난다 — 아직 고치라는 지시가 아니다.",
    "",
    `  “${quoted}”`,
    "",
    "물음엔 답이 산출물이다. 답부터 하고, 고칠지는 사용자가 정한다.",
    "  · 물은 것에 먼저 답한다 (그렇다/아니다 + 근거).",
    "  · 할 일이 보이면 한 줄로 내민다 — \"○○ 지금 할까요?\"",
    "  · 승인을 받은 뒤에 손댄다.",
    "",
    "답답해하는 말투는 승인이 아니다. 되묻기 싫어서 그냥 시작하면 같은 실수가 반복된다.",
    "정말 지시로 읽었다면 이 물음을 승인하고 그대로 진행하면 된다.",
  ].join("\n");

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}
