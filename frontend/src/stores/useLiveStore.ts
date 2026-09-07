import { create } from 'zustand'

/** 실시간으로 도착한 채팅 한 줄 */
export interface LiveMessage {
  id: string
  /** 보낸 사람 userId (선생님이면 교사 id) */
  from: number
  name: string
  text: string
  at: string
  teacher: boolean
}

/**
 * 라이브 수업의 실시간 상태 — 계약 지점(Rule 5).
 *
 * 두 서비스가 각자 자기 몫만 쓴다:
 *  - `ClassroomSignaling`(LiveKit) → `onlineIdentities` / `speakingIdentities`
 *    (백엔드가 학생 프레즌스를 STOMP 로 방송하지 않으므로 **룸 참가자 목록이 유일한 출처**)
 *  - `ClassroomSocket`(STOMP)      → `handRaisedIds` / `boardGrantIds`
 *
 * identity 는 백엔드 규칙과 동일한 `teacher-{userId}` / `student-{userId}` 형식이다.
 * 네이티브 객체는 넣지 않는다(Rule 2) — 원시값과 평범한 배열만.
 */
interface LiveState {
  /**
   * join 응답이 알려준 LiveKit 접속 주소.
   * 팀 룸 방문(`.../teams/{id}/visit`)은 토큰만 주고 URL 을 주지 않아서 여기 보관해 재사용한다.
   */
  livekitUrl: string | null
  /** 지금 LiveKit 룸에 접속해 있는 사람 identity */
  onlineIdentities: string[]
  /** 지금 말하고 있는 사람 identity */
  speakingIdentities: string[]
  /** 손든 학생 userId (GET /state 스냅샷 + HAND_RAISED 증분) */
  handRaisedIds: number[]
  /** 판서 권한을 가진 학생 userId */
  boardGrantIds: number[]
  /** 마이크가 잠긴 학생 userId (GET /state.mutedMic + 교사 조작 후 갱신) */
  mutedMicIds: number[]
  /**
   * 카메라가 잠긴 학생 userId (GET /state.disabledCam + 교사 조작 후 갱신, 백엔드 -47).
   * media-controls 는 STOMP 통지가 없어(명세 v1.2) **스냅샷 재조회만이 동기화 수단**이다.
   */
  disabledCamIds: number[]
  /** 쉬는시간 화면 잠금 (GET /state.broadcastLocked + BROADCAST_LOCK) */
  broadcastLocked: boolean
  /** 수업 중 실시간으로 도착한 채팅 (이력은 REST 로 따로 불러온다) */
  liveMessages: LiveMessage[]
  /**
   * 서버가 마지막으로 돌려준 거절(STOMP ERROR 프레임).
   *
   * `send()` 의 true 는 "WebSocket 에 썼다"는 뜻일 뿐이라, 서버가 거절해도 화면은 성공으로
   * 보인다. 이 값이 갱신되면 **아직 확인되지 않은 낙관적 말풍선을 실패로 되돌리라**는 신호다.
   * `at` 은 같은 문구가 다시 와도 구독자가 변화를 알아채도록 넣는다.
   */
  lastRejection: { message: string; at: number } | null

  setLivekitUrl: (url: string) => void
  setOnlineIdentities: (identities: string[]) => void
  setSpeakingIdentities: (identities: string[]) => void
  setHandRaisedIds: (ids: number[]) => void
  /** HAND_RAISED 증분 반영 */
  setHandRaised: (userId: number, raised: boolean) => void
  setBoardGrantIds: (ids: number[]) => void
  setMutedMicIds: (ids: number[]) => void
  setDisabledCamIds: (ids: number[]) => void
  setMutedMic: (userId: number, muted: boolean) => void
  setBroadcastLocked: (locked: boolean) => void
  /** BOARD_GRANT 증분 반영 — 이벤트의 userIds 는 "이번에 바뀐 대상"이지 전체 목록이 아니다 */
  applyBoardGrant: (userIds: number[], granted: boolean) => void
  pushLiveMessage: (message: LiveMessage) => void
  /** STOMP ERROR 프레임을 받았다 (services/signaling 이 호출) */
  noteRejection: (message: string) => void
  reset: () => void
}

const EMPTY = {
  livekitUrl: null as string | null,
  onlineIdentities: [] as string[],
  speakingIdentities: [] as string[],
  handRaisedIds: [] as number[],
  boardGrantIds: [] as number[],
  mutedMicIds: [] as number[],
  disabledCamIds: [] as number[],
  broadcastLocked: false,
  liveMessages: [] as LiveMessage[],
  lastRejection: null as { message: string; at: number } | null,
}

export const useLiveStore = create<LiveState>((set) => ({
  ...EMPTY,

  setLivekitUrl: (livekitUrl) => set({ livekitUrl }),
  setOnlineIdentities: (onlineIdentities) => set({ onlineIdentities }),
  setSpeakingIdentities: (speakingIdentities) => set({ speakingIdentities }),
  setHandRaisedIds: (handRaisedIds) => set({ handRaisedIds }),

  setHandRaised: (userId, raised) =>
    set((s) => ({
      handRaisedIds: raised
        ? s.handRaisedIds.includes(userId)
          ? s.handRaisedIds
          : [...s.handRaisedIds, userId]
        : s.handRaisedIds.filter((id) => id !== userId),
    })),

  setBoardGrantIds: (boardGrantIds) => set({ boardGrantIds }),

  setMutedMicIds: (mutedMicIds) => set({ mutedMicIds }),
  setDisabledCamIds: (disabledCamIds) => set({ disabledCamIds }),
  setMutedMic: (userId, muted) =>
    set((s) => ({
      mutedMicIds: muted
        ? s.mutedMicIds.includes(userId) ? s.mutedMicIds : [...s.mutedMicIds, userId]
        : s.mutedMicIds.filter((id) => id !== userId),
    })),
  setBroadcastLocked: (broadcastLocked) => set({ broadcastLocked }),

  applyBoardGrant: (userIds, granted) =>
    set((s) => {
      const next = new Set(s.boardGrantIds)
      userIds.forEach((id) => (granted ? next.add(id) : next.delete(id)))
      return { boardGrantIds: [...next] }
    }),

  // 같은 메시지가 두 번 들어오는 것만 막고, 오래된 것은 잘라 메모리를 묶어둔다
  pushLiveMessage: (message) =>
    set((s) =>
      s.liveMessages.some((m) => m.id === message.id)
        ? s
        : { liveMessages: [...s.liveMessages, message].slice(-100) },
    ),

  noteRejection: (message) => set({ lastRejection: { message, at: Date.now() } }),

  reset: () => set({ ...EMPTY }),
}))
