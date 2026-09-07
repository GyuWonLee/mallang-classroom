import type { ReactNode } from 'react'
import { Icon, type IconName } from '@/components/common/Icon'
import { FillBar } from '@/components/common/FillBar'
import { levelFill, levelOf } from '@/lib/studentMeta'

interface HeadStat {
  /** 구간이 없는 칸(개수)만 고정 톤을 쓴다. 퍼센트·점수 칸은 값에 따라 정해진다 */
  tone?: keyof typeof TONES
  /** 구간이 없는 칸의 아이콘 */
  icon?: IconName
  label: string
  /** 큰 글씨. 값이 없으면 `—` */
  value: string
  /** 값 아래 얇은 구간색 막대 — 퍼센트/점수처럼 0~100 척도일 때만 */
  bar?: number | null
}

/** ref `.ag-hstat.blue/.gray .ag-hstat-ico` — 구간이 없는 칸이 쓰는 고정 톤 */
const TONES = {
  blue: 'bg-sidebar-soft text-primary',
  gray: 'bg-track text-ink-soft',
} as const

/** ref `.ag-hstat-val.high/.mid/.low` — 값 글씨색은 프로그레스 구간색 그대로 */
const VAL_COLOR = {
  high: 'text-level-high',
  mid: 'text-task-deep',
  low: 'text-danger',
} as const

/**
 * 퍼센트·점수 칸은 **구간(high·mid·low)에 따라 아이콘과 배지색이 함께 바뀐다.**
 *
 * 값 글씨 색만 바뀌면 초록·노랑·빨강을 구분하지 못하는 사람에게는 아무 신호가 없다.
 * 아이콘 **모양**까지 갈라 두면 색을 못 봐도 "잘 되고 있다 / 한 번 볼까 / 급하다"가 읽힌다
 * (색만으로 상태를 구분하지 않는다 — 디자인 가이드라인).
 *
 * 구간 기준은 화면 전체가 함께 쓰는 것과 같다: 0~30 낮음 · 31~70 중간 · 71~100 높음(levelOf).
 */
const LEVEL_STYLE: Record<'high' | 'mid' | 'low', { tone: string; icon: IconName }> = {
  high: { tone: 'bg-success text-success-deep', icon: 'check' },
  mid: { tone: 'bg-task-soft text-task-deep', icon: 'bulb' },
  low: { tone: 'bg-danger-soft text-danger', icon: 'alert' },
}

/** 값이 없는(—) 칸은 구간이 없다 — 무채색 배지에 중립 아이콘 */
const NO_DATA = { tone: TONES.gray, icon: 'chart' as IconName }

/**
 * 과제 관리 배너 — 레퍼런스 teacher.html `.ag-frame`.
 *
 * 맨 윗줄에 뒤로가기와 "새 과제 만들기"를 나란히 두고(`.ag-topbar`), 아래 헤더 줄은
 * 왼쪽에 제목·부제·마스코트, 오른쪽에 흰 통계 상자 하나에 3칸을 점선으로 나눠 담는다.
 *
 * **바닥 정렬이 핵심이다.** `.ag-head` 가 `align-items:flex-end` 라서 왼쪽 글줄의 아래 끝과
 * 오른쪽 통계 상자의 아래 끝이 같은 선에 놓인다. 마스코트는 `translateY` 로만 내린다 —
 * margin 으로 내리면 배너 높이가 같이 늘어난다.
 *
 * 반응형은 ref 의 단계를 그대로 따른다: 한 줄(글줄 | 통계)을 최대한 오래 유지하려고
 * 들여쓰기 → 통계 여백 → 마스코트 순으로 깎고, **통계는 끝까지 제목 옆줄을 지킨다**
 * (아래로 접지 않는다).
 */
