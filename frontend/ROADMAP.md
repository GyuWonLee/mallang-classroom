# ROADMAP.md — 남은 작업 (말랑말랑 국어교실 · Frontend)

> **기준일 2026-07-30.** 코드와 백엔드 컨트롤러를 직접 대조해 작성했다. `frontend/` 안에서만 작업.
>
> 관련 문서: [CLAUDE.md](./CLAUDE.md)(규약) · [BACKEND_INTEGRATION.md](./BACKEND_INTEGRATION.md)(연동 현황)
> · [ref/DESIGN_GUIDELINES.md](./ref/DESIGN_GUIDELINES.md)(디자인 기준) · `docs/api-spec.md`(백엔드 계약 v1.2)

> ⚠️ **이 문서는 2026-07-30에 전면 재작성됐다.** 이전 버전은 이미 사라진 목업 계층(`isMock()`),
> 없는 폴더(`ref3/`), 만들지 않은 페이지(TeacherExplore/Schedule/Ai, TeacherShell)를 기준으로
> 쓰여 있어 읽으면 잘못된 판단을 하게 됐다. 그때 `[x]` 로 표시된 항목 일부는 실제로 없었다.

---

## 0. 실제 라우트 (전부 11개)

| 라우트 | 화면 |
|---|---|
| `/login` · `/signup` | AuthPage |
| `/invite/:code` | InviteAcceptPage (유일한 비인증 화면) |
| `/` | RoleRedirect |
| `/classroom` | ClassroomPage (학생) |
| `/teacher` | TeacherHomePage |
| `/teacher/chat` | TeacherChatPage |
| `/teacher/pick` | TeacherPickClassPage |
| `/teacher/classroom/:id/enter` | TeacherClassDetailPage |
| `/teacher/classroom/:id` | TeacherClassroomPage (라이브) |
| `/teacher/classroom/:id/manage` | TeacherClassManagePage (탭: 개요·이해도·학습자료) |
| `/teacher/classroom/:id/students` | TeacherStudentsPage |
| `/teacher/classroom/:id/assignments` | TeacherAssignmentsPage |

사이드바 항목은 선생님 4개(내 학급·과제 관리·학생 관리·설정), 학생 3개(홈·AI와 대화·설정).

---

## 1. 끝난 것 (실서버 연동 완료)

- **인증** 5종 + 401 자동 재발급(single-flight) + **비밀번호 변경**
- **학급** 목록·상세·명단·구성원·생성·수정·삭제·CSV 일괄
- **초대** 발급·목록·회수·수락 + 학생 비밀번호 초기화
- **수업** 시작·종료·상태 스냅샷·참가자·팀 방문·**수업 이력/상세**
- **실시간(STOMP)** 손들기·채팅·판서 획/삭제/전체지우기·판서 권한·쉬는시간 잠금
- **WebRTC(LiveKit)** 학급 룸 + 팀 룸 2계층, 선생님 방송·화면공유, 학생 수신, 팀 순회,
  프레즌스·발화 감지, 자동재생 차단 해제 배너, 재접속 시 티켓 재발급
- **미디어 제어** 마이크/카메라 × PARTICIPANT·ALL (STOMP 통지 없음 → `/state` 재조회로 동기화)
- **과제** 생성·AI 생성(비동기 폴링)·목록·상세·수정·삭제·**제출/자동채점**·**내 답안 상세**
- **학습자료** PDF 업로드 → 추출 폴링 → 미리보기 확인 → READY
- **분석** 학급 히트맵 · 과제별 제출 현황 · **학생 개인 리포트** · 오답 클리닉 생성
- **TTS** 받아쓰기 문장 듣기 (`POST /api/tts`)
- 쉬는시간 잠금은 **캠 카드만** 덮는다 (과제·AI는 계속 사용 가능)
- **번들 코드 스플리팅** — 라우트 11개 + 모달 8개를 `lazy()` 로 분리(38 청크).
  엔트리 1,320kB → **367kB**(gzip 382 → **116kB**). `livekit-client`(gzip 129kB)와
  `framer-motion` 은 수업 화면에 들어갈 때만 내려온다 — 로그인 화면은 받지 않는다.

