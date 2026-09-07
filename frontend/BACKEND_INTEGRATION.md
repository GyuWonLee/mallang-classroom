# 백엔드 연동 현황 & 가이드

> 프론트를 **실제 백엔드 컨트롤러 계약**에 맞춰 연결한 결과.
> 기준: `backend/` 실제 구현 컨트롤러 + `docs/api-spec.md` **v1.2** (2026-07-30 재확인).

> ⚠️ **2026-07-30 전면 갱신.** 이전 버전은 목업 계층(`isMock()`·`BACKEND_READY`·`VITE_USE_MOCK`)을
> 기준으로 쓰여 있었는데 **그 계층은 이미 삭제됐다.** 또 "TTS 없음 / 이해도 컨트롤러 없음 /
> 과제 제출 없음 / 수업 이력 없음" 이라고 적혀 있었지만 넷 다 **지금은 구현돼 있고 연동도 끝났다.**

## 스위치 (env)

```
VITE_API_BASE_URL    # 기본 /api (dev = vite 프록시 → EC2)
VITE_WS_URL          # STOMP 오버라이드 (미지정 시 오리진 + /ws)
```

**목업 스위치는 없다.** 모든 API 는 실서버를 부른다. 백엔드에 없는 기능은 가짜 데이터로
성공을 위장하지 않고 **호출부에서 정직하게 실패/안내**한다 (CLAUDE.md 0장 규칙 2).
LiveKit 접속 URL 도 env 로 추측하지 않고 `join` 응답의 `livekitUrl` 을 쓴다.

---

## 도메인별 현황 — ✅ 연동 완료 / 🟡 백엔드 없음

### 인증 (Auth) — ✅
`POST /auth/teachers/signup` · `/auth/login` · `/auth/refresh`(401 자동 재발급, single-flight)
· `/auth/logout` · `GET /auth/me` · **`POST /auth/password`**(비밀번호 변경, -131)

> 비밀번호를 바꾸면 서버가 refresh 토큰을 지운다 → **모든 기기 재로그인**. 프론트도 토큰을 지우고
> 로그인 화면으로 보낸다(`ChangePasswordModal`).

### 학급 (Classroom) — ✅ 전 메서드
목록 · 상세(`activeSession` 포함) · 명단 · 구성원 · 생성 · 학생 발급 · CSV 일괄 · 수정 · 삭제 · 구성원 제외

- `setStatus`(OPEN/CLOSED)만 로컬 표시 메타다 — 백엔드에 필드가 없다.
- ⚠️ `classroomMeta` 는 **`status` 만** 얹는다. 예전엔 저장분을 통째로 spread 해서 옛 버전이 남긴
  `grades` 가 서버 값을 덮어썼다(3학년인데 "2·4학년"으로 표시).

### 수업 (Session) — ✅
시작 · **join(LiveKit 진입점)** · `/state` 스냅샷 · 참가자 · 팀 방문 · 판서 권한 · 종료 ·
**쉬는시간 잠금**(`PUT .../broadcast-lock`) · **미디어 제어**(`POST .../media-controls`) ·
**수업 이력/상세**(`GET /classrooms/{id}/sessions`, `GET /sessions/{id}`)

- 취소된 API(명세 v1.1): 수업 중 강퇴, 팀 CRUD 6종, `PUT /teams/{id}/lock`
- 미구현: `REQUEST_UNMUTE_MIC`·`REQUEST_ENABLE_CAM`(501)

### 채팅 (Chat) — ✅ 이력 3종 + STOMP 발행
⚠️ 응답에 `senderRole` 이 없어 **`replyToId` 유무로 교사/학생을 추정** 중이다(`chatApi.ts` TODO).

### 초대 (Invite) — ✅ / 과제 (Assignment) — ✅
과제는 생성·AI 생성(202 + jobId 폴링)·목록·상세·수정·삭제·**제출/자동채점**·
**내 제출 목록**(`GET /me/submissions`)·**내 답안 상세**(`GET /assignments/{id}/submissions/me`).
목록 응답에 **`submitted`·`score`** 가 있다(학생 호출 시에만 채워짐 — 선생님은 `null`).

**계약 주의**
- 생성 요청에 `topic` 은 없다. `materialIds` 필수, 명세의 `personalize` 는 미구현.
- `materialIds` 는 **`builtin-korean-g1`~`g6` 만** 해석된다. 업로드 PDF 를 넣으면 `409 material-not-ready`.
- 공개 여부: 응답 `publishedAt`(nullable) ↔ 요청 `publish`(boolean) — 이름이 다르다.
- 문항 필드는 `text` 가 아니라 `prompt`, 받아쓰기 정답은 `answerText`.
- **OX**: `choices: ["O","X"]`, `answer` 0=O·1=X. **QUIZ_GAME**: 별도 스키마 없는 **표시 모드**
  (OX 또는 객관식 문항). 프론트는 보기 내용으로 판별해 그린다(`lib/quiz.ts`).

### 학습자료 (Material) — ✅ / 파일·TTS (File) — ✅
`POST /files` 업로드 · `GET /files/{id}/content`(인증 필요 → blob + objectURL) · **`POST /api/tts`**

