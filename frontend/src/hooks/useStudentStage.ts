import { useCallback, useEffect, useRef, useState } from 'react'
import { Track, type RemoteTrack } from 'livekit-client'
import { ClassroomSignaling } from '@/services/signaling/ClassroomSignaling'
import { sessionApi } from '@/services/api/sessionApi'
import { localMedia } from '@/services/media/localMedia'
import { useClassroomStore } from '@/stores/useClassroomStore'
import { useLiveStore } from '@/stores/useLiveStore'
import { useToastStore } from '@/stores/useToastStore'
import { useAudioStore } from '@/stores/useAudioStore'
import type { JoinResponse } from '@/types/session'

/** 두 룸이 하나의 join 응답을 나눠 쓸 수 있는 창 — 토큰 TTL(5분)보다 훨씬 짧게 둔다 */
const JOIN_SHARE_MS = 3000

/**
 * 학생 무대 Controller — 학생이 관여하는 **두 개의 LiveKit 룸**을 한 번에 다룬다.
 *
 * 백엔드가 토큰을 이렇게 발급하기 때문에 룸이 둘로 갈린다(SessionTicketService):
 *  - 학급 룸 `session-{id}`      : 학생 canPublish=**false** → 선생님 방송을 **받기만** 한다
 *  - 팀 룸  `session-{id}-team-N`: 학생 canPublish=**true**  → 내 캠/마이크를 **여기로** 올린다
 *
 * 그래서 선생님은 학생을 보려면 팀 룸을 방문(visit)해야 한다. 학생 화면의 "내 얼굴"은
 * 네트워크와 무관한 **로컬 미리보기**라 팀 배정이 없어도 항상 보인다.
 *
 * `POST /sessions/{id}/join` 은 두 토큰을 한 번에 주므로 호출도 한 번만 한다.
 */
