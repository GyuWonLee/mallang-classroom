import { create } from 'zustand'
import { parseNotice } from '@/lib/notice'
import { hhmm } from '@/lib/chatTime'
import type { ServerEvent } from '@/types/signaling'

/**
 * 학생 화면의 선생님과 주고받은 쪽지 한 줄.
 *
 * `from` 이 있는 이유: 학생도 자기가 뭐라고 보냈는지 봐야 대화가 된다. 예전엔 선생님이 보낸
 * 것만 담아서 내가 보낸 말이 화면에 남지 않았다.
 * 정렬은 **오래된 것이 위**(메신저 관례) — 새 쪽지는 아래에 쌓이고 스크롤이 따라 내려간다.
 */
export interface TeacherMessage {
  id: string
  text: string
  time: string
  from: 'teacher' | 'me'
}

/*
  여기에 `status?: 'sending' | 'sent' | 'failed'` 가 있었는데 **지웠다.**

  주석은 "보낸 직후 sending 으로 두고 유예 시간 안에 ERROR 프레임이 오면 failed 로 되돌린다"
  고 설명했지만 값을 넣는 코드가 없어 항상 undefined 였고, 읽는 화면도 없었다. 게다가 제대로
  구현할 수도 없다 — 백엔드에 ack 도 correlation id 도 없어서 "내 send 직후 N ms 안에 온
  ERROR = 그 쪽지의 실패"라는 추측밖에 안 되고, 무관한 구독 거절 하나가 정상 쪽지를 failed 로
  표시한다. 구현되지 않은 안전장치를 설명하는 주석은 없는 것보다 나쁘다(있다고 믿게 된다).

  지금 실패를 막는 것은 발행 성공 여부를 확인하는 호출부다 — TeacherMessages.submit 참고.

  `ChatStatus` 타입도 함께 지웠다. 상담 대기/배정/종료는 상태로 들고 있지 않고
  ClassroomPage 가 알림 스택(useNoticeStore)으로 그때그때 보여준다.
*/

/** 발행 결과를 돌려준다 — false 면 못 보냈다(수업 미시작·소켓 미연결). 호출한 쪽이 안내해야 한다. */
type SendFn = (event: string, payload?: Record<string, unknown>) => boolean

/**
 * 실시간 시그널 버스 — 페이지(소켓 소유자)와 하위 컴포넌트를 잇는 얇은 store.
 *
 * 학생 페이지가 소켓의 send 를 여기 등록하면, 손들기 버튼·채팅 등 하위 컴포넌트가
 * prop drilling 없이 send('HAND_RAISED', …) 를 호출할 수 있다.
 * 선생님→학생 방향 이벤트(강제 음소거/수업종료/쪽지)는 applyEvent 로 받아 플래그로 노출한다.
 */
interface SignalState {
  send: SendFn
  setSend: (fn: SendFn) => void
  /**
   * 소켓이 (재)연결될 때마다 1씩 오르는 값. **재동기화가 필요한 화면의 신호등이다.**
   *
   * STOMP 브로커가 simple broker 라 끊긴 동안 온 메시지를 재전송해 주지 않는다. 그래서
   * 절전 복귀·AP 로밍으로 5초만 끊겨도 그 사이의 판서 획과 교사 쪽지가 영영 반영되지
   * 않았다. 판서 복원 effect 의 의존성이 `[sessionId]` 하나뿐이라 재접속에 반응하지
   * 못한 것이 원인이다. 이 값을 의존성에 함께 넣으면 재접속마다 다시 맞춘다.
   */
  resyncTick: number
  /** 소켓이 연결됐음을 알린다(ClassroomSocket.onConnected 에서 호출) */
  markReconnected: () => void

