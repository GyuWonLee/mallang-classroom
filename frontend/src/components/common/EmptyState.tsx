import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from '@/components/common/Icon'

interface EmptyStateProps {
  /** 상황을 알려주는 아이콘. 색만으로 말하지 않기 위해 문장과 함께 둔다 */
  icon?: IconName
  /** 한 줄 요약 — "아직 만든 과제가 없어요" 처럼 상태를 먼저 말한다 */
  title: string
  /** 다음에 무엇을 하면 되는지. 없으면 생략 */
  hint?: string
  /** 버튼 등 바로 실행할 수 있는 것 */
  action?: ReactNode
  className?: string
}

/**
 * 빈 상태 안내 (ref .empty-state) — 목록에 보여줄 것이 없을 때 쓰는 공통 표시.
 *
 * **부모를 가득 채우고 가로·세로 모두 가운데 정렬한다.** 예전엔 화면마다 따로
 * `flex flex-col items-center p-[48px_20px]` 를 적어 뒀는데, 그건 가로 중앙만 맞추고
 * 세로는 맞추지 않아서 높이가 큰 카드(예: 목록의 min-h 602px) 안에서 글자가 **위쪽에
 * 붙어** 보였다. 어떤 곳은 그마저 없어 좌상단에 붙었다.
 * 그래서 `h-full` + `justify-center` 를 이 컴포넌트가 책임진다 — 쓰는 쪽은 정렬을 신경 쓰지 않는다.
 *
 * `min-h` 를 함께 두는 이유: 부모가 높이를 정해주지 않는 경우(내용에 따라 늘어나는 카드)에도
 * 안내가 납작하게 눌리지 않게 최소한의 숨 쉴 공간을 준다.
 */
export function EmptyState({ icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-[200px] flex-col items-center justify-center gap-2.5 p-[40px_20px] text-center',
        className,
      )}
    >
      {icon && <Icon name={icon} className="h-10 w-10 flex-none text-ink-mute" />}
      <p className="text-[.95rem] font-bold text-ink-mute">{title}</p>
      {hint && <p className="max-w-[34ch] text-[.85rem] font-medium text-ink-mute">{hint}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  )
}
