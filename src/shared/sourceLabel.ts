/**
 * 소스 루트 경로 → 사람이 알아볼 짧은 이름.
 *
 * src/shared 인 이유: 메인(두 번째 실행 안내)과 렌더러(타이틀바 배지)가 **같은 규칙**으로
 * 불러야 한다. 규칙이 갈리면 터미널과 화면이 서로 다른 이름을 대서 더 헷갈린다.
 *
 * ⚠ `node:path` 를 쓰지 않는다 — src/shared 는 렌더러(브라우저)로도 번들되므로
 *    node 내장 모듈을 import 하면 빌드가 깨진다(실제로 깨졌다). 경로는 문자열로 쪼갠다.
 *
 * 워크트리는 `<…>/.worktrees/<저장소>/<서비스>` 라 마지막 마디가 서비스 이름이고,
 * 본진은 저장소 폴더 이름 그대로다.
 */
export function sourceLabel(sourceRoot: string): string {
  // 끝 슬래시·중복 슬래시를 흘려보내고, 윈도우 역슬래시도 같이 받는다.
  const parts = sourceRoot.split(/[\\/]+/).filter(Boolean)
  const name = parts[parts.length - 1] ?? ''
  const parent = parts[parts.length - 2] ?? ''
  const grand = parts[parts.length - 3] ?? ''
  // .worktrees/<저장소>/<서비스> → "<저장소>:<서비스>" (어느 저장소의 어느 서비스인지 함께)
  if (grand === '.worktrees') return `${parent}:${name}`
  return name
}