---

## 2. 남은 작업 — 백엔드 대기 없음 (프론트만)

- [ ] **TanStack Query 이관** — 도입은 돼 있으나 `useAuth`(4곳)와 학생 리포트 1곳만 사용.
      나머지 15곳 이상이 `useEffect` + 스토어 수동 로딩이라 캐싱·중복요청 방지·재검증이 없다.
      우선순위: 학급 목록/상세 → 과제 목록 → 학생 명단.
- [ ] **QUIZ_GAME 게임 UI** — 지금은 표시 모드 규칙대로 OX/객관식으로 그린다(백엔드 정의와 일치).
      "놀이처럼" 연출(타이머·연속 정답·효과)을 넣을지는 선택 사항.
- [ ] **반응형·접근성 폴리싱** — 640/1120/1240 분기 점검, 키보드 포커스 순서
- [ ] (선택) 청크 더 쪼개기 — 지금 엔트리 367kB 안에 react·react-dom·react-router·zustand·
      TanStack Query 가 함께 있다. 더 줄이려면 vendor 를 별도 청크로 빼야 하는데,
      어차피 첫 화면에 다 필요해서 요청 수만 늘 수 있다. 측정 후 판단할 것.

## 3. 남은 작업 — 백엔드/기획 대기

| 항목 | 막는 것 | 필요한 것 |
|---|---|---|
| **AI 말랑이(학생 튜터)** | 학생 사이드바 'AI와 대화' 가 고정 문구만 답한다 | 학생용 튜터 대화 API (범위 확정 필요) |
| **XP·식물** | 화면·코드에서 뺐다(`PlantGrowth`·`useUserStore.xp` 는 git 이력에) | 서버가 XP 를 저장해야 되살릴 수 있다 |
| **우리 모둠(학생)** | 사이드바에서 뺐다 | 학생용 팀 조회 API (팀 컨트롤러 없음) |
| **선생님 알림** | 상단바 벨을 뺐다 | 알림 도메인 |
| **`chatApi.senderRole`** | `replyToId` 유무로 교사/학생을 **추정** 중 | 응답에 `senderRole` 필드 추가 |
| **업로드 PDF → AI 생성** | 자료는 READY 가 되지만 생성에 못 쓴다 | `MaterialSource` 가 내장 자료만 해석 |
| **학생 말하기 녹음 제출** | 화면 없음 | 녹음 제출 스키마 |
| **비밀번호 찾기** | 로그인 화면 링크가 안내만 한다 | 메일 발송 |

---

## 4. 이 프로젝트에서 특히 조심할 것

1. **가짜 데이터를 만들지 않는다** (CLAUDE.md 0장 규칙 2). 2026-07-30에 학생 상세·목록·배너에서
   해시로 지어낸 값(진도·출석·과목별 점수·주간 추이·AI 코멘트)을 **전부 제거**했다.
   선생님이 난수를 보고 학생을 판단하던 상태였다.
2. **누를 수 있는데 아무 일도 안 하는 버튼을 두지 않는다.** 같은 날 '준비 중' 토스트만 띄우던
   자리를 정리했다(알림 벨의 가짜 배지 "3", 라이브 빠른도구 3칸, 학생 나비 2칸, 모든 과제 보기).
3. **단일 이해도 점수를 만들지 않는다** (명세 §8). 학생을 하나의 숫자로 줄 세우지 않는다 —
   히트맵은 태그별로 흩어 보여주고, 목록 정렬은 이름·학년만 지원한다.
4. **`index.css` 주석은 ASCII만.** 멀티바이트가 섞이면 Tailwind v4 가 유틸리티 생성을 조용히 멈춘다.
5. **미디어 제어에는 STOMP 통지가 없다.** 조작 후 `/state` 를 다시 읽어야 다른 기기와 맞는다.