export function AssignmentBanner({
  back,
  action,
  ongoing,
  avgRate,
  avgScore,
}: {
  back: ReactNode
  action: ReactNode
  /** 진행 중(공개된) 과제 수 */
  ongoing: number
  /** 평균 제출률 0~100. 집계할 과제가 없으면 null */
  avgRate: number | null
  /** 평균 점수 0~100. 채점된 제출이 없으면 null */
  avgScore: number | null
}) {
  const stats: HeadStat[] = [
    { tone: 'blue', icon: 'doc', label: '진행 중인 과제', value: `${ongoing}개` },
    {
      label: '평균 제출률',
      value: avgRate === null ? '—' : `${avgRate}%`,
      bar: avgRate,
    },
    {
      label: '평균 점수',
      value: avgScore === null ? '—' : `${avgScore}점`,
      bar: avgScore,
    },
  ]

  return (
    <div className="relative mb-5 overflow-hidden rounded-page bg-[#DCEBFA] bg-[url('/assets/homework_bg.webp')] bg-cover bg-center bg-no-repeat p-[18px_28px_20px] shadow-card">
      {/* ref .ag-topbar — 뒤로가기(왼쪽)와 만들기 버튼(오른쪽)을 한 줄에. margin-bottom 6px */}
      <div className="relative z-1 mb-1.5 flex items-center justify-between gap-3.5">
        {back}
        {action}
      </div>

      {/* ref .ag-head — 바닥 정렬. 한 줄을 유지하려고 wrap 하지 않는다 */}
      <div className="relative z-1 flex flex-nowrap items-end justify-between gap-[18px] px-0.5">
        {/* ref .ag-head-lead — 글줄이 먼저, 마스코트가 그 오른쪽. 배너 왼쪽에서 넉넉히 들여쓴다 */}
        <div className="flex items-end gap-[18px] pl-[42px] max-[1400px]:pl-[30px] max-[1240px]:pl-4 max-[1080px]:gap-3 max-[1080px]:pl-1.5 max-[920px]:gap-0 max-[920px]:pl-0">
          {/*
            글줄은 이 줄의 **바닥에** 붙는다(부모 items-end). 그래서 위로 올리려면 아래에 여백을
            주는 게 맞다 — margin-top 을 주면 바닥 정렬이라 아무 일도 일어나지 않는다.
          */}
          <div className="pb-3">
            {/* 줄바꿈은 <br> 로만 — 좁아져도 한 줄이 임의로 접히지 않게 nowrap */}
            <h1 className="whitespace-nowrap text-[2.15rem] font-black leading-[1.3] tracking-[-.6px] max-[820px]:text-[1.7rem]">
              과제 관리
            </h1>
            {/*
              제목과 부제 사이 간격은 **위 뒤로가기 줄과 제목 사이(.ag-topbar 의 mb-1.5 = 6px)와
              같게** 맞춘다. ref 값(20px)은 이 배너에서 너무 벌어져 보였다.

              이 값은 곧 "제목을 얼마나 올릴지"이기도 하다 — 글줄은 아래 끝이 고정(통계 상자
              끝선과 맞춤)이라, 줄이면 부제는 그대로 있고 제목이 그만큼 내려와 둘이 붙는다.
            */}
            <p className="mt-1.5 whitespace-nowrap text-[.95rem] font-semibold text-ink-soft max-[820px]:text-[.86rem]">
              과제를 만들고 학생들의 학습 결과를
              <br />
              확인해 보세요.
            </p>
          </div>
          {/*
            마스코트 — translateY(20px) 은 배너 아래 패딩(20px)과 짝이라 발끝이 배너 바닥에 딱 닿는다.
            폭이 헤더 줄 높이를 좌우하므로 좁아질 때 여기를 깎는 효과가 가장 크다.
          */}
          <img
            src="/assets/student_ch.webp"
            alt=""
            aria-hidden="true"
            width={1254}
            height={1254}
            decoding="async"
            className="h-auto w-[111px] flex-none translate-y-5 drop-shadow-[0_6px_12px_rgba(60,80,140,.16)] max-[1400px]:w-[107px] max-[1240px]:w-[102px] max-[1080px]:w-24 max-[920px]:hidden"
          />
        </div>

        {/*
          ref .ag-head-right + .ag-hstats — 흰 상자 하나에 3칸을 점선으로 나눈다.
          `flex-[0_1_auto]` + `min-w-0` 이라 폭이 빡빡해지면 아래로 떨어지지 않고 좁아진다.
        */}
        <div className="flex min-w-0 flex-[0_1_auto] flex-col items-end justify-end">
          <div className="flex min-w-0 items-stretch rounded-card bg-white/[.94] p-[6px_4px] shadow-[0_10px_24px_rgba(60,80,140,.14)] max-[920px]:p-[4px_2px]">
            {/*
              한 칸 — **바깥 여백은 ref 그대로**(`padding:20px 54px`, `gap:16px`)라 상자 폭은
              ref 와 같고, **안쪽 요소만 한 단 키웠다**: 아이콘 40->48, 값 1.35->1.6rem,
              라벨 .78->.88rem, 바 6->7px.
              좌우 패딩을 건드리지 않는 이유 — 상자가 오른쪽 정렬이라 폭이 바뀌면 왼쪽으로
              자라거나 줄어 제목 줄과의 거리가 달라진다(ref 주석).
              좁아지는 단계(1400/1240/1080/920/820)는 ref 값 그대로 둔다 — 거기서까지 키우면
              통계가 제목 옆줄을 못 지키고 아래로 떨어진다.
            */}
            {stats.map((s) => {
              /*
                퍼센트·점수 칸은 값의 구간이 배지색과 아이콘을 함께 정한다.
                값이 없으면(—) 구간이 없으므로 무채색 + 중립 아이콘.
              */
              const style =
                s.bar == null
                  ? s.tone
                    ? { tone: TONES[s.tone], icon: s.icon ?? NO_DATA.icon }
                    : NO_DATA
                  : LEVEL_STYLE[levelOf(s.bar)]
              return (
                <div
                  key={s.label}
                  className="flex min-w-0 flex-[1_1_auto] items-center gap-[18px] border-r-2 border-dashed border-track p-[15px_45px] last:border-r-0 max-[1400px]:gap-4 max-[1400px]:p-[19px_38px] max-[1240px]:gap-[11px] max-[1240px]:p-[17px_26px] max-[1080px]:gap-[9px] max-[1080px]:p-[15px_18px] max-[920px]:gap-[7px] max-[920px]:p-[13px_8px] max-[820px]:gap-1.5 max-[820px]:p-[11px_6px]"
                >
                  <span
                    className={`grid h-12 w-12 flex-none place-items-center rounded-[14px] max-[1400px]:h-10 max-[1400px]:w-10 max-[1400px]:rounded-xl max-[1240px]:h-9 max-[1240px]:w-9 max-[1240px]:rounded-[11px] max-[1080px]:h-8 max-[1080px]:w-8 max-[1080px]:rounded-[10px] max-[920px]:h-7 max-[920px]:w-7 max-[920px]:rounded-[9px] max-[820px]:h-6 max-[820px]:w-6 ${style.tone}`}
                    aria-hidden="true"
                  >
                    <Icon
                      name={style.icon}
                      className="h-6 w-6 max-[1400px]:h-5 max-[1400px]:w-5 max-[820px]:h-3.5 max-[820px]:w-3.5"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[.88rem] font-extrabold text-ink-soft max-[1400px]:text-[.78rem] max-[920px]:text-[.72rem] max-[820px]:text-[.66rem]">
                      {s.label}
                    </span>
                    <span
                      className={`mt-0.5 block text-[1.6rem] font-black leading-[1.2] max-[1400px]:mt-px max-[1400px]:text-[1.35rem] max-[1240px]:text-[1.2rem] max-[1080px]:text-[1.08rem] max-[920px]:text-[1rem] max-[820px]:text-[.92rem] ${
                        s.bar == null ? 'text-ink' : VAL_COLOR[levelOf(s.bar)]
                      }`}
                    >
                      {s.value}
                    </span>
                    {/* 값 아래 얇은 진행바 — 0~100 척도일 때만 (ref .ag-hstat-bar) */}
                    {s.bar != null && (
                      <FillBar
                        pct={s.bar}
                        className="mt-[7px] h-[7px] max-[1400px]:h-1.5 max-[820px]:mt-[5px] max-[820px]:h-1"
                        fillClassName={levelFill(s.bar)}
                      />
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
