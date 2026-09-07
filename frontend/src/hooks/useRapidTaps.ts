import { useCallback, useRef } from 'react'

/** 연속으로 인정하는 클릭 간격(ms) — 이보다 뜸해지면 처음부터 다시 센다 */
const DEFAULT_GAP_MS = 600

/**
 * **빠르게 N번 연속 클릭**을 감지한다 — 이스터에그 발동점에 쓴다.
 *
 * "빠르게" 가 조건이다: 하루 동안 스무 번 눌러도 열리면 안 되므로, 간격이 `gapMs` 보다
 * 벌어지면 그 클릭을 1번째로 다시 센다.
 *
 * 셈은 `ref` 에 둔다 — 클릭 횟수는 화면에 그려지지 않는 값이라 상태로 두면 누를 때마다
 * 사이드바·헤더가 통째로 다시 렌더된다.
 *
 * @param threshold 발동에 필요한 연속 클릭 수
 * @param onReach   도달했을 때 한 번 불린다 (부른 뒤 셈은 0으로 돌아간다)
 */
export function useRapidTaps(
  threshold: number,
  onReach: () => void,
  gapMs: number = DEFAULT_GAP_MS,
): () => void {
  const taps = useRef(0)
  const lastTap = useRef(0)

  return useCallback(() => {
    const now = Date.now()
    taps.current = now - lastTap.current > gapMs ? 1 : taps.current + 1
    lastTap.current = now
    if (taps.current >= threshold) {
      taps.current = 0
      onReach()
    }
  }, [threshold, onReach, gapMs])
}
