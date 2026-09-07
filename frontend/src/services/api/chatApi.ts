import { api } from './client'
import type { Role } from '@/types/auth'
import type {
  ChatMessageDto,
  DirectMessage,
  DirectThread,
  TeacherRoomSummary,
} from '@/types/chat'

// 실시간 전송은 STOMP(`/pub/sessions/{id}/messages{,/reply}`), 여기 REST 는 이력 조회 전용.

/**
 * 백엔드 MessageResponse — { id, sessionId, senderId, senderName, replyToId, content, createdAt }.
 *
 * **역할도 상대도 담겨 있지 않다.** 그래서 예전 매핑은 둘을 지어냈다:
 * `studentId: m.senderId` (보낸 사람을 대화 상대 자리에 넣음) + `senderRole` 을 `replyToId`
 * 유무로 추정. 그 탓에 선생님이 보낸 메시지가 아무 대화방에도 안 뜨는 버그가 있었다.
 *
 * 지금은 **지어내지 않는다.** 서버가 준 값(senderId · replyToId)을 그대로 넘기고, 여기서
 * 한 가지만 보탠다 — `replyToSenderId`: 답장 원본을 누가 보냈는지. 목록 안에서 id 로 찾을 수
 * 있는 값이고(그래서 한 줄이 아니라 목록 단위로 매핑한다), 선생님이 보낸 줄의 대화 상대를
 * 알아낼 유일한 단서다. 판단은 화면이 자기 userId 로 한다 (`lib/chatMessage`).
 *
 * ── 그 뒤 백엔드가 `recipientId` 와 `senderRole` 을 둘 다 주기 시작했다 ──
 * `recipientId` 는 `chatPeerId` 가 1순위로 본다. `senderRole` 은 **동료 선생님이 보낸 줄을
 * 학생 줄과 구별하는 데만** 쓴다 — 말풍선 방향은 여전히 내 userId 로 정한다(더 직접적이다).
 * `replyToSenderId` 는 recipient 저장 이전에 쌓인 옛 데이터용 보조 수단으로 남는다.
 */
interface BackendMessage {
  id: number
  /** 수업 밖 1:1 대화면 null (V14) */
  sessionId: number | null
  senderId: number
  senderName: string
  /** 보낸 사람의 역할 (TEACHER | STUDENT) — 옛 데이터에는 없을 수 있어 optional */
  senderRole?: Role | null
  /**
   * 받는 사람 — 백엔드가 수업 채팅에도 recipient 를 저장하면서 생겼다.
   * **옛 데이터에는 없다**(필드 자체가 빠지거나 null) → optional 로 받고 아래에서 폴백한다.
   */
  recipientId?: number | null
  replyToId: number | null
  content: string
  createdAt: string
}

/**
 * 목록 단위 매핑 — `replyToSenderId` 를 채우려면 **같은 응답의 다른 줄**을 봐야 한다.
 * 원본이 응답에 없으면(다른 수업의 메시지에 달린 답장 등) null 로 둔다.
 */
function toChatMessages(list: BackendMessage[]): ChatMessageDto[] {
  const senderOf = new Map(list.map((m) => [m.id, m.senderId]))
  return list.map((m) => ({
    id: m.id,
    sessionId: m.sessionId,
    senderId: m.senderId,
    senderName: m.senderName,
    senderRole: m.senderRole ?? null,
    recipientId: m.recipientId ?? null,
    replyToId: m.replyToId,
    replyToSenderId: m.replyToId == null ? null : (senderOf.get(m.replyToId) ?? null),
    text: m.content,
    at: m.createdAt,
  }))
}

/**
 * 채팅 이력 API — 백엔드 ChatRestController 구현 완료(목업 없음).
 * 메시지 전송/수신은 STOMP 가 담당하고, 이 REST 는 저장된 이력 조회만 한다.
 */
export const chatApi = {
  /** 수업 내 메시지 목록 (선생님, ?studentId= 필터) — GET /api/sessions/{sessionId}/messages */
  async listMessages(sessionId: number, studentId?: number): Promise<ChatMessageDto[]> {
    const { data } = await api.get<BackendMessage[]>(`/sessions/${sessionId}/messages`, {
      params: studentId ? { studentId } : undefined,
    })
    return toChatMessages(data)
  },

  /** 특정 학생과의 대화 스레드 — GET /api/sessions/{sessionId}/messages/threads/{studentId} */
  async getThread(sessionId: number, studentId: number): Promise<ChatMessageDto[]> {
    const { data } = await api.get<BackendMessage[]>(
      `/sessions/${sessionId}/messages/threads/${studentId}`,
    )
    return toChatMessages(data)
  },

  /** 내가 보낸 메시지와 답장 (학생) — GET /api/me/messages */
  async myMessages(): Promise<ChatMessageDto[]> {
    const { data } = await api.get<BackendMessage[]>('/me/messages')
    return toChatMessages(data)
  },
}

