import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { Icon } from '@/components/common/Icon'
import { useToastStore } from '@/stores/useToastStore'
import { apiErrorMessage } from '@/lib/apiError'

type Tab = 'login' | 'signup'

/** 라운드 입력 필드 (라벨 + 에러) — ref .field / .field-error */
function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-[26px]">
      <label className="mb-[11px] block text-[.95rem] font-extrabold">{label}</label>
      {children}
      {error && <p className="mt-1.5 text-[.76rem] font-bold text-danger">{error}</p>}
    </div>
  )
}

/**
 * 제목 아래 두 줄 인사 — 로그인·회원가입 두 패널이 같은 것을 쓴다.
 * 아래 여백은 ref 의 26px 에서 18px 로 줄였다 — 2배로 키운 로고가 들어갈 자리를 여기서 낸다.
 */
function CardTagline() {
  return (
    /* 줄바꿈 위치를 못박는다 — 카드 폭에 따라 "말랑교실이"가 첫 줄에 붙으면 안 된다 */
    /*
      아래 여백은 ref 의 26px 에서 18px 로 줄였다 — 키운 로고가 들어갈 자리를 여기서 냈다.
      화면이 아주 낮으면(760px 이하) 한 단 더 조인다: 입력칸이 5개인 회원가입 카드가 그 구간에서
      2px 차이로 넘쳐 스크롤이 생겼다.
    */
    <p className="mb-[18px] text-center text-[1.35rem] font-bold leading-[1.5] text-ink-soft [@media(max-height:760px)]:mb-2">
      선생님의 즐거운 수업을
      <br />
      <b className="text-primary">말랑교실</b>이 함께해요!
    </p>
  )
}

/** AuthPage 입력창의 사이즈(패딩/폰트) — 공용 Input 골격 위에 얹는다. */
const authFieldCls = 'px-5 py-[18px] text-base'

/** ref .auth-submit — hover 시 배경/위치가 함께 부드럽게 움직인다 */
const submitCls =
  'w-full rounded-full bg-primary p-[19px] text-[1.05rem] font-black text-white ' +
  'shadow-[0_10px_22px_rgba(98,118,217,.32)] ' +
  'transition-[transform,background-color] duration-[180ms] ease-bounce ' +
  'hover:-translate-y-0.5 hover:bg-primary-hover active:scale-[1.02] disabled:opacity-60'

/** ref .pw-toggle */
const pwToggleCls =
  'absolute right-1.5 top-1/2 grid h-[34px] w-[34px] -translate-y-1/2 place-items-center ' +
  'rounded-full text-ink-mute transition-colors hover:bg-sky hover:text-primary'

/**
 * ref .auth-panel — 두 패널을 같은 그리드 칸에 겹쳐 두되, 비활성 패널은 **자리까지 뺀다**.
 *
 * 예전엔 `invisible`(visibility:hidden)이라 숨은 패널도 자리를 차지했다. 카드 높이가 늘 "두
 * 패널 중 큰 쪽"(회원가입, 738px)에 고정돼 탭 전환 때 출렁이지 않는 장점이 있었지만, 정작
 * **로그인 화면(630px)에 스크롤이 생기는** 대가를 치렀다 — 노트북 높이에서 카드 상한(뷰포트
 * -112px)을 회원가입 쪽 높이가 넘겨 버린다. 로그인 화면에 스크롤이 없는 쪽이 우선이라
 * `hidden`(display:none)으로 바꿨다. 카드는 세로 중앙 정렬이고 탭 전환마다 fadeUp 이
 * 다시 재생돼서(key={tab}), 높이가 달라져도 패널이 갈리는 것으로 읽힌다.
 */
const panelCls = 'col-start-1 row-start-1 animate-fade-up data-[active=false]:hidden'

/** ref --shadow-lg (이 화면 전용 — 토큰 shadow-card-lg 보다 깊다) */
const shadowLg = 'shadow-[0_20px_48px_rgba(0,0,0,.10)]'

/**
 * 통합 인증 화면 — 로그인/회원가입 탭 전환형(레퍼런스 auth.html 이관).
 * 좌측 일러스트 배경 + 우측 플로팅 카드. 인증(useAuth)에 그대로 연결된다.
 */
