import { StreamRegistry } from './StreamRegistry'
import { Emitter } from '@/services/core/Emitter'

/** MediaDeviceManager가 외부로 알리는 원시 상태 (Zustand 반영용) */
export interface MediaState {
  micOn: boolean
  cameraOn: boolean
  /** 하드웨어 권한/획득 실패 여부 */
  error: string | null
  /** 실제로 잡힌 장치 — 마이크만 잡힌 경우가 있어 UI 가 버튼을 정직하게 그리려면 필요하다 */
  hasMic: boolean
  hasCamera: boolean
}

/**
 * 오디오 제약 — 교실은 스피커와 마이크가 같은 방에 있어 에코가 잘 생긴다.
 * 브라우저 기본값도 대개 켜져 있지만, 명시해 두면 구현체 차이에 흔들리지 않는다.
 */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

/**
 * 비디오 캡처 제약 — **화질의 출발점**이다.
 *
 * 예전엔 `video: true` 만 줘서 브라우저 기본값(대개 640x480)으로 잡혔다. SFU 는 트랜스코딩을
 * 하지 않으므로 **보내는 해상도가 그대로 상한**이 된다 — 받는 쪽에서 아무리 크게 띄워도
 * 480p 를 늘려 보는 것이라 흐렸다.
 *
 * `ideal` 을 쓴다(`exact` 아님). 720p 를 못 내는 웹캠이면 조용히 가능한 최대치로 잡히고,
 * `exact` 였다면 그 카메라에서 획득 자체가 실패한다(교실 노트북 사양이 제각각이다).
 */
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
}

/**
 * 획득 중에 release() 가 끼어들어 취소된 경우. 실패가 아니라 **취소**라서 사용자에게 알리지 않는다
 * (교실을 떠나는 순간 "마이크를 사용할 수 없어요" 토스트가 뜨면 뜬금없다).
 */
class AcquireCancelled extends Error {}

/**
 * MediaDeviceManager — 로컬 오디오/비디오 하드웨어의 획득·토글만 책임진다. (SRP)
 *
 * - 캡슐화: localStream은 private, 변경은 공개 메서드로만.
 * - 네이티브 MediaStream은 StreamRegistry에 보관(Rule 2).
 * - 구독/방출은 Emitter 베이스가 담당. 상태 변화는 리스너로만 알린다(Rule 1).
 */
export class MediaDeviceManager extends Emitter<MediaState> {
  private localStream: MediaStream | null = null
  /** 진행 중인 getUserMedia — 동시 호출이 하나의 스트림을 공유하게 만든다 */
  private pending: Promise<MediaStream> | null = null
  /** release() 호출 횟수 — 획득 대기 중에 놓아줬는지 판별한다 (미아 스트림 방지) */
  private releaseSeq = 0
  private micOn = false
  private cameraOn = false
  private error: string | null = null

  getState(): MediaState {
    return {
      micOn: this.micOn,
      cameraOn: this.cameraOn,
      error: this.error,
      hasMic: (this.localStream?.getAudioTracks().length ?? 0) > 0,
      hasCamera: (this.localStream?.getVideoTracks().length ?? 0) > 0,
    }
  }

  getLocalStream(): MediaStream | null {
    return this.localStream
  }

