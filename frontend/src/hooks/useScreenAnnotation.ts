import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ScreenAnnotator,
  type AnnotationState,
  type BoardStrokeData,
} from '@/services/media/ScreenAnnotator'
import { boardBus } from '@/services/signaling/boardBus'
import { useSignalStore } from '@/stores/useSignalStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToastStore } from '@/stores/useToastStore'
import { sessionApi } from '@/services/api/sessionApi'

const INITIAL: AnnotationState = {
  tool: 'pen',
  color: '#ff3b30',
  width: 4,
  canUndo: false,
  canClear: false,
}

interface UseScreenAnnotationOptions {
  /** 재접속 복원(GET /state)에 쓸 수업 id. null 이면 복원하지 않는다 */
  sessionId?: number | null
  /** 학생 화면처럼 보기만 하는 경우 true — 포인터 입력을 받지 않는다 */
  readOnly?: boolean
  /**
   * 좌표 기준이 되는 배경 영상(선생님 방송). 캔버스는 영상보다 클 수 있어서,
   * 영상의 letterbox 박스를 기준으로 좌표를 정규화해야 교사·학생 획이 같은 자리에 찍힌다.
   */
  backgroundVideo?: HTMLVideoElement | null
}

/**
 * 화면 필기 Controller — ScreenAnnotator(엔진)와 UI/실시간 채널을 잇는다.
 *
 * 내가 그린 획은 STOMP 로 발행하고(`BOARD_STROKE`), 남이 그린 획은 boardBus 로 받아 캔버스에
 * 얹는다. 서버는 내가 보낸 획도 되돌려주지만 엔진이 strokeId 로 걸러낸다.
 * 들어올 때 `GET /sessions/{id}/state` 의 boardStrokes 로 지금까지의 판서를 복원한다.
 *
 * `onStroke` 는 **그리는 중에도 반복 호출된다**(같은 strokeId 로 점이 늘어난 스냅샷).
 * 그래서 상대 화면이 손을 떼기 전에 따라 그려진다 — 자세한 규칙은 ScreenAnnotator 주석 참고.
 */
