import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '@/components/common/Icon'
import { Input } from '@/components/common/Input'
import { inviteApi } from '@/services/api/inviteApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { homePathFor } from '@/hooks/useAuth'
import type { AcceptInviteRequest, AcceptInviteResponse, InvitePreview } from '@/types/invite'
import { SELECTABLE_GRADES } from '@/types/teacher'


/**
 * 초대 수락 — `/invite/:code`. 백엔드에서 **유일하게 비인증 공개**인 엔드포인트다.
 *
 * **미리보기(GET /invites/{code})가 생겼다** (백엔드 S15P11A407-137). 예전에는 조회 API 가
 * 없어 코드만으로 초대 타입도 학급 이름도 알 수 없었고, 만료된 코드인지는 폼을 다 채워
 * 보내야 알았다. 이제 열자마자 **어느 학급인지 · 지금 쓸 수 있는지 · 누구용 초대인지**를
 * 먼저 보여주고, 못 쓰는 코드면 폼 자체를 띄우지 않는다.
 *
 * 못 쓰는 코드도 200 이라 `usable` 로 분기한다 — 404 는 아예 없는 코드뿐이다.
 * 미리보기가 실패해도(네트워크·레이트리밋) 수락 자체는 막지 않는다 — 서버가 어차피 다시
 * 검증하므로, 미리보기 실패를 이유로 사용자를 세워 두면 손해만 본다.
 *
 * 분기는 여전히 **역할** 기준이다. 미리보기의 `type` 은 안내 문구를 정확하게 만드는 데 쓴다:
 *  - 선생님 초대 + 비로그인 → 학생 폼 대신 "로그인하고 다시 열어주세요"
 *  - 학생 초대  + 비로그인 → 학생 가입 폼 → 계정 발급 + 학급 등록
 */
