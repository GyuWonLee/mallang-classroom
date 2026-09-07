import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { Icon, type IconName } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { FillBar } from '@/components/common/FillBar'
import { Paginator } from '@/components/common/Paginator'
import { assignmentTheme } from './assignmentTheme'
import { DueDatePopover } from './DueDatePopover'
import { avgScore, submitRate } from '@/hooks/useAssignmentStats'
import { answerLabel } from '@/lib/problemAnswer'
import { deriveStudent, levelFill, levelOf, SM_AVATAR_BG, SM_CHARS } from '@/lib/studentMeta'
import { subjectImage } from '@/lib/subject'
import { BAND_LABEL, type AssignmentSubmissions, type Band } from '@/services/api/analyticsApi'
import type { AssignmentSummary } from '@/types/assignment'
import type { StudentAccount } from '@/types/teacher'

type Tab = 'summary' | 'students' | 'questions' | 'settings'

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'summary', label: '요약', icon: 'home' },
  { key: 'students', label: '학생별 현황', icon: 'students' },
  { key: 'questions', label: '문항 분석', icon: 'list' },
  { key: 'settings', label: '과제 설정', icon: 'gear' },
]

/** ref `.ag-stat.tone-*` — 타일 배경과 숫자·아이콘 색 */
const TILE = {
  blue: 'bg-[#EAF3FD] [&_b]:text-[#3D77C2] [&_.ico]:text-[#3D77C2]',
  green: 'bg-[#ECF7EC] [&_b]:text-[#3E8E52] [&_.ico]:text-[#3E8E52]',
  red: 'bg-danger-soft [&_b]:text-danger [&_.ico]:text-danger',
  violet: 'bg-[#F2EFFC] [&_b]:text-primary [&_.ico]:text-primary',
} as const

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/**
 * 과제 상세 — 레퍼런스 teacher.html `.ag-detail`.
 *
 * 제목·탭·타일·분석을 **한 장의 흰 카드** 안에 담는다 (전에는 조각마다 카드였는데 넷이 나란히
 * 뜨니 화면이 잘게 갈려 보였다 — ref 주석). 탭 넷은 밑줄형이고 폭을 균등하게 나눠 갖는다.
 *
 * 모든 숫자는 `GET /assignments/{id}/submissions` 하나에서 나온다.
 * ref 의 "AI 분석" 카드는 만들지 않았다 — 과제별 코멘트를 주는 API 가 없어서, 문장을 지어내면
 * 선생님이 사실로 읽는 자리에 거짓이 들어간다.
 */
