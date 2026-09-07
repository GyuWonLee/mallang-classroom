import type { ConfettiEngine } from './ConfettiEngine'

/**
 * 화면 전역 폭죽은 하나의 캔버스/엔진을 공유한다.
 * ConfettiCanvas 컴포넌트가 엔진을 등록하고, 어디서든 burst/rain을 호출한다.
 */
let engine: ConfettiEngine | null = null

export const confettiController = {
  register(next: ConfettiEngine | null): void {
    engine = next
  },
  burst(count = 100): void {
    engine?.burst(count)
  },
  rain(): void {
    engine?.rain()
  },
}
