import type { ReactNode } from 'react'
import { Icon } from '@/components/common/Icon'
import { FillBar } from '@/components/common/FillBar'
import type { ClassTileTheme } from '@/lib/classTile'

interface ClassTileProps {
  theme: ClassTileTheme
  /** 왼쪽 위 알약 — 학년 라벨 (ref `.pk-pill`) */
  pill: string
  /** 카드의 대표 이름 = 학급 이름 (ref `.pk-grade`) */
  title: string
  /** "학생 N명". 아직 못 받았으면 생략한다 — 0명으로 적으면 사실이 아니다 */
  studentCount?: number
  /**
   * 과제 진행률 0~100. `null` 은 "낼 과제가 아직 없다"로 0% 와 구분해 `—` 로 적는다.
   * `undefined` 면 줄 자체를 그리지 않는다.
   */
  progress?: number | null
  /** 맨 아래 꽉 찬 버튼 (ref `.pk-cta`) — 진짜 <button> 을 넘긴다 */
  cta: ReactNode
  /** 오른쪽 위 여백에 얹을 것 — 더보기 메뉴처럼 카드 안 또 다른 조작 */
  topRight?: ReactNode
  /** 닫혀있는 수업 — hover 를 죽이고 그림을 무채색으로 (ref `.pk-card-locked`) */
  locked?: boolean
}

/**
 * 학급 카드 — 레퍼런스 teacher.html `.pk-card` 이관.
 *
 * **세 화면이 이 하나를 쓴다**: 내 학급의 진행 중·닫혀있는 수업, 그리고 학급 선택.
 * ref 가 셋을 같은 틀로 통일했고("세 화면 카드가 같아진다"), 우리도 한 곳에서 그린다 —
 * 예전에는 내 학급만 옛 `.progress-card`(마스코트 + 큰 제목)를 쓰고 있어서 같은 학급이
 * 화면마다 다르게 보였다.
 *
 * **겉은 `<div>` 다.** ref 의 진행 중 카드는 겉이 `<button>` 이라 안쪽을 전부 `<span>` 으로
 * 짜야 했고, 그 때문에 "더보기" 아이콘 버튼이 빠졌다(중첩 button 은 HTML 위반).
 * ref 에서는 그 메뉴에 붙은 동작이 없어 손실이 없었지만 **우리는 학급 관리·수업 닫기·삭제가
 * 실제로 동작한다.** 그래서 ref 의 닫혀있는 카드와 같은 방식(`<div>` + 진짜 `<button>`)을 써서
 * 생김새는 ref 그대로 두고 기능을 지킨다.
 */
