import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { useUserStore } from '@/stores/useUserStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useOpenModal } from '@/stores/useModalStore'
import { useAuth } from '@/hooks/useAuth'
import { givenName, topicParticle } from '@/lib/korean'

/**
 * 상단 인사말 + 사용자 메뉴 (ref .greet-row 이관).
 *
 * **좌측 사이드바를 없애면서 그 안에 있던 설정·로그아웃이 이리로 왔다.** 사이드바는 세로로
 * 118px 을 늘 차지했는데 실제로 데려가는 곳은 없었다(홈은 제자리, AI 대화는 제거, 설정은 모달).
 * 태블릿 세로 화면에서는 그 폭이 특히 아까웠다.
 *
 * 예전에도 여기 사용자 칩에 `chevronDown` 이 있었지만 **누를 수 없는 장식**이었다 —
 * 이제 실제로 열리는 메뉴다.
 *
 * **칭찬 점수(XP) 막대는 없다.** `useUserStore.xp` 는 서버에 대응 필드가 없어 메모리에만 있고,
 * 새로고침하면 0 으로 돌아갔다.
 */
export function GreetBar({
  classLabel,
}: {
  /** 부제에 적을 소속 — `3학년 · 국어교실`. 모르면 기존 인사 문구를 그대로 쓴다 */
  classLabel?: string
}) {
  // 이름은 로그인한 계정에서 온다 (스토어에 하드코딩된 기본값을 쓰지 않는다)
  const name = useAuthStore((s) => s.user?.name) ?? ''
  /** 인사말에 쓸 **성 뺀 이름** (`최재성` → `재성`). 사용자 메뉴에는 전체 이름을 쓴다 */
  const given = givenName(name)
  const avatarUrl = useUserStore((s) => s.avatarUrl)
  const openModal = useOpenModal()
  const { logout } = useAuth()

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 바깥 클릭 · ESC 로 닫는다 (아이들이 메뉴에 갇히지 않게 나가는 길을 둘 다 둔다)
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

  const item =
    'flex w-full items-center gap-2.5 rounded-2xl p-[11px_14px] text-left text-[.92rem] font-bold text-ink transition-colors hover:bg-canvas'

  return (
    /*
      ── 페이지 판의 **머리글 줄** ───────────────────────────────────
      예전엔 배경 없는 줄에 아바타 칩·인사·내 메뉴가 각자 흰 카드로 떠 있었고, 그 뒤에는 이
      줄만 흰 카드로 감쌌다. 지금은 `ClassroomPage` 가 화면 전체를 흰 판 하나로 묶으므로,
      여기서 또 카드를 그리면 **흰 면 위 흰 면**이 된다.

      그래서 자기 배경·그림자·라운드를 갖지 않고 **아래 구분선만** 그린다 — 판의 첫 줄이라는
      뜻이 그것으로 충분하다. 안쪽 칩들은 `bg-canvas` 로 한 단계 눌러 흰 줄 위에서 드러낸다.
    */
    <div className="flex flex-none flex-wrap items-center justify-between gap-5 border-b-[1.5px] border-frame p-[14px_20px]">
      {/* 좌측: 아바타 네모 칩 + 인사 두 줄 — 목업의 "안녕, OO! 👋 / 3학년 2반" 자리 */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-[52px] w-[52px] flex-none place-items-center overflow-hidden rounded-2xl bg-canvas p-1.5 max-[640px]:h-11 max-[640px]:w-11">
          <img src={avatarUrl} alt="" decoding="async" className="h-full w-full object-contain" />
        </span>
        <div className="min-w-0">
          {/*
            **성을 떼고 이름만 부른다** — `최재성` → `안녕, 재성아!`.
            아이를 직접 부르는 자리에서 성까지 붙이면("최재성아") 야단치는 말투가 된다.
            오른쪽 사용자 메뉴는 계정을 가리키는 자리라 전체 이름을 그대로 둔다.

            호칭(`아`/`야`)은 **성을 뗀 이름**의 받침으로 고른다 — 전체 이름으로 고르면
            받침이 다른 경우(`김민수` → 수/무받침) 엉뚱한 호칭이 붙는다.
          */}
          <h1 className="text-[1.7rem] font-black leading-[1.2] tracking-[-.5px] max-[900px]:text-[1.45rem] max-[640px]:text-[1.3rem]">
            {given ? `안녕, ${given}${topicParticle(given) === '는' ? '야' : '아'}! 👋` : '안녕! 👋'}
          </h1>
          {/* 소속을 알면 그걸 적는다 — 목업처럼 파랑 굵은 글씨. 모르면 기존 인사 문구 */}
          {classLabel ? (
            <p className="mt-[3px] truncate text-[.92rem] font-extrabold text-primary">
              {classLabel}
            </p>
          ) : (
            <p className="mt-[3px] text-[.95rem] font-medium text-ink-soft">
              오늘도 우리 함께 공부해보자!
            </p>
          )}
        </div>
      </div>

      {/*
        'N명 시청 중' 알약은 없앴다 — 선생님 요청.

        아이가 자기 화면에서 볼 이유가 없는 숫자였다(누가 몇 명 보는지는 선생님이 챙기는 일이고,
        학생 쪽 값은 LiveKit 룸 참가자 수 + 나 라서 "친구가 몇 명 있나"로 읽히지도 않았다).
        계산에 쓰던 `viewers` prop 과 호출부의 집계도 함께 걷어냈다.
      */}
      <div className="flex flex-none items-center gap-2.5">
        <div ref={wrapRef} className="relative flex-none">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="내 메뉴"
          className="flex items-center gap-2.5 rounded-full bg-canvas p-[7px_16px_7px_8px] text-[.92rem] font-bold transition-colors hover:bg-track"
        >
          <span className="h-10 w-10 overflow-hidden rounded-full bg-sky">
            <img src={avatarUrl} alt="" decoding="async" className="h-full w-full object-cover" />
          </span>
          <span className="max-[640px]:hidden">{name}</span>
          <Icon
            name="chevronDown"
            data-open={open}
            className="h-3.5 w-3.5 text-ink-soft transition-transform data-[open=true]:rotate-180"
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
