import { useEffect, useRef, useState } from 'react'
import { localMedia } from '@/services/media/localMedia'
import { useClassroomStore } from '@/stores/useClassroomStore'
import { useToastStore } from '@/stores/useToastStore'
import { useSignalStore } from '@/stores/useSignalStore'
import { useLiveStore } from '@/stores/useLiveStore'
import { useAuthStore } from '@/stores/useAuthStore'

/**
 * 화상 컨트롤 Controller — MediaDeviceManager(서비스)와 교실 스토어(UI 상태)를 잇는다.
 * 스토어의 micOn/cameraOn이 진실의 원천이고, 매니저는 실제 하드웨어 트랙에 반영한다.
 * 손들기는 시그널 버스로 선생님에게 전송하고, 선생님의 강제 잠금은 마이크·카메라에 반영한다.
 */

/**
 * 손들기 유지 시간 — 이 시간이 지나면 스스로 내린다.
 * 서버에는 TTL 이 없어(HandController 에 expire 호출이 없다) 클라이언트가 내려 줘야 한다.
 */
const HAND_HOLD_MS = 8000
/**
 * 손 내린 뒤 다시 들 수 있게 되기까지. 연타로 선생님 화면(토스트·배너·타일 배지)이
 * 계속 붙었다 떨어지는 것을 막는 게 목적이다. 남은 시간은 화면에 표시하지 않는다.
 */
const HAND_COOLDOWN_MS = 5000