### 분석 (Report / Analytics) — ✅
- `GET .../students/{id}/report` — 개인 리포트(개념별 정답률·강점·약점·LLM 코멘트)
- `POST .../students/{id}/clinic` — 오답 클리닉 생성 (202 + jobId)
- `GET /classrooms/{id}/understanding` — 학급 히트맵
- `GET /assignments/{id}/submissions` — 과제별 제출 현황 + 문항별 정답률·오답 분포

> 명세 v1.0 의 "progress·submissions·understanding 을 report 로 통합" 문구는 v1.2 에서 정정됐다 —
> `report` 에 제출 이력은 없고, 제출 조회는 위 별도 API 다.

### 팀 (Team) — 🟡 컨트롤러 없음
팀 편성은 학생 등록 시 서버가 자동으로 한다. 팀 정보가 필요하면
`GET /sessions/{id}/participants` · `GET /classrooms/{id}/members` 의 `teamId` 를 쓴다.

---

## 실시간 (STOMP) — ✅

**STOMP over 네이티브 WebSocket `/ws`** (SockJS 아님). 접두사는 `/pub`·`/sub`, 봉투는 `{type, payload, at}`.
인증은 CONNECT 헤더 `Authorization: Bearer {accessToken}` — **값이 아니라 게터로 넘긴다**
(access 30분, 재연결마다 최신 토큰을 다시 읽어야 한다).

| 방향 | destination | 비고 |
|---|---|---|
| 발행 | `/pub/sessions/{id}/hand` | 학생 전용, **본문 없는 토글** |
| 발행 | `/pub/sessions/{id}/messages` | 학생 `{content}` |
| 발행 | `/pub/sessions/{id}/messages/reply` | 교사 `{studentId, content, replyToId}` |
| 발행 | `/pub/sessions/{id}/board/strokes` | **`strokeId`·`tool` 필수**, 학생은 판서 권한 필요 |
| 발행 | `/pub/sessions/{id}/board/strokes/delete` | 학생은 **본인 획만** |
| 발행 | `/pub/sessions/{id}/board/clear` | 교사 전용 |
| 수신 | `/sub/sessions/{id}` | `HAND_RAISED` `BOARD_STROKE` `BOARD_STROKE_DELETED` `BOARD_CLEAR` `BOARD_GRANT` `BROADCAST_LOCK` `SESSION_ENDED` |
| 수신 | `/user/sub/notifications` | `SESSION_STARTED` `CHAT*` |

## 실시간 계약의 함정

- **`MEDIA_CONTROL` STOMP 이벤트는 없다** (명세 v1.2 에서 문서에서 삭제). 미디어 제어는
  LiveKit 퍼미션 + Redis 만 쓰므로 **조작 후 `/state` 재조회**가 유일한 동기화 수단이다.
  `TEAM_LOCK`·`TEAM_MOVED`·`KICKED` 도 발행 지점이 없다.
- **`BOARD_STROKE` payload 는 감싸져 온다**: `{ by, stroke: {…} }` (명세의 flat 과 다름).
- **STOMP 예외 = 연결 종료.** 백엔드에 `@MessageExceptionHandler` 가 없어서, 권한 없는 학생이
  획을 발행하면 `ERROR` 프레임 → 연결이 끊긴다. **발행 전 클라이언트 권한 가드 필수.**
- `/sub/sessions/{id}/teams/{teamId}` 는 구독만 되고 발행하는 서버 코드가 없다.
- 모든 목록 API 가 페이지네이션 없이 `List` 통짜 반환이다.

## WebRTC (LiveKit) — ✅

- 진입: `sessionApi.join(sessionId)` → 응답의 `livekitUrl` 을 그대로 사용.
- 룸: 학급 `session-{id}` / 팀 `session-{id}-team-{teamId}`, identity `teacher-{id}`/`student-{id}`.
- **권한**: 학생은 학급 룸에서 `canPublish=false`(수신 전용), 팀 룸에서만 게시.
  → **선생님이 학생을 보려면 팀 룸을 방문(visit)해야 한다.**
- **`canPublishData=false`** — 앱 이벤트는 반드시 STOMP.
- **토큰 TTL 5분** → 재접속은 `connectWithTicket` 으로 **티켓을 다시 받아** 붙는다.
- **화질은 전부 발행 측이 정한다**(SFU 는 트랜스코딩 안 함): 캡처 720p30 / 화면공유 1080p15,
  발행은 `VideoPresets.h720`(1.7Mbps) / `ScreenSharePresets.h1080fps15`(2.5Mbps, simulcast off).
- 원격 오디오는 `RemoteAudioPlayer` 가 DOM 에 붙여야 들린다. 자동재생이 막히면
  `useAudioStore.blocked` → `SoundUnlockBar` 가 "소리 켜기" 버튼을 띄운다(유일한 해제 경로).

## 인프라 (2026-07-27 실측)

- `GET /api/health` → 200 · `/ws` → 101 Switching Protocols · LiveKit `:8443` → 200
- CORS/STOMP 허용 오리진: `http://localhost:5173`, `https://classroom.example.com`
- LiveKit 서버 설정에 비트레이트 제한은 없다 (`infra/server/livekit/livekit.yaml`).
