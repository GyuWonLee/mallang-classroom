/** 수업(세션) 도메인 타입 — api-spec.md 5장 (Session) */

import type { Role } from './auth'

export type SessionStatus = 'ACTIVE' | 'ENDED'

/** 제어 대상 범위 — 판서 권한과 미디어 제어가 같은 패턴을 쓴다 */
export type MediaTarget = 'ALL' | 'TEAM' | 'PARTICIPANT'
export type BoardAction = 'GRANT' | 'REVOKE'

/**
 * 미디어 제어 동작 (백엔드 MediaAction).
 *
 * 앞의 4개는 **강제**다 — 서버가 LiveKit 권한을 바꾸고 Redis 에 기록한다.
 * `REQUEST_*` 두 개는 성격이 다르다(S15P11A407-137): 브라우저는 사용자 제스처 없이 장치를
 * 켜 주지 않으므로 서버가 강제할 수 없고, 학생 화면에 요청을 띄우는 `MEDIA_REQUEST`
 * STOMP 이벤트만 나간다. 잠가 둔 학생은 대상에서 빠진다 — 잠가 놓고 켜 달라는 건 모순이라
 * 지목(PARTICIPANT)이면 `409 media-locked`, 일괄(TEAM·ALL)이면 조용히 건너뛴다.
 * 그 경우 필요한 건 요청이 아니라 잠금 해제다.
 */
export type MediaAction =
  | 'MUTE_MIC'
  | 'UNLOCK_MIC'
  | 'DISABLE_CAM'
  | 'UNLOCK_CAM'
  | 'REQUEST_UNMUTE_MIC'
  | 'REQUEST_ENABLE_CAM'

export interface MediaControlRequest {
  target: MediaTarget
  action: MediaAction
  /** target: 'TEAM' 일 때 필수 (없으면 400 team-id-required) */
  teamId?: number | null
  /** target: 'PARTICIPANT' 일 때 필수 */
  userId?: number | null
}

export interface SessionSummary {
  id: number
  startedAt: string
  endedAt: string | null
  status: SessionStatus
}

/**
 * 수업 이력 항목 = 수업 상세 (v1.1) — 목록과 상세가 **같은 shape** 이다.
 * `GET /classrooms/{id}/sessions` 는 배열, `GET /sessions/{id}` 는 이 객체 하나.
 *
 * `/state` 와 역할이 다르다: `/state` 는 진행중 수업 전용 + 실시간 상태(손·음소거·획)이고,
 * 이쪽은 **종료된 수업도 조회되는 기록**이다. 둘을 섞어 쓰면 안 된다.
 */
export interface SessionHistoryItem {
  sessionId: number
  classroomId: number
  /** 수업을 시작한 선생님 이름 */
  startedByName: string
  startedAt: string
  /** 진행중이면 null */
  endedAt: string | null
  /** `endedAt === null` 과 같은 뜻 — 서버가 분기용으로 함께 준다 */
  live: boolean
  /**
   * 실제로 입장한 사람 수 (재입장 중복 제거). **학급 정원이 아니다** —
   * 아무도 안 들어온 수업은 0 이라 "정원 대비 몇 명"처럼 쓰면 안 된다.
   */
  participantCount: number
}

/**
 * 학생 한 명의 수업 하나에 대한 출석 (백엔드 S15P11A407-137 §11.3 #9).
 *
 * 재입장이 새 행으로 쌓이므로 서버가 수업 단위로 접어서 준다 — `joinedAt` 은 처음 들어온
 * 시각, `leftAt` 은 마지막으로 나간 시각, `minutes` 는 조각들의 합이다(끊겼다 들어온
 * 사이는 빠지므로 leftAt - joinedAt 과 같지 않다).
 */
export interface AttendanceEntry {
  sessionId: number
  startedAt: string
  endedAt: string | null
  attended: boolean
  /** 결석이면 null */
  joinedAt: string | null
  /** 아직 안 나갔거나 웹훅이 안 온 경우 null */
  leftAt: string | null
  /** 총 체류 시간(분). 결석이면 0 */
  minutes: number
}

/**
 * 학생 한 명의 학급 전체 출석 (GET /classrooms/{id}/students/{sid}/attendance).
 * **결석한 수업도 함께 온다** — 그래야 막대가 빈칸을 포함해 그려진다.
 * `sessions` 는 최근 수업이 먼저다(수업 이력과 같은 정렬).
 */
export interface AttendanceSummary {
  studentId: number
  totalSessions: number
  attendedSessions: number
  /** 0~100 정수. 수업이 아직 없으면 0 (분모가 0이라 비율이 정의되지 않는다) */
  attendanceRate: number
  sessions: AttendanceEntry[]
}

/** LiveKit 룸 토큰 */
export interface RoomToken {
  token: string
}

/**
 * 학년별 수업 주제 — **키는 학년의 문자열 표기**다(`{ "5": "받아쓰기 연습" }`).
 *
 * 서버가 `Map<String, String>` 으로 주기 때문이다(JSON 객체의 키는 늘 문자열이다).
 * 숫자 학년으로 읽을 때 `topics[String(grade)]` 를 잊으면 조용히 `undefined` 가 된다.
 *
 * Redis 에 24시간 TTL 로 담기고 수업을 끝내면 지워진다 — **수업 하나짜리 값**이다.
 */
export type SessionTopics = Record<string, string>

/** PUT /sessions/{id}/topics/{grade} — 빈 문자열이면 그 학년 주제를 지운다 */
export interface SessionTopicRequest {
  /** 200자까지 (서버 @Size) */
  topic: string
}

/** POST /sessions/{id}/join 응답 — 학급 룸 + (있으면) 팀 룸 토큰 */
export interface JoinResponse {
  livekitUrl: string
  classroomRoom: RoomToken
  teamRoom: { token: string; teamId: number } | null
  /**
   * 이 수업의 학년별 주제 (S15P11A407-146).
   *
   * **학생도 이 값을 받는다** — 주제가 선생님 브라우저에만 있던 시절의 한계가 이걸로 풀렸다.
   * 옛 서버 응답에는 없으니 없을 수 있다고 보고 읽는다.
   */
  topics?: SessionTopics | null
}

/** 참가자 명단 (identity 매칭용) */
export interface SessionParticipant {
  userId: number
  name: string
  role: Role
  teamId: number | null
}

export interface BoardGrantRequest {
  target: MediaTarget
  teamId?: number | null
  userId?: number | null
  action: BoardAction
}

/** 화이트보드 획 (append 전용, 지우개는 id 단위 삭제) */
export interface BoardStroke {
  id: string
  userId: number
  color: string
  width: number
  points: { x: number; y: number }[]
}

/**
 * 상태 스냅샷 (GET /sessions/{id}/state) — 접속/재접속 시 전체 복원용.
 * 이후 STOMP 증분 이벤트로 갱신한다.
 */
export interface SessionState {
  /** 손든 학생 userId */
  handRaised: number[]
  /** 마이크가 잠긴 학생 userId (media-controls 로 잠근 대상) */
  mutedMic: number[]
  /** 카메라가 잠긴 학생 userId (v1.2 신설, 백엔드 -47) */
  disabledCam: number[]
  /** 쉬는시간 화면 잠금 여부 */
  broadcastLocked: boolean
  /** 판서 권한 보유 userId */
  boardGrants: number[]
  /** 현재 칠판 획 목록 */
  boardStrokes: BoardStroke[]
  /** 현재 접속(프레즌스) userId */
  presence: number[]
  /** 학년별 수업 주제 (S15P11A407-146). 아무도 안 적었으면 빈 객체 */
  topics: SessionTopics
}