  /**
   * 선생님이 내 마이크를 잠근 상태.
   *
   * **이제 실제로 채워진다.** 백엔드가 `MEDIA_CONTROL` STOMP 를 발행하고(MediaControlService,
   * 명세 v1.4) `useClassroomSocket` 이 그걸 받아 세운다. 예전에는 발행부가 없어 항상 false 였고,
   * 그래서 아래 잠금 가드 전체가 죽은 코드였다 — 학생 화면은 마이크가 서버에서 꺼진 줄도
   * 모르고 버튼을 "켜짐"으로 보여줬다.
   */
  forcedMute: boolean
  /** 선생님이 내 카메라를 잠근 상태 (마이크와 같은 이벤트로 온다) */
  forcedCameraOff: boolean
  /** MEDIA_CONTROL 반영 — 내가 대상일 때만 부른다 */
  setForcedMedia: (patch: { mic?: boolean; cam?: boolean }) => void
  /** 수업 종료됨 */
  sessionEnded: boolean
  /** 선생님과 주고받은 쪽지들 (오래된 것부터) */
  teacherMessages: TeacherMessage[]

  /** 이력(GET /me/messages)으로 쪽지함 초기화 — 실시간 수신분은 뒤에 쌓인다 */
  setTeacherMessages: (messages: TeacherMessage[]) => void
  /**
   * 내가 방금 보낸 쪽지를 화면에 바로 남긴다.
   * 학생이 보낸 메시지는 서버가 **담당 선생님에게만** 배달하고 보낸 학생에게 되돌려주지 않아서
   * (`/pub/sessions/{id}/messages` -> 교사 개인 채널), 낙관적으로 직접 넣어야 한다.
   */
  pushMyMessage: (text: string) => void
  /** 서버 이벤트를 학생 관점 상태로 반영 (목업 소켓은 제거됐다 — 전부 실서버 STOMP다) */
  applyEvent: (event: ServerEvent) => void
  reset: () => void
}

const noop: SendFn = () => false

/** 쪽지를 목록 끝에 붙인다 (오래된 것이 위). 오래된 쪽지는 잘라 메모리를 묶어 둔다. */
const MAX_MESSAGES = 60
function appendMessage(
  list: TeacherMessage[],
  text: string,
  from: TeacherMessage['from'],
): TeacherMessage[] {
  const msg: TeacherMessage = {
    id: `${Date.now()}-${Math.random()}`,
    text,
    // 초를 넣지 않는다 — 분 단위 묶음(lib/chatTime)이 초 때문에 깨진다
    time: hhmm(new Date()),
    from,
  }
  return [...list, msg].slice(-MAX_MESSAGES)
}

export const useSignalStore = create<SignalState>((set) => ({
  send: noop,
  setSend: (fn) => set({ send: fn }),
  resyncTick: 0,
  markReconnected: () => set((st) => ({ resyncTick: st.resyncTick + 1 })),

  forcedMute: false,
  forcedCameraOff: false,
  sessionEnded: false,
  teacherMessages: [],

  setForcedMedia: ({ mic, cam }) =>
    set((s) => ({
      forcedMute: mic ?? s.forcedMute,
      forcedCameraOff: cam ?? s.forcedCameraOff,
    })),

  setTeacherMessages: (teacherMessages) => set({ teacherMessages }),

  pushMyMessage: (text) =>
    set((state) => ({
      teacherMessages: appendMessage(state.teacherMessages, text, 'me'),
    })),

  applyEvent: (event) =>
    set((state) => {
      switch (event.event) {
        case 'SESSION_ENDED':
          return { sessionEnded: true }
        case 'SESSION_STARTED':
          return { sessionEnded: false }
        case 'CHAT_MESSAGE': {
          // 선생님 답장만 여기서 받는다 (내가 보낸 건 pushMyMessage 로 이미 들어가 있다)
          if (event.senderRole !== 'TEACHER') return {}
          /*
            전체 공지는 표식(`[공지] `)을 달고 온다 — 서버에 공지 타입이 없어서 만든 프론트 규약
            (lib/notice). 쪽지함에는 **표식을 벗긴 본문**만 남긴다.
          */
          const { text } = parseNotice(event.message ?? '')
          return { teacherMessages: appendMessage(state.teacherMessages, text, 'teacher') }
        }
        default:
          return {}
      }
    }),

  reset: () =>
    set({ forcedMute: false, forcedCameraOff: false, sessionEnded: false, teacherMessages: [] }),
}))
