import type { Participant, ServerEvent, SocketStatus } from '@/types/signaling'
import type { Role } from '@/types/auth'
import {
  pub,
  sub,
  type AssignmentPublishedPayload,
  type TeacherRoomMessagePayload,
  type DirectMessagePayload,
  type BoardClearPayload,
  type BoardGrantPayload,
  type BoardStrokeDeletedPayload,
  type BoardStrokePayload,
  type BroadcastLockPayload,
  type ChatAssignedPayload,
  type ChatPayload,
  type ChatNoticePayload,
  type ChatReplyPayload,
  type HandRaisedPayload,
  type KickedPayload,
  type MediaControlPayload,
  type SessionEndedPayload,
  type SessionStartedPayload,
  type StompEnvelope,
} from '@/types/realtime'
import { StompClient, type StompServerError, type StompStatus } from './StompClient'
import { sessionApi } from '@/services/api/sessionApi'
import { useSignalStore } from '@/stores/useSignalStore'

export interface ClassroomSocketEvents {
  onStatus?: (status: SocketStatus) => void
  /** 수업 참가자 명단(학급 구성원 = LiveKit identity 매칭표) */
  onParticipants?: (participants: Participant[]) => void
  /** 서버 이벤트 (봉투를 앱 이벤트로 번역한 결과) */
  onEvent?: (event: ServerEvent) => void
  /** 사용자에게 보여줄 안내 (재시도 중에는 오지 않는다) */
  onError?: (message: string) => void
  /**
   * 서버가 돌려준 ERROR 프레임. **낙관적 UI 를 되돌리는 신호**로 쓴다 —
   * "보냈다고 표시했는데 실제로는 거부됨"을 사용자가 알 수 있어야 한다.
   */
  onServerError?: (error: StompServerError) => void
}

export interface ConnectInfo {
  /**
   * CONNECT 헤더에 실을 accessToken **게터**. 값이 아니라 함수인 이유는 재연결마다 최신
   * 토큰을 다시 읽어야 하기 때문이다(access 30분 — 굳혀 두면 만료 뒤 영구히 실패한다).
   * REST 와 같은 저장소를 봐야 재발급이 소켓에도 반영된다.
   */
  getToken: () => string | null
  /** 내 역할 — 채팅 발행 주소가 학생/교사로 갈린다 */
  role: Role
  /** 내 userId — 내가 보낸 이벤트를 구분할 때 사용 */
  userId?: number
}

/**
 * ClassroomSocket — 수업의 앱 이벤트(제어) 채널. 백엔드 STOMP(`/ws`)를 감싼다. (SRP, no React)
 *
 * 미디어(카메라/화면)는 LiveKit(`ClassroomSignaling`)이 담당하고, 이 소켓은 손들기·채팅·
 * 판서·수업 시작/종료 같은 제어 이벤트만 다룬다. 백엔드가 LiveKit 토큰에 canPublishData=false 를
 * 주므로 **앱 이벤트는 반드시 이 STOMP 채널로만** 오간다.
 *
 * 두 단계로 붙는다:
 *  1. `connect()` — 접속 + 개인 채널(`/user/sub/notifications`) 구독. 아직 수업이 없어도
 *     여기서 SESSION_STARTED 를 받으므로, 학생은 이 상태로 수업 시작을 기다린다.
 *  2. `setSession(id)` — 수업 게시판(`/sub/sessions/{id}`) 구독 + 참가자 명단 로드.
 *
 * 서버 봉투 { type, payload, at } 는 UI 가 이미 쓰고 있는 평평한 `ServerEvent` 로 번역해서
 * 내보낸다(아래 translate). 그래서 스토어/컴포넌트는 전송 방식이 바뀐 것을 몰라도 된다.
 */
export class ClassroomSocket {
  private stomp: StompClient
  private events: ClassroomSocketEvents
  private info: ConnectInfo | null = null
  private sessionId: number | null = null
  /** userId -> 이름. 서버는 studentId 만 주므로 명단으로 사람 이름을 되돌린다. */
  private names = new Map<number, string>()

