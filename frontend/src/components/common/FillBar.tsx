import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { useFillValue } from '@/hooks/useFillValue'

/**
 * 진행바 하나 — 빈 상태에서 목표 퍼센트까지 차오른다 (ref `.progress-track` / `.progress-fill`).
 *
 * 기본 모습은 ref 의 `.progress-track`(높이 8px, `--track` 회색) + `--primary` 채움이다.
 * 색·높이가 다른 자리는 `className`(트랙) / `fillClassName`·`fillStyle`(채움)로 덮는다 —
 * cn() 이라 뒤에 온 값이 이긴다.
 */
export function FillBar({
  pct,
  className,
  fillClassName,
  fillStyle,
}: {
  /** 0~100 */
  pct: number
  /** 트랙(배경) 클래스 */
  className?: string
  /** 채움 클래스 */
  fillClassName?: string
  /** 채움 인라인 스타일 — 테마색처럼 런타임 값일 때 (width 는 이 컴포넌트가 정한다) */
  fillStyle?: Omit<CSSProperties, 'width'>
}) {
  const width = useFillValue(pct)
  return (
    <span className={cn('block h-2 overflow-hidden rounded-full bg-track', className)}>
      <i
        className={cn(
          'block h-full rounded-full bg-primary transition-[width] duration-700 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none',
          fillClassName,
        )}
        style={{ ...fillStyle, width: `${width}%` }}
      />
    </span>
  )
}
