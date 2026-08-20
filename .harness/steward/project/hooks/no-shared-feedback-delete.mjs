#!/usr/bin/env node
// no-shared-feedback-delete — 워크트리에서 공유 제보 폴더를 지우지 못하게 막는 훅 (PreToolUse, Bash).
//
//   왜 있나: 워크트리의 `.harness/feedback` 은 사본이 아니라 main 폴더 한 자리를 가리키는
//   심볼릭 링크다. 그런데 `AGENTS.md` 는 매 세션 "읽고 고쳤으면 폴더를 지운다"고 말한다 —
//   그 말대로 워크트리에서 지우면 **다른 서비스가 아직 처리 못 한 제보까지 함께** 사라진다.
//   그 폴더는 gitignore 대상이라 되돌릴 커밋이 없다. 병렬 개발 규칙 중 유일하게 복구 불가다.
//
//   그래서 사람 지침이 아니라 기계로 막는다. main 폴더에서는 막지 않는다 — 다 처리한 제보를
//   지우는 것은 원래 그쪽 몫이다(docs/agents/parallel-dev.md).
//
//   zero-dep(Node 빌트인) · 크로스OS. 다른 steward 훅과 같은 deny 계약을 쓴다.
import { readFileSync } from "node:fs";

/** 워크트리는 `<…>/.worktrees/<저장소>/<서비스>` 에 산다 — 이 마디 하나가 main 폴더와 가른다. */
const IN_WORKTREE = /[\\/]\.worktrees[\\/]/;

/** 공유 제보 폴더를 가리키는 말. 절대·상대 경로 어느 쪽으로 적어도 이 조각이 들어간다. */
const FEEDBACK = /\.harness[\\/]feedback/;

/**
 * 지우는 명령인가 — **명령 자리에 있는** 동사만 센다.
 *
 * 아무 데나 있는 `rm` 을 세면 `grep -n "rm" .harness/feedback` 같은 **읽기**까지 막힌다.
 * 그래서 줄머리·`;`·`&&`·`|`·`(` 뒤, 또는 `xargs`/`sudo`/`-exec` 뒤만 명령 자리로 본다.
 * `mv` 도 넣는다 — 공유 폴더에서 빼내는 것은 남들에게는 지운 것과 같다.
 */
const DESTRUCTIVE =
  /(?:^|[\n;|&(]|\b(?:xargs|sudo|exec)\s+)\s*(?:rm|rmdir|unlink|shred|trash|mv)\b/;

/** `find … -delete` 는 동사가 뒤에 붙어 위 규칙에 안 걸린다. */
const FIND_DELETE = /-delete\b/;

/**
 * 막을 것인가 — **순수 판정**(파일도 환경도 안 본다).
 *
 * @param command 실행하려는 셸 명령
 * @param cwd     세션이 서 있는 폴더
 * @returns 막아야 하면 true
 */
export function blocksSharedFeedbackDelete({ command = "", cwd = "" }) {
  if (!IN_WORKTREE.test(cwd)) return false; // main 폴더에서 지우는 것은 정상 흐름이다
  if (!FEEDBACK.test(command)) return false;
  return DESTRUCTIVE.test(command) || FIND_DELETE.test(command);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  if ((input.tool_name ?? "") !== "Bash") process.exit(0);

  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const command = input.tool_input?.command ?? "";
  if (!blocksSharedFeedbackDelete({ command, cwd })) process.exit(0);

  const reason = [
    "워크트리에서 `.harness/feedback` 을 지우거나 옮기는 것은 막혀 있다.",
    "",
    "이 폴더는 사본이 아니다 — main 폴더(워크트리가 아닌 원래 저장소 폴더) 한 자리를",
    "다섯 워크트리가 함께 보는 링크다. 여기서 지우면 다른 서비스가 아직 처리하지 못한",
    "제보까지 같이 사라지고, gitignore 대상이라 되돌릴 커밋이 없다.",
    "",
    "다 고쳤으면 지우지 말고 남긴다:",
    "  · `done-<서비스>.md` — 무엇을 어떻게 고쳤나 한 줄 + 커밋",
    "  · 남의 몫이 섞여 있으면 `handoff-<받을서비스>.md` — 어느 표시가 왜 그쪽 몫인지",
    "",
    "폴더를 지우는 것은 main 폴더에서 `feat/<서비스>` 를 병합할 때 한다.",
    "규칙 정본: docs/agents/parallel-dev.md (\"화면 피드백 — 폴더 하나를 다섯이 나눠 쓴다\")",
  ].join("\n");

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}