export function ClassTile({
  theme,
  pill,
  title,
  studentCount,
  progress,
  cta,
  topRight,
  locked,
}: ClassTileProps) {
  return (
    <div
      data-locked={locked ? true : undefined}
      style={{
        background: theme.art,
        borderColor: `color-mix(in srgb, ${theme.art} 84%, #000)`,
      }}
      className="relative flex min-h-[222px] flex-col overflow-hidden rounded-tile border-[1.5px] text-left transition-[transform,box-shadow] duration-200 ease-bounce hover:-translate-y-[3px] hover:shadow-[0_14px_28px_rgba(30,30,35,.12)] data-[locked=true]:hover:translate-y-0 data-[locked=true]:hover:shadow-none"
    >
      {/* ref .pk-art — 오른쪽 아래. bottom 은 CTA 높이(약 52px)보다 커야 버튼을 덮지 않는다 */}
      <img
        src={theme.img}
        alt=""
        aria-hidden="true"
        /*
          sj_1~6 은 크기가 제각각(438x467 ~ 453x464)이라 width/height 를 한 값으로 못 박는다
          (lib/classTile.ts). `loading="lazy"` 도 일부러 안 건다 — 학급 카드는 로그인 직후
          첫 화면의 주 콘텐츠라 늦게 받으면 LCP 가 밀린다.
        */
        decoding="async"
        data-locked={locked ? true : undefined}
        className="pointer-events-none absolute bottom-[54px] right-3.5 w-[46%] max-w-[152px] data-[locked=true]:opacity-60 data-[locked=true]:grayscale"
      />

      {/*
        ref .pk-pill — 흰 배경이라 그림 위에 얹혀도 읽힌다.
        폭을 94px 로 고정한다: 라벨 길이에 따라 흔들리면 카드를 나란히 놨을 때 알약 오른쪽 끝이
        들쭉날쭉해 보인다("5-6학년"이 실측 92px 로 가장 길다).
      */}
      <span
        style={{ color: theme.ink }}
        className="absolute left-4 top-[15px] z-2 flex min-w-[94px] items-center justify-center gap-1.5 rounded-full bg-white p-[7px_14px] text-[.9rem] font-black shadow-[0_2px_8px_rgba(30,30,35,.08)]"
      >
        <span className="h-2 w-2 flex-none rounded-full bg-current" aria-hidden="true" />
        {pill}
      </span>

      {/* 더보기 등 — 알약과 같은 줄 오른쪽. 그림(z-1)·알약(z-2) 위에 와야 눌린다 */}
      {topRight && <div className="absolute right-3 top-[15px] z-3">{topRight}</div>}

      {/* ref .pk-card-body — 알약 아래에서 시작하도록 위 패딩을 크게 준다(내 학급은 66px) */}
      <span className="relative z-1 flex min-w-0 flex-1 flex-col items-start p-[66px_18px_14px]">
        {/*
          학급 이름은 "3·4학년 복식반 국어"처럼 길 수 있어 두 줄까지 흘린 뒤 잘라 낸다
          (ref `#viewList .pk-card .pk-grade` — 1.4rem / 1.3 / line-clamp 2, 폭 상한 60%).

          **높이를 못박지 않는다.** 예전엔 2.6em(=1.3×2)으로 두 줄 자리를 미리 잡아 뒀는데,
          그러면 한 줄짜리 이름에도 빈 줄이 하나 붙어 카드가 ref 보다 29px 더 커진다.
          같은 줄에 선 카드끼리는 그리드가 이미 높이를 맞춰 주므로(align-items 기본 stretch)
          자리를 미리 잡을 이유가 없다 — ref 도 높이를 두지 않는다.
        */}
        <span className="line-clamp-2 max-w-[60%] text-[1.4rem] font-black leading-[1.3] tracking-[-.4px] text-ink">
          {title}
        </span>

        {studentCount !== undefined && (
          /* 줄 높이는 ref 처럼 글꼴 기본값(normal)이다 — index.css 가 전역으로 잡아 준다 */
          <span className="mt-[7px] flex items-center gap-1.5 text-[.85rem] font-extrabold text-ink-soft">
            <Icon name="students" className="h-[15px] w-[15px] flex-none" />
            학생 {studentCount}명
          </span>
        )}

        {/*
          ref .pk-card-prog — 막대는 글줄보다 짧게(46%). `mt-auto` 로 글 묶음 맨 아래에 붙여
          버튼 바로 위에 고정한다 — 제목이 한 줄이든 두 줄이든 막대 위치가 그대로여서
          카드끼리 어긋나지 않는다. `pt` 는 제목이 길어질 때의 최소 간격이다.
        */}
        {progress !== undefined && (
          <span className="mt-auto block w-full max-w-[46%] pt-3.5">
            <span className="mb-[5px] flex items-center justify-between gap-2 text-[.76rem] font-extrabold text-ink-soft">
              과제 진행률
              <b className="font-black text-ink">{progress === null ? '—' : `${progress}%`}</b>
            </span>
            <FillBar
              pct={progress ?? 0}
              className="h-1.5 bg-white/[.72]"
              fillStyle={{ background: theme.ink }}
            />
          </span>
        )}
      </span>

      {cta}
    </div>
  )
}

/** ref `.pk-cta` — 카드 폭을 끝까지 채운다 (카드의 overflow-hidden 이 아래 모서리를 깎는다) */
export function ClassTileCta({
  label,
  color,
  onClick,
}: {
  label: string
  /** 배경색 — 보통 테마의 `ink`. 닫혀있는 수업만 파랑(--primary)으로 눈이 가게 한다 */
  color: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ background: color }}
      className="relative flex w-full items-center justify-center p-[15px_18px] text-[1rem] font-black text-white transition-[filter] duration-200 hover:brightness-[1.06]"
    >
      {label}
      <Icon name="chevronRight" className="absolute right-5 h-[18px] w-[18px]" />
    </button>
  )
}
