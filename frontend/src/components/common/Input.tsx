import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/**
 * 공용 Input 프리미티브. 라운드 입력창의 공통 골격을 한 곳에 모았다.
 * 색·라운드는 @theme 토큰만 사용. 크기/패딩 등 세부는 className으로 확장한다.
 *
 * invalid=true 이면 data-invalid 를 세팅해 에러 스타일(빨강 테두리/연빨강 배경)로 전환된다.
 * (AuthPage 등 기존 data-[invalid] 패턴을 그대로 프리미티브로 승격)
 */
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export function Input({ invalid, className, ...props }: InputProps) {
  return (
    <input
      data-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-2xl border-2 border-canvas bg-canvas font-semibold text-ink outline-none transition-colors focus:border-primary data-[invalid=true]:border-danger data-[invalid=true]:bg-danger-soft',
        className,
      )}
      {...props}
    />
  )
}
