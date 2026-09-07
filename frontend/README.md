# 우리반 국어교실 — Frontend

WebRTC 기반 초등 국어(복식학급) 온라인 교실. **선생님**(학급 관리·라이브 수업·AI 과제)과
**학생**(라이브 참여·오늘의 과제·퀴즈·AI 튜터 말랑이)을 하나의 앱에서 role로 분기해 제공한다.

> **모든 API는 실서버를 호출한다.** 목업 계층은 제거됐다 — 백엔드에 없는 기능은 가짜 데이터로
> 성공을 위장하지 않고 호출부에서 정직하게 실패/안내한다. 연동 현황은
> [BACKEND_INTEGRATION.md](./BACKEND_INTEGRATION.md), 남은 작업은 [ROADMAP.md](./ROADMAP.md) 참고.

- **Framework**: React 19 + TypeScript
- **Build**: Vite
- **Styling**: Tailwind CSS v4 (+ clsx / tailwind-merge)
- **Animation**: Framer Motion
- **Client 상태**: Zustand
- **Server 상태**: TanStack Query (v5)
- **실시간/미디어**: LiveKit Client SDK(WebRTC) + STOMP over WebSocket(`@stomp/stompjs`, 제어 채널)
- **라우팅**: React Router v7

---

## 빠른 시작

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm run lint     # oxlint
```

> Windows에서 `npm`이 PATH에 없으면 `C:\Program Files\nodejs`를 PATH에 추가하거나
> `& "C:\Program Files\nodejs\npm.cmd" run dev` 형태로 실행한다.

환경 변수(`.env.development`) — **두 개뿐이다:**

- `VITE_API_BASE_URL` — REST API 베이스 (dev는 `/api` → vite 프록시 → EC2)
- `VITE_WS_URL` — STOMP `/ws` 대상 오버라이드 (미지정 시 현재 오리진 + vite 프록시)

> **LiveKit 접속 URL은 env로 추측하지 않는다** — `POST /sessions/{id}/join` 응답의
> `livekitUrl`을 그대로 쓴다. 목업 스위치(`VITE_USE_MOCK*`)는 없다.

---

## 아키텍처: Frontend Layered Architecture

UI와 실시간/미디어 도메인 로직을 분리하기 위한 3계층 구조. **핵심은 "계약(경계)"이
`stores/`라는 점**이다. UI는 스토어를 읽고, 기능(서비스)은 스토어를 쓴다. 서로의 내부 구현을
모른 채 병렬 개발이 가능하다.

```
┌───────────────────────────────────────────────┐
│ [View]  components/ · pages/                   │  ← 렌더링과 사용자 입력만
│         React + Tailwind, data-* 속성 스타일링   │
└───────────────────────────┬───────────────────┘
                 selector 구독 │ action 호출
┌───────────────────────────▼───────────────────┐
│ [Controller]  hooks/ · stores/                 │  ← UI 이벤트 ↔ 서비스 연결
│               Zustand(원시 상태) · Custom Hook   │
└───────────────────────────┬───────────────────┘
                service 호출 │ 상태 반영
