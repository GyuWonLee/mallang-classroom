import { useCallback, useEffect, useState } from 'react'
import { ModalShell, MODAL_SUB } from '@/components/common/ModalShell'
import { Button } from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { inviteApi } from '@/services/api/inviteApi'
import { useToastStore } from '@/stores/useToastStore'
import { confirmAction } from '@/stores/useConfirmStore'
import { inviteLink } from '@/lib/invite'
import type { Invite } from '@/types/invite'

/**
 * 선생님 초대 — 레퍼런스 teacher.html `inviteModal` 이관.
 *
 * ref 는 이메일을 적어 초대장을 보내는 형태지만, **백엔드는 이메일 발송이 없고 초대 "코드"만
 * 발급한다**(`inviteApi.createInvite` → code/expiresAt/maxUses). 그래서 겉모습(초대 목록 ·
 * 아바타 · 상태 칩 · 원형 취소 버튼 · 전체 폭 주 버튼)만 ref 를 따르고, 입력은 코드 발급으로 둔다.
 * 코드만 주면 받는 사람이 어디에 넣을지 몰라서 **링크를 기본 복사 대상**으로 한다.
 * **코드를 쓰는 초대는 이제 여기뿐이다** — "학생 초대" 모달의 코드 상자는 쓰지 않기로 해서
 * 지웠고, 학생은 선생님이 계정을 직접 발급해서 등록한다.
 */
export function InviteTeacherModal({
  classroomId,
  onClose,
}: {
  classroomId: string
  onClose: () => void
}) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [busy, setBusy] = useState(false)
  const showToast = useToastStore((s) => s.show)

  const load = useCallback(() => {
    void inviteApi
      .listInvites(classroomId)
      .then(setInvites)
      .catch(() => setInvites([]))
  }, [classroomId])
  useEffect(load, [load])

  async function create() {
    setBusy(true)
    try {
      await inviteApi.createInvite(classroomId, { type: 'TEACHER' })
      load()
      showToast('공동 선생님 초대를 만들었어요')
    } catch {
      showToast('초대 코드를 만들지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const visible = invites.filter((iv) => iv.type === 'TEACHER')

  return (
    <ModalShell
      open
      onClose={onClose}
      label="선생님 초대"
      title={<h2 className="text-[1.3rem] font-black">선생님 초대</h2>}
    >
      <p className={MODAL_SUB}>
        초대된 선생님은 이 학급을 <b className="text-primary">함께 관리하는 선생님</b>이 돼요.
      </p>

      <Button className="w-full" disabled={busy} onClick={() => void create()}>
        <Icon name="plus" className="h-[17px] w-[17px]" />
        {busy ? '만드는 중…' : '초대 링크 만들기'}
      </Button>

      {/* ref .invite-list — 210px 을 넘으면 목록만 스크롤한다 */}
      <div className="mt-[18px] flex max-h-[210px] flex-col gap-2.5 overflow-y-auto">
        {visible.length === 0 && (
          <p className="text-[.86rem] font-medium text-ink-mute">아직 유효한 초대가 없어요.</p>
        )}
        {visible.map((iv) => {
          const used = iv.usedCount > 0
          return (
            <div key={iv.id} className="flex items-center gap-3 rounded-2xl bg-canvas p-[11px_14px]">
              <span
                /* ref .invite-item .avatar-lg — 36px / .85rem / 900 */
                className="grid h-9 w-9 flex-none place-items-center rounded-full bg-sky text-[.85rem] font-black uppercase text-primary"
                aria-hidden="true"
              >
                {iv.code.slice(0, 2)}
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(inviteLink(iv.code))
                  showToast('초대 링크를 복사했어요')
                }}
                className="min-w-0 flex-1 text-left"
                aria-label={`${iv.code} 초대 링크 복사`}
              >
                <span className="block truncate font-mono text-[.86rem] font-bold tracking-widest text-ink">
                  {iv.code}
                </span>
                <span className="mt-0.5 block truncate text-[.74rem] font-semibold text-ink-mute">
                  {iv.usedCount}/{iv.maxUses}회 사용 · 눌러서 링크 복사
                </span>
              </button>
              <span
                data-used={used}
                className="flex-none whitespace-nowrap rounded-full px-[11px] py-1 text-[.72rem] font-black data-[used=false]:bg-task-soft data-[used=false]:text-task-deep data-[used=true]:bg-success data-[used=true]:text-success-deep"
              >
                {used ? '수락됨' : '대기중'}
              </span>
              <button
                type="button"
                aria-label="초대 취소"
                onClick={async () => {
                  const ok = await confirmAction({
                    title: '이 초대를 지금 만료시킬까요?',
                    message: '이미 보낸 링크와 코드는 더 이상 쓸 수 없게 돼요.',
                    confirmLabel: '초대 만료',
                    danger: true,
                  })
                  if (!ok) return
                  void inviteApi
                    .revokeInvite(iv.id)
                    .then(load)
                    .catch(() => showToast('만료시키지 못했어요.'))
                }}
                className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full text-ink-mute transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <Icon name="close" className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>
    </ModalShell>
  )
}
