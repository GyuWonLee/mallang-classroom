/**
 * 실시간(STOMP) 계약 — api-spec.md 10장 / 백엔드 realtime.dto.StompEventType 과 1:1.
 *
 * 전송은 `services/signaling/StompClient.ts`, 세션 단위 배선은 `ClassroomSocket.ts` 가 담당한다.
 */

import type { MediaAction, MediaTarget } from './session'

/** STOMP 메시지 봉투 공통 형식: { type, payload, at } */
export interface StompEnvelope<T = Record<string, unknown>> {
  type: StompType
  payload: T
  at: string
}

/** 백엔드 StompEventType 과 1:1 — 전부 실제로 발행된다 */
export type StompType =
  | 'CHAT'
  | 'CHAT_REPLY'
  | 'CHAT_WAITING'
  | 'CHAT_ASSIGNED'
  | 'CHAT_ENDED'
  | 'HAND_RAISED'
  | 'SESSION_STARTED'
  | 'SESSION_ENDED'
  | 'KICKED'
  | 'BOARD_STROKE'
  /** 획 하나 삭제 (지우개) — payload: { strokeId, by } */
  | 'BOARD_STROKE_DELETED'
  | 'BOARD_CLEAR'
  | 'BOARD_GRANT'
  /** 쉬는 시간 화면 잠금 — payload: { locked, by } */
  | 'BROADCAST_LOCK'
  /** 과제 초안 → 공개 전환 (백엔드 S15P11A407-134) — payload: { classroomId, assignmentId } */
  | 'ASSIGNMENT_PUBLISHED'
  /**
   * 선생님의 마이크/카메라 강제 제어 (백엔드 MediaControlService).
   * payload: { target, action, userIds } — **명세 v1.4 에서 되살아났다.**
   * 예전 문서는 "발행 지점이 없어 삭제됐다"고 적혀 있었지만 지금은 실제로 발행된다.
   */
  | 'MEDIA_CONTROL'
  /**
   * 마이크·카메라를 **켜 달라는 요청** (백엔드 S15P11A407-137). payload 는 MEDIA_CONTROL 과 같다.
   * MEDIA_CONTROL 과 달리 **강제가 아니라 알림**이다 — 받은 쪽이 직접 켜야 한다.
   */
  | 'MEDIA_REQUEST'
  /**
   * 학급 교사 단톡방에 새 메시지 (백엔드 f5320e7) — payload: { classroomId, message }.
   *
   * 전용 토픽이 아니라 **개인 채널**(`/user/sub/notifications`)로 온다. 방마다 토픽을 만들면
   * 구독 권한을 또 확인해야 하는데, 개인 채널은 이미 그 사람 것이라 확인할 게 없다.
   *
   * ⚠ **보낸 사람에게는 오지 않는다** — 서버가 발신자를 대상에서 뺀다.
   */
  | 'TEACHER_ROOM_MESSAGE'
  /**
   * 1:1 쪽지 도착 — 받는 사람의 개인 채널로만 온다.
   *
   * 이게 없던 동안 쪽지는 **받는 사람이 쪽지함을 직접 열기 전까지 아무 데도 나타나지 않았다.**
   * 말랑이가 아이 질문을 대신 전하는 경로가 수업이 안 열려 있을 때 여기로 내려오는데,
   * 아이에게는 "선생님 쪽지함에 남겼어요"라고 말해 놓고 선생님은 알 길이 없었다.
   *
   * ⚠ **보낸 사람에게는 오지 않는다** — 서버가 받는 사람에게만 보낸다.
   */
  | 'DIRECT_MESSAGE'

// ── 서버 → 클라 payload (백엔드 발행부와 일치) ────────────────────────────────

/** `/sub/sessions/{id}` — 손들기 토글 */
export interface HandRaisedPayload {
  studentId: number
  raised: boolean
}

/** `/sub/sessions/{id}` — 판서 획 추가. stroke 는 발행자가 넣은 자유 형식(+ strokeId 필수) */
export interface BoardStrokePayload {
  by: number
  stroke: Record<string, unknown>
}

/** `/sub/sessions/{id}` — 획 하나 삭제 (지우개). `by` 는 지운 사람 */
export interface BoardStrokeDeletedPayload {
  strokeId: string
  by: number
}

/** `/sub/sessions/{id}` — 전체 지우기 */
export interface BoardClearPayload {
  by: number
}

