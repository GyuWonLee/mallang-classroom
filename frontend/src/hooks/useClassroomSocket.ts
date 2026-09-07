import { useCallback, useEffect, useRef, useState } from 'react'
import { ClassroomSocket } from '@/services/signaling/ClassroomSocket'
import { useAuthStore } from '@/stores/useAuthStore'
import { useLiveStore } from '@/stores/useLiveStore'
import { useSignalStore } from '@/stores/useSignalStore'
import { useToastStore } from '@/stores/useToastStore'
import { getAccessToken } from '@/services/api/client'
import { sessionApi } from '@/services/api/sessionApi'
import { boardBus } from '@/services/signaling/boardBus'
import type { BoardStrokeData } from '@/services/media/ScreenAnnotator'
import type { Participant, ServerEvent, SocketStatus } from '@/types/signaling'

interface UseClassroomSocketOptions {
  /** 구독할 수업 id. null 이면 개인 채널만 열고 수업 시작(SESSION_STARTED)을 기다린다. */
  sessionId: number | null
  /** 번역된 서버 이벤트를 페이지에서 라우팅 */
  onEvent?: (event: ServerEvent) => void
}

/**
 * 수업 제어 채널 Controller — ClassroomSocket(STOMP)과 UI를 잇는다.
 *
 * 로그인 상태면 마운트 시 바로 접속해 개인 채널을 열고, sessionId 가 정해지면 그 수업
 * 게시판을 구독한다. 손들기/판서 스냅샷은 접속 시 `GET /sessions/{id}/state` 로 복원하고,
 * 이후 STOMP 증분 이벤트로 갱신한다(재접속해도 상태가 어긋나지 않는다).
 */
