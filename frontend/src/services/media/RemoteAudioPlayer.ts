import type { RemoteTrack } from 'livekit-client'
import { useAudioStore } from '@/stores/useAudioStore'

/**
 * RemoteAudioPlayer — 원격 오디오 트랙을 실제로 "들리게" 만드는 곳. (SRP, no React)
 *
 * **livekit-client 는 원격 오디오를 알아서 재생하지 않는다.** 구독(`TrackSubscribed`)만으로는
 * 소리가 나지 않고, 앱이 `track.attach()` 로 만든 `<audio>` 를 **DOM 에 넣어야** 재생된다.
 * 비디오는 화면에 붙일 `<video>` 가 있지만 오디오는 붙일 곳이 없으므로, 화면 밖 컨테이너를
 * 하나 만들어 거기에 모아 둔다.
 *
 * 자동 재생 차단: 사용자가 페이지를 한 번도 건드리지 않았으면 브라우저가 재생을 막는다.
 * LiveKit 은 `RoomEvent.AudioPlaybackStatusChanged` + `room.canPlaybackAudio` 로 이 상태를
 * 알려주고, 해제는 **사용자 제스처 안에서 `room.startAudio()`** 를 부르는 방법뿐이다.
 * 그래서 룸마다 "다시 재생" 함수를 등록해 둔다(`registerRoom`).
 *
 * **누를 버튼은 두지 않는다.** 예전에는 막히면 화면 아래에 "눌러서 선생님 목소리 듣기"
 * 배너를 띄웠는데, 학생 화면에 뜬금없는 커다란 버튼이 하나 더 생기는 꼴이었다. 해제에
 * 필요한 것은 **아무 제스처**이지 그 버튼이 아니므로, 막히는 순간 문서 전체에 한 번만
 * 귀를 달아 두고 학생이 무엇이든 처음 누를 때 조용히 푼다(`armGestureUnlock`).
 * `useAudioStore.blocked` 는 여전히 세운다 — 지금 소리가 막혀 있는지는 상태로 남겨야 한다.
 */
class RemoteAudioPlayer {
  private container: HTMLElement | null = null
  /** 트랙 -> 이 트랙 때문에 DOM 에 넣은 엘리먼트들 */
  private elements = new Map<RemoteTrack, HTMLMediaElement[]>()
  /** 룸(키) -> 사용자 제스처에서 부를 재생 재개 함수 */
  private resumers = new Map<object, () => Promise<void>>()
  /** 지금 자동 재생이 막혀 있는 룸 */
  private blocked = new Set<object>()

  /** 화면 밖 오디오 보관함 — 보이지 않지만 DOM 에 있어야 소리가 난다 */
  private ensureContainer(): HTMLElement | null {
    if (typeof document === 'undefined') return null
    if (this.container?.isConnected) return this.container
    const el = document.createElement('div')
    el.setAttribute('data-remote-audio', '')
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none'
    document.body.appendChild(el)
    this.container = el
    return el
  }

  /** 구독한 오디오 트랙을 재생 대상으로 붙인다 (같은 트랙을 두 번 붙이지 않는다) */
  attach(track: RemoteTrack): void {
    if (this.elements.has(track)) return
    const container = this.ensureContainer()
    if (!container) return
    const el = track.attach()
    el.autoplay = true
    // 화면 밖이라 컨트롤은 필요 없다. iOS 는 playsinline 이 없으면 전체화면 플레이어를 띄운다.
    el.setAttribute('playsinline', '')
    container.appendChild(el)
    this.elements.set(track, [el])
    // 여기서 막히면 AudioPlaybackStatusChanged 가 알려준다 — 조용히 삼키지 말고 상태로 드러낸다
    void el.play?.().catch(() => undefined)
  }

  /** 트랙이 사라졌을 때 — DOM 에서도 확실히 걷어낸다(안 그러면 유령 오디오가 남는다) */
  detach(track: RemoteTrack): void {
    const mine = this.elements.get(track) ?? []
    this.elements.delete(track)
    const detached = track.detach()
    const all = new Set<HTMLMediaElement>([
      ...mine,
      ...(Array.isArray(detached) ? detached : [detached]),
    ])
    all.forEach((el) => {
      el.srcObject = null
      el.remove()
    })
  }

  /** 룸 등록 — `resume` 은 그 룸의 `startAudio()` 다 */
  registerRoom(key: object, resume: () => Promise<void>): void {
    this.resumers.set(key, resume)
  }

  unregisterRoom(key: object): void {
    this.resumers.delete(key)
    this.blocked.delete(key)
    this.sync()
  }

  /** 이 룸의 오디오가 막혔는지 갱신 (`!room.canPlaybackAudio`) */
  setBlocked(key: object, blocked: boolean): void {
    if (blocked) {
      this.blocked.add(key)
      this.armGestureUnlock()
    } else {
      this.blocked.delete(key)
    }
    this.sync()
  }

  /**
   * 처음 막힌 순간, 문서 전체에 제스처 귀를 단다 — 학생이 무엇을 누르든 그 안에서 소리를 푼다.
   *
   * 브라우저가 요구하는 것은 "사용자 제스처 안에서의 재생 시도"이지 특정 버튼이 아니다.
   * 그래서 전용 버튼 없이도 첫 클릭·첫 키 입력·첫 터치에 자연스럽게 풀린다.
   *
   * 리스너는 **떼지 않는다.** 나중에 들어온 룸이 다시 막힐 수 있고(팀룸 이동 등), 그때 또
   * 달 방법이 없다. `isBlocked` 가 아니면 아무 일도 하지 않으므로 남겨 둬도 비용이 없다.
   * capture 단계로 잡아 도중에 `stopPropagation` 하는 UI 가 있어도 놓치지 않는다.
   */
  private gestureArmed = false
  private armGestureUnlock(): void {
    if (this.gestureArmed || typeof document === 'undefined') return
    this.gestureArmed = true
    const onGesture = () => {
      if (this.isBlocked) void this.resume()
    }
    for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
      document.addEventListener(type, onGesture, { capture: true, passive: true })
    }
  }

  get isBlocked(): boolean {
    return this.blocked.size > 0
  }

  /**
   * **사용자 제스처 안에서** 호출한다 (`armGestureUnlock` 이 첫 제스처에 부른다).
   * 모든 룸의 재생을 시작하고, DOM 에 남아 있는 오디오도 다시 play 한다.
   *
   * 실패하면 `blocked` 를 그대로 둔다 — 다음 제스처에 다시 시도된다.
   */
  async resume(): Promise<boolean> {
    const results = await Promise.allSettled([...this.resumers.values()].map((fn) => fn()))
    await Promise.allSettled(
      [...this.elements.values()].flat().map((el) => el.play?.() ?? Promise.resolve()),
    )
    const ok = results.every((r) => r.status === 'fulfilled')
    if (ok) {
      this.blocked.clear()
      this.sync()
    }
    return ok
  }

  private sync(): void {
    useAudioStore.getState().setBlocked(this.blocked.size > 0)
  }
}

/** 앱 전체가 공유하는 단일 재생기 — 학급 룸·팀 룸의 오디오가 한 곳에 모인다 */
export const remoteAudio = new RemoteAudioPlayer()
