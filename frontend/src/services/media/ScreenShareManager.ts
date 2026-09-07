import { Emitter } from '@/services/core/Emitter'

/** ScreenShareManager가 외부로 알리는 원시 상태 */
export interface ScreenShareState {
  sharing: boolean
  error: string | null
}

/**
 * ScreenShareManager — 화면 공유(getDisplayMedia) 획득·중지만 책임진다. (SRP)
 *
 * MediaDeviceManager(카메라/마이크)와 별개의 디스플레이 스트림을 다룬다.
 * 네이티브 MediaStream은 여기(private)에만 두고 스토어에는 넣지 않는다(Rule 2).
 * 구독/방출은 Emitter 베이스가 담당 — 상태 변화는 리스너로만 알린다.
 */
export class ScreenShareManager extends Emitter<ScreenShareState> {
  private stream: MediaStream | null = null
  private sharing = false
  private error: string | null = null

  getState(): ScreenShareState {
    return { sharing: this.sharing, error: this.error }
  }

  getStream(): MediaStream | null {
    return this.stream
  }

  /** 화면 공유 시작. 사용자가 취소하면 조용히 무시한다. */
  async start(): Promise<void> {
    if (this.sharing) return
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.error = '이 브라우저에서는 화면 공유를 사용할 수 없어요'
      this.emit()
      return
    }
    try {
      /*
        해상도를 명시한다. `video: true` 면 브라우저가 화면을 줄여 캡처하는 경우가 있어
        교과서 글씨가 흐려졌다 — 화면 공유는 판서 배경이라 **글자가 읽혀야** 쓸모가 있다.
        프레임은 낮게(15) 둔다: 정지 화면에 가까우므로 같은 대역폭을 해상도에 쓰는 게 이득이다.
      */
      /*
        소리도 함께 달라고 한다. 예전엔 `audio: false` 여서 **화면 속 영상·노래가 학생에게
        전혀 들리지 않았다** — 선생님은 자기 스피커로 듣고 있으니 나가는 줄 알았다.

        `audio: true` 는 브라우저 공유 창에 "탭 오디오 공유" 선택칸을 띄운다. 선생님이 그걸
        끄거나(또는 Firefox·Safari 처럼 지원하지 않으면) 오디오 트랙 없이 스트림이 온다 —
        **그때도 화면 공유는 그대로 되어야 한다.** 그래서 실패로 다루지 않고, 게시하는 쪽
        (ClassroomSignaling.publishScreen)이 트랙이 있을 때만 소리를 올린다.
      */
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15 } },
        audio: true,
      })
      this.stream = stream
      this.sharing = true
      this.error = null
      // 브라우저 기본 UI("공유 중지")로 멈추는 경우도 반영
      stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stop())
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotAllowedError')) {
        this.error = '화면 공유를 시작하지 못했어요'
      }
    }
    this.emit()
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.sharing = false
    this.emit()
  }

  dispose(): void {
    this.stop()
    this.clearListeners()
  }
}