export function useClassroomSocket({ sessionId, onEvent }: UseClassroomSocketOptions) {
  const socketRef = useRef<ClassroomSocket | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const [status, setStatus] = useState<SocketStatus>('idle')
  const [participants, setParticipants] = useState<Participant[]>([])
  /**
   * BROADCAST_LOCK 을 몇 번 받았는지. 스냅샷(REST)은 구독보다 늦게 도착하므로,
   * 요청 중에 잠금 이벤트가 오면 **더 오래된 스냅샷 값으로 되돌아가는** 문제가 있었다
   * (학생이 재접속하는 순간 선생님이 잠그면 그 학생만 잠금이 풀린 채로 남는다).
   * 요청 전후로 이 값이 달라졌으면 스냅샷의 잠금 필드는 버린다.
   */
  const lockSeqRef = useRef(0)

  const user = useAuthStore((s) => s.user)
  const setHandRaised = useLiveStore((s) => s.setHandRaised)
  const setHandRaisedIds = useLiveStore((s) => s.setHandRaisedIds)
  const setBoardGrantIds = useLiveStore((s) => s.setBoardGrantIds)
  const applyBoardGrant = useLiveStore((s) => s.applyBoardGrant)
  const pushLiveMessage = useLiveStore((s) => s.pushLiveMessage)

  if (!socketRef.current) {
    socketRef.current = new ClassroomSocket({
      onStatus: setStatus,
      onParticipants: setParticipants,
      // 예전엔 이 콜백을 아무도 안 걸어서 발행 실패·STOMP 오류가 전부 조용히 사라졌다
      onError: (message) => useToastStore.getState().show(message),
      onEvent: (event) => {
        // 손들기는 스토어가 진실의 원천 — 페이지 라우팅과 별개로 항상 반영한다
        if (event.event === 'HAND_RAISED') {
          const raised = event.raised !== false
          const role = useAuthStore.getState().user?.role
          const id = Number(event.studentId)
          // [hand] 진단 로그 — 어디서 끊기는지 보려고 남긴다. 원인이 잡히면 지운다.
          console.info('[hand] 이벤트 처리', { studentId: event.studentId, id, raised, role })

          /*
            **id 를 못 알아도 알림은 띄운다.**

            예전엔 `event.studentId` 가 있을 때만 이 블록에 들어와서, 백엔드가 그 필드를 빼거나
            이름을 바꾸면 손든 사실 자체가 조용히 사라졌다 — 선생님에게는 "알림이 안 온다" 로만
            보인다. 이름을 몰라 '학생' 이라고 적히더라도 **손을 들었다는 사실이 먼저**다.
          */
          if (Number.isFinite(id)) setHandRaised(id, raised)

          /*
            선생님에게는 토스트로도 알린다. 손들기 UI 는 학생 타일의 손 배지와 배너뿐이라
            다른 화면(학급 관리·채팅)에 있으면 아무 신호가 없었다.
          */
          if (raised && role === 'TEACHER') {
            const name = event.studentName ?? event.senderName ?? '학생'
            useToastStore.getState().show(`✋ ${name} 학생이 손을 들었어요`)
          }
        }
        /*
          선생님이 내 마이크/카메라를 잠갔거나 풀었다.

          `userIds` 는 서버가 풀어 놓은 **실제 적용 대상**이라 target 을 해석할 필요가 없다.
          내가 그 안에 있을 때만 반영한다 — 이게 없으면 학생 화면은 서버에서 마이크가 꺼진
          줄도 모르고 버튼을 "켜짐"으로 보여주고, 아이의 첫 클릭이 "끄기"로 해석돼
          두 번째 클릭에서야 unmute 를 시도하게 된다.

          선생님 자신에게도 이 이벤트가 오지만 `userIds` 는 학생 id 라 자연히 걸러진다.
        */
        if (event.event === 'MEDIA_CONTROL' && event.mediaAction) {
          const me = useAuthStore.getState().user?.id
          // [media-lock] 진단 로그 — 잠금 해제가 학생에게 안 닿는 문제를 쫓는 중. 원인이 잡히면 지운다.
          console.info('[media-lock] MEDIA_CONTROL', event.mediaAction, 'userIds=', event.userIds, 'me=', me)
          if (me !== undefined && (event.userIds ?? []).includes(me)) {
            const { setForcedMedia } = useSignalStore.getState()
            switch (event.mediaAction) {
              case 'MUTE_MIC':
                setForcedMedia({ mic: true })
                break
              case 'UNLOCK_MIC':
                setForcedMedia({ mic: false })
                break
              case 'DISABLE_CAM':
                setForcedMedia({ cam: true })
                break
              case 'UNLOCK_CAM':
                setForcedMedia({ cam: false })
                break
            }
          } else if (
            me !== undefined &&
            sessionId !== null &&
            useAuthStore.getState().user?.role !== 'TEACHER'
          ) {
            /*
              **스냅샷 폴백** — 내가 `userIds` 에 없어도 그냥 넘기지 않는다.

              잠금(MUTE/DISABLE)은 잘 되는데 해제(UNLOCK)만 학생에게 안 닿는 증상의 유력한
              원인이 이 필터였다: 서버가 해제 이벤트의 `userIds` 를 비우거나 일부만 채우면,
              학생은 자기가 풀린 줄 모르고 `forcedCameraOff` 가 영영 남는다 — 셀프뷰도 안
              돌아오고 재발행도 시작되지 않는다. 이벤트 내용 대신 **상태 스냅샷(GET /state)** 을
              원천으로 다시 읽으면 서버가 이벤트를 어떻게 채우든 어긋나지 않는다.
              (교사는 자기 훅이 따로 스냅샷을 읽으므로 제외한다)
            */
            void sessionApi
              .getState(sessionId)
              .then((state) => {
                const mic = state.mutedMic.includes(me)
                const cam = state.disabledCam.includes(me)
                console.info('[media-lock] snapshot fallback → mic=', mic, 'cam=', cam)
                useSignalStore.getState().setForcedMedia({ mic, cam })
              })
              .catch(() => {
                /* 스냅샷 실패는 화면을 막지 않는다 — 다음 이벤트나 재접속 때 맞춰진다 */
              })
          }
        }
        // 판서는 캔버스가 직접 그린다 (스토어에 쌓으면 획마다 전체 리렌더)
        if (event.event === 'BOARD_STROKE' && event.stroke) {
          boardBus.emitStroke(event.stroke as unknown as BoardStrokeData)
        }
        if (event.event === 'BOARD_STROKE_DELETED' && event.strokeId) {
          boardBus.emitStrokeDeleted(event.strokeId)
        }
        if (event.event === 'BOARD_CLEAR') boardBus.emitClear()
        // 쉬는시간 잠금 — 학생 화면이 이 플래그로 방송 영역을 가린다
        if (event.event === 'BROADCAST_LOCK') {
          // 스냅샷이 뒤늦게 도착해 이 값을 되돌리지 못하게 발행 횟수를 세어 둔다 (아래 참고)
          lockSeqRef.current += 1
          useLiveStore.getState().setBroadcastLocked(event.locked === true)
        }
        // 채팅은 화면(라이브/인박스)이 어디든 실시간으로 쌓인다
        if (event.event === 'CHAT_MESSAGE') {
          const teacher = event.senderRole === 'TEACHER'
          /*
            학생 질문은 선생님에게 토스트로도 알린다 — 손들기와 같은 이유다.
            질문을 보여주는 화면은 라이브 수업과 채팅 인박스뿐이라, 그 밖에 있으면 질문이
            useLiveStore 에 쌓이기만 하고 **아무 신호가 없었다.**

            이게 중요한 이유: 서버는 선생님이 STOMP 에 붙어 있으면 곧바로 상담을 배정하고
            학생에게 `CHAT_ASSIGNED`("선생님과 연결됐어요")를 보낸다. 알림이 없으면
            **학생은 연결됐다고 믿는데 선생님은 모르는** 상태가 된다 — 대기 안내보다 나쁘다.
          */
          if (!teacher && useAuthStore.getState().user?.role === 'TEACHER') {
            useToastStore.getState().show(`💬 ${event.senderName ?? ''} 학생이 질문했어요`)
          }
          pushLiveMessage({
            id: `${event.occurredAt ?? Date.now()}-${event.studentId ?? 'me'}-${event.message ?? ''}`,
            from: Number(event.studentId ?? 0),
            name: event.senderName ?? (teacher ? '선생님' : '학생'),
            text: event.message ?? '',
            at: event.occurredAt ?? new Date().toISOString(),
            teacher,
          })
        }
        if (event.event === 'BOARD_GRANT' && event.userIds) {
          applyBoardGrant(event.userIds, event.action !== 'REVOKE')
        }
        onEventRef.current?.(event)
      },
    })
  }

  // 접속 — 로그인(토큰)이 준비되면 한 번만
  useEffect(() => {
    const socket = socketRef.current
    if (!socket || !getAccessToken() || !user) return
    /*
      토큰은 **값이 아니라 게터**로 넘긴다(ConnectInfo.getToken). access 토큰이 30분이라
      값을 굳혀 두면 만료 후 재연결이 영구히 실패한다 — 재연결마다 저장소에서 다시 읽어야
      REST 쪽 재발급이 소켓에도 반영된다. 접속 가능 여부만 여기서 한 번 확인한다.
    */
    socket.connect({ getToken: getAccessToken, role: user.role, userId: user.id })
    return () => socket.disconnect()
  }, [user])

  /**
   * 구독할 수업 지정 + 상태 스냅샷 복원.
   *
   * `status` 를 의존성에 넣은 이유: 재접속(네트워크 끊김·절전 복귀·로그인 직후 user 객체 교체)
   * 때 소켓이 새로 붙으면 이 효과가 다시 돌아 **구독을 다시 걸고 스냅샷도 다시 읽는다.**
   * 예전엔 접속 효과만 다시 돌아서 `/sub/sessions/{id}` 구독이 되살아나지 않았고, 그 동안 든 손은
   * STOMP 재전송이 없어 영구히 사라졌다.
   */
  useEffect(() => {
    const socket = socketRef.current
    if (!socket) return
    socket.setSession(sessionId)
    /*
      sessionId 가 없다고 손든 목록을 비우지 않는다. useLiveStore 는 전역 싱글턴이라,
      수업이 없는 화면(채팅 인박스 등)이 소켓을 한 번 마운트하는 것만으로 선생님이 보고 있던
      손든 학생 목록이 통째로 지워졌다.
    */
    if (sessionId === null) return

    let cancelled = false
    void (async () => {
      try {
        const lockSeqBefore = lockSeqRef.current
        const state = await sessionApi.getState(sessionId)
        if (cancelled) return
        /*
          스냅샷은 구독보다 늦게 도착한다. 그 사이에 들어온 손들기를 통째 교체로 덮어쓰면
          알림이 사라지므로 합집합으로 합친다. (남은 유령 손은 배너에서 정리할 수 있다)
        */
        const live = useLiveStore.getState().handRaisedIds
        setHandRaisedIds([...new Set([...state.handRaised, ...live])])
        setBoardGrantIds(state.boardGrants)
        useLiveStore.getState().setMutedMicIds(state.mutedMic)
        useLiveStore.getState().setDisabledCamIds(state.disabledCam)
        /*
          **내가 잠겨 있는지도 여기서 되살린다.**

          위 두 줄은 선생님 화면이 쓰는 "잠긴 학생 목록"이고, 학생 자신의 잠금은
          `useSignalStore.forcedMute/forcedCameraOff` 다. 그 값은 `MEDIA_CONTROL` STOMP 를
          받을 때만 세워졌는데, 그건 **메모리에만 있어서 새로고침하면 false 로 돌아갔다.**

          그러면 학생 화면은 잠긴 줄 모르고 마이크/카메라 버튼을 "켜짐"으로 그리고,
          입장 시 `useStudentStage` 가 스토어 기본값(micOn·cameraOn 이 둘 다 true)대로
          장치를 실제로 켠다 — 카메라 불이 들어오고 아이는 자기 소리가 나간다고 믿는다.
          (실제로는 팀 룸 토큰에 그 소스가 없어 발행만 조용히 실패한다.)

          목록에 없으면 `false` 로 되돌리는 것도 중요하다 — 자리를 비운 사이 선생님이
          잠금을 풀었다면 그 해제도 새로고침으로 반영돼야 한다.
        */
        const me = useAuthStore.getState().user?.id
        if (me !== undefined) {
          useSignalStore.getState().setForcedMedia({
            mic: state.mutedMic.includes(me),
            cam: state.disabledCam.includes(me),
          })
        }
        // 요청 도중 잠금 이벤트가 왔으면 그쪽이 더 새롭다 — 스냅샷으로 되돌리지 않는다
        if (lockSeqRef.current === lockSeqBefore) {
          useLiveStore.getState().setBroadcastLocked(state.broadcastLocked)
        }
      } catch {
        /* 스냅샷 실패 시엔 증분 이벤트만으로 동작 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, status, setHandRaisedIds, setBoardGrantIds])

  /** 발행 성공 여부를 그대로 돌려준다 — 호출한 쪽이 실패를 안내할 수 있게 */
  const send = useCallback(
    (event: string, payload: Record<string, unknown> = {}) =>
      socketRef.current?.send(event, payload) ?? false,
    [],
  )

  return { status, participants, send }
}