export function useStudentStage(sessionId: number | null) {
  const teacherElRef = useRef<HTMLVideoElement | null>(null)
  const selfElRef = useRef<HTMLVideoElement | null>(null)
  /**
   * 선생님 트랙은 **두 개가 동시에 존재할 수 있다** — 카메라와 화면 공유는 별개 트랙이고,
   * 화면 공유를 켜도 카메라 발행은 유지된다. 예전엔 마지막에 도착한 트랙이 하나뿐인 <video>를
   * 차지해서, 공유 중에 들어온 학생은 화면 공유가 아예 안 보이거나 공유가 끝나면 빈 화면이 됐다.
   * 그래서 둘을 따로 들고 "공유 중이면 공유, 아니면 카메라"를 골라 붙인다.
   */
  const cameraTrackRef = useRef<RemoteTrack | null>(null)
  const screenTrackRef = useRef<RemoteTrack | null>(null)
  /** 지금 <video>에 붙어 있는 것이 화면 공유인지 — UI 가 object-fit 을 바꾸는 데 쓴다 */
  const [teacherScreenShare, setTeacherScreenShare] = useState(false)

  const classRoomRef = useRef<ClassroomSignaling | null>(null)
  const teamRoomRef = useRef<ClassroomSignaling | null>(null)

  const setSignalingStatus = useClassroomStore((s) => s.setSignalingStatus)
  const cameraOn = useClassroomStore((s) => s.cameraOn)
  const micOn = useClassroomStore((s) => s.micOn)
  /** 팀 룸까지 붙어서 내 영상이 선생님에게 전달되는 상태인지 */
  const [publishing, setPublishing] = useState(false)

  /**
   * 지금 보여줄 선생님 트랙을 골라 <video>에 붙인다.
   * 화면 공유가 있으면 그것을 우선한다 — 선생님이 공유를 켠 목적이 그걸 보여주는 것이다.
   * 트랙 도착 순서에 의존하지 않으므로 공유 중에 늦게 들어온 학생도 공유 화면을 본다.
   */
  /**
   * 지금 어떤 트랙이 어떤 <video> 에 붙어 있는지 — 바꿔 붙일 때 이전 것을 떼어내려고 들고 있는다.
   * **엘리먼트까지 함께 기억해야 한다**: 트랙이 같아도 엘리먼트가 새로 생기면(재렌더) 다시 붙여야 한다.
   */
  const boundRef = useRef<{ el: HTMLVideoElement; track: RemoteTrack } | null>(null)

  const bindTeacherTrack = useCallback(() => {
    /*
      **mute 여부로 붙이고 떼지 않는다.** 트랙이 있으면 그냥 붙인다.

      한때 mute 된 트랙을 "없는 것"으로 세어 떼어냈는데, 그 판단이 한 번이라도 틀리면
      (구독 시점의 isMuted 를 잘못 읽는 등) **선생님이 카메라를 켜도 학생 화면이 비어 있는**
      상태에서 회복할 길이 없었다. 붙이는 일은 단순하게 두고, "지금 그림이 오는가"는
      화면(VideoCard)이 <video> 와 네이티브 트랙에서 직접 본다 — 그쪽이 브라우저가 아는
      사실이라 우리 장부가 틀려도 그림이 오면 보인다.
    */
    const screen = screenTrackRef.current
    const next = screen ?? cameraTrackRef.current
    setTeacherScreenShare(!!screen)
    const el = teacherElRef.current
    if (!el) return

    const bound = boundRef.current
    if (bound && bound.el === el && bound.track === next) return
    /*
      바꿔 붙이기 전에 이전 트랙을 **명시적으로 떼어낸다.** 안 떼면 그 트랙의 attachedElements
      에 이 <video> 가 남아, adaptiveStream 이 보이는 엘리먼트를 잘못 계산하거나 srcObject 를
      서로 덮어써서 화면이 검게 남을 수 있다(카메라 <-> 화면공유 전환 때).
    */
    if (bound && bound.track !== next) bound.track.detach(bound.el)

    if (next) {
      next.attach(el)
      boundRef.current = { el, track: next }
    } else {
      el.srcObject = null
      boundRef.current = null
    }
  }, [])

  // 학급 룸 — 선생님 방송 수신 전용
  if (!classRoomRef.current) {
    classRoomRef.current = new ClassroomSignaling({
      onStatus: (status) => setSignalingStatus(status),
      onRemoteVideo: (track, _participant, isScreenShare) => {
        if (isScreenShare) screenTrackRef.current = track
        else cameraTrackRef.current = track
        // [pdf-share] 진단 로그 — 학생에게 안 보이는 문제를 쫓는 중. 원인이 잡히면 지운다.
        console.info('[pdf-share] 4. 학생이 원격 영상 받음', {
          화면공유인가: isScreenShare,
          sid: track.sid,
          붙일엘리먼트있음: !!teacherElRef.current,
        })
        bindTeacherTrack()
      },
      /*
        선생님이 카메라를 끄면 트랙이 내려가지 않고 mute 만 된다(setTrackEnabled).
        화면 공유가 mute 되면 카메라로 내려가야 하므로 붙일 트랙을 다시 고른다.
        "그림이 오는가"의 판단은 화면이 <video> 에서 직접 한다 — 여기서는 선택만 다시 한다.
      */
      onRemoteVideoMuteChanged: () => bindTeacherTrack(),
      onRemoteVideoGone: (track) => {
        if (screenTrackRef.current === track) screenTrackRef.current = null
        if (cameraTrackRef.current === track) cameraTrackRef.current = null
        track.detach()
        // 공유가 끝나면 카메라로 되돌린다 (예전엔 빈 화면으로 남았다)
        bindTeacherTrack()
      },
      onPresence: (ids) => useLiveStore.getState().setOnlineIdentities(ids),
      onSpeakers: (ids) => useLiveStore.getState().setSpeakingIdentities(ids),
      /*
        예전엔 이 콜백이 비어 있어서 **접속 실패가 완전히 조용했다.** 재시도 5회를 다 쓰고
        포기해도 학생 화면엔 아무 안내가 없어(그때는 가짜 교실 사진이 깔려 있었다) 선생님
        방송이 안 나오는 이유를 알 수 없었다.
      */
      onError: (message) => useToastStore.getState().show(message),
      onAudioBlocked: (blocked) => useAudioStore.getState().setBlocked(blocked),
    })
  }
  /**
   * 팀 룸에서 **내 발행 권한이 바뀐 횟수** — 잠금 해제 복구의 재시도 신호.
   *
   * 선생님이 잠갔다 풀면 서버가 발행물을 내렸다가 권한만 돌려준다(발행물은 저절로
   * 안 돌아온다). 이 값이 바뀌면 아래 카메라/마이크 효과가 다시 돌아 재발행을 시도한다.
   */
  const [permVersion, setPermVersion] = useState(0)

  // 팀 룸 — 내 캠/마이크 송출용
  if (!teamRoomRef.current) {
    teamRoomRef.current = new ClassroomSignaling({
      onStatus: (status) => setPublishing(status === 'connected'),
      onLocalPermissionsChanged: () => {
        // [media-lock] 진단 로그 — 서버가 발행 권한을 실제로 돌려주는지 확인용. 원인이 잡히면 지운다.
        console.info('[media-lock] team-room permissions changed')
        setPermVersion((v) => v + 1)
      },
    })
  }

  // ── 입장 ─────────────────────────────────────────────────────
  /*
    한 번의 join 응답에 두 룸의 토큰이 함께 온다. 그런데 재접속 때는 **반드시 새 토큰**이어야
    한다(TTL 5분) — 그래서 각 룸에 티켓 발급 함수를 넘기고, 그 함수가 join 을 다시 부른다.

    joinRef 는 아주 짧은 공유 창(JOIN_SHARE_MS)이다. 입장 순간 두 룸이 거의 동시에 티켓을
    요구하므로 그때는 한 번의 join 을 나눠 쓰고, 그 창을 넘긴 재접속은 새로 받는다.
    창이 몇 초라 여기서 재사용되는 토큰은 항상 갓 발급된 것이다.
  */
  const joinRef = useRef<{ promise: Promise<JoinResponse>; at: number } | null>(null)

  const freshJoin = useCallback(
    (id: number): Promise<JoinResponse> => {
      const cached = joinRef.current
      if (cached && Date.now() - cached.at < JOIN_SHARE_MS) return cached.promise
      const promise = sessionApi.join(id)
      joinRef.current = { promise, at: Date.now() }
      return promise
    },
    [],
  )

  useEffect(() => {
    const classRoom = classRoomRef.current
    const teamRoom = teamRoomRef.current
    if (!classRoom || !teamRoom || sessionId === null) return

    let cancelled = false
    joinRef.current = null
    void (async () => {
      try {
        // 팀 배정 여부를 먼저 확인한다 — 팀이 없으면 팀 룸에 붙지 않는다(수신만 하고 송출 없음)
        const first = await freshJoin(sessionId)
        if (cancelled) return
        useLiveStore.getState().setLivekitUrl(first.livekitUrl)

        await classRoom.connectWithTicket(async () => {
          const res = await freshJoin(sessionId)
          useLiveStore.getState().setLivekitUrl(res.livekitUrl)
          return { url: res.livekitUrl, token: res.classroomRoom.token }
        })

        if (!first.teamRoom || cancelled) return
        await teamRoom.connectWithTicket(async () => {
          const res = await freshJoin(sessionId)
          // 재접속 시점에 팀 배정이 사라졌다면 재시도해도 소용없다 — 사유를 남기고 멈춘다
          if (!res.teamRoom) throw new Error('팀 배정이 없어 내 화면을 보낼 수 없어요')
          return { url: res.livekitUrl, token: res.teamRoom.token }
        })
      } catch {
        if (!cancelled) setSignalingStatus('error')
      }
    })()

    return () => {
      cancelled = true
      joinRef.current = null
      void classRoom.disconnect()
      void teamRoom.disconnect()
    }
  }, [sessionId, setSignalingStatus, freshJoin])

  // ── 하드웨어 획득 ────────────────────────────────────────────
  /*
    스토어의 micOn/cameraOn 이 진실의 원천인데(useMediaControls) MediaDeviceManager 는 꺼진
    상태로 출발하고, getUserMedia 는 토글 핸들러 안에서만 불렸다. 그래서 입장 직후에는
    **아무도 장치를 잡지 않아** 스트림이 null 이었다 — 아래 발행 효과가 `!stream` 으로 빠져나가
    화면엔 마이크가 켜진 것처럼 보이는데 실제로는 목소리가 나가지 않았고, 토글을 두 번
    눌러야(끄고 다시 켜야) 비로소 발행됐다. 입장할 때 스토어 의도대로 한 번 맞춘다.

    getState() 로 읽어 의존성을 비운다 — 이후 토글은 useMediaControls 가 처리하므로
    이 효과는 입장당 한 번만 돌아야 한다.
  */
  useEffect(() => {
    const { micOn: wantMic, cameraOn: wantCamera } = useClassroomStore.getState()
    void localMedia.setMicEnabled(wantMic)
    void localMedia.setCameraEnabled(wantCamera)
  }, [])

  // ── 셀프뷰: 로컬 스트림을 <video>에 물린다 (LiveKit 무관) ───────
  const bindSelf = useCallback(() => {
    if (selfElRef.current) selfElRef.current.srcObject = localMedia.getLocalStream()
  }, [])

  /**
   * 로컬 스트림이 잡혔는지 — 발행 효과를 다시 돌리기 위한 **React 상태**다.
   * `localMedia.getLocalStream()` 만 보면 비동기 획득이 끝나도 렌더가 일어나지 않아
   * 발행 효과가 다시 평가되지 않는다(선생님 훅은 이 연결이 있어 같은 버그가 없었다).
   */
  const [hasLocalStream, setHasLocalStream] = useState(false)

  useEffect(() => {
    const sync = () => {
      bindSelf()
      setHasLocalStream(localMedia.getLocalStream() !== null)
    }
    const unsub = localMedia.subscribe(sync)
    sync()
    return unsub
  }, [bindSelf])

  // 교실을 떠날 때만 하드웨어를 놓아준다(카메라 불 꺼짐)
  useEffect(() => () => localMedia.release(), [])

  // ── 팀 룸 송출 ───────────────────────────────────────────────
  // 게시는 접속당 1회, 이후 on/off 는 트랙 mute 로 전파한다(재게시하면 화면이 끊긴다).
  const publishedRef = useRef(false)
  useEffect(() => {
    if (!publishing) publishedRef.current = false
  }, [publishing])

  const [published, setPublished] = useState(false)

  useEffect(() => {
    const teamRoom = teamRoomRef.current
    if (!teamRoom || !publishing || publishedRef.current) return
    const stream = localMedia.getLocalStream()
    if (!stream) return
    publishedRef.current = true
    void teamRoom.publishLocal(stream).then((outcome) => {
      setPublished(true)
      // 발행 실패를 삼키지 않는다 — 마이크만 실패해도 학생은 자기 목소리가 나간다고 믿는다.
      // (마이크가 잠긴 학생은 팀 룸 토큰에 microphone 권한이 없어 여기로 온다)
      if (outcome.failed.some((f) => f.source === Track.Source.Microphone)) {
        useToastStore.getState().show('마이크가 수업에 연결되지 않았어요. 선생님에게 알려 주세요.')
      }
    })
  }, [publishing, hasLocalStream, cameraOn, micOn])

  useEffect(() => {
    if (!publishing) setPublished(false)
  }, [publishing])

  /*
    카메라/마이크 토글을 게시 중인 트랙에도 반영한다.
    `published` 를 의존성에 넣은 이유: 게시가 끝나기 전에는 발행물이 없어서 mute 요청이
    아무 일도 하지 않는다. 게시 직후 한 번 더 적용해 **카메라를 끈 상태로 들어온 학생**의
    영상이 남들에게 켜진 것으로 나가지 않게 한다.

    켤 때는 `ensureTrackPublished` 도 함께 부른다 — 선생님이 잠갔다 풀면 서버가 발행물을
    내렸다가 권한만 돌려주므로, mute 토글만으로는 잡을 발행물이 없어 **화면이 선생님에게
    다시 나가지 않았다.** `permVersion` 이 의존성에 있는 이유: STOMP 잠금 해제가 LiveKit
    권한 복구보다 먼저 오면 첫 재발행이 거절되는데, 곧이어 오는 권한 변경 이벤트가 이 값을
    올려 효과를 다시 돌린다.
  */
  /**
   * 켤 때 두 단계를 거친다: **죽은 트랙 되살리기 → 발행물 확인**.
   *
   * 잠금이 풀려도 사라진 발행물은 저절로 돌아오지 않는다(백엔드가 권한만 복구한다 —
   * 서버가 학생 브라우저의 카메라를 대신 켜 줄 수는 없다). 게다가 잠길 때 livekit-client 가
   * 로컬 트랙을 `stop()` 해 버려서, 그 껍데기를 다시 publish 하면 검은 화면이 나간다.
   * 그래서 하드웨어를 먼저 확인하고(`reacquireIfEnded`) 그다음에 발행한다.
   */
  /**
   * **두 소스를 함께 본다.** 한 소스만 다시 발행하면 다른 쪽이 죽은 채 남는다.
   *
   * `reacquireIfEnded()` 는 트랙 하나가 죽으면 <b>스트림을 통째로</b> 새로 잡는다(살아 있는
   * 트랙도 함께 정리한다 — 죽은 트랙이 섞인 스트림을 남기지 않으려고). 그래서 카메라만
   * 되살리려고 불러도 마이크 트랙까지 새것이 되는데, 옛 마이크 발행물은 죽은 트랙을 가리킨 채
   * 남아 소리가 끊긴다. 반대 방향도 같다 — 마이크가 잠겨 죽으면 카메라 트랙까지 갈려서
   * 선생님 화면의 학생 영상이 마지막 프레임에 얼어붙었다.
   *
   * `source` 는 **어느 쪽이 죽었는지 판정할 범위**다(`reacquireIfEnded(kind)`). 다시 잡는
   * 순간에는 여전히 스트림이 통째로 갈리므로, 그 뒤에는 지금 켜져 있어야 하는 소스를 모두
   * 확인한다. `ensureTrackPublished` 는 이미 그 트랙이 나가고 있으면 아무 일도 하지 않는다.
   */
  const republish = useCallback(async (source: Track.Source) => {
    const teamRoom = teamRoomRef.current
    if (!teamRoom) return
    // 죽었는지 볼 범위만 좁힌다 — 다시 잡을 때는 스트림이 통째로 갈린다 (위 주석 참고)
    await localMedia.reacquireIfEnded(source === Track.Source.Camera ? 'video' : 'audio')
    const stream = localMedia.getLocalStream()
    if (!stream) return

    const { cameraOn: wantCamera, micOn: wantMic } = useClassroomStore.getState()
    if (wantCamera) await teamRoom.ensureTrackPublished(Track.Source.Camera, stream)
    if (wantMic) await teamRoom.ensureTrackPublished(Track.Source.Microphone, stream)
    /* 새로 올린 트랙에는 mute 의도가 안 실려 있다 — 다시 입힌다 */
    teamRoom.setTrackEnabled(Track.Source.Camera, wantCamera)
    teamRoom.setTrackEnabled(Track.Source.Microphone, wantMic)
  }, [])

  useEffect(() => {
    const teamRoom = teamRoomRef.current
    if (!teamRoom) return
    teamRoom.setTrackEnabled(Track.Source.Camera, cameraOn)
    if (cameraOn) void republish(Track.Source.Camera)
  }, [cameraOn, published, permVersion, republish])
  useEffect(() => {
    const teamRoom = teamRoomRef.current
    if (!teamRoom) return
    teamRoom.setTrackEnabled(Track.Source.Microphone, micOn)
    if (micOn) void republish(Track.Source.Microphone)
  }, [micOn, published, permVersion, republish])

  /** 선생님 방송을 붙일 <video> 콜백 ref */
  const attachTeacherVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      teacherElRef.current = el
      if (el) bindTeacherTrack()
    },
    [bindTeacherTrack],
  )

  /** 내 얼굴(셀프뷰)을 붙일 <video> 콜백 ref */
  const attachSelfVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      selfElRef.current = el
      bindSelf()
    },
    [bindSelf],
  )

  return { attachTeacherVideo, attachSelfVideo, publishing, teacherScreenShare }
}
