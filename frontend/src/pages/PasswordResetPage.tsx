import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Input } from '@/components/common/Input'
import { Icon } from '@/components/common/Icon'
import { authApi } from '@/services/api/authApi'
import { useToastStore } from '@/stores/useToastStore'
import { apiErrorMessage } from '@/lib/apiError'

/**
 * 비밀번호 재설정 — **선생님 전용**.
 *
 * 한 화면이 두 단계를 겸한다. 주소에 `?token=` 이 있으면 메일 링크를 타고 들어온 것이므로
 * 새 비밀번호를 정하는 단계, 없으면 메일을 요청하는 단계다. 라우트를 둘로 나누면 메일
 * 링크가 가리킬 주소와 로그인 화면이 보낼 주소가 따로 놀아 관리가 어렵다.
 *
 * **학생은 이 길을 쓸 수 없다.** 학생 계정에는 이메일이 없어 보낼 곳이 없다. 대신 선생님이
 * 학생 관리에서 초기화해 주면 되고, 같은 교실에 있으니 그편이 빠르고 대면 확인이라 더
 * 안전하다. 그래서 안내 문구로 그 길을 알려 준다.
 */
export function PasswordResetPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  return token ? <ConfirmStep token={token} /> : <RequestStep />
}

/* ── 공통 껍데기 ─────────────────────────────────────────────── */

const fieldCls = 'px-5 py-[18px] text-base'

const submitCls =
  'w-full rounded-full bg-primary p-[19px] text-[1.05rem] font-black text-white ' +
  'shadow-[0_10px_22px_rgba(98,118,217,.32)] ' +
  'transition-[transform,background-color] duration-[180ms] ease-bounce ' +
  'hover:-translate-y-0.5 hover:bg-primary-hover active:scale-[1.02] disabled:opacity-60'

function Shell({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-6">
      <div className="w-full max-w-[440px] animate-fade-up rounded-[28px] bg-white p-8 shadow-[0_20px_48px_rgba(0,0,0,.10)]">
        <h1 className="text-center text-[1.8rem] font-black">{title}</h1>
        <p className="mb-6 mt-2.5 text-center text-[.95rem] font-semibold leading-[1.6] text-ink-soft">
          {lead}
        </p>
        {children}
        <p className="mt-5 text-center text-[.85rem] font-semibold text-ink-soft">
          <Link to="/login" className="font-black text-primary hover:underline">
            로그인으로 돌아가기
          </Link>
        </p>
      </div>
    </main>
  )
}

/** 학생이 잘못 들어왔을 때 빈손으로 돌려보내지 않는다 */
function StudentHint() {
  return (
    <p className="mt-4 rounded-2xl bg-canvas p-3.5 text-[.85rem] font-semibold leading-[1.6] text-ink-soft">
      학생은 이 화면을 쓸 수 없어요. 담임 선생님께 말씀드리면 새 비밀번호를 만들어 주세요.
    </p>
  )
}

/* ── 1단계: 메일 요청 ────────────────────────────────────────── */

function RequestStep() {
  const showToast = useToastStore((s) => s.show)
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || sending) return
    setSending(true)
    try {
      await authApi.requestPasswordReset(email.trim())
      setSent(true)
    } catch (err) {
      // 429(너무 잦은 요청) 정도만 실제로 올라온다 — 가입 여부는 서버가 알려주지 않는다
      showToast(apiErrorMessage(err, '요청하지 못했어요. 잠시 후 다시 시도해 주세요.'))
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <Shell
        title="메일을 보냈어요"
        lead="받은 편지함을 확인해 주세요. 스팸함에 들어가 있을 수도 있어요."
      >
        <div className="rounded-[20px] border-2 border-task bg-task-soft p-5">
          <p className="text-[.92rem] font-bold leading-[1.7] text-task-deep">
            {/* 서버가 가입 여부를 구분해 응답하지 않으므로 화면도 단정하면 안 된다 */}
            가입된 주소라면 재설정 링크가 담긴 메일이 도착해요.
            <br />
            링크는 30분 동안만 쓸 수 있고, 한 번 쓰면 만료돼요.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell
      title="비밀번호 찾기"
      lead="가입하신 이메일 주소를 알려 주시면 재설정 링크를 보내 드려요."
    >
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="mb-[11px] block text-[.95rem] font-extrabold">이메일 주소</label>
        <Input
          type="email"
          autoComplete="email"
          placeholder="가입하신 이메일을 입력해주세요"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={fieldCls}
        />
        <button type="submit" disabled={sending || !email.trim()} className={`${submitCls} mt-6`}>
          {sending ? '보내는 중…' : '재설정 링크 받기'}
        </button>
      </form>
      <StudentHint />
    </Shell>
  )
}

/* ── 2단계: 새 비밀번호 정하기 ───────────────────────────────── */

function ConfirmStep({ token }: { token: string }) {
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.show)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)

  // 서버 규칙(8~64자)과 같게 맞춘다 — 눌러 보고 나서야 알게 되면 답답하다
  const tooShort = pw.length > 0 && pw.length < 8
  const mismatch = pw2.length > 0 && pw !== pw2
  const canSubmit = pw.length >= 8 && pw === pw2 && !saving

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setSaving(true)
    try {
      await authApi.confirmPasswordReset(token, pw)
      showToast('비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.')
      // 재설정하면 서버가 기존 세션을 모두 끊는다 — 로그인 화면으로 보낸다
      void navigate('/login', { replace: true })
    } catch (err) {
      showToast(apiErrorMessage(err, '비밀번호를 바꾸지 못했어요.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Shell title="새 비밀번호 정하기" lead="앞으로 쓰실 비밀번호를 8자 이상으로 정해 주세요.">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="mb-[11px] block text-[.95rem] font-extrabold">새 비밀번호</label>
        <div className="relative">
          <Input
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="8자 이상"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            invalid={touched && tooShort}
            className={`${fieldCls} pr-11`}
          />
          <button
            type="button"
            aria-label="비밀번호 표시"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-1.5 top-1/2 grid h-[34px] w-[34px] -translate-y-1/2 place-items-center rounded-full text-ink-mute transition-colors hover:bg-sky hover:text-primary"
          >
            <Icon name={showPw ? 'eye' : 'eyeOff'} className="h-[18px] w-[18px]" />
          </button>
        </div>
        {tooShort && <p className="mt-1.5 text-[.76rem] font-bold text-danger">8자 이상으로 정해 주세요.</p>}

        <label className="mb-[11px] mt-[22px] block text-[.95rem] font-extrabold">
          한 번 더 입력
        </label>
        <Input
          type={showPw ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="같은 비밀번호를 다시 입력해주세요"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          invalid={mismatch}
          className={fieldCls}
        />
        {mismatch && <p className="mt-1.5 text-[.76rem] font-bold text-danger">두 값이 서로 달라요.</p>}

        <button type="submit" disabled={!canSubmit} className={`${submitCls} mt-6`}>
          {saving ? '바꾸는 중…' : '비밀번호 바꾸기'}
        </button>
      </form>
    </Shell>
  )
}
