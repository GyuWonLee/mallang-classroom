/* React 의 KeyboardEvent 는 별칭으로 받는다 — 그대로 쓰면 DOM 의 전역 KeyboardEvent 를 가려
   document.addEventListener('keydown', …) 의 타입이 어긋난다 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyEvent,
  type ReactNode,
} from 'react'
import { Icon, type IconName } from '@/components/common/Icon'
import { SM_AVATAR_BG, SM_CHARS, type StudentWithMeta } from '@/lib/studentMeta'
import type { Roster } from '@/hooks/useStudentRoster'

/** 통계 칸의 톤 — 아이콘 배지 배경/글자색만 바꾼다 (새 색을 만들지 않는다) */
const TONES = {
  blue: 'bg-sidebar-soft text-primary',
  green: 'bg-success text-success-deep',
  yellow: 'bg-task-soft text-task-deep',
  red: 'bg-danger-soft text-danger',
  mint: 'bg-mint-bg text-mint-deep',
} as const

interface Stat {
  tone: keyof typeof TONES
  icon: IconName
  label: string
  /** 단위까지 포함한 문자열 — 못 받은 값은 `—` 라 숫자로 못 둔다 */
  value: string
  foot: string
  /** 누르면 그 숫자에 든 학생이 누구인지 펼쳐 보여준다 ('살펴볼 학생'만 쓴다) */
  expandable?: boolean
}

/**
 * 학생 관리 페이지 배너 — 제목 + 통계 5칸을 한 카드로 묶는다 (ref .sm-hero).
 * 칸 수는 ref 와 같은 5개로 고정이다 (예전엔 학년 수에 따라 3~4개로 흔들렸다).
 *
 * 배경 일러스트(bgbg.png)는 파일에 흰 여백과 밝은 테두리가 구워져 있어, 안쪽 파란 사각형
 * (원본 1995x788 중 x22~1972 · y116~657)만 남도록 크롭해서 깐다. 그러면 선반 라인이 흰 통계
 * 패널 윗변에 걸쳐 소품이 패널 위에 올라앉은 것처럼 보인다.
 *   ART_H(=사각형 높이) 기준 계수 — 박스폭 3.5996 · 배경 3.6808x1.4539 · 오프셋 -0.0406/-0.2140
 */
/*
  세로 위치는 **좌표로 잡지 않는다.** 그림을 제목 묶음의 아래변에 붙여(`bottom:0`) 그 아래변이
  곧 통계 패널 윗변이 되게 했다 — 아래 렌더 부분 주석 참고.

  예전엔 `ART_Y + ART_H = 178` 처럼 카드 위에서 잰 좌표로 맞췄는데, 178 이 위 요소들의 높이
  합이라 뒤로가기 버튼이 생기거나 글자 줄 높이가 바뀔 때마다 이음매가 어긋났다.
*/
/* ref `--art-h:185px` 그대로. 배너 높이를 손대면 이 값도 같이 움직여야 한다 —
   그림이 제목 묶음 아래변에 붙어 있어서, 배너만 얇게 하면 그림이 제목을 덮는다. */
const ART_H = 185