/** `/sub/sessions/{id}` — 쉬는 시간 화면 잠금 (`by` 는 잠근 선생님) */
export interface BroadcastLockPayload {
  locked: boolean
  by: number
}

/**
 * `/sub/sessions/{id}` — 선생님이 마이크/카메라를 강제로 잠그거나 풀었다.
 *
 * `userIds` 는 **실제로 적용된 학생들**이다(ALL/TEAM 이어도 서버가 대상을 풀어서 보낸다).
 * 그래서 받는 쪽은 target 을 해석할 필요 없이 `userIds` 에 내가 있는지만 보면 된다.
 */
export interface MediaControlPayload {
  target: MediaTarget
  action: MediaAction
  userIds: number[]
}

/**
 * `/sub/sessions/{id}` — 수업 중 강퇴 (백엔드 SessionKickService, S15P11A407-137).
 *
 * **대상자 개인 채널이 아니라 세션 토픽 전체로 뿌려진다**(SessionKickService.java:65).
 * 즉 그 수업을 구독한 모두가 이 프레임을 받으므로, 받는 쪽이 `userId` 로 자기가 대상인지
 * 반드시 가려야 한다. 예전엔 이 payload 를 통째로 버려서 한 명을 내보내면 **같은 수업의
 * 학생 전원이 로그아웃됐다.**
 *
 * `sessionId` 는 오지 않는다 — 이 토픽 자체가 그 수업이다.
 */
export interface KickedPayload {
  /** 내보내진 사람 */
  userId: number
  /** 내보낸 선생님 */
  by: number
}

/** `/sub/sessions/{id}` — 판서 권한 변경 */
export interface BoardGrantPayload {
  target: 'ALL' | 'TEAM' | 'PARTICIPANT'
  action: 'GRANT' | 'REVOKE'
  userIds: number[]
}

/** `/sub/sessions/{id}` — 수업 종료 */
export interface SessionEndedPayload {
  sessionId: number
  /**
   * 수업 토픽(`/sub/sessions/{id}`)으로 올 때는 없다 — 그 방을 구독한 사람만 받으므로
   * 어느 학급인지 물을 필요가 없다. 개인 채널(`/user/sub/notifications`)로 오는 쪽에는
   * 있다: 학급을 여럿 맡은 선생님이 **자기가 보고 있는 학급의 것일 때만** 반응해야 한다.
   */
  classroomId?: number
}

/** `/user/sub/notifications` — 수업 시작(학급 구성원 전원에게 개인 배달) */
export interface SessionStartedPayload {
  sessionId: number
  classroomId: number
}

/**
 * `/user/sub/notifications` — 과제가 학생에게 공개됨 (AssignmentPublishedNotifier).
 * 수업 세션과 무관하게 일어나므로 세션 토픽이 아니라 **개인 알림함**으로 온다
 * (= 수업 중이 아니어도 받는다). 학급 구성원 전원에게 개인 배달된다.
 */
export interface AssignmentPublishedPayload {
  classroomId: number
  assignmentId: number
}

/** `/user/sub/notifications` — 학생 질문이 담당 선생님에게 배달됨 */
export interface ChatPayload {
  sessionId: number
  from: number
  /**
   * 보낸 아이 이름 — 서버가 함께 싣는다.
   *
   * 예전에는 id 만 왔고 화면이 수업 참가자 명단에서 이름을 되찾았는데, 그 명단은 수업을
   * 구독해야 채워진다. 이 알림은 개인 채널로 와서 명단보다 먼저 도착할 수 있어, 그때
   * 토스트가 "학생 학생이 질문했어요"로 떴다. 옛 서버 응답에는 없으므로 optional 이다.
   */
  fromName?: string
  content: string
}

/** `/user/sub/notifications` — 선생님 답장이 학생에게 배달됨 */
export interface ChatReplyPayload {
  from: number
  content: string
}

/**
 * `/user/sub/notifications` — 상담 대기/종료 안내 (`CHAT_WAITING` · `CHAT_ENDED`).
 * 백엔드 ChatRouterService 가 `Map.of("message", ...)` 로 문구까지 실어 보낸다.
 */
export interface ChatNoticePayload {
  message: string
}

/**
 * `/user/sub/notifications` — 담당 선생님 배정됨 (`CHAT_ASSIGNED`).
 *
 * **위 ChatNoticePayload 와 모양이 다르다.** 백엔드는 `Map.of("teacherId", ...)` 만 보내고
 * `message` 는 아예 없다(ChatRouterService.java:61, 98). 예전엔 셋을 한 덩어리로 묶어
 * `{message}` 로 캐스팅해서 teacherId 가 통째로 유실되고 message 는 undefined 였다.
 */
