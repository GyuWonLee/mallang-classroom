import { Button } from '@/components/common/Button'
import { ModalShell } from '@/components/common/ModalShell'

/**
 * 수업 종료 모달 (선생님) — 종료되면 되돌릴 수 없으므로 닫기 버튼 없이
 * "나가기" 하나만 남겨 다음 행동을 분명히 한다.
 */
export function SessionEndedModal({ open, onExit }: { open: boolean; onExit: () => void }) {
  return (
    <ModalShell open={open} label="수업 종료됨" width={400} hideClose className="text-center">
      <h2 className="text-[1.3rem] font-black">수업이 종료되었습니다</h2>
      <p className="mt-2 text-[.95rem] font-medium text-ink-soft">
        학생은 종료된 수업에 다시 들어올 수 없어요.
      </p>
      <Button variant="primary" size="md" className="mt-5 w-full" onClick={onExit}>
        학급 화면으로
      </Button>
    </ModalShell>
  )
}
