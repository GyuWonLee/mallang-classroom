import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { TeacherEasterEgg } from '@/components/classroom/teacher/TeacherEasterEgg'
import { useAuthStore } from '@/stores/useAuthStore'
import { useOpenModal } from '@/stores/useModalStore'
import { useAuth } from '@/hooks/useAuth'
import { useRapidTaps } from '@/hooks/useRapidTaps'

/** 로고를 빠르게 이만큼 누르면 이스터에그 (셈하는 규칙은 `useRapidTaps`) */
const EGG_CLICKS = 10

/**
 * 선생님 상단 헤더 — 레퍼런스 teacher.html `.topbar`.
 *
 * **페이지 맨 위를 가로지르는 별도 바가 아니다.** 스크롤되는 콘텐츠 칸(`TeacherShell` 의
 * `.content`) 맨 위, 각 화면 배너 바로 위에 앉는다. 그래서 max-width/가운데 정렬 규칙이 없다 —
 * 부모가 이미 셸의 max-width 안이다.
 *
 * 흰 배경 + **위쪽만** 둥근 모서리이고 아래 테두리를 비운다. 바로 아래 이어지는 배너와
 * 한 덩어리로 읽히게 하는 장치다 (헤더가 위·좌·우, 배너가 좌·우, 패널이 좌·우·아래를 맡아
 * 이어진 한 줄이 된다). 맞닿는 가로 변을 남겨 두면 덩어리 가운데에 두 줄이 겹친 굵은 선이
 * 생겨 다시 조각으로 갈라져 보인다.
 */
export function TeacherTopBar() {
  const user = useAuthStore((s) => s.user)
  const name = user?.name ?? '선생님'
  const openModal = useOpenModal()
  const { logout } = useAuth()

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // ── 이스터에그: 로고 빠르게 10번 ────────────────────────────────
  const [eggOpen, setEggOpen] = useState(false)
  /* 떠 있는 동안은 세지 않는다 — 연출 중에 다시 열리면 폭죽이 겹친다 */
  const tapTitle = useRapidTaps(EGG_CLICKS, () => {
    if (!eggOpen) setEggOpen(true)
  })

  // 바깥 클릭 · ESC 로 닫는다 (학생 화면 GreetBar 와 같은 규칙)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /** GreetBar 의 메뉴 항목과 같은 모양 — 두 화면의 내 메뉴가 다르게 생기면 안 된다 */
  const item =
    'flex w-full items-center gap-2.5 rounded-2xl p-[11px_14px] text-left text-[.92rem] font-bold text-ink transition-colors hover:bg-canvas'

  return (
    /*
      등장 fadeUp — ref 는 화면(view)을 DOM 에 다 두고 클래스로 갈아 끼우기 때문에 전환마다
      애니메이션 클래스를 껐다 켜는 트릭이 필요했다. 여기선 라우트가 바뀔 때 이 컴포넌트가
      새로 마운트되므로 클래스만 걸어 두면 매번 처음부터 재생된다.
    */
    <div className="flex animate-fade-up items-center justify-between gap-5 rounded-t-page border-[1.5px] border-b-0 border-frame bg-card p-[12px_26px_14px] max-[640px]:p-[10px_16px_12px]">
      {/*
        이스터에그는 `fixed` 로 화면 전체에 뜨므로 여기 어디에 있어도 자리 잡는 데는 상관없다.
        헤더 안에 두는 이유는 발동점(로고)과 같은 컴포넌트에 있어야 상태를 주고받기 때문이다.
      */}
      {eggOpen && <TeacherEasterEgg variant="title" onDone={() => setEggOpen(false)} />}

      <div className="flex items-center gap-3">
        {/*
          원형 캐릭터 아이콘 + 텍스트 두 줄을 로고 이미지 한 장으로 바꿨다 (ref `.tb-title-img`
          — `height:70px; width:auto; object-fit:contain`). 높이만 고정하고 폭은 auto 로 둬
          원본 비율(1536x1024 = 1.5:1)을 그대로 지킨다.
        */}
        {/*
          로고는 이스터에그 발동점이기도 하다 — 빠르게 10번.

          사이드바 마스코트와 같은 이유로 `<button>` 으로 감싸지 않는다: 숨은 장난이지 기능이
          아니라서, 버튼이 되면 탭 순서에 끼고 화면 낭독기가 "버튼" 이라고 읽어 준다.
          `alt` 는 그대로 둔다 — 로고는 장식이 아니라 이 화면이 무엇인지 알리는 이미지다.
        */}
        <img
          src="/assets/title.webp"
          alt="말랑교실"
          onClick={tapTitle}
          width={1536}
          height={1024}
          decoding="async"
          className="h-[70px] w-auto object-contain max-[640px]:h-12"
        />
      </div>

      <div className="flex items-center gap-3.5">
        {/*
          알림 벨을 없앴다. 알림 기능이 없는데 **읽지 않은 알림 3건**이라는 빨간 배지가 항상
          박혀 있었고(하드코딩된 "3"), 눌러도 "준비 중" 토스트만 떴다. 선생님은 확인해야 할
          알림이 계속 밀려 있다고 읽는다. 알림 도메인이 생기면 그때 되살린다.

          손든 학생·학생 쪽지는 이미 토스트로 알려주므로(useClassroomSocket) 놓치지 않는다.
        */}

        {/*
          내 메뉴 — 예전엔 `chevronDown` 이 붙은 **누를 수 없는 장식 칩**이었다.
          비밀번호 변경은 '학급 관리 > 설정' 안에, 로그아웃은 사이드바 맨 아래에 흩어져 있어서
          내 계정을 건드리려면 학급을 하나 고르고 들어가야 했다 — 학급과 아무 상관 없는 일인데도.
          학생 화면(GreetBar)이 이미 같은 자리에 같은 메뉴를 갖고 있어 모양·동작을 그대로 맞춘다.
        */}
        <div ref={wrapRef} className="relative flex-none">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="내 메뉴"
            className="flex items-center gap-2.5 rounded-full bg-card p-[7px_16px_7px_8px] text-[.92rem] font-bold shadow-card transition-transform duration-200 ease-bounce hover:-translate-y-0.5"
          >
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-sky text-[.95rem] font-black text-primary">
              {/* ref 는 이름 뒤 두 글자를 아바타로 쓴다 ("김하늘" -> "하늘") */}
              {name.slice(-2)}
            </span>
            <span>{name} 선생님</span>
            <Icon
              name="chevronDown"
              data-open={open}
              className="h-3.5 w-3.5 flex-none text-ink-soft transition-transform data-[open=true]:rotate-180"
            />
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+10px)] z-[70] w-[200px] animate-fade-up rounded-card-md bg-card p-2 shadow-card-lg"
            >
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false)
                  openModal({ type: 'changePassword' })
                }}
              >
                <Icon name="key" className="h-[18px] w-[18px] text-primary" />
                비밀번호 변경
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={logout.isPending}
                className={`${item} text-danger disabled:opacity-50`}
                onClick={() => {
                  setOpen(false)
                  logout.mutate()
                }}
              >
                <Icon name="logout" className="h-[18px] w-[18px]" />
                로그아웃
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
