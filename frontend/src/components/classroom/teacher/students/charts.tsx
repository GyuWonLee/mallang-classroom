import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { levelFill } from '@/lib/studentMeta'
import { FillBar } from '@/components/common/FillBar'
import { useFillValue } from '@/hooks/useFillValue'

/*
  ref .sm-donut / .sm-line / .sm-bar 의 SVG 조각을 컴포넌트로 옮긴 것.

  `WeeklyLineChart`/`BarRow` 는 한 번 지워졌다 되살아난 물건이다 — 예전엔
  `deriveStudent()` 가 해시로 지어낸 값(주간 배열·5과목 점수)에만 맞는 차트라 가짜 데이터와
  함께 지웠는데, 이제 제출 시각(scoreTrend)과 개념별 정답률(tagStats)이라는 **실제 데이터**가
  같은 모양으로 나와서 ref 시안 그대로 다시 만들었다.
*/

/** 진행률 도넛 — 카드 안에서 가로·세로 모두 가운데. 빈 원에서 목표 퍼센트까지 차오른다 */
export function ProgressDonut({ pct, label = '정답률' }: { pct: number; label?: string }) {
  const r = 46
  const circ = 2 * Math.PI * r
  /*
    채운 만큼만 그리는 dasharray 방식은 값이 바뀌어도 전환이 걸리지 않는다(대시 패턴 자체가
    바뀌는 것이라). 원 둘레 **전체**를 하나의 대시로 두고 `dashoffset` 으로 가리면, offset 하나만
    움직여서 차오르는 애니메이션이 걸린다 (ref smDonut / .ag-ring 과 같은 방식).
  */
  const filled = useFillValue(pct)
  return (
    <div className="relative m-auto h-[150px] w-[150px]">
      <svg
        viewBox="0 0 118 118"
        className="block h-full w-full -rotate-90"
        role="img"
        aria-label={`${label} ${pct}퍼센트`}
      >
        <circle cx="59" cy="59" r={r} fill="none" strokeWidth="13" className="stroke-track" />
        <circle
          cx="59"
          cy="59"
          r={r}
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-[800ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none"
          strokeDasharray={circ.toFixed(1)}
          strokeDashoffset={(circ * (1 - filled / 100)).toFixed(1)}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <div className="text-[1.85rem] font-black leading-[1.1] text-primary">{pct}%</div>
        <div className="mt-[3px] text-[.92rem] font-bold text-ink-soft">{label}</div>
      </div>
    </div>
  )
}

/**
 * 최근 4주간 진도 꺾은선 — ref `smLineChart` 이관 (240x86 · 0/50/100 점선 눈금 · 점 r3.4).
 *
 * `vals` 는 [4주 전, 3주 전, 2주 전, 1주 전, 이번 주] 다섯 점의 0~100 값.
 * 아래 축 라벨의 왼쪽 패딩 14.2% 는 ref 주석 그대로 padL/W(34/240)에서 나온 값이다.
 */
export function WeeklyLineChart({ vals }: { vals: number[] }) {
  /*
    **선이 그려지는 애니메이션** — ref `animateFills` 의 `.sm-line` 부분을 그대로 옮긴 것.
    도넛·막대처럼 CSS 만으로는 안 되는데, dasharray/dashoffset 에 넣을 길이를 **실제로 렌더된
    뒤에** `getTotalLength()` 로 재야 하기 때문이다(값이 아니라 그려진 경로의 길이다).
    그래서: 길이만큼 가려 둔 채 전환 없이 한 번 그리고 → 두 프레임 뒤에 offset 을 0 으로 풀어
    1초 동안 왼쪽에서 오른쪽으로 선이 자라게 하고 → 선이 다 그려질 즈음(950ms) 점을 띄운다.
    `prefers-reduced-motion` 사용자에게는 처음부터 완성된 그림을 준다 (가이드라인 5장).
  */
  const pathRef = useRef<SVGPolylineElement>(null)
  const [dotsOn, setDotsOn] = useState(false)
  const valsKey = vals.join(',')
  useEffect(() => {
    const el = pathRef.current
    if (!el) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.style.strokeDasharray = ''
      el.style.strokeDashoffset = ''
      setDotsOn(true)
      return
    }
    const len = el.getTotalLength()
    el.style.transition = 'none'
    el.style.strokeDasharray = `${len}`
    el.style.strokeDashoffset = `${len}`
    setDotsOn(false)
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        el.style.transition = 'stroke-dashoffset 1s cubic-bezier(.22,1,.36,1)'
        el.style.strokeDashoffset = '0'
      })
    })
    const dots = setTimeout(() => setDotsOn(true), 950)
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      clearTimeout(dots)
    }
    // 값이 바뀌면(데이터 도착·학생 변경) 처음부터 다시 그린다 — ref 도 렌더마다 다시 걸었다
  }, [valsKey])

  const W = 240
  const H = 86
  const padL = 34
  const padR = 6
  const padT = 8
  const padB = 8
  const iw = W - padL - padR
  const ih = H - padT - padB
  const pts = vals.map(
    (v, i) => [padL + (iw * i) / (vals.length - 1), padT + ih - (ih * v) / 100] as const,
  )
  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full overflow-visible"
        role="img"
        aria-label={`최근 4주간 진도 변화 ${vals.join(', ')} 퍼센트`}
      >
        {[0, 50, 100].map((v) => {
          const y = padT + ih - (ih * v) / 100
          return (
            <g key={v}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                className="stroke-track"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-ink-mute text-[9.5px] font-bold"
              >
                {v}%
              </text>
            </g>
          )
        })}
        <polyline
          ref={pathRef}
          className="stroke-primary"
          fill="none"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}
        />
        {pts.map((p, i) => (
          <circle
            key={i}
            data-on={dotsOn}
            className="fill-primary opacity-0 transition-opacity duration-300 data-[on=true]:opacity-100 motion-reduce:opacity-100 motion-reduce:transition-none"
            cx={p[0].toFixed(1)}
            cy={p[1].toFixed(1)}
            r="3.4"
          />
        ))}
      </svg>
      <div className="mt-[7px] flex justify-between pl-[14.2%] pr-[2.5%] text-[.8rem] font-bold text-ink-mute">
        {['4주 전', '3주 전', '2주 전', '1주 전', '이번 주'].map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </>
  )
}