export function InviteAcceptPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  /**
   * 분기는 **역할** 기준이다. `isAuthenticated` 로 가르면 로그인한 학생이 교사 분기로 빠져
   * `403 teacher-login-required` 를 받고 "선생님 계정으로 로그인하세요"라는 막다른 안내를 본다.
   */
  const isTeacher = user?.role === 'TEACHER'
  const isLoggedInStudent = user?.role === 'STUDENT'

  const [name, setName] = useState('')
  /**
   * 학년 — **기본값을 두지 않는다.**
   *
   * 예전엔 `useState(3)` 이라, 학년 칩을 건드리지 않은 아이는 전부 3학년으로 저장됐다.
   * 이 화면은 공개(비로그인)라 학급의 담당 학년을 알 수 없다 — `InvitePreview` 에는
   * `classroomName`·`type`·`usable`·`reason` 만 있고 `grades` 가 없다. 그래서 서버에서
   * 유추할 방법이 없고, 대신 **본인이 반드시 고르게** 한다(자기 학년은 아이가 안다).
   *
   * 서버도 `grade == null` 이면 거절하므로(InviteService.java:125) 고르기 전에는 버튼을 막는다.
   */
  const [grade, setGrade] = useState<number | null>(null)
  const [school, setSchool] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<AcceptInviteResponse | null>(null)

  /**
   * 코드 미리보기. 실패는 조용히 넘긴다 — 이건 **안내를 좋게 하는 정보**이지 수락의
   * 전제 조건이 아니다(레이트리밋 429 로 못 읽었다고 참여를 막으면 안 된다).
   */
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  useEffect(() => {
    if (!code) return
    let cancelled = false
    void inviteApi
      .previewInvite(code)
      .then((p) => {
        if (!cancelled) setPreview(p)
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [code])

  /** 선생님 초대인데 아직 로그인을 안 했다 — 학생 폼을 보여주면 400 으로 끝난다 */
  const teacherInviteNeedsLogin = preview?.type === 'TEACHER' && !user
  const blocked = preview !== null && !preview.usable

  async function accept(asStudent: boolean) {
    // 선생님은 본문 없이 수락한다. 학생은 학년이 없으면 서버가 400 이라 여기서 막는다.
    let body: AcceptInviteRequest = {}
    if (asStudent) {
      if (grade === null) {
        setError('학년을 골라 주세요.')
        return
      }
      body = { name: name.trim(), grade, school: school.trim(), password }
    }
    setBusy(true)
    setError(null)
    try {
      setDone(await inviteApi.acceptInvite(code, body))
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const card = 'w-full max-w-[440px] rounded-[28px] bg-white p-7 shadow-card'

  if (done) {
    return (
      <main className="grid min-h-dvh place-items-center bg-canvas p-5">
        <div className={card}>
          <h1 className="text-[1.35rem] font-black">참여 완료! 🎉</h1>
          <p className="mt-2 text-[.95rem] font-semibold text-ink-soft">
            <b className="font-black text-ink">{done.classroomName}</b> 학급에 들어왔어요.
          </p>
          {done.username && (
            <div className="mt-4 rounded-[20px] border-2 border-task bg-task-soft p-5 text-center">
              <p className="text-[.9rem] font-black text-task-deep">내 아이디예요</p>
              <p className="mt-1.5 text-[1.15rem] font-black text-primary">{done.username}</p>
              <p className="mt-2 text-[.82rem] font-bold text-task-deep">
                방금 정한 비밀번호와 함께 기억해 주세요.
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate(user ? homePathFor(user.role) : '/login', { replace: true })}
            className="mt-5 min-h-11 w-full rounded-full bg-primary p-[13px] text-[.95rem] font-black text-white transition-transform duration-200 ease-bounce hover:-translate-y-0.5"
          >
            {user ? '내 학급으로 가기' : '로그인하러 가기'}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-5">
      <div className={card}>
        <h1 className="flex items-center justify-center gap-2 text-[1.35rem] font-black">
          <Icon name="mail" className="h-6 w-6 text-primary" />
          학급 초대
        </h1>
        {/* 학급 이름을 알면 코드보다 그걸 먼저 말한다 — 사람이 확인하고 싶은 건 "어느 반이냐"다 */}
        {preview ? (
          <p className="mt-2 text-[.95rem] font-semibold text-ink-soft">
            <b className="font-black text-ink">{preview.classroomName}</b> 학급의{' '}
            {preview.type === 'TEACHER' ? '선생님' : '학생'} 초대예요.
          </p>
        ) : (
          <p className="mt-2 text-[.95rem] font-semibold text-ink-soft">
            초대 코드 <b className="font-black tracking-widest text-primary">{code}</b>
          </p>
        )}

        {/* messageOf() 는 문장 사이에 \n 을 넣어 준다 — 문장 단위로 줄을 나눠 읽기 쉽게 한다 */}
        {error && (
          <p className="mt-4 whitespace-pre-line rounded-2xl bg-danger-soft p-3.5 text-[.9rem] font-bold text-danger">
            {error}
          </p>
        )}

        {blocked ? (
          /*
            못 쓰는 코드 — 폼을 아예 띄우지 않는다. 예전에는 학생이 이름·학교·학년·비밀번호를
            다 채워 보낸 **뒤에야** 410 을 받았다.
          */
          <div className="mt-5 rounded-2xl bg-danger-soft p-4">
            <p className="text-[.95rem] font-black text-danger">{blockedMessage(preview.reason)}</p>
            <p className="mt-1.5 text-[.9rem] font-semibold text-ink-soft">
              선생님께 새 초대 링크를 받아주세요.
            </p>
          </div>
        ) : teacherInviteNeedsLogin ? (
          /* 선생님 초대인데 비로그인 — 학생 폼을 보여주면 400 으로 끝난다 */
          <div className="mt-5 rounded-2xl bg-canvas p-4">
            <p className="text-[.95rem] font-bold text-ink-soft">
              이 링크는 <b className="font-black text-ink">선생님용 초대</b>예요.
            </p>
            <p className="mt-1.5 text-[.9rem] font-medium text-ink-soft">
              선생님 계정으로 로그인한 뒤 이 링크를 다시 열어주세요.
            </p>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="mt-3 min-h-11 w-full rounded-full bg-primary p-[12px] text-[.9rem] font-black text-white transition-transform duration-200 ease-bounce hover:-translate-y-0.5"
            >
              로그인하러 가기
            </button>
          </div>
        ) : isTeacher ? (
          <>
            <p className="mt-5 text-[.95rem] font-medium text-ink-soft">
              <b className="font-black text-ink">{user?.name}</b> 선생님으로 이 학급의 공동 관리자가 됩니다.
            </p>
            <button
              type="button"
              onClick={() => void accept(false)}
              disabled={busy}
              className="mt-5 min-h-11 w-full rounded-full bg-primary p-[13px] text-[.95rem] font-black text-white transition-transform duration-200 ease-bounce hover:-translate-y-0.5 disabled:opacity-50"
            >
              {busy ? '참여하는 중…' : '학급에 참여하기'}
            </button>
          </>
        ) : isLoggedInStudent ? (
          /**
           * 서버의 학생 수락은 항상 **새 계정을 발급**한다(`acceptAsStudent` → `studentAccountIssuer.enroll`).
           * 이미 계정이 있는 학생을 다른 학급에 넣는 경로가 백엔드에 없으므로, 되지 않는 버튼을
           * 보여주지 않고 한계를 그대로 알린다.
           */
          <div className="mt-5 rounded-2xl bg-canvas p-4">
            <p className="text-[.95rem] font-bold text-ink-soft">
              <b className="font-black text-ink">{user?.name}</b> 학생은 이미 계정이 있어요.
            </p>
            <p className="mt-1.5 text-[.9rem] font-medium text-ink-soft">
              이 초대 링크는 <b className="font-black text-ink">새 계정을 만들 때</b> 쓰는 링크예요.
              <br />
              다른 학급에도 들어가려면 선생님께 계정을 학급에 추가해 달라고 말씀해 주세요.
            </p>
            <button
              type="button"
              onClick={() => navigate(homePathFor(user.role), { replace: true })}
              className="mt-3 min-h-11 w-full rounded-full bg-primary p-[12px] text-[.9rem] font-black text-white transition-transform duration-200 ease-bounce hover:-translate-y-0.5"
            >
              내 교실로 돌아가기
            </button>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-4">
            <p className="text-[.95rem] font-medium text-ink-soft">
              정보를 입력하면 아이디를 만들어 드려요.
            </p>
            <label className="block">
              <span className="mb-2 block text-[.95rem] font-black">이름</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 김말랑"
                className="px-4 py-3 text-[.95rem] focus:bg-white"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[.95rem] font-black">학교</span>
              <Input
                value={school}
                onChange={(e) => setSchool(e.target.value)}
                placeholder="예: 말랑초등학교"
                className="px-4 py-3 text-[.95rem] focus:bg-white"
              />
            </label>
            <div>
              <span className="mb-2 block text-[.95rem] font-black">학년</span>
              <div className="flex flex-wrap gap-2">
                {SELECTABLE_GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGrade(g)}
                    data-active={grade === g}
                    className="min-h-11 rounded-full bg-canvas p-[11px_18px] text-[.95rem] font-extrabold text-ink-soft transition-transform duration-200 ease-bounce hover:-translate-y-0.5 data-[active=true]:bg-primary data-[active=true]:text-white"
                  >
                    {g}학년
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-2 block text-[.95rem] font-black">비밀번호</span>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="4자 이상"
                className="px-4 py-3 text-[.95rem] focus:bg-white"
              />
            </label>
            <button
              type="button"
              onClick={() => void accept(true)}
              disabled={busy || !name.trim() || !school.trim() || grade === null || password.length < 4}
              className="min-h-11 w-full rounded-full bg-primary p-[13px] text-[.95rem] font-black text-white transition-transform duration-200 ease-bounce hover:-translate-y-0.5 disabled:opacity-50"
            >
              {busy ? '참여하는 중…' : '학급에 참여하기'}
            </button>
            <p className="text-center text-[.85rem] font-semibold text-ink-soft">
              선생님이신가요?{' '}
              <button type="button" onClick={() => navigate('/login')} className="font-black text-primary underline">
                로그인 후 다시 열어주세요
              </button>
            </p>
          </div>
        )}
      </div>
    </main>
  )
}

/** 미리보기가 알려준 "왜 못 쓰는지"를 사람 말로 (서버 reason 은 대문자 코드다) */
function blockedMessage(reason: InvitePreview['reason']): string {
  switch (reason) {
    case 'EXPIRED':
      return '이 초대 링크는 기한이 지났어요.'
    case 'USED_UP':
      return '이 초대 링크는 정원이 다 찼어요.'
    case 'REVOKED':
      return '이 초대 링크는 선생님이 회수했어요.'
    default:
      return '지금은 이 초대 링크를 쓸 수 없어요.'
  }
}

/** RFC 9457 Problem Details 의 `type` 으로 분기 — 서버 detail 보다 친절한 문장을 쓴다 */
function messageOf(e: unknown): string {
  const problem = (e as { response?: { data?: { type?: string; detail?: string } } })?.response?.data
  const slug = problem?.type?.split('/').pop()
  switch (slug) {
    /*
      로그인 화면에서 코드를 손으로 적을 수 있게 되면서(AuthPage) 오타가 가장 흔한 실패가 됐다.
      서버 detail 은 "초대 코드를 찾을 수 없습니다." 라 앱의 말투(-해요)와 어긋나고,
      무엇을 해야 하는지도 말해주지 않는다.
    */
    case 'invite-not-found':
      return '이런 초대 코드가 없어요.\n코드를 다시 확인하고 선생님께 물어봐 주세요.'
    case 'invite-expired':
      return '이 초대 코드는 만료되었거나 사용 횟수를 다 썼어요.\n선생님께 새 코드를 받아주세요.'
    case 'teacher-login-required':
      return '선생님 초대예요.\n먼저 선생님 계정으로 로그인한 뒤 이 링크를 다시 열어주세요.'
    case 'student-info-required':
      return '학생 초대예요.\n이름·학교·학년·비밀번호를 모두 입력해 주세요.'
    case 'duplicate-username':
      return '이미 이 학급에 참여하고 있어요.'
    default:
      return problem?.detail ?? '참여하지 못했어요.\n코드를 다시 확인해 주세요.'
  }
}
