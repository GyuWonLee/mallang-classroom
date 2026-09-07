import { useCallback, useEffect, useRef, useState } from 'react'
import { Track } from 'livekit-client'
import type { MediaDeviceManager } from '@/services/media/MediaDeviceManager'
import type { ScreenShareManager } from '@/services/media/ScreenShareManager'
import type { PdfPresenter, PdfPresenterState } from '@/services/media/PdfPresenter'
import { acquireTeacherBroadcast } from '@/services/media/TeacherBroadcast'
import { getTeacherBroadcast } from '@/services/media/teacherBroadcastHandle'
import type { SignalingStatus } from '@/services/signaling/ClassroomSignaling'
import { useToastStore } from '@/stores/useToastStore'

/**
 * 지금 무엇을 내보내고 있는가.
 *
 *  - `display` 브라우저 화면 공유 (getDisplayMedia)
 *  - `pdf`     PDF 발표 (캔버스 captureStream — `PdfPresenter`)
 *  - `null`    둘 다 아님 (카메라만)
 *
 * **둘은 배타적이다.** LiveKit 의 `ScreenShare` 소스는 하나뿐이라 동시에 올릴 수 없고,
 * 학생 화면도 그 하나를 카메라보다 우선해 그린다 — 어느 쪽이 보일지 애매해선 안 된다.
 */
export type ShareSource = 'display' | 'pdf' | null

/** 방송이 아직 없을 때의 PDF 상태 — 발표 중이 아니다 */
const NO_PDF: PdfPresenterState = {
  active: false,
  loading: false,
  fileName: null,
  page: 1,
  pageCount: 0,
  error: null,
}

/**
 * 선생님 미디어 Controller — 카메라(MediaDeviceManager)와 화면 공유(ScreenShareManager)를
 * 함께 다루고, 스테이지 <video> 두 곳에 스트림을 배선한다.
 *
 * - attachMain: 메인 화면. 공유 중이면 화면, 아니면 카메라 셀프뷰.
 * - LiveKit 송출: `TeacherBroadcast` 가 접속을 들고 있고 마이크/카메라를 룸에 게시한다.
 *   화면 공유를 켜면 ScreenShare 소스로 별도 게시하고, 끄면 그 트랙만 내린다.
 *
 * on/off 는 재게시 없이 트랙 mute 로 전파한다(게시는 접속당 1회).
 * MediaStream은 서비스/DOM에만 두고 스토어에는 넣지 않는다(Rule 2).
 */