  /**
   * 실제로 장치를 잡는다. `{audio, video}` 를 한 번에 요구하면 **하나만 없어도 전부 거절된다** —
   * 카메라가 없거나 다른 앱(줌 등)이 물고 있는 노트북에서 마이크까지 못 잡혔다.
   * 그래서 오디오+비디오 → 오디오만 → 비디오만 순으로 물러난다. 수업에선 얼굴보다 목소리가 먼저다.
   */
  private static async acquire(): Promise<MediaStream> {
    const attempts: MediaStreamConstraints[] = [
      { audio: AUDIO_CONSTRAINTS, video: VIDEO_CONSTRAINTS },
      { audio: AUDIO_CONSTRAINTS, video: false },
      { audio: false, video: VIDEO_CONSTRAINTS },
    ]
    let lastError: unknown
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints)
      } catch (err) {
        lastError = err
      }
    }
    throw lastError instanceof Error ? lastError : new Error('마이크와 카메라를 사용할 수 없어요')
  }

  /**
   * 하드웨어를 획득한다(최초 1회). 이미 있으면 재사용.
   *
   * 진행 중인 획득을 `pending` 으로 공유한다 — 입장 시 마이크와 카메라를 함께 맞추면
   * 이 함수가 거의 동시에 두 번 불리는데, 그때 `getUserMedia` 를 두 번 띄우면
   * 권한 팝업이 두 개 뜨고 스트림 하나가 미아가 된다(카메라 불이 안 꺼짐).
   */
  private async ensureStream(): Promise<MediaStream> {
    if (this.localStream) return this.localStream
    this.pending ??= this.acquireOnce()
    try {
      return await this.pending
    } finally {
      this.pending = null
    }
  }

  private async acquireOnce(): Promise<MediaStream> {
    const seq = this.releaseSeq
    const stream = await MediaDeviceManager.acquire()
    /*
      기다리는 동안 release() 가 불렸다면(학생이 교실을 바로 떠남 / StrictMode 이중 마운트)
      이 스트림은 주인이 없다. 그냥 두면 아무도 stop() 하지 않아 **카메라 불이 계속 켜져 있다.**
      여기서 정리하고, 소유권을 넘기지 않는다.
    */
    if (seq !== this.releaseSeq) {
      stream.getTracks().forEach((t) => t.stop())
      throw new AcquireCancelled('미디어 획득이 취소됐어요')
    }
    this.localStream = stream
    StreamRegistry.set(StreamRegistry.LOCAL_ID, stream)
    // 획득 시점의 의도(micOn/cameraOn)를 그대로 트랙에 반영한다.
    stream.getAudioTracks().forEach((t) => (t.enabled = this.micOn))
    stream.getVideoTracks().forEach((t) => (t.enabled = this.cameraOn))
    return stream
  }

  /**
   * **죽은 트랙이 있으면 하드웨어를 다시 잡는다.**
   *
   * 선생님이 카메라를 잠그면 서버가 발행 권한을 빼고, livekit-client 는 그 소스의 발행물을
   * 내리면서 **로컬 트랙까지 `stop()` 한다**(룸 옵션 `stopLocalTrackOnUnpublish` 기본값 true).
   * 그러면 우리 손에 남은 `MediaStreamTrack` 은 `readyState === 'ended'` 인 껍데기다 —
   * 그걸 그대로 다시 publish 하면 검은 화면이 나가고 셀프뷰도 살아나지 않는다.
   *
   * `ensureStream()` 은 "스트림 객체가 있으면 재사용" 이라 이 상태를 스스로 못 벗어난다.
   * 그래서 죽은 트랙을 확인하고 통째로 새로 잡는 길을 따로 둔다.
   *
   * **사용자 제스처 안에서 불러야 한다**(학생이 카메라 버튼을 누른 흐름). getUserMedia 를
   * 다시 부르기 때문이다 — 권한은 이미 허용돼 있어 팝업이 다시 뜨지는 않는다.
   *
   * **판정 범위와 정리 범위가 다르다** — 둘을 헷갈리면 안 된다.
   *
   * `kind` 는 **어느 쪽이 죽었는지 볼 범위**만 좁힌다. 선생님이 마이크만 잠그면 오디오 트랙
   * 하나가 죽는데, 이때 `kind` 없이 판정하면 "이 스트림 죽었다"가 되어 **멀쩡한 카메라까지
   * 새로 잡는다.** 그 경로는 학생이 누른 것이 아니라 권한 변경 이벤트로 불려서 사용자 제스처
   * 밖이라(`useStudentStage.republish`), 다시 잡기가 실패하면 카메라가 없는 채로 남아
   * **새로고침해야 돌아왔다.** 그래서 카메라를 되살리려는 호출은 `'video'` 만 본다.
   *
   * 반면 **정리는 언제나 통째로 한다** — 한 번 다시 잡기로 정한 뒤에는 살아 있는 트랙도 함께
   * 버리고 새 스트림을 얻는다(죽은 트랙이 섞인 스트림을 남기지 않으려고). 그래서
   * **부르는 쪽은 두 소스를 모두 다시 발행해야 한다.** 한쪽만 올리면 다른 쪽 발행물이 죽은
   * 트랙을 가리킨 채 남아 그 미디어가 조용히 끊긴다.
   */
  async reacquireIfEnded(kind?: 'audio' | 'video'): Promise<void> {
    const stream = this.localStream
    if (!stream) return
    const watched =
      kind === 'audio'
        ? stream.getAudioTracks()
        : kind === 'video'
          ? stream.getVideoTracks()
          : stream.getTracks()
    const dead = watched.some((t) => t.readyState === 'ended')
    if (!dead) return

    // 살아 있는 트랙까지 함께 정리한다 — 한쪽만 남기면 스트림에 죽은 트랙이 섞여 남는다
    stream.getTracks().forEach((t) => t.stop())
    StreamRegistry.remove(StreamRegistry.LOCAL_ID)
    this.localStream = null
    this.pending = null
    try {
      // 획득 성공 시 acquireOnce 가 micOn/cameraOn 의도를 새 트랙에 다시 입힌다
      await this.ensureStream()
      this.error = null
    } catch (err) {
      if (err instanceof AcquireCancelled) return
      this.error = '카메라를 다시 켜지 못했어요'
    }
    this.emit()
  }

  /**
   * 마이크 on/off 적용. 하드웨어 실패해도 UI 상태(스토어)는 호출측이 유지한다.
   *
   * 스트림은 잡혔는데 오디오 트랙이 없는 경우(카메라만 허용)도 실패로 알린다 —
   * 조용히 넘기면 학생은 마이크가 켜진 줄 알고 계속 말한다.
   */
  async setMicEnabled(on: boolean): Promise<void> {
    this.micOn = on
    try {
      const stream = await this.ensureStream()
      const tracks = stream.getAudioTracks()
      tracks.forEach((t) => (t.enabled = on))
      this.error = tracks.length === 0 ? '마이크를 사용할 수 없어요' : null
    } catch (err) {
      if (err instanceof AcquireCancelled) return // 떠나는 중 — 상태를 되살리지 않는다
      this.error = '마이크를 사용할 수 없어요'
    }
    this.emit()
  }

  /** 카메라 on/off 적용. 마이크만 잡힌 상태면 카메라 실패를 정직하게 알린다. */
  async setCameraEnabled(on: boolean): Promise<void> {
    this.cameraOn = on
    try {
      const stream = await this.ensureStream()
      const tracks = stream.getVideoTracks()
      tracks.forEach((t) => (t.enabled = on))
      this.error = tracks.length === 0 ? '카메라를 사용할 수 없어요' : null
    } catch (err) {
      if (err instanceof AcquireCancelled) return
      this.error = '카메라를 사용할 수 없어요'
    }
    this.emit()
  }

  /**
   * 하드웨어를 실제로 놓아준다(카메라 불 꺼짐). 구독자는 유지되므로 다시 켤 수 있다.
   * 화면을 떠날 때만 호출한다 — 컴포넌트 언마운트마다 부르면 다른 화면의 미리보기가 끊긴다.
   */
  release(): void {
    this.releaseSeq += 1
    this.localStream?.getTracks().forEach((t) => t.stop())
    StreamRegistry.remove(StreamRegistry.LOCAL_ID)
    this.localStream = null
    this.pending = null
    this.micOn = false
    this.cameraOn = false
    this.error = null
    this.emit()
  }

  /** 모든 트랙 정지 및 구독자 정리 */
  dispose(): void {
    this.release()
    this.clearListeners()
  }
}
