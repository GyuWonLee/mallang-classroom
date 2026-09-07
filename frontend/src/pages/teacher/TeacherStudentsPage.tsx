import { Suspense, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { lazyWithRetry } from '@/app/routes/lazyWithRetry'
import { backLabelFor, backTarget, fromState, teacherRoutes } from '@/lib/routes'
import { Button } from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { TeacherShell } from '@/components/classroom/teacher/TeacherShell'
import { StudentsHero } from '@/components/classroom/teacher/students/StudentsHero'
import {
  StudentListPanel,
  type RowAction,
} from '@/components/classroom/teacher/students/StudentListPanel'
import {
  StudentDetailPanel,
  type DetailTab,
} from '@/components/classroom/teacher/students/StudentDetailPanel'
import { deriveStudent, type StudentWithMeta } from '@/lib/studentMeta'
import { useStudentRoster } from '@/hooks/useStudentRoster'
import { useStudentsStore } from '@/stores/useStudentsStore'
import { useToastStore } from '@/stores/useToastStore'
import { confirmAction } from '@/stores/useConfirmStore'
import { useOpenModal } from '@/stores/useModalStore'
import { classroomApi } from '@/services/api/classroomApi'
import { tutorApi } from '@/services/api/tutorApi'
import { useTeacherPresence } from '@/hooks/useTeacherPresence'

/*
  통지표는 **열 때 받아온다.** A4 시트와 파생 규칙은 이 화면에서 버튼을 누르기 전까지
  쓰이지 않는데, 정적 import 면 학생 관리 화면을 여는 모든 사람이 같이 내려받는다.
*/
const ReportCardOverlay = lazyWithRetry(() =>
  import('@/components/classroom/teacher/report/ReportCardOverlay').then((m) => ({
    default: m.ReportCardOverlay,
  })),
)

/**
 * 학생 관리 (ref/teacher.html 화면 4) — 배너 + 통계, 왼쪽 학생 목록, 오른쪽 학생 상세.
 *
 * 학급 관리(개요/학습자료/과제)와 **화면 단위로 분리**된 목적지다. 선생님이 가장 자주 하는
 * 일이라 사이드바에서 한 번에 들어오고, 통계·설정은 학급 관리 쪽에 남는다 (가이드라인 0장).
 */
export function TeacherStudentsPage() {
  // 이 화면에 있는 동안에도 학생 질문을 받는다 (백엔드는 STOMP 접속을 온라인으로 본다)
  useTeacherPresence()
  const navigate = useNavigate()
  const location = useLocation()
  const { classroomId } = useParams()
  const id = classroomId ?? ''

  /*
    출발지가 없으면(사이드바 지름길·딥링크) **담당 학급 선택**으로 되돌린다 — 이 화면의 정식
    관문이다(routes.ts 규칙 1). 예전 fallback 은 학급 화면(L2)이라, 학급에 들어간 적도 없는데
    뒤로가기가 학급 안으로 들여보냈다.
  */
  const back = backTarget(location.state, teacherRoutes.pickClass('students'))
  const accounts = useStudentsStore((s) => s.byClassroom[id])
  const loadStudents = useStudentsStore((s) => s.load)
  const kick = useStudentsStore((s) => s.kick)

  /*
    말랑이 대화의 위험 신호 건수 — 목록에 표시를 붙이려고 학급 단위로 한 번 받는다.

    **실패해도 아무것도 알리지 않는다.** 이건 곁들이는 표시이고, 못 받았다고 학생 관리 화면에
    경고를 띄우면 정작 할 일(명단·출석·과제)이 가려진다. 표시가 안 붙을 뿐이다.
    자주 바뀌는 값이 아니라 staleTime 을 넉넉히 둔다.
  */
  const flagsQuery = useQuery({
    queryKey: ['tutor-flags', id],
    queryFn: () => tutorApi.flags(id),
    enabled: id !== '',
    staleTime: 5 * 60_000,
    retry: false,
  })
  const tutorFlags = useMemo(() => {
    const map: Record<number, number> = {}
    for (const row of flagsQuery.data ?? []) map[row.studentId] = row.count
    return map
  }, [flagsQuery.data])
  const showToast = useToastStore((s) => s.show)
  const openModal = useOpenModal()

  useEffect(() => {
    if (id) void loadStudents(id)
  }, [id, loadStudents])

  // 서버가 주는 계정 정보에 화면용 파생 정보를 붙인다 (lib/studentMeta 주석 참고)
  const students = useMemo<StudentWithMeta[]>(() => (accounts ?? []).map(deriveStudent), [accounts])
  /*
    목록의 출석·제출률 열과 배너 통계가 **같은 값을 쓰도록** 한 곳에서 모은다.
    둘 다 서버 값이다 — 예전엔 `deriveStudent()` 가 해시로 지어낸 숫자였다.
  */
  /* 학년까지 넘긴다 — 제출률의 분모가 "그 아이에게 나간 과제"라 학년을 알아야 가른다 */
  const rosterStudents = useMemo(
    () => students.map((s) => ({ userId: s.userId, grade: s.grade })),
    [students],
  )
  const roster = useStudentRoster(id, rosterStudents)
  // 통계 첫 칸 보조문구에 학급 이름을 쓴다 (ref smRenderStats 의 c.name)
  const [classroomName, setClassroomName] = useState<string>()
  /**
   * 학급을 만들 때 설정한 **담당 학년** — 학년 탭의 원천이다 (과제 관리와 같은 규칙).
   *
   * 예전엔 명단에서 학년을 세어 탭을 만들었다. 그래서 5·6학년 학급인데 6학년 학생을 아직
   * 안 만들었으면 **6학년 탭이 없었다** — 학생을 넣을 자리가 화면에 없는 셈이다.
   */
  const [classGrades, setClassGrades] = useState<number[]>([])
  useEffect(() => {
    if (!id) return
    void classroomApi
      .getClassroom(id)
      .then((c) => {
        setClassroomName(c.name)
        setClassGrades([...(c.grades ?? [])].sort((a, b) => a - b))
      })
      .catch(() => {
        setClassroomName(undefined)
        // 못 받으면 아래에서 명단으로 폴백한다 — 탭이 통째로 사라지는 것보다 낫다
        setClassGrades([])
      })
  }, [id])

  /**
   * 학년 탭 — 담당 학년이 먼저고, 학급 정보를 못 받았을 때만 명단에서 센다.
   * 값은 `'5학년'` 처럼 라벨 문자열이다 (목록 패널이 그대로 탭 이름으로 쓴다).
   */
  const grades = useMemo(
    () =>
      (classGrades.length > 0
        ? classGrades
        : [...new Set(students.map((s) => s.grade))].sort((a, b) => a - b)
      ).map((g) => `${g}학년`),
    [classGrades, students],
  )

  const [grade, setGrade] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  /** 통지표를 뽑을 대상. null 이면 미리보기가 닫혀 있다 (한 명이면 한 장, 여럿이면 여러 장) */
  const [reportTargets, setReportTargets] = useState<StudentWithMeta[] | null>(null)

  // 명단이 늦게 도착하거나 학년 구성이 바뀌면 첫 학년으로 맞춘다
  useEffect(() => {
    if (grades.length && (!grade || !grades.includes(grade))) setGrade(grades[0])
  }, [grades, grade])

  const selected = students.find((s) => s.userId === selectedId) ?? null
  // 내보낸 학생이 상세에 남아 있으면 안 된다
  useEffect(() => {
    if (selectedId !== null && !students.some((s) => s.userId === selectedId)) setSelectedId(null)
  }, [students, selectedId])

  /*
    첫 진입에 빈 상세 패널을 남기지 않는 일은 **StudentListPanel 이 한다.**

    예전엔 여기서 `students.find(s => s.team === grade)` 로 골랐는데, 그건 서버가 준 명단
    순서의 첫 학생이다. 목록은 패널 안에서 이름순으로 정렬돼 그려지므로 **하이라이트된 학생이
    맨 위 학생이 아니었다.** 정렬·검색·페이지를 아는 쪽이 골라야 맞아서 패널로 넘겼다.
    여기서는 selectedId 를 null 로 두기만 하면 패널이 맨 윗줄을 열어 준다.
  */

  function select(userId: number, tab: DetailTab = 'overview') {
    setSelectedId(userId)
    setDetailTab(tab)
  }

  function changeGrade(next: string) {
    setGrade(next)
    // 비워 두면 목록 패널이 그 학년의 **맨 위 학생**을 열어 준다 (정렬 순서를 아는 쪽이 고른다)
    setSelectedId(null)
    setDetailTab('overview')
  }

  async function onAction(act: RowAction, s: StudentWithMeta) {
    // '학습 현황 보기'는 요약 탭으로 연다 — 그 학생을 처음 볼 때 가장 먼저 볼 화면이다
    if (act === 'detail') return select(s.userId, 'overview')
    if (act === 'settings') return select(s.userId, 'settings')
    if (act === 'message') {
      // 여기서 이어지는 이동이라 출발지를 남긴다 — 안 남기면 채팅에서 뒤로가기가 내 학급까지 튄다
      navigate(teacherRoutes.chat, fromState(location))
      return
    }
    if (act === 'password') return openModal({ type: 'studentPassword', student: s })
    if (act === 'kick') {
      const ok = await confirmAction({
        title: `${s.name} 학생을 학급에서 내보낼까요?`,
        message: '내보내면 이 학급의 학습 기록도 함께 사라져요.',
        confirmLabel: '학생 내보내기',
        danger: true,
      })
      if (!ok) return
      void kick(id, s.userId)
        .then(() => showToast(`${s.name} 학생을 학급에서 내보냈어요`))
        // 백엔드가 거부하면 사유를 그대로 보여준다 (화면에서만 지우지 않는다)
        .catch((err) => showToast(err instanceof Error ? err.message : '내보내지 못했어요.'))
    }
  }

  return (
    /* 헤더(.topbar)는 얹지 않는다 — 이 화면은 자기 배너(.sm-hero)를 갖고 있다 (ref TOPBAR_VIEWS) */
    <TeacherShell active="students" classroomId={id}>
      {/* 스크롤은 페이지(콘텐츠 영역) 하나로만 한다 — 패널들은 내용만큼 늘어난다 */}
      <>
        {/*
          뒤로가기는 배너 **안** 맨 위에 들어간다 (ref .sm-hero-back) — 예전엔 배너 위 별도
          줄이라 화면 맨 위가 버튼 하나로 비어 보였다.
        */}
        <StudentsHero
          students={students}
          classroomName={classroomName}
          roster={roster}
          /* 배너의 '살펴볼 학생' 명단에서 고르면 오른쪽 상세를 그 학생으로 연다 */
          onSelectStudent={(userId) => select(userId, 'overview')}
          back={
            <Button variant="back" onClick={() => navigate(back)}>
              <Icon name="back" className="h-[15px] w-[15px]" />
              {backLabelFor(back, classroomName)}
            </Button>
          }
        />

        {/*
          **학생이 없어도 2단 레이아웃을 유지한다.** 예전엔 고른 학생이 없으면 한 단으로
          접혀서(data-solo) 학급에 학생이 없을 때 화면 구조가 통째로 달라 보였다 —
          목록이 화면을 다 차지하다가 학생을 등록하면 갑자기 반으로 줄어 흔들렸다.
          지금은 오른쪽 자리를 늘 잡아 두고, 고른 학생이 없으면 안내를 대신 넣는다.

          비율은 ref `.sm-main` 그대로 **1 : 1.8** 이고, 열 너비도 ref 값이다
          (StudentListPanel 의 `COLS`).

          다만 **2단 전환점만 1240px 로 남긴다** (ref 는 1120px). 사이드바 118 + 간격 28 +
          페이지 좌우 패딩 56 을 빼면 본문은 뷰포트-202 라, 이 비율에서 이름 글자칸은
          뷰포트 1440px 이면 약 89px 이지만 1240px 이면 49px, 1120px 이면 25px 까지 줄어
          세 글자 이름도 "김…" 으로 잘린다. 목록의 주인공이 안 읽히면 표가 쓸모없다.
          그 아래로는 위아래로 쌓아 목록에 폭을 다 준다.
        */}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)] items-stretch gap-5 max-[1240px]:grid-cols-1">
          <StudentListPanel
            students={students}
            grades={grades}
            grade={grade}
            onGradeChange={changeGrade}
            selectedId={selectedId}
            onSelect={select}
            onAction={onAction}
            onInvite={() => openModal({ type: 'inviteStudent', classroomId: id })}
            /* 순서(= 통지표의 번호)는 목록 패널이 정한다 — 정렬·검색을 아는 쪽이 거기뿐이다 */
            onReportCards={setReportTargets}
            roster={roster.byStudent}
            flags={tutorFlags}
            onOpenFlags={(s) =>
              openModal({
                type: 'tutorFlags',
                classroomId: id,
                studentId: s.userId,
                studentName: s.name,
              })
            }
          />

          {selected ? (
            <StudentDetailPanel
              student={selected}
              classroomId={id}
              tab={detailTab}
              onTabChange={setDetailTab}
              /* 요약 탭의 '학습 진도'가 목록 제출률 열과 같은 숫자를 말하게 한다 */
              progress={roster.byStudent[selected.userId]?.submitRate ?? null}
              publishedCount={roster.publishedCount}
              onReportCard={() => setReportTargets([selected])}
            />
          ) : (
            /*
              오른쪽 자리를 비워두지 않는다 — 카드 골격은 StudentDetailPanel 과 같게 두고
              (rounded-card + bg-card + shadow) 안내만 바꿔, 학생을 등록해도 레이아웃이 흔들리지 않는다.
            */
            <div className="min-w-0 rounded-card bg-card shadow-card max-[1240px]:hidden">
              <EmptyState
                icon="students"
                title={students.length ? '학생을 선택해 주세요' : '아직 등록된 학생이 없어요'}
                hint={
                  students.length
                    ? '왼쪽 목록에서 학생을 누르면 출석·진도·이해도 리포트가 여기에 나와요.'
                    : '왼쪽 “학생 초대” 버튼으로 학생을 등록하면 리포트가 여기에 나와요.'
                }
                className="min-h-[602px]"
              />
            </div>
          )}
        </div>

        {reportTargets && (
          <Suspense fallback={null}>
            <ReportCardOverlay
              classroomId={id}
              students={reportTargets}
              onClose={() => setReportTargets(null)}
            />
          </Suspense>
        )}
      </>
    </TeacherShell>
  )
}