/**
 * 수업 밖 1:1 대화 (백엔드 S15P11A407-137 §11.1 #3·#4, 마이그레이션 V14).
 *
 * 위 `chatApi` 와 **다른 기능이다.** 저쪽은 수업(session) 안에서 학생 질문을 선생님에게
 * 라우팅하는 것이고(전송은 STOMP), 이쪽은 같은 학급 구성원끼리 수업과 무관하게 주고받는
 * 메시지다. 전송까지 REST 라 STOMP 를 붙이지 않아도 동작한다.
 */
export const directChatApi = {
  /**
   * 내 대화 목록 — GET /api/me/chat/threads.
   * **정렬은 서버가 정한다**(안 읽은 것이 위, 그 안에서 최근 순) — 프론트에서 다시 정렬하면
   * 읽음 처리 직후 줄이 튀어 오른다.
   */
  async myThreads(): Promise<DirectThread[]> {
    const { data } = await api.get<DirectThread[]>('/me/chat/threads')
    return data
  },

  /** 상대와의 대화 (양방향, **오래된 것부터**) — GET /api/classrooms/{id}/chat/threads/{peerId} */
  async conversation(classroomId: string | number, peerId: number): Promise<DirectMessage[]> {
    const { data } = await api.get<BackendMessage[]>(
      `/classrooms/${classroomId}/chat/threads/${peerId}`,
    )
    return data.map(toDirectMessage)
  },

  /** 1:1 메시지 전송 (같은 학급 구성원에게만) — POST /api/classrooms/{id}/chat/messages (201) */
  async send(
    classroomId: string | number,
    recipientId: number,
    content: string,
  ): Promise<DirectMessage> {
    const { data } = await api.post<BackendMessage>(`/classrooms/${classroomId}/chat/messages`, {
      recipientId,
      content,
    })
    return toDirectMessage(data)
  },

  /**
   * 스레드 읽음 처리 — POST /api/classrooms/{id}/chat/threads/{peerId}/read (204).
   * **상대가 나에게 보낸 것만** 찍힌다 — 내가 보낸 메시지는 대상이 아니다.
   */
  async markRead(classroomId: string | number, peerId: number): Promise<void> {
    await api.post(`/classrooms/${classroomId}/chat/threads/${peerId}/read`)
  },
}

/**
 * 학급 교사 단톡방 — 백엔드 `chat/controller/TeacherRoomController` (f5320e7).
 *
 * 학급 하나에 방 하나이고, 그 학급의 **선생님(OWNER·MAINTAINER)만** 쓴다. 학생은 학급
 * 구성원이어도 403 이다 — 선생님끼리 아이 이야기를 나누는 자리라서다.
 *
 * ## 실시간은 개인 채널을 탄다
 *
 * 방마다 STOMP 토픽을 새로 만들지 않았다. 이미 권한이 확인된 개인 채널
 * `/user/sub/notifications` 로 `TEACHER_ROOM_MESSAGE` 가 온다(`types/realtime.ts`).
 *
 * ⚠ **보낸 사람에게는 오지 않는다.** 서버가 발신자를 푸시 대상에서 뺀다(201 응답으로 이미
 * 받았으니까). 그래서 화면은 `send` 가 돌려준 메시지를 **스스로 목록에 붙여야** 한다 —
 * 메아리를 기다리면 내가 보낸 말이 화면에 안 뜬다.
 */
export const teacherRoomApi = {
  /** 대화 전체 (**오래된 것부터**) — GET /api/classrooms/{id}/chat/teacher-room */
  async list(classroomId: string | number): Promise<DirectMessage[]> {
    const { data } = await api.get<BackendMessage[]>(
      `/classrooms/${classroomId}/chat/teacher-room`,
    )
    return data.map(toDirectMessage)
  },

  /** 요약(마지막 메시지·안 읽은 수) — GET /api/classrooms/{id}/chat/teacher-room/summary */
  async summary(classroomId: string | number): Promise<TeacherRoomSummary> {
    const { data } = await api.get<{
      classroomId: number
      lastMessage: BackendMessage | null
      unreadCount: number
    }>(`/classrooms/${classroomId}/chat/teacher-room/summary`)
    return {
      classroomId: data.classroomId,
      lastMessage: data.lastMessage ? toDirectMessage(data.lastMessage) : null,
      unreadCount: data.unreadCount,
    }
  },

  /**
   * 보내기 — POST /api/classrooms/{id}/chat/teacher-room/messages (201).
   * 2000자까지. 돌려받은 메시지를 호출부가 직접 목록에 붙인다(위 주석 참고).
   */
  async send(classroomId: string | number, content: string): Promise<DirectMessage> {
    const { data } = await api.post<BackendMessage>(
      `/classrooms/${classroomId}/chat/teacher-room/messages`,
      { content },
    )
    return toDirectMessage(data)
  },

  /**
   * 읽음 처리 — POST /api/classrooms/{id}/chat/teacher-room/read (204).
   * 시각은 서버가 찍는다(본문 없음).
   */
  async markRead(classroomId: string | number): Promise<void> {
    await api.post(`/classrooms/${classroomId}/chat/teacher-room/read`)
  },
}

function toDirectMessage(m: BackendMessage): DirectMessage {
  return { id: m.id, senderId: m.senderId, senderName: m.senderName, content: m.content, at: m.createdAt }
}
