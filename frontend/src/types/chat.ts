/** 채팅 도메인 타입 — api-spec.md 6장 (Chat). 전송은 STOMP, REST 는 이력 조회용 */

import type { Role } from '@/types/auth'

/**
 * 저장된 채팅 메시지 (DB 이력).
 *
 * **한 줄에 든 id 는 "보낸 사람" 하나뿐이다.** 예전에는 이 자리에 `studentId` 가 있었는데,
 * 화면은 그 값을 "누구와의 대화인지"로 읽었다. 학생이 보낸 줄은 둘이 같은 사람이라 맞았지만
 * 선생님이 보낸 줄은 대화 상대가 사라져, **내가 보낸 말이 아무 대화방에도 안 뜨는** 원인이 됐다.
 * 이제 둘을 갈라 둔다 — 대화 상대는 `lib/chatMessage` 의 `chatPeerId` 가 계산한다.
 */
export interface ChatMessageDto {
  id: number
  /** 수업 밖 1:1 대화면 null 이다 (백엔드 V14) */
  sessionId: number | null
  /** 보낸 사람 */
  senderId: number
  senderName: string
  /**
   * 보낸 사람의 **역할** — 백엔드 `MessageResponse.senderRole` (04a2c64).
   *
   * 말풍선을 어느 쪽에 붙일지는 이 값이 아니라 내 userId 로 정한다(`isMine`) — 그게 더
   * 직접적인 근거다. 이 값이 필요한 곳은 따로 있다: **학급에 선생님이 여럿일 때**
   * (OWNER + MAINTAINER) 다른 선생님이 보낸 줄을 학생 줄과 구별하는 자리다.
   * 없으면 동료 선생님이 학생 인박스에 학생처럼 한 칸 생긴다.
   *
   * 옛 데이터·다른 엔드포인트를 위해 nullable 로 둔다 — **모를 때 'STUDENT' 로 메우지 않는다**
   * (선생님을 학생으로 단정하는 쪽이 판단을 보류하는 것보다 나쁘다).
   */
  senderRole: Role | null
  /**
   * **받는 사람** — 이 줄이 누구와의 대화인지의 직접적인 근거.
   *
   * 백엔드가 수업 채팅에도 recipient 를 저장하기 시작해서(요청 반영) 이제 서버가 준다.
   * 예전에는 이 값이 없어 답장 사슬(`replyToSenderId`)로 상대를 역산했고, 그래서
   * **선생님이 먼저 건 메시지는 새로고침하면 사라졌다** — 상대를 가리키는 값이 아무것도
   * 없어서 화면이 그 줄을 버려야 했다.
   *
   * 옛 데이터에는 없을 수 있어 nullable 로 둔다 (그때는 `replyToSenderId` 로 폴백).
   */
  recipientId: number | null
  /** 답장이면 원본 메시지 id */
  replyToId: number | null
  /**
   * 답장 원본을 **보낸 사람** — 같은 응답 안에서 `replyToId` 로 찾아 채운다(chatApi).
   *
   * `recipientId` 가 생긴 뒤로는 **옛 데이터용 보조 수단**이다. recipient 를 저장하기 전에
   * 쌓인 메시지에는 상대가 없으므로, 그 줄들은 여전히 답장 사슬로만 상대를 알 수 있다.
   * 답장이 아니거나 원본이 응답에 없으면 null.
   */
  replyToSenderId: number | null
  text: string
  at: string
}

// ── 수업 밖 1:1 대화 (백엔드 S15P11A407-137 §11.1 #3·#4, V14) ──────────────────

/**
 * 대화 목록 한 줄 (GET /me/chat/threads).
 *
 * 수업 채팅과 달리 **수업(session)에 매이지 않는다** — 같은 학급 구성원끼리면 수업이
 * 없어도 주고받는다. 정렬은 서버가 정한다: 안 읽은 것이 위, 그 안에서는 최근 것이 위.
 */
export interface DirectThread {
  classroomId: number
  peerId: number
  peerName: string
  lastContent: string
  lastAt: string
  /** **나에게 온 것 중** 안 읽은 수 — 내가 보낸 것은 세지 않는다 */
  unreadCount: number
}

/** 수업 밖 1:1 메시지 한 줄 (GET /classrooms/{id}/chat/threads/{peerId} — 오래된 것부터) */
export interface DirectMessage {
  id: number
  senderId: number
  senderName: string
  content: string
  at: string
}

// ── 학급 교사 단톡방 (백엔드 f5320e7) ─────────────────────────────────

/**
 * 교사 단톡방 요약 (GET /classrooms/{id}/chat/teacher-room/summary).
 *
 * 1:1 대화(`DirectThread`)와 달리 **상대가 없다** — 학급의 선생님 전원이 한 방을 쓴다.
 * 그래서 `peerId` 자리에 해당하는 것이 없고 학급 하나당 방 하나다.
 */
export interface TeacherRoomSummary {
  classroomId: number
  /** 아직 아무도 말하지 않았으면 null */
  lastMessage: DirectMessage | null
  /** 마지막으로 읽은 시각 이후 **남이 보낸** 메시지 수 */
  unreadCount: number
}
