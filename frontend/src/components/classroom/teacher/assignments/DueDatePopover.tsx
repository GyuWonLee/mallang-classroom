import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/common/Icon'

/** 일요일부터 — 한국 달력 순서 */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/**
 * 마감 시각 알약. 분 단위로 고르게 하지 않는다 — 교실에서 쓰는 마감은 "그날 끝"이나
 * "1교시 전"처럼 몇 개로 정해져 있고, 시각 입력칸을 두면 09:07 같은 값이 오타로 들어간다.
 */
const TIMES = [
  { h: 9, m: 0, label: '오전 9시' },
  { h: 12, m: 0, label: '낮 12시' },
  { h: 18, m: 0, label: '오후 6시' },
  { h: 23, m: 59, label: '밤 11:59' },
] as const

const pad = (n: number) => String(n).padStart(2, '0')

/** 서버는 `LocalDateTime` 을 받는다 — 타임존 없는 `2026-08-12T23:59:00` 이어야 한다 */
function toLocalIso(y: number, m: number, d: number, h: number, min: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}T${pad(h)}:${pad(min)}:00`
}

function sameDay(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }) {
  return a.y === b.y && a.m === b.m && a.d === b.d
}

/** `8월 12일 (수)` — 고른 날을 문장으로 한 번 더 확인해 준다 */
function fmtPicked(y: number, m: number, d: number): string {
  return new Date(y, m, d).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })
}

/**
 * 마감일 고르기 — 상세 패널의 '마감 없음' 글씨를 누르면 그 아래로 내려오는 달력.
 *
 * **브라우저 기본 날짜 입력칸을 쓰지 않는다.** `<input type="date">` 는 OS 마다 모양이 다르고
 * (윈도우 크롬의 회색 달력, 사파리의 휠) 이 화면의 둥근 카드·굵은 글씨와 아무 관계가 없다.
 * 그래서 같은 토큰(--color-primary / sky / canvas / track, radius-tile)으로 직접 그린다.
 *
 * 날짜와 시각을 고르는 것은 **누른 즉시 저장하지 않는다** — 시각까지 정한 뒤 한 번에 보낸다.
 * 무엇이 저장될지 footer 에 문장으로 적어 두고 그 옆에서 저장한다.
 *
 * 지난 날짜도 고를 수 있게 둔다(흐리게만 표시) — "지금 바로 닫는다"가 실제로 있는 일이라
 * 막으면 선생님이 할 수 있는 일을 화면이 빼앗는다.
 */
export function DueDatePopover({
  value,
  busy = false,
  onPick,
  onClose,
}: {
  /** 현재 마감 (ISO). 없으면 오늘·밤 11:59 에서 시작한다 */
  value: string | null
  /** 저장 중 — 버튼을 잠근다 */
  busy?: boolean
  /** 고른 값을 `LocalDateTime` 문자열로 넘긴다 */
  onPick: (iso: string) => void
  onClose: () => void
}) {
  const now = new Date()
  const today = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() }

  const current = value ? new Date(value) : null
  const valid = current && !Number.isNaN(current.getTime()) ? current : null

  /** 고르고 있는 날 (아직 저장 전) */
  const [draft, setDraft] = useState(
    valid ? { y: valid.getFullYear(), m: valid.getMonth(), d: valid.getDate() } : today,
  )
  /** 보고 있는 달 — 날짜와 따로 움직인다 (다음 달을 넘겨 보다가 안 고를 수 있다) */
  const [view, setView] = useState({ y: draft.y, m: draft.m })
  const [time, setTime] = useState(() => {
    if (!valid) return TIMES[TIMES.length - 1]
    const h = valid.getHours()
    const min = valid.getMinutes()
    return TIMES.find((t) => t.h === h && t.m === min) ?? TIMES[TIMES.length - 1]
  })

  const boxRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  /* 바깥 클릭·Esc 로 닫는다 (이 화면의 다른 펼침 목록과 같은 규칙) */
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  /*
    고르고 있는 날에 초점을 옮긴다 — 열었을 때 달력 안으로 들어오고, 화살표로 옮긴 뒤에도
    초점이 따라온다. 격자 안에서 Tab 이 31번 눌리지 않게 tabIndex 는 그 한 칸만 0 이다.
  */
  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>('[data-draft="true"]')?.focus()
  }, [draft, view])

  /** 이 달 1일의 요일 — 앞의 빈 칸 수 */
  const lead = new Date(view.y, view.m, 1).getDay()
  const days = new Date(view.y, view.m + 1, 0).getDate()

  function moveMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  /** 화살표·PageUp/Down 으로 날짜를 옮긴다 — 달을 넘어가면 보는 달도 따라간다 */
  function nudge(deltaDays: number) {
    const d = new Date(draft.y, draft.m, draft.d + deltaDays)
    const next = { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }
    setDraft(next)
    setView({ y: next.y, m: next.m })
  }

  function onGridKey(e: React.KeyboardEvent) {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    if (e.key in step) {
      e.preventDefault()
      nudge(step[e.key])
      return
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      const d = new Date(draft.y, draft.m + (e.key === 'PageUp' ? -1 : 1), draft.d)
      setDraft({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() })
      setView({ y: d.getFullYear(), m: d.getMonth() })
    }
  }

  /** 오늘 / 내일 / 1주 뒤 — 실제로 많이 쓰는 마감을 한 번에 */
  function quick(deltaDays: number) {
    const d = new Date(today.y, today.m, today.d + deltaDays)
    setDraft({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() })
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }

  const isPast = (d: number) =>
    new Date(view.y, view.m, d).getTime() < new Date(today.y, today.m, today.d).getTime()

  return (
    /*
      트리거(마감 글씨) 바로 아래. 상세 패널의 왼쪽에 붙는 글씨라 왼쪽 정렬이다.
      z-40 은 이 화면의 다른 펼침 목록과 같은 층 — 오른쪽 마스코트 그림 위로 떠야 한다.
    */
    <div
      ref={boxRef}
      role="dialog"
      aria-label="마감일 고르기"
      className="absolute left-0 top-full z-40 mt-2 w-[302px] animate-fade-up rounded-[22px] border-2 border-track bg-card p-3.5 shadow-card-lg"
    >
      {/* 달 넘기기 — 좌우 원형 버튼, 가운데 굵은 달 이름 */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => moveMonth(-1)}
          aria-label="지난 달"
          className="grid h-8 w-8 flex-none place-items-center rounded-full bg-canvas text-ink-soft transition-colors hover:bg-sky hover:text-primary"
        >
          <Icon name="back" className="h-3.5 w-3.5" />
        </button>
        <b className="text-[1rem] font-black">
          {view.y}년 {view.m + 1}월
        </b>
        <button
          type="button"
          onClick={() => moveMonth(1)}
          aria-label="다음 달"
          className="grid h-8 w-8 flex-none place-items-center rounded-full bg-canvas text-ink-soft transition-colors hover:bg-sky hover:text-primary"
        >
          <Icon name="chevronRight" className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 요일 — 일요일은 빨강, 토요일은 파랑 (한국 달력의 관습) */}
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((w, i) => (
          <span
            key={w}
            data-dow={i}
            className="grid h-7 place-items-center text-[.72rem] font-black text-ink-mute data-[dow=0]:text-danger data-[dow=6]:text-primary"
          >
            {w}
          </span>
        ))}
      </div>

      {/* 날짜 격자 — 초점은 고르고 있는 한 칸만 받는다(roving tabindex) */}
      <div ref={gridRef} onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead${i}`} aria-hidden="true" />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1
          const cell = { y: view.y, m: view.m, d }
          const on = sameDay(cell, draft)
          const isToday = sameDay(cell, today)
          const dow = (lead + i) % 7
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDraft(cell)}
              data-draft={on}
              data-today={isToday}
              data-past={isPast(d)}
              data-dow={dow}
              tabIndex={on ? 0 : -1}
              aria-label={`${view.m + 1}월 ${d}일`}
              aria-pressed={on}
              className={[
                /* 36px 원 — 손가락으로도 누를 수 있는 최소치에 맞춘 값 */
                'grid h-9 place-items-center rounded-full text-[.88rem] font-extrabold text-ink transition-colors',
                'hover:bg-sky hover:text-primary',
                /* 주말은 글씨색으로 구분 — 고른 칸(흰 글씨)에서는 되돌린다 */
                'data-[dow=0]:text-danger data-[dow=6]:text-primary',
                /* 지난 날은 흐리게. 막지는 않는다 — 지금 바로 마감하는 일이 실제로 있다 */
                'data-[past=true]:text-ink-mute',
                /* 오늘은 테두리로 — 고른 칸과 겹쳐도 서로 지워지지 않는다 */
                'data-[today=true]:border-2 data-[today=true]:border-primary',
                /* 고른 칸: 파란 알약 + 흰 글씨가 주말·지난날 색을 모두 덮는다 */
                'data-[draft=true]:bg-primary data-[draft=true]:font-black data-[draft=true]:text-white data-[draft=true]:hover:bg-primary-hover data-[draft=true]:hover:text-white',
              ].join(' ')}
            >
              {d}
            </button>
          )
        })}
      </div>

      {/* 자주 쓰는 마감 — 달을 넘기지 않고 한 번에 */}
      <div className="mt-2.5 flex gap-1.5">
        {[
          { label: '오늘', delta: 0 },
          { label: '내일', delta: 1 },
          { label: '1주 뒤', delta: 7 },
        ].map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => quick(q.delta)}
            className="flex-1 rounded-full bg-canvas p-[7px_4px] text-[.78rem] font-extrabold text-ink-soft transition-colors hover:bg-sky hover:text-primary"
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* 마감 시각 — 분 단위 입력 대신 교실에서 쓰는 네 개 */}
      <div className="mt-2.5 border-t-[1.5px] border-track pt-2.5">
        <span className="mb-1.5 block text-[.74rem] font-black text-ink-mute">마감 시각</span>
        <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="마감 시각">
          {TIMES.map((t) => (
            <button
              key={t.label}
              type="button"
              role="radio"
              aria-checked={t === time}
              onClick={() => setTime(t)}
              data-on={t === time}
              className="rounded-full bg-canvas p-[7px_2px] text-[.72rem] font-extrabold text-ink-soft transition-colors hover:bg-sky hover:text-primary data-[on=true]:bg-primary data-[on=true]:text-white"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 무엇이 저장되는지 한 문장으로 — 날짜와 시각을 따로 골랐으니 합친 결과를 보여준다 */}
      <p className="mt-3 text-[.8rem] font-bold text-ink-soft">
        <b className="font-black text-ink">{fmtPicked(draft.y, draft.m, draft.d)}</b> {time.label}까지
      </p>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-none rounded-full bg-canvas p-[10px_16px] text-[.86rem] font-black text-ink-soft transition-colors hover:bg-track"
        >
          취소
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onPick(toLocalIso(draft.y, draft.m, draft.d, time.h, time.m))}
          className="flex-1 rounded-full bg-primary p-[10px_16px] text-[.86rem] font-black text-white transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:bg-primary-hover disabled:translate-y-0 disabled:opacity-40"
        >
          {busy ? '저장 중…' : '마감일 저장'}
        </button>
      </div>
    </div>
  )
}
