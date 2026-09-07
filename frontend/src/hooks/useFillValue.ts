import { useEffect, useState } from 'react'

/**
 * 0(또는 `from`) 에서 목표값까지 **차오르는** 값 (ref `animateFills`).
 *
 * 진행바·도넛·링은 처음 그려질 때 목표값으로 툭 나타나는 대신 빈 상태에서 차올라야 한다.
 * 그러려면 "빈 상태로 한 번 그려진 뒤" 값이 바뀌어야 CSS transition 이 그 사이를 잇는다 —
 * 같은 프레임에 값을 두 번 바꾸면 전환 없이 마지막 값으로 즉시 그려진다. 그래서 한 프레임을
 * **두 번** 건너뛴다(브라우저마다 한 번으론 전환이 씹히는 경우가 있어 ref 도 두 번 건다).
 *
 * 목표값이 나중에 바뀌면(예: 데이터가 도착) 다시 빈 상태에서 새 값까지 차오른다 — ref 가
 * 렌더할 때마다 `animateFills` 를 다시 부르는 것과 같은 동작이다.
 *
 * `prefers-reduced-motion: reduce` 사용자에게는 애니메이션 없이 목표값을 바로 준다
 * (디자인 가이드라인 5장 — 새 애니메이션은 이 규칙에 걸려야 한다).
 */
export function useFillValue(target: number, from = 0) {
  const [value, setValue] = useState(from)

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      setValue(target)
      return
    }

    setValue(from)
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setValue(target))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [target, from])

  return value
}
