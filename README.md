# 🚀 Rockury (Rock + Mercury)
> "Build on Rock, Speed like Mercury"

Rockury는 개발자가 복잡한 환경 설정과 부수적인 작업에서 벗어나, 제품의 본질인 비즈니스 로직에만 집중할 수 있도록 돕는 올인원 개발 생산성 플랫폼입니다. UI 설계부터 API 테스트, DB 관리, 인프라 모니터링까지 개발 프로세스의 모든 외적 요소를 하나의 인터페이스에서 관리하세요.

## 💡 서비스 철학 (Philosophy)
 - Rock (기반): 단단한 인프라와 표준화된 문서화를 통해 흔들리지 않는 개발 기반을 제공합니다.
 - Mercury (속도): 반복적인 보조 작업들을 자동화하고 통합하여, 비즈니스 로직 구현 속도를 극대화합니다.

## 🧱 기술 스택
Electron + electron-vite · React 18 + TypeScript · Tailwind CSS v4 + Radix UI · Zustand · react-resizable-panels · lucide-react (화이트 테마 고정)

## 🚀 시작하기
```bash
npm install
npm run dev        # Electron 개발 창 실행 (HMR)
npm run typecheck  # main/renderer 타입 검사
npm test           # 단위 테스트 (vitest — 순수 도메인 로직)
npm run build      # 프로덕션 번들 (out/)
npm run e2e -- --only=<스위트>   # 앱 구동 스모크 (Playwright _electron). build 선행 · 목록은 --list
                   # 전체 한 바퀴는 커밋 훅의 몫 — 범위 없이 부르면 러너가 거부한다
```

> 변경 게이트: `npm run typecheck && npm test && npm run build`. 순수 로직을 추가하면 옆에 `*.test.ts` 를 함께 둔다. e2e 함정·패턴은 `e2e/README.md`, 이후 작업 계획은 `docs/before-steward-background/ops-implementation-plan.md`.

## 🧭 공통 레이아웃 셸 — 가변 깊이 내비게이션
"깊이는 레이아웃 코드가 아니라 데이터다." 각 서비스가 트리(Service → Module → View)를 선언하면 셸이 존재하는 계층만 렌더한다.

| 계층 | 컴포넌트 | 위치 | 조건 |
|------|----------|------|------|
| L1 서비스 | `ActivityRail` | 좌측 레일 | 항상 |
| L2 모듈 | `ModuleTabs` | 상단 1차 탭 | 항상 |
| L3 뷰 | `ViewTabs` | 상단 2차 탭 | 모듈에 `views`가 있을 때 (depth 3) |
| L4 툴바 | `ContextualToolbar` | 탭 아래 | leaf에 `Toolbar`가 있을 때 |
| 워크스페이스 | `WorkspacePanels` | 나머지 | 항상 |

- **depth 2 데모**: `DB › Connections` (뷰 없음 → L3 생략)
- **depth 3 데모**: `DB › Schema Studio › Diagram` (L3 뷰 탭 + L4 툴바)

새 서비스/모듈/뷰는 `src/renderer/src/services/*` 에서 config만 추가하면 셸이 자동으로 크롬을 구성한다.

## 📁 구조
```
src/
  main/       Electron 메인 (프레임리스 창, 창 제어 IPC)
  preload/    contextBridge 안전 API (window.rockury)
  renderer/src/
    shell/    AppShell · ActivityRail · ModuleTabs · ViewTabs · ContextualToolbar · WorkspacePanels · Titlebar
    nav/      types · registry · useNav (Zustand)
    services/ db (구체화) · uiux · api · infra (플레이스홀더)
    ui/       공용 프리미티브 · styles/ 디자인 토큰
```

> 실제 DB 연결·쿼리 실행·다이어그램 렌더링·AI 연동은 후속 마일스톤에서 이 골격 위에 구현됩니다.