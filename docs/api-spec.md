# API 명세서 (v1.5)

> v1.5 변경: **§11 미구현 API 신설** — 화면 설명서(SCREENS.md)의 화면 9개를 컨트롤러 매핑과 대조했다. 1~10장의 API 는 전부 구현돼 있어(58건 ↔ 60건, 누락 0) 명세 대조만으로는 공백이 안 보였는데, 화면 기준으로 보니 **명세에 올라온 적조차 없는** 공백이 10건 나왔다: AI 말랑이(학생 챗봇)·초대 미리보기·교사 간 메시지·수업 밖 채팅 목록/읽음·수업의 학년 개념·목록 화면 집계 2건·학생 메모·출석 조회·활동 피드. 흩어져 있던 기존 미구현(owner 이양, `REQUEST_UNMUTE_MIC`, 학생별 점수 추이, 학급 퇴실)도 §11.4 로 모았다. 프론트가 "있는 줄 알고" 호출하는 것을 막는 게 목적이다
> v1.4 변경: **미디어 잠금 해제 및 실시간 상태 동기화 보완** — `UNLOCK_MIC`·`UNLOCK_CAM` 시 LiveKit 발행 권한만 복구하던 버그를 수정하고, 대상 트랙에 `mutePublishedTrack(..., false)`를 적용한다. self-hosted LiveKit의 `room.enable_remote_unmute: true` 설정을 명시했다. 미디어 제어 성공 후 `/sub/sessions/{id}`로 `MEDIA_CONTROL {target, action, userIds}`를 발행해 프론트가 마이크·카메라 UI 상태를 즉시 동기화할 수 있게 했다
> v1.3 변경: **채팅 배정 종료 규칙 명확화** — "다른 수업 입장"이 조건이며 같은 수업 내 팀 순회는 해당하지 않음을 명시(S15P11A407-132 수정 반영). 대기열 전체를 한 선생님이 가져가는 동작이 **의도된 설계**임을 문서화 — 코드만 보면 버그로 오해할 수 있어 적어둔다
> v1.2 변경: **미디어 제어 명세 정정** — 문서가 실제 구현과 달랐다: ① "STOMP로 통지"는 **사실이 아니다**(LiveKit 퍼미션+Redis 만 씀, 프론트는 `/state` 로 복원) ② 해제 동작 `UNLOCK_MIC`·`UNLOCK_CAM` 누락 ③ `REQUEST_UNMUTE_MIC`·`REQUEST_ENABLE_CAM` 은 미구현(501) ④ 권한은 OWNER/MAINTAINER 가 아니라 **수업 시작 선생님**. 일괄 제어(-128) 반영 — `ALL`·`TEAM` 대상 범위 표 신설, `ALL` 은 팀 미배정 학생을 조용히 제외한다(`PARTICIPANT` 는 같은 상황에 409). `/state` 에 `disabledCam` 추가(카메라 잠금, -47). **STOMP type 목록을 코드와 대조** — 문서에만 있던 `MEDIA_CONTROL`·`TEAM_LOCK`·`TEAM_MOVED`·`KICKED` 4개 삭제(발행 지점 없음). **학생 셀프서비스 3종** — 내 제출 목록·내 답안 상세(`/me/submissions`, `/assignments/{id}/submissions/me`), 과제 목록에 `submitted`·`score` 추가, 비밀번호 변경(`POST /auth/password`). v1.0 에 "progress·submissions 를 report 로 통합"이라고 적었으나 실제 `report` 에는 제출 이력이 없었다 — **문구를 정정하고 제출 조회를 별도 API 로 신설**했다
> v1.1 변경: **수업 이력 구현** — `GET /classrooms/{id}/sessions`(최근 순, 진행중 포함), `GET /sessions/{id}`(종료된 수업도 조회 가능). 응답 스키마 확정. **만들지 않기로 한 API 취소선 처리** — 팀 CRUD 6종(팀 = 학년 자동 배정으로 대체), 수업 강퇴. 명세에 살아 있으면 프론트가 구현된 줄 알고 호출하므로 정리했다
> v1.0 변경 (구현 반영): 학습 분석 3종(progress·submissions·understanding)을 **`report` 하나로 통합** — 화면당 3회 왕복을 피함. 학급 히트맵·과제별 제출 현황 **응답 스키마 확정**(최신 시도만 집계, `accuracy: null`+`n:0` = 미응시, 오답 분포는 오답만·빈도순). 구현됐지만 명세에 없던 것 추가: `GET /classrooms/{id}/students`, `PUT /sessions/{id}/broadcast-lock`, `POST .../clinic`. STOMP type 에 `BROADCAST_LOCK`·`BOARD_STROKE_DELETED` 추가. 학급 담당 학년(1~2개, 학생 등록 제약) 반영
> v0.9 변경: 학생 분석(이해도) 측정 체계 확정 — **"숫자는 통계가, 해석은 LLM이"** 분리, 학급 히트맵 API 신설, understanding 응답 스키마·신호등 밴드·표본 부족 가드(n<3) 규정, **단일 이해도 점수 미노출** 원칙, LLM 분석 온디맨드+캐시. ERD v1.4와 세트
> v0.8 변경: AI 과제 생성을 **학습자료 기반(grounding) + 개인 최적화**로 확장 — 학습자료(Material) 도메인 신설(PDF 업로드 → 비동기 추출 → 미리보기 확인 → READY), `generate`에 `materialIds` 필수화·`personalize` 도입, 문항 공통 스키마(conceptTags·level·sourceRef) 확정, type에 `OX` 추가·`QUIZ_GAME` 재정의, 내장 어휘 자료 제공
> v0.7 변경: 화이트보드 배경을 **실시간 화면공유 영상 오버레이**로 확정 — 배경 레이어 정의 확장(화면공유 영상 | 업로드 이미지 | 빈 칠판), 획 좌표를 상대좌표(0~1)로 규정, board_snapshot 저장 범위(획만)와 배경 비추적 한계 명시
> v0.6 변경: 채팅 라우팅에 **배정(sticky)·대기열** 도입 — 학생↔선생님 1:1 대화 유지, 폴백을 학급 무관 전체 교사로 확장, 선생님 부재 시 대기열 등록 후 푸시 연결, 배정 종료 조건(하루 학급 종료·선생님 타 수업 입장) 정의. STOMP type 3종 추가. ERD v1.2(Redis 네임스페이스)와 세트
> v0.5 변경: 강퇴 후 재입장 차단 규칙, AI 생성 초안 TTL 연장(1h→24h), 과제 첨부 파일의 학생 접근 규칙(v0.4 인증 다운로드의 받아쓰기 구멍 보완), 초대 타입별 기본 사용 횟수 분리, LiveKit 웹훅 인프라 선행 조건 명시, CSV 일괄 등록 중복 서술 정리
> v0.4 변경: 삭제 정책을 리소스별로 구분, LiveKit 주소·미디어 제어 범위 확정, 초대 사용 횟수 제한, 제출 시도 이력 보존, 파일 인증 다운로드, 단일 인스턴스 STOMP 운영 기준 반영. ERD v1.1(docs/erd.md)과 세트
> v0.3 변경: 채팅 라우팅을 **프레즌스 기반**으로 교체, LiveKit 웹훅 수신 추가, 공유 화이트보드(판서 권한) 정식 스코프 편입, AI 생성 작업 Redis 저장 명시, 학생 아이디 자동 생성 규칙 확정
> v0.2 변경: 학생 계정 직접 생성/비밀번호 초기화, 세션 상태 스냅샷, 수업 중 강퇴, 파일/TTS 추가. 정책 확정 반영(soft delete, 초대 기반 학급 입장, 제출 즉시 채점)

## 도메인별 규모 요약 (분배 참고용)

| # | 도메인 | REST 엔드포인트 | 실시간(STOMP) | 난이도 포인트 |
|---|---|---|---|---|
| 1 | 인증(Auth) | 5 | - | JWT 발급/재발급, 학생 로그인 방식 |
| 2 | 학급(Classroom) | 7 | - | 멤버십 권한 검증의 기준점 |
| 3 | 초대/학생계정(Invite) | 7 | - | 만료 로직(Redis TTL), 학생 계정 발급 |
| 4 | 팀(Team) | 6 | 1 | 팀 이동 시 LiveKit 연동 |
| 5 | 수업(Session) | 12 | 4 | **LiveKit 토큰/제어/웹훅/칠판 — 최고 난이도** |
| 6 | 채팅(Chat) | 3 | 3 | STOMP + DB 저장, 프레즌스 라우팅 |
| 7 | 과제(Assignment) | 8 | - | JSONB 스키마 설계, AI 생성 비동기, 즉시 채점 |
| 8 | 학습이력/이해도 | 5 | - | 통계 집계(태그별 정답률·학급 히트맵), LLM 해석 연동 |
| 9 | 파일/미디어(File) | 3 | - | 업로드·인증 다운로드·TTS 생성 |
| 10 | 학습자료(Material) | 5 | - | PDF 비동기 추출, 미리보기 확인, AI 과제 생성의 선행 조건 |
|   | **합계** | **61** | **7 destinations** | |

---

## 0. 공통 규칙

### 기본

- Base URL: `https://classroom.example.com/api`
- 인증: `Authorization: Bearer {accessToken}` (로그인/회원가입/초대 수락 제외 전부 필수)
- 요청/응답 본문: JSON, 필드는 `camelCase`
- URL: 리소스는 **복수 명사**, `kebab-case`, 동사 금지
  - 예외적으로 리소스로 표현이 안 되는 "동작"은 컨트롤러 패턴 허용: `POST .../sessions/{id}/join` 처럼 마지막 세그먼트에 동사

### HTTP 메서드/상태코드

| 상황 | 메서드 | 성공 코드 |
|---|---|---|
| 목록/단건 조회 | GET | 200 |
| 생성 | POST | 201 (+ Location 헤더) |
| 전체 수정 | PUT | 200 |
| 부분 수정 | PATCH | 200 |
| 삭제 | DELETE | 204 |
| 동작 실행 (join, mute 등) | POST | 200 |

주요 에러: `400`(검증 실패) `401`(미인증/토큰 만료) `403`(권한 없음, **종료된 수업 접근 포함**) `404`(없음) `409`(중복/충돌)

### 삭제 정책 — 리소스별 수명주기 (팀 확정)

- 기록 보존이 필요한 핵심 도메인(`USER`, `CLASSROOM`, `CLASSROOM_MEMBER`, `TEAM`, `ASSIGNMENT`)은 **soft delete** (`deletedAt` 타임스탬프 마킹)
- 삭제된 핵심 리소스는 모든 조회 API에서 기본 제외 (`@SQLRestriction` 활용)
- 단순 연결 정보인 `TEAM_MEMBER`는 팀 이동·제외 시 hard delete 후 필요하면 새 행을 생성한다.
- `INVITE`의 삭제는 `revokedAt` 기록, 수업 종료는 `endedAt` 기록처럼 도메인 상태 컬럼을 사용한다.
- `SUBMISSION`, `CHAT_MESSAGE`, `UPLOADED_FILE`은 현재 버전에서 삭제 API를 제공하지 않는다.
- 학급 삭제 시에도 하위 데이터(과제·제출·학습이력)는 DB에 보존 → 학습 이력 유실 방지
- 복구 기능은 스코프 외 (필요 시 DB에서 수동 복구 가능한 구조만 유지)

### 에러 응답 포맷 — RFC 9457 (Problem Details)

```json
{
  "type": "https://mallang.app/errors/invite-expired",
  "title": "만료된 초대 코드",
  "status": 410,
  "detail": "이 초대 코드는 2026-07-21 18:00에 만료되었습니다.",
  "instance": "/api/invites/AB3D9F"
}
```

- `type`은 에러 종류 식별용 URI(실제 페이지 불필요), 프론트 에러 분기의 기준
- 필드 검증 실패 시 `errors: [{ field, message }]` 배열을 확장 필드로 추가

### 페이지네이션 (목록 API 공통)

- 요청: `?page=0&size=20&sort=createdAt,desc`
- 응답:

```json
{
  "content": [ ... ],
  "page": { "number": 0, "size": 20, "totalElements": 57, "totalPages": 3 }
}
```

---

## 1. 인증 (Auth) — `/api/auth`

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/auth/teachers/signup` | 공개 | 선생님 회원가입 (이메일, 재직학교, 이름, 비밀번호) |
| POST | `/auth/login` | 공개 | 선생님 로그인 (이메일+비밀번호) / 학생 로그인 (아이디+비밀번호) 공용 |
| POST | `/auth/refresh` | 공개(refresh 토큰) | accessToken 재발급 |
| POST | `/auth/logout` | 인증 | refresh 토큰 무효화 |
| GET | `/auth/me` | 인증 | 내 정보 (역할, 이름, 소속 학급 목록 요약) |
| POST | `/auth/password` | 인증 | **비밀번호 변경** (v1.2 신설) — `{currentPassword, newPassword}` → 204. 학생·선생님 공용. 학생 계정은 선생님이 발급한 임시 비밀번호로 시작하므로 본인이 바꿀 수단이 반드시 필요하다. **변경 시 refresh 토큰을 지워 모든 기기에서 재로그인**시킨다 (임시 비밀번호가 적힌 안내장이 돌아다니는 상황을 가정). 새 비밀번호는 8~64자 — 회원가입과 동일 규칙 |

**POST /auth/login 예시**

```json
// 요청
{ "username": "teacher@school.kr", "password": "..." }

// 응답 200
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": { "id": 42, "name": "이선생", "role": "TEACHER" }
}
```

- 학생은 이메일 대신 선생님이 발급한 아이디를 username에 입력 (프론트 화면은 달라도 API는 단일)
- accessToken 30분 / refreshToken 14일 (Redis 저장, 로그아웃 시 삭제)

---

## 2. 학급 (Classroom) — `/api/classrooms`

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/classrooms` | 선생님 | 학급 생성 (생성자가 OWNER) |
| GET | `/classrooms` | 인증 | 내가 속한 학급 목록 (선생님: 담당 학급 / 학생: 가입 학급) — 학급 입장은 초대 기반만, 공개 탐색 없음 (팀 확정) |
| GET | `/classrooms/{classroomId}` | 멤버 | 학급 상세 (진행중 수업 여부 포함) |
| PATCH | `/classrooms/{classroomId}` | OWNER/MAINTAINER | 학급 정보 수정 |
| DELETE | `/classrooms/{classroomId}` | OWNER | 학급 삭제 (전체 삭제) |
| GET | `/classrooms/{classroomId}/members` | OWNER/MAINTAINER | 구성원 목록 (선생님 포함, 역할·팀·학년). **페이지네이션 없음** — 학급 정원이 100명이고 프론트 계약이 배열이라 배열로 반환 |
| GET | `/classrooms/{classroomId}/students` | OWNER/MAINTAINER | **학생 명단** (v1.0 신설) — `{userId, username, name, school, grade}`. `temporaryPassword` 는 없다(발급 응답에서만 1회 노출) |
| DELETE | `/classrooms/{classroomId}/members/{userId}` | OWNER/MAINTAINER | 구성원 제외 (학생 강퇴 / MAINTAINER 해제) |

**학급 상세 응답 예시**

```json
{
  "id": 7,
  "name": "3학년 2반",
  "school": "싸피초등학교",
  "myRole": "OWNER",
  "memberCounts": { "teachers": 2, "students": 24 },
  "activeSession": { "id": 77, "startedAt": "2026-07-21T09:00:00Z" }  // 없으면 null
}
```

- 담당자 이양(OWNER 변경)은 **미구현**: `PATCH /classrooms/{id}/owner` 는 경로만 예약한 것이며 호출하면 404 다. 구현 예정 없음(현재 범위 밖)
- OWNER는 구성원 제외 API의 대상이 될 수 없다. MAINTAINER 해제는 OWNER만 가능하고, MAINTAINER는 학생만 제외할 수 있다.
- 학급 생성 시 서버가 짧은 별칭(`alias`, 예: dodam)을 단어 풀에서 자동 배정 — 학생 아이디 생성 재료 (선생님 입력 없음)

---

## 3. 초대/학생 계정 (Invite) — `/api/classrooms/{classroomId}/invites`, `.../students`

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/classrooms/{classroomId}/invites` | OWNER/MAINTAINER | 초대 생성. body의 `type`: `TEACHER` 또는 `STUDENT`, `maxUses` 지정 (기본값: STUDENT 30, TEACHER 1) |
| GET | `/classrooms/{classroomId}/invites` | OWNER/MAINTAINER | 유효한 초대 목록 |
| DELETE | `/invites/{inviteId}` | OWNER/MAINTAINER | 초대 즉시 만료 |
| POST | `/invites/{code}/accept` | 공개 또는 인증 | 초대 수락. 선생님: 로그인 상태로 수락 → MAINTAINER 등록. 학생: 계정 정보 입력과 함께 가입+등록 |
| POST | `/classrooms/{classroomId}/students` | OWNER/MAINTAINER | **학생 계정 직접 생성** (이름·학년·학교 입력 → 아이디/초기 비밀번호 발급·반환) — 저학년 주 가입 경로. 아이디는 `{학급alias}{번호}` 자동 생성 (예: dodam01) |
| POST | `/classrooms/{classroomId}/students/bulk` | OWNER/MAINTAINER | CSV 일괄 생성 (multipart). 형식: `이름,학교,학년[,학부모이메일]` — 4번째 열은 선택이며, 넣으면 아이디·임시 비밀번호가 그 주소로도 발송된다(응답 후 비동기라 발송 결과는 응답에 없다). 응답: 발급된 계정 목록 |
| POST | `/students/{studentId}/password-reset` | OWNER/MAINTAINER | 학생 비밀번호 초기화 (새 임시 비밀번호 반환) — 분실 대응 필수 기능 |

**POST 초대 생성 예시**

```json
// 요청
{ "type": "STUDENT", "expiresInHours": 48, "maxUses": 30 }