export function useScreenAnnotation({
  sessionId = null,
  readOnly = false,
  backgroundVideo = null,
}: UseScreenAnnotationOptions = {}) {
  const engineRef = useRef<ScreenAnnotator | null>(null)
  if (!engineRef.current) engineRef.current = new ScreenAnnotator()

  const [state, setState] = useState<AnnotationState>(INITIAL)
  // send 는 스토어에 등록된 소켓 발행 함수 (학생 페이지·선생님 컨트롤러가 등록한다)
  const send = useSignalStore((s) => s.send)

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    return engine.subscribe(setState)
  }, [])

  useEffect(() => {
    engineRef.current?.setReadOnly(readOnly)
  }, [readOnly])

  /*
    좌표 기준 영상(letterbox 계산용).

    엔진은 `boardRatio()` 로 **배경 영상의 실제 비율**에 맞춘 보드 박스를 잡고 그 안에서
    좌표를 정규화한다. 그런데 `setBackgroundVideo()` 를 부르는 곳이 없어서 항상 폴백 16:10 을
    썼다 — 선생님 화면공유가 16:9 나 4:3 이면 **교사와 학생이 서로 다른 박스를 기준으로 삼아
    획 위치가 어긋났다.** 양쪽이 같은 영상(선생님 방송)을 넘기므로 비율이 같아져 좌표가 맞는다.
  */
  useEffect(() => {
    engineRef.current?.setBackgroundVideo(backgroundVideo ?? null)
  }, [backgroundVideo])

  // 내가 누구인지 — 학생은 "내 획만" 지울 수 있고 전체 지우기는 교사 전용이다
  const user = useAuthStore((s) => s.user)
  useEffect(() => {
    engineRef.current?.setIdentity(user?.id ?? null, user?.role === 'TEACHER')
  }, [user])

  /** 지운 게 나만 지워진 상황을 알린다 (엔진은 로컬을 먼저 지우므로 조용히 넘기면 어긋난다) */
  const warnNotShared = useCallback(() => {
    useToastStore.getState().show('아직 수업에 연결되지 않아 친구들 화면에는 그대로예요.')
  }, [])

  // 내가 그린 것 → 서버로. 보기 전용이면 아무것도 보내지 않는다.
  useEffect(() => {
    engineRef.current?.setHandlers(
      readOnly
        ? {}
        : {
            onStroke: (stroke) => void send('BOARD_STROKE', { ...stroke }),
            /*
              발행 실패(미연결·수업 미지정)를 삼키지 않는다. 엔진은 로컬에서 **먼저** 지우므로,
              실패를 모른 채 넘어가면 내 화면에서는 사라졌는데 남의 화면에는 그대로 남는다.
              `send()` 가 false 면 ClassroomSocket/StompClient 가 onError 로 사유를 이미 알리지만,
              여기서 한 번 더 "다시 눌러 달라"고 말해 줘야 아이가 재시도할 수 있다.
            */
            onDeleteStroke: (strokeId) => {
              if (!send('BOARD_STROKE_DELETE', { strokeId })) warnNotShared()
            },
            onClear: () => {
              if (!send('BOARD_CLEAR')) warnNotShared()
            },
          },
    )
  }, [send, readOnly, warnNotShared])

  // 서버에서 온 것 → 캔버스로
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const offStroke = boardBus.onStroke((stroke) => engine.applyStroke(stroke))
    const offDeleted = boardBus.onStrokeDeleted((strokeId) => engine.applyStrokeDeleted(strokeId))
    const offClear = boardBus.onClear(() => engine.applyClear())
    return () => {
      offStroke()
      offDeleted()
      offClear()
    }
  }, [])

  /*
    재접속 복원 — 늦게 들어와도 이미 그려진 판서가 보인다.

    의존성에 `resyncTick` 을 함께 둔다. 예전에는 `[sessionId]` 뿐이라 **재접속에 반응하지
    못했다.** 브로커가 끊긴 동안의 획을 재전송하지 않으므로, 5초만 끊겨도 그 사이의 판서와
    BOARD_CLEAR 가 학생 캔버스에 영영 반영되지 않았다("지웠는데 남아 있는 칠판").

    `replaceAll` 은 멱등이라 여러 번 불려도 안전하다. 다만 **그리는 중에는 건드리지 않는다** —
    진행 중인 획이 통째로 사라진다.
  */
  const resyncTick = useSignalStore((st) => st.resyncTick)
  useEffect(() => {
    if (sessionId === null) return
    let cancelled = false
    void (async () => {
      try {
        const snapshot = await sessionApi.getState(sessionId)
        if (cancelled) return
        // 그리는 중이면 건너뛴다 — replaceAll 이 진행 중인 획을 지운다
        if (engineRef.current?.drawing) return
        engineRef.current?.replaceAll(snapshot.boardStrokes as unknown as BoardStrokeData[])
      } catch {
        /* 복원 실패해도 이후 실시간 획은 정상 동작한다 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, resyncTick])

  // 캔버스 DOM 존재 여부에 따라 attach/detach 를 한 곳에서 관리 (attach 는 멱등)
  const attachCanvas = useCallback((el: HTMLCanvasElement | null) => {
    if (el) engineRef.current?.attach(el)
    else engineRef.current?.detach()
  }, [])

  const setTool = useCallback((tool: AnnotationState['tool']) => engineRef.current?.setTool(tool), [])
  const setColor = useCallback((color: string) => engineRef.current?.setColor(color), [])
  const setWidth = useCallback((width: number) => engineRef.current?.setWidth(width), [])
  const undo = useCallback(() => engineRef.current?.undo(), [])
  const clear = useCallback(() => engineRef.current?.clear(), [])

  /** 칠판을 통째로 비울 수 있는가 — 교사만. 학생의 '전부 지우기'는 내 획만 지운다 */
  const canClearAll = user?.role === 'TEACHER'

  return { ...state, canClearAll, attachCanvas, setTool, setColor, setWidth, undo, clear }
}