export function useMediaControls() {
  const micOn = useClassroomStore((s) => s.micOn)
  const cameraOn = useClassroomStore((s) => s.cameraOn)
  const setMicOn = useClassroomStore((s) => s.setMicOn)
  const setCameraOn = useClassroomStore((s) => s.setCameraOn)
  const showToast = useToastStore((s) => s.show)
  const send = useSignalStore((s) => s.send)
  const forcedMute = useSignalStore((s) => s.forcedMute)
  const forcedCameraOff = useSignalStore((s) => s.forcedCameraOff)
  const userName = useAuthStore((s) => s.user?.name)
  const myId = useAuthStore((s) => s.user?.id)
  // 손든 사람 목록은 서버가 브로드캐스트한 진실 — 내 손 상태도 여기서 읽는다
  const handRaisedIds = useLiveStore((s) => s.handRaisedIds)
  const [pending, setPending] = useState(false)

  // 하드웨어 오류를 토스트로 알림.
  // localMedia 는 공용(셀프뷰·LiveKit 송출이 같은 스트림을 쓴다)이라 여기서 정리하지 않는다 —
  // 정리는 교실 페이지를 떠날 때 useStudentStage 가 release() 로 한 번만 한다.
  useEffect(() => {
    return localMedia.subscribe((state) => {
      if (state.error) showToast(state.error)
    })
  }, [showToast])

  /*
    ── 잠금은 끄기만 한다. **풀 때 다시 켜지 않는다.** ──────────────────

    한때 잠기기 직전 상태를 기억해 뒀다가 풀릴 때 되돌렸다(`wasOnBeforeLock`). 없앴다:
    잠금을 풀었다고 카메라가 저절로 켜지면, 아이가 화면 앞을 떠나 있거나 옷을 갈아입는
    중일 수도 있는데 **아무 동작 없이 얼굴이 다시 나가기 시작한다.** 카메라를 켜는 일은
    아이의 선택이어야 한다(브라우저가 장치 접근에 사용자 제스처를 요구하는 것과 같은 이유다).

    그래서 잠금 해제가 하는 일은 하나다: **다시 켤 수 있게 만드는 것.** 아래 토글 가드가
    풀리므로 아이가 버튼을 누르면 그 자리에서 켜진다(꺼진 트랙만 다시 활성화하는 것이라
    하드웨어를 새로 잡지 않는다). 선생님 화면에는 그때 다시 나타난다.
  */
  useEffect(() => {
    if (forcedMute && micOn) {
      setMicOn(false)
      void localMedia.setMicEnabled(false)
    }
  }, [forcedMute, micOn, setMicOn])

  useEffect(() => {
    if (forcedCameraOff && cameraOn) {
      setCameraOn(false)
      void localMedia.setCameraEnabled(false)
    }
  }, [forcedCameraOff, cameraOn, setCameraOn])

  /*
    **선생님이 잠근 마이크는 학생이 스스로 켤 수 없다.**
    `!micOn` 조건 없이 잠금만 보고 막는다 — 예전 가드는 `forcedMute && !micOn` 이라
    잠긴 직후(위 effect 가 micOn 을 내리기 전) 한 프레임에는 통과할 수 있었다.
    서버도 발행 권한(canPublishSources)에서 마이크를 빼 두므로 여기서 막는 것은
    "왜 안 되는지 알려주는" 역할이다 — 조용히 실패하면 아이는 계속 누른다.
  */
  const toggleMic = () => {
    if (forcedMute) {
      showToast('선생님이 마이크를 잠갔어요')
      return
    }
    const next = !micOn
    setMicOn(next)
    void localMedia.setMicEnabled(next)
  }

  const toggleCamera = () => {
    if (forcedCameraOff) {
      showToast('선생님이 카메라를 잠갔어요')
      return
    }
    const next = !cameraOn
    setCameraOn(next)
    void localMedia.setCameraEnabled(next)
  }

  /**
   * 내 손이 들려 있는지 — **서버가 브로드캐스트한 `handRaisedIds` 가 진실이다.**
   * 로컬 플래그를 따로 두면 서버 토글과 어긋난다(useClassroomStore 주석 참고).
   */
  const handRaised = myId !== undefined && handRaisedIds.includes(myId)

  /**
   * 위 값의 **최신 스냅샷**. 자동 내림 타이머가 발사될 때 참조한다 —
   * 타이머 클로저에 `handRaised` 를 가두면 8초 전의 낡은 값을 보게 된다.
   */
  const handRaisedRef = useRef(handRaised)
  handRaisedRef.current = handRaised

  /** 자동 내림 타이머 (언마운트 시 정리해야 유령 토글이 안 나간다) */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * 손들기 — 백엔드는 **본문 없는 토글**이고 **서버 TTL 도 없다**(HandController 에 expire 없음).
   * 그래서 유지·자동 내림·쿨타임을 전부 여기서 관리한다.
   *
   * 예전엔 아이가 연타하면 그대로 서버 토글이 뒤집혀, 선생님 화면에서 토스트가 쌓이고
   * 손들기 배너·타일 배지가 붙었다 떨어지며 레이아웃이 계속 튀었다.
   * 이제 한 번 들면 HAND_HOLD_MS 유지 → 자동으로 내려가고 → HAND_COOLDOWN_MS 동안
   * 다시 들 수 없다. 쿨타임 중 클릭은 조용히 무시한다(남은 시간은 보여주지 않는다).
   */
  const raiseHand = () => {
    if (pending) return
    const ok = send('HAND_RAISED', { studentName: userName ?? '학생' })
    if (!ok) {
      // 보내지 못했으면 성공한 척하지 않는다 (예전엔 실패해도 항상 성공 토스트가 떴다)
      showToast('아직 수업에 연결되지 않았어요. 잠시 뒤에 다시 눌러주세요.')
      return
    }
    setPending(true)
    // 이미 들려 있었다면 이 클릭은 "내리기"다 — 유지 타이머를 걸지 않는다
    if (handRaised) {
      showToast('손을 내렸어요')
      return
    }
    showToast('손을 들었어요! 선생님이 곧 불러줄 거예요')

    /*
      유지 시간이 끝나면 자동으로 내린다. **보내기 전에 아직 들려 있는지 확인**해야 한다 —
      서버가 blind 토글이라, 그 사이 학생이 직접 내렸거나 스냅샷이 바뀐 뒤에 맹목적으로
      한 번 더 보내면 **손을 다시 들어 버린다**.
    */
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      if (handRaisedRef.current) send('HAND_RAISED', { studentName: userName ?? '학생' })
    }, HAND_HOLD_MS)
  }

  /*
    쿨타임은 **서버 응답과 무관한 독립 타이머**다.
    예전에는 `useEffect(() => setPending(false), [handRaised])` 로 서버가 상태를 돌려주는
    순간 잠금을 풀었다 — LAN 에서는 수십 ms 라 사실상 연타 방지가 되지 않았다.
  */
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => setPending(false), HAND_HOLD_MS + HAND_COOLDOWN_MS)
    return () => clearTimeout(timer)
  }, [pending])

  // 화면을 떠날 때 남은 자동 내림 타이머를 정리한다 (언마운트 후 발사되면 유령 토글이 된다)
  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current)
    }
  }, [])

  return {
    micOn: micOn && !forcedMute,
    cameraOn: cameraOn && !forcedCameraOff,
    /** 선생님이 잠갔는지 — 버튼을 잠긴 모양으로 보여줄 때 쓴다 */
    micLocked: forcedMute,
    camLocked: forcedCameraOff,
    handRaised,
    toggleMic,
    toggleCamera,
    raiseHand,
  }
}
