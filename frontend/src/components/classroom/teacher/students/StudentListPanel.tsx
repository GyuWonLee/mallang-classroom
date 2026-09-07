import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'
import { Button } from '@/components/common/Button'
import { Icon, type IconName } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { SM_AVATAR_BG, SM_CHARS, type StudentWithMeta } from '@/lib/studentMeta'
import type { RosterRow } from '@/hooks/useStudentRoster'
import type { DetailTab } from './StudentDetailPanel'

/** 한 페이지 8행 — .sm-list 의 min-height 계산(42 + 70*8)과 같은 값이어야 한다 */
const PAGE_SIZE = 8

export type SortKey = 'name' | 'attend' | 'submit'
export type SortDir = 'asc' | 'desc'
export type RowAction = 'detail' | 'message' | 'settings' | 'password' | 'kick'

/**
 * 열마다 "처음 눌렀을 때" 기대되는 방향.
 *
 * 출석·제출률은 **낮은 쪽이 손이 가는 학생**이라 내림차순이 아니라 오름차순으로 시작한다.
 *
 * 한때 이 두 열로 정렬하는 걸 없앴던 적이 있다 — 그때는 값이 서버에 없어 `deriveStudent()` 가
 * 해시로 지어낸 것이라 **난수로 학생을 줄 세우고 있었기** 때문이다. 지금은 둘 다 실제
 * 엔드포인트에서 온다(`useStudentRoster`). 학습 성취(정답률)로 줄 세우는 것은 여전히 안 한다 —
 * 명세 §8 의 단일 이해도 점수 미노출.
 */
const DEFAULT_DIR: Record<SortKey, SortDir> = { name: 'asc', attend: 'asc', submit: 'asc' }

const ROW_MENU: { act: RowAction; label: string; icon: IconName; danger?: boolean }[] = [
  { act: 'detail', label: '학습 현황 보기', icon: 'list' },
  { act: 'message', label: '메시지 보내기', icon: 'chat' },
  { act: 'settings', label: '계정 설정 보기', icon: 'gear' },
  { act: 'password', label: '비밀번호 초기화', icon: 'key' },
  { act: 'kick', label: '학급에서 내보내기', icon: 'trash', danger: true },
]

/**
 * 표 4칸(이름 / 출석 / 제출률 / 관리) — ref `.sm-list` 의 `--sm-cols` 값 그대로다.
 * 60px 은 출석 점(26px) 자리이고, 1.6fr 은 제출률 막대 자리라 **내용과 짝이 맞는다.**
 * 최소폭 0 이라야 마지막 칸이 밖으로 밀리지 않는다.
 *
 * 학년·아이디는 이 표에 없다 — 오른쪽 상세 패널의 프로필 줄(`{학교} · {아이디}` + 학년 알약)이
 * 이미 보여준다. 목록은 "누구를 챙겨야 하나"를 훑는 자리라 이름·출석·제출률만 남긴다.
 */
const COLS = 'grid-cols-[minmax(0,2fr)_60px_minmax(0,1.6fr)_38px]'

/** 출석·제출률 막대/점 색 — 낮을수록 눈에 띄어야 한다 */
function band(v: number): 'low' | 'mid' | 'high' {
  if (v < 60) return 'low'
  return v < 80 ? 'mid' : 'high'
}
const DOT_TONE: Record<'low' | 'mid' | 'high', string> = {
  low: 'bg-danger-soft text-danger',
  mid: 'bg-task-soft text-task-deep',
  high: 'bg-success text-success-deep',
}
const BAR_TONE: Record<'low' | 'mid' | 'high', string> = {
  low: 'bg-danger',
  mid: 'bg-task-deep',
  high: 'bg-success-deep',
}

