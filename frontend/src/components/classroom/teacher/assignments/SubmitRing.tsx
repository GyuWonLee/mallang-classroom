import { useFillValue } from '@/hooks/useFillValue'
import { levelOf } from '@/lib/studentMeta'

/** 원 둘레 — r=25 라 2πr ≈ 157.1 (ref `AG_RING_C`) */
const CIRC = 2 * Math.PI * 25

/**
 * 구간색 — 진행바(`levelFill`)·배너 통계와 **같은 기준**을 쓴다.
 * 0~30 낮음(빨강) · 31~70 중간(노랑) · 71~100 높음(초록).
 */
const LEVEL_STROKE = {
  high: 'stroke-level-high',
  mid: 'stroke-task',
  low: 'stroke-danger',
} as const

/**
 * 제출률 링 — 레퍼런스 `.ag-ring`.
 *
 * 둘레 전체를 하나의 대시로 두고 `stroke-dashoffset` 으로 깎는다. 빈 원에서 목표값까지
 * 차오르게 하려면 offset 하나만 움직이면 되기 때문이다 (채운 만큼만 그리는 dasharray 방식은
 * 대시 패턴 자체가 바뀌어서 전환이 걸리지 않는다).
 *
 * **색은 과목이 아니라 값이 정한다.** ref 는 `--art-ink`(과목색)로 칠하지만, 그러면 링이
 * "무슨 과목인지"만 말하고 정작 제출률이 좋은지 나쁜지는 숫자를 읽어야 안다. 과목은 이미
 * 카드의 알약과 선택 테두리가 말해 주므로, 링은 화면 전체가 쓰는 구간색 규칙을 따른다.
 *
 * 값이 없으면(`null`) 링을 비우고 가운데에 `—` 를 적는다 — 0% 로 그리면 "아무도 안 냈다"로
 * 잘못 읽힌다.
 */
export function SubmitRing({ pct }: { pct: number | null }) {
  const filled = useFillValue(pct ?? 0)
  return (
    <span className="relative h-[58px] w-[58px] flex-none">
      <svg
        viewBox="0 0 58 58"
        className="h-[58px] w-[58px] -rotate-90"
        role="img"
        aria-label={pct === null ? '제출률 없음' : `제출률 ${pct}퍼센트`}
      >
        <circle cx="29" cy="29" r="25" fill="none" strokeWidth="6" stroke="#EEF0F4" />
        {pct !== null && (
          <circle
            cx="29"
            cy="29"
            r="25"
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRC.toFixed(1)}
            strokeDashoffset={(CIRC * (1 - filled / 100)).toFixed(1)}
            className={`${LEVEL_STROKE[levelOf(pct)]} transition-[stroke-dashoffset] duration-[800ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none`}
          />
        )}
      </svg>
      <b className="absolute inset-0 grid place-items-center text-[.78rem] font-black text-ink">
        {pct === null ? '—' : `${pct}%`}
      </b>
    </span>
  )
}