export function StudentsHero({
  students,
  classroomName,
  roster,
  back,
  onSelectStudent,
  className,
}: {
  students: StudentWithMeta[]
  /** 첫 칸 보조문구에 학급 이름을 넣는다 (ref smRenderStats 의 c.name). 아직 못 읽었으면 생략 */
  classroomName?: string
  /** 출석·제출률 집계 (useStudentRoster) */
  roster: Roster
  /** 배너 안 맨 위에 놓을 뒤로가기 버튼 (ref .sm-hero-back) */
  back?: ReactNode
  /** '살펴볼 학생' 명단에서 한 명을 고르면 — 오른쪽 상세 패널을 그 학생으로 연다 */
  onSelectStudent?: (userId: number) => void
  className?: string
}) {
  const total = students.length
  /** '살펴볼 학생' 명단을 펼쳤는지 */
  const [careOpen, setCareOpen] = useState(false)
  const careRef = useRef<HTMLDivElement>(null)

  /* 바깥을 누르거나 Esc 로 닫는다 (목록 행의 ⋯ 메뉴와 같은 규칙) */
  useEffect(() => {
    if (!careOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (!careRef.current?.contains(e.target as Node)) setCareOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCareOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [careOpen])

  /*
    ref 와 같은 **5칸**이되 숫자는 전부 서버에서 온다.

    예전 ref 5칸은 '출석 학생 / 미제출 학생 / AI 주의 학생 / 평균 학습 진도' 였는데, 그중 넷은
    서버에 없는 값을 `deriveStudent()` 가 해시로 지어낸 것이었다 — 선생님이 배너의 큰 숫자를
    사실로 읽는 자리라 가장 위험했다. 지금은 출석(attendance API)·제출률(과제별 제출자 명단)이
    실제로 있어서, 그 둘로 ref 의 자리를 메운다 (`useStudentRoster`).

    **정답률은 여기 두지 않는다.** 명세 §8 의 "단일 이해도 점수 미노출" 이라, 학습 성취는
    학급 관리의 이해도 탭(히트맵)과 오른쪽 상세 패널의 리포트가 맡는다.
    제출률은 "얼마나 냈나"라 성취가 아니므로 걸리지 않는다.
  */
  /** 아직 못 받아온 값은 `—` 로 둔다 — 0 으로 적으면 "아무도 안 왔다"로 읽힌다 */
  const pct = (v: number | null) => (v == null ? '—' : `${v}%`)
  /**
   * 챙겨야 할 학생 — 출석이든 제출이든 60% 미만.
   * **명단째로 들고 있는다**(예전엔 `.length` 만 셌다) — 숫자를 누르면 누구인지 펼쳐 보여준다.
   */
  const careList = students.filter((s) => {
    const r = roster.byStudent[s.userId]
    return (r?.attendanceRate ?? 100) < 60 || (r?.submitRate ?? 100) < 60
  })

  const cnt = (v: number | null) => (v == null ? '—' : `${v}명`)
  /** 전체 인원 대비 비율 — 명단이 비었으면 나눌 수 없다 */
  const share = (v: number | null) =>
    v == null || total === 0 ? null : Math.round((v / total) * 100)

  const stats: Stat[] = [
    {
      tone: 'blue',
      // ref smRenderStats 는 #ic-students (친구 아이콘 #ic-friends 가 아니다)
      icon: 'students',
      label: '학생 수',
      value: `${total}명`,
      foot: classroomName ?? '이 학급 전체',
    },
    {
      tone: 'green',
      icon: 'check',
      // 누적 비율이 아니라 **가장 최근 수업에 온 사람 수** 다 (ref 의 '출석 학생'과 같은 뜻)
      label: '출석 학생',
      value: cnt(roster.presentCount),
      /* 같은 숫자를 비율로도 적어 준다 — "3명"만 보면 그게 많은지 적은지 알 수 없다 */
      foot:
        roster.presentCount == null
          ? '아직 연 수업이 없어요'
          : `출석률 ${share(roster.presentCount) ?? 0}%`,
    },
    {
      tone: 'yellow',
      icon: 'book',
      label: '과제 미제출',
      value: cnt(roster.notSubmittedCount),
      /* 공개한 과제가 없을 때는 **아무 말도 적지 않는다**(자리는 위 `h-[17px]` 로 유지된다) —
         "아직 공개한 과제가 없어요" 는 옆 칸에서도 반복돼 줄만 늘렸다 */
      foot:
        roster.publishedCount == null
          ? '과제를 불러오는 중이에요'
          : roster.publishedCount === 0
            ? ''
            : `전체의 ${share(roster.notSubmittedCount) ?? 0}%`,
    },
    {
      tone: 'mint',
      icon: 'chart',
      /*
        '학습 진도' = 과제를 얼마나 진행했나(제출률)다. **정답률이 아니다** —
        명세 §8 이 학생당 단일 이해도 점수 노출을 막고, 학급 평균이라도 이 자리에 두면
        선생님이 "우리 반 실력"으로 읽는다. 이해도는 학급 관리의 히트맵이 맡는다.
      */
      label: '평균 학습 진도',
      value: pct(roster.submitRate),
      /* 한 학생의 진도가 아니라 **반 전체**를 낸 칸/내야 할 칸으로 잰 값이라고 밝힌다 */
      foot:
        roster.publishedCount == null
          ? '과제를 불러오는 중이에요'
          : roster.publishedCount === 0
            ? ''
            : `반 전체 ${pct(roster.submitRate)}`,
    },
    /* '살펴볼 학생'은 맨 끝이다 — 앞 네 칸이 현황이고, 이 칸만 **누르면 명단이 펼쳐지는** 칸이다 */
    {
      tone: 'red',
      icon: 'alert',
      label: '살펴볼 학생',
      value: `${careList.length}명`,
      foot: '출석·제출 60% 미만',
      expandable: true,
    },
  ]

  return (
    /*
      바깥 상자는 **배너 + 펼친 명단**을 한 덩어리로 묶는다. 배너 자신은 배경 사진을 자르려고
      `overflow-hidden` 이라, 명단을 그 안에 두면 아래로 내려오는 부분이 잘려 보이지 않았다 —
      그래서 자르지 않는 상자를 하나 더 두고 명단은 배너 **밖·아래**에 띄운다.
      `careRef` 도 이 상자다: 명단 안을 눌렀을 때 '바깥 클릭' 으로 오해해 닫히지 않게 한다.
    */
    <div ref={careRef} className={`relative mb-5 ${className ?? ''}`}>
      <div className="relative overflow-hidden rounded-[34px] bg-[#DFE5FA] p-5 max-[900px]:rounded-card max-[900px]:p-3.5">
        {/*
        그림은 **제목 묶음의 아래변에 붙인다**(`bottom:0`). 그 아래변이 곧 흰 통계 패널의
        윗변이라, 선반 라인이 패널 위에 정확히 걸린다.

        예전엔 카드 위쪽에서 잰 고정 좌표(`top: ART_Y`, ART_Y+ART_H=178)로 맞춰 뒀는데,
        그 178 은 **위 요소들의 높이 합**이라 글자 줄 높이가 조금만 달라져도 어긋났다
        (실제로 전역 line-height 를 ref 처럼 normal 로 바꾸자 그림이 패널을 23px 파고들었다).
        이제는 좌표가 아니라 구조가 이음매를 잡으므로 위쪽이 어떻게 바뀌든 따라온다.

        오른쪽 8px = ref `--art-x` 28px − 카드 패딩 20px (이 묶음은 패딩 안쪽이다).
      */}
        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 right-2 max-[900px]:hidden"
            style={{
              width: ART_H * 3.5996,
              height: ART_H,
              borderRadius: ART_H * 0.11,
              backgroundImage: "url('/assets/bgbg.webp')",
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${ART_H * 3.6808}px ${ART_H * 1.4539}px`,
              backgroundPosition: `${ART_H * -0.0406}px ${ART_H * -0.214}px`,
            }}
          />

          {/*
          뒤로가기 — 일러스트 위에 오도록 z-index 를 준다. 배너 자체 패딩(20px)이 카드 가장자리와의
          여백을 이미 잡아 주므로 아래 여백만 10px 준다 (ref .sm-hero-back).
        */}
          {back && <div className="relative z-1 mb-2.5">{back}</div>}

          {/*
        ref 는 `.sm-head`(gap 18px) 안에 `.sm-head-left`(gap 14px, min-width:0)를 한 겹 더 두고
        그 안에 아이콘 + 제목을 넣는다. 아이콘과 제목 사이 실제 간격은 바깥 18px 이 아니라
        **안쪽 14px** 이라서, 감싸는 칸을 빼면 제목이 4px 더 밀린다.
      */}
          {/* ref `.sm-head` — padding:10px 4px 42px / gap:18px (아래 42px 이 그림의 선반선 자리다) */}
          <div className="relative z-1 flex items-center gap-[18px] p-[10px_4px_42px] max-[900px]:p-[6px_4px_14px]">
            <div className="flex min-w-0 items-center gap-[14px]">
              <span
                className="grid h-[54px] w-[54px] flex-none place-items-center rounded-full bg-primary text-white shadow-[0_6px_16px_rgba(98,118,217,.32)]"
                aria-hidden="true"
              >
                <Icon name="sprout" className="h-7 w-7" />
              </span>
              <h1 className="text-[2.15rem] font-black leading-[1.3] tracking-[-.6px] max-[720px]:text-[1.6rem]">
                학생 관리
              </h1>
            </div>
          </div>
        </div>

        {/*
        반지름 = 바깥 배너 반지름 - 둘 사이 여백 (34-20 = 28-14 = 14)

        통계 5칸은 화면 폭에 상관없이 한 줄이고, 좁아지면 줄바꿈 대신 이 줄만 가로 스크롤한다.
        기준을 ref 의 680px 이 아니라 900px 로 올린 이유: 한 칸에 아이콘(48)+간격·패딩(45)이
        고정으로 들어가서, 태블릿 세로(768px)면 숫자 칸이 34px 밖에 안 남아 "88%" 같은
        쪼갤 수 없는 숫자가 옆칸으로 삐져나갔다. 132px 최소폭을 그 전에 걸어 준다.
      */}
        {/*
        칸 수가 학년 구성에 따라 3~4개로 달라진다(복식학급은 1~2학년). `grid-cols-5` 로 못박아
        두면 학년이 하나인 학급에서 빈 칸이 2개 남는다 — 실제 칸 수로 균등 분할한다.
        좁아지면 줄바꿈 대신 이 줄만 가로 스크롤한다(칸마다 아이콘+패딩이 고정폭이라
        태블릿에서 숫자가 옆칸으로 삐져나갔다).
      */}
        <div className="relative z-1">
          <div
            /* ref `.sm-stats` — padding:12px 4px / radius 14(=배너 34 − 여백 20) */
            className="grid rounded-[14px] bg-card p-[12px_4px] shadow-card max-[900px]:overflow-x-auto max-[900px]:pb-1.5"
            style={{
              gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`,
            }}
          >
            {stats.map((s) => (
              <div
                key={s.label}
                /* ref `.sm-stat` — padding:20px 16px / gap:13px, 900px 아래는 14px 12px / gap:10px */
                className="flex min-w-0 items-center gap-[13px] border-r-2 border-dashed border-track p-[20px_16px] last:border-r-0 max-[900px]:gap-2.5 max-[900px]:p-[14px_12px]"
                {...(s.expandable
                  ? {
                      role: 'button' as const,
                      tabIndex: 0,
                      'aria-expanded': careOpen,
                      'aria-label': `살펴볼 학생 ${careList.length}명 명단 ${careOpen ? '접기' : '펼치기'}`,
                      onClick: () => setCareOpen((v) => !v),
                      onKeyDown: (e: ReactKeyEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setCareOpen((v) => !v)
                        }
                      },
                      'data-open': careOpen,
                      className:
                        'flex min-w-0 cursor-pointer items-center gap-[13px] rounded-[10px] border-r-2 border-dashed border-track p-[20px_16px] transition-colors last:border-r-0 hover:bg-danger-soft/40 data-[open=true]:bg-danger-soft/60 max-[900px]:gap-2.5 max-[900px]:p-[14px_12px]',
                    }
                  : {})}
              >
                <span
                  className={`grid h-12 w-12 flex-none place-items-center rounded-2xl max-[900px]:h-[38px] max-[900px]:w-[38px] ${TONES[s.tone]}`}
                  aria-hidden="true"
                >
                  <Icon
                    name={s.icon}
                    className="h-[23px] w-[23px] max-[900px]:h-[19px] max-[900px]:w-[19px]"
                  />
                </span>
                <div className="min-w-0">
                  <div
                    data-red={s.tone === 'red'}
                    className="text-[.82rem] font-extrabold text-ink-soft data-[red=true]:text-danger max-[900px]:text-[.72rem]"
                  >
                    {s.label}
                  </div>
                  <div className="mt-px text-[1.6rem] font-black leading-[1.25] max-[900px]:text-[1.2rem]">
                    {s.value}
                  </div>
                  {/*
                    900px 아래는 칸이 132px 로 고정돼 보조 설명까지 넣을 자리가 없다.

                    **한 줄로 고정한다**(`h-[17px]` + `truncate`). 문구 길이가 칸마다 달라 두 줄로
                    접히면 그 칸만 키가 커지고, 흰 패널이 따라 늘어나면서 **옆 칸의 라벨·숫자
                    위치까지 밀렸다** — 값이 없는 칸이 하나 생기는 것만으로 배너가 흔들렸다.
                    문구가 없는 칸도 자리는 그대로 비워 둔다. 잘린 문구는 `title` 로 볼 수 있다.
                  */}
                  <div
                    title={s.foot}
                    className="mt-px h-[17px] truncate text-[.78rem] font-bold text-ink-mute max-[900px]:hidden"
                  >
                    {s.foot}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/*
        펼친 '살펴볼 학생' 명단 — 알림창처럼 **배너 아래로** 내려온다(배너 높이는 그대로).
        한 줄에 왜 걸렸는지(출석/제출 몇 %)를 함께 적는다 — 숫자만 보여주고 "누구"를 감추면
        선생님이 목록을 직접 훑어 찾아야 했다.
        명단이 길어지면 화면을 밀어내는 대신 **이 상자 안에서 스크롤**한다.
      */}
      {careOpen && (
        /*
          폭은 **통계 한 칸만큼**이고 자리도 그 칸(맨 오른쪽 '살펴볼 학생') 아래다 — 어느 숫자를
          누른 결과인지 위치로 알 수 있다. 배너 폭을 통계 칸 수로 나눠 쓰므로 칸 수가 달라져도
          따라온다. 명단은 한 줄씩 세로로 쌓고, 길어지면 이 상자 안에서 스크롤한다.
        */
        <div
          className="absolute right-0 top-full z-40 mt-2 max-h-[min(60vh,340px)] animate-fade-up overflow-y-auto rounded-[18px] border-2 border-track bg-card p-2.5 shadow-card-lg [scrollbar-gutter:stable]"
          style={{ width: `calc((100% - 40px) / ${stats.length})`, minWidth: 220 }}
        >
          <div className="mb-1.5 flex items-center gap-1.5 px-1">
            <Icon name="alert" className="h-[14px] w-[14px] flex-none text-danger" />
            <span className="text-[.78rem] font-black text-danger">
              살펴볼 학생 {careList.length}명
            </span>
            <button
              type="button"
              onClick={() => setCareOpen(false)}
              className="ml-auto grid h-7 w-7 place-items-center rounded-full text-ink-mute transition-colors hover:bg-canvas hover:text-ink"
              aria-label="명단 닫기"
            >
              <Icon name="close" className="h-[13px] w-[13px]" />
            </button>
          </div>

          {careList.length === 0 ? (
            <p className="break-keep p-[8px_4px_10px] text-[.82rem] font-bold text-ink-mute">
              지금은 출석·제출이 60% 미만인 학생이 없어요.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {careList.map((s) => {
                const r = roster.byStudent[s.userId]
                return (
                  <li key={s.userId}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectStudent?.(s.userId)
                        setCareOpen(false)
                      }}
                      /* 한 칸 폭(≈240px)에 들어가야 해서 줄을 촘촘히 — 줄 전체가 버튼이라
                         '상세 보기' 같은 꼬리말은 두지 않는다 */
                      className="flex w-full min-w-0 items-center gap-2 rounded-[12px] p-[6px_8px] text-left transition-colors hover:bg-canvas"
                      aria-label={`${s.name} 학생 상세 보기`}
                    >
                      <span
                        className="grid h-8 w-8 flex-none place-items-center overflow-hidden rounded-full"
                        style={{ background: SM_AVATAR_BG[s.charIdx] }}
                        aria-hidden="true"
                      >
                        <img
                          src={SM_CHARS[s.charIdx]}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-[25px] w-[25px] object-contain"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[.88rem] font-black">{s.name}</span>
                        {/* 값이 없으면 `—` 다 — 0% 로 적으면 "하나도 안 했다"는 단정이 된다 */}
                        <span className="block truncate text-[.72rem] font-bold text-ink-mute">
                          출석 {pct(r?.attendanceRate ?? null)} · 제출 {pct(r?.submitRate ?? null)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
