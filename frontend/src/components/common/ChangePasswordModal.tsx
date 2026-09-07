import { useState, type FormEvent } from 'react'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { ModalShell, MODAL_SUB } from '@/components/common/ModalShell'
import { authApi } from '@/services/api/authApi'
import { clearTokens } from '@/services/api/client'
import { useToastStore } from '@/stores/useToastStore'
import { apiErrorMessage } from '@/lib/apiError'

/** 백엔드 규칙과 같은 값 — 선생님 회원가입과 통일돼 있다(AuthDtos @Size(min=8)) */
const MIN_LENGTH = 8

/**
 * 비밀번호 변경 모달 — POST /auth/password (백엔드 S15P11A407-131). **학생·선생님 공용**이다.
 *
 * 학생 계정은 선생님이 발급한 임시 비밀번호로 시작하므로, 본인이 바꿀 수단이 반드시 있어야 한다.
 *
 * 성공하면 서버가 refresh 토큰을 지운다 — "임시 비밀번호가 적힌 안내장이 돌아다니는 상황"을
 * 가정한 설계라서 남의 기기에 남은 세션까지 끊는다. 그래서 프론트도 토큰을 지우고
 * **로그인 화면으로 보낸다.** 여기서 조용히 있으면 다음 요청이 401 로 튕겨 사용자는
 * 이유 없이 로그아웃된 것처럼 느낀다.
 */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const showToast = useToastStore((s) => s.show)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string>()

  const tooShort = next.length > 0 && next.length < MIN_LENGTH
  const mismatch = confirm.length > 0 && next !== confirm
  const canSubmit =
    current.length > 0 && next.length >= MIN_LENGTH && next === confirm && !saving

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setSaving(true)
    setServerError(undefined)
    try {
      await authApi.changePassword(current, next)
      // 서버가 세션을 끊었으므로 로컬 토큰도 함께 버린다 (반쯤 로그인된 상태를 만들지 않는다)
      clearTokens()
      showToast('비밀번호를 바꿨어요. 새 비밀번호로 다시 로그인해 주세요.')
      onClose()
      // 라우터 대신 전체 이동 — 스토어에 남은 세션 상태까지 확실히 비운다
      window.location.href = '/login'
    } catch (err) {
      setServerError(apiErrorMessage(err, '비밀번호를 바꾸지 못했어요. 잠시 뒤에 다시 시도해 주세요.'))
      setSaving(false)
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      label="비밀번호 변경"
      width={420}
      title={<h2 className="text-[1.3rem] font-black">비밀번호 바꾸기</h2>}
    >
      <p className={MODAL_SUB}>
        바꾸면 지금 로그인된 모든 기기에서 다시 로그인해야 해요.
      </p>

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <label className="block">
          <span className="mb-2 block text-[.95rem] font-extrabold">지금 비밀번호</span>
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="지금 쓰는 비밀번호"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            invalid={touched && current.length === 0}
            className="p-[14px_16px] text-base"
          />
          {touched && current.length === 0 && (
            <p className="mt-1.5 text-[.76rem] font-bold text-danger">
              지금 쓰는 비밀번호를 입력해 주세요.
            </p>
          )}
        </label>

        <label className="block">
          <span className="mb-2 block text-[.95rem] font-extrabold">새 비밀번호</span>
          <Input
            type="password"
            autoComplete="new-password"
            placeholder={`${MIN_LENGTH}자 이상 입력하세요`}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            invalid={tooShort}
            className="p-[14px_16px] text-base"
          />
          {tooShort && (
            <p className="mt-1.5 text-[.76rem] font-bold text-danger">
              비밀번호는 {MIN_LENGTH}자 이상이어야 해요.
            </p>
          )}
        </label>

        <label className="block">
          <span className="mb-2 block text-[.95rem] font-extrabold">새 비밀번호 확인</span>
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="한 번 더 입력하세요"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            invalid={mismatch}
            className="p-[14px_16px] text-base"
          />
          {mismatch && (
            <p className="mt-1.5 text-[.76rem] font-bold text-danger">
              새 비밀번호가 서로 달라요.
            </p>
          )}
        </label>

        {/* 서버 사유(지금 비밀번호 틀림·같은 비밀번호)는 필드가 아니라 여기 한 곳에 */}
        {serverError && (
          <p className="rounded-2xl bg-danger-soft p-[12px_14px] text-[.85rem] font-bold text-danger">
            {serverError}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {saving ? '바꾸는 중…' : '비밀번호 바꾸기'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}
