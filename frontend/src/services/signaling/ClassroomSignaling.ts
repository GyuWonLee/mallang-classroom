import {
  DisconnectReason,
  LocalTrackPublication,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPresets,
  type LocalTrack,
  type RemoteTrack,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type TrackPublishOptions,
} from 'livekit-client'
import { remoteAudio } from '@/services/media/RemoteAudioPlayer'

export type SignalingStatus = 'idle' | 'connecting' | 'connected' | 'error'

/** 룸 하나에 접속하는 데 필요한 것 — join/visit 응답에서 뽑아 온다 */
export interface RoomTicket {
  url: string
  token: string
}

/**
 * 티켓 발급 함수. **재접속할 때마다 다시 불린다** — 백엔드 토큰 TTL 이 5분이라
 * 옛 토큰을 그대로 다시 쓰면 접속이 거절된다(반드시 join/visit 재호출 → 새 토큰 → connect).
 */
export type TicketProvider = () => Promise<RoomTicket>

export interface SignalingEvents {
  onStatus?: (status: SignalingStatus) => void
  /**
   * 원격(선생님) 비디오 트랙 도착 → <video>에 attach.
   *
   * `isScreenShare` 를 함께 넘긴다. 화면 공유는 `publishTrack(..., { source: ScreenShare })`
   * 로 발행되므로 SFU 를 건너온 뒤에도 구분할 수 있다 — 받는 쪽이 카메라(cover)와
   * 화면 공유(contain)를 다르게 그려야 세로로 긴 화면이 좌우로 잘리지 않는다.
   * (카메라 트랙은 source 를 안 붙여 `Unknown` 으로 오므로 "화면 공유인가?"만 신뢰한다)
   */
  onRemoteVideo?: (
    track: RemoteTrack,
    participant: RemoteParticipant,
    isScreenShare: boolean,
  ) => void
  /** 원격 트랙 해제 */
  onRemoteVideoGone?: (track: RemoteTrack, isScreenShare: boolean) => void
  /**
   * 원격 비디오가 mute/unmute 됐을 때 — **구독은 유지된 채 그림만 멈춘다.**
   * 선생님이 카메라를 끄는 방식이 이것이라(트랙을 내리지 않는다) 이 신호가 없으면
   * 받는 쪽은 "아직 방송 중"이라고 믿는다.
   */
  onRemoteVideoMuteChanged?: (track: RemoteTrack, muted: boolean) => void
  /** 룸에 실제로 접속해 있는 사람 목록(identity)이 바뀔 때 — 프레즌스의 유일한 출처 */
  onPresence?: (identities: string[]) => void
  /** 말하고 있는 사람(identity) 목록 */
  onSpeakers?: (identities: string[]) => void
  /** 브라우저가 원격 오디오 자동 재생을 막았는지 (해제는 사용자 제스처 + startAudio) */
  onAudioBlocked?: (blocked: boolean) => void
  /**
   * **내** 발행 권한(canPublishSources)이 서버에서 바뀌었을 때.
   *
   * 선생님이 마이크/카메라를 잠그면 백엔드가 이 권한을 빼고, 그 순간 LiveKit 이 해당
   * 발행물을 **서버 쪽에서 내려 버린다.** 잠금을 풀면 권한은 돌아오지만 발행물은 저절로
   * 되살아나지 않는다 — 이 신호를 받은 쪽이 다시 발행해야 한다(ensureTrackPublished).
   */
  onLocalPermissionsChanged?: () => void
  onError?: (message: string) => void
}

/** publishLocal 결과 — 트랙별로 성공/실패를 따로 돌려준다(하나가 실패해도 나머지는 나간다) */
export interface PublishOutcome {
  published: Track.Source[]
  failed: { source: Track.Source; message: string }[]
}

/**
 * 다시 붙어봐야 소용없는 종료 사유 — 강퇴/수업 종료/중복 로그인.
 * 이 경우 재접속은 서버가 또 거절하므로 시도하지 않는다.
 */
const FATAL_DISCONNECT: DisconnectReason[] = [
  DisconnectReason.CLIENT_INITIATED,
  DisconnectReason.DUPLICATE_IDENTITY,
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.ROOM_DELETED,
]