export function AssignmentDetailPanel({
  assignment,
  stats,
  students,
  onEdit,
  onRename,
  onSetDue,
  onOpenProblem,
  onDelete,
  onTogglePublish,
}: {
  assignment: AssignmentSummary
  stats?: AssignmentSubmissions
  /** 학급 명단 — 미제출자는 id 로만 오므로 이름을 여기서 맞춘다 */
  students: StudentAccount[]
  /** 문항 보기·수정 (과제 설정 탭의 버튼) */
  onEdit: () => void
  /** 제목만 바꾼다 — 실패하면 던져서 편집 상태를 유지한다 */
  onRename: (title: string) => Promise<void>
  /** 마감일 — `2026-08-12T23:59:00` 꼴. 실패하면 던져서 달력을 열어 둔다 */
  onSetDue: (dueAt: string) => Promise<void>
  /** 문항 하나를 크게 본다 (문항 분석 탭 → 다시 짚어줄 문항 카드) */
  onOpenProblem: (no: number) => void
  onDelete: () => void
  onTogglePublish: (publish: boolean) => void
}) {
  const [tab, setTab] = useState<Tab>('summary')
  const th = assignmentTheme(assignment.subject)
  const rate = submitRate(stats)
  const avg = avgScore(stats)

  /* 제목 이름 바꾸기 — 연필로 열고, 저장하면 목록·상세가 함께 갱신되도록 부모에게 알린다 */
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(assignment.title)
  const [renameBusy, setRenameBusy] = useState(false)

  function cancelRename() {
    setRenaming(false)
    setDraft(assignment.title)
  }

  /* 마감일 — 머리글의 '마감 없음' 글씨를 누르면 그 아래로 달력이 내려온다 */
  const [dueOpen, setDueOpen] = useState(false)
  const [dueBusy, setDueBusy] = useState(false)

  async function saveDue(iso: string) {
    setDueBusy(true)
    try {
      await onSetDue(iso)
      setDueOpen(false)
    } catch {
      /* 실패하면 열어 둔다 — 고른 날짜를 잃지 않게 (부모가 토스트로 알린다) */
    } finally {
      setDueBusy(false)
    }
  }

  async function saveTitle() {
    const title = draft.trim()
    // 안 바뀌었으면 요청을 보내지 않는다 — 저장 토스트만 뜨고 서버는 그대로인 게 더 헷갈린다
    if (title === '' || title === assignment.title) return cancelRename()
    setRenameBusy(true)
    try {
      await onRename(title)
      setRenaming(false)
    } finally {
      setRenameBusy(false)
    }
  }

  /** 정답률이 낮은 순 — "가장 많이 틀린 문제"와 "틀린 문제 TOP 3" 의 원천 */
  const hardest = useMemo(() => {
    if (!stats) return []
    return stats.problems
      .filter((p) => p.accuracy !== null)
      .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
  }, [stats])

  return (
    /*
      세로 flex 기둥 — 이 패널은 왼쪽 목록 패널 높이에 맞춰 늘어난다(.ag-body 가 stretch).
      내용이 짧으면 아래가 비어 보이므로, 탭 본문이 남는 높이를 먹게 해서 바닥까지 채운다.
    */
    <section
      aria-label="과제 상세"
      className="flex min-w-0 flex-col rounded-card border-[1.5px] border-frame bg-card p-[24px_26px_26px] shadow-card"
    >
      {/* ref .ag-d-head — 과목 알약 / 제목 + 수정 / 메타 줄, 오른쪽에 마스코트 */}
      <div className="relative flex items-center gap-[18px]">
        <div className="min-w-0 flex-1 pr-[150px] max-[900px]:pr-0">
          <span
            style={{ background: th.ink }}
            className="mb-2 inline-flex items-center rounded-full p-[6px_15px] text-[.84rem] font-black text-white"
          >
            {th.label}
          </span>
          {/*
            연필은 **제목 이름 바꾸기**다. 예전엔 문항 모달을 열었는데, 제목 옆 연필은
            "이 제목을 고친다"로 읽히는 자리라 눌러 보면 엉뚱한 창이 떴다.
            문항을 보고 고치는 길은 아래 '과제 설정' 탭에 그대로 있다.
          */}
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void saveTitle()
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && cancelRename()}
                aria-label="과제 이름"
                className="min-w-0 flex-1 rounded-2xl border-2 border-primary bg-card p-[6px_12px] text-[1.6rem] font-black tracking-[-.5px] text-ink outline-none"
              />
              <button
                type="submit"
                disabled={renameBusy || draft.trim() === ''}
                aria-label="이름 저장"
                className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full bg-primary text-white transition-colors disabled:opacity-40"
              >
                <Icon name="check" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={cancelRename}
                aria-label="이름 바꾸기 취소"
                className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full text-ink-mute transition-colors hover:bg-canvas"
              >
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-keep text-[1.6rem] font-black tracking-[-.5px]">
                {assignment.title}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setDraft(assignment.title)
                  setRenaming(true)
                }}
                aria-label="과제 이름 바꾸기"
                className="grid h-[34px] w-[34px] place-items-center rounded-full text-ink-mute transition-colors hover:bg-sky hover:text-primary"
              >
                <Icon name="edit" className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="mt-[13px] flex flex-wrap items-center gap-[18px] text-[.9rem] font-bold text-ink-soft">
            {/*
              마감은 **읽기만 하는 글씨가 아니다** — 여기서 바로 고친다. 과제를 만드는 어느
              경로에도 마감 입력이 없어서, 이 글씨는 늘 '마감 없음'만 적고 있었다.
              `relative` 는 아래 달력의 위치 기준이다.
            */}
            <span className="relative flex items-center">
              <button
                type="button"
                onClick={() => setDueOpen((v) => !v)}
                aria-expanded={dueOpen}
                data-on={dueOpen}
                /* 밑줄은 "이 글씨를 누를 수 있다"는 표시 — 옆의 두 칸(대상·공개)과 구별된다 */
                className="-m-1 flex items-center gap-1.5 rounded-full p-1 underline decoration-track decoration-2 underline-offset-[3px] transition-colors hover:text-primary hover:decoration-primary data-[on=true]:text-primary data-[on=true]:decoration-primary"
              >
                <Icon name="clock" className="h-4 w-4 flex-none text-ink-mute" />
                {assignment.dueAt ? `${fmtWhen(assignment.dueAt)} 마감` : '마감 없음'}
                <Icon name="edit" className="h-3 w-3 flex-none opacity-60" />
              </button>
              {dueOpen && (
                <DueDatePopover
                  value={assignment.dueAt}
                  busy={dueBusy}
                  onPick={(iso) => void saveDue(iso)}
                  onClose={() => setDueOpen(false)}
                />
              )}
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="students" className="h-4 w-4 flex-none text-ink-mute" />
              {stats ? `${stats.totalStudents}명 대상` : '대상 미정'}
            </span>
            <span className="flex items-center gap-1.5">
              <Icon
                name={assignment.published ? 'check' : 'lock'}
                className="h-4 w-4 flex-none text-ink-mute"
              />
              {assignment.published ? '공개' : '비공개'}
            </span>
          </div>
        </div>
        <img
          src={th.art}
          alt=""
          aria-hidden="true"
          /* th.art 는 subjectImage() — 과목 그림 5장 모두 424x386 (assignmentTheme.ts) */
          width={424}
          height={386}
          decoding="async"
          className="pointer-events-none absolute -right-1 -top-2.5 z-0 h-auto w-[164px] max-[900px]:hidden"
        />
      </div>

      {/*
        ref .ag-d-tabbar — 밑줄형 탭. 배경(--card)과 z-index 는 위 마스코트의 발을
        이 바 "뒤로" 감추기 위한 것이다 (배경이 투명하면 발이 바를 뚫고 보인다).
      */}
      <div
        role="tablist"
        className="relative z-1 mb-5 mt-[18px] flex items-stretch gap-1.5 border-y-2 border-track bg-card pt-2.5"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            data-on={tab === t.key}
            className="relative -mb-0.5 inline-flex min-w-0 flex-1 items-center justify-center gap-[7px] whitespace-nowrap border-b-[2.5px] border-transparent p-[12px_8px_13px] text-[.9rem] font-extrabold text-ink-mute transition-colors hover:text-ink-soft data-[on=true]:border-primary data-[on=true]:text-primary"
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/*
        결과를 보여주는 세 탭(요약·학생별·문항)은 **공개된 과제에만** 뜻이 있다 — 미공개면
        제출이 있을 수 없으니 0% 를 그리는 대신 왜 비었는지 말한다.
        설정 탭은 그 관문 밖에 둔다: 미공개 과제를 공개하러 들어오는 곳이 바로 여기다.
      */}
      {/* flex-1 — 활성 탭 본문이 패널의 남는 높이를 받아 바닥까지 채운다 */}
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'settings' ? (
          <SettingsTab
            assignment={assignment}
            onEdit={onEdit}
            onDelete={onDelete}
            onTogglePublish={onTogglePublish}
          />
        ) : !assignment.published ? (
          <EmptyState
            icon="lock"
            title="아직 공개하지 않은 과제예요"
            hint="공개하면 학생 제출과 결과가 여기에 모여요. “과제 설정” 탭에서 공개할 수 있어요."
            className="min-h-[240px] flex-1"
          />
        ) : !stats ? (
          <EmptyState
            icon="chart"
            title="결과를 불러오지 못했어요"
            hint="잠시 후 다시 열어 주세요."
            className="min-h-[240px] flex-1"
          />
        ) : (
          <>
            {tab === 'summary' && (
              <SummaryTab
                stats={stats}
                students={students}
                rate={rate}
                avg={avg}
                hardest={hardest}
                onGo={setTab}
              />
            )}
            {tab === 'students' && <StudentsTab stats={stats} students={students} />}
            {tab === 'questions' && (
              <QuestionsTab stats={stats} onOpenProblem={onOpenProblem} />
            )}
          </>
        )}
      </div>
    </section>
  )
}