  constructor(events: ClassroomSocketEvents = {}) {
    this.events = events
    this.stomp = new StompClient({
      onStatus: (s) => this.events.onStatus?.(toSocketStatus(s)),
      onError: (m) => this.events.onError?.(m),
      onServerError: (e) => this.events.onServerError?.(e),
      // 재접속 때마다 명단을 다시 맞춘다(그 사이 학생이 늘었을 수 있다).
      onConnected: () => {
        if (this.sessionId !== null) void this.loadRoster(this.sessionId)
        /*
          명단만으로는 부족하다. 브로커가 simple broker 라 끊긴 동안의 메시지를 재전송하지
          않으므로, 판서·교사 쪽지처럼 **누적 상태를 들고 있는 화면**도 다시 맞춰야 한다.
          여기서 신호만 올리고, 무엇을 다시 불러올지는 각 화면이 정한다.
        */
        useSignalStore.getState().markReconnected()
      },
    })
  }

  get connected(): boolean {
    return this.stomp.connected
  }

  /** 접속 + 개인 채널 구독. 수업 id 는 아직 몰라도 된다. */
  connect(info: ConnectInfo): void {
    if (this.info) return
    this.info = info
    // 개인 채널은 세션과 무관하게 항상 열어둔다 (수업 시작 알림/답장/상담 배정)
    this.stomp.subscribe(sub.notifications(), (env) => this.dispatch(env))
    this.stomp.connect(info.getToken)
  }

  /**
   * 구독할 수업을 지정/해제한다. 학생은 SESSION_STARTED 를 받은 뒤 여기로 들어온다.
   * 같은 id 로 다시 부르면 아무 일도 하지 않는다.
   */
  setSession(sessionId: number | null): void {
    if (this.sessionId === sessionId) return
    if (this.sessionId !== null) this.stomp.unsubscribe(sub.session(this.sessionId))
    this.sessionId = sessionId
    this.names.clear()
    if (sessionId === null) {
      this.events.onParticipants?.([])
      return
    }
    // [hand] 진단 로그 — 선생님이 이 수업 채널을 실제로 구독했는지 확인용. 원인이 잡히면 지운다.
    console.info('[hand] 수업 채널 구독', sub.session(sessionId), 'role=', this.info?.role)
    this.stomp.subscribe(sub.session(sessionId), (env) => this.dispatch(env))
    void this.loadRoster(sessionId)
  }

  /**
   * 앱 이벤트 발행 (UI 가 쓰는 기존 이름 그대로 받아 STOMP destination 으로 번역).
   * 백엔드에 대응 발행구가 없는 이벤트(MEDIA_COMMAND 등)는 조용히 무시한다.
   *
   * **보냈는지 여부를 돌려준다.** 예전엔 수업 미지정·소켓 미연결이면 조용히 버려서, 학생은
   * "손을 들었어요" 토스트만 보고 선생님에겐 아무것도 안 갔다.
   */
  send(event: string, payload: Record<string, unknown> = {}): boolean {
    const sessionId = this.sessionId
    if (sessionId === null) {
      this.events.onError?.('아직 수업이 시작되지 않았어요.')
      return false
    }
    switch (event) {
      case 'HAND_RAISED':
        // 백엔드는 본문 없는 토글 — studentId 는 CONNECT 때 인증된 사용자로 서버가 정한다
        return this.stomp.publish(pub.hand(sessionId))

      case 'CHAT_MESSAGE': {
        const content = String(payload.message ?? '')
        if (!content) return false
        if (this.info?.role === 'TEACHER') {
          return this.stomp.publish(pub.reply(sessionId), {
            studentId: payload.studentId,
            content,
            replyToId: payload.replyToId ?? null,
          })
        }
        return this.stomp.publish(pub.message(sessionId), { content })
      }

      case 'BOARD_STROKE':
        return this.stomp.publish(pub.boardStroke(sessionId), payload)

      case 'BOARD_STROKE_DELETE':
        return this.stomp.publish(pub.boardStrokeDelete(sessionId), payload)

      case 'BOARD_CLEAR':
        return this.stomp.publish(pub.boardClear(sessionId))

      default:
        // 앱 전용 이벤트 이름(MEDIA_COMMAND / BREAK_LOCK_CHANGED 등)은 STOMP 로 올려보내지
        // 않는다 — 미디어 제어는 REST(`sessionApi.mediaControls`), 화면 잠금도 REST 다.
        return false
    }
  }