function sourceOf(track: MediaStreamTrack): Track.Source {
  return track.kind === 'video' ? Track.Source.Camera : Track.Source.Microphone
}

/**
 * 카메라 발행 옵션 — **화질을 결정하는 두 번째 지점**(첫째는 캡처 해상도, MediaDeviceManager).
 *
 * 옵션을 안 주면 livekit-client 가 보수적인 기본 비트레이트를 골라, 720p 로 캡처해도
 * 실제로는 뭉개져 나갔다. 720p 프리셋을 명시한다.
 *
 * `simulcast` 는 켠 채로 둔다(기본값). 선생님 화면의 학생 타일은 작고 학생 화면의 선생님
 * 영상은 크다 — 한 가지 해상도만 보내면 둘 중 하나가 손해다. 여러 레이어를 함께 보내고
 * 받는 쪽 크기에 맞춰 고르게 한다(adaptiveStream + dynacast 와 짝).
 */
const CAMERA_PUBLISH: TrackPublishOptions = {
  videoEncoding: VideoPresets.h720.encoding,
  simulcast: true,
}

/**
 * 화면 공유 발행 옵션 — 카메라와 기준이 다르다.
 *
 * 화면 공유는 **글자를 읽는 것**이 목적이라 해상도가 프레임보다 중요하다. 그래서 1080p·15fps
 * 프리셋을 쓴다(움직임은 적고 글자는 선명해야 한다). 카메라용 720p30 을 그대로 쓰면
 * 판서 배경의 교과서 글씨가 흐려진다.
 */
const SCREEN_PUBLISH: TrackPublishOptions = {
  source: Track.Source.ScreenShare,
  videoEncoding: ScreenSharePresets.h1080fps15.encoding,
  // 화면 공유는 레이어를 나누지 않는다 — 낮은 레이어로 떨어지면 글자를 못 읽는다
  simulcast: false,
}

/**
 * ClassroomSignaling — LiveKit SFU(WebRTC 미디어) 연결만 책임진다. (SRP, no React)
 *
 * 진입 흐름: `sessionApi.join(sessionId)` → `{ livekitUrl, classroomRoom.token, teamRoom }` →
 * `connectWithTicket(...)`.
 *
 * 백엔드 계약 (SessionTicketService / LiveKitWebhookController 와 일치해야 함):
 *  - 룸 이름: 학급 `session-{sessionId}`, 팀 `session-{sessionId}-team-{teamId}`
 *  - identity: `teacher-{userId}` / `student-{userId}` (토큰 발급 시 백엔드가 심는다)
 *  - **학생은 학급 룸에서 canPublish=false(수신 전용)**, 선생님만 게시. 팀 룸에서는 학생도 게시 가능.
 *  - 마이크가 잠긴 학생은 팀 룸 토큰의 canPublishSources 에서 microphone 이 빠진다 →
 *    **마이크 발행만 실패하고 카메라는 나가야 한다** (publishLocal 이 트랙별로 독립 발행하는 이유).
 *  - canPublishData=false — 앱 이벤트는 LiveKit 이 아니라 STOMP(ClassroomSocket)로 주고받는다.
 *  - 토큰 TTL 5분 → 재접속은 반드시 "티켓 재발급 → connect" 순서다.
 *
 * 프레즌스: 백엔드가 학생 접속 상태를 STOMP 로 방송하지 않으므로, **누가 지금 교실에 있는지는
 * 이 룸의 참가자 목록이 유일한 실시간 출처**다. onPresence 로 노출한다.
 *
 * 소리: 원격 오디오는 `RemoteAudioPlayer` 가 DOM 에 붙여야 들린다(livekit-client 는 자동 재생하지 않는다).
 */
export class ClassroomSignaling {
  private room: Room | null = null
  private events: SignalingEvents
  private screenPublication: LocalTrackPublication | null = null
  /** 화면 공유의 **소리** 트랙 — 영상과 수명이 같지만 따로 내려야 한다 */
  private screenAudioPublication: LocalTrackPublication | null = null
  /** 이 룸에서 재생 중인 원격 오디오 트랙 — 나갈 때 DOM 에서 걷어내려고 들고 있는다 */
  private audioTracks = new Set<RemoteTrack>()