export interface ChatAssignedPayload {
  teacherId: number
}

/**
 * `/user/sub/notifications` — 학급 교사 단톡방 새 메시지 (`TEACHER_ROOM_MESSAGE`).
 *
 * `message` 는 백엔드 `MessageResponse` 그대로다(카멜케이스 원본 필드명 — `content`·`createdAt`).
 * 화면 타입(`DirectMessage`)으로 옮기는 일은 받는 쪽이 한다.
 *
 * 어느 학급 방인지 알아야 지금 보고 있는 방의 것만 붙일 수 있어서 `classroomId` 가 함께 온다 —
 * 선생님은 학급을 여러 개 맡을 수 있다.
 */
export interface TeacherRoomMessagePayload {
  classroomId: number
  message: {
    id: number
    senderId: number
    senderName: string
    content: string
    createdAt: string
  }
}

/**
 * `/user/sub/notifications` — 1:1 쪽지 도착 (`DIRECT_MESSAGE`).
 *
 * 봉투 모양은 단톡방과 같다(`{ classroomId, message }`) — 서버가 같은 `MessageResponse` 를
 * 싣기 때문이다. 다른 것은 <b>받는 사람이 한 명</b>이라는 점뿐이다.
 */
export type DirectMessagePayload = TeacherRoomMessagePayload

// ── destination 빌더 ─────────────────────────────────────────────────────────

/** 발행(pub) — 클라 → 서버 */
export const pub = {
  /** 학생 전용: { content } */
  message: (sessionId: number) => `/pub/sessions/${sessionId}/messages`,
  /** 학생 전용: 본문 없음(토글) */
  hand: (sessionId: number) => `/pub/sessions/${sessionId}/hand`,
  /** 교사 전용: { studentId, content, replyToId } */
  reply: (sessionId: number) => `/pub/sessions/${sessionId}/messages/reply`,
  /**
   * 교사 항상 / 학생은 판서 권한 필요.
   * 자유 형식이지만 **`strokeId`(고유) 와 `tool`('pen'|'eraser') 은 필수**다.
   * 서버가 `authorId` 를 인증 사용자로 덮어써서 저장하고, 같은 strokeId 재사용은 거부한다.
   * `tool:'eraser'` 는 좌표 지우개라 **교사 전용** — 학생은 아래 boardStrokeDelete 를 쓴다.
   */
  boardStroke: (sessionId: number) => `/pub/sessions/${sessionId}/board/strokes`,
  /** 획 하나 삭제: { strokeId }. 교사는 전부, 학생은 authorId 가 자기인 획만 */
  boardStrokeDelete: (sessionId: number) => `/pub/sessions/${sessionId}/board/strokes/delete`,
  /** 교사 전용: 본문 없음 */
  boardClear: (sessionId: number) => `/pub/sessions/${sessionId}/board/clear`,
}

/** 구독(sub) — 서버 → 클라. 백엔드 화이트리스트 3종 외에는 거절된다. */
export const sub = {
  session: (sessionId: number) => `/sub/sessions/${sessionId}`,
  /**
   * **죽은 경로다.** 백엔드 SUBSCRIBE 화이트리스트에는 있지만(StompAuthChannelInterceptor의
   * TEAM_TOPIC) 이 destination 으로 **무엇도 발행하지 않고**, 프론트에도 호출부가 없다.
   * 지우지 않고 두는 이유: 서버 화이트리스트가 이미 열려 있어 팀방 이벤트가 생기는 순간
   * 이 빌더만 부르면 되고, 지우면 규칙만 다시 베껴 쓰게 된다. 발행부가 생기기 전에는 쓰지 마라.
   */
  team: (sessionId: number, teamId: number) => `/sub/sessions/${sessionId}/teams/${teamId}`,
  /** 개인 이벤트(수업 시작·답장·상담 배정 등) */
  notifications: () => `/user/sub/notifications`,
}

/**
 * STOMP 접속 주소 해석. 백엔드 엔드포인트는 `/ws` (SockJS 아님).
 * 우선순위: VITE_WS_URL 오버라이드 > 현재 오리진 기준 `/ws` (dev 는 vite 프록시가 전달).
 */
export function resolveStompUrl(): string {
  const override = import.meta.env.VITE_WS_URL as string | undefined
  if (override) return override
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/ws`
}
