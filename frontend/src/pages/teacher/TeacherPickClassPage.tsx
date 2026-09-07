import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '@/components/common/Icon'
import { FillBar } from '@/components/common/FillBar'
import { TeacherShell } from '@/components/classroom/teacher/TeacherShell'
import type { TeacherNavKey } from '@/components/classroom/teacher/TeacherSidebar'
import { useClassroomTileMeta } from '@/hooks/useClassroomTileMeta'
import { useClassroomsStore } from '@/stores/useClassroomsStore'
import { classTileTheme } from '@/lib/classTile'
import { gradeLabelOf } from '@/lib/subject'
import { fromState, teacherRoutes, type PickIntent } from '@/lib/routes'
import type { ManagedClassroom } from '@/types/teacher'
import { useTeacherPresence } from '@/hooks/useTeacherPresence'

/**
 * 학급 선택 화면 — 레퍼런스 teacher.html `viewPickClass`(2608-2640) 이관.
 *
 * 사이드바의 "과제 관리 / 학생 관리"는 어느 학급인지 정해져야 뜻이 있다. ref 는 이걸
 * **모달이 아니라 전체 화면**(배너 + 검색/정렬 + 학급 카드 그리드)으로 푼다 — 학급이 여러 개일 때
 * 이름만 나열된 좁은 목록보다 카드 그리드가 훨씬 고르기 쉽기 때문이다.
 *
 * 배너 그림/문구와 고른 뒤 갈 곳만 intent 로 갈린다 (ref PC_TARGETS, 5697-5702).
 */
const INTENT: Record<
  PickIntent,
  { nav: TeacherNavKey; title: string; sub: string[]; hero: string }
> = {
  students: {
    nav: 'students',
    title: '학생 관리',
    sub: ['학생을 관리할 학급을 선택해주세요', '학급별 학생 현황을 확인할 수 있어요!'],
    // ref .pk-hero-student — student_bg(교실 책상), --hero-push:106px
    hero: 'bg-[#F6E7C6] bg-[url("/assets/student_bg.webp")] bg-[position:center_bottom_-106px]',
  },
  assignments: {
    nav: 'assignments',
    title: '과제 관리',
    sub: ['과제를 관리할 학급을 선택해주세요', '학급별 과제 현황을 확인할 수 있어요!'],
    // ref .pk-hero-hw — hw_bg(나무 책상 위 공책), --hero-push:128px
    hero: 'bg-[#F2D4B0] bg-[url("/assets/hw_bg.webp")] bg-[position:center_bottom_-128px]',
  },
  overview: {
    nav: 'settings',
    title: '학급 설정',
    sub: ['설정할 학급을 선택해주세요', '학급 정보와 구성원을 관리할 수 있어요!'],
    hero: 'bg-[#F6E7C6] bg-[url("/assets/student_bg.webp")] bg-[position:center_bottom_-106px]',
  },
}

/*
  카드 테마는 `lib/classTile.ts` 의 `classTileTheme` 하나만 쓴다 — 내 학급 화면과 같은 학급이
  같은 색으로 보여야 한다. 예전엔 여기에 같은 표를 한 벌 더 두고 있었는데, 한쪽만 고치면
  두 화면의 색이 갈라진다 (실제로 webp 전환 때 여기만 고쳐져 잠시 어긋나 있었다).
*/

type SortKey = 'recent' | 'name' | 'students'

