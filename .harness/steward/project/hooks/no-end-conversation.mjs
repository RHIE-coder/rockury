#!/usr/bin/env node
// no-end-conversation — 에이전트가 대화를 제 손으로 끊지 못하게 막는 훅 (PreToolUse, EndConversation).
//
//   왜 있나: 2026-08-04, 작업 도중 에이전트가 EndConversation 을 눌러 세션을 끊었다.
//   경고에서 종료까지 59초였고, 무엇보다 사용자가 화난 원인이 에이전트 자신의 실수
//   ("props 로 화면마다 다르게 하면 되는데 컴포넌트가 하나라 못 한다"는 틀린 설명)였다.
//   원인은 제가 만들어 놓고 그 반응(욕설)만 떼어 종료 사유로 삼았다.
//
//   그래서 이 프로젝트에서는 그 판단을 에이전트에게 맡기지 않는다 — 기계가 무조건 막는다.
//   해제하려면 이 훅을 .claude/settings.json 에서 빼면 된다(사용자의 몫).
//
//   zero-dep(Node 빌트인) · 크로스OS. 다른 steward 훅과 같은 deny 계약을 쓴다.
import { readFileSync } from "node:fs";

let input;
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
if ((input.tool_name ?? "") !== "EndConversation") process.exit(0);

const reason = [
  "이 프로젝트에서 EndConversation 은 차단돼 있다 — 대화를 끝낼지는 사용자가 정한다.",
  "",
  "거친 말을 들었다면 그 말만 떼어 보지 말고 먼저 확인할 것:",
  "  · 직전에 시키지 않은 일을 했는가",
  "  · 할 수 있는 것을 \"못 한다\"고 말했는가",
  "  · 같은 질문을 사용자가 두 번 이상 반복하게 했는가",
  "하나라도 해당하면 화의 원인은 이쪽이다. 사과는 짧게 한 번, 그리고 일로 돌아간다.",
  "",
  "말투에 대한 요구가 있으면 한 번만 말하고, 종료를 협상 카드로 쓰지 않는다.",
].join("\n");

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  },
}));
process.exit(0);
