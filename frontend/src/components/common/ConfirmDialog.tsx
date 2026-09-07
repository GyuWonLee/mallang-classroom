import { useEffect } from 'react'
import { ModalShell } from '@/components/common/ModalShell'
import { Button } from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { useConfirmStore } from '@/stores/useConfirmStore'

/**
 * 확인 대화상자 — 앱에 **한 번만** 마운트되고, `confirmAction()` 요청이 오면 뜬다.
 * (`useConfirmStore` 주석 참고)
 *
 * 실수 방지 규칙:
 * - 위험 액션(danger)은 빨강 버튼 + 경고 아이콘, 그리고 **취소가 왼쪽·기본 포커스**다.
 *   실행 버튼에 포커스를 두면 Enter 를 잘못 눌러 지워버릴 수 있다.
 * - ESC·배경 클릭·닫기 버튼은 모두 "취소"로 해석한다 (조용히 실행되는 경로가 없다).
 */
export function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending)
  const answer = useConfirmStore((s) => s.answer)

  // ESC 로 취소 (열릴 때만 듣는다)
  useEffect(() => {
    if (!pending) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') answer(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pending, answer])

  if (!pending) return null
  const danger = !!pending.danger

  return (
    <ModalShell
      open
      onClose={() => answer(false)}
      label={pending.title}
      width={430}
      className="p-[30px_30px_26px]"
    >
      <div className="flex items-start gap-3.5 pr-10">
        <span
          data-danger={danger}
          className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-sky text-primary data-[danger=true]:bg-danger-soft data-[danger=true]:text-danger"
          aria-hidden="true"
        >
          <Icon name={danger ? 'alert' : 'help'} className="h-6 w-6" />
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 className="break-keep text-[1.2rem] font-black leading-[1.45]">{pending.title}</h2>
          {pending.message && (
            /* 줄바꿈을 그대로 살린다 — "무엇이 함께 사라지는지"를 한 줄씩 보여주려고 */
            <p className="mt-2 whitespace-pre-line break-keep text-[.92rem] font-semibold leading-[1.7] text-ink-soft">
              {pending.message}
            </p>
          )}
        </div>
      </div>

      {/* 취소가 먼저 — 되돌릴 수 없는 버튼은 실수 클릭을 피해 오른쪽 끝에 둔다 */}
      <div className="mt-7 flex gap-2.5">
        {/* autoFocus 를 취소에 둔다 — 실행 버튼에 포커스가 가면 Enter 로 실수 실행된다 */}
        <Button variant="ghost" size="sm" autoFocus className="flex-1" onClick={() => answer(false)}>
          {pending.cancelLabel ?? '취소'}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          size="sm"
          className="flex-1"
          onClick={() => answer(true)}
        >
          {pending.confirmLabel}
        </Button>
      </div>
    </ModalShell>
  )
}