// 응답 201
{ "id": 15, "code": "AB3D9F", "type": "STUDENT", "maxUses": 30, "usedCount": 0,
  "expiresAt": "2026-07-23T10:00:00Z" }
```

- 만료는 Redis TTL + DB 상태 병행. 만료·사용 횟수 소진·관리자 회수 시 `410 Gone`
- 수락 시 DB의 `usedCount`를 원자적으로 증가시켜 동시 가입에서도 `maxUses`를 넘지 않게 한다. 코드 유출 시 관리자가 DELETE API로 즉시 회수할 수 있다.
- TEACHER 초대는 공동 관리자 1명 초대가 일반적이므로 기본 `maxUses: 1` (필요 시 명시적으로 늘림)

---

## 4. 팀 (Team) — `/api/classrooms/{classroomId}/teams`

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
> **v1.1: 팀 CRUD 전체 취소.** 팀 = 학년이고, 학생 등록 시 학년으로 **자동 배정**된다.
> 선생님이 팀을 직접 짜고 옮기는 화면이 없어져 아래 6개 API 는 만들지 않는다.
> 팀 정보는 별도 조회 없이 `GET /sessions/{id}/participants` 와
> `GET /classrooms/{id}/members` 응답의 `teamId` 로 얻는다.

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| ~~POST~~ | ~~`/classrooms/{classroomId}/teams`~~ | — | v1.1 취소: 학년 자동 배정 |
| ~~GET~~ | ~~`/classrooms/{classroomId}/teams`~~ | — | v1.1 취소: `members`/`participants` 의 `teamId` 사용 |
| ~~PATCH~~ | ~~`/teams/{teamId}`~~ | — | v1.1 취소 |
| ~~DELETE~~ | ~~`/teams/{teamId}`~~ | — | v1.1 취소 |
| ~~PUT~~ | ~~`/teams/{teamId}/members/{userId}`~~ | — | v1.1 취소: 수동 배정 없음 |
| ~~DELETE~~ | ~~`/teams/{teamId}/members/{userId}`~~ | — | v1.1 취소 |

- 팀 룸(LiveKit)과 `TEAM`/`TEAM_MEMBER` 테이블은 **그대로 유지**된다 — 취소된 건 팀을 수동으로 관리하는 API 뿐이다
- 수업 중 팀 이동은 발생하지 않는다(학년이 바뀌지 않으므로). 기존 "팀 이동 시 룸 재연결" 규칙은 자연히 불필요
- ~~쉬는 시간 Lock 토글: `PUT /teams/{teamId}/lock`~~ → v1.0 에서 `PUT /sessions/{id}/broadcast-lock` 으로 확정 (§5)

---

## 5. 수업 (Session) — `/api/classrooms/{classroomId}/sessions`, `/api/sessions`

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/classrooms/{classroomId}/sessions` | OWNER/MAINTAINER | 수업 시작 (이미 진행중이면 409) |
| GET | `/classrooms/{classroomId}/sessions` | 멤버 | **수업 이력 목록** (v1.1 구현) — 최근 수업이 먼저, 진행중 수업도 포함. 페이지네이션 없음 |
| GET | `/sessions/{sessionId}` | 멤버 | **수업 상세** (v1.1 구현) — **종료된 수업도 조회 가능**. 실시간 상태가 필요하면 `/state` 를 쓴다 |
| POST | `/sessions/{sessionId}/end` | OWNER/MAINTAINER | 수업 종료 (LiveKit 룸 삭제, 이후 join은 403) |
| POST | `/sessions/{sessionId}/join` | 멤버 | **입장: LiveKit 토큰 발급** (아래 예시) |
| GET | `/sessions/{sessionId}/participants` | 멤버 | 참가자 명단 (identity 매칭용: 이름·역할·팀) |
| POST | `/sessions/{sessionId}/media-controls` | **수업 시작 선생님** | 미디어 제어 — 마이크·카메라 잠금/해제 (아래 예시). v1.2 정정: OWNER/MAINTAINER 가 아니라 수업을 시작한 선생님만 |
| PUT | `/sessions/{sessionId}/broadcast-lock` | 수업 시작 선생님 | **쉬는 시간 화면 잠금** (v1.0 신설) — `{locked: true\|false}`. 상태는 Redis, STOMP `BROADCAST_LOCK` 으로 통지. LiveKit 미디어 권한은 건드리지 않는다 |
| POST | `/sessions/{sessionId}/teams/{teamId}/visit` | OWNER/MAINTAINER | 선생님 팀 순회용 해당 팀 룸 토큰 발급 |
| GET | `/sessions/{sessionId}/state` | 멤버 | **상태 스냅샷** — 손든 학생·마이크 잠금(`mutedMic`)·**카메라 잠금(`disabledCam`, v1.2)**·화면 잠금·칠판 획·판서 권한 등 현재 상태 전체. 접속/재접속(새로고침) 시 호출하고, 이후 미디어 상태는 STOMP `MEDIA_CONTROL`로 증분 갱신한다 |
| ~~POST~~ | ~~`/sessions/{sessionId}/participants/{userId}/kick`~~ | — | v1.1 취소: 범위에서 제외. 소란스러운 학생은 마이크 잠금(`media-controls`)으로 대응한다. 학급에서 완전히 빼려면 `DELETE /classrooms/{id}/members/{userId}` |
| POST | `/sessions/{sessionId}/board/grants` | OWNER/MAINTAINER | **판서 권한 부여/회수** — media-controls와 동일 패턴: `{ target: ALL\|TEAM\|PARTICIPANT, action: GRANT\|REVOKE }`. 상태는 Redis, STOMP `BOARD_GRANT`로 통지 |
| POST | `/webhooks/livekit` | 공개(서명 검증) | **LiveKit 웹훅 수신** — participant_joined/left 이벤트로 프레즌스(Redis) 갱신 + 출석(SESSION_PARTICIPANT) 기록. **선행 조건**: `infra/server/livekit/livekit.yaml`에 `webhook.urls`(이 엔드포인트) + `api_key` 설정 필요 — 미설정 시 프레즌스·출석 전체가 동작하지 않음 |

**GET /classrooms/{id}/sessions 응답** — 목록과 상세가 같은 shape (상세에 더 담을 게 없다)

```json
[
  {
    "sessionId": 12,
    "classroomId": 7,
    "startedByName": "이선생",
    "startedAt": "2026-07-30T09:00:00",
    "endedAt": null,             // 진행중이면 null
    "live": true,                // endedAt == null 과 같은 뜻 — 프론트 분기용
    "participantCount": 21       // 실제 입장한 사람 수 (재입장 중복 제거). 학급 정원이 아니다
  },
  {
    "sessionId": 11,
    "classroomId": 7,
    "startedByName": "이선생",
    "startedAt": "2026-07-29T09:00:00",
    "endedAt": "2026-07-29T09:40:00",
    "live": false,
    "participantCount": 24       // 아무도 안 들어온 수업은 0
  }
]
```

- `GET /sessions/{id}` 는 위 객체 **하나**를 반환한다. 없는 수업은 `404 session-not-found`
- 학급 멤버가 아니면 `403 not-a-member`
- **`/state` 와 역할이 다르다**: `/state` 는 진행중 수업 전용(종료 시 `404 session-not-open`)이고 손든 학생·음소거·칠판 획 같은 **실시간 상태**를 준다. 이력·상세는 종료된 수업의 **기록**을 준다

**POST /sessions/{id}/join 응답**

```json
{
  "livekitUrl": "wss://classroom.example.com:8443",
  "classroomRoom": { "token": "eyJ..." },          // 학급 룸 (학생: canPublish=false)
  "teamRoom": { "token": "eyJ...", "teamId": 3 }   // 자기 팀 룸 (팀 미배정 학생은 null)
}
```

**POST /sessions/{id}/media-controls 요청** — 제어 대상과 동작을 하나의 API로 통일

```json
{
  "target": "ALL",               // ALL | TEAM | PARTICIPANT — 셋 다 동작 (v1.2)
  "teamId": 3,                   // TEAM 필수 — 없으면 400 team-id-required
  "userId": 11,                  // PARTICIPANT 필수 — 없으면 400 user-id-required
  "action": "MUTE_MIC"           // MUTE_MIC | UNLOCK_MIC | DISABLE_CAM | UNLOCK_CAM
}
```

**대상 범위** (v1.2 — S15P11A407-128 일괄 제어 구현)

| target | 적용 대상 | 필요 필드 | 비고 |
|---|---|---|---|
| `PARTICIPANT` | 학생 1명 | `userId` | 팀 미배정이면 `409 student-team-not-assigned` |
| `TEAM` | 팀 소속 학생 전원 | `teamId` | 다른 학급 팀이면 `404 team-not-found` |
| `ALL` | 학급 학생 전원 | — | **팀 미배정 학생은 조용히 제외**된다 (팀 룸이 없어 LiveKit 제어 대상이 아니다) |

