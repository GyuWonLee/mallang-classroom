/**
 * 앱 이벤트(제어 채널) 타입.
 *
 * 전송은 백엔드 STOMP(`/ws`, 봉투 `{type,payload,at}`)지만, UI 는 아래의 평평한 `ServerEvent`
 * 하나만 안다. 번역은 `services/signaling/ClassroomSocket.ts` 가 담당한다.
 */

import type { Role } from './auth'
import type { MediaAction } from './session'

/** 소켓 연결 수명주기 상태 */
export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error'

/** 수업 참가자 (학급 구성원 명단 = LiveKit identity 매칭표) */
export interface Participant {
  /** LiveKit identity — `teacher-{userId}` / `student-{userId}` */
  participantId: string
  userId: number
  name: string
  role: Role
  teamId?: number | null
}

/**
 * 서버 → 클라이언트 이벤트.
 * event 이름에 따라 채워지는 필드가 달라지므로 대부분 optional 이다.
 */
export interface ServerEvent {
  event: string
  occurredAt?: string
  message?: string

  // 사람
  participantId?: string
  name?: string
  role?: Role
  studentId?: string
  studentName?: string
  senderName?: string
  senderRole?: Role
  /**
   * 보낸 사람 userId (CHAT·CHAT_REPLY 의 `from`).
   * 답장은 학생 화면에 도착하므로 studentId 로는 상대를 가릴 수 없다 — 중복 제거 키와
   * 말풍선 주인을 정하려면 이 값이 필요하다.
   */
  senderId?: number
  /** CHAT_ASSIGNED — 배정된 담당 선생님 userId */
  teacherId?: number

  // 수업
  sessionId?: number
  classroomId?: number

  /** ASSIGNMENT_PUBLISHED — 방금 공개된 과제 id (백엔드 S15P11A407-134) */
  assignmentId?: number

  /**
   * TEACHER_ROOM_MESSAGE — 교사 단톡방 메시지의 **서버 id**.
   *
   * 중복 제거의 열쇠다. 방을 열 때 REST 로 이력을 받고 그 뒤 이 이벤트로 새 줄을 붙이는데,
   * 둘이 겹치는 순간이 있다(이력 조회와 이벤트 도착이 엇갈릴 때). id 로 걸러야 같은 말이
   * 두 번 그려지지 않는다.
   */
  messageId?: number

  // 손들기 (raised=false 면 내림)
  raised?: boolean

  // 판서
  by?: number
  stroke?: Record<string, unknown>
  /** BOARD_STROKE_DELETED — 지워진 획 */
  strokeId?: string
  target?: 'ALL' | 'TEAM' | 'PARTICIPANT'
  action?: 'GRANT' | 'REVOKE'
  userIds?: number[]

  /**
   * MEDIA_CONTROL·MEDIA_REQUEST — 마이크/카메라 제어. `action`(판서 권한용 GRANT/REVOKE)과
   * 값이 겹치지 않게 별도 필드로 둔다. 한 필드에 합치면 BOARD_GRANT 처리부의 타입이 헐거워진다.
   *
   * 두 이벤트가 같은 payload 를 쓰지만 **뜻이 반대다**: MEDIA_CONTROL 은 이미 적용된 결과이고
   * (`MUTE_MIC` 등), MEDIA_REQUEST 는 아직 아무것도 안 바뀐 부탁이다(`REQUEST_*`).
   * 그래서 `event` 로 갈라 받는다 — action 값만 보고 처리하면 안 된다.
   */
  mediaAction?: MediaAction

  /** BROADCAST_LOCK — 쉬는시간 화면 잠금 */
  locked?: boolean
}