interface Props {
  /** 이 학급 전체 학생 (학년 필터 전) */
  students: StudentWithMeta[]
  grades: string[]
  grade: string | null
  onGradeChange: (grade: string) => void
  selectedId: number | null
  onSelect: (userId: number, tab?: DetailTab) => void
  onAction: (act: RowAction, student: StudentWithMeta) => void
  onInvite: () => void
  /**
   * 지금 고른 학년의 학생 **전원**을 생활통지표로 넘긴다.
   * 순서를 이 패널이 정한다 — 통지표의 '번호'는 서버에 출석번호 컬럼이 없어 목록 순서로
   * 매기는데, 정렬·검색·학년 필터를 아는 쪽은 여기뿐이다 (선택 강조를 여기서 고르는 것과 같은 이유).
   */
  onReportCards?: (students: StudentWithMeta[]) => void
  /** 출석·제출률 (useStudentRoster). 아직 못 받았으면 그 칸은 `—` 가 된다 */
  roster: Record<number, RosterRow>
  /**
   * 말랑이 대화에서 위험 신호가 잡힌 건수 — `학생 id -> 건수` (GET /classrooms/{id}/tutor-flags).
   *
   * 신호가 없는 학생은 키가 아예 없다. 목록에 표시를 붙이는 이유: 선생님이 학생마다 대화를
   * 열어 보지 않으므로, **먼저 눈에 띄어야** 그 아이를 들여다볼 계기가 생긴다.
   * 사유는 여기 적지 않는다 — 서버도 학급 단위 목록에서는 사유를 빼 준다(어깨 너머 노출 방지).
   */
  flags?: Record<number, number>
  /**
   * 위험 신호 배지를 눌렀을 때 — 그 학생의 표시된 대화를 여는 것은 페이지의 몫이다.
   *
   * 이 패널이 직접 모달을 열지 않는 이유: 대화를 받으려면 학급 id 가 필요한데 그건 페이지가
   * 들고 있고, 여기 다시 내려보내면 같은 값이 두 갈래로 흐른다.
   */
  onOpenFlags?: (student: StudentWithMeta) => void
}

/**
 * 학생 목록 패널 (ref .sm-panel) — 학년 모둠 탭 + 검색 + 정렬 + 8행 표 + 페이지네이션.
 *
 * 상세는 모달이 아니라 오른쪽 붙박이 패널이라, 행을 누르면 클릭 1번으로 목록↔상세를 오간다.
 */
