import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ConfettiCanvas } from '@/components/classroom/ConfettiCanvas'
import { confettiController } from '@/services/effects/confettiController'
import { modalCard } from '@/lib/motion'

/**
 * 이스터에그 종류 — 발동점마다 다른 말이 뜬다.
 *
 * 카드·폭죽·사라지는 규칙은 하나로 두고 **문구만 갈아 끼운다.** 두 번째 이스터에그를 컴포넌트째
 * 복사하면 폭죽 타이밍과 페이드아웃 규칙이 두 곳에 생겨, 한쪽만 고치는 일이 생긴다.
 *
 *  - `credits` 사이드바 마스코트 20번 — 만든 사람들
 *  - `title`   헤더 로고 10번 — 팀 내 농담
 */
export type EggVariant = 'credits' | 'title'

const EGGS: Record<
  EggVariant,
  {
    /** 위에 작게 얹는 말. 없으면 줄 자체를 그리지 않는다 */
    label: string | null
    lines: string[]
    /**
     * 줄을 늘어놓는 방향. 이름 두 개(`credits`)는 나란히가 자연스럽고, 문장 두 개(`title`)는
     * 나란히 두면 한 줄이 너무 길어져 좁은 화면에서 제멋대로 접힌다.
     */
    layout: 'row' | 'col'
    /** 문장이 길수록 작게 — 이름 두 자와 문장을 같은 크기로 두면 문장이 카드를 넘긴다 */
    size: string
  }
> = {
  credits: {
    label: 'MADE BY',
    lines: ['최재성', '표건희'],
    layout: 'row',
    size: 'text-[2.2rem] max-[640px]:text-[1.6rem]',
  },
  title: {
    label: null,
    lines: ['최혜민 이규원 바보', '오현우 싸탈 축하해'],
    layout: 'col',
    size: 'text-[1.9rem] max-[640px]:text-[1.2rem]',
  },
}

/** 이름이 떠 있는 총 시간(ms) */
const SHOW_MS = 3200
/** 두 번째 폭죽 — 한 번만 터뜨리면 이름을 읽기 전에 다 떨어진다 */
const SECOND_BURST_MS = 700
/** 사라지는 데 걸리는 시간. `modalCard.exit`(0.15s)보다 넉넉히 잡는다 */
const FADE_MS = 300

/**
 * 선생님 화면의 숨은 장난 — 정해진 자리를 빠르게 여러 번 누르면 나온다.
 * (사이드바 마스코트 20번 = `credits`, 헤더 로고 10번 = `title`)
 *
 * 폭죽 캔버스를 **여기서만 마운트한다.** `ConfettiCanvas` 는 마운트될 때 엔진을
 * `confettiController` 에 등록하는데, 선생님 화면에는 그 캔버스가 깔려 있지 않아서
 * `burst()` 를 불러도 조용히 아무 일도 일어나지 않는다(학생 수업 화면에만 있다).
 * 이스터에그가 떠 있는 동안만 두므로 평소에는 캔버스도 rAF 루프도 없다.
 *
 * 아래 효과는 캔버스가 엔진을 등록한 **뒤에** 돈다 — React 는 자식 효과를 부모보다 먼저
 * 실행하고, `ConfettiCanvas` 는 이 컴포넌트가 그리는 자식이라 순서가 보장된다.
 *
 * 사라짐을 `AnimatePresence` 로 하지 않는 이유: 부모가 `onDone` 에서 이 컴포넌트를 바로
 * 떼어내므로 exit 이 재생될 틈이 없다. 그래서 먼저 `leaving` 으로 페이드아웃을 돌리고,
 * 그게 끝난 뒤에 `onDone` 을 부른다.
 */
export function TeacherEasterEgg({
  onDone,
  variant = 'credits',
}: {
  onDone: () => void
  variant?: EggVariant
}) {
  const [leaving, setLeaving] = useState(false)
  const egg = EGGS[variant]

  useEffect(() => {
    confettiController.burst(160)
    const timers = [
      setTimeout(() => confettiController.burst(120), SECOND_BURST_MS),
      setTimeout(() => setLeaving(true), SHOW_MS - FADE_MS),
      setTimeout(onDone, SHOW_MS),
    ]
    return () => timers.forEach(clearTimeout)
  }, [onDone])

  return (
    <>
      {/* 폭죽은 이름 카드보다 아래(z-90)에 깔린다 — 이름을 가리면 안 된다 */}
      <ConfettiCanvas />
      {/*
        화면 전체를 덮지만 **클릭을 먹지 않는다**(`pointer-events-none`) — 축하 연출이
        수업 중 선생님의 조작을 막아서는 안 된다. 저절로 사라지므로 닫는 버튼도 두지 않는다.
        `aria-hidden`: 기능이 아니라 장식이라 화면 낭독기에는 알리지 않는다.
      */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[95] grid place-items-center"
        variants={modalCard}
        initial="hidden"
        animate={leaving ? 'exit' : 'visible'}
      >
        <div className="flex flex-col items-center gap-3 rounded-[28px] bg-white/90 p-[28px_44px] shadow-card-lg">
          {egg.label && (
            <span className="text-[.9rem] font-black tracking-[.2em] text-primary">{egg.label}</span>
          )}
          {/* 두 줄을 **한 카드에 함께** 띄운다 — 번갈아 보여주면 하나를 놓친다 */}
          <p
            data-layout={egg.layout}
            className={`flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-black leading-tight tracking-[-.5px] text-ink data-[layout=col]:flex-col ${egg.size}`}
          >
            {egg.lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </p>
          <span className="text-[1.6rem]">🎉</span>
        </div>
      </motion.div>
    </>
  )
}
