/** public/assets 의 정적 파일 — 번들에 들어가지 않고 URL 로 그대로 받는다 */
const SRC = '/assets/CHIME6.mp3'

/**
 * 재생 음량 (0~1). 원본 파일이 커서 절반으로 줄였다.
 *
 * 파일 자체를 편집하지 않고 여기서 줄인다 — 소리를 어느 정도로 낼지는 상황에 따라 바뀌는
 * 값이라 코드에 두는 편이 고치기 쉽고, 원본은 그대로 두어야 나중에 다시 키울 수 있다.
 *
 * 아이들이 헤드폰을 쓰고 있을 수 있어 **알림음은 작은 쪽으로 잡는다** — 놓치면 화면 덮개가
 * 이미 떠 있지만, 놀라게 하면 되돌릴 수 없다.
 */
const VOLUME = 0.5

let el: HTMLAudioElement | null = null

function element(): HTMLAudioElement {
  if (!el) {
    el = new Audio(SRC)
    // 한 번만 울린다 — 쉬는 시간 내내 울리면 알림이 아니라 소음이다
    el.loop = false
    el.preload = 'auto'
    el.volume = VOLUME
  }
  return el
}

/**
 * 쉬는 시간 시작 종소리 (학생).
 *
 * 화면만 덮으면 다른 것을 보고 있던 아이는 쉬는 시간이 시작된 줄 모른다. 소리는 화면을
 * 안 보고 있어도 닿는 유일한 통로다.
 *
 * **한 번만 울린다.** 그리고 울리는 도중에 쉬는 시간이 끝나거나 다시 시작되면 즉시 끊는다 —
 * 끝났는데 종이 계속 울리면 아이는 아직 쉬는 시간인 줄 안다.
 *
 * 소리 하나짜리라 엔진을 두지 않고 `HTMLAudioElement` 를 하나만 재사용한다. 매번 새로 만들면
 * 겹쳐 울리는데(이전 것을 붙잡고 있지 않으니 멈출 수도 없다) 그게 정확히 막아야 할 일이다.
 * React 의존성 없음(CLAUDE.md Rule 1).
 */
export const breakChime = {
  /**
   * 파일을 미리 받아 둔다 — 울려야 하는 순간에 네트워크를 기다리지 않게.
   * 학교망이 흔들리면 종이 몇 초 늦게 울리는데, 그때는 이미 쉬는 시간이 시작된 뒤다.
   */
  prime(): void {
    element().load()
  },

  /**
   * 처음부터 울린다.
   *
   * `currentTime = 0` 이 **다시 시작**을 처리한다: 쉬는 시간을 껐다 바로 켜면 앞서 울리던
   * 소리가 끊기고 처음부터 다시 울린다(두 개가 겹치지 않는다).
   *
   * 자동 재생이 막혀 있으면(사용자가 페이지를 아직 한 번도 안 건드림) 조용히 넘어간다 —
   * 소리는 덮개의 보조 수단이고, 덮개 자체는 소리와 무관하게 떠 있다. 콘솔에 예외를
   * 흘리지 않는 이유도 같다: 우리가 할 수 있는 일이 없다.
   * (원격 오디오는 `RemoteAudioPlayer.armGestureUnlock` 이 첫 제스처에 풀어 준다)
   */
  play(): void {
    const audio = element()
    audio.currentTime = 0
    void audio.play().catch(() => {})
  },

  /** 울리는 중이면 끊는다 (쉬는 시간이 일찍 끝났거나 교실을 떠났을 때) */
  stop(): void {
    if (!el) return
    el.pause()
    el.currentTime = 0
  },
}