export function StudentListPanel({
  students,
  grades,
  grade,
  onGradeChange,
  selectedId,
  onSelect,
  onAction,
  onInvite,
  onReportCards,
  roster,
  flags,
  onOpenFlags,
}: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [dir, setDir] = useState<SortDir>(DEFAULT_DIR.name)
  const [page, setPage] = useState(1)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  /** 같은 열을 다시 누르면 방향만 뒤집고, 다른 열이면 그 열의 기본 방향으로 시작한다 */
  function toggleSort(key: SortKey) {
    if (key === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(key)
      setDir(DEFAULT_DIR[key])
    }
  }

  // 학년·검색·정렬이 바뀌면 1페이지로 — 안 그러면 빈 페이지가 보인다
  useEffect(() => setPage(1), [grade, query, sort, dir])

  const list = filterSort(students, grade, query, sort, dir, roster)
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const rows = list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  /*
    선택된 학생이 없으면 **화면 맨 위 행**을 연다.

    이 일을 페이지가 하면 안 된다. 페이지는 서버가 준 명단 순서대로 첫 학생을 골랐는데,
    표시 순서는 여기서 이름순(기본)으로 정렬되므로 **하이라이트된 학생과 맨 위 학생이
    서로 달랐다.** 정렬·검색·학년 필터를 아는 쪽은 이 패널뿐이라 여기서 고른다.
    top 은 `rows[0]` — 정렬을 바꾸든 학년을 바꾸든 그때 눈에 보이는 첫 줄이다.
  */
  const top = rows[0]
  useEffect(() => {
    if (selectedId === null && top) onSelect(top.userId)
  }, [selectedId, top, onSelect])

  return (
    <div className="min-w-0 rounded-card bg-card shadow-card">
      {/*
        학년(모둠) 탭 — 복식학급이라 학년 수만큼 균등 분할된다.
        통지표 버튼을 **검색 툴바가 아니라 이 줄**에 둔다: 툴바는 `1fr auto 1fr` 격자라
        2단 배치(목록 폭 약 420px)에서 오른쪽 칸이 185px 밖에 안 돼 버튼 두 개가 위아래로
        접혔다. 이 줄은 폭을 통째로 쓰고, 버튼이 작용하는 대상(고른 학년)과도 나란히 있다.
      */}
      <div className="flex items-stretch border-b-2 border-track pt-1">
        <div className="flex min-w-0 flex-1 items-stretch" role="tablist" aria-label="학년 선택">
        {grades.map((g) => {
          const on = g === grade
          return (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onGradeChange(g)}
              data-active={on}
              className="relative flex-1 p-[16px_8px_14px] text-center text-[1rem] font-black text-ink-mute transition-colors hover:text-ink-soft data-[active=true]:text-primary data-[active=true]:after:absolute data-[active=true]:after:inset-x-0 data-[active=true]:after:-bottom-0.5 data-[active=true]:after:h-[3px] data-[active=true]:after:rounded-full data-[active=true]:after:bg-primary"
            >
              {g}
            </button>
          )
        })}
        </div>

        {/*
          통지표는 **지금 목록에 보이는 학생 전원**을 뽑는다 (정렬 순서 그대로, 페이지는 무시).
          검색 중이면 학년 전체가 아니라 걸러진 사람들이므로 라벨을 바꿔 말한다 —
          "3학년 전체"라고 해놓고 4명만 나오면 빠진 학생을 눈치채지 못한다.
        */}
        {onReportCards && (
          <div className="flex flex-none items-center py-1.5 pl-2 pr-4">
            <Button
              variant="ghost"
              size="sm"
              disabled={list.length === 0}
              onClick={() => onReportCards(list)}
            >
              <Icon name="doc" className="h-4 w-4" />
              {query.trim()
                ? `검색된 ${list.length}명 통지표`
                : `${grade ?? '학년'} 통지표 (${list.length}명)`}
            </Button>
          </div>
        )}
      </div>

      {/*
        ref 는 탭(.sm-tabs) 아래 목록 영역 전체를 #smPaneList(role="tabpanel") 한 겹으로 묶는다
        (teacher.html:2876). 툴바/표/페이저가 "지금 고른 학년의 화면"이라는 걸 보조기술에 알리는
        칸이라 스타일은 없지만 구조상 빠지면 안 된다.
      */}
      <div role="tabpanel" aria-label="학생 목록">
        {/* 툴바 — 검색은 가운데, 초대는 오른쪽 */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3.5 p-[12px_24px_8px] max-[900px]:grid-cols-1 max-[720px]:px-4">
          <div className="relative col-start-2 w-full max-w-[320px] justify-self-center max-[900px]:col-start-1 max-[900px]:max-w-none max-[900px]:justify-self-stretch">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="학생 이름을 검색하세요"
              autoComplete="off"
              aria-label="학생 이름으로 검색"
              /*
                글씨를 한 단계 줄이고 좌우 패딩도 좁혔다 — 2단 배치에서 이 칸이 좁아지면
                안내문("학생 이름을 검색하세요")이 끝에서 잘려 보였다.
              */
              className="min-h-11 w-full rounded-full border-2 border-canvas bg-canvas p-[12px_40px_12px_16px] text-[.84rem] font-semibold text-ink transition-colors placeholder:text-[.8rem] placeholder:font-medium placeholder:text-ink-mute focus:border-primary focus:outline-none"
            />
            <Icon
              name="search"
              className="pointer-events-none absolute right-[18px] top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-ink-mute"
            />
          </div>
          <div className="col-start-3 flex flex-wrap items-center gap-2.5 justify-self-end max-[900px]:col-start-1 max-[900px]:justify-end max-[900px]:justify-self-stretch">
            <Button size="sm" onClick={onInvite}>
              <Icon name="plus" className="h-4 w-4" />
              학생 초대
            </Button>
          </div>
        </div>

        {/* 목록 — 8행 높이를 미리 잡아 두어 마지막 페이지에서도 페이저가 같은 자리에 머문다 */}
        <div className="mt-2 min-h-[602px]">
          {list.length === 0 ? (
            /* ref smRenderList 의 빈 상태 아이콘은 #ic-students */
            <EmptyState
              icon="students"
              title={students.length ? '조건에 맞는 학생이 없어요' : '아직 등록된 학생이 없어요'}
              hint={
                students.length
                  ? '검색어나 학년 탭을 바꿔 보세요.'
                  : '위 “학생 초대” 버튼으로 학생을 등록해 보세요.'
              }
            />
          ) : (
            <>
              <div
                className={`grid ${COLS} items-center gap-2.5 border-b-2 border-b-track border-l-4 border-l-transparent p-[16px_24px_9px] text-[.78rem] font-extrabold text-ink-mute max-[720px]:hidden`}
              >
                <span>
                  <SortButton sortKey="name" sort={sort} dir={dir} onToggle={toggleSort} label="이름" />
                </span>
                <span className="text-center">
                  <SortButton sortKey="attend" sort={sort} dir={dir} onToggle={toggleSort} label="출석" />
                </span>
                <span>
                  <SortButton sortKey="submit" sort={sort} dir={dir} onToggle={toggleSort} label="제출률" />
                </span>
                {/* 행의 ⋯ 버튼 자리 — 제목("관리")은 없애고 칸만 남겨 행과 열 수를 맞춘다.
                    버튼마다 aria-label 이 있어 제목이 없어도 뜻은 전달된다. */}
                <span className="text-center" />
              </div>

              {rows.map((s, i) => (
                <StudentRow
                  key={s.userId}
                  student={s}
                  row={roster[s.userId]}
                  flagCount={flags?.[s.userId] ?? 0}
                  onOpenFlags={() => onOpenFlags?.(s)}
                  selected={s.userId === selectedId}
                  onSelect={() => onSelect(s.userId)}
                  menuOpen={openMenuId === s.userId}
                  onToggleMenu={() => setOpenMenuId((prev) => (prev === s.userId ? null : s.userId))}
                  onCloseMenu={() => setOpenMenuId(null)}
                  onAction={(act) => onAction(act, s)}
                  /* 아래쪽 행은 메뉴를 위로 펼친다 — 패널 밖으로 넘치지 않게 */
                  menuUp={i >= rows.length - 3 && rows.length > 3}
                />
              ))}
            </>
          )}
        </div>

        {/* 페이지가 1장이어도 높이를 유지해 패널 아래끝이 들썩이지 않게 한다 */}
        <div className="flex min-h-[74px] items-center justify-center gap-1.5 p-[16px_24px_20px] max-[720px]:px-4">
          {pages > 1 && (
            <>
              <PageButton
                disabled={current === 1}
                onClick={() => setPage(current - 1)}
                aria-label="이전 페이지"
              >
                <Icon name="back" className="h-[13px] w-[13px]" />
              </PageButton>
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <PageButton
                  key={p}
                  active={p === current}
                  onClick={() => setPage(p)}
                  aria-label={`${p}페이지`}
                  aria-current={p === current ? 'page' : undefined}
                >
                  {p}
                </PageButton>
              ))}
              <PageButton
                disabled={current === pages}
                onClick={() => setPage(current + 1)}
                aria-label="다음 페이지"
              >
                <Icon name="chevronRight" className="h-[13px] w-[13px]" />
              </PageButton>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── 조각 ─────────────────────────────────────────────────────── */

/**
 * 정렬 버튼 — 활성 열은 방향을 가리키는 쉐브론(아래), 비활성 열은 "정렬 가능"을 뜻하는
 * 양방향 아이콘이다. 위쪽 쉐브론 아이콘이 없어 오름차순은 회전으로 만든다 (ref .sort-arrow).
 */
function SortButton({
  sortKey,
  sort,
  dir,
  label,
  onToggle,
}: {
  sortKey: SortKey
  sort: SortKey
  dir: SortDir
  label: string
  onToggle: (key: SortKey) => void
}) {
  const on = sort === sortKey
  const dirLabel = dir === 'asc' ? '오름차순' : '내림차순'
  const next = dir === 'asc' ? '내림차순' : '오름차순'
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      data-on={on}
      data-asc={on && dir === 'asc'}
      aria-label={
        on ? `${label} ${dirLabel} 정렬 중 — 눌러서 ${next}으로` : `${label} 기준으로 정렬`
      }
      className="group inline-flex items-center gap-1 text-[.78rem] font-extrabold text-ink-mute transition-colors hover:text-primary data-[on=true]:text-primary"
    >
      {label}
      <Icon
        name={on ? 'chevronDown' : 'sort'}
        className="h-[11px] w-[11px] transition-[rotate] duration-200 group-data-[asc=true]:rotate-180"
      />
    </button>
  )
}