- `PARTICIPANT` 는 팀 미배정을 **에러**로 막지만 `ALL` 은 **건너뛴다**. 같은 상황에 응답이 다르다 — "전체 음소거"가 한 명 때문에 통째로 실패하면 안 되기 때문
- `ALL`·`TEAM` 은 서버가 대상 학생만큼 LiveKit 을 호출한다. 프론트에서 학생 수만큼 요청을 보내지 않는다

**미디어 제어 동작:**

- **STOMP 통지가 있다(v1.4)**: 제어가 성공하면 `/sub/sessions/{sessionId}`로
  `MEDIA_CONTROL {target, action, userIds}`를 발행한다. 프론트는 이 이벤트로
  `mutedMic`·`disabledCam` 상태를 증분 갱신하고, 접속·재접속 시에는 `/state`로 복원한다.
  `ALL`·`TEAM` 처리 중 일부 대상에서 실패하면, 서버는 먼저 성공한 학생만 `userIds`에 담아
  이벤트를 발행한 뒤 요청 자체는 실패로 응답한다
- **해제 동작이 있다**: `UNLOCK_MIC`·`UNLOCK_CAM` (v1.2 문서화, 카메라는 -47 구현)
- 해제는 발행 권한을 먼저 복구한 뒤 **해제 대상 트랙만** 원격 unmute한다. 카메라 해제가
  학생이 스스로 꺼 둔 마이크를 켜는 식으로 다른 트랙을 건드리지 않는다
- self-hosted LiveKit은 `infra/server/livekit/livekit.yaml`의
  `room.enable_remote_unmute: true`가 필요하다. 설정 변경 후 LiveKit 컨테이너를 재시작해야 한다
- `REQUEST_UNMUTE_MIC`·`REQUEST_ENABLE_CAM` 은 **미구현** — 호출하면
  `501 media-control-not-supported`. enum 에는 있으나 처리 분기가 없다.
  (원래 의도: 브라우저 장치 권한 때문에 서버가 강제로 켤 수 없으니 요청만 전달)
  잠금 해제(`UNLOCK_MIC`)는 되므로, 학생이 "말할 수 있게 됐다"는 것은
  LiveKit 의 퍼미션 변경 이벤트로 프론트가 감지한다
- **권한이 표의 다른 항목과 다르다**: OWNER/MAINTAINER 가 아니라
  **그 수업을 시작한 선생님만** 가능 (`403 not-session-teacher`)
- 팀 배정 요구는 target 별로 다르다 — 위 표 참고
- 잠금은 **재입장 후에도 유지된다**: 제한 전 발급된 토큰으로 다시 들어와도
  LiveKit `participant_joined` 웹훅에서 Redis 상태를 보고 다시 적용한다
- 수업 종료 후 학생이 세션 관련 API 접근 시 일괄 `403` + `type: .../session-closed`
- ~~**강퇴 후 재입장 차단**~~ — v1.1 에서 강퇴 자체를 범위에서 제외했다. `session:{id}:kicked` 키도 쓰이지 않는다

---

## 6. 채팅 (Chat) — `/api/sessions/{sessionId}/messages`

전송은 STOMP(섹션 10), REST는 **이력 조회용**.

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/sessions/{sessionId}/messages` | 선생님 | 수업 내 메시지 목록 (필터: `?studentId=`) |
| GET | `/sessions/{sessionId}/messages/threads/{studentId}` | 선생님 or 본인 | 특정 학생과의 대화 스레드 |
| GET | `/me/messages` | 학생 | 내 수업 대화 (보낸 것 + 나에게 온 것) |

**응답(`MessageResponse`)**

```
{ id, sessionId, senderId, senderName, senderRole, recipientId, replyToId, content, createdAt }
```

`senderRole` 은 `TEACHER | STUDENT`. **클라이언트는 이 값으로 발신자를 판별한다.**
`replyToId` 유무로 역할을 추정하면 안 된다 — 선생님이 답장 형식이 아니라 그냥 보낸
메시지에는 `replyToId` 가 없어서 학생 메시지로 잘못 분류된다.

`recipientId` 는 선생님이 보낸 수업 메시지와 쪽지에만 있다. 학생이 보낸 수업 메시지는
받을 사람이 발행 시점에 정해지지 않아(대기열) `null` 이다.

`sessionId` 는 쪽지면 `null` 이다. **`/me/messages` 는 수업 대화만 돌려준다** — 쪽지는
`/me/chat/threads` 와 `/classrooms/{id}/chat/threads/{peerId}` 가 담당한다. 두 API 를 함께
쓰는 화면에서 같은 메시지가 두 번 그려지지 않게 하려는 구분이다.

**수신자 라우팅 규칙 — 프레즌스 + 배정 기반 (v0.6 확정)**

핵심 변경(v0.5 → v0.6): 메시지 단위 독립 라우팅 → **학생↔선생님 1:1 배정(sticky)**.
첫 메시지가 라우팅에 성공하면 배정이 생성되고, 이후 학생 메시지·선생님 답장은 배정된 상대에게 고정 전달된다 (양방향 대화 보장).

배정이 없는 학생의 메시지는 다음 순서로 배정 대상을 찾는다:

```
1. 내 팀 룸에 접속 중인 선생님         → 그중 1명에게 배정 + 전달
2. 없음                                → 수업 중이 아닌(어느 팀 룸에도 미접속)
                                         온라인 선생님 전체에서 1명 (학급 무관)
3. 그래도 없음                         → 대기열(FIFO) 등록, 학생에게 CHAT_WAITING 통지.
                                         DB 저장은 이 경우에도 항상 수행
```

- **대기열 해소(푸시)**: 선생님이 한가해지는 순간(수업 종료, 팀 룸 퇴장) 서버가 대기열에서 FIFO로 꺼내 배정 → 학생에게 CHAT_ASSIGNED 통지 + 대기 중 쌓인 메시지를 그 선생님에게 일괄 전달. v0.5의 "선생님이 REST로 나중에 확인"은 보조 수단으로 유지
  - **대기열 전체를 그 선생님이 가져간다** (한 명씩 나눠 갖지 않음, 팀 확정). 배정이 1:N 구조라 가능하며, 기다리는 학생을 다음 선생님이 올 때까지 남겨두는 것보다 지금 응답 가능한 사람에게 전부 붙이는 편이 낫다는 판단이다
- **배정 종료**: ⑴ 하루 학급 종료 ⑵ 배정된 선생님이 **다른 수업**의 팀 룸에 입장. 종료 시 배정 삭제 + 학생에게 CHAT_ENDED 통지. 이후 새 메시지는 재라우팅
  - ⑵ 는 **수업이 실제로 바뀔 때만** 적용된다. 같은 수업 안에서 A팀 → B팀으로 순회하는 것은 종료 사유가 아니다 — 순회할 때마다 끊으면 팀 룸 퇴장(대기열 해소)으로 막 배정된 학생이 `CHAT_ASSIGNED` 직후 `CHAT_ENDED` 를 받고 대기열에서도 빠진다 (v1.3 수정, S15P11A407-132)
- 프레즌스 원천: LiveKit 웹훅(participant_joined/left) → Redis의 팀별 교사 SET과 `session:{id}:teacher:{uid}:current-team` 갱신. 값이 없으면 메인 룸 체류로 본다.
- 배정·대기열은 **DB에 저장하지 않음** (Redis, 유실 시 재라우팅으로 복구). 메시지 본문의 DB 저장은 모든 경우 항상 수행. 조회 권한은 기존 유지("학급의 모든 선생님 + 본인")
- ⚠ 알려진 한계: 규칙 2로 타 학급 선생님이 배정된 경우, 그 선생님은 실시간으로만 대화하고 REST 이력 조회는 불가 — 필요해지면 배정 이력 저장을 별도 논의
- 선생님의 순간적 재접속(네트워크 깜빡임)으로 인한 라우팅 출렁임은 허용 (최악이어도 다른 선생님에게 중복 전달)

---

## 6.5 학습자료 (Material) — `/api/classrooms/{classroomId}/materials`

AI 과제 생성의 **선행 조건** — 모든 생성은 업로드된 학습자료에 근거해야 한다(grounding).

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/classrooms/{classroomId}/materials` | OWNER/MAINTAINER | **PDF 업로드** (multipart, PDF만·20MB) → 202 + materialId. 업로드 즉시 비동기 추출 시작 |
| GET | `/classrooms/{classroomId}/materials` | OWNER/MAINTAINER | 자료 목록 (상태 포함). `?includeBuiltIn=true`로 내장 어휘 자료 포함 |
| GET | `/materials/{materialId}` | OWNER/MAINTAINER | 상태 + **추출 텍스트 미리보기** (업로드 후 폴링용) |
| POST | `/materials/{materialId}/confirm` | OWNER/MAINTAINER | 미리보기 확인 → READY (이후 생성에 사용 가능) |
| DELETE | `/materials/{materialId}` | OWNER/MAINTAINER | 자료 삭제 (soft delete — 기존 과제의 sourceRef가 참조) |

**상태 머신**: `PROCESSING → PREVIEW → READY` / `FAILED`