/**
 * 이름 + 막대 + 퍼센트 한 줄 — ref `smBarRow`.
 *
 * **이름칸은 고정폭이다**(ref 도 44px 고정). `auto` 로 두면 이름 길이마다 칸 폭이 달라져
 * 막대의 시작점이 줄마다 어긋나고, 여러 줄을 위아래로 비교할 수 없다 — 우리 개념 태그는
 * '문장의 짜임' 처럼 길이가 천차만별이라 ref 보다 넉넉한 110px 을 주고 넘치면 자른다
 * (자른 이름은 `title` 로 전체를 볼 수 있게 한다).
 */
export function BarRow({ name, score }: { name: string; score: number }) {
  return (
    <div className="mb-2.5 grid grid-cols-[110px_minmax(0,1fr)_42px] items-center gap-2.5 last:mb-0 max-[560px]:grid-cols-[84px_minmax(0,1fr)_38px]">
      <span className="truncate text-[.95rem] font-extrabold" title={name}>
        {name}
      </span>
      <LevelBar score={score} />
      <span className="text-right text-[.88rem] font-black text-ink-soft">{score}%</span>
    </div>
  )
}

/**
 * 이해도 막대 하나 — 색과 함께 퍼센트를 항상 같이 적는다(색만으로 구분하지 않는다).
 * 기본 높이는 ref `.sm-bar`(9px). 낮춰야 하면 호출부에서 `h-2` 처럼 넘긴다 —
 * cn() 이라 뒤에 온 높이가 이긴다.
 */
export function LevelBar({ score, className }: { score: number; className?: string }) {
  return (
    <FillBar pct={score} className={cn('h-[9px]', className)} fillClassName={levelFill(score)} />
  )
}