export function TeacherPickClassPage() {
  // 이 화면에 있는 동안에도 학생 질문을 받는다 (백엔드는 STOMP 접속을 온라인으로 본다)
  useTeacherPresence()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const raw = params.get('for')
  const intent: PickIntent = raw === 'assignments' || raw === 'overview' ? raw : 'students'
  const t = INTENT[intent]

  const classrooms = useClassroomsStore((s) => s.classrooms)
  const loaded = useClassroomsStore((s) => s.loaded)
  const load = useClassroomsStore((s) => s.load)
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  /** 카드의 "학생 N명 · 과제 진행률" — 내 학급 화면과 같은 조회를 쓴다 */
  const meta = useClassroomTileMeta(classrooms)

  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('recent')

  const list = useMemo(() => {
    const q = query.trim()
    const out = classrooms.filter((c) => !q || c.name.includes(q))
    const byName = (a: ManagedClassroom, b: ManagedClassroom) => a.name.localeCompare(b.name, 'ko')
    if (sortBy === 'name') out.sort(byName)
    // 학생 수를 아직 못 받은 학급은 0 으로 취급해 뒤로 간다
    else if (sortBy === 'students')
      out.sort((a, b) => (meta[b.id]?.students ?? 0) - (meta[a.id]?.students ?? 0) || byName(a, b))
    // 최신순은 서버가 준 순서 그대로 — 따로 정렬하지 않는다 (ref 와 동일)
    return out
  }, [classrooms, query, sortBy, meta])

  /*
    출발지(= 이 학급 선택 화면)를 실어 보낸다. 안 보내면 도착 화면의 뒤로가기가 fallback 인
    `classDetail` 로 가버려서, **학급에 들어간 적이 없는데 학급 안으로 들어가는** 꼴이 된다.
  */
  const here = fromState(location)
  function pick(id: string) {
    if (intent === 'students') return navigate(teacherRoutes.students(id), here)
    if (intent === 'assignments') return navigate(teacherRoutes.assignments(id), here)
    navigate(teacherRoutes.classManage(id, 'overview'), here)
  }

  return (
    <TeacherShell active={t.nav} topBar>
      {/* 헤더(셸이 얹는다) + 히어로 + 패널 셋이 이어 붙어 한 덩어리로 읽힌다 */}
      <>
        {/*
            ref .pk-hero — 위는 헤더, 아래는 학급 목록 패널과 붙으므로 네 모서리 다 각지게 둔다
            (위 둥근 모서리는 헤더 몫). 테두리는 좌·우만 맡는다.
          */}
        <div
          className={`relative min-h-[330px] overflow-hidden border-x-[1.5px] border-frame bg-cover bg-no-repeat max-[900px]:min-h-[210px] max-[900px]:bg-[position:right_bottom] ${t.hero}`}
        >
          {/*
              ref .pk-hero-student/-hw::before — 이 두 그림은 왼쪽에도 소품이 깔려 있어
              기본 스크림(.62)으로는 부제가 묻힌다. 더 진한 그라데이션으로 덮는다.
            */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,rgba(255,255,255,.94)_0%,rgba(255,255,255,.82)_26%,rgba(255,255,255,0)_54%)]"
          />
          <div className="relative z-1 p-[66px_46px_32px_60px] max-[900px]:p-[30px_26px]">
            <h1 className="text-[2.9rem] font-black leading-[1.15] tracking-[-1.2px] max-[900px]:text-[2.1rem]">
              {t.title}
            </h1>
            <p className="mt-3.5 text-[1.05rem] font-bold leading-[1.65] text-ink-soft">
              {t.sub[0]}
              <br />
              {t.sub[1]}
            </p>
          </div>
        </div>

        {/*
            ref .pk-panel — 히어로에 이어 붙는다. 테두리는 좌·우·아래를 맡아 헤더·히어로와
            이어진 한 줄이 된다. overflow-hidden 은 아래 패딩(22px)보다 큰 모서리 반지름(34px)
            밖으로 맨 아래 줄 카드가 삐져나오는 걸 잘라 낸다.
          */}
        <div className="overflow-hidden rounded-b-page border-x-[1.5px] border-b-[1.5px] border-frame bg-card p-[26px_28px_22px] shadow-card">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-[18px]">
            <h2 className="text-[1.45rem] font-black tracking-[-.3px]">
              담당 학급 <span className="text-ink-mute">({list.length})</span>
            </h2>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* ref .pk-search */}
              <div className="relative flex-none">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-[15px] top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="학급 이름으로 검색"
                  autoComplete="off"
                  aria-label="학급 이름으로 검색"
                  className="w-60 rounded-full border-[1.5px] border-track bg-card p-[11px_16px_11px_40px] text-[.9rem] font-semibold text-ink transition-colors placeholder:font-medium placeholder:text-ink-mute focus:border-primary focus:outline-none"
                />
              </div>
              {/* ref .pk-sort-wrap */}
              <div className="relative flex items-center">
                <Icon
                  name="sort"
                  className="pointer-events-none absolute left-[15px] h-4 w-4 text-ink-soft"
                />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  aria-label="정렬 순서"
                  className="cursor-pointer rounded-full border-[1.5px] border-track bg-card p-[11px_16px_11px_40px] text-[.9rem] font-extrabold text-ink focus:border-primary focus:outline-none"
                >
                  <option value="recent">최신순</option>
                  <option value="name">이름순</option>
                  <option value="students">학생 많은 순</option>
                </select>
              </div>
            </div>
          </div>

          {/* ref .pk-grid — 3열 / 1120px 2열 / 760px 1열 */}
          <div className="grid grid-cols-3 gap-5 max-[1120px]:grid-cols-2 max-[760px]:grid-cols-1">
            {list.length === 0 ? (
              <div className="col-span-full grid h-[170px] place-items-center rounded-card border-[1.5px] border-dashed border-track bg-[#FAFAFB] text-center text-[1.05rem] font-bold text-ink-mute">
                {query.trim() ? `'${query.trim()}' 검색 결과가 없어요` : '아직 담당 학급이 없어요'}
              </div>
            ) : (
              list.map((c) => {
                const th = classTileTheme(c.id)
                const m = meta[c.id]
                /*
                  알약과 제목은 **학급 설정의 담당 학년**(`grades`)을 쓴다 — 내 학급 카드와
                  같은 원천이라 두 화면이 같은 값을 말한다.

                  예전엔 학급 **이름의 첫 칸**을 잘라 썼다(`c.name.split(' ')[0]`). 이름이
                  "3·4학년 복식반 국어" 처럼 학년으로 시작할 때만 맞는 방식이라, 이름을
                  "우리반"·"국어교실" 로 지으면 학년 자리에 엉뚱한 낱말이 박혔다.
                  이름은 자유 문구이고 학년은 설정값이니, 학년을 말하는 자리엔 설정값을 쓴다.
                */
                const grade = gradeLabelOf(c.grades)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pick(c.id)}
                    aria-label={`${c.name} 입장하기`}
                    style={{
                      background: th.art,
                      borderColor: `color-mix(in srgb, ${th.art} 84%, #000)`,
                    }}
                    className="relative flex min-h-[222px] flex-col overflow-hidden rounded-tile border-[1.5px] text-left transition-[transform,box-shadow] duration-200 ease-bounce hover:-translate-y-[3px] hover:shadow-[0_14px_28px_rgba(30,30,35,.12)]"
                  >
                    {/* ref .pk-art — 오른쪽 아래, 아래 CTA(약 52px)를 덮지 않게 bottom:54 */}
                    <img
                      src={th.img}
                      alt=""
                      aria-hidden="true"
                      /*
                        sj_1~6 은 크기가 제각각이라 비율을 한 값으로 못 박는다 (lib/classTile.ts).
                        학급 카드는 이 화면의 주 콘텐츠라 lazy 는 걸지 않는다.
                      */
                      decoding="async"
                      className="pointer-events-none absolute bottom-[54px] right-3.5 w-[46%] max-w-[152px]"
                    />
                    {/*
                        ref .pk-pill — 흰 배경이라 그림 위에 얹혀도 읽힌다.
                        알약은 "진행중/수업없음" 같은 라이브 상태가 아니라 **학년**을 보여준다 —
                        내 학급 대시보드 카드와 같은 규칙이라 두 화면이 같은 언어로 읽힌다.
                        폭을 94px 로 고정한다: 라벨 길이에 따라 흔들리면 카드를 나란히 놨을 때
                        알약 오른쪽 끝이 들쭉날쭉해 보인다("5-6학년"이 실측 92px 로 가장 길다).
                      */}
                    <span
                      style={{ color: th.ink }}
                      className="absolute left-4 top-[15px] z-2 flex min-w-[94px] items-center justify-center gap-1.5 rounded-full bg-white p-[7px_14px] text-[.9rem] font-black shadow-[0_2px_8px_rgba(30,30,35,.08)]"
                    >
                      <span
                        className="h-2 w-2 flex-none rounded-full bg-current"
                        aria-hidden="true"
                      />
                      {grade}
                    </span>

                    <span className="relative z-1 flex min-w-0 flex-1 flex-col items-start p-[56px_18px_14px]">
                      {/*
                        카드의 대표 이름은 **선생님이 지은 학급 이름**(`c.name`)이다 — 내 학급
                        대시보드 카드(ClassProgressCard)와 같은 값이라 두 화면이 같은 것을 말한다.
                        학년은 왼쪽 위 알약이 이미 말하고 있어서 제목까지 학년이면 같은 말이
                        두 번 나오고, 정작 선생님이 붙인 이름은 어디에도 안 보였다.
                        긴 이름은 두 줄까지 보여주고 자른다(그림과 겹치지 않게 폭은 60%).
                      */}
                      <span className="line-clamp-2 max-w-[60%] break-keep text-[1.4rem] font-black leading-[1.3] tracking-[-.4px] text-ink">
                        {c.name}
                      </span>
                      {/* 학생 수는 제목을 받쳐 주는 줄이라 작게 — 내 학급 카드와 같은 크기 */}
                      <span className="mt-[7px] flex items-center gap-1.5 text-[.85rem] font-extrabold text-ink-soft">
                        <Icon name="students" className="h-[15px] w-[15px] flex-none" />
                        {m ? `학생 ${m.students}명` : `${c.grades.join('·')}학년`}
                      </span>

                      {/*
                          ref .pk-card-prog — 게시된 과제 전체의 "낸 사람 / 내야 할 사람".
                          낼 과제가 아직 없으면(null) 숫자 대신 "—" 를 두고 막대는 비워 둔다 —
                          0% 로 적으면 "다들 안 냈다"로 잘못 읽힌다.
                        */}
                      <span className="mt-auto block w-full max-w-[46%] pt-3.5">
                        <span className="mb-[5px] flex items-center justify-between gap-2 text-[.76rem] font-extrabold text-ink-soft">
                          과제 진행률
                          <b className="font-black text-ink">
                            {m?.progress == null ? '—' : `${m.progress}%`}
                          </b>
                        </span>
                        <FillBar
                          pct={m?.progress ?? 0}
                          className="h-1.5 bg-white/[.72]"
                          fillStyle={{ background: th.ink }}
                        />
                      </span>
                    </span>

                    {/* ref .pk-cta — 카드 폭을 끝까지 채운다 (카드의 overflow:hidden 이 모서리를 깎는다) */}
                    <span
                      style={{ background: th.ink }}
                      className="relative flex items-center justify-center p-[15px_18px] text-[1rem] font-black text-white"
                    >
                      입장하기
                      <Icon name="chevronRight" className="absolute right-5 h-[18px] w-[18px]" />
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </>
    </TeacherShell>
  )
}