┌───────────────────────────▼───────────────────┐
│ [Model]  services/                             │  ← 도메인 엔진 (순수 TS/OOP)
│          미디어 · 시그널링 · API · 이펙트         │  ← React import 금지
└───────────────────────────────────────────────┘
```

### 핵심 규칙

1. **`services/`에 React 의존성 0** — `useState`/JSX 금지. 순수 TS 클래스/함수. 상태 변화를
   밖으로 알려야 하는 매니저는 `services/core/Emitter<T>`를 상속해 구독/방출을 공유한다.
2. **`MediaStream`/`RTCPeerConnection`을 스토어에 넣지 않는다** — 네이티브 객체는
   `services/media/StreamRegistry.ts`(`Map`)나 `useRef`에만. 스토어는 `isMuted`, `layoutMode`
   같은 **원시/평범 객체 상태만**.
3. **data-attribute 스타일링** — 조건부 클래스 스파게티 대신 `data-*` + Tailwind variant.
   예: `<div data-speaking={x} className="data-[speaking=true]:border-emerald-500" />`
4. **레이아웃은 CSS Grid**, 애니메이션 카드엔 `will-change-transform`.

---

## 폴더 구조와 담당 (이원화)

두 사람이 **서로 영향 없이** 개발할 수 있게 경계를 나눴다. 규칙은 하나 —
**서로의 파일을 직접 고치지 말고 `stores/`(계약)와 `types/`를 통해 소통한다.**

```
src/
├── app/                # 앱 초기화: providers, router, guards(RequireAuth/RequireRole/RoleRedirect)
├── pages/              # 라우팅 타깃 (레이아웃 조립만)
│   ├── AuthPage.tsx            #   통합 로그인/회원가입 (탭 전환)
│   ├── ClassroomPage.tsx       #   학생 실시간 수업
│   ├── InviteAcceptPage.tsx    #   초대 수락 (유일한 비인증 화면)
│   └── teacher/                #   TeacherHomePage(내 학급) · TeacherClassDetailPage(학급 상세=수업 참여)
│                               #   · TeacherClassroomPage(라이브) · TeacherClassManagePage(학급 관리)
│                               #   · TeacherStudentsPage(학생 관리) · TeacherAssignmentsPage(과제 관리)
│                               #   · TeacherChatPage(채팅 관리) · TeacherPickClassPage(학급 선택)
│
├── components/         # ── [담당 A: UI/UX] ─────────────────────────
│   ├── classroom/      #   학생 교실 UI (VideoCard, TaskPanel, QuizView, ScreenAnnotationLayer ...)
│   │   └── teacher/    #   선생님 UI (TeacherTopBar, TeacherSidebar, ClassCreateModal, ClassHeatmapCard ...)
│   │       ├── live/   #     라이브 수업 (LiveBroadcastPanel, StudentsLivePanel, LiveChatPanel, GroupTabs)
│   │       └── students/ #   학생 관리 (StudentsHero, StudentListPanel, StudentDetailPanel, DetailPanes)
│   └── common/         #   공용 프리미티브 (Button, Input, Icon, Toast, EmptyState, ModalShell/ModalHost)
│
├── hooks/              # ── [경계: Controller] ──────────────────────
│                       #   서비스 ↔ UI 연결 (useTeacherClassroom, useMediaControls, useScreenAnnotation ...)
├── stores/             #   ★ 계약 지점 ★ Zustand 원시 UI 상태 (useClassroomsStore, useStudentsStore, useSignalStore ...)
│
├── services/           # ── [담당 B: 실시간/기능] ────────────────────
│   ├── core/           #   Emitter<T> — 서비스 공용 옵저버 베이스(구독/방출)
│   ├── media/          #   MediaDeviceManager, ScreenShareManager, StreamRegistry, ScreenAnnotator(펜 필기)
│   ├── signaling/      #   ClassroomSignaling(LiveKit) · ClassroomSocket(제어 채널) · StompClient(STOMP 전송)
│   ├── api/            #   REST 클라이언트 (auth/classroom/invite/session/chat/assignment/
│   │                   #     material/file/tts/report/analytics) — 배럴 없음, 직접 import
│   └── effects/        #   ConfettiEngine, confettiController (폭죽)
│
├── lib/                # cn(clsx+twMerge), motion(프리셋), subject(과목·학년 테마/팔레트·마스코트)
├── types/              # 공유 TypeScript 타입 = 백엔드 계약 (common/teacher/session/assignment/signaling/realtime/...)
└── index.css           # ★ 디자인 토큰 단일 소스 (@theme) ★
```

### 담당 A — UI/UX
- `components/`, `pages/`, `lib/motion.ts`, `index.css`(디자인 토큰)
- 데이터가 필요하면 **스토어 셀렉터**를 구독한다. 서비스 내부는 몰라도 된다.
- 새 화면/컴포넌트는 `components/common`의 프리미티브(Button/Card 등)를 조립해 만든다.

### 담당 B — 실시간 / 기능 (웹소켓·미디어·API)
- `services/`, 필요 시 대응 `hooks/`
- UI를 몰라도 된다. 결과를 **스토어 action으로 반영**하면 UI가 자동 갱신된다.
- 예: LiveKit 연결 상태 → `useClassroomStore.getState().setSignalingStatus('connected')`

> 실시간·미디어는 실연동 완료다. 진입점은 `sessionApi.join(sessionId)` →
> `ClassroomSignaling.connectWithTicket(...)`. **토큰 TTL이 5분이라 재접속은 반드시
> 티켓을 다시 받아야** 해서 `connect(url, token)` 대신 발급 함수를 넘긴다.
> 미연결 시 `VideoCard`는 대체 이미지가 아니라 **연결 상태를 문장으로** 보여준다
> (가짜 교실 사진 + LIVE 배지는 "방송 중"으로 오해를 줬다).

---

## 디자인 시스템 (메인 스타일)

**모든 색·라운드·그림자·폰트·애니메이션은 `src/index.css`의 `@theme` 한 곳**에서 정의한다.
값 하나를 바꾸면 전 앱의 `bg-*` / `text-*` / `border-*` 유틸이 즉시 반영된다.

```css
/* src/index.css */
@theme {
  --color-primary: #6276d9;   /* 메인 컬러: 여기만 바꾸면 전체 반영 */
  --color-sidebar: #687cb8;
  --color-task: #f5d46a;      /* today's task (yellow) */
  --color-mint-deep: #0f7a63; /* AI mallang (mint) */
}
```

**"색은 기능을 설명한다"** — 컬러 예산: White 60 / Blue 20 / Yellow 10 / Mint 7 / Gold 3.
파랑=대표/버튼, 노랑=지금 할 과제, 민트=AI, 골드=XP/칭찬.

### OO UI 프리미티브
반복되는 UI는 변형(variant) 기반 컴포넌트로 조립한다. 스타일은 토큰만 참조하므로 일관적이다.

```tsx
<Button variant="primary" size="lg">수업 입장하기</Button>
<Button variant="soft">채팅 열기</Button>
<Button variant="back">학급 목록으로</Button>          {/* 선생님 화면 상단 공통 뒤로가기 */}
<Input invalid={!valid} className="px-4 py-3" />       {/* 라운드 입력창 공통 골격 + 에러 상태 */}
<EmptyState icon="students" title="아직 등록된 학생이 없어요" hint="…" />
<ModalShell open onClose={close} label="…" width={460}>…</ModalShell>
```

> 카드는 별도 컴포넌트가 아니라 토큰 유틸 조합이다: `rounded-card bg-card shadow-card`.
> (`Card` 프리미티브는 없다 — 카드마다 패딩·라운드가 달라 클래스로 두는 편이 정확했다.)

새 스타일이 필요하면 `Button.tsx`의 `VARIANTS`에 항목을 추가한다. (컴포넌트마다 클래스를
복붙하지 않는다.) 입력창은 `Input`이 공통 골격(테두리/포커스/`data-invalid` 에러 스타일)을
담당하고, 크기·패딩만 `className`으로 얹는다.

### 애니메이션
- **단순 루프**(pulse/wiggle/floaty)는 CSS 키프레임(`@theme --animate-*`).
- **진입/이탈·전환**은 Framer Motion. 프리셋은 `src/lib/motion.ts`에 중앙화
  (`fadeUp`, `popIn`, `backdrop`, `modalCard`, `chatPanel`). 컴포넌트는 프리셋만 참조한다.

> ⚠️ **주의**: 이 Tailwind v4 툴체인은 **CSS 주석 안의 멀티바이트 문자(한글/`—`/`·` 등)가
> 유틸리티 생성을 깨뜨린다.** `index.css` 주석은 반드시 ASCII로 작성한다.
> (컴포넌트의 `className`이나 JS/TS 주석은 무관.)

---

## 주요 화면·기능

UI는 디자인 원본 `ref/`(auth/index/teacher.html + `DESIGN_GUIDELINES.md`)와 동일하게 맞춘다.
이미지 자산은 `public/assets/`에 두고 `/assets/*.png`로 참조한다.

**인증** — `AuthPage` (`/login`·`/signup`)
- 좌측 일러스트 배경 + 우측 플로팅 카드, 로그인/회원가입 탭 전환

**학생** — `ClassroomPage` (`/classroom`)
- 사이드바(홈·AI와 대화·설정) / 인사말 / 선생님 방송 카드(LIVE·타이머·마이크·카메라·손들기·
  셀프뷰·쉬는시간 잠금) / 오늘의 과제(제출 여부·점수·내 답안 보기) / 퀴즈(객관식·OX·받아쓰기) /
  AI 튜터 말랑이 / 선생님 쪽지
- XP 막대·식물 키우기는 **화면에서 뺐다** — 서버 저장이 없어 새로고침하면 사라졌다(ROADMAP §3)

**선생님**
- `TeacherHomePage` (`/teacher`) — 상단바(브랜드·알림·프로필) + 딥블루 사이드바 +
  **진행 중인 수업**(과목 테마 카드·마스코트·진도) / **닫혀있는 수업**(회색 카드) + 수업 생성 모달
- `TeacherClassDetailPage` (`/teacher/classroom/:id/enter`) — "수업 참여" 진입 = 학급 상세.
  좌 메시지 패널 | 우 1~6학년 수업 카드(학년별 팔레트·수업 시작 CTA) + 오늘의 활동 피드
- `TeacherClassroomPage` (`/teacher/classroom/:id`) — 라이브 수업. LIVE 바 + 모둠(학년) 탭 +
  `내 방송 340px | 학생 그리드 1fr`. 방송 컨트롤(마이크·카메라·화면공유·필기) + 전체 제어 + 손들기 배너
- `TeacherClassManagePage` (`/teacher/classroom/:id/manage`) — 톱니바퀴 진입, 탭 대시보드
  (개요 / **이해도**[학급 히트맵] / 학습자료[PDF 업로드])
- `TeacherStudentsPage` (`/teacher/classroom/:id/students`) — 배너 + 좌 목록 / 우 학생 리포트
- `TeacherAssignmentsPage` (`/teacher/classroom/:id/assignments`) — 과제 목록 + 생성 마법사(AI)
- `TeacherChatPage` (`/teacher/chat`) — 채팅 관리 2단 인박스
- `TeacherPickClassPage` (`/teacher/pick`) — 학급 선택 (과제/학생 메뉴로 진입할 때)

## 데이터 정직성 규칙 (이 프로젝트에서 가장 중요)

1. **가짜 데이터를 만들지 않는다.** 2026-07-30에 학생 상세·목록·배너에서 해시로 지어낸 값
   (진도·출석·과목별 점수·주간 추이·AI 코멘트)을 전부 제거했다 — 선생님이 난수를 보고 학생을
   판단하던 상태였다. 학생 학습 데이터는 `reportApi`·`analyticsApi`가 유일한 출처다.
2. **누를 수 있는데 아무 일도 안 하는 버튼을 두지 않는다.** 같은 날 '준비 중' 토스트만 띄우던
   자리를 정리했다(알림 벨의 가짜 배지 "3", 라이브 빠른도구 3칸, 학생 나비 2칸 등).
3. **단일 이해도 점수를 만들지 않는다** (명세 §8). 학생을 하나의 숫자로 줄 세우지 않는다 —
   목록 정렬은 이름·학년만 지원한다.
4. **실패를 성공처럼 보이게 하지 않는다.** `send()`가 `false`면 토스트로 알리고,
   연결이 안 되면 화면에 이유를 적는다.

---

## 커밋 컨벤션 (요약)
`feat`, `fix`, `chore`, `docs` 등 + 한글 요약. 기능은 담당 경계 안에서 작업하고, 계약(스토어/타입)
변경은 양쪽에 공유한다.