/* ── 요약 ─────────────────────────────────────────────── */
function SummaryTab({
  stats,
  students,
  rate,
  avg,
  hardest,
  onGo,
}: {
  stats: AssignmentSubmissions
  students: StudentAccount[]
  rate: number | null
  avg: number | null
  hardest: AssignmentSubmissions['problems']
  onGo: (t: Tab) => void
}) {
  const worst = hardest[0]
  const notSubmitted = stats.notSubmittedStudentIds.length

  /*
    미제출 명단은 **이 자리에서 펼쳐 본다** — 예전에는 '확인하기'가 '학생별 현황' 탭으로
    화면을 갈아 버려서, 이름 몇 개를 보려고 요약을 떠나야 했고 돌아오는 길도 따로 눌러야 했다.
    학생 관리 배너의 '살펴볼 학생'과 같은 방식(타일 아래로 내려오는 알림창)이다.
  */
  const [missingOpen, setMissingOpen] = useState(false)
  const missingRef = useRef<HTMLDivElement>(null)

  /* 바깥을 누르거나 Esc 로 닫는다 (StudentsHero 의 명단과 같은 규칙) */
  useEffect(() => {
    if (!missingOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (!missingRef.current?.contains(e.target as Node)) setMissingOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMissingOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [missingOpen])

  /** 미제출자는 id 로만 오므로 학급 명단에서 이름·학년·아바타를 맞춘다 (없으면 id 로 둔다) */
  const missing = useMemo(
    () =>
      stats.notSubmittedStudentIds.map((id) => {
        const acc = students.find((x) => x.userId === id)
        const meta = acc ? deriveStudent(acc) : null
        return {
          id,
          name: acc?.name ?? `학생 ${id}`,
          grade: acc?.grade,
          charIdx: meta?.charIdx ?? null,
        }
      }),
    [stats, students],
  )

  return (
    /* 세로 기둥 — 타일 줄은 제 높이만 쓰고, 아래 두 카드가 남는 높이를 나눠 갖는다 */
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ref .ag-stats — 색 타일 4개 */}
      <div className="grid flex-none grid-cols-4 gap-3 max-[1040px]:grid-cols-2">
        <Tile
          tone="blue"
          icon="doc"
          label="제출률"
          value={rate === null ? '—' : `${rate}%`}
          sub={`${stats.submittedCount}명 / ${stats.totalStudents}명 제출`}
        />
        <Tile
          tone="green"
          icon="grade"
          label="평균 점수"
          value={avg === null ? '—' : `${avg}점`}
          sub={avg === null ? '아직 채점된 제출이 없어요' : '100점 만점'}
        />
        <Tile
          tone="red"
          icon="alert"
          label="가장 많이 틀린 문제"
          value={worst ? `${worst.no}번` : '—'}
          sub={worst ? `${100 - (worst.accuracy ?? 0)}% 틀림` : '집계할 풀이가 없어요'}
        />
        <Tile
          tone="violet"
          icon="students"
          label="미제출 학생"
          value={`${notSubmitted}명`}
          wrapRef={missingRef}
          link={
            notSubmitted > 0
              ? {
                  label: missingOpen ? '접기' : '확인하기',
                  onClick: () => setMissingOpen((v) => !v),
                  expanded: missingOpen,
                }
              : undefined
          }
          panel={
            missingOpen && (
              /*
                타일 아래로 내려오는 알림창 — 타일 폭보다 좁으면 이름이 잘리므로 최소 폭을 두고,
                오른쪽 끝을 타일에 맞춘다(4번째 칸이라 왼쪽으로 자라야 화면을 넘지 않는다).
                명단이 길어지면 화면을 밀어내는 대신 이 상자 안에서 스크롤한다.
              */
              <div className="absolute right-0 top-full z-40 mt-2 max-h-[min(60vh,320px)] min-w-[240px] max-w-[320px] animate-fade-up overflow-y-auto rounded-[18px] border-2 border-track bg-card p-2.5 shadow-card-lg [scrollbar-gutter:stable]">
                <div className="mb-1.5 flex items-center gap-1.5 px-1">
                  <Icon name="alert" className="h-[14px] w-[14px] flex-none text-primary" />
                  <span className="text-[.78rem] font-black text-primary">
                    미제출 학생 {missing.length}명
                  </span>
                  <button
                    type="button"
                    onClick={() => setMissingOpen(false)}
                    className="ml-auto grid h-7 w-7 place-items-center rounded-full text-ink-mute transition-colors hover:bg-canvas hover:text-ink"
                    aria-label="명단 닫기"
                  >
                    <Icon name="close" className="h-[13px] w-[13px]" />
                  </button>
                </div>

                <ul className="flex flex-col gap-1">
                  {missing.map((s) => (
                    <li
                      key={s.id}
                      className="flex min-w-0 items-center gap-2 rounded-[12px] p-[6px_8px]"
                    >
                      <span
                        className="grid h-8 w-8 flex-none place-items-center overflow-hidden rounded-full bg-canvas"
                        style={
                          s.charIdx === null ? undefined : { background: SM_AVATAR_BG[s.charIdx] }
                        }
                        aria-hidden="true"
                      >
                        {s.charIdx === null ? (
                          <Icon name="students" className="h-4 w-4 text-ink-mute" />
                        ) : (
                          <img
                            src={SM_CHARS[s.charIdx]}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-[25px] w-[25px] object-contain"
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[.88rem] font-black">{s.name}</span>
                        {s.grade !== undefined && (
                          <span className="block truncate text-[.72rem] font-bold text-ink-mute">
                            {s.grade}학년
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                {/*
                  탭으로 가는 길은 남겨 둔다 — 점수·제출 시각까지 보려면 '학생별 현황'이 필요하다.
                  다만 이제는 **누르는 사람이 고르는** 길이고, 이름만 볼 때는 화면이 그대로다.
                */}
                <button
                  type="button"
                  onClick={() => {
                    setMissingOpen(false)
                    onGo('students')
                  }}
                  className="mt-1.5 inline-flex w-full items-center justify-center gap-0.5 rounded-[12px] p-[7px_8px] text-[.82rem] font-extrabold text-ink-mute transition-colors hover:bg-canvas hover:text-primary"
                >
                  학생별 현황에서 자세히 보기
                  <Icon name="chevronRight" className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          }
        />
      </div>

      {/*
        ref .ag-d-cols — 왼쪽 "학생 풀이 분석", 오른쪽 "AI 분석". 1040px 아래는 한 열로.

        **높이를 늘리지 않는다.** 한때 `flex-1` 로 패널의 남는 높이를 채우게 했는데, 1열로 접히는
        폭에서는 두 카드가 각자 자기 내용만큼만 커져 **서로 높이가 달라 보였다**. 지금은 ref 처럼
        내용 높이로만 서고, 2열일 때는 그리드 기본 stretch 가 둘을 같은 높이로 맞춘다.
        아래에 남는 공간은 비워 둔다 — 카드를 늘려 채우면 크기가 화면마다 달라진다.
      */}
      <div className="mt-[18px] grid grid-cols-2 gap-4 max-[1040px]:grid-cols-1">
        {/*
          ref .ag-d-sub — 카드 안의 안쪽 카드라 그림자 없이 테두리만.

          `min-h-[210px]` 은 **ref 에서 내용이 다 찼을 때(틀린 문제 TOP 3)의 높이**다(실측).
          결과가 아직 없어도 그 자리를 그대로 잡아 둬야 카드가 쪼그라들지 않고, 데이터가
          들어오는 순간 크기가 튀지 않는다. 넘치면 그때만 늘어난다.
        */}
        <div className="flex min-h-[210px] flex-col rounded-card border-[1.5px] border-track p-[20px_22px]">
          <div className="mb-3.5 flex items-center justify-between gap-2.5">
            <h3 className="text-[1.12rem] font-black">학생 풀이 분석</h3>
            <button
              type="button"
              onClick={() => onGo('questions')}
              className="inline-flex items-center gap-0.5 text-[.84rem] font-extrabold text-ink-mute transition-colors hover:text-primary"
            >
              자세히 보기
              <Icon name="chevronRight" className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mb-3 text-[.84rem] font-extrabold text-ink-soft">틀린 문제 TOP 3</p>
          {hardest.length === 0 ? (
            /* 2열일 때 옆 카드 높이에 맞춰 늘어나므로, 안내문은 그 안에서 가운데에 둔다 */
            <p className="my-auto grid place-items-center py-[22px] text-center text-[.9rem] font-bold text-ink-mute">
              아직 제출된 풀이가 없어요
            </p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {hardest.slice(0, 3).map((p, i) => {
                const wrong = 100 - (p.accuracy ?? 0)
                return (
                  <div key={p.no} className="flex items-center gap-2.5">
                    <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-primary text-[.72rem] font-black text-white">
                      {i + 1}
                    </span>
                    <span className="w-[68px] flex-none text-[.86rem] font-extrabold">
                      {p.no}번 문제
                    </span>
                    <FillBar pct={wrong} className="h-2 flex-1" fillClassName="bg-danger" />
                    <span className="w-10 flex-none text-right text-[.84rem] font-black text-ink-soft">
                      {wrong}%
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <ConceptNote stats={stats} />
      </div>
    </div>
  )
}

/**
 * 개념 한 줄 — 레퍼런스 `.ag-ai-note` 자리.
 *
 * ref 는 "이번 과제에서 학생의 63%가 분수 통분 개념을 어려워했어요" 를 보여주지만, 그 값은
 * 목업 데이터(`a.aiPct`/`a.aiText`)에 손으로 넣어 둔 것이고 **문장을 만들어 주는 API 는 없다.**
 * (`reportApi` 는 학생 1명 기준이고 학급의 모든 과제를 합쳐서 내려주므로 과제 하나의 코멘트로
 * 쓸 수 없다.)
 *
 * 그래서 문장을 지어내는 대신 **이 과제의 실제 숫자로 계산한다**: 문항마다 붙어 오는
 * `conceptTags` 로 개념별 정답률을 묶고, 가장 낮은 개념과 그 오답률을 그대로 적는다.
 * 말하는 내용은 ref 와 같고, 숫자는 사실이다.
 */
function ConceptNote({ stats }: { stats: AssignmentSubmissions }) {
  const weakest = useMemo(() => {
    /* 개념별로 풀이 수(n)를 가중해 합친다 — 문항 정답률의 단순 평균은 표본 1개짜리 문항에 끌려간다 */
    const byTag = new Map<string, { correct: number; total: number }>()
    for (const p of stats.problems) {
      if (p.accuracy === null || p.n === 0) continue
      for (const tag of p.conceptTags ?? []) {
        const cur = byTag.get(tag) ?? { correct: 0, total: 0 }
        cur.correct += (p.accuracy / 100) * p.n
        cur.total += p.n
        byTag.set(tag, cur)
      }
    }
    const rows = [...byTag.entries()]
      .map(([tag, v]) => ({ tag, accuracy: Math.round((v.correct / v.total) * 100) }))
      .sort((a, b) => a.accuracy - b.accuracy)
    return rows[0] ?? null
  }, [stats])

  return (
    /*
      ref .ag-d-sub — 왼쪽 "학생 풀이 분석"과 **같은 테두리 카드**다. 안에 제목 줄 + 파란 블록.
      최소 높이도 왼쪽과 같은 210px(ref 가 다 찼을 때의 높이) — 둘이 나란히 서므로 빈 상태에서도
      크기가 어긋나면 안 된다.
    */
    <div className="flex min-h-[210px] flex-col rounded-card border-[1.5px] border-track p-[20px_22px]">
      {/* ref .ag-d-sec-head — 왼쪽 카드의 제목 줄과 같은 규격(1.12rem / 900 / 아래 14px) */}
      <div className="mb-3.5 flex items-center justify-between gap-2.5">
        <h3 className="text-[1.12rem] font-black">AI 분석</h3>
      </div>

      {/*
        ref .ag-ai-note — 하늘색 블록. 글은 왼쪽 62%만 쓰고 오른쪽 아래에 마스코트가 앉는다.
        `flex-1` 로 카드 안의 남는 높이를 채운다 — 2열에서 왼쪽 카드가 더 길면 이 카드가 그 높이로
        늘어나는데, 블록을 제 높이로만 두면 그 아래에 흰 여백이 남는다.
      */}
      <div className="relative flex flex-1 items-center overflow-hidden rounded-tile bg-sky p-[18px_20px] text-[.95rem] font-bold leading-[1.7]">
        <div className="relative z-1 max-w-[62%]">
          {weakest ? (
            <>
              이번 과제에서
              <br />
              학생의 <b className="text-[1.45rem] text-primary">{100 - weakest.accuracy}%</b>가
              <br />
              {weakest.tag} 개념을 어려워했어요
            </>
          ) : (
            <>
              제출이 더 쌓이면
              <br />
              개념별 결과를 알려드려요.
            </>
          )}
        </div>
        {/*
          ref 는 `artAi` 를 **과제 과목과 다른** 과목 캐릭터로 고른다
          (`subject === "영어" ? subjectImage("국어") : subjectImage("영어")`) — 왼쪽 목록 카드의
          과목 마스코트와 같은 그림이 한 화면에 두 번 나오지 않게 하는 장치다.

          과목이 5개가 된 뒤에도 여기는 영어 캐릭터로 고정해 둔다. ref 처럼 "과제 과목이 아닌
          것 중 하나"를 골라야 하는데, 고를 때마다 그림이 바뀌면 상세 패널의 배경이 과제마다
          달라져 오히려 시선을 끈다 — 장식이라 한 장으로 고정하는 편이 낫다. 영어 과제일 때만
          왼쪽 카드와 겹치는데, 겹쳐도 위치·크기가 달라 같은 그림 두 장으로 읽히지 않는다.
        */}
        <img
          src={subjectImage('영어')}
          alt=""
          aria-hidden="true"
          width={424}
          height={386}
          decoding="async"
          className="pointer-events-none absolute -bottom-1.5 -right-1 h-auto w-[104px]"
        />
      </div>
    </div>
  )
}

function Tile({
  tone,
  icon,
  label,
  value,
  sub,
  link,
  panel,
  wrapRef,
}: {
  tone: keyof typeof TILE
  icon: IconName
  label: string
  value: string
  sub?: string
  link?: { label: string; onClick: () => void; expanded?: boolean }
  /** 타일 아래로 내려오는 알림창 — 감싸는 칸이 위치 기준이 된다 */
  panel?: ReactNode
  /** 바깥 클릭 판정용 — 타일과 알림창을 **한 덩어리로** 봐야 명단 안을 눌러도 닫히지 않는다 */
  wrapRef?: Ref<HTMLDivElement>
}) {
  const body = (
    /* h-full — 감싸는 칸이 한 겹 끼면 그리드의 stretch 가 여기까지 내려오지 않아 타일만 짧아진다 */
    <div className={`flex h-full flex-col items-start rounded-tile p-[16px_18px] ${TILE[tone]}`}>
      <span className="flex items-center gap-2">
        <span className="ico grid h-[26px] w-[26px] flex-none place-items-center rounded-[9px] bg-white">
          <Icon name={icon} className="h-[15px] w-[15px]" />
        </span>
        <span className="text-[.82rem] font-extrabold text-ink-soft">{label}</span>
      </span>
      <b className="mt-2 self-center text-center text-[1.75rem] font-black tracking-[-.6px]">
        {value}
      </b>
      {sub && (
        <span className="mt-1 self-center text-center text-[.78rem] font-semibold text-ink-soft">
          {sub}
        </span>
      )}
      {link && (
        <button
          type="button"
          onClick={link.onClick}
          aria-expanded={link.expanded}
          data-on={link.expanded === true}
          className="mt-1.5 inline-flex items-center gap-0.5 self-center text-[.84rem] font-extrabold text-ink-mute transition-colors hover:text-primary data-[on=true]:text-primary"
        >
          {link.label}
          {/* 펼치는 칸의 화살표는 상태를 가리킨다 — 옆(이동)이 아니라 아래(펼침)/위(접힘) */}
          <Icon
            name="chevronRight"
            className={`h-3.5 w-3.5 transition-transform ${
              link.expanded === undefined ? '' : link.expanded ? '-rotate-90' : 'rotate-90'
            }`}
          />
        </button>
      )}
    </div>
  )

  /* 알림창이 없는 칸은 감싸는 칸도 두지 않는다 — 그리드 stretch 가 그대로 걸리게 */
  if (!panel && !wrapRef) return body

  return (
    <div ref={wrapRef} className="relative min-w-0">
      {body}
      {panel}
    </div>
  )
}

/* ── 학생별 현황 ───────────────────────────────────────── */
function StudentsTab({
  stats,
  students,
}: {
  stats: AssignmentSubmissions
  students: StudentAccount[]
}) {
  const [filter, setFilter] = useState<'all' | 'done' | 'missing'>('all')

  /** 제출자 + 미제출자를 한 줄 모양으로 합친다 (미제출자는 id 로만 오므로 명단에서 이름을 찾는다) */
  const rows = useMemo(() => {
    const done = stats.submissions.map((s) => ({
      key: `d${s.studentId}`,
      name: s.name,
      grade: students.find((x) => x.userId === s.studentId)?.grade,
      done: true,
      score: s.score,
      when: s.submittedAt,
    }))
    const missing = stats.notSubmittedStudentIds.map((id) => {
      const acc = students.find((x) => x.userId === id)
      return {
        key: `m${id}`,
        name: acc?.name ?? `학생 ${id}`,
        grade: acc?.grade,
        done: false,
        score: null as number | null,
        when: null as string | null,
      }
    })
    return [...done, ...missing]
  }, [stats, students])

  const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'done' ? r.done : !r.done))

  const pills = [
    { key: 'all' as const, label: '전체', n: rows.length },
    { key: 'done' as const, label: '제출', n: stats.submittedCount },
    { key: 'missing' as const, label: '미제출', n: stats.notSubmittedStudentIds.length },
  ]

  return (
    /* 세로 기둥 — 필터 줄은 제 높이만, 아래 목록/안내문이 남는 높이를 받는다 */
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ref .ag-stu-toolbar — 필터 알약 */}
      <div className="mb-3.5 flex flex-none gap-2">
        {pills.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setFilter(p.key)}
            data-on={filter === p.key}
            className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-track p-[8px_15px] text-[.84rem] font-extrabold text-ink-soft transition-colors hover:border-primary hover:text-primary data-[on=true]:border-primary data-[on=true]:bg-primary data-[on=true]:text-white"
          >
            {p.label} <b className="font-black">{p.n}</b>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        /* 비었을 때는 남는 높이 **가운데**에 — 필터 줄 바로 아래에 붙으면 아래가 통째로 비어 보인다 */
        <p className="grid flex-1 place-items-center py-[22px] text-center text-[.9rem] font-bold text-ink-mute">
          해당하는 학생이 없어요
        </p>
      ) : (
        <div className="overflow-hidden rounded-card border-[1.5px] border-track">
          {shown.map((r) => (
            <div
              key={r.key}
              className="grid grid-cols-[minmax(0,1.5fr)_84px_minmax(0,1.5fr)_92px] items-center gap-3.5 p-[11px_18px] [&+&]:border-t-[1.5px] [&+&]:border-track max-[720px]:grid-cols-[minmax(0,1fr)_84px]"
            >
              <span className="flex min-w-0 flex-col">
                <b className="truncate text-[.95rem] font-black">{r.name}</b>
                {r.grade !== undefined && (
                  <i className="text-[.76rem] font-bold not-italic text-ink-mute">{r.grade}학년</i>
                )}
              </span>
              <span
                data-done={r.done}
                className="justify-self-start rounded-full p-[5px_12px] text-[.76rem] font-black data-[done=false]:bg-danger-soft data-[done=false]:text-danger data-[done=true]:bg-success data-[done=true]:text-success-deep"
              >
                {r.done ? '제출' : '미제출'}
              </span>
              <span className="flex min-w-0 items-center gap-2.5 max-[720px]:hidden">
                {r.score === null ? (
                  <span className="font-extrabold text-ink-mute">—</span>
                ) : (
                  <>
                    <FillBar
                      pct={r.score}
                      className="h-2 flex-1"
                      fillClassName={levelFill(r.score)}
                    />
                    <b className="w-11 flex-none text-right text-[.86rem] font-black">
                      {r.score}점
                    </b>
                  </>
                )}
              </span>
              <span className="text-right text-[.78rem] font-bold text-ink-mute max-[720px]:hidden">
                {r.when ? `${fmtWhen(r.when)} 제출` : '·'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── 문항 분석 ─────────────────────────────────────────── */

/** 문항 밴드 배지 색 — 히트맵과 같은 규칙을 쓴다 */
const BAND_CLS: Record<Band, string> = {
  GOOD: 'bg-success text-success-deep',
  WARN: 'bg-task-soft text-task-deep',
  RISK: 'bg-danger-soft text-danger',
  INSUFFICIENT: 'bg-locked text-ink-mute',
}

/**
 * '다시 짚어줄 문항' 한 페이지 = 4개(2열 × 2줄).
 *
 * 카드 하나에 든 내용이 한 줄 반이라 한 열로 쌓으면 여백만 길어진다. 그렇다고 전부 늘어놓으면
 * 이 묶음이 패널을 밀어내므로, 두 줄까지만 두고 나머지는 페이지로 넘긴다.
 */
const WEAK_PER_PAGE = 4

function QuestionsTab({
  stats,
  onOpenProblem,
}: {
  stats: AssignmentSubmissions
  onOpenProblem: (no: number) => void
}) {
  /** 오답 TOP 3 문항 번호 — 배지로 눈에 띄게 (ref `.ag-q-badge`) */
  const topWrong = useMemo(() => {
    const set = new Set(
      [...stats.problems]
        .filter((p) => p.accuracy !== null)
        .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
        .slice(0, 3)
        .map((p) => p.no),
    )
    return set
  }, [stats])

  const graded = stats.problems.filter((p) => p.accuracy !== null)
  const avg =
    graded.length === 0
      ? null
      : Math.round(graded.reduce((s, p) => s + (p.accuracy ?? 0), 0) / graded.length)

  /**
   * 다시 짚어줄 문항 — 밴드가 낮은(RISK·WARN) 문항만.
   *
   * 예전에는 '문항 열기' 모달의 제출 현황 안에 있었다. 문항 이야기는 **이 탭**이 하는 이야기라
   * 위 정답률 막대 바로 아래가 제자리다 (모달에서는 지웠다 — 같은 내용이 두 곳에 있으면
   * 어느 쪽이 최신인지 알 수 없다).
   */
  const weak = stats.problems.filter((p) => p.band === 'RISK' || p.band === 'WARN')

  const [weakPage, setWeakPage] = useState(0)
  const weakPages = Math.max(1, Math.ceil(weak.length / WEAK_PER_PAGE))
  /* 과제를 갈아 타면 문항 수가 달라진다 — 3페이지에 있었는데 1페이지뿐이면 빈 화면이 남는다 */
  const page = Math.min(weakPage, weakPages - 1)
  const weakShown = weak.slice(page * WEAK_PER_PAGE, page * WEAK_PER_PAGE + WEAK_PER_PAGE)

  if (stats.problems.length === 0) {
    return (
      <p className="grid flex-1 place-items-center py-[22px] text-center text-[.9rem] font-bold text-ink-mute">
        아직 집계할 문항이 없어요
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-3 flex-none text-[.84rem] font-extrabold text-ink-soft">
        문항 평균 정답률{' '}
        {avg === null ? (
          <b className="text-ink-mute">—</b>
        ) : (
          <b
            data-lv={levelOf(avg)}
            className="data-[lv=high]:text-level-high data-[lv=low]:text-danger data-[lv=mid]:text-task-deep"
          >
            {avg}%
          </b>
        )}
      </p>
      <div className="flex flex-col gap-2.5">
        {stats.problems.map((p) => (
          <div
            key={p.no}
            className="grid grid-cols-[44px_minmax(0,1fr)_46px_78px] items-center gap-3 max-[720px]:grid-cols-[44px_minmax(0,1fr)_46px]"
          >
            <span className="text-[.86rem] font-black">{p.no}번</span>
            {p.accuracy === null ? (
              <span className="text-[.82rem] font-bold text-ink-mute">풀이 없음</span>
            ) : (
              <FillBar pct={p.accuracy} className="h-2" fillClassName={levelFill(p.accuracy)} />
            )}
            <span className="text-right text-[.84rem] font-black text-ink-soft">
              {p.accuracy === null ? '—' : `${p.accuracy}%`}
            </span>
            <span className="justify-self-start max-[720px]:hidden">
              {topWrong.has(p.no) && p.accuracy !== null ? (
                <span className="rounded-full bg-danger-soft p-[3px_9px] text-[.7rem] font-black text-danger">
                  오답 TOP
                </span>
              ) : (
                <span className="text-[.72rem] font-bold text-ink-mute">{BAND_LABEL[p.band]}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/*
        다시 짚어줄 문항 — 위 막대에서 "낮다"를 본 다음 읽는 자리다. 그래서 구분선 아래에 둔다.
        낮은 문항이 없으면 이 묶음 자체를 그리지 않는다 (빈 제목만 남기지 않는다).
      */}
      {weak.length > 0 && (
        <div className="mt-5 border-t-[1.5px] border-track pt-[18px]">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[1.12rem] font-black">
              다시 짚어줄 문항 <b className="text-primary">{weak.length}</b>
            </h3>
            <span className="text-[.78rem] font-bold text-ink-mute">눌러서 문항을 볼 수 있어요</span>
          </div>
          <p className="mb-3 text-[.84rem] font-semibold text-ink-soft">
            많이 틀린 문항이에요. 학생들이 고른 오답도 함께 보여줘요.
          </p>

          {/* 한 줄에 2개 — 카드 내용이 짧아 한 열로 쌓으면 여백만 길어졌다 */}
          <ul className="grid grid-cols-2 gap-2 max-[900px]:grid-cols-1">
            {weakShown.map((p) => (
              <li key={p.no} className="min-w-0">
                {/*
                  카드째 버튼이다 — 어디를 눌러야 하는지 고민하지 않게. 발문은 목록 응답에 없어서
                  부모가 과제 본문을 받아 온 뒤 창을 연다.
                */}
                <button
                  type="button"
                  onClick={() => onOpenProblem(p.no)}
                  aria-label={`${p.no}번 문항 자세히 보기`}
                  className="flex h-full w-full flex-col items-start gap-2 rounded-card border-[1.5px] border-track p-[14px_16px] text-left transition-colors hover:border-primary hover:bg-sky/40"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[.9rem] font-black">{p.no}번</span>
                    <span
                      className={`inline-block rounded-full px-2.5 py-[3px] text-[.74rem] font-extrabold ${BAND_CLS[p.band]}`}
                    >
                      {p.accuracy === null ? BAND_LABEL[p.band] : `정답률 ${p.accuracy}%`}
                    </span>
                    <span className="text-[.78rem] font-bold text-ink-mute">{p.n}명 채점</span>
                    {p.conceptTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-block rounded-full bg-mint-bg px-2.5 py-[3px] text-[.74rem] font-extrabold text-mint-deep"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                  {p.choiceDistribution.length > 0 && (
                    <span className="flex flex-wrap gap-1.5">
                      {/*
                        빈도순으로 와서 맨 앞이 가장 많이 고른 오답이다.
                        선택형 답은 0부터 세는 index 로 와서 그대로 적으면 맨 숫자가 된다 —
                        여기는 보기 글을 모르므로(목록 응답에 문항 본문이 없다) 사람이 세는
                        "보기 3번"까지만 옮긴다. 보기 글은 카드를 누르면 창에서 볼 수 있다.
                      */}
                      {p.choiceDistribution.map((c) => (
                        <span
                          key={c.answer}
                          className="inline-flex items-center gap-1 rounded-full bg-canvas px-2.5 py-1 text-[.8rem] font-bold text-ink-soft"
                        >
                          <Icon name="close" className="h-3 w-3 flex-none text-danger" />
                          {answerLabel(c.answer)}
                          <b className="font-black text-ink">{c.count}명</b>
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/* 한 페이지뿐이면 Paginator 가 스스로 아무것도 그리지 않는다 */}
          <Paginator
            page={page}
            pageCount={weakPages}
            onChange={setWeakPage}
            label="다시 짚어줄 문항"
          />
        </div>
      )}
    </div>
  )
}

/* ── 과제 설정 ─────────────────────────────────────────── */
function SettingsTab({
  assignment,
  onEdit,
  onDelete,
  onTogglePublish,
}: {
  assignment: AssignmentSummary
  onEdit: () => void
  onDelete: () => void
  onTogglePublish: (publish: boolean) => void
}) {
  return (
    /*
      ref 는 `.ag-set{max-width:640px}` 로 폭을 묶지만 여기서는 풀었다 — 상세 패널이 그보다
      넓어서 오른쪽이 통째로 비어 보였다. 두 줄이 패널 폭을 다 쓰고, 각 줄 안에서 글은 왼쪽,
      버튼은 오른쪽 끝에 붙는다(justify-between).
    */
    <div className="flex flex-col gap-4">
      {/*
        ref 는 이름·마감·대상·상태를 여기서 바로 고친다. 우리 백엔드가 받는 것은
        `title` / `dueAt` / `publish` 셋뿐이다(UpdateAssignmentRequest).
        **이름은 제목 옆 연필**에서 바로 고치고, 문항·마감은 편집 화면에서 다룬다 —
        같은 값을 두 곳에서 고치게 두지 않는다.
        ref 의 "대상" 은 우리 과제에 학년/모둠 개념이 없어 뺐다.
      */}
      {/*
        문항 보기·수정 — 예전엔 제목 옆 연필이 이 창을 열었다. 연필이 '이름 바꾸기'가 되면서
        갈 곳이 없어져 여기로 옮겼다. 그냥 없애면 문항을 볼 길이 화면에서 사라진다.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border-[1.5px] border-track p-[16px_18px]">
        <div className="min-w-0">
          <b className="block text-[.95rem] font-black">문항 보기·수정</b>
          <p className="mt-1 text-[.84rem] font-semibold text-ink-soft">
            문제와 정답, 마감일을 편집 화면에서 확인하고 고쳐요.
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="flex flex-none items-center gap-2 rounded-full bg-sky p-[11px_20px] text-[.9rem] font-black text-primary transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:bg-sky-deep"
        >
          <Icon name="doc" className="h-4 w-4" />
          문항 열기
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border-[1.5px] border-track p-[16px_18px]">
        <div className="min-w-0">
          <b className="block text-[.95rem] font-black">
            {assignment.published ? '학생에게 공개 중' : '아직 공개하지 않음'}
          </b>
          <p className="mt-1 text-[.84rem] font-semibold text-ink-soft">
            {assignment.published
              ? '공개를 내리면 학생 목록에서 사라져요. 제출 기록은 남아요.'
              : '공개하면 학생의 “활동지”에 바로 올라가요.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onTogglePublish(!assignment.published)}
          className="flex-none rounded-full bg-primary p-[11px_20px] text-[.9rem] font-black text-white transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:bg-primary-hover"
        >
          {assignment.published ? '공개 내리기' : '공개하기'}
        </button>
      </div>

      {/* ref .ag-set-danger */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border-[1.5px] border-danger-soft bg-danger-soft/40 p-[16px_18px]">
        <div className="min-w-0">
          <b className="block text-[.95rem] font-black text-danger">과제 삭제</b>
          <p className="mt-1 text-[.84rem] font-semibold text-ink-soft">
            결과와 제출 기록이 함께 사라지며 되돌릴 수 없어요.
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="flex flex-none items-center gap-1.5 rounded-full border-[1.5px] border-danger p-[10px_18px] text-[.9rem] font-black text-danger transition-colors hover:bg-danger hover:text-white"
        >
          <Icon name="trash" className="h-4 w-4" />
          삭제하기
        </button>
      </div>
    </div>
  )
}
