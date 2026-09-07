import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { TeacherShell } from '@/components/classroom/teacher/TeacherShell'
import { AssignmentBanner } from '@/components/classroom/teacher/assignments/AssignmentBanner'
import { AssignmentListPanel } from '@/components/classroom/teacher/assignments/AssignmentListPanel'
import { AssignmentDetailPanel } from '@/components/classroom/teacher/assignments/AssignmentDetailPanel'
import { avgScore, submitRate, useAssignmentStats } from '@/hooks/useAssignmentStats'
import { useModalStore, useOpenModal } from '@/stores/useModalStore'
import { useStudentsStore } from '@/stores/useStudentsStore'
import { useToastStore } from '@/stores/useToastStore'
import { confirmAction } from '@/stores/useConfirmStore'
import { assignmentApi } from '@/services/api/assignmentApi'
import { classroomApi } from '@/services/api/classroomApi'
import { apiErrorMessage } from '@/lib/apiError'
import { backLabelFor, backTarget, teacherRoutes } from '@/lib/routes'
import type { AssignmentSummary } from '@/types/assignment'
import type { StudentAccount } from '@/types/teacher'
import { useTeacherPresence } from '@/hooks/useTeacherPresence'

/** 모듈 상수 — 셀렉터가 매번 새 배열을 만들면 zustand 가 바뀐 줄 알고 계속 리렌더한다 */
const EMPTY_STUDENTS: StudentAccount[] = []

/**
 * 과제 관리 — 레퍼런스 teacher.html `viewAssignments` 이관.
 *
 * 구성(ref): 배너(`.ag-frame`) → 2단 본문(`.ag-body`).
 *  - 왼쪽 `.ag-list-panel` : 과제 카드 목록 + 제출률 링 + 페이저
 *  - 오른쪽 `.ag-detail`   : 고른 과제의 요약 · 학생별 현황 · 문항 분석 · 과제 설정 탭
 *
 * 예전에는 "뒤로가기 → 툴바 → 목록 카드" 한 줄기였고 과제를 누르면 **모달**이 떴다. ref 는
 * 목록과 상세를 한 화면에 나란히 둬서 과제를 갈아 보며 비교할 수 있게 바뀌었다.
 */
