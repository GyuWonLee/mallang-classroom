import { useEffect } from 'react'
import { Icon, type IconName } from '@/components/common/Icon'
import { useNoticeStore, type NoticeKind } from '@/stores/useNoticeStore'

/**
 * 알림 스택 — 방송 카드 **안쪽** 우상단에 카톡 알림처럼 쌓인다.
 *
 * **카드 안에 있어야 하는 이유:** 전체화면은 `VideoCard` 의 카드 div 를 대상으로 걸리고,
 * 브라우저는 그 요소와 하위 트리만 top layer 에 그린다. RootLayout 의 토스트는 그 바깥이라
 * 전체화면 중에 아예 보이지 않는다 (z-index 로는 해결되지 않는다).
 *
 * 위치: 우상단이지만 **'전체 화면' 버튼(right-18/top-18, z-35)을 피해 아래로 내렸다.**
 * z-[42] 는 컨트롤 바(z-40) 위 · 쉬는시간 덮개(z-45) 아래 — 쉬는 시간에는 화면을 덮는 것이
 * 목적이므로 알림이 그 위로 올라오지 않게 한다.
 */

/** 알림 지속 시간 — 아이가 읽을 수 있게 토스트(2.6초)보다 길게 둔다 */
const NOTICE_MS = 5000

const STYLE: Record<NoticeKind, { icon: IconName; accent: string }> = {
  notice: { icon: 'bell', accent: 'bg-task text-task-deep' },
  message: { icon: 'chat', accent: 'bg-sky text-primary' },
  assignment: { icon: 'checklist', accent: 'bg-success text-success-deep' },
}

function NoticeCard({ id, kind, title, body }: { id: string; kind: NoticeKind; title: string; body: string }) {
  const dismiss = useNoticeStore((s) => s.dismiss)
  const style = STYLE[kind]

  // 스스로 사라진다. 누르면 바로 닫을 수도 있게 둔다 (아이가 가린 화면을 치울 수 있어야 한다)
  useEffect(() => {
    const timer = setTimeout(() => dismiss(id), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [id, dismiss])

  return (
    <button
      type="button"
      onClick={() => dismiss(id)}
      aria-label={`${title} 알림 닫기`}
      className="pointer-events-auto flex w-full animate-fade-up items-start gap-3 rounded-card-md bg-card p-[12px_14px] text-left shadow-card-lg transition-transform duration-200 ease-bounce hover:-translate-y-0.5"
    >
      <span className={`grid h-9 w-9 flex-none place-items-center rounded-full ${style.accent}`}>
        <Icon name={style.icon} className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[.88rem] font-black text-ink">{title}</span>
        {/* 긴 쪽지는 두 줄까지만 — 알림이 화면을 덮으면 방송을 가린다 */}
        <span className="mt-0.5 line-clamp-2 block break-keep text-[.8rem] font-semibold leading-[1.45] text-ink-soft">
          {body}
        </span>
      </span>
    </button>
  )
}

export function NoticeStack() {
  const items = useNoticeStore((s) => s.items)
  if (items.length === 0) return null

  return (
    // pointer-events-none: 알림이 없는 빈 영역이 영상 클릭·판서를 가로채지 않게 한다
    <div className="pointer-events-none absolute right-[18px] top-[70px] z-[42] flex w-[min(300px,72%)] flex-col gap-2">
      {items.map((n) => (
        <NoticeCard key={n.id} {...n} />
      ))}
    </div>
  )
}