- **추출은 2단계 (팀 확정)** — 비용·속도 때문에 LLM을 항상 태우지 않는다
  1. **텍스트 레이어 추출** (PDFBox 등 로컬 라이브러리): 한글/워드에서 내보낸 PDF는 여기서 끝난다. 즉시·무료·오프라인
  2. **멀티모달 LLM 추출**: 1단계 결과가 빈약하면(스캔본·이미지 PDF) 자동 승격. 저학년 자료는 그림·표 비중이 높아 이 경로가 필요하다
  - 승격 판정 기준은 구현 시 확정 (예: 페이지당 추출 문자 수가 임계치 미만). 판정값은 운영하며 조정할 수 있게 설정으로 뺀다
  - 어느 단계로 추출했는지 `extraction_source`에 기록 — PREVIEW 화면에서 "스캔본이라 AI가 읽었습니다" 같은 안내와 품질 판단 근거가 된다
  - 두 단계 모두 **비동기** (업로드 응답 202 후 백그라운드)
- **PREVIEW 단계 필수** (팀 확정): 추출 결과를 선생님이 확인 후 confirm해야 READY (손글씨·저화질 스캔 대비). 추출이 깨졌으면 재업로드 유도, FAILED 시 사유 반환
- READY가 아닌 자료로 생성 요청 시 `409 Conflict`
- **파일 형식은 PDF만** (팀 확정) — HWP는 미지원, 프론트에 "한글 → PDF로 내보내기" 안내 문구 표시
- **내장 어휘 자료** (팀 확정): 학년별 국어 기본 어휘 자료를 시스템이 제공. materialId 예약 형식 `builtin-korean-g{학년}`, 항상 READY, 삭제 불가 — 자료 없이 급히 출제할 때도 "무조건 자료 기반" 원칙 유지

---

## 7. 과제 (Assignment) — `/api/classrooms/{classroomId}/assignments`

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/classrooms/{classroomId}/assignments` | OWNER/MAINTAINER | 과제 생성 (직접 작성) |
| POST | `/classrooms/{classroomId}/assignments/generate` | OWNER/MAINTAINER | **AI 과제 생성** (비동기, 202 + 작업 ID) |
| GET | `/generation-jobs/{jobId}` | 선생님 | AI 생성 작업 상태/결과 폴링 |
| GET | `/classrooms/{classroomId}/assignments` | 멤버 | 과제 목록 (학생은 공개된 것만) |
| GET | `/assignments/{assignmentId}` | 멤버 | 과제 상세 (문제 content 포함) |
| PATCH | `/assignments/{assignmentId}` | OWNER/MAINTAINER | 수정 (마감일, 공개 여부 등) |
| DELETE | `/assignments/{assignmentId}` | OWNER/MAINTAINER | 삭제 |
| POST | `/assignments/{assignmentId}/submissions` | 학생 | 과제 제출 — **제출 즉시 자동 채점** (팀 확정), 응답에 점수 포함 |
| GET | `/me/submissions` | 학생 | **내 제출 목록** (v1.2 신설) — 과제별 **최신 시도**만. 아무것도 안 냈으면 빈 배열(404 아님) |
| GET | `/assignments/{assignmentId}/submissions/me` | 학생 | **내 답안 상세** (v1.2 신설) — 최신 시도의 `answers`(내가 쓴 답) + `results` + `feedback`. 안 낸 과제는 `404 submission-not-found` |

**내 답안 상세 응답** — `results` 는 채점 결과에 과제 `content` 를 문항 번호(`no`)로 합쳐 내려준다.
프론트가 과제를 따로 조회하지 않고 "내가 뭘 틀렸는지"를 한 번에 그릴 수 있게 하기 위함이다.
과제 `content` 가 없거나 깨졌으면 채점 결과(`no`·`correct`)만 그대로 나간다.

| 필드 | 설명 |
|---|---|
| `results[].prompt` · `choices` · `answer` · `answerText` | 과제 `content` 에서 옴. 해당 유형에 없는 칸은 `null` |
| `results[].myAnswer` | 내가 고른/쓴 답 (`answers` 에서 옴) |
| `results[].correct` · `conceptTags` | 채점 결과에서 옴 |
| `feedback` | **과제 전체 AI 총평** (학생에게 말하는 말투, 숫자 없음). 문항 결과가 없으면 `null` — 화면에서 총평 영역을 숨기면 된다 |

> `feedback` 은 **온디맨드 + 캐시** 다 (§8 의 `aiAnalysis` 와 같은 원칙). 이 API 를 처음 열 때 한 번 만들어
> `SUBMISSION.feedback` 에 적고, 이후 조회는 저장된 문장을 그대로 준다 — 새로고침해도 문구가 바뀌지 않는다.
> 재제출은 새 시도(행)이므로 총평도 시도마다 따로 만들어진다. LLM 키가 없거나 호출이 실패하면 템플릿 문장으로 대체된다.

**과제 데이터 구조** — `subject` + `type` + `content`(JSONB)

```json
{
  "id": 31,
  "title": "받아쓰기 3회차",
  "subject": "KOREAN",             // KOREAN | HANJA | ... (확장 대비)
  "type": "DICTATION",             // DICTATION | MULTIPLE_CHOICE | PARTICLE_CHOICE | OX | QUIZ_GAME
  "source": "AI_GENERATED",        // MANUAL | AI_GENERATED (출처 — AI 활용 통계·뱃지용)
  "sourceMaterialIds": ["m-3f8a"], // 근거 학습자료 (MANUAL 직접 작성은 null)
  "dueAt": "2026-07-25T15:00:00Z",
  "content": {                     // type별 스키마 (JSONB — 유형 추가 시 DB 변경 불필요)
    "problems": [
      { "no": 1, "audioUrl": "...", "choices": ["갔다", "같다", "갋다"], "answer": 0,
        "conceptTags": ["ㅆ받침"], "level": 2,
        "sourceRef": { "materialId": "m-3f8a", "quote": "학교에 갔다" } }
    ]
  }
}
```

**문항 공통 스키마 (v0.8)** — 모든 type의 `problems[]` 항목이 공유

- `conceptTags`: **학년별 고정 태그 사전**(교육과정 성취기준 기반 20~30개)에서만 선택 — LLM 자유 생성 금지 (표기가 갈라지면 약점 집계가 깨짐. 섹션 8의 축)
- `level`: 1~3 — 목표 정답률 밴드(70~85%) 유지용. 최근 2회 정답률 > 85% → +1, < 60% → -1, 그 외 유지
- `sourceRef`: 근거 자료 원문 인용 — 검수 화면에서 문항 옆에 표시해 검수를 "읽고 판단"에서 "근거 대조"로 단축
- type 추가분(v0.8): **OX** = 참/거짓 판별 (저학년 최적, 자동 채점). **QUIZ_GAME은 별도 문항 스키마 없음** — OX·객관식 문항을 게임 UI로 푸는 표시 모드

**AI 생성 (비동기) 흐름 — 학습자료 기반(grounding) + 개인 최적화 (v0.8)**

```
POST .../assignments/generate
{ "subject": "KOREAN", "type": "DICTATION", "grade": 2, "count": 10,
  "materialIds": ["m-3f8a", "builtin-korean-g2"],   // 필수 1개 이상 — 전부 READY (섹션 6.5)
  "personalize": { "target": "TEAM", "teamId": 3 } } // 선택 — ALL | TEAM | PARTICIPANT
→ 202 { "jobId": "gen-123" }
→ GET /generation-jobs/gen-123 → { "status": "DONE", "draft": { ...과제 초안... } }
→ 선생님이 초안 검수/수정 후 POST .../assignments 로 확정 저장
```

- **grounding 강제**: 자료의 추출 텍스트 전체를 프롬프트에 주입하고 "자료에 없는 내용 출제 금지 + 문항마다 근거 원문 인용(`sourceRef`)"을 강제. READY 아닌 자료 지정 시 `409`. 임베딩 검색(RAG)은 자료가 학기 단위로 쌓인 후 도입 (미포함 목록)
- **personalize**: 대상 학생들의 태그별 정답률 집계(약점 프로필, 섹션 8)를 프롬프트에 주입 — "이 그룹은 겹받침 정답률 45% → 10문항 중 5개는 겹받침 위주로". 결과물은 여전히 초안 1개 → 검수 → 발행 (기존 검수 플로우 불변)

- LLM 호출이 수십 초 걸릴 수 있어 동기 응답 불가. 커리큘럼 이탈 방지를 위해 **AI 초안 → 선생님 검수 → 저장** 2단계로 강제
- 생성 작업 상태·초안은 **Redis** (`genjob:{jobId}`, **TTL 24시간**) — DB에는 확정된 과제만 존재. 검수 중 수업 등으로 자리를 비워도 초안이 유지되도록 1시간→24시간 (v0.5). 만료된 jobId 조회는 `410 Gone` → 프론트는 재생성 유도
- 받아쓰기 `audioUrl`은 AI 생성 플로우에서 백엔드가 TTS로 생성·저장 후 초안에 포함 (섹션 9 참고)

**제출/채점 (팀 확정: 제출 즉시 자동 채점)**

```json
// POST /assignments/31/submissions 요청
{ "answers": { "1": 0, "2": 2 } }        // 문항 번호 → 선택 인덱스 (JSONB)