export function TeacherAssignmentsPage() {
  // 이 화면에 있는 동안에도 학생 질문을 받는다 (백엔드는 STOMP 접속을 온라인으로 본다)
  useTeacherPresence()
  const navigate = useNavigate()
  const location = useLocation()
  const { classroomId } = useParams()
  const id = classroomId ?? ''

  /** 출발지가 없으면 정식 관문인 담당 학급 선택으로 (routes.ts 규칙 1) */
  const back = backTarget(location.state, teacherRoutes.pickClass('assignments'))
  const openModal = useOpenModal()
  const showToast = useToastStore((s) => s.show)

  const [items, setItems] = useState<AssignmentSummary[]>([])
  const [className, setClassName] = useState<string>()
  /**
   * 학급을 만들 때 설정한 **담당 학년** — 학년 탭의 원천이다.
   *
   * 예전엔 명단(`students`)에서 학년을 세어 탭을 만들었다. 그래서 5·6학년 학급인데 6학년
   * 학생이 아직 없으면 **6학년 탭이 아예 없었다** — 그 학년에 과제를 만들지도, 없다는 걸
   * 확인하지도 못했다. 담당 학년은 학급의 성질이지 명단의 부산물이 아니다.
   */
  const [classGrades, setClassGrades] = useState<number[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const load = useCallback(
    () =>
      void assignmentApi
        .listAssignments(id)
        .then(setItems)
        .catch(() => setItems([])),
    [id],
  )
  useEffect(load, [load])

  /*
    모달이 다 닫히면 목록을 다시 받는다 — 과제를 **만들거나**(마법사) 공개·삭제한 뒤
    새로고침해야 보이던 것을 없앤다. 모달은 전역 스토어로 열려서 콜백을 직접 넘길 수 없으므로,
    학급 화면(TeacherClassDetailPage)·활동지 카드(AssignmentListCard)와 같은 방식으로
    **스택이 비는 순간**을 본다.

    `prevModalCount` 로 "열려 있다가 닫혔다"를 가려낸다 — 이게 없으면 첫 렌더(0)에서도
    조건이 참이 돼 화면을 열 때마다 목록을 두 번 받는다.
  */
  const modalCount = useModalStore((s) => s.stack.length)
  const prevModalCount = useRef(modalCount)
  useEffect(() => {
    const justClosed = prevModalCount.current > 0 && modalCount === 0
    prevModalCount.current = modalCount
    if (justClosed) load()
  }, [modalCount, load])

  useEffect(() => {
    if (!id) return
    void classroomApi
      .getClassroom(id)
      .then((c) => {
        setClassName(c.name)
        setClassGrades([...(c.grades ?? [])].sort((a, b) => a - b))
      })
      .catch(() => {
        setClassName(undefined)
        // 못 받으면 아래에서 명단으로 폴백한다 — 탭이 통째로 사라지는 것보다 낫다
        setClassGrades([])
      })
  }, [id])

  // 미제출자는 서버가 id 만 주므로 이름을 맞추려면 학급 명단이 필요하다
  const students = useStudentsStore((s) => s.byClassroom[id] ?? EMPTY_STUDENTS)
  const loadStudents = useStudentsStore((s) => s.load)
  useEffect(() => {
    if (id) void loadStudents(id)
  }, [id, loadStudents])

  /** 배너 요약 · 목록 링 · 상세 탭이 함께 쓰는 과제별 제출 현황 */
  const stats = useAssignmentStats(items)

  /**
   * 학년 탭에 그릴 학년 — **학급의 담당 학년이 먼저다.**
   *
   * 과제가 0개인 학년도, 아직 학생이 없는 학년도 탭은 그대로 있어야 한다: 5·6학년 학급이면
   * 5·6학년 둘 다 보이는 게 맞다. 명단은 학급 정보를 못 받았을 때의 **폴백**일 뿐이다
   * (그때라도 탭이 하나는 남게).
   */
  const grades = useMemo(
    () =>
      classGrades.length > 0
        ? classGrades
        : [...new Set(students.map((s) => s.grade))].sort((a, b) => a - b),
    [classGrades, students],
  )
  const [grade, setGrade] = useState<number | null>(null)
  useEffect(() => {
    if (grades.length && (grade === null || !grades.includes(grade))) setGrade(grades[0])
  }, [grades, grade])

  /**
   * 과제가 **어느 학년을 대상으로 하는지** — 과제가 직접 들고 있다(`targetGrades`).
   * 선생님 목록 응답에만 실린다(학생에게는 다른 대상이 노출되지 않도록 빼고 준다).
   *
   * 예전에는 제출 현황의 학생 학년으로 역산했다. 그런데 **미공개 과제는 제출 현황이 없어**
   * 빈 배열이 됐고, 빈 배열은 "학년 제한 없음"으로 읽혀 모든 학년 탭에 떴다 —
   * 1학년으로 만든 과제가 5학년 탭에도 보이던 그 증상이다. 만든 직후가 정확히 그 상태라
   * 가장 자주 눈에 띄었다.
   *
   * 지금도 빈 배열은 "학년 제한 없음"이고, 그때 모든 탭에 보이는 것은 **의도된 동작**이다.
   * 서버의 학생 조회도 같은 규칙을 쓴다(targetGrades·targetStudentIds 가 둘 다 비면 학급 전체).
   * 달라진 것은 그 값을 추측하지 않고 그대로 받는다는 점이다.
   */
  const gradesOf = useCallback(
    (assignmentId: number) => {
      const a = items.find((x) => x.id === assignmentId)
      if (!a) return []
      if (a.targetGrades?.length) return a.targetGrades
      /*
        **대상 학생으로도 학년을 안다.**

        "OO 맞춤 문제"(학생 상세의 맞춤 문제)는 `targetStudentIds` 만 싣고 `targetGrades` 는
        비워 둔다 — 한 아이에게만 나가는 과제라 학년으로 막을 이유가 없었기 때문이다.
        그런데 여기서 빈 배열은 "학년 제한 없음"으로 읽혀, 1학년 아이의 맞춤 문제가
        3학년 탭에도 떴다. 학생에게는 제대로 안 보였으니 목록 탭에서만 어긋난 것이다.

        생성 쪽에 `targetGrades` 를 채우지 않고 여기서 되짚는 이유는 **이미 만들어진 과제들**
        때문이다. 생성만 고치면 지금까지 만든 맞춤 문제는 계속 모든 탭에 뜬다.
      */
      if (a.targetStudentIds?.length) {
        const ids = new Set(a.targetStudentIds)
        const gs = [...new Set(students.filter((s) => ids.has(s.userId)).map((s) => s.grade))]
        // 명단을 아직 못 받았으면 빈 배열이다 — 그때는 예전처럼 어느 탭에서도 숨기지 않는다
        if (gs.length) return gs
      }
      return []
    },
    [items, students],
  )

  /*
    과제가 하나도 없으면 선택을 비운다. **어느 과제를 고를지는 목록 패널이 정한다** —
    학년 탭·정렬을 아는 쪽이 거기라, 여기서 `items[0]` 을 고르면 지금 탭에 없는 과제가
    상세에 뜰 수 있다.
  */
  useEffect(() => {
    if (items.length === 0) setSelectedId(null)
  }, [items])

  const selected = items.find((a) => a.id === selectedId) ?? null

  /** 배너 요약 3칸 — 공개된 과제만 센다(미공개는 학생에게 안 보이므로 제출이 있을 수 없다) */
  const head = useMemo(() => {
    const published = items.filter((a) => a.published)
    const rates = published
      .map((a) => submitRate(stats[a.id]))
      .filter((r): r is number => r !== null)
    const scores = published
      .map((a) => avgScore(stats[a.id]))
      .filter((s): s is number => s !== null)
    const mean = (xs: number[]) =>
      xs.length === 0 ? null : Math.round(xs.reduce((s, x) => s + x, 0) / xs.length)
    return { ongoing: published.length, avgRate: mean(rates), avgScore: mean(scores) }
  }, [items, stats])

  async function togglePublish(a: AssignmentSummary, publish: boolean) {
    try {
      await assignmentApi.updateAssignment(a.id, { publish })
      showToast(publish ? '과제를 공개했어요' : '과제 공개를 내렸어요')
      load()
    } catch (err) {
      showToast(apiErrorMessage(err, '바꾸지 못했어요. 잠시 후 다시 시도해 주세요.'))
    }
  }

  async function remove(a: AssignmentSummary) {
    const ok = await confirmAction({
      title: `'${a.title}' 과제를 삭제할까요?`,
      message: '결과와 제출 기록이 함께 사라지며 되돌릴 수 없어요.',
      confirmLabel: '과제 삭제',
      danger: true,
    })
    if (!ok) return
    try {
      await assignmentApi.deleteAssignment(a.id)
      showToast('과제를 삭제했어요')
      setSelectedId(null)
      load()
    } catch (err) {
      showToast(apiErrorMessage(err, '삭제하지 못했어요. 잠시 후 다시 시도해 주세요.'))
    }
  }

  return (
    /* 헤더(.topbar)는 얹지 않는다 — 이 화면은 자기 배너(.ag-frame)를 갖고 있다 (ref TOPBAR_VIEWS) */
    <TeacherShell active="assignments" classroomId={id}>
      <>
        <AssignmentBanner
          back={
            <Button variant="back" onClick={() => navigate(back)}>
              <Icon name="back" className="h-[15px] w-[15px]" />
              {backLabelFor(back, className)}
            </Button>
          }
          action={
            <Button onClick={() => openModal({ type: 'assignmentWizard', classroomId: id })}>
              <Icon name="plus" className="h-[17px] w-[17px]" />새 과제 만들기
            </Button>
          }
          ongoing={head.ongoing}
          avgRate={head.avgRate}
          avgScore={head.avgScore}
        />

        {/* ref .ag-body — 좌 목록(340 고정) / 우 상세. stretch 로 두 열 바닥이 나란히 맞는다 */}
        <div className="grid grid-cols-[340px_minmax(0,1fr)] items-stretch gap-5 max-[1120px]:grid-cols-1">
          <AssignmentListPanel
            items={items}
            stats={stats}
            grades={grades}
            grade={grade}
            onGradeChange={setGrade}
            gradesOf={gradesOf}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          {selected ? (
            <AssignmentDetailPanel
              key={selected.id}
              assignment={selected}
              stats={stats[selected.id]}
              students={students}
              onEdit={() =>
                void assignmentApi
                  .getAssignment(selected.id)
                  .then((full) => openModal({ type: 'assignmentDetail', assignment: full }))
                  .catch(() => showToast('과제를 불러오지 못했어요.'))
              }
              /*
                제목만 바꾼다. 성공하면 목록을 다시 불러 왼쪽 카드의 제목도 같이 바뀌게 한다 —
                한쪽만 갱신하면 같은 과제가 화면 안에서 두 이름으로 보인다.
                실패는 던져서 편집 상태를 유지한다 (입력을 날리지 않는다).
              */
              onRename={async (title) => {
                try {
                  await assignmentApi.updateAssignment(selected.id, { title })
                } catch (err) {
                  showToast(apiErrorMessage(err, '이름을 바꾸지 못했어요.'))
                  throw err
                }
                load()
                showToast('과제 이름을 바꿨어요')
              }}
              /*
                마감일. 목록 카드도 같은 값을 쓰므로 성공하면 다시 불러온다.
                실패는 던져서 달력을 열어 둔다 — 고른 날짜를 잃지 않게.
              */
              onSetDue={async (dueAt) => {
                try {
                  await assignmentApi.updateAssignment(selected.id, { dueAt })
                } catch (err) {
                  showToast(apiErrorMessage(err, '마감일을 저장하지 못했어요.'))
                  throw err
                }
                load()
                showToast('마감일을 정했어요')
              }}
              /*
                문항 하나 크게 보기. 발문은 목록 응답에 없어서(`AssignmentSummary` 에 content 가
                없다) 누른 순간 전체 과제를 받아 온다 — '문항 열기'와 같은 길이다.
                집계는 이미 손에 있으니 **문항 전부의 것**을 넘긴다 — 창 안에서 이전·다음
                문항으로 옮겨 다니므로 그때마다 다시 받아오지 않는다.
              */
              onOpenProblem={(no) =>
                void assignmentApi
                  .getAssignment(selected.id)
                  .then((full) =>
                    openModal({
                      type: 'problemDetail',
                      assignment: full,
                      no,
                      stats: stats[selected.id]?.problems,
                    }),
                  )
                  .catch(() => showToast('문항을 불러오지 못했어요.'))
              }
              onDelete={() => void remove(selected)}
              onTogglePublish={(publish) => void togglePublish(selected, publish)}
            />
          ) : (
            <section
              aria-label="과제 상세"
              className="grid min-h-[420px] place-items-center rounded-card border-[1.5px] border-frame bg-card shadow-card"
            >
              <EmptyState
                icon="doc"
                title="왼쪽에서 과제를 골라 주세요"
                hint="제출률과 문항별 정답률을 여기에서 볼 수 있어요."
              />
            </section>
          )}
        </div>
      </>
    </TeacherShell>
  )
}
