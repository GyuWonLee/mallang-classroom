import { useEffect, useState } from 'react'

/**
 * 이 `<video>` 에 **지금 그림이 오고 있는지** — 브라우저가 아는 사실만 본다.
 *
 * 왜 필요한가: 선생님이 카메라를 끄는 방식은 트랙을 내리는 게 아니라 mute 다. 그러면
 * 붙어 있던 <video> 는 마지막 프레임에서 멈춘 채 남고, "트랙이 붙어 있다"만 보는 화면은
 * 방송 중이라고 믿는다. 반대로 우리 쪽 mute 장부가 틀리면 그림이 오는데도 가려 버린다.
 * 그래서 판단 근거를 라이브러리 이벤트가 아니라 **엘리먼트와 네이티브 트랙**으로 옮긴다.
 *
 * 두 가지를 함께 본다.
 *  - `videoWidth > 0` — 첫 프레임이 와서 해상도가 정해졌는지 (오기 전엔 0)
 *  - `MediaStreamTrack.muted` — 프레임이 흐르지 않으면 브라우저가 켜 주는 깃발.
 *    원격 트랙의 mute 가 여기 그대로 나타나고 `mute`/`unmute` 이벤트도 함께 온다.
 */
export function useVideoHasPicture(el: HTMLVideoElement | null): boolean {
  const [hasPicture, setHasPicture] = useState(false)

  useEffect(() => {
    if (!el) {
      setHasPicture(false)
      return
    }

    /** 지금 붙어 있는 비디오 트랙 — srcObject 가 바뀌면 이것도 바뀐다 */
    const videoTrack = () =>
      (el.srcObject as MediaStream | null)?.getVideoTracks?.()[0] ?? null

    let track: MediaStreamTrack | null = null

    const update = () => {
      const t = videoTrack()
      setHasPicture(!!t && t.readyState === 'live' && !t.muted && el.videoWidth > 0)

      // 트랙이 갈렸으면 mute/unmute 구독도 옮겨 붙인다 (카메라 <-> 화면 공유 전환)
      if (t !== track) {
        track?.removeEventListener('mute', update)
        track?.removeEventListener('unmute', update)
        track = t
        track?.addEventListener('mute', update)
        track?.addEventListener('unmute', update)
      }
    }

    /*
      `loadedmetadata` 로 해상도를, `resize` 로 해상도 변경을, `emptied` 로 srcObject 해제를
      잡는다. `playing`·`suspend` 는 재생 상태가 오갈 때의 보정이다.
    */
    const events = ['loadedmetadata', 'resize', 'playing', 'suspend', 'emptied'] as const
    events.forEach((e) => el.addEventListener(e, update))
    update()

    /*
      1초 간격 보정 — 위 이벤트로 대부분 잡히지만, 원격 트랙이 조용히 멈추는 경우(패킷이
      끊겼는데 mute 이벤트가 늦거나 오지 않는 경우)가 남는다. 무대가 빈 화면으로 굳는
      쪽이 훨씬 나쁘므로 값싼 보정을 둔다.
    */
    const timer = setInterval(update, 1000)

    return () => {
      events.forEach((e) => el.removeEventListener(e, update))
      track?.removeEventListener('mute', update)
      track?.removeEventListener('unmute', update)
      clearInterval(timer)
    }
  }, [el])

  return hasPicture
}
