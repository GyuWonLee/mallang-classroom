import { useState } from 'react'
import { ModalShell } from '@/components/common/ModalShell'
import { Button } from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { inviteApi } from '@/services/api/inviteApi'
import { useToastStore } from '@/stores/useToastStore'
import type { StudentAccount } from '@/types/teacher'
import type { PasswordResetResponse } from '@/types/invite'

/**
 * 학생 비밀번호 초기화 — 저학년 분실 대응의 핵심 기능 (백엔드 115).
 *
 * 새 임시 비밀번호는 응답에서 **1회만** 내려온다. 사라지는 토스트를 유일한 전달 수단으로
 * 두면 안 되므로(가이드라인 10장 ④) 모달에 남겨 두고 복사 버튼을 함께 제공한다.
 *
 * 학생의 학습 현황은 학생 관리 화면의 오른쪽 상세 패널에서 본다 — 여기서는 계정만 다룬다.
 */
export function StudentPasswordModal({
  student,
  onClose,
}: {
  student: StudentAccount
  onClose: () => void
}) {
  const showToast = useToastStore((s) => s.show)
  const [reset, setReset] = useState<PasswordResetResponse | null>(null)
  const [resetting, setResetting] = useState(false)

  async function resetPassword() {
    setResetting(true)
    try {
      setReset(await inviteApi.resetStudentPassword(student.userId))
    } catch {
      showToast('비밀번호를 초기화하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      label={`${student.name} 학생 비밀번호 초기화`}
      width={460}
      title={
        <div className="flex items-center gap-3.5">
          <span className="grid h-14 w-14 flex-none place-items-center rounded-2xl bg-sky text-primary">
            <Icon name="key" className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[1.3rem] font-black">비밀번호 초기화</h2>
            <p className="mt-0.5 text-[.88rem] font-medium text-ink-soft">
              {student.name} · 아이디 {student.username}
            </p>
          </div>
        </div>
      }
    >
      {reset ? (
        <div className="mt-6 rounded-[20px] border-2 border-task bg-task-soft p-5 text-center">
          <p className="text-[1rem] font-black text-task-deep">새 임시 비밀번호가 만들어졌어요</p>
          <p className="mt-2 text-[1.05rem] font-black">
            아이디 <span className="text-primary">{reset.username}</span>
            <br />
            비밀번호 <span className="text-primary">{reset.temporaryPassword}</span>
          </p>
          <p className="mt-2 text-[.85rem] font-bold text-task-deep">
            지금만 보여요.
            <br />
            꼭 적어두거나 복사해 주세요.
          </p>
          <Button
            size="sm"
            className="mt-3 w-full"
            onClick={() => {
              void navigator.clipboard?.writeText(`${reset.username} / ${reset.temporaryPassword}`)
              showToast('아이디와 비밀번호를 복사했어요')
            }}
          >
            <Icon name="checklist" className="h-4 w-4" />
            아이디·비밀번호 복사
          </Button>
        </div>
      ) : (
        <>
          <p className="mt-6 rounded-2xl bg-canvas p-4 text-[.95rem] font-semibold leading-[1.7] text-ink-soft">
            초기화하면 지금 쓰던 비밀번호는 <b className="font-black text-ink">바로 쓸 수 없게</b> 돼요.
            <br />
            새 임시 비밀번호를 학생에게 알려 주세요.
          </p>
          <Button
            size="sm"
            className="mt-4 w-full"
            disabled={resetting}
            onClick={() => void resetPassword()}
          >
            <Icon name="key" className="h-4 w-4" />
            {resetting ? '초기화하는 중…' : '비밀번호 초기화하기'}
          </Button>
        </>
      )}
    </ModalShell>
  )
}