  // ── 재접속 ────────────────────────────────────────────────────
  private ticket: TicketProvider | null = null
  /** 사용자가 직접 나갔거나 재접속을 포기한 상태 — 이때는 다시 붙지 않는다 */
  private leaving = false
  private opening = false
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  /** 마지막 실패 사유 — 재시도를 다 쓴 뒤 사용자에게 보여줄 문장에 쓴다 */
  private lastError = '연결에 실패했어요'
  private static readonly MAX_RETRIES = 5
  private static readonly RETRY_BASE_MS = 1000
  private static readonly RETRY_CAP_MS = 15000

  constructor(events: SignalingEvents = {}) {
    this.events = events
  }

  get status(): SignalingStatus {
    if (!this.room) return 'idle'
    return this.room.state === 'connected' ? 'connected' : 'connecting'
  }

  /** 지금 룸에 있는 원격 참가자 identity 목록 */
  get remoteIdentities(): string[] {
    if (!this.room) return []
    return Array.from(this.room.remoteParticipants.values()).map((p) => p.identity)
  }

  /** 티켓을 직접 들고 있는 경우(재접속 없음). 일반 경로는 connectWithTicket 을 쓴다. */
  async connect(url: string, token: string): Promise<void> {
    await this.connectWithTicket(async () => ({ url, token }))
  }

  /**
   * 티켓 발급 함수를 주고 접속한다. 예기치 않게 끊기면 **티켓을 다시 받아** 재접속한다
   * (지수 백오프, 최대 5회). 사용자가 나갔거나 강퇴/수업 종료면 시도하지 않는다.
   */
  async connectWithTicket(getTicket: TicketProvider): Promise<void> {
    /*
      티켓과 `leaving` 은 **가드보다 먼저** 세팅한다. 순서를 뒤집으면 인스턴스가 죽는다:

      StrictMode 이중 마운트에서 mount#1 이 티켓 발급(HTTP join)을 기다리는 동안 cleanup 이
      `disconnect()` → `leaving=true, ticket=null` 로 만든다. 이어서 mount#2 가 들어오는데
      `opening` 이 아직 true 라 예전 코드는 여기서 즉시 return 했다 — 그래서 `ticket` 이
      영원히 null 로 남아 `open()` 도 `scheduleReconnect()`(`!this.ticket` 로 빠진다)도
      못 하고 **그 페이지에 있는 동안 다시는 접속하지 않았다.**

      선생님만 재현됐다. 학생 훅(useStudentStage)은 join 을 `connectWithTicket` **앞에서**
      await 해서 cleanup 시점에 `opening` 이 false 지만, 선생님 쪽(`TeacherBroadcast`)은
      티켓 발급이 콜백 **안**에 있어 정확히 이 창에 걸렸다. 증상은 "선생님 화면은
      로컬 미리보기라 정상인데 학생에게는 아무것도 가지 않음" 이었다.

      아래 값을 먼저 세팅해 두면 진행 중인 `open()` 이 `if (this.leaving) return` 을
      통과해 그대로 접속을 마친다.
    */
    this.ticket = getTicket
    this.leaving = false
    this.retries = 0
    if (this.room || this.opening) return
    await this.open()
  }

  private async open(): Promise<void> {
    const getTicket = this.ticket
    if (!getTicket || this.room || this.opening) return
    this.opening = true
    this.events.onStatus?.('connecting')
    try {
      const ticket = await getTicket()
      if (this.leaving) return
      await this.openRoom(ticket)
    } catch (err) {
      if (this.leaving) return
      // 티켓 발급 실패(네트워크·서버 오류)도 재시도 대상이다. 사유 안내는 호출부(훅)가 한다.
      this.lastError = err instanceof Error ? err.message : '연결에 실패했어요'
      this.scheduleReconnect()
    } finally {
      this.opening = false
    }
  }