// 응답 201 — 객관식·클릭형은 즉시 채점 결과 반환
{ "submissionId": 90, "score": 80, "correctCount": 8, "totalCount": 10,
  "results": [ { "no": 1, "correct": true }, ... ] }
```

- 마감(`dueAt`) 전 재제출 허용. 재제출은 기존 행 UPDATE가 아니라 새 시도 행 INSERT로 보존하며, 일반 조회·성적 집계는 가장 최근 시도를 최종 제출로 사용한다.
- 말하기 등 자동 채점 불가 유형은 `score: null` + 선생님 수동 확인 (후순위)

---

## 8. 학습이력/이해도 — `/api/classrooms/{classroomId}/students/{studentId}/...`

> 측정 대원칙 (v0.9): **숫자는 통계가, 해석은 LLM이.** 정답률 등 모든 수치는 SQL 집계로만 계산하고, LLM(`aiAnalysis`)은 오답 내용의 패턴 해석과 지도 제안 문장만 담당한다 — **LLM 출력에 숫자 금지** (환각 방지).

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/classrooms/{classroomId}/understanding` | 선생님 | **학급 히트맵** (v0.9 신설) — 학생 × 태그 매트릭스, 셀 = 신호등 밴드. "수업 전 30초 만에 오늘 누굴 챙길지" 화면 |
| GET | `.../students/{studentId}/report` | 선생님 or 본인 | **학습 리포트** — 개념별 정답률·강점/약점·LLM 코멘트. 아래 understanding 스키마의 profile·trend·behavior·aiAnalysis 를 한 응답에 담는다 |
| POST | `.../students/{studentId}/clinic` | 선생님 | **오답 클리닉 생성** — 약점 개념 기반 추가 문제, 비동기(202 + jobId) |
| ~~GET~~ | ~~`.../students/{studentId}/progress`~~ | — | v1.0: `report` 로 통합. **v1.2 정정**: `report` 는 집계(개념별 정답률·강점/약점·코멘트)만 담고 **제출 이력은 없다**. 학생 본인 이력은 `GET /me/submissions` 를 쓴다. 선생님이 특정 학생의 과제별 점수 추이를 보는 API 는 아직 없다 |
| ~~GET~~ | ~~`.../students/{studentId}/submissions`~~ | — | v1.0: `report` 로 통합 |
| ~~GET~~ | ~~`.../students/{studentId}/understanding`~~ | — | v1.0: `report` 로 통합 |
| GET | `/assignments/{assignmentId}/submissions` | 선생님 | 과제별 제출 현황 + **문항별 정답률·오답 분포** — 반 전체가 틀린 문항은 재수업 대상 |

**학급 히트맵 응답** (`GET /classrooms/{id}/understanding`)

```json
{
  "classroomId": 7,
  "tags": ["겹받침", "띄어쓰기"],            // 각 학생 cells 의 순서와 동일 — 그대로 표로 그린다
  "classAverages": [
    { "tag": "겹받침", "accuracy": 63, "n": 8, "band": "WARN" }
  ],
  "students": [
    { "studentId": 11, "name": "김민수", "grade": 3,
      "cells": [
        { "tag": "겹받침", "accuracy": 25, "n": 4, "band": "RISK" },
        { "tag": "띄어쓰기", "accuracy": null, "n": 0, "band": "INSUFFICIENT" }
      ] }
  ]
}
```

- 셀의 `accuracy: null` + `n: 0` = **그 태그 문항을 아직 안 풀었음** (0% 와 구분)
- 같은 과제를 여러 번 제출했으면 **최신 시도만** 집계 — 재시도로 표본이 부풀지 않게, "지금 이해 상태"를 보여주는 화면이므로

**과제별 제출 현황 응답** (`GET /assignments/{id}/submissions`)

```json
{
  "assignmentId": 31, "title": "받아쓰기 3회차",
  "totalStudents": 24, "submittedCount": 20,
  "notSubmittedStudentIds": [13, 19, 21, 24],
  "submissions": [
    { "studentId": 11, "name": "김민수", "score": 80, "attemptNo": 2, "submittedAt": "..." }
  ],
  "problems": [
    { "no": 3, "conceptTags": ["겹받침"], "accuracy": 0, "n": 20, "band": "RISK",
      "choiceDistribution": [ { "answer": "2", "count": 12 }, { "answer": "4", "count": 8 } ] }
  ]
}
```

- `choiceDistribution` 은 **오답만** 집계하고 많이 고른 순으로 정렬 — 재수업 때 먼저 짚을 오답이 앞에 온다. 받아쓰기처럼 선택형이 아니면 입력한 문자열이 그대로 들어간다
- 의미 해석("소리 나는 대로 적음")은 담지 않는다 — LLM(`report` 의 `aiAnalysis`) 몫

**학생 상세 understanding 응답 (v0.9)**

```json
{
  "profile": [                       // 태그별 약점 프로필 — conceptTags × results 집계
    { "tag": "겹받침", "accuracy": 45, "n": 11, "classAvg": 72, "band": "RISK" }
  ],
  "trend": [                         // 추이 — 최근 과제 점수 시계열
    { "assignmentId": 31, "title": "받아쓰기 3회차", "score": 80, "submittedAt": "..." }
  ],
  "behavior": {                      // 자기교정력 — attempt_no 활용
    "submissionRate": 0.9, "firstTryAccuracy": 62, "finalAccuracy": 85, "avgAttempts": 1.4
  },
  "aiAnalysis": {                    // LLM 해석 (Submission.ai_analysis 캐시)
    "errorPattern": "겹받침 단어를 소리 나는 대로 적는 경향 — '앉다'→'안다'",
    "teacherComment": "받아쓰기 전에 겹받침 낱말 카드로 눈에 익히는 활동을 추천해요",
    "generatedAt": "2026-07-23T02:00:00Z", "stale": false
  }
}
```

**측정 규칙 (팀 확정)**

- **신호등 밴드**: `GOOD`(80%↑) / `WARN`(60~80%) / `RISK`(60%↓). **단일 "이해도 점수"는 만들지 않는다** — 계산은 쉽지만 서열화로 직행하고 학부모 민감 이슈. 서비스가 주는 것은 "점수"가 아니라 "지도 포인트"
- **표본 부족 가드**: 태그당 채점 문항 `n < 3`이면 밴드 대신 `INSUFFICIENT`("데이터 부족") — 저학년 찍기 노이즈 차단. 응답의 모든 수치에 `n` 병기
- **상대 보정**: 모든 정답률에 `classAvg` 병기 — 개인 약점(45% vs 반평균 72%)과 학급 공통 이슈(45% vs 반평균 48%)를 구분. 후자는 학생 지도가 아니라 재수업 신호
- **혼동 패턴**: 객관식 오답 분포(어떤 오답을 골랐나)는 통계로 집계, 그 의미 해석("소리 나는 대로 적음")만 LLM에 위임
- **계산 시점**: 통계는 조회 시 실시간 SQL (학급 20~30명 규모 — 배치 불필요). LLM 분석은 **온디맨드 + 캐시** — 선생님이 학생 상세를 열 때 생성 → `Submission.aiAnalysis`에 저장, 이후 새 제출 발생 시 `stale: true` 표시, 다음 조회에서 재생성
- 난이도 추천(학생 기획 3-d)은 과제 조회 시 `recommendedLevel` 필드로 제공 (후순위)

---

## 9. 파일/미디어 (File) — `/api/files`, `/api/tts`

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/files` | 인증 | 파일 업로드 (multipart) — 학생 말하기 녹음, 선생님 직접 녹음 등. 응답: `{ "fileId": 12, "url": "/api/files/12/content" }` |
| GET | `/files/{fileId}/content` | 아래 접근 규칙 참고 | 인증 기반 파일 다운로드/스트리밍 |
| POST | `/tts` | 선생님 | 텍스트 → 음성 생성·저장 (받아쓰기 문항용). 응답: `{ audioUrl }` |

- 저장 전략: EC2 디스크(`/var/lib/mallang-media`)에 저장하고 Spring API가 권한 확인 후 스트리밍한다. 학생 녹음은 Nginx 정적 공개 경로에 두지 않는다.

**파일 접근 규칙 (v0.5)** — "소유자 또는 학급 선생님"만으로는 학생이 받아쓰기 문항 음성을 재생할 수 없는 문제 보완:

| 대상 | 접근 가능 |
|---|---|
| 기본 | 소유자(업로더) + 소속 학급의 선생님 |
| **공개된 과제의 content에 참조된 파일** (TTS 음성 등) | 위 + 해당 학급 멤버 전원 (학생이 문항 오디오를 재생하는 경로) |
| 학생 말하기 녹음 제출물 | 소유자(학생 본인) + 학급 선생님만 — 다른 학생 접근 불가 |

- 업로드 제한: 오디오 10MB / 학습자료 PDF 20MB (purpose=LEARNING_MATERIAL, 섹션 6.5 API 경유로만 업로드), content-type 검증
- TTS처럼 공개 가능한 산출물을 별도 정적 경로로 분리할지는 운영 단계에서 결정한다.

---

## 10. 실시간 명세 (STOMP over WebSocket)

- 접속: `wss://classroom.example.com/ws` — CONNECT 프레임 헤더에 `Authorization: Bearer {accessToken}`
- 발행(클라→서버): `/pub/...`, 구독(서버→클라): `/sub/...`

