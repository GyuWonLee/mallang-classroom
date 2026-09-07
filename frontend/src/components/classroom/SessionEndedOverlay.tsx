import { useState, useEffect } from 'react'
import { Icon } from '@/components/common/Icon'
import { Button } from '@/components/common/Button'
import { ModalShell } from '@/components/common/ModalShell'
import { useSignalStore } from '@/stores/useSignalStore'

/**
 * 수업 종료 오버레이 (학생) — 선생님이 수업을 종료하면 표시된다.
 * "진행 중인 수업이 없습니다" 안내 후, 학생은 과제는 계속 풀 수 있으므로 닫고 넘어갈 수 있다.
 * (실서버에서는 종료된 수업 재접근 시 403 → 이 화면으로 유도)
 */
export function SessionEndedOverlay() {
  const sessionEnded = useSignalStore((s) => s.sessionEnded)
  const [dismissed, setDismissed] = useState(false)

  // 새 수업이 시작되면 다시 볼 수 있게 초기화
  useEffect(() => {
    if (!sessionEnded) setDismissed(false)
  }, [sessionEnded])

  if (!sessionEnded || dismissed) return null

  return (
    <ModalShell open label="수업 종료 안내" width={400} hideClose className="text-center">
      {/* ref 는 이모지를 쓰지 않는다 — 수업 시간이 끝났다는 뜻의 시계 심볼로 대체 */}
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-sky">
        <Icon name="clock" className="h-8 w-8 text-primary" />
      </span>
      <h2 className="mt-3 text-[1.3rem] font-black">진행 중인 수업이 없어요</h2>
      <p className="mt-2 text-[.95rem] font-medium text-ink-soft">
        오늘 수업은 끝났어요.
        <br />
        남은 과제는 이어서 풀 수 있어요!
      </p>
      <Button variant="primary" size="md" className="mt-5 w-full" onClick={() => setDismissed(true)}>
        과제 풀러 가기
      </Button>
    </ModalShell>
  )
}