export function AuthPage({ initialTab = 'login' }: { initialTab?: Tab }) {
  const { login, signup } = useAuth()
  const showToast = useToastStore((s) => s.show)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [showPw, setShowPw] = useState(false)

  // 로그인 폼
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [keepLogin, setKeepLogin] = useState(false)
  const [loginTouched, setLoginTouched] = useState(false)
  // 회원가입 폼
  const [su, setSu] = useState({
    name: '',
    school: '',
    email: '',
    password: '',
    passwordConfirm: '',
  })
  const [touched, setTouched] = useState(false)

  /*
    배경 그림. **파일 이름 표기가 둘로 갈려 있다**(`regi-bg` 하이픈 / `login_bg` 밑줄) —
    로그인 배경만 새 그림으로 갈면서 새로 넣은 파일 이름을 따랐다. 예전 `login-bg.webp` 는
    지워졌는데 코드가 그 경로를 가리키고 있어서 **배경이 404** 였다.
    나중에 회원가입 배경도 갈면 그때 `regi_bg` 로 맞추는 게 좋다.
  */
  const bg = tab === 'signup' ? '/assets/regi-bg.webp' : '/assets/login_bg.webp'

  /*
    필드 검증 에러(입력 누락)와 서버 에러를 구분해 보여준다.

    예전엔 서버 에러면 이유를 묻지 않고 항상 "이메일 또는 비밀번호를 확인해주세요"를 띄웠다.
    그래서 **백엔드가 꺼져 있거나 500 이 나도 비밀번호를 틀린 것처럼 보였다** — 선생님은
    맞는 비밀번호를 몇 번이고 다시 입력하게 된다. 이제 실제 응답에 맞는 문장을 쓴다
    (자격 증명 불일치는 `invalid-credentials` slug 로 같은 문장이 나온다).
  */
  const loginEmailError = loginTouched && !email.trim() ? '이메일을 입력해 주세요.' : undefined
  const loginPwError =
    loginTouched && !password
      ? '비밀번호를 입력해 주세요.'
      : login.isError
        ? apiErrorMessage(login.error, '아이디 또는 비밀번호를 확인해 주세요.')
        : undefined

  function onLogin(e: FormEvent) {
    e.preventDefault()
    setLoginTouched(true)
    if (!email.trim() || !password) return
    login.mutate({ username: email, password })
  }

  const suEmailValid = /\S+@\S+\.\S+/.test(su.email)
  /*
    비밀번호 확인 — 서버로 보내지 않는다. 오타를 **가입 전에** 잡으려는 화면 쪽 장치다
    (한번 잘못 만들면 본인이 못 들어오고, 재설정 메일 안내도 아직 준비 중이다).
    "비었다"와 "다르다"를 구분해 안내한다 — 아직 안 적은 사람에게 "서로 달라요"는 틀린 말이다.
  */
  const suPwMatches = su.passwordConfirm === su.password
  const suValid =
    su.name.trim() &&
    su.school.trim() &&
    suEmailValid &&
    su.password.length >= 8 &&
    su.passwordConfirm.length > 0 &&
    suPwMatches
  function onSignup(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!suValid) return
    signup.mutate(
      { email: su.email, password: su.password, name: su.name, school: su.school },
      {
        onSuccess: () => {
          showToast(`${su.name.trim()} 선생님, 가입이 완료됐어요`)
          /*
            **로그인 탭으로 직접 돌린다.**

            훅에는 `navigate('/login')` 이 있지만 이 화면에서는 아무 일도 하지 않는다:
            `/signup` 과 `/login` 이 같은 컴포넌트라 경로만 바뀌고 다시 마운트되지 않아
            `tab` 상태가 그대로 남는다. `/login` 에서 탭만 바꿔 가입한 경우에는 경로조차
            같아 그야말로 no-op 이다. 그래서 가입에 성공해도 회원가입 폼에 그대로 앉아
            있었고, 성공했는지 실패했는지 토스트 말고는 알 길이 없었다.

            방금 만든 이메일은 로그인 칸에 옮겨 둔다 — 두 번 적게 하지 않는다.
            비밀번호는 옮기지 않는다: 화면에 남겨 둘 값이 아니고, 한 번 더 치는 것이
            방금 정한 비밀번호를 기억하는 데도 낫다.
          */
          setEmail(su.email)
          setPassword('')
          setSu({ name: '', school: '', email: '', password: '', passwordConfirm: '' })
          switchTo('login')
        },
      },
    )
  }

  function switchTo(next: Tab) {
    setTab(next)
    setTouched(false)
    setLoginTouched(false)
    setShowPw(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center overflow-y-auto bg-[#F0F5FD] p-8">
      <div
        /*
          배경 그림 담는 법이 **탭마다 다르다.**

          회원가입(`regi-bg`)은 예전처럼 `bg-cover` 로 꽉 채운다.

          로그인(`login_bg`)은 **높이의 135% 로 담고 왼쪽 아래에 붙인다.**

          `cover` 를 쓰지 않는 이유: 새 그림은 **그림 자체가 확대돼 있다**(교실 장면이 세로
          27%~100% 를 차지한다 — 실측). 예전 그림은 위쪽 37% 가 빈칸이어서 `cover` 가 세로를
          잘라도 빈칸만 없어졌는데, 새 그림에 같은 값을 주면 인물이 프레임의 67% 를 차지해
          (예전 54%) 훅 다가온 느낌이 된다. **위치값으로는 못 고친다** — 두 그림의 비율이
          똑같아서(1.12:1) `bg-position` 을 어떻게 줘도 배율은 그대로다. 크기를 건드려야 한다.

          135% 는 예전 배율을 되찾는 값이다(인물이 프레임 높이의 약 55% ← 예전 54%).
          `contain`(100%)도 써 봤지만 41% 로 너무 작아 이번엔 반대로 멀어 보였다.
          비율로 잡았으므로 창 크기가 바뀌어도 배율은 유지되고, 위로 잘리는 부분은 그림의
          빈칸이라 선생님 머리가 잘리지 않는다. 남는 오른쪽은 그림에서 뽑은
          배경색(`#faf7f8`)이 이어받는다.

          세로 위치 `34%` 는 아래 정렬(`100%`)에서 **그림을 많이 내린 값**이다. 내린 만큼 아래가
          잘리므로(그림 맨 아래가 곧 책상·말랑이다) 더 내리려면 잘림을 감수해야 한다 —
          숫자를 낮출수록 내려간다.
        */
        className={
          'relative flex h-[calc(100vh-64px)] max-h-[1000px] w-[calc(100vw-64px)] max-w-[1760px] ' +
          'flex-col overflow-hidden rounded-[36px] bg-no-repeat ' +
          shadowLg +
          (tab === 'signup'
            ? ' bg-cover bg-[position:left_100%]'
            : ' bg-[size:auto_135%] bg-[position:left_34%]') +
          ' max-[860px]:h-auto max-[860px]:rounded-[28px] max-[860px]:bg-cover max-[860px]:bg-[position:center_bottom]'
        }
        style={{
          backgroundImage: `url('${bg}')`,
          // 로그인 그림은 높이에 맞춰 담기므로 남는 폭을 그림 배경색으로 메운다
          backgroundColor: tab === 'signup' ? undefined : '#faf7f8',
        }}
      >
        {/*
          브랜드 — 프레임 왼쪽 위. 카드 **밖**이다. **로그인 탭에서만 보인다.**

          카드 안(제목 위)에 뒀을 때는 192px 로고가 "로그인"(34px)보다 6배 커서 로고가 제목
          자리를 가로챘다. 정작 이 화면이 무엇을 하는 곳인지 말해주는 건 "로그인"이다.
          브랜드를 카드 밖으로 빼면 카드는 `로그인 -> 인사 -> 폼` 한 줄기로 읽히고,
          브랜드는 크기를 잃지 않는다. (예전 🌱 아이콘 + 텍스트 두 줄은 워드마크와 중복이라 없앴다)

          회원가입에서는 뺀다 — 브랜드를 소개하는 자리가 아니라 폼을 채우는 자리다.
        */}
        <div className="flex flex-none items-center p-[28px_40px] max-[860px]:p-5">
          {tab === 'login' ? (
            <img
              src="/assets/title.webp"
              alt="말랑교실"
              width={1536}
              height={1024}
              decoding="async"
              className="h-48 w-auto object-contain [@media(max-height:880px)]:h-36 [@media(max-height:780px)]:h-28 max-[860px]:h-24"
            />
          ) : (
            /*
              회원가입에서는 로고 자리에 나가는 문을 둔다 — 로고를 뺀 뒤 이 모서리가 비어 있었고,
              가입 폼은 "잘못 들어왔을 때 돌아갈 길"이 위쪽에 보여야 한다.
              주소가 바뀌지 않는 탭 전환이라 브라우저 뒤로가기로는 못 돌아간다. 그래서 화면에
              문을 두는데 **이 하나면 된다** — 폼 아래에 있던 "이미 계정이 있으신가요? 로그인"
              은 같은 일을 하는 두 번째 문이라 없앴다.
            */
            <Button variant="back" onClick={() => switchTo('login')}>
              <Icon name="back" className="h-[15px] w-[15px]" />
              로그인으로
            </Button>
          )}
        </div>

        {/*
          플로팅 카드.

          `pointer-events-none` 이 중요하다. 이 껍데기는 `absolute inset-0` 이라 **프레임 전체를
          덮고**, DOM 에서 위쪽 헤더보다 뒤에 있어 그 위에 깔린다. 눈에는 아무것도 없지만
          클릭은 이 투명한 박스가 먼저 받는다 — 그래서 회원가입 탭 왼쪽 위의 [로그인으로]
          버튼이 **눌리지 않았다**(로그인 탭의 로고는 누를 일이 없어 아무도 몰랐다).

          껍데기는 클릭을 통과시키고, 실제 카드만 아래에서 다시 받는다(`pointer-events-auto`).
        */}
        <div className="pointer-events-none absolute inset-0 max-[860px]:static max-[860px]:min-h-[260px]">
          {/*
            `max-h` + `overflow-y-auto` 는 **잘림 방지 안전망**이다. 상한이 없으면 카드가 그냥
            길어지는데 감싸는 프레임이 `overflow-hidden` 이라 넘친 위아래가 그대로 잘렸다
            (노트북 높이에서 로그인 버튼이나 제목이 사라졌다).

            다만 로그인 화면에서는 이 안전망이 **실제로 걸리지 않아야 한다** — 로그인은
            스크롤 없이 한눈에 들어와야 하는 화면이다. 그래서 두 가지를 함께 둔다:
              · 프레임 안쪽 여유를 48 -> 24px 로 줄여 상한을 넉넉히 (뷰포트 높이 -88px)
              · 화면이 낮으면(840px 이하) 카드 패딩과 로고를 줄여 내용 자체를 낮춘다
            이러면 1366x768 노트북에서도 로그인 패널이 스크롤 없이 들어간다.
            (회원가입은 입력칸이 4개라 아주 낮은 화면에서 스크롤될 수 있고, 그건 안전망대로 둔다)
          */}
          <div
            className={
              'pointer-events-auto absolute right-[7%] top-1/2 w-[min(460px,86vw)] -translate-y-1/2 ' +
              'max-h-[calc(100%-24px)] overflow-y-auto overscroll-contain ' +
              'rounded-[28px] bg-card p-[32px_44px_28px] ' +
              '[@media(max-height:840px)]:p-[22px_36px_18px] ' +
              shadowLg +
              ' max-[860px]:static max-[860px]:mx-5 max-[860px]:mb-6 max-[860px]:max-h-none max-[860px]:w-[calc(100%-40px)]' +
              ' max-[860px]:translate-y-0 max-[860px]:border max-[860px]:border-track max-[860px]:shadow-none'
            }
          >
            {/* key={tab} — 탭이 바뀔 때 fadeUp 등장 애니메이션을 다시 재생시킨다 */}
            <div className="grid" key={tab}>
              {/* ============ 로그인 ============ */}
              <div data-active={tab === 'login'} className={panelCls}>
                <h2 className="mb-3 text-center text-[2.1rem] font-black">로그인</h2>
                <CardTagline />
                <form onSubmit={onLogin} noValidate>
                  <Field label="이메일 주소" error={loginEmailError}>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="이메일을 입력해주세요"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      invalid={Boolean(loginEmailError)}
                      className={authFieldCls}
                    />
                  </Field>
                  <Field label="비밀번호" error={loginPwError}>
                    <div className="relative">
                      <Input
                        type={showPw ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="비밀번호를 입력해주세요"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        invalid={Boolean(loginPwError)}
                        className={`${authFieldCls} pr-11`}
                      />
                      <button
                        type="button"
                        aria-label="비밀번호 표시"
                        onClick={() => setShowPw((v) => !v)}
                        className={pwToggleCls}
                      >
                        <Icon name={showPw ? 'eye' : 'eyeOff'} className="h-[18px] w-[18px]" />
                      </button>
                    </div>
                  </Field>

                  <div className="-mt-2 mb-[26px] flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-[7px] text-[.82rem] font-semibold text-ink-soft">
                      <input
                        type="checkbox"
                        checked={keepLogin}
                        onChange={(e) => setKeepLogin(e.target.checked)}
                        className="h-4 w-4 cursor-pointer accent-primary"
                      />
                      로그인 상태 유지
                    </label>
                    {/* 선생님 전용 — 학생은 이메일이 없어 선생님이 초기화해 준다 (도착 화면이 안내한다) */}
                    <Link
                      to="/reset-password"
                      className="text-[.82rem] font-bold text-ink-soft hover:text-primary"
                    >
                      비밀번호 찾기
                    </Link>
                  </div>

                  <button type="submit" disabled={login.isPending} className={submitCls}>
                    {login.isPending ? '로그인 중…' : '로그인'}
                  </button>
                </form>

                {/*
                  ref 의 .login-spacer(260px)는 두 패널 높이를 맞추려던 것인데, 우리는 비활성
                  패널을 `hidden` 으로 아예 빼므로(panelCls) 높이를 맞출 이유 자체가 없다.
                  스페이서는 로그인 패널만 260px 키워 화면 높이를 넘기게 만드는 주범이었다.
                  여백은 이 문단 마진으로 충분하다 — 2배로 키운 로고 자리를 내주려고 16px 로 잡는다.
                */}
                <p className="mt-4 text-center text-[.85rem] font-semibold text-ink-soft">
                  아직 계정이 없으신가요?{' '}
                  <button
                    type="button"
                    onClick={() => switchTo('signup')}
                    className="font-black text-primary hover:underline"
                  >
                    회원가입
                  </button>
                </p>
              </div>

              {/* ============ 회원가입 ============ */}
              <div data-active={tab === 'signup'} className={panelCls}>
                <h2 className="mb-3 text-center text-[2.1rem] font-black">회원가입</h2>
                <CardTagline />
                {/*
                  입력칸 간격은 ref 의 26px 이 아니라 16px 로 조인다(로그인은 ref 값 그대로).
                  칸이 5개라 그대로 두면 카드가 화면을 넘긴다 — 짧은 두 쌍을 한 줄로 묶은 것과
                  합쳐서, 인사 문구까지 넣고도 스크롤 없이 한 화면에 들어온다.
                */}
                <form onSubmit={onSignup} noValidate className="[&>div]:mb-4">
                  {/*
                    짧은 두 칸은 한 줄에 나란히 둔다. 칸이 5개가 되면서 한 줄에 하나씩 쌓으면
                    노트북 높이(768px)에서 카드가 100px 넘쳐 스크롤이 생긴다 — 두 쌍을 묶어
                    두 칸 높이를 벌면 그대로 한 화면에 들어온다.
                    `[&>div]:mb-0` 은 안쪽 Field 의 아래 여백을 없애는 것이다. 여백은 이 묶음이
                    form 의 자식으로서 받는 `mb-4` 하나만 남는다(안 그러면 줄 간격이 두 번 붙는다).
                  */}
                  <div className="grid grid-cols-2 gap-x-3 [&>div]:mb-0">
                    <Field
                      label="이름"
                      error={touched && !su.name.trim() ? '이름을 입력해 주세요.' : undefined}
                    >
                      <Input
                        autoComplete="name"
                        placeholder="예: 김하늘"
                        value={su.name}
                        onChange={(e) => setSu({ ...su, name: e.target.value })}
                        invalid={touched && !su.name.trim()}
                        className={authFieldCls}
                      />
                    </Field>
                    <Field
                      label="재직 학교"
                      error={touched && !su.school.trim() ? '학교를 입력해 주세요.' : undefined}
                    >
                      <Input
                        autoComplete="organization"
                        placeholder="예: 은솔초"
                        value={su.school}
                        onChange={(e) => setSu({ ...su, school: e.target.value })}
                        invalid={touched && !su.school.trim()}
                        className={authFieldCls}
                      />
                    </Field>
                  </div>
                  <Field
                    label="이메일"
                    error={touched && !suEmailValid ? '올바른 이메일을 입력해 주세요.' : undefined}
                  >
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="이메일을 입력해주세요"
                      value={su.email}
                      onChange={(e) => setSu({ ...su, email: e.target.value })}
                      invalid={touched && !suEmailValid}
                      className={authFieldCls}
                    />
                  </Field>
                  {/*
                    비밀번호와 확인을 나란히 둔다 — 눈 아이콘(pwToggleCls)은 첫 칸에만 둔다.
                    누르면 두 칸이 함께 보이거나 함께 가려져서(showPw 하나로 묶음) 두 값을
                    눈으로 맞춰 볼 수 있다. 확인 칸에 토글을 또 두면 상태가 갈려 헷갈린다.
                  */}
                  <div className="grid grid-cols-2 gap-x-3 [&>div]:mb-0">
                    <Field
                      label="비밀번호"
                      error={
                        touched && su.password.length < 8
                          ? '8자 이상이어야 해요.'
                          : signup.isError
                            ? // "이미 사용 중인 이메일일 수 있어요" 로 뭉개지 않는다 —
                              // 서버가 준 실제 사유(중복 이메일·형식 오류·서버 장애)를 그대로 알려준다
                              apiErrorMessage(
                                signup.error,
                                '가입하지 못했어요. 잠시 뒤에 다시 시도해 주세요.',
                              )
                            : undefined
                      }
                    >
                      <div className="relative">
                        <Input
                          type={showPw ? 'text' : 'password'}
                          autoComplete="new-password"
                          placeholder="8자 이상"
                          value={su.password}
                          onChange={(e) => setSu({ ...su, password: e.target.value })}
                          invalid={(touched && su.password.length < 8) || signup.isError}
                          className={`${authFieldCls} pr-11`}
                        />
                        <button
                          type="button"
                          aria-label="비밀번호 표시"
                          onClick={() => setShowPw((v) => !v)}
                          className={pwToggleCls}
                        >
                          <Icon name={showPw ? 'eye' : 'eyeOff'} className="h-[18px] w-[18px]" />
                        </button>
                      </div>
                    </Field>
                    <Field
                      label="비밀번호 확인"
                      error={
                        touched && !su.passwordConfirm
                          ? '한 번 더 입력해 주세요.'
                          : touched && !suPwMatches
                            ? '비밀번호가 서로 달라요.'
                            : undefined
                      }
                    >
                      <Input
                        type={showPw ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="다시 입력"
                        value={su.passwordConfirm}
                        onChange={(e) => setSu({ ...su, passwordConfirm: e.target.value })}
                        invalid={touched && (!su.passwordConfirm || !suPwMatches)}
                        className={authFieldCls}
                      />
                    </Field>
                  </div>
                  <button type="submit" disabled={signup.isPending} className={submitCls}>
                    {signup.isPending ? '가입 중…' : '회원가입'}
                  </button>
                </form>
                {/*
                  아래에 있던 "이미 계정이 있으신가요? 로그인" 은 뺐다 — 왼쪽 위 [로그인으로]
                  와 같은 일을 하는 두 번째 문이라, 폼 끝에서 한 번 더 물을 이유가 없다.
                */}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