  private async openRoom(ticket: RoomTicket): Promise<void> {
    const room = new Room({ adaptiveStream: true, dynacast: true })
    this.room = room

    room
      .on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed)
      // 카메라 끄기는 unpublish 가 아니라 mute 다 — 이 둘이 없으면 받는 쪽이 알 수 없다
      .on(RoomEvent.TrackMuted, (pub) => this.handleTrackMuteChanged(pub as RemoteTrackPublication))
      .on(RoomEvent.TrackUnmuted, (pub) =>
        this.handleTrackMuteChanged(pub as RemoteTrackPublication),
      )
      .on(RoomEvent.ParticipantConnected, this.emitPresence)
      .on(RoomEvent.ParticipantDisconnected, this.emitPresence)
      .on(RoomEvent.ActiveSpeakersChanged, this.handleActiveSpeakers)
      // LiveKit 자체 복구(짧은 네트워크 끊김) — 상태만 따라간다
      .on(RoomEvent.Reconnecting, () => this.events.onStatus?.('connecting'))
      .on(RoomEvent.Reconnected, () => {
        this.events.onStatus?.('connected')
        this.emitPresence()
      })
      // 내 발행 권한이 바뀜(잠금/해제) → 밖에서 발행물을 다시 맞춘다
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
        if (participant.isLocal) this.events.onLocalPermissionsChanged?.()
      })
      // 자동 재생 차단 여부가 바뀜 → 밖(스토어/UI)에 알린다
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        const blocked = !room.canPlaybackAudio
        remoteAudio.setBlocked(this, blocked)
        this.events.onAudioBlocked?.(blocked)
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => this.handleDisconnected(reason))

    try {
      await room.connect(ticket.url, ticket.token)
      if (this.leaving) {
        await room.disconnect()
        return
      }
      this.retries = 0
      // 사용자 제스처에서 소리를 켤 수 있는 경로를 열어 둔다 (자동 재생이 막혔을 때)
      remoteAudio.registerRoom(this, () => room.startAudio())
      remoteAudio.setBlocked(this, !room.canPlaybackAudio)
      this.events.onAudioBlocked?.(!room.canPlaybackAudio)
      this.events.onStatus?.('connected')
      this.emitPresence()
    } catch (err) {
      this.teardownRoom(room)
      this.room = null
      this.lastError = err instanceof Error ? err.message : '연결에 실패했어요'
      if (!this.leaving) this.scheduleReconnect()
    }
  }

  private handleDisconnected(reason?: DisconnectReason): void {
    const room = this.room
    if (room) this.teardownRoom(room)
    this.room = null
    this.events.onPresence?.([])

    if (this.leaving || (reason !== undefined && FATAL_DISCONNECT.includes(reason))) {
      this.events.onStatus?.('idle')
      return
    }
    this.lastError = '수업 연결이 끊겼어요'
    this.scheduleReconnect()
  }

  /**
   * 지수 백오프 재접속. 매번 **티켓부터 다시 받는다**(토큰 TTL 5분).
   * 최대 횟수를 넘기면 무한 루프 대신 error 로 굳히고 사용자에게 알린다.
   */
  private scheduleReconnect(): void {
    if (this.leaving || this.retryTimer || !this.ticket) return
    if (this.retries >= ClassroomSignaling.MAX_RETRIES) {
      this.events.onStatus?.('error')
      this.events.onError?.(`${this.lastError} 새로고침한 뒤 다시 들어와 주세요.`)
      return
    }
    const delay = Math.min(
      ClassroomSignaling.RETRY_CAP_MS,
      ClassroomSignaling.RETRY_BASE_MS * 2 ** this.retries,
    )
    this.retries += 1
    this.events.onStatus?.('connecting')
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.open()
    }, delay)
  }

  /** 재접속을 포기한다 — 강퇴/수업 종료처럼 다시 들어갈 수 없는 오류에서 호출부가 부른다 */
  stopRetrying(): void {
    this.leaving = true
    this.ticket = null
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  /**
   * 로컬 마이크/카메라를 방송에 게시.
   *
   * **트랙마다 독립적으로 발행한다(`Promise.allSettled`).** 순차 `await` 였을 때는
   * 마이크가 잠긴 학생(팀 룸 토큰에 microphone 권한이 없다)에서 마이크 발행이 reject 되면
   * **뒤의 카메라 트랙이 아예 발행되지 않았다** — 선생님 화면에서 그 학생만 검게 남았다.
   *
   * **`source` 를 반드시 붙인다.** LiveKit 은 발행 옵션에 source 가 없으면 `Unknown` 으로 두고,
   * 그 값이 그대로 SFU 를 건너간다. 그러면 두 가지가 조용히 망가진다:
   *  1) `setTrackEnabled(Track.Source.Camera, ...)` 가 쓰는 `getTrackPublication(source)` 는
   *     source 를 정확히 비교하므로 `undefined` 를 돌려준다 → **수업 중 마이크/카메라 토글이
   *     상대에게 전혀 반영되지 않았다**(내 화면만 바뀌고 남들은 계속 보고/듣고 있었다).
   *  2) 받는 쪽이 카메라와 화면 공유를 구분할 수 없다 (화면 공유만 태그돼 있어 그쪽은 무사).
   *
   * 실패는 삼키지 않고 `failed` 로 돌려준다 — 호출부가 사용자에게 알린다.
   */
  async publishLocal(stream: MediaStream): Promise<PublishOutcome> {
    const outcome: PublishOutcome = { published: [], failed: [] }
    const room = this.room
    if (!room) return outcome

    const tracks = stream.getTracks()
    const results = await Promise.allSettled(
      tracks.map((track) => {
        const source = sourceOf(track)
        // 비디오만 인코딩 옵션을 얹는다 (오디오는 기본값으로 충분하다)
        const options: TrackPublishOptions =
          source === Track.Source.Camera ? { ...CAMERA_PUBLISH, source } : { source }
        return room.localParticipant.publishTrack(track, options)
      }),
    )
    results.forEach((result, i) => {
      const source = sourceOf(tracks[i])
      if (result.status === 'fulfilled') outcome.published.push(source)
      else {
        const reason: unknown = result.reason
        outcome.failed.push({
          source,
          message: reason instanceof Error ? reason.message : String(reason),
        })
      }
    })
    return outcome
  }

  /**
   * 화면공유 트랙 게시 (선생님 화면공유 = 화이트보드 배경 영상).
   * 판서 획은 STOMP 로 따로 오가고, 클라이언트가 이 영상 위에 겹쳐 그린다(서버 합성 없음).
   */
  async publishScreen(stream: MediaStream): Promise<void> {
    if (!this.room) return
    const [videoTrack] = stream.getVideoTracks()
    if (!videoTrack) return
    await this.unpublishScreen()
    const publication = await this.room.localParticipant.publishTrack(videoTrack, SCREEN_PUBLISH)
    this.screenPublication = publication ?? null
    // [pdf-share] 진단 로그 — 학생에게 안 보이는 문제를 쫓는 중. 원인이 잡히면 지운다.
    console.info('[pdf-share] 3. LiveKit 게시 완료', {
      trackSid: publication?.trackSid,
      source: publication?.source,
      muted: publication?.isMuted,
    })

    /*
      **화면 속 소리도 함께 올린다.** 예전엔 비디오 트랙만 게시해서 유튜브·동영상 자료를
      틀어도 학생에게는 그림만 갔다(선생님은 자기 스피커로 들으니 알아채기 어렵다).

      `ScreenShareAudio` 소스로 올려야 마이크와 구분된다 — 백엔드 토큰이 허용 소스에
      `screen_share_audio` 를 넣어 두었다(LiveKitTokenService). 마이크와 같은 소스로 올리면
      선생님이 마이크를 끌 때 화면 소리까지 같이 끊긴다.

      트랙이 없을 수 있다(선생님이 "탭 오디오 공유"를 끔 / Firefox·Safari 미지원).
      그때는 조용히 영상만 보낸다 — 소리 때문에 화면 공유 자체가 실패하면 안 된다.
      `simulcast` 는 오디오에 뜻이 없어 붙이지 않는다.
    */
    const [audioTrack] = stream.getAudioTracks()
    if (!audioTrack) return
    try {
      this.screenAudioPublication = await this.room.localParticipant.publishTrack(audioTrack, {
        source: Track.Source.ScreenShareAudio,
      })
    } catch (err) {
      // 소리만 실패한 것 — 영상은 이미 나가고 있으므로 알리기만 한다
      this.events.onError?.('화면 속 소리를 함께 보내지 못했어요. 영상만 공유돼요.')
      this.screenAudioPublication = null
      void err
    }
  }

  /** 화면공유 중지 — 게시했던 트랙만 정확히 내린다 (영상 + 화면 소리) */
  async unpublishScreen(): Promise<void> {
    const track = this.screenPublication?.track
    const audio = this.screenAudioPublication?.track
    this.screenPublication = null
    this.screenAudioPublication = null
    if (!this.room) return
    /*
      **두 번째 인자(stopOnUnpublish)를 false 로 준다.** 기본값이 true 라, 게시를 내리면
      LiveKit 이 원본 MediaStreamTrack 까지 정지시킨다. 그런데 그 트랙의 주인은 우리다 —
      화면공유는 `ScreenShareManager`, PDF 는 `PdfPresenter` 가 만들고 자기가 끝낸다.
      LiveKit 이 대신 꺼 버리면, 게시만 갈아 끼우려던 경우에 **원본이 죽어 되살릴 길이 없다**
      (PDF 캔버스가 죽어 선생님·학생 모두 검은 화면이 되던 일이 실제로 있었다).
    */
    if (track) await this.room.localParticipant.unpublishTrack(track as LocalTrack, false)
    if (audio) await this.room.localParticipant.unpublishTrack(audio as LocalTrack, false)
  }

  /** 게시 중인 마이크/카메라 on-off (재게시 없이 트랙만 토글) */
  setTrackEnabled(source: Track.Source, enabled: boolean): void {
    const publication = this.room?.localParticipant.getTrackPublication(source)
    if (!publication?.track) return
    if (enabled) void publication.track.unmute()
    else void publication.track.mute()
  }

  /**
   * 발행물이 **없으면** 다시 발행한다 — 잠금 해제 복구용.
   *
   * 선생님이 잠그면 백엔드가 canPublishSources 에서 그 소스를 빼고, LiveKit 은 그 순간
   * 발행물을 서버 쪽에서 내린다. 잠금이 풀려도 발행물은 저절로 돌아오지 않아서,
   * `setTrackEnabled` 는 잡을 발행물이 없어 아무 일도 못 했다 — **풀어도 학생 화면이
   * 선생님에게 다시 나가지 않던** 원인이다.
   *
   * 발행 실패는 삼킨다: STOMP 잠금 해제가 LiveKit 권한 복구보다 먼저 도착하는 순서 역전이
   * 흔하고, 그때는 곧이어 오는 권한 변경 이벤트(onLocalPermissionsChanged)가 다시 부른다.
   */
  async ensureTrackPublished(source: Track.Source, stream: MediaStream): Promise<void> {
    const room = this.room
    if (!room) return
    const track = stream.getTracks().find((t) => sourceOf(t) === source)
    if (!track) return

    /*
      **발행물이 있다고 끝난 게 아니다.** 예전에는 `getTrackPublication(source)?.track` 이
      있으면 그대로 돌아갔는데, 그 트랙이 이미 죽었거나 우리가 새로 잡은 트랙과 다른 경우가 있다.

       - 선생님이 마이크를 잠그면 livekit-client 가 로컬 트랙을 stop() 한다.
       - 그러면 하드웨어를 다시 잡는데(MediaDeviceManager.reacquireIfEnded), 그때 스트림이
         통째로 새로 생겨 **카메라 트랙까지 새것**이 된다.

      옛 발행물은 죽은 트랙을 가리킨 채 남아 있으므로, 위 검사만으로는 새 트랙이 영영 올라가지
      않는다. 받는 쪽에는 마지막 프레임이 얼어붙은 화면이나 소리 없는 트랙으로 남는다 —
      "마이크를 껐더니 화면이 멈춘다", "카메라를 껐다 켜니 소리가 안 난다"가 이것이다.
    */
    const publication = room.localParticipant.getTrackPublication(source)
    const publishedTrack = publication?.track?.mediaStreamTrack
    const alive = publishedTrack && publishedTrack.readyState !== 'ended'
    if (alive && publishedTrack.id === track.id) {
      return // 지금 그 트랙이 그대로 나가고 있다
    }
    if (publication?.track) {
      // 죽었거나 다른 트랙이다 — 내리고 새로 올린다. 안 내리면 publishTrack 이 거절한다
      try {
        await room.localParticipant.unpublishTrack(publication.track, true)
      } catch {
        /* 이미 정리됐다 */
      }
    }

    const options: TrackPublishOptions =
      source === Track.Source.Camera ? { ...CAMERA_PUBLISH, source } : { source }
    try {
      await room.localParticipant.publishTrack(track, options)
    } catch {
      /* 권한이 아직 안 돌아왔다 — 권한 변경 이벤트에서 재시도된다 */
    }
  }

  /** **사용자 제스처 안에서** 부른다 — 막혀 있던 원격 오디오 재생을 시작한다 */
  async startAudio(): Promise<void> {
    await this.room?.startAudio()
  }

  async disconnect(): Promise<void> {
    this.stopRetrying()
    const room = this.room
    this.room = null
    this.screenPublication = null
    if (room) {
      this.teardownRoom(room)
      await room.disconnect()
    } else {
      remoteAudio.unregisterRoom(this)
    }
    this.events.onStatus?.('idle')
  }

  /** 룸 하나를 정리 — 붙여둔 오디오를 DOM 에서 걷어내고 재생 재개 등록을 지운다 */
  private teardownRoom(room: Room): void {
    this.audioTracks.forEach((track) => remoteAudio.detach(track))
    this.audioTracks.clear()
    remoteAudio.unregisterRoom(this)
    room.removeAllListeners()
  }

  /** 발행 측이 붙인 source 로 화면 공유를 판별한다 (트랙에도, 퍼블리케이션에도 실려 온다) */
  private static isScreen(track: RemoteTrack, pub?: RemoteTrackPublication): boolean {
    return track.source === Track.Source.ScreenShare || pub?.source === Track.Source.ScreenShare
  }

  private handleTrackSubscribed = (
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void => {
    if (track.kind === Track.Kind.Video) {
      this.events.onRemoteVideo?.(track, participant, ClassroomSignaling.isScreen(track, pub))
      /*
        구독 시점에 **이미 mute 인** 트랙이 있다. 선생님이 카메라를 끈 뒤에 들어온 학생이
        그렇다 — 알리지 않으면 그 학생만 "방송 중"으로 믿고 빈 무대를 본다.
      */
      if (pub.isMuted) this.handleTrackMuteChanged(pub)
      return
    }
    if (track.kind === Track.Kind.Audio) {
      // 붙이지 않으면 소리가 나지 않는다 — 화면 밖 <audio> 로 재생한다
      this.audioTracks.add(track)
      remoteAudio.attach(track)
    }
  }

  private handleTrackUnsubscribed = (
    track: RemoteTrack,
    pub?: RemoteTrackPublication,
  ): void => {
    if (track.kind === Track.Kind.Video) {
      this.events.onRemoteVideoGone?.(track, ClassroomSignaling.isScreen(track, pub))
      return
    }
    if (track.kind === Track.Kind.Audio) {
      this.audioTracks.delete(track)
      remoteAudio.detach(track)
    }
  }

  /**
   * 원격 트랙의 mute/unmute — **구독은 그대로인데 그림만 멈추는** 상태 변화다.
   *
   * 선생님이 카메라를 끄면 트랙을 내리지 않고 `mute()` 만 한다(`setTrackEnabled`).
   * 그래서 학생 쪽에는 `TrackUnsubscribed` 가 오지 않고, 붙어 있던 <video> 가 마지막
   * 프레임에서 멈춘 채 남는다 — "방송이 있다"고 믿은 화면은 슬라이드를 걷어낸 상태라
   * **아무것도 없는 빈 무대**가 됐다. 그래서 mute 도 트랙 변화로 함께 알린다.
   */
  private handleTrackMuteChanged = (pub: RemoteTrackPublication): void => {
    const track = pub.track
    if (!track || track.kind !== Track.Kind.Video) return
    this.events.onRemoteVideoMuteChanged?.(track, pub.isMuted)
  }

  private emitPresence = (): void => {
    this.events.onPresence?.(this.remoteIdentities)
  }

  private handleActiveSpeakers = (speakers: { identity: string }[]): void => {
    this.events.onSpeakers?.(speakers.map((s) => s.identity))
  }
}