export function useTeacherMedia(classroomId: string | null, sessionId: number | null) {
  /*
    **방송은 이 화면의 것이 아니다.** 카메라·마이크·화면공유·PDF·LiveKit 접속은 모듈 수준의
    `TeacherBroadcast` 가 들고 있고(수명은 화면이 아니라 수업에 매인다), 이 훅은 그것을
    가져다 쓰며 구독만 한다. 그래서 선생님이 과제를 내러 잠깐 나갔다 와도 공유하던 PDF 가
    그대로 남아 있고, 학생 화면에서 선생님이 사라지지 않는다.

    끄는 책임은 여기 없다 — `TeacherBroadcast` 주석의 네 가지 경로가 전부다.
  */
  const broadcast =
    classroomId !== null && sessionId !== null
      ? acquireTeacherBroadcast(classroomId, sessionId)
      : getTeacherBroadcast()

  const cameraRef = useRef<MediaDeviceManager | null>(null)
  cameraRef.current = broadcast?.camera ?? null
  const screenRef = useRef<ScreenShareManager | null>(null)
  screenRef.current = broadcast?.screen ?? null
  const pdfRef = useRef<PdfPresenter | null>(null)
  pdfRef.current = broadcast?.pdf ?? null

  const [signalingStatus, setSignalingStatus] = useState<SignalingStatus>(
    () => broadcast?.getState() ?? 'idle',
  )
  useEffect(() => {
    if (!broadcast) return
    return broadcast.subscribe(setSignalingStatus)
  }, [broadcast])

  const publishStream = useCallback(
    async (stream: MediaStream): Promise<void> => {
      await broadcast?.signaling.publishLocal(stream)
    },
    [broadcast],
  )
  const publishScreen = useCallback(
    (stream: MediaStream) => broadcast?.signaling.publishScreen(stream),
    [broadcast],
  )
  const unpublishScreen = useCallback(
    () => broadcast?.signaling.unpublishScreen(),
    [broadcast],
  )
  const setTrackEnabled = useCallback(
    (source: Track.Source, enabled: boolean) =>
      broadcast?.signaling.setTrackEnabled(source, enabled),
    [broadcast],
  )

  const showToast = useToastStore((s) => s.show)

  const mainElRef = useRef<HTMLVideoElement | null>(null)

  const [micOn, setMicOn] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [shareSource, setShareSource] = useState<ShareSource>(null)
  /* 수업이 아직 안 정해졌으면 방송이 없다 — 그때는 빈 상태로 둔다(발표 중이 아니다) */
  const [pdf, setPdf] = useState<PdfPresenterState>(
    () => broadcast?.pdf.getState() ?? NO_PDF,
  )
  /**
   * 무엇으로든 화면을 내보내는 중인가.
   *
   * 무대(`LiveStage`)와 컨트롤 바가 보던 이름을 그대로 둔다 — 그쪽이 알아야 하는 건 "영상이
   * 카메라가 아니라 화면이다"(= `object-contain`, 좌우 반전 없음)이지 출처가 아니다.
   */
  const screenSharing = shareSource !== null
  /** 게시 완료 콜백에서 최신 on/off 를 읽기 위한 거울 (state 를 클로저에 가두면 낡은 값이 된다) */
  const liveStateRef = useRef({ micOn, cameraOn })
  liveStateRef.current = { micOn, cameraOn }

  // ── LiveKit 게시 ─────────────────────────────────────────────
  // 게시는 룸 접속당 1회 — 이후 on/off 는 트랙 mute 로 전파된다(재게시 불필요).
  const publishedRef = useRef(false)

  useEffect(() => {
    // 접속이 끊기면(재접속 대비) 다음 접속 때 다시 게시하도록 초기화
    if (signalingStatus !== 'connected') publishedRef.current = false
  }, [signalingStatus])

  /** [접속 완료]와 [로컬 스트림 존재]가 모두 갖춰지는 순간 카메라+마이크를 게시 */
  const publishIfReady = useCallback(() => {
    if (publishedRef.current || signalingStatus !== 'connected') return
    const stream = cameraRef.current?.getLocalStream()
    if (!stream) return
    publishedRef.current = true
    void publishStream(stream).then(() => {
      /*
        게시가 끝난 뒤 현재 on/off 를 한 번 더 밀어 넣는다. 게시 전에 누른 토글은 발행물이
        없어서 mute 가 먹지 않으므로, 카메라를 끈 채 수업을 시작하면 내 화면만 꺼지고
        학생들에게는 켜진 영상이 계속 나가고 있었다.
      */
      setTrackEnabled(Track.Source.Camera, liveStateRef.current.cameraOn)
      setTrackEnabled(Track.Source.Microphone, liveStateRef.current.micOn)
    })
  }, [signalingStatus, publishStream, setTrackEnabled])

  // 순서 무관 보장: 접속이 먼저든 하드웨어 획득이 먼저든 게시된다
  useEffect(() => {
    publishIfReady()
  }, [publishIfReady, cameraOn, micOn])

  /*
    지금 **게시돼 있는** 출처 — 원하는 것(`shareSource`)과 다르면 아래 effect 가 맞춘다.

    **이 값은 방송(`TeacherBroadcast`)이 들고 있다.** 화면 안에 두면 수업 화면을 나갔다 올 때마다
    초기화돼, 이미 게시 중인데도 다시 게시한다 — 그러면 LiveKit 이 기존 게시를 내리면서
    캔버스 캡처 트랙까지 정지시켜 화면이 검게 죽는다(자세한 이유는 그쪽 주석).
  */
  useEffect(() => {
    // 접속이 끊기면 이전 Room 의 퍼블리케이션은 죽은 것 — 다음 접속에서 다시 게시한다
    if (signalingStatus !== 'connected' && broadcast) broadcast.publishedSource = null
  }, [signalingStatus, broadcast])

  /*
    화면공유 게시/해제의 **단일 지점**. 예전에는 `toggleScreenShare` 안에서만 게시해서
    구멍이 셋이었다:
     1) 접속 전에 켠 공유는 `publishScreen` 이 `if (!room) return` 으로 조용히 버려
        영원히 나가지 않았다 (카메라에는 publishIfReady 가 있는데 공유에는 없었다).
     2) 재접속(새 Room) 후에도 다시 게시되지 않아, 버튼은 "공유 중지" 인데 학생에게는
        아무것도 가지 않았다.
     3) 브라우저 기본 UI("공유 중지")로 멈추면 ScreenShareManager 는 로컬만 정리하고
        unpublish 를 부르지 않아, LiveKit 퍼블리케이션이 **ended 된 트랙을 물고 남았다**.
        학생은 화면공유를 우선 표시하므로(useStudentStage) 얼어붙은 마지막 프레임에
        묶이고, 그 뒤 선생님이 카메라를 켜도 학생 화면이 바뀌지 않았다.
    [접속됨 + 공유중] 을 상태로 보고 여기서만 맞추면 세 경우가 한꺼번에 닫힌다.
  */
  useEffect(() => {
    if (signalingStatus !== 'connected' || !broadcast) return
    const want = shareSource
    if (want === broadcast.publishedSource) return

    if (want === null) {
      broadcast.publishedSource = null
      void unpublishScreen()
      return
    }
    /*
      화면 공유 ↔ PDF 를 오갈 때도 여기 한 번만 지난다. `publishScreen` 이 내부에서 기존
      퍼블리케이션을 먼저 내리므로 따로 unpublish 하지 않는다 — 두 번 내리면 그 사이 학생
      화면이 카메라로 잠깐 튄다.
    */
    const stream = want === 'pdf' ? broadcast.pdf.getStream() : broadcast.screen.getStream()
    // [pdf-share] 진단 로그 — 원인이 잡히면 지운다. `살아있음` 이 ended 면 트랙이 죽은 것이다.
    console.info('[pdf-share] 2. 게시 판단', {
      내보낼것: want,
      이미게시됨: broadcast.publishedSource,
      스트림있음: !!stream,
      살아있음: stream?.getVideoTracks()[0]?.readyState,
    })
    if (!stream) return
    broadcast.publishedSource = want
    void publishScreen(stream)
  }, [broadcast, shareSource, signalingStatus, publishScreen, unpublishScreen])

  /**
   * 상태에 맞춰 스트림을 무대 `<video>` 에 다시 연결.
   *
   * 매니저의 **지금 상태를 직접 읽는다** — 이 함수는 구독 콜백에서도 불리는데, 거기서
   * React state(`shareSource`)를 보면 아직 갱신 전 값이라 한 박자 늦은 스트림이 붙는다.
   *
   * 선생님도 PDF 를 **송출 트랙 그대로** 본다. 별도 미리보기를 두지 않는 이유: 학생이 보는
   * 것과 같은 그림이어야 "지금 몇 쪽이 나가고 있는지"에 대해 선생님이 틀릴 수가 없다.
   */
  const rebind = useCallback(() => {
    const cameraStream = cameraRef.current?.getLocalStream() ?? null
    const pdfStream = pdfRef.current?.getState().active ? pdfRef.current.getStream() : null
    const displayStream = screenRef.current?.getState().sharing
      ? screenRef.current.getStream()
      : null
    if (mainElRef.current) {
      mainElRef.current.srcObject = pdfStream ?? displayStream ?? cameraStream
    }
  }, [])

  useEffect(() => {
    if (!broadcast) return
    const { camera, screen, pdf: pdfPresenter } = broadcast
    // 하드웨어 실패(권한 거부/미지원)는 조용히 넘기지 않고 이유를 알려준다
    const unsubCamera = camera.subscribe((st) => {
      setCameraOn(st.cameraOn)
      setMicOn(st.micOn)
      if (st.error) showToast(st.error)
      rebind()
    })
    /*
      두 출처가 각자 자기 칸만 건드린다. `setShareSource(st.sharing ? 'display' : null)` 처럼
      쓰면 PDF 로 발표하는 중에 (브라우저 UI 로 끝난) 화면공유의 늦은 알림 하나가 PDF 를
      꺼 버린다 — 내가 켠 것이 아닐 때는 남의 상태를 지우지 않는다.
    */
    const unsubScreen = screen.subscribe((st) => {
      setShareSource((prev) => (st.sharing ? 'display' : prev === 'display' ? null : prev))
      if (st.error) showToast(st.error)
      rebind()
    })
    const unsubPdf = pdfPresenter.subscribe((st) => {
      setPdf(st)
      setShareSource((prev) => (st.active ? 'pdf' : prev === 'pdf' ? null : prev))
      if (st.error) showToast(st.error)
      rebind()
    })
    /*
      **구독만 끊는다.** 예전에는 여기서 셋을 dispose 했는데, 그 탓에 수업 화면을 벗어나는
      것만으로 카메라·마이크·PDF 가 꺼지고 학생 화면에서 선생님이 사라졌다. 매니저의 수명은
      이제 `TeacherBroadcast` 가 정한다.
    */
    return () => {
      unsubCamera()
      unsubScreen()
      unsubPdf()
    }
  }, [broadcast, rebind, showToast])

  const attachMain = useCallback(
    (el: HTMLVideoElement | null) => {
      mainElRef.current = el
      rebind()
    },
    [rebind],
  )

  const toggleCamera = useCallback(async () => {
    const camera = cameraRef.current
    if (!camera) return
    const next = !camera.getState().cameraOn
    await camera.setCameraEnabled(next)
    setTrackEnabled(Track.Source.Camera, next)
    rebind()
  }, [rebind, setTrackEnabled])

  const toggleMic = useCallback(async () => {
    const camera = cameraRef.current
    if (!camera) return
    const next = !camera.getState().micOn
    await camera.setMicEnabled(next)
    setTrackEnabled(Track.Source.Microphone, next)
  }, [setTrackEnabled])

  /*
    화면 **획득/중지만** 한다. LiveKit 게시/해제는 위 effect 가 단독으로 맡는다 —
    양쪽에서 발행하면 브라우저 기본 UI 로 멈춘 경우와 어긋난다(그때는 여기를 안 지난다).
  */
  const toggleScreenShare = useCallback(async () => {
    const screen = screenRef.current
    if (!screen) return
    if (screen.getState().sharing) {
      screen.stop()
    } else {
      // 둘은 배타적이다 — PDF 를 내보내는 중이었다면 먼저 접는다
      pdfRef.current?.stop()
      await screen.start()
    }
    rebind()
  }, [rebind])

  /** PDF 발표 시작(또는 발표 중 자료 교체) — 화면 공유 중이었다면 그쪽을 접는다 */
  const startPdfShare = useCallback(
    async (file: File) => {
      screenRef.current?.stop()
      await pdfRef.current?.start(file)
      rebind()
    },
    [rebind],
  )

  /** 지금 내보내는 것을 멈춘다 (출처와 무관하게 — 버튼 하나가 둘 다 맡는다) */
  const stopShare = useCallback(() => {
    screenRef.current?.stop()
    pdfRef.current?.stop()
    rebind()
  }, [rebind])

  const pdfNext = useCallback(() => void pdfRef.current?.next(), [])
  const pdfPrev = useCallback(() => void pdfRef.current?.prev(), [])

  return {
    micOn,
    cameraOn,
    screenSharing,
    /** 무엇을 내보내는 중인지 — 버튼 문구·상태 표시가 이걸로 갈린다 */
    shareSource,
    /** PDF 발표 상태 (쪽수·파일명·로딩) */
    pdf,
    /** LiveKit 접속 상태 — UI 가 "방송 중"을 표시할 때 쓴다 */
    signalingStatus,
    attachMain,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    startPdfShare,
    stopShare,
    pdfNext,
    pdfPrev,
  }
}