function StudentRow({
  student: s,
  row,
  flagCount,
  onOpenFlags,
  selected,
  onSelect,
  menuOpen,
  menuUp,
  onToggleMenu,
  onCloseMenu,
  onAction,
}: {
  student: StudentWithMeta
  row: RosterRow | undefined
  /** 위험 신호 건수. 0 이면 아무것도 그리지 않는다 */
  flagCount: number
  /** 위험 신호 배지를 눌렀을 때 — 그 학생의 표시된 대화를 연다 */
  onOpenFlags: () => void
  selected: boolean
  onSelect: () => void
  menuOpen: boolean
  menuUp: boolean
  onToggleMenu: () => void
  onCloseMenu: () => void
  onAction: (act: RowAction) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  // 바깥 클릭·ESC 로 닫기 — 열려 있는 동안만 듣는다
  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) onCloseMenu()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseMenu()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, onCloseMenu])

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${s.name} 학생 상세 보기`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      data-selected={selected}
      className={`grid ${COLS} h-[70px] cursor-pointer items-center gap-2.5 border-b border-b-canvas border-l-4 border-l-transparent p-[12px_24px] transition-colors last:border-b-0 hover:bg-canvas data-[selected=true]:border-l-primary data-[selected=true]:bg-sidebar-soft max-[720px]:h-auto max-[720px]:grid-cols-[auto_minmax(0,1fr)_40px] max-[720px]:gap-x-3 max-[720px]:gap-y-2.5 max-[720px]:p-[14px_14px_14px_16px] max-[720px]:[grid-template-areas:'name_name_menu'_'att_prog_prog']`}
    >
      <div className="flex min-w-0 items-center gap-[11px] max-[720px]:[grid-area:name]">
        <span
          className="grid h-[42px] w-[42px] flex-none place-items-center overflow-hidden rounded-full"
          style={{ background: SM_AVATAR_BG[s.charIdx] }}
          aria-hidden="true"
        >
          <img
            src={SM_CHARS[s.charIdx]}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-[34px] w-[34px] object-contain"
          />
        </span>
        {/* ref .sm-name-cell > .sm-name-body(min-width:0) > .sm-name — 줄이는 칸과 자르는 글자를 분리한다 */}
        <div className="min-w-0">
          <div className="truncate text-[1.12rem] font-black leading-[1.3]">{s.name}</div>
          {/*
            위험 신호 — 말랑이와의 대화에서 자해·폭력·괴롭힘 신호가 잡힌 건수.

            **무엇이 잡혔는지는 적지 않는다.** 목록은 교실에서 열어 두는 화면이라 아이들이
            지나며 볼 수 있고, 서버도 같은 이유로 학급 단위 응답에서 사유를 뺐다. 여기서는
            "이 아이 대화를 한번 보자"는 신호만 준다.

            **누르면 그 대화가 열린다.** 예전에는 그냥 글자였다 — 숫자는 보이는데 무엇이
            잡혔는지 볼 곳이 어디에도 없어서, 선생님이 알 수 있는 건 "뭔가 있다"뿐이었다.
            어른에게 알리려고 만든 기능이 정작 마지막 한 칸에서 끊겨 있던 셈이다.

            행 선택과 겹치지 않게 `stopPropagation` 한다 — 배지를 누른 건 대화를 보겠다는
            뜻이지 학생을 선택하겠다는 뜻이 아니다.

            색만으로 구분하지 않는다(DESIGN_GUIDELINES) — 아이콘과 글자를 함께 둔다.
          */}
          {flagCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenFlags()
              }}
              className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-danger-soft p-[2px_8px] text-[.72rem] font-black text-danger transition-opacity hover:opacity-80"
              title="말랑이와의 대화에서 살펴볼 신호가 있어요 — 눌러서 확인"
            >
              <Icon name="alert" className="h-3 w-3" />
              살펴보기 {flagCount}
            </button>
          )}
        </div>
      </div>

      {/*
        출석 — ref `.sm-att` 의 점(26px) 자리. **가장 최근 수업에 왔는지**를 O/X 로만 말한다.
        누적 비율(%)은 여기 적지 않는다 — 한 칸에 숫자가 들어가면 옆 제출률 막대와 숫자가
        겹쳐 읽혀 무엇을 보는 칸인지 흐려진다. 비율은 정렬의 2차 기준으로만 쓴다.
      */}
      <div className="flex items-center justify-center max-[720px]:justify-start max-[720px]:[grid-area:att]">
        {row?.lastAttended == null ? (
          <span className="text-[.8rem] font-extrabold text-ink-mute" title="아직 연 수업이 없어요">
            —
          </span>
        ) : (
          <span
            className={`grid h-[26px] w-[26px] flex-none place-items-center rounded-full text-[.95rem] font-black ${
              row.lastAttended ? DOT_TONE.high : DOT_TONE.low
            }`}
            title={row.lastAttended ? '최근 수업 출석' : '최근 수업 미출석'}
          >
            {row.lastAttended ? 'O' : 'X'}
            <span className="sr-only">{row.lastAttended ? '출석' : '미출석'}</span>
          </span>
        )}
      </div>

      {/* 제출률 — ref `.sm-prog`(막대 + 오른쪽 정렬 34px 숫자) */}
      <div className="flex min-w-0 items-center gap-[9px] max-[720px]:[grid-area:prog]">
        {row?.submitRate == null ? (
          <span className="text-[.82rem] font-black text-ink-mute">—</span>
        ) : (
          <>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
              <span
                className={`block h-full rounded-full transition-[width] duration-500 ${BAR_TONE[band(row.submitRate)]}`}
                style={{ width: `${row.submitRate}%` }}
              />
            </span>
            <span className="w-[40px] flex-none text-right text-[.82rem] font-black">
              {row.submitRate}%
            </span>
          </>
        )}
      </div>

      <div
        ref={menuRef}
        className="relative min-w-0 justify-self-center max-[720px]:[grid-area:menu]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          aria-label={`${s.name} 학생 관리 메뉴 열기`}
          onClick={onToggleMenu}
          className="grid h-[38px] w-[38px] place-items-center rounded-full text-ink-mute transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:bg-sky hover:text-primary"
        >
          <Icon name="more" className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            data-up={menuUp}
            className="absolute right-0 z-30 min-w-[186px] animate-fade-up rounded-[18px] bg-card p-2 shadow-card-lg data-[up=false]:top-[calc(100%+6px)] data-[up=true]:bottom-[calc(100%+6px)]"
          >
            {ROW_MENU.map((m) => (
              <button
                key={m.act}
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseMenu()
                  onAction(m.act)
                }}
                data-danger={!!m.danger}
                className="group flex min-h-11 w-full items-center gap-2.5 rounded-[14px] p-[11px_12px] text-left text-[.86rem] font-extrabold text-ink transition-colors hover:bg-canvas data-[danger=true]:text-danger data-[danger=true]:hover:bg-danger-soft"
              >
                <Icon
                  name={m.icon}
                  className="h-[15px] w-[15px] flex-none text-ink-mute group-data-[danger=true]:text-danger"
                />
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PageButton({
  active,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-active={!!active}
      className="grid h-[38px] min-w-[38px] place-items-center rounded-[14px] px-[11px] text-[.85rem] font-black text-ink-soft transition-colors enabled:hover:bg-canvas enabled:hover:text-primary disabled:cursor-default disabled:opacity-30 data-[active=true]:bg-primary data-[active=true]:text-white data-[active=true]:enabled:hover:bg-primary data-[active=true]:enabled:hover:text-white"
      {...props}
    >
      {children}
    </button>
  )
}

/* ── 필터·정렬 ────────────────────────────────────────────────── */

function filterSort(
  all: StudentWithMeta[],
  grade: string | null,
  query: string,
  sort: SortKey,
  dir: SortDir,
  roster: Record<number, RosterRow>,
): StudentWithMeta[] {
  let list = grade ? all.filter((s) => s.team === grade) : all.slice()
  const q = query.trim()
  if (q) list = list.filter((s) => s.name.includes(q) || s.username.includes(q))

  const byName = (a: StudentWithMeta, b: StudentWithMeta) => a.name.localeCompare(b.name, 'ko')
  /*
    출석 정렬은 화면에 보이는 값(O/X)이 기준이다 — 미출석(X)이 0 이라 오름차순이면 먼저 온다.
    같은 X 끼리는 **누적 출석률**로 한 번 더 가른다: 오늘만 빠진 학생보다 계속 빠지는 학생이
    위로 와야 챙길 순서가 맞는다.
  */
  const valueOf = (s: StudentWithMeta) => {
    const r = roster[s.userId]
    if (sort === 'submit') return r?.submitRate
    if (r?.lastAttended == null) return undefined
    return (r.lastAttended ? 1000 : 0) + (r.attendanceRate ?? 0)
  }

  const sign = dir === 'asc' ? 1 : -1
  list = list.slice()
  list.sort((a, b) => {
    if (sort === 'name') return sign * byName(a, b)
    const va = valueOf(a)
    const vb = valueOf(b)
    /*
      값이 없는 학생(아직 안 받아왔거나 조회 실패)은 **방향과 상관없이 항상 맨 뒤**다.
      부호를 같이 뒤집으면 내림차순일 때 `—` 만 잔뜩인 줄이 맨 위로 올라와, 정작 봐야 할
      낮은 출석률이 화면 밖으로 밀린다.
    */
    if (va == null && vb == null) return byName(a, b)
    if (va == null) return 1
    if (vb == null) return -1
    return sign * (va - vb) || byName(a, b)
  })
  return list
}