| 방향 | destination | 누가 | 내용 |
|---|---|---|---|
| 발행 | `/pub/sessions/{sessionId}/messages` | 학생 | 선생님에게 메시지 전송 (백엔드가 라우팅 규칙 적용 후 DB 저장 + 중계) |
| 발행 | `/pub/sessions/{sessionId}/hand` | 학생 | 손들기 토글 |
| 발행 | `/pub/sessions/{sessionId}/messages/reply` | 선생님 | 학생 메시지에 답장 |
| 발행 | `/pub/sessions/{sessionId}/board/strokes` | 판서 권한자 | 화이트보드 획 추가 (서버가 권한 검증 후 전체 중계 + Redis append) |
| 구독 | `/sub/sessions/{sessionId}` | 전원 | 수업 전체 이벤트 (수업 종료, 공지) |
| 구독 | `/sub/sessions/{sessionId}/teams/{teamId}` | 팀원 | 팀 이벤트 (팀 Lock, 팀 음소거 통지, 팀 이동 지시) |
| 구독 | `/user/sub/notifications` | 개인 | 개인 대상 이벤트 (답장 수신, 개인 음소거 통지, 강퇴) |

**메시지 봉투(envelope) 공통 형식** — 모든 STOMP 메시지는 이 구조로

```json
{ "type": "HAND_RAISED", "payload": { "studentId": 42, "raised": true }, "at": "..." }
```

**실제로 발행되는 `type`** (v1.2 기준 — 코드와 대조 완료):
`CHAT`, `CHAT_REPLY`, `CHAT_WAITING`, `CHAT_ASSIGNED`, `CHAT_ENDED`, `HAND_RAISED`,
`SESSION_STARTED`, `SESSION_ENDED`, `BOARD_STROKE`, `BOARD_STROKE_DELETED`,
`BOARD_CLEAR`, `BOARD_GRANT`, `BROADCAST_LOCK`, `MEDIA_CONTROL`

**문서에만 있던 type.** 아래 3개는 서버가 발행하지 않는다. 구독해도 아무것도 오지 않으므로 프론트에서 분기를 두면 안 된다:

| 없어진 type | 왜 없나 | 대신 |
|---|---|---|
| ~~`TEAM_LOCK`~~ | 쉬는 시간 잠금이 팀 단위 → 수업 단위로 바뀌었다 (v1.0) | `BROADCAST_LOCK` |
| ~~`TEAM_MOVED`~~ | 팀 = 학년 자동 배정이라 수업 중 팀 이동이 없다 (v1.1) | — |
| ~~`KICKED`~~ | 수업 강퇴를 범위에서 제외했다 (v1.1). 상수만 남아 있고 발행 지점이 없다 | 마이크 잠금, 또는 학급 멤버 삭제 |

- `MEDIA_CONTROL` `{target, action, userIds}` — 마이크·카메라 잠금/해제 성공 후 방송한다. `userIds`는 실제로 변경된 학생 목록
- `BROADCAST_LOCK` `{locked, by}` — 쉬는 시간 화면 잠금 (v1.0). REST 로 저장한 뒤 방송한다
- `BOARD_STROKE_DELETED` `{strokeId, by}` — 획 하나 삭제 (v1.0). 발행은 `/pub/sessions/{id}/board/strokes/delete`
- **판서 권한 분리 (v1.0 구현 확정)**: 전체 지우기(`/board/clear`)와 좌표 지우개(`tool: eraser`)는 **선생님 전용**, 학생은 `strokes/delete` 로 **본인이 그린 획만** 삭제. 획 발행 시 `tool`(`pen`|`eraser`) 필수, `authorId` 는 서버가 인증 주체로 덮어쓴다(위조 방지)

- `CHAT_WAITING`·`CHAT_ASSIGNED`·`CHAT_ENDED`는 전부 `/user/sub/notifications`로 나가는 개인 이벤트 (destination 추가 없음, 섹션 6 라우팅 규칙 참고)

**화이트보드 동기화 규칙** (동시 편집의 늪 방지 — 단순하게 유지):

- 획 추가(append)만 실시간 발행, 지우개는 획 ID 단위 삭제, 전체 지우기 별도 — undo/CRDT 없음
- **레이어 2장 구조**: 배경 레이어 + 투명 획 레이어. 배경은 다음 3종 중 하나
  - 선생님 **화면공유 영상** (LiveKit 트랙 — 기본 사용 시나리오)
  - 업로드 이미지 (파일 도메인 `BOARD_IMAGE`)
  - 빈 칠판 (배경 없음)
- 서버는 배경이 무엇인지 알지 못하며 합성하지 않는다 — 영상은 LiveKit, 획은 STOMP로 각자 전달되고 **겹쳐 그리는 것은 클라이언트 책임**
- **좌표 규칙**: 획 좌표는 뷰포트 픽셀이 아니라 배경 콘텐츠 박스 기준 **상대좌표(x, y ∈ 0~1)**로 발행한다. 배경 영상/이미지의 종횡비 유지로 생기는 여백(letterbox)은 콘텐츠 박스에서 제외 — 창 크기가 달라도 전원 화면에서 같은 위치에 찍히게
- 재접속 시 현재 칠판 = `GET /sessions/{id}/state`의 획 목록으로 복원, 이후 증분 수신
- ⚠ 알려진 한계(사양): 배경이 화면공유일 때 선생님이 스크롤·창 전환을 해도 획은 화면상 제자리에 남는다 (실제 칠판과 동일). 내용이 바뀌면 "전체 지우기"로 대응

**BOARD_STROKE payload 예시** — 좌표는 전부 상대좌표(0~1)

```json
{ "type": "BOARD_STROKE",
  "payload": { "strokeId": "st-8f2a", "authorId": 42, "color": "#FF3B30", "width": 0.004,
               "points": [[0.12, 0.34], [0.13, 0.35], [0.15, 0.38]] },
  "at": "2026-07-23T02:10:00Z" }
```

- `strokeId`는 클라이언트 생성(UUID 축약) — 지우개가 "획 ID 단위 삭제"를 하려면 발행 시점부터 ID가 필요
- `width`도 상대값(배경 콘텐츠 박스 높이 대비) — 화면 크기가 달라도 굵기 비율 유지

- 구독 권한(자기 세션/팀만)은 서버 인터셉터에서 검증
- 현재 배포는 백엔드 단일 인스턴스 + Spring simple broker를 사용한다. Redis는 수업 상태 저장에만 사용한다.
- 백엔드를 다중 인스턴스로 확장할 때는 RabbitMQ 등 외부 STOMP broker relay를 도입한다. Redis Pub/Sub 직접 중계는 현재 스코프에 포함하지 않는다.

---

## 11. 화면 대비 공백 — 전부 구현됨 (v1.6)

v1.5 에서 "명세에 올라온 적조차 없어 대조로는 드러나지 않던" 공백 10건 + 흩어져 있던 미구현
4건을 정리했다. **S15P11A407-137 에서 14건 전부 구현했다.** 아래는 무엇이 어디로 갔는지의 지도다.

> 기준: `back/feat/S15P11A407-137-api-gaps`. 마이그레이션 V13(학생 메모)·V14(수업 밖 대화)·
> V15(AI 튜터 기록) 추가. **V12 는 비워 두었다** — 열려 있는 MR !56 이 그 번호를 쓰고 있어
> 같은 번호를 잡으면 합쳐질 때 Flyway 가 멈춘다(2026-07-28 V6 중복 사고와 같은 형태).

### 11.1 플로우가 막히던 것

| # | 화면 | 구현 |
|---|---|---|
| 1 | 학생 3-5 AI 말랑이 | `POST /ai/tutor/messages` · `GET /classrooms/{id}/students/{sid}/tutor-messages` (§12) |
| 2 | 학생 2 초대 수락 | `GET /invites/{code}` — 공개, 레이트리밋 포함 (§3) |
| 3 | 선생님 4 좌측 패널 | `POST /classrooms/{id}/chat/messages` — CHAT_MESSAGE 스키마 확장(V14) (§6) |
| 4 | 선생님 9 채팅 관리 | `GET /me/chat/threads` · `POST .../threads/{peerId}/read` (§6) |
| 5 | 선생님 4 학년 선택 | **미구현 유지** — 아래 "남은 것" 참고 |

### 11.2 목록 화면의 집계

