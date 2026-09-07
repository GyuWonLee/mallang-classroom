import { Icon } from '@/components/common/Icon'
import { cn } from '@/lib/cn'

interface PaginatorProps {
  /** 0-based */
  page: number
  pageCount: number
  onChange: (page: number) => void
  /** 스크린리더용 — "무엇의" 페이지인지 (예: "과제 목록") */
  label: string
  className?: string
}

/**
 * 페이지 넘김 — 한 페이지 분량이 정해진 목록에 붙인다.
 *
 * **한 페이지뿐이면 아무것도 그리지 않는다.** 넘길 데가 없는데 화살표가 보이면 눌러도
 * 반응이 없는 버튼이 되고, 목록이 짧을 때마다 카드 아래에 빈 줄이 하나 생긴다.
 *
 * 숫자는 `tabular-nums` 로 고정폭이다 — 1/9 에서 9/9 로 넘어갈 때 글자 폭이 달라지면
 * 양옆 화살표가 미세하게 밀린다.
 */
export function Paginator({ page, pageCount, onChange, label, className }: PaginatorProps) {
  if (pageCount <= 1) return null

  const btn =
    'grid h-8 w-8 flex-none place-items-center rounded-full bg-white text-ink-soft shadow-[0_2px_8px_rgba(0,0,0,.08)] transition-colors enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <nav
      aria-label={`${label} 페이지 넘기기`}
      className={cn('flex flex-none items-center justify-center gap-3 pt-2.5', className)}
    >
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 0}
        aria-label="이전 페이지"
        className={btn}
      >
        <Icon name="back" className="h-3.5 w-3.5" />
      </button>

      {/* 위치를 소리로도 알린다 — 화살표만으로는 몇 번째인지 안 읽힌다 */}
      <span aria-live="polite" className="text-[.8rem] font-black tabular-nums text-ink-soft">
        {page + 1}
        <span className="text-ink-mute"> / {pageCount}</span>
      </span>

      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount - 1}
        aria-label="다음 페이지"
        className={btn}
      >
        <Icon name="chevronRight" className="h-3.5 w-3.5" />
      </button>
    </nav>
  )
}