  disconnect(): void {
    this.stomp.disconnect()
    this.info = null
    this.sessionId = null
    this.names.clear()
  }

  /** 참가자 명단(REST) — 이름 매핑과 학생 목록 표시에 쓴다. */
  private async loadRoster(sessionId: number): Promise<void> {
    try {
      const roster = await sessionApi.listParticipants(sessionId)
      if (this.sessionId !== sessionId) return // 그 사이 수업이 바뀌면 버린다
      this.names = new Map(roster.map((p) => [p.userId, p.name]))
      this.events.onParticipants?.(
        roster.map((p) => ({
          participantId: identityOf(p.role, p.userId),
          userId: p.userId,
          name: p.name,
          role: p.role,
          teamId: p.teamId,
        })),
      )
    } catch {
      /* 명단 실패는 치명적이지 않다 — 이름 없이 id 로 표시된다 */
    }
  }

  private nameOf(userId: number | undefined): string | undefined {
    return userId === undefined ? undefined : this.names.get(userId)
  }

  /** 백엔드 봉투 → UI 가 소비하는 평평한 ServerEvent */
  private dispatch(env: StompEnvelope): void {
    const translated = this.translate(env)
    if (translated) this.events.onEvent?.(translated)
  }

  private translate(env: StompEnvelope): ServerEvent | null {
    const at = env.at
    switch (env.type) {
      case 'HAND_RAISED': {
        const p = env.payload as unknown as HandRaisedPayload & {
          userId?: number
          senderId?: number
        }
        /*
          누구인지는 `studentId` 가 원천이지만 `userId`·`senderId` 도 받아 준다.

          이 값이 비면 `String(undefined)` 가 `"undefined"` 라는 **참인 문자열**이 되고, 받는 쪽이
          `Number()` 로 바꿔 `NaN` 을 스토어에 넣는다. 그러면 토스트는 뜨는데 어느 학생인지
          몰라 **타일의 손 배지만 조용히 안 뜬다** — 원인을 찾기 가장 어려운 형태의 고장이다.
          백엔드가 필드 이름을 바꿔도 여기서 흡수한다.
        */
        const studentId = p.studentId ?? p.userId ?? p.senderId
        // [hand] 진단 로그 — 손들기 알림이 선생님에게 안 온다는 제보 추적용. 원인이 잡히면 지운다.
        console.info('[hand] STOMP 수신', { payload: p, studentId, raised: p.raised })
        return {
          event: 'HAND_RAISED',
          occurredAt: at,
          studentId: studentId === undefined ? undefined : String(studentId),
          studentName: this.nameOf(studentId) ?? '학생',
          raised: p.raised,
        }
      }

      case 'SESSION_STARTED': {
        const p = env.payload as unknown as SessionStartedPayload
        return {
          event: 'SESSION_STARTED',
          occurredAt: at,
          sessionId: p.sessionId,
          classroomId: p.classroomId,
        }
      }

      case 'SESSION_ENDED': {
        const p = env.payload as unknown as SessionEndedPayload
        /*
          `classroomId` 를 함께 올린다. 개인 채널로 오는 종료 알림에는 서버가 이 값을 싣는데
          예전에는 여기서 버려서, 학급을 여럿 맡은 선생님 화면이 **남의 학급 수업이 끝나도**
          자기 목록을 다시 받았다. 수업 토픽으로 온 것에는 이 값이 없고, 그때는 이미 그 방을
          구독한 사람만 받으므로 없는 채로 통과시켜도 맞다.
        */
        return {
          event: 'SESSION_ENDED',
          occurredAt: at,
          sessionId: p.sessionId,
          classroomId: p.classroomId,
        }
      }

      // 학생이 보낸 질문이 담당 선생님에게 배달된 것 (payload.from = 학생 userId)
      case 'CHAT': {
        const p = env.payload as unknown as ChatPayload
        return {
          event: 'CHAT_MESSAGE',
          occurredAt: at,
          senderRole: 'STUDENT',
          /*
            **서버가 준 이름을 먼저 쓴다.** 참가자 명단(`nameOf`)은 수업을 구독해야 채워지는데,
            이 알림은 개인 채널로 와서 명단보다 먼저 도착할 수 있다. 그때 이름이 비어
            토스트가 "학생 학생이 질문했어요"로 떴다.
          */
          senderName: p.fromName ?? this.nameOf(p.from) ?? '학생',
          senderId: p.from,
          studentId: String(p.from),
          message: p.content,
        }
      }

      /*
        선생님 답장이 학생에게 배달된 것. payload 는 `{ from, content }` 뿐이고 **studentId 가
        없다** — 받는 사람이 나 자신이니 서버가 안 넣는다. 예전엔 studentId 를 읽어 0 으로
        떨어뜨렸고, 그 0 이 중복 제거 키와 말풍선 주인 판정에 그대로 섞였다.
        `from` 은 **보낸 선생님의 userId** 다 — senderId 로 정직하게 올린다.
      */
      case 'CHAT_REPLY': {
        const p = env.payload as unknown as ChatReplyPayload
        return {
          event: 'CHAT_MESSAGE',
          occurredAt: at,
          senderRole: 'TEACHER',
          senderName: this.nameOf(p.from) ?? '선생님',
          senderId: p.from,
          message: p.content,
        }
      }

      /*
        CHAT_ASSIGNED 만 payload 모양이 다르다 — `{ teacherId }` 이고 message 가 없다.
        (ChatRouterService.java:61, 98) 안내 문구는 명단에서 이름을 되찾아 여기서 만든다.
      */
      case 'CHAT_ASSIGNED': {
        const p = env.payload as unknown as ChatAssignedPayload
        const name = this.nameOf(p.teacherId)
        return {
          event: 'CHAT_ASSIGNED',
          occurredAt: at,
          teacherId: p.teacherId,
          senderName: name,
          message: name ? `${name} 선생님과 연결됐어요` : '선생님과 연결됐어요',
        }
      }

      case 'CHAT_WAITING':
      case 'CHAT_ENDED': {
        const p = env.payload as unknown as ChatNoticePayload
        return { event: env.type, occurredAt: at, message: p.message }
      }

      case 'BOARD_STROKE': {
        const p = env.payload as unknown as BoardStrokePayload
        return { event: 'BOARD_STROKE', occurredAt: at, by: p.by, stroke: p.stroke }
      }

      case 'BOARD_STROKE_DELETED': {
        const p = env.payload as unknown as BoardStrokeDeletedPayload
        return { event: 'BOARD_STROKE_DELETED', occurredAt: at, by: p.by, strokeId: p.strokeId }
      }

      case 'BOARD_CLEAR': {
        const p = env.payload as unknown as BoardClearPayload
        return { event: 'BOARD_CLEAR', occurredAt: at, by: p.by }
      }

      case 'BROADCAST_LOCK': {
        const p = env.payload as unknown as BroadcastLockPayload
        return { event: 'BROADCAST_LOCK', occurredAt: at, by: p.by, locked: p.locked }
      }

      case 'BOARD_GRANT': {
        const p = env.payload as unknown as BoardGrantPayload
        return {
          event: 'BOARD_GRANT',
          occurredAt: at,
          target: p.target,
          action: p.action,
          userIds: p.userIds,
        }
      }

      /*
        KICKED — 수업 중 강퇴 (백엔드 SessionKickService, S15P11A407-137).

        **개인 채널이 아니라 세션 토픽으로 온다** — 그 수업을 구독한 모두가 받는다.
        그래서 payload 의 대상자를 반드시 올려보내야 한다. 예전엔 payload 를 버리고
        `{ event: 'KICKED' }` 만 돌려줘서, 한 명을 내보내면 **그 수업 학생 전원이
        로그아웃됐다**(받는 쪽이 자기가 대상인지 가릴 근거가 아예 없었다).

        대상은 한 명이지만 `userIds` 에 담는다 — MEDIA_CONTROL·BOARD_GRANT 와 같은
        "내가 그 안에 있나" 한 가지 판정으로 통일해, 받는 쪽이 가드를 빼먹기 어렵게 한다.
      */
      case 'KICKED': {
        const p = env.payload as unknown as KickedPayload
        return { event: 'KICKED', occurredAt: at, userIds: [p.userId], by: p.by }
      }

      /*
        과제 공개 — 개인 알림함(`/user/sub/notifications`)으로 온다. 수업 중이 아니어도
        받으므로 세션 구독과 무관하고, 이미 열려 있는 개인 채널을 그대로 쓴다.
        payload 의 classroomId 를 그대로 올려 보내면 학생 화면이 **자기 학급의 것일 때만**
        과제 목록을 다시 받는다 (여러 학급에 속한 계정에서 남의 학급 알림에 반응하지 않게).
      */
      /*
        선생님이 마이크/카메라를 잠그거나 풀었다. `userIds` 에 실제 적용 대상이 담겨 오므로
        받는 쪽은 target 해석 없이 "내가 그 안에 있나"만 보면 된다.
      */
      /*
        MEDIA_REQUEST 는 같은 payload 지만 **뜻이 반대다** — 아직 아무것도 안 바뀌었고,
        "켜 줄래?" 하고 묻는 것이다(서버는 브라우저 장치를 강제로 켤 수 없다).
        그래서 상태를 갱신하지 말고 대상 학생에게 안내만 띄워야 한다 — event 로 갈라 보낸다.
      */
      case 'MEDIA_CONTROL':
      case 'MEDIA_REQUEST': {
        const p = env.payload as unknown as MediaControlPayload
        return {
          event: env.type,
          occurredAt: at,
          target: p.target,
          mediaAction: p.action,
          userIds: p.userIds ?? [],
        }
      }

      case 'ASSIGNMENT_PUBLISHED': {
        const p = env.payload as unknown as AssignmentPublishedPayload
        return {
          event: 'ASSIGNMENT_PUBLISHED',
          occurredAt: at,
          classroomId: p.classroomId,
          assignmentId: p.assignmentId,
        }
      }

      /*
        교사 단톡방 새 메시지 — 개인 채널로 온다(전용 토픽이 없다).

        **보낸 사람에게는 오지 않는다**(서버가 발신자를 대상에서 뺀다). 그래서 화면은 보낸
        메시지를 201 응답으로 직접 붙이고, 이 이벤트는 **남이 보낸 것**만 실어 온다.
        `occurredAt` 대신 메시지의 `createdAt` 을 쓴다 — 목록의 시간 정렬 기준이 그쪽이다.
      */
      case 'TEACHER_ROOM_MESSAGE': {
        const p = env.payload as unknown as TeacherRoomMessagePayload
        if (!p?.message) return null
        return {
          event: 'TEACHER_ROOM_MESSAGE',
          occurredAt: p.message.createdAt ?? at,
          classroomId: p.classroomId,
          messageId: p.message.id,
          senderId: p.message.senderId,
          senderName: p.message.senderName,
          message: p.message.content,
        }
      }

      /*
        1:1 쪽지 도착 — 개인 채널로 온다. 봉투 모양이 단톡방과 같아 같은 방식으로 푼다.

        `senderId` 를 그대로 실어 보낸다: 받는 쪽은 **누구와의 대화에 붙일지** 정해야 하는데,
        단톡방은 방이 하나뿐이라 학급 id 로 충분했지만 쪽지는 상대별로 갈린다.
      */
      case 'DIRECT_MESSAGE': {
        const p = env.payload as unknown as DirectMessagePayload
        if (!p?.message) return null
        return {
          event: 'DIRECT_MESSAGE',
          occurredAt: p.message.createdAt ?? at,
          classroomId: p.classroomId,
          messageId: p.message.id,
          senderId: p.message.senderId,
          senderName: p.message.senderName,
          message: p.message.content,
        }
      }

      default:
        return null
    }
  }
}

/** LiveKit identity 규칙 — 백엔드 SessionTicketService.identity() 와 반드시 일치 */
export function identityOf(role: Role, userId: number): string {
  return `${role === 'TEACHER' ? 'teacher' : 'student'}-${userId}`
}

function toSocketStatus(status: StompStatus): SocketStatus {
  return status === 'closed' ? 'closed' : (status as SocketStatus)
}