| # | 화면 | 구현 |
|---|---|---|
| 6 | 선생님 2 내 학급 | `ClassroomResponse` 에 `studentCount`·`activeSession`·`assignmentProgress` (§2) |
| 7 | 선생님 8 과제 관리 | `AssignmentSummaryResponse` 에 `totalStudents`·`submittedCount`·`submissionRate`·`averageScore` (§7) |

둘 다 새 엔드포인트가 아니라 기존 목록 응답의 확장이다. 집계는 id 목록을 한 번에 넘기는
쿼리로 끝내 학급·과제가 늘어도 왕복 수가 그대로다.

### 11.3 부가 기능

| # | 화면 | 구현 |
|---|---|---|
| 8 | 선생님 7 메모 탭 | `/classrooms/{id}/students/{sid}/notes` CRUD (V13) — **학생 본인은 볼 수 없다** |
| 9 | 선생님 7 출석 막대 | `GET /classrooms/{id}/students/{sid}/attendance` (§5) |
| 10 | 선생님 4 활동 피드 | `GET /classrooms/{id}/activities` — 새 표 없이 기존 데이터에서 파생 |

### 11.4 흩어져 있던 미구현

| 대상 | 구현 |
|---|---|
| `PATCH /classrooms/{id}/owner` | 구현 — OWNER→MAINTAINER 이양, 두 역할이 한 트랜잭션에서 바뀐다 |
| `REQUEST_UNMUTE_MIC` · `REQUEST_ENABLE_CAM` | 구현 — 강제가 아니라 STOMP `MEDIA_REQUEST` 알림. 브라우저는 사용자 제스처 없이 장치를 켤 수 없다 |
| 학생별 과제 점수 추이 | `GET /classrooms/{id}/students/{sid}/submissions` |
| 학급 퇴실 | `DELETE /classrooms/{id}/members/me` — OWNER 는 이양 후에만 |

### 남은 것 — 제품 결정이 먼저인 항목

**#5 학년별 동시 수업.** `LIVE_SESSION` 에 학년이 없고 명세는 학급당 동시 1세션(진행중이면 409)인데,
선생님 4 화면은 학년별 카드를 전제한다. 복식학급에서 학년별 동시 수업을 지원할지는 스키마·규칙이
함께 바뀌는 문제라 **제품 결정 없이 구현하면 안 된다** — 유일하게 손대지 않은 항목이다.

---

## 12. AI 말랑이 (학생 튜터) — `/api/ai/tutor`

학생이 묻고 말랑이가 답한다. **학생 전용**(선생님이 부르면 403 `students-only`),
학생당 **하루 30회**(초과 시 429 `tutor-quota-exceeded`), 실패하면 에러가 아니라 안내 문구로 대체된다.
질문·답은 전부 기록된다 — 저학년이 쓰는 챗봇이라 선생님이 확인할 수 있어야 하고, 비용 추적의 근거도 된다.

### 12.1 묻기 — `POST /ai/tutor/messages`

```jsonc
// 요청
{ "classroomId": 5, "question": "겹받침이 뭐야?" }   // question 최대 500자

// 응답 200
{
  "messageId": 77,
  "answer": "겹받침은 받침이 두 개인 글자야. ...",
  "answeredBy": "LLM",          // LLM | TEMPLATE (TEMPLATE = 키 없음·호출 실패 폴백)
  "proposedAction": null         // 제안이 없으면 null — 대부분 여기가 null 이다
}
```

### 12.2 제안 액션 — 확인 후 실행

말랑이는 답과 함께 **제안**을 붙일 수 있다. 제안은 그 자체로 아무 일도 하지 않는다.
**학생이 확인해야만 실행된다** — 사용자가 초등학생이라 원탭으로 무언가 발송되면 안 되기 때문이다.

| type | 언제 | 실행되면 |
|---|---|---|
| `ASK_TEACHER` | 말랑이가 답하기 어렵거나 선생님 판단이 필요할 때 | 수업 중이면 수업 채팅으로, 아니면 선생님에게 쪽지 |
| `SHOW_MATERIAL` | 답의 근거가 학급 자료에 있을 때 | 그 자료를 연다 |

```jsonc
// 제안이 실린 응답
{
  "messageId": 77,
  "answer": "그건 선생님께 여쭤보는 게 좋겠어. 내가 대신 여쭤봐 줄까?",
  "answeredBy": "LLM",
  "proposedAction": {
    "type": "ASK_TEACHER",
    "title": "받아쓰기 시험 범위",
    "content": "민수가 이번 주 받아쓰기 시험 범위를 궁금해합니다.",  // 선생님에게 갈 문장 그대로
    "materialId": null,
    "expiresAt": "2026-08-04T13:20:00"   // 24시간
  }
}
```

`content` 를 내려주는 이유: **무엇이 선생님에게 가는지 보여주지 않고 아이에게 확인을 받을 수 없다.**
화면에 그대로 보여준 뒤 확인을 받아야 한다.

### 12.3 확인/거절 — `POST /ai/tutor/messages/{messageId}/action`

```jsonc
// 요청
{ "decision": "CONFIRM" }   // CONFIRM | REJECT

// 응답 200 (ASK_TEACHER 확인)
{
  "messageId": 77,
  "status": "CONFIRMED",
  "actionType": "ASK_TEACHER",
  "delivery": "DIRECT_MESSAGE",   // SESSION_ROUTED | DIRECT_MESSAGE — 화면 문구가 갈린다
  "material": null
}

// 응답 200 (SHOW_MATERIAL 확인)
{
  "messageId": 78, "status": "CONFIRMED", "actionType": "SHOW_MATERIAL",
  "delivery": null,
  "material": { "id": 12, "title": "겹받침 연습지" }
}
```

| 에러 | 상황 |
|---|---|
| 404 `tutor-message-not-found` | 없는 대화 |
| 403 `tutor-action-forbidden` | 남의 제안을 결정하려 함 |
| 409 `no-pending-action` | 이미 확인·거절했거나 제안이 없는 대화 |
| 409 `action-expired` | 24시간이 지남 |
| 409 `material-not-available` | 그 사이 자료가 삭제·변경됨 |

### 12.4 대화 기록 — `GET /classrooms/{id}/students/{sid}/tutor-messages`

학급 선생님(안전 확인) 또는 **본인**만. 최근 것이 위.
`actionType`·`actionStatus` 가 함께 오므로 "제안했는데 아이가 안 눌렀다"도 보인다.

### 12.5 설계 메모 — 프론트가 알아야 할 것

- **제안은 최대 하나**. 답 하나에 액션 둘이 붙는 경우는 없다.
- **`answer` 에 기계 용어가 절대 없다.** 프롬프트로 금지하고, 새어 나와도 서버가 정규식으로 지운다.
  프론트는 `answer` 를 그대로 렌더링하면 된다.
- **`materialId` 는 서버가 이미 검증했다.** LLM 이 지어낸 id 는 제안 단계에서 버려지므로
  `proposedAction.type === "SHOW_MATERIAL"` 이면 그 자료는 존재하고 READY 다.
  다만 확인 시점에 삭제됐을 수 있어 409 `material-not-available` 은 처리해야 한다.
- **스레드가 없다.** 질문 1 + 답 1 이 완결 단위다(문맥 이어붙이기는 비용·주입 위험을 함께 키운다).

---

## 부록: 분배 시 참고 — 도메인 간 의존성

```
인증(1) ──→ 학급(2) ──→ 초대(3), 팀(4)
                └─────→ 수업(5) ──→ 채팅(6), 실시간(10)
                └─────→ 과제(7) ──→ 학습이력(8)
```

- 1→2가 최우선 경로 (모든 권한 검증의 기반)
- 5(수업/LiveKit)와 10(STOMP)은 동일 담당자 권장 (같은 실시간 문맥)
- 7(과제)은 2만 있으면 독립 개발 가능 → 병렬화에 유리
- 8은 7의 제출 데이터에 의존 → 7과 동일 담당자 권장
- 9(파일/TTS)는 7(과제)의 선행 조건 → 7 담당자가 초반에 함께 처리 권장

## 부록: 이번 버전 미포함 (기획상 후순위 — "왜 없어요?" 방지용)

- ~~화이트보드~~ → **v0.3에서 정식 스코프 편입** (판서 권한 부여 포함)
- 실시간 퀴즈/투표, 이모지 리액션, 랜덤 지목 룰렛, 발표자 스포트라이트, 집중 모드 — 칠판 완성 후 스트레치 골 후보
- 학생 음성 메시지 → TTS 변환 (기획 학생 3-c)
- 식물 키우기 Gamification (기획 학생 4)
- 학급 전체 이해도 통계 (기획에서 취소선 처리)
- 담당자(OWNER) 이양 — API 자리만 예약
- 난이도 기반 문제 추천 — `recommendedLevel` 필드만 예약
- pgvector 임베딩 RAG (학습자료 청크 검색) — 자료가 학기 단위로 쌓인 후 MATERIAL_CHUNK + 임베딩으로 확장, 현재는 full-context 주입
- 오답 클리닉 (학생별 복습 세트 자동 생성) — `ASSIGNMENT.target_student_id` 자리만 예약, 샘플 검수 정책과 세트로 논의
