import { useState } from 'react'
import { Icon } from '@/components/common/Icon'

export interface TileMenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
}

/**
 * 학급 카드 오른쪽 위 "더보기" 메뉴 — 진행 중·닫혀있는 수업 카드가 함께 쓴다.
 *
 * ref 의 진행 중 카드는 겉이 `<button>` 이라 이 메뉴가 없었지만(중첩 button 위반),
 * 우리는 학급 관리·수업 닫기·삭제가 실제로 동작하므로 `<div>` 겉면 안에 살려 둔다.
 * 알약과 같은 줄 오른쪽에 앉는다.
 */
export function ClassTileMenu({ items }: { items: TileMenuItem[] }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="더보기"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-[38px] w-[38px] place-items-center rounded-full text-ink-soft transition-colors hover:bg-white/70"
      >
        <Icon name="more" className="h-4 w-4" />
      </button>
      {open && (
        <>
          {/* 바깥을 누르면 닫힌다 — 카드가 아니라 화면 전체를 덮어야 어디를 눌러도 닫힌다 */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-10 z-50 w-36 overflow-hidden rounded-2xl bg-white py-1 shadow-card-lg">
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                onClick={() => {
                  setOpen(false)
                  it.onSelect()
                }}
                className={`block w-full px-4 py-2.5 text-left text-[.85rem] font-bold hover:bg-canvas ${
                  it.danger ? 'text-danger' : 'text-ink'
                }`}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
