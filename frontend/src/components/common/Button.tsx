import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/**
 * 공용 Button 프리미티브 (변형 기반, 객체지향 UI 조립용).
 * 색은 @theme 토큰만 사용 → 메인 컬러 변경 시 자동 반영.
 * 새 스타일이 필요하면 VARIANTS/SIZES에 항목을 추가한다.
 */
/* ref/teacher.html `.btn-*` (634-642) 와 1:1 대응 */
const VARIANTS = {
  primary: 'bg-primary text-white shadow-[0_10px_22px_rgba(98,118,217,.3)] hover:bg-primary-hover',
  soft: 'bg-sky text-primary hover:bg-sky-deep',
  outline: 'border-2 border-primary bg-white text-primary',
  task: 'bg-task text-task-deep',
  mint: 'border-2 border-mint-deep bg-white text-mint-deep hover:bg-mint-bg',
  // ref .btn-ghost — 흰 카드 + 그림자 (canvas 배경이 아니다)
  ghost: 'bg-card text-ink shadow-card hover:bg-ghost-hover',
  // 위험 액션(삭제/내보내기/종료) — ref .btn-danger. 항상 확인 절차를 거친 뒤에만 실행한다
  danger: 'bg-danger text-white hover:bg-danger-hover',
  // 뒤로가기 pill: 흰 카드 + 좌측으로 미끄러지는 hover (선생님 화면 상단 공통)
  back: 'bg-card text-ink-soft shadow-card hover:-translate-x-1',
} as const

/**
 * ref `.btn` = `.92rem / padding 13px 22px / min-height 44px`, `.btn-sm` = `.82rem / 10px 16px / 38px`.
 * `lg` 는 학생 화면 전용(ref/index.html `.next-btn` `.celebrate-btn`).
 */
const SIZES = {
  sm: 'min-h-[38px] p-[10px_16px] text-[.82rem]',
  md: 'min-h-11 p-[13px_22px] text-[.92rem]',
  lg: 'p-[16px_42px] text-[1.02rem]',
} as const

export type ButtonVariant = keyof typeof VARIANTS
export type ButtonSize = keyof typeof SIZES

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        // ref .btn — 900 weight, gap 8px, hover translateY(-2px) / active scale(1.05), disabled opacity .5
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-black transition-[transform,background-color,filter] duration-[180ms] ease-bounce hover:-translate-y-0.5 active:scale-105 disabled:cursor-default disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 [&_svg]:h-[17px] [&_svg]:w-[17px]',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
