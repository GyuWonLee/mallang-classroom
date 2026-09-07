import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import { Icon } from '@/components/common/Icon'
import { Button } from '@/components/common/Button'
import { TodayAssignmentList } from '@/components/classroom/teacher/TodayAssignmentList'
import { ClassMessagesPanel } from '@/components/classroom/teacher/ClassMessagesPanel'
import { TeacherShell } from '@/components/classroom/teacher/TeacherShell'
import { InviteTeacherModal } from '@/components/classroom/teacher/modals/InviteTeacherModal'
import { LessonTopicModal } from '@/components/classroom/teacher/modals/LessonTopicModal'
import { useLessonTopicStore } from '@/stores/useLessonTopicStore'
import { useClassroomsStore } from '@/stores/useClassroomsStore'
import { useModalStore, useOpenModal } from '@/stores/useModalStore'
import { useStudentsStore } from '@/stores/useStudentsStore'
import { useToastStore } from '@/stores/useToastStore'
import { confirmAction } from '@/stores/useConfirmStore'
import { useActiveSession } from '@/hooks/useActiveSession'
import { useClassroomSocket } from '@/hooks/useClassroomSocket'
import { useAuthStore } from '@/stores/useAuthStore'
import type { ServerEvent } from '@/types/signaling'
import { gradeFromTitle } from '@/lib/assignmentGrade'
import { apiErrorMessage, errorSlug } from '@/lib/apiError'
import { sessionApi } from '@/services/api/sessionApi'
import { classroomApi } from '@/services/api/classroomApi'
import { assignmentApi } from '@/services/api/assignmentApi'
import { teacherRoutes } from '@/lib/routes'
import {
  gradeCardState,
  gradePlantImage,
  GRADE_CARD_CTA,
  GRADE_PALETTE,
  GRADE_STATUS as STATUS,
  LIVE_GRADE_PALETTE,
} from '@/lib/subject'
import { useLiveGrade } from '@/stores/useLiveGradeStore'
import type { StudentAccount } from '@/types/teacher'
import type { AssignmentSummary } from '@/types/assignment'

/**
 * 선생님 "수업 참여" 진입 = 학급 상세 대시보드 — 레퍼런스 teacher.html viewDetail 이관.
 * 좌: 메시지 패널(교사 간 소통) / 우: 학년별 수업 카드(담당 학년 + 수업 시작 CTA) + 활동지 목록.
 * 학년 카드의 "수업 시작"을 누르면 세션을 시작하고 라이브 뷰(?group=N)로 이동.
 */

/** 좌측 메시지 패널 항목 — 지금은 학생 질문(수업 채팅)만 들어온다 */
/** 학년별 마스코트 세로 미세조정 — 그림마다 여백이 달라 눈으로 맞춘 값 (ref .mc-mascot) */
const GRADE_MASCOT_NUDGE: Record<number, number> = { 1: 14, 2: 12, 3: 2, 4: 7, 5: 5, 6: 4 }

export function TeacherClassDetailPage() {
  const navigate = useNavigate()
  const { classroomId } = useParams()
  const showToast = useToastStore((s) => s.show)

  // 진행 중인 수업 — 학년 카드의 상태와 CTA가 여기서 나온다 (더 이상 학년 번호로 흉내내지 않는다)
  const active = useActiveSession(classroomId)
  /** 내 userId — 이 수업을 연 사람이 나인지 가르는 기준 (아래 `blocked`) */
  const myUserId = useAuthStore((s) => s.user?.id ?? null)

  /**
   * 동료가 수업을 열거나 끝내면 **새로 고치지 않고** 카드에 반영한다.
   *
   * 예전에는 이 화면이 아무 이벤트도 듣지 않아서, 옆 선생님이 1학년 수업을 시작해도 내
   * 화면은 '수업 가능'인 채였다. 새로 고쳐야 '수업중'이 떴고, 그 전까지는 열려 있는 수업에
   * 대고 또 시작하려 들게 된다.
   *
   * 서버가 이 두 이벤트를 **학급 구성원 전원**의 개인 채널로 보낸다. 수업 토픽이 아니라
   * 개인 채널이라 그 방에 들어가 있지 않아도 받는다 — 이 화면이 딱 그 경우다.
   *
   * 받으면 상태를 직접 만지지 않고 `refresh()` 로 서버에 다시 묻는다. 이벤트에는 학년이
   * 없어서 어느 카드가 바뀌는지 화면이 알 수 없고, 추측해서 만든 값은 진짜 목록과 어긋난다.
   */
  const onSessionEvent = useCallback(
    (event: ServerEvent) => {
      if (event.event !== 'SESSION_STARTED' && event.event !== 'SESSION_ENDED') return
      if (event.classroomId != null && String(event.classroomId) !== String(classroomId)) return
      active.refresh()
    },
    [classroomId, active],
  )
  /* 수업을 구독하지 않는다(sessionId: null) — 이 화면이 필요한 것은 개인 채널뿐이다 */
  useClassroomSocket({ sessionId: null, onEvent: onSessionEvent })
  /** 학급에 수업이 하나라도 열려 있는가 — 패널 머리의 안내문에만 쓴다 */
  const isLive = active.sessions.length > 0
  /**
   * 지금 선생님이 **들어가 있는** 학년 방 — 그 카드만 회색 '수업중' 이 되고 잠긴다.
   *
   * 이 화면은 **읽기만 한다.** 값을 넣고 지우는 쪽은 라이브 화면(`TeacherClassroomPage`)이다 —
   * 방을 나오면 지워져야 하는 값이라 방 안에 있는 화면이 소유하는 게 맞다.
   *
   * 서버가 수업의 학년을 알게 된 지금도 이 값은 남는다. 서버가 아는 것은 "이 수업이 몇 학년
   * 것인가"이지 "내가 그 방에 지금 떠 있는가"가 아니다 — 회색·잠금이 가리키는 건 후자다.
   */
  const liveGrade = useLiveGrade(classroomId, active.sessionId)
  /* '돌아올 길'(fromState) 을 남길 이유가 없어졌다 — 이 화면에서 같은 깊이로 새어나가는 링크가
     과제 관리로 가던 '새 과제 만들기' 하나뿐이었고, 그 자리는 이제 모달이다 */

  const classroom = useClassroomsStore((s) => (classroomId ? s.getById(classroomId) : undefined))
  const classroomsLoaded = useClassroomsStore((s) => s.loaded)
  const loadClassrooms = useClassroomsStore((s) => s.load)
  const setStatus = useClassroomsStore((s) => s.setStatus)
  useEffect(() => {
    if (!classroomsLoaded) void loadClassrooms()
  }, [classroomsLoaded, loadClassrooms])

  /** 과제 만들기 마법사를 이 화면에서 띄운다 (ModalHost 가 그린다) */
  const openModal = useOpenModal()

  const byClassroom = useStudentsStore((s) => s.byClassroom)
  const loadStudents = useStudentsStore((s) => s.load)
  useEffect(() => {
    if (classroomId) void loadStudents(classroomId)
  }, [classroomId, loadStudents])
  const students = useMemo<StudentAccount[]>(
    () => (classroomId ? (byClassroom[classroomId] ?? []) : []),
    [byClassroom, classroomId],
  )

  const [assignments, setAssignments] = useState<AssignmentSummary[]>([])
  const loadAssignments = useCallback(() => {
    if (!classroomId) return
    void assignmentApi
      .listAssignments(classroomId)
      .then(setAssignments)
      .catch(() => setAssignments([]))
  }, [classroomId])
  useEffect(loadAssignments, [loadAssignments])

  /*
    과제 만들기 모달이 닫히면 목록을 다시 받는다 — 만든 과제가 이 화면에 반영돼야 한다.
    모달마다 콜백을 심는 통로가 없어 **모달 스택이 비는 순간**을 신호로 쓴다.

    `modalCount === 0` 만 보면 첫 진입에도 참이라 목록을 두 번 받는다(위 첫 로드와 겹친다).
    그래서 **열려 있다가 닫힌 전환**만 본다.

    새로 만든 과제는 **초안(비공개)** 이라 이 카드(활동지 = 공개된 것만)에는 바로 뜨지 않는다.
    마법사가 저장 후 "목록에서 공개하면 학생이 볼 수 있어요" 라고 알려 주므로 여기서 또
    설명하지 않는다.
  */
  const modalCount = useModalStore((s) => s.stack.length)
  const prevModalCount = useRef(modalCount)
  useEffect(() => {
    const justClosed = prevModalCount.current > 0 && modalCount === 0
    prevModalCount.current = modalCount
    if (justClosed) loadAssignments()
  }, [modalCount, loadAssignments])

  const countByGrade = useMemo(() => {
    const map = new Map<number, number>()
    for (const s of students) map.set(s.grade, (map.get(s.grade) ?? 0) + 1)
    return map
  }, [students])

  /**
   * 이 학급이 담당하는 학년 — 학년별 수업 카드는 **이 학년만** 렌더한다(1~6 전부가 아니라).
   * 서버 필드다(S15P11A407-124). 학생 명단에서 유도하던 예전 방식(resolveGrades)은 제거됐다.
   */
  /* 매 렌더 새 배열을 만들면 이 값을 의존성으로 쓰는 학년 판정·필터가 매번 다시 계산된다 */
  const classGrades = useMemo(() => classroom?.grades ?? [], [classroom])

  /**
   * 학년 → 그 학년의 진행 중 수업.
   *
   * **이 화면의 중심이 된 값이다.** 서버가 수업마다 학년을 주기 시작하면서(V31) 학년 카드는
   * 각자 자기 수업을 갖는다 — 1학년 수업이 돌아도 3학년 카드는 여전히 '수업 가능'이고,
   * 누르면 3학년 수업이 새로 열린다. 두 수업은 나란히 돈다.
   *
   * 학년 없는 수업(= 학급 전체. V31 이전에 시작돼 아직 안 끝난 수업)은 **모든 학년에 걸어 둔다.**
   * 그게 살아 있는 동안에는 어느 학년도 새로 열 수 없어서다(서버가 409 로 막는다) — 카드에
   * '수업 가능'이라 띄워 놓고 누르면 실패하는 것보다, 그 수업으로 들여보내는 편이 정직하다.
   */
  const sessionByGrade = useMemo(() => {
    const wholeClass = active.sessions.find((s) => s.grade === null)
    const map = new Map<number, (typeof active.sessions)[number]>()
    for (const g of classGrades) {
      const found = active.sessions.find((s) => s.grade === g) ?? wholeClass
      if (found) map.set(g, found)
    }
    return map
  }, [active.sessions, classGrades])

  const ongoingByGrade = useMemo(() => {
    const map = new Map<number, number>()
    for (const a of assignments) {
      /* 새 과제는 `grade` 필드를 갖는다. 제목 파싱은 그 필드가 생기기(V21) 전에 만들어진
         과제를 위한 폴백이다 — 그때는 학년이 제목 앞에 문자열로만 있었다. */
      const g = a.grade ?? gradeFromTitle(a.title)
      if (g && a.published) map.set(g, (map.get(g) ?? 0) + 1)
    }
    return map
  }, [assignments])

  /*
    메시지 목록·검색·이력 조회는 모두 ClassMessagesPanel 이 갖고 있다.
    예전엔 여기서 이력을 뽑아 "마지막 메시지 미리보기"만 그리고, 누르면 /teacher/chat 으로
    보냈다 — 이제 그 패널 안에서 대화까지 끝낸다.
  */
  /**
   * '활동지' 카드는 **공개된 과제만** 보여준다.
   *
   * 서버는 선생님에게 초안까지 전부 준다(학생에게는 공개분만). 초안은 아직 아무에게도 안 나간
   * 것이라 "학급에 준 활동지" 목록에 끼면 안 된다 — 초안을 다루는 자리는 과제 관리 화면이다.
   */
  const publishedAssignments = useMemo(() => assignments.filter((a) => a.published), [assignments])

  /**
   * 이 과제의 대상 학년들 — **서버가 정한 값만 믿는다** (V23 `targetGrades`).
   *
   * 빈 배열은 "학년 제한 없음" 곧 학급 전체이고, 그때는 어느 학년 탭에서도 숨기지 않는다 —
   * 서버의 학생 조회도 같은 규칙이다(`targetGrades`·`targetStudentIds` 가 둘 다 비면 학급 전체).
   *
   * 예전에는 제출 현황에서 학년을 **역추론**했다 — 그 과제를 내야 하는 학생 전원의 학년을
   * 모아 대상으로 삼는 방식이다. 그런데 학급 전체에게 준 과제는 학생 전원이 대상이라 학급의
   * 모든 학년이 딸려 나왔고, 1학년에서 만든 과제가 5학년 탭에도 떴다. 게다가 그 근거를 얻자고
   * **공개된 과제 1건당 요청 1개**를 더 보내고 있었다 — 서버가 대상 학년을 직접 주는 지금
   * 그 왕복은 통째로 필요 없다. (과제 관리 화면도 같은 이유로 이미 역추론을 걷어냈다)
   *
   * `targetGrades` 가 null 인 것은 선생님 응답이 아닐 때뿐이라, 그때만 옛 보조 수단으로
   * 내려간다 — 표시용 `grade`, 그다음 제목 표기(V21 이전 과제의 흔적), 그래도 모르면
   * 단식학급일 때만 그 학년.
   */
  const gradesOf = useCallback(
    (a: AssignmentSummary): number[] => {
      if (a.targetGrades) return [...a.targetGrades].sort((x, y) => x - y)
      const known = a.grade ?? gradeFromTitle(a.title)
      if (known) return [known]
      return classGrades.length === 1 ? [classGrades[0]] : []
    },
    [classGrades],
  )

  const availableGrades = classGrades
  /** null = 아무 학년도 안 누른 상태 = **전체**(담당 학년이 함께 보인다) */
  const [gradeFilter, setGradeFilter] = useState<number | null>(null)

  /**
   * 카드에 실제로 그릴 목록.
   *
   * 0) **대상 학년이 비어 있으면 그대로 통과** — 학급 전체에게 준 과제다.
   *    예전에는 이 걸음이 없어서 2)의 `gs.includes(gradeFilter)` 가 빈 배열에 대해 늘 false 였고,
   *    학년 버튼을 누르는 순간 학급 전체 과제가 활동지 칸에서 통째로 사라졌다.
   * 1) **이 학급 학년에게 준 것만** — 대상 학년이 정해져 있는데 학급 담당 학년에 하나도 없으면
   *    뺀다 (예: 제목이 "3학년…"인데 학급은 5·6학년).
   * 2) 학년 버튼을 눌렀으면 그 학년이 대상에 든 것만. 한 과제가 두 학년 대상일 수 있어
   *    같음(===)이 아니라 포함(includes)으로 본다.
   */
  const visibleAssignments = useMemo(
    () =>
      publishedAssignments.filter((a) => {
        const gs = gradesOf(a)
        if (gs.length === 0) return true
        if (!gs.some((g) => classGrades.includes(g))) return false
        return gradeFilter === null || gs.includes(gradeFilter)
      }),
    [publishedAssignments, gradesOf, classGrades, gradeFilter],
  )

  /**
   * 학년 카드 CTA — "수업 시작"과 "수업 들어가기"를 겸한다.
   *
   * 백엔드는 **세션이 학급당 1개**다(중복 시 409). 즉 학년은 세션을 나누는 단위가 아니라
   * 그 세션 안에서 지금 집중할 모둠(?group=N)일 뿐이다. 그래서
   *  - 진행 중인 수업이 있으면 새로 만들지 않고 **그 수업으로 들어간다**
   *  - 없으면 시작한 뒤 들어간다 (그 사이 다른 기기에서 열렸다면 409 → 열린 수업으로 합류)
   */
  /** 선생님 초대(공동 관리자) — ref 배너의 `선생님 초대` 버튼이 여는 모달 */
  const [showInvite, setShowInvite] = useState(false)

  const [busyGrade, setBusyGrade] = useState<number | null>(null)
  /**
   * 동료 선생님이 진행 중이라 내가 들어갈 수 없는 학년들 (403 `not-session-teacher`).
   *
   * **학급이 아니라 학년 단위다.** 학년별로 수업이 따로 도는 지금(V31), 1학년을 동료가 맡고
   * 있다고 해서 3학년까지 잠그면 안 된다 — 3학년은 내가 새로 열 수 있다.
   *
   * 눌러 보기 전에는 알 수 없다(`ActiveSession` 에 시작한 사람이 없다). 그래서 한 번 막힌
   * 뒤에 켜지고, 그 학년 수업이 끝나면 아래 effect 가 푼다.
   */
  /**
   * 내가 이 학급에서 이미 열어 둔 수업 — 없으면 null.
   *
   * 선생님 한 명이 두 교실에 동시에 있을 수는 없다. 이 값이 있으면 다른 학년 카드의
   * '수업 시작하기'를 잠근다(아래 `busyElsewhere`). 잠그지 않으면 수업 중에 잠깐 나온
   * 선생님이 옆 학년에 빈 방을 하나 더 열게 되고, 그 방은 아무도 안 끄면 계속 남는다.
   *
   * `liveGrade`(내가 그 방 화면에 떠 있는가)와는 다른 값이다. 그건 화면을 떠나면 지워지는데,
   * 여기서 알아야 하는 것은 **서버에 내 수업이 열려 있는가**다 — 잠깐 나온 사이에도 참이다.
   */
  const myOpenSession = useMemo(
    () =>
      active.sessions.find((s) => s.startedById != null && s.startedById === myUserId) ?? null,
    [active.sessions, myUserId],
  )

  const [blockedGrades, setBlockedGrades] = useState<number[]>([])
  useEffect(() => {
    // 그 학년 수업이 끝났으면 잠금을 푼다 — 이제 내가 새로 열 수 있다.
    // 학급 단위로 지우면, 옆 학년 수업 하나가 끝났다고 내가 못 들어가는 학년까지 풀린다.
    setBlockedGrades((prev) => prev.filter((g) => sessionByGrade.has(g)))
  }, [sessionByGrade])

  /**
   * 수업 주제를 묻는 창이 열려 있는 학년.
   *
   * 주제는 **수업을 시작할 때 한 번** 정하고 끌 때까지 그대로 간다(수업 중에 바꾸지 않는다).
   * 그래서 창은 "새로 시작하는 순간"에만 뜨고, 이미 주제가 정해진 수업에 다시 들어갈 때는
   * 묻지 않고 바로 통과한다 — `askTopicThenEnter` 참고.
   *
   * `live`(내가 이미 들어가 있는 방)는 CTA 자체가 잠겨 있어 여기까지 오지 않는다.
   */
  const [topicGrade, setTopicGrade] = useState<number | null>(null)
  const setLessonTopic = useLessonTopicStore((s) => s.setTopic)

  /**
   * @param topic 주제 창에서 받은 값. `undefined` 면 "주제를 정하는 단계가 아니다"(다시 들어가기)라
   *              저장을 건너뛴다. 빈 문자열은 '주제 없이 시작' 이라 저장 대신 삭제가 된다.
   */
  async function enterGrade(grade: number, topic?: string) {
    if (!classroomId || busyGrade !== null) return
    setBusyGrade(grade)
    try {
      /*
        **이 학년의 수업**을 찾아 들어간다. 없으면 그 학년으로 새로 연다 — 옆 학년 수업이
        돌고 있어도 상관없다(V31). 학년을 안 넘기면 서버가 학급 전체 수업으로 알아듣고,
        옆 학년이 열려 있다는 이유로 409 가 난다.
      */
      let sid = sessionByGrade.get(grade)?.id ?? null
      if (sid === null) {
        try {
          sid = (await sessionApi.startSession(classroomId, grade)).id
        } catch (err) {
          if (!axios.isAxiosError(err) || err.response?.status !== 409) throw err
          // 그 사이 다른 기기·다른 선생님이 이 학년 수업을 열었다 — 만들지 말고 그 수업으로
          const detail = await classroomApi.getClassroom(classroomId)
          sid =
            detail.activeSessions.find((s) => s.grade === grade)?.id ??
            detail.activeSessions.find((s) => s.grade === null)?.id ??
            null
        }
      }
      if (sid === null) {
        /*
          409(이미 열려 있다)를 받고 다시 물었는데 그 학년 수업도, 학급 전체 수업도 없다.
          내가 누르는 사이에 그 수업이 끝난 경우가 대부분이라, "다시 눌러 보라"가 맞는 안내다.

          예전에는 여기서 `new Error(...)` 를 던졌고, 그게 apiErrorMessage 로 흘러가
          **"인터넷 연결이 불안정해요"** 로 둔갑했다 — 연결은 멀쩡한데 회선을 의심하게 만들었다.
        */
        showToast('수업 정보가 바뀌었어요. 화면을 새로 고친 뒤 다시 눌러 주세요.')
        active.refresh()
        return
      }
      active.setSessionId(sid)
      /*
        주제는 **세션 id 를 알게 된 뒤에** 저장한다(키가 `sessionId:grade` 다). 세션을 열기
        전에는 붙일 곳이 없고, 세션에 매달아 두면 수업을 끝냈을 때 지난 주제가 다음 수업으로
        따라오지 않는다.

        이제 **서버에도 보낸다**(S15P11A407-146) — 그래야 학생 화면과 다른 선생님 화면에도
        같은 주제가 뜬다. 로컬 캐시는 먼저 채워 둔다: 서버 왕복을 기다리며 라이브 화면으로
        넘어가면 제목이 한 박자 늦게 뜬다.

        **주제 저장이 실패해도 수업 입장은 막지 않는다.** 주제는 제목 한 줄이고 수업은 수업이다 —
        제목을 못 붙였다고 아이들을 기다리게 할 이유가 없다. 대신 조용히 넘기지 않고 말해 준다
        (선생님은 적었다고 믿는데 학생 화면에는 안 뜨는 상태가 되기 때문이다).
      */
      if (topic !== undefined) {
        setLessonTopic(sid, grade, topic)
        try {
          await sessionApi.setTopic(sid, grade, topic)
        } catch (err) {
          showToast(apiErrorMessage(err, '수업 주제를 저장하지 못했어요. 제목 없이 시작해요.'))
        }
      }
      /*
        "이 방에 들어와 있다"는 표시는 여기서 하지 않는다 — 도착한 라이브 화면이 뜨면서
        스스로 남기고, 나갈 때 스스로 지운다. 여기서도 남기면 소유자가 둘이 되어
        이동이 실패했을 때 지워 줄 사람이 없다.
      */
      navigate(teacherRoutes.live(classroomId, { group: grade, session: sid }))
    } catch (err) {
      /*
        **수업을 시작한 선생님만 들어갈 수 있다** (S15P11A407-147). 복식학급을 둘이 관리하면
        동료가 먼저 수업을 연 상태가 정상적으로 생기는데, 그때 join 이 403 `not-session-teacher`
        로 막힌다. 이건 고장이 아니라 상태다 — "잠시 후 다시 시도" 라고 말하면 몇 번이고 다시
        누르게 된다. 무엇이 일어난 것인지 말하고, 카드를 잠가 헛수고를 막는다.

        시작한 사람이 누구인지는 미리 알 수 없다(`ActiveSession` 에 그 필드가 없어서 눌러 보기
        전에는 판정할 길이 없다). 그래서 한 번 막힌 뒤에야 잠근다.
      */
      if (errorSlug(err) === 'not-session-teacher') {
        // 학년 단위로 잠근다 — 옆 학년은 내가 얼마든지 열 수 있다
        setBlockedGrades((prev) => (prev.includes(grade) ? prev : [...prev, grade]))
        showToast('지금 수업은 다른 선생님이 진행 중이에요. 그 선생님이 끝내면 들어갈 수 있어요.')
      } else {
        showToast(apiErrorMessage(err, '수업을 열지 못했어요. 잠시 후 다시 시도해 주세요.'))
      }
    } finally {
      setBusyGrade(null)
    }
  }

  /**
   * 학년 카드 CTA — 주제를 물을지 말지 여기서 갈린다.
   *
   * **주제 창은 수업을 여는 순간에만 뜬다.** 이미 도는 수업으로 돌아가는 길에는 묻지 않는다 —
   * 주제는 수업 하나에 한 번 정하는 값이라, 잠깐 나갔다 올 때마다 창이 뜨면 이미 정한 것을
   * 다시 확인받는 셈이고 실수로 덮어쓸 위험도 생긴다.
   *
   * 판단 기준은 **이 학년 수업이 열려 있는가**다. 예전에는 "그 수업에 저장된 주제가 있는가"로
   * 봤는데 두 군데서 어긋났다.
   *  - `active.sessionId` 는 V31 이후 **학년과 무관하게 열린 것 중 하나**다. 5학년 카드를
   *    누르면서 1학년 수업의 주제를 뒤지고 있었다.
   *  - '주제 없이 시작'을 고른 수업은 저장된 주제가 없다. 그러면 돌아올 때마다 다시 물었다.
   * 그래서 수업 중에 잠깐 나왔다 돌아오면 처음 시작하는 것처럼 창이 떴다.
   */
  function askTopicThenEnter(grade: number) {
    if (sessionByGrade.has(grade)) {
      void enterGrade(grade)
      return
    }
    setTopicGrade(grade)
  }

  /* '전체 학생 보기' 를 지우면서 패널 헤더 액션(ghostBtn)도 쓰는 곳이 없어져 함께 지웠다 —
     학생 명단으로 가는 길은 사이드바의 '학생 관리' 가 그대로 갖고 있다 */
  /** 배너 우측 관리 액션 — ref `.btn` 기본 크기 (13px 22px / .92rem / min-height 44) */
  const topActionBtn =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-full p-[13px_22px] text-[.92rem] font-black whitespace-nowrap transition-transform duration-200 ease-bounce hover:-translate-y-0.5'

  return (
    /* 헤더(.topbar)는 얹지 않는다 — 이 화면은 자기 배너를 갖고 있다 (ref TOPBAR_VIEWS) */
    <TeacherShell active="home" classroomId={classroomId}>
      <>
        {/* 페이지 프레임 — 학급 안의 모든 것을 한 판에 담는다 (ref .page-frame) */}
        <div className="rounded-page border-2 border-frame bg-page p-6 shadow-card max-[640px]:p-4">
          {/*
            학급 배너 — 학교 일러스트 위에 흰 알약 문패를 띄운다 (ref .detail-topbar).
            bg.png 는 좌우에 투명 여백이 있어 배경 레이어를 살짝 밖으로 밀어야 끝까지 닿는다.
          */}
          <header
            aria-label="학급 정보와 관리 도구"
            className="relative mb-5 grid min-h-[158px] grid-cols-[1fr_auto_1fr] items-center gap-4 overflow-hidden rounded-card border-2 border-frame bg-band p-[22px_30px_12px] max-[1200px]:grid-cols-1 max-[1200px]:justify-items-center max-[1200px]:gap-3.5 max-[1200px]:p-[22px]"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 -inset-x-[1.08%] z-0 bg-[url('/assets/bg.webp')] bg-cover bg-[position:50%_70%] bg-no-repeat"
            />

            <Button
              variant="back"
              className="relative z-[1] justify-self-start self-end whitespace-nowrap p-[12px_20px] text-[.9rem] font-bold [&_svg]:h-[15px] [&_svg]:w-[15px] max-[1200px]:justify-self-center"
              onClick={() => navigate(teacherRoutes.home)}
            >
              <Icon name="back" className="h-[15px] w-[15px]" />
              학급 목록으로
            </Button>

            {/* 문패 — 라벤더 링으로 일러스트와 분리하고 살짝 위로 띄운다 */}
            {/* 흰 테두리 링만 남기고 보라 링은 뺐다 (ref .detail-chip 그림자) */}
            <div className="relative z-[1] -mt-9 flex min-w-0 items-center gap-4 self-center rounded-full bg-card p-[14px_34px_14px_14px] shadow-[0_0_0_5px_rgba(255,255,255,.85),0_12px_26px_rgba(46,49,55,.10)] max-[1200px]:mt-0">
              <span
                aria-hidden="true"
                className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-sky text-[1.35rem] max-[720px]:hidden"
              >
                🌼
              </span>
              <div className="min-w-0 text-center">
                <h1 className="truncate text-section-title font-black leading-[1.15] tracking-[-.4px]">
                  {classroom?.name ?? '학급'}
                </h1>
                {/*
                  수업 상태('수업 준비됨'/'수업 진행 중')는 뺐다 — 진행 여부는 아래 학년별 수업
                  카드가 '수업중' 배지와 CTA 문구로 이미 말한다. 문패는 **이 학급이 무엇인지**만
                  적는다.
                */}
                <span className="mt-1 block text-[.8rem] font-bold text-ink-soft">
                  학생 {students.length}명
                </span>
              </div>
            </div>

            <div className="relative z-[1] flex flex-wrap justify-self-end self-end gap-2.5 max-[1200px]:justify-self-center">
              {/*
                '학급 관리' 버튼은 뺐다. 학급 관리로 가는 길은 이미 네 곳이나 있다 —
                사이드바 설정(TeacherSidebar), 학급 선택(TeacherPickClassPage),
                내 학급 카드 메뉴(TeacherHomePage), 라이브 화면(TeacherClassroomPage).
                이 배너는 지금 이 학급에서 **할 일**(초대·종료)만 남긴다.
              */}
              <button
                type="button"
                onClick={() => setShowInvite(true)}
                className={`${topActionBtn} bg-sky text-primary hover:bg-sky-deep`}
              >
                <Icon name="mail" className="h-[17px] w-[17px]" />
                선생님 초대
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!classroomId) return
                  const ok = await confirmAction({
                    title: `'${classroom?.name ?? '이 수업'}'을 닫을까요?`,
                    message:
                      '학생들은 더 이상 입장할 수 없어요.\n학생 계정과 지난 기록은 그대로 남아요.',
                    confirmLabel: '학급 종료',
                    danger: true,
                  })
                  if (!ok) return
                  void setStatus(classroomId, 'CLOSED')
                  navigate(teacherRoutes.home)
                }}
                className={`${topActionBtn} bg-danger text-white shadow-card hover:brightness-95`}
              >
                <Icon name="close" className="h-[17px] w-[17px]" />
                학급 종료
              </button>
            </div>
          </header>

          {/*
            대시보드: 좌 메시지 400px | 우 학년별 수업 + 오늘의 활동.

            세 카드의 **아랫변이 정확히 맞아야 한다.** ref 는 렌더 후 JS 로 높이를 재서
            `todayCard.height = frameHeight` / `msgPanel.height = frameHeight * 2 + 20` 을
            직접 박아 넣는다(teacher.html:4064-4072). 우리는 같은 결과를 CSS 로 얻는다 —
            오른쪽을 `1fr 1fr` 두 줄 그리드로 두면 두 카드가 같은 높이가 되고,
            바깥 그리드가 stretch 라 왼쪽 메시지 패널이 그 합(두 줄 + gap)까지 늘어난다.
            고정 높이(772px/345px)를 쓰면 카드 개수·내용이 달라질 때마다 아랫변이 어긋난다.
          */}
          <div className="grid grid-cols-[400px_minmax(0,1fr)] items-stretch gap-5 max-[1120px]:grid-cols-1">
            {/*
              LEFT: 메시지 패널 — 이 자리에서 바로 대화한다 (예전엔 /teacher/chat 으로 이동했다)

              **패널은 이 행을 채우기만 하고, 행 높이는 오른쪽 열이 혼자 정한다.**
              예전엔 대화가 길어지면 패널이 그만큼 늘어나고 `items-stretch` 때문에 같은 행의
              학년별 수업 카드까지 함께 늘어났다 — 그 카드는 내용이 그대로인데 아래만 비었다.
              래퍼를 `relative` 로 두면 래퍼의 고유 높이가 0 이라 행 크기 계산에 끼지 않고,
              `absolute inset-0` 인 패널이 정해진 행을 정확히 채운다(넘치는 대화는 패널 안에서
              스크롤 — 내부가 이미 `min-h-0 flex-1 overflow-y-auto` 다).
              한 열로 쌓이는 좁은 화면에서는 absolute 를 풀고 예전처럼 고정 높이를 준다.
            */}
            <div className="relative max-[1120px]:h-[560px]">
              {/*
                껍데기는 **행 높이만큼의 자리**다(absolute inset-0). 그 안에서 패널은
                두 가지를 지킨다:

                - `max-h` : 보이는 칸(셸 콘텐츠 = 100dvh − 셸 위아래 패딩 48px)보다 길어지지 않는다.
                  예전엔 패널이 오른쪽 열 높이(학년별 수업 + 오늘의 활동)만큼 늘어나서, 그 합이
                  화면보다 크면 **패널 바닥에 있는 입력창이 화면 밖에 있었다.** 대화를 읽고
                  답장하려면 아래로 스크롤해서 입력창을 찾아야 했다(내부 스크롤은 목록 몫이라
                  도움이 안 된다).
                - `sticky top-0` : 오른쪽을 내려 보는 동안에도 패널이 화면에 남는다. 대화는
                  "옆에 두고 계속 쓰는 것"이라 스크롤과 함께 사라지면 안 된다.

                행이 화면보다 짧으면(넓은 모니터) `h-full` 이 그대로 이겨서 예전과 똑같이
                오른쪽 카드들과 아랫변이 맞는다. 행이 화면보다 길 때만 위 규칙이 작동한다 —
                그때는 아랫변을 맞추는 것보다 입력창이 보이는 게 중요하다.
              */}
              <div className="absolute inset-0 max-[1120px]:static max-[1120px]:h-full">
                <ClassMessagesPanel
                  className="sticky top-0 h-full max-h-[calc(100dvh-48px)] max-[1120px]:static max-[1120px]:max-h-none"
                  sessionId={active.sessionId}
                  classroomId={classroomId ?? ''}
                  students={students}
                />
              </div>
            </div>

            {/*
              RIGHT: 학년별 수업 + 오늘의 활동.

              아래 줄을 `auto` 로 둔다 — 오늘의 활동은 이제 **과제 5줄에 맞춘 고정 높이**라
              자기 크기를 스스로 안다. 예전처럼 `1fr 1fr` 로 두면 위 카드 높이에 끌려가
              고정해 둔 목록 아래에 빈 공간만 늘어난다. 왼쪽 메시지 패널은 바깥 그리드가
              stretch 라 여전히 두 카드 합만큼 늘어나므로 아랫변은 그대로 맞는다.
            */}
            <div className="grid grid-rows-[1fr_auto] gap-5 max-[1120px]:grid-rows-[auto_auto]">
              {/* 학년별 수업 카드 프레임 */}
              <div className="flex min-h-0 flex-col overflow-hidden rounded-card border-[1.5px] border-panel-line bg-white shadow-panel">
                {/* 제목줄은 하늘색 밴드 (ref .module-head) */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-sky p-[22px_28px]">
                  <h2 className="flex items-center gap-2 text-panel-title font-black">
                    <Icon name="compass" className="h-7 w-7 text-primary" />
                    학년별 수업
                  </h2>
                  {/*
                    수업이 열려 있을 때만 띄운다. 학급의 수업은 하나이고 학년 카드는 그 안에서
                    집중할 모둠이라는 것을 여기서 한 번 말해 둔다 — 이 말이 없으면 한 학년에서
                    수업을 끝냈을 때 다른 학년까지 끝나는 것이 고장으로 보인다.
                    수업이 없을 때는 설명할 것도 없어 자리만 차지하므로 숨긴다.
                  */}
                  {isLive && (
                    <p className="text-[.82rem] font-bold text-primary">
                      이 학급은 수업 하나로 진행돼요. 학년 카드는 그 안의 모둠이에요.
                    </p>
                  )}
                </div>

                {/*
                  학년이 1개여도 칸은 2열을 유지한다 — 카드가 가로로 늘어나면 마스코트·여백 비율이
                  깨져서 다른 학급과 다른 컴포넌트처럼 보인다. 빈 칸은 그대로 둔다.
                */}
                <div className="grid flex-1 grid-cols-2 content-start gap-6 p-[26px_28px_28px] max-[560px]:grid-cols-1">
                  {classGrades.length === 0 && (
                    <p className="col-span-full py-6 text-center text-[.9rem] font-semibold text-ink-mute">
                      담당 학년이 아직 없어요.
                      <br />
                      학생을 등록하면 학년별 수업이 여기 나타나요.
                    </p>
                  )}
                  {classGrades.map((grade) => {
                    /*
                      '수업중' 배지는 **학급에 수업이 있다**는 뜻이라 열려 있으면 모든 카드에
                      붙는다. 실제로 학급의 수업은 하나뿐이라 그게 사실이다.

                      카드끼리 갈리는 것은 그 다음이다 — **내가 이 학년 방에 들어가 있는가.**
                      들어가 있으면 회색으로 잠기고(`live`), 아니면 학년색으로 열려 있다(`join`).
                      서버 세션에 학년이 없어 이 판단만은 화면이 기억한다(useLiveGradeStore).

                      한때 반대로 갔던 적이 있다. 열린 수업이 있으면 여섯 장이 전부 '수업중'으로
                      떠서 그걸 "들어가 있는 학년 하나"로 좁혔는데, 그러면 5학년 카드가
                      '수업 가능'이 되어 수업이 없는 것처럼 보였다. 배지는 수업의 유무를,
                      버튼은 내 위치를 말하게 나눈 것이 지금이다.
                    */
                    /*
                      카드 상태는 셋이고 색·배지·버튼이 모두 여기서 갈린다 (lib/subject 참고):
                        idle  수업 없음           학년색 · '수업 가능' · [수업 시작하기]     · 눌림
                        live  수업 중 · 방에 사람  **회색** · '수업중'   · [수업 중]           · **잠김**
                        join  수업 중 · 방은 빔    학년색 · '수업중'   · [이 수업 들어가기] · 눌림
                    */
                    // 카드마다 **자기 학년의 수업**을 본다 — 학급에 수업이 있는지가 아니다
                    const state = gradeCardState(sessionByGrade.has(grade), liveGrade === grade)
                    const cta = GRADE_CARD_CTA[state]
                    /*
                      동료 선생님이 시작한 수업은 **참가할 수 없다**(403 `not-session-teacher`).
                      `live` 와 같은 회색·잠금으로 그린다 — 둘 다 "들어갈 데가 없다"는 같은 뜻이고,
                      색을 새로 만들면 선생님이 회색의 뜻을 두 가지로 외워야 한다.

                      `join`(수업 중 · 내가 그 방에 없음)일 때만 따진다: `idle` 이면 열린 수업이
                      없으니 내가 시작할 수 있고, `live` 면 이미 내가 들어가 있는 방이다.
                    */
                    /*
                      **누가 열었는지는 서버가 알려준다**(`startedById`). 예전에는 그 값이
                      없어서 눌러 보고 403 을 받아야만 잠겼다 — 들어갈 수 없는 수업에 대고
                      한 번씩 헛걸음을 하게 만드는 셈이었다. 이제 목록을 받는 순간 갈린다.

                      `blockedGrades`(403 을 받아 본 학년)는 그대로 둔다: 옛 응답에는
                      `startedById` 가 없고, 서버가 막는 이유가 늘어날 수도 있다.
                      두 근거 중 하나라도 "못 들어간다"면 못 들어가는 것이다.
                    */
                    const starter = sessionByGrade.get(grade)?.startedById
                    const startedByOther =
                      starter != null && myUserId != null && starter !== myUserId
                    const blocked =
                      (blockedGrades.includes(grade) || startedByOther) && state === 'join'
                    /* 403 으로만 알아낸 경우에는 이름이 없다 — 그때는 버튼이 '다른 선생님'이라 적는다 */
                    const blockedBy = startedByOther
                      ? sessionByGrade.get(grade)?.startedByName
                      : undefined
                    /*
                      **내가 이미 수업을 열어 뒀으면 다른 학년은 시작할 수 없다.**

                      선생님 한 명이 두 교실에 동시에 있을 수는 없다. 서버는 학년만 보고 막지
                      않으므로(그게 V31 의 목적이다 — 다만 그건 **다른 선생님**이 맡는 경우다)
                      여기서 막는다. 잠그지 않으면 수업을 하다 잠깐 나온 선생님이 옆 학년 카드를
                      눌러 빈 방을 하나 더 열어 두게 되고, 그 방은 아무도 안 끄면 계속 남는다.

                      `idle` 에만 건다. `join` 은 내가 하던 그 수업으로 돌아가는 길이라 막으면 안 된다.
                    */
                    const busyElsewhere =
                      state === 'idle' && myOpenSession != null && myOpenSession.grade !== grade
                    const locked = state === 'live' || blocked || busyElsewhere
                    /*
                      배지와 색은 **서로 다른 것**을 말한다. 한 값에 둘 다 얹으면 어긋난다.

                        배지(st)  = 이 학급에 수업이 있는가          → 있으면 모든 카드가 '수업중'
                        색·잠금(pal/locked) = 내가 여기 들어갈 수 있는가 → 못 들어가면 회색

                      예전에는 배지도 `locked` 를 따라갔다. 그래서 복식학급에서 1학년 수업을 연
                      선생님 눈에 5학년 카드가 '수업 가능'(초록)으로 보였고 — 잠기지 않았으니까 —
                      두 수업이 따로 도는 줄 알았다. 1학년 수업을 끝냈을 때 5학년까지 꺼지는 것이
                      고장으로 보인 이유가 이것이다. 학급의 수업은 처음부터 하나다(lib/subject).
                    */
                    const st = state === 'idle' ? STATUS.ready : STATUS.live
                    const pal = locked ? LIVE_GRADE_PALETTE : GRADE_PALETTE[grade]
                    return (
                      <div
                        key={grade}
                        style={{
                          background: pal.bg,
                          border: `1.5px solid ${pal.border}`,
                        }}
                        className="relative flex min-h-[280px] flex-col gap-3.5 overflow-hidden rounded-[22px] px-[22px] pt-[22px] shadow-[0_8px_20px_rgba(0,0,0,.14)]"
                      >
                        {/*
                          상단: 학년 + 상태 배지.

                          줄 높이는 **ref 를 따라 `normal`** 로 둔다(`.mc-title`·`.mc-status` 둘 다
                          line-height 를 안 준다). Tailwind preflight 가 html 에 건 1.5 를 그냥 두면
                          배지가 3px 두꺼워지고, 반대로 `leading-none` 을 주면 제목이 6px 얇아진다 —
                          둘이 합쳐져 아래 흰 패널이 색깔 영역을 파고든다.
                        */}
                        <div className="flex flex-col-reverse items-start gap-2">
                          <span className="text-[2.1rem] font-black">
                            {grade}학년
                          </span>
                          <span
                            style={{
                              background: st.badgeBg,
                              color: st.badgeText,
                              border: `1.5px solid ${st.badgeBorder}`,
                            }}
                            className="whitespace-nowrap rounded-full px-3 py-[5px] text-[.72rem] font-black"
                          >
                            {st.label}
                          </span>
                        </div>

                        {/* 하단 흰 패널 (마스코트가 위로 걸침) */}
                        <div className="relative mx-[-22px] mt-auto flex flex-col gap-3 rounded-t-2xl border-[1.5px] border-b-0 border-panel-line bg-white p-[16px_20px_20px]">
                          <span className="pointer-events-none absolute bottom-full right-2 z-[2]">
                            <img
                              src={gradePlantImage(grade)}
                              alt=""
                              aria-hidden="true"
                              decoding="async"
                              style={{
                                transform: `translateY(${GRADE_MASCOT_NUDGE[grade] ?? 0}px)`,
                              }}
                              className="h-[140px] w-[140px] object-contain"
                            />
                          </span>
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-[.88rem]">
                              <span className="font-bold text-ink-soft">학생 수</span>
                              <span className="font-black text-ink">
                                {countByGrade.get(grade) ?? 0}명
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[.88rem]">
                              <span className="font-bold text-ink-soft">진행 중 과제</span>
                              <span className="font-black text-ink">
                                {ongoingByGrade.get(grade) ?? 0}건
                              </span>
                            </div>
                          </div>
                          {/*
                            `live` 는 잠근다 — 이미 선생님이 있는 방이라 들어갈 데가 없다.
                            회색인데 hover 로 떠오르면 "잠긴 것 같은데 왜 반응하지" 가 되므로
                            **떠오르는 효과도 함께 끈다.** 흐리게(opacity) 만들지는 않는다 —
                            ref 도 `opacity:1` 이고, 회색만으로 이미 충분히 갈라진다.

                            `idle`·`join` 은 누르는 버튼이라 hover 로 살짝 뜬다.
                          */}
                          <button
                            type="button"
                            disabled={locked || busyGrade !== null}
                            /* 주제를 먼저 묻는다 — 이미 정해진 수업이면 묻지 않고 바로 들어간다 */
                            onClick={() => askTopicThenEnter(grade)}
                            style={{ background: pal.cta }}
                            /* `text-base` 가 아니라 `text-[1rem]` 인 이유: 이름 있는 글자 크기
                               유틸은 line-height(1.5rem)를 **함께** 싣는다. ref 의 `.mc-cta` 는
                               크기만 1rem 이고 줄 높이는 글꼴 기본값이라, 그대로 쓰면 5px 두꺼워진다. */
                            className={`flex min-h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-full p-[14px] text-[1rem] font-black text-white transition-transform duration-200 ease-bounce ${
                              locked
                                ? 'cursor-not-allowed'
                                : 'enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70'
                            }`}
                          >
                            <Icon name={blocked || busyElsewhere ? 'lock' : cta.icon} className="h-4 w-4" />
                            {/*
                              잠긴 이유를 버튼이 직접 말한다 — 회색만으로는 '수업 중'과
                              구별되지 않는다. 이름을 아는 경우엔 이름을 쓴다: 복식학급에서
                              "다른 선생님"이 누구인지 찾아다니지 않아도 된다.
                            */}
                            {blocked
                              ? blockedBy
                                ? `${blockedBy} 선생님이 진행 중`
                                : '다른 선생님이 진행 중'
                              : busyElsewhere
                                ? myOpenSession?.grade != null
                                  ? `${myOpenSession.grade}학년 수업 중이에요`
                                  : '수업을 진행 중이에요'
                                : busyGrade === grade
                                  ? cta.busy
                                  : cta.label}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/*
                활동지 (노란 카드) — 위 프레임과 같은 높이, 넘치면 목록만 스크롤 (ref .today-card).

                이름이 '오늘의 활동'이었는데 **날짜로 거르지 않는다** — 이 학급에 나간 활동지
                전체를 최근 순으로 보여준다(서버가 createdAt 내림차순). 이름이 사실과 어긋나
                '활동지'로 바꿨다.
              */}
              <div className="flex min-h-0 flex-col overflow-hidden rounded-card border-2 border-[#F6E3A8] bg-[#FAF3E3] shadow-card">
                <div className="flex flex-none flex-wrap items-center justify-between gap-3 bg-[#FEE9A7] p-[28px_22px]">
                  <h3 className="flex items-center gap-2 text-panel-title font-black">
                    <Icon name="calendar" className="h-7 w-7 text-task-deep" />
                    활동지
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {/*
                      학년 필터 — 이 카드는 **과제만** 보여준다(활동 피드 탭은 뺐다).

                      버튼은 학급이 담당하는 학년뿐이고 '전체' 버튼은 두지 않는다:
                      **아무것도 안 누른 상태가 곧 전체**다(두 학년이 함께 보인다). 누르면 그 학년만,
                      같은 버튼을 다시 누르면 전체로 돌아온다 — '전체' 버튼이 없으니 되돌리는 길을
                      토글이 맡아야 한다.
                    */}
                    {availableGrades.length > 1 && (
                      <div className="flex flex-wrap gap-1.5">
                        {availableGrades.map((g) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => setGradeFilter((prev) => (prev === g ? null : g))}
                            aria-pressed={gradeFilter === g}
                            data-active={gradeFilter === g}
                            className="whitespace-nowrap rounded-full border-[1.5px] border-[#F0DFA6] bg-white px-3 py-1.5 text-[.72rem] font-extrabold text-ink-soft data-[active=true]:border-ink data-[active=true]:bg-ink data-[active=true]:text-white"
                          >
                            {g}학년
                          </button>
                        ))}
                      </div>
                    )}
                    {/*
                      만들기는 **이 자리에서** — 모달이라 학급 화면을 떠나지 않는다.
                      예전엔 과제 관리 화면으로 데려갔다: 과제 하나 만들려고 화면을 옮기고,
                      만든 뒤에는 돌아오는 길을 다시 눌러야 했다. 라이브 수업 화면은 이미
                      같은 자리에서 모달을 연다(TeacherClassroomPage) — 규칙을 맞췄다.
                    */}
                    <button
                      type="button"
                      onClick={() =>
                        openModal({ type: 'assignmentWizard', classroomId: classroomId ?? '' })
                      }
                      className="inline-flex min-h-[38px] items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white p-[10px_16px] text-[.82rem] font-black text-task-deep shadow-[0_2px_8px_rgba(0,0,0,.08)] hover:bg-[#FFFBF0]"
                    >
                      <Icon name="plus" className="h-[17px] w-[17px]" />새 과제 만들기
                    </button>
                  </div>
                </div>
                {/*
                  목록 칸 높이는 고정이다(lib/teacherLayout 의 TODAY_LIST_H) — 카드 크기가 과제
                  수·학년 필터에 따라 흔들리지 않고, 넘치는 만큼은 페이지로 넘긴다.
                */}
                <div className="flex min-h-0 flex-1 p-[16px_12px]">
                  <div className="flex w-full flex-col rounded-[14px] bg-white p-[4px_16px_10px]">
                    {/*
                      학년 필터를 바꾸면 목록이 통째로 달라지므로 **페이지를 1로 되돌린다.**
                      key 로 새로 마운트시키는 편이 effect 로 되돌리는 것보다 확실하다 —
                      effect 는 한 번 그린 뒤에 고치는 거라 엉뚱한 페이지가 깜빡 보인다.
                    */}
                    <TodayAssignmentList
                      key={gradeFilter ?? 'all'}
                      assignments={visibleAssignments}
                      gradesOf={gradesOf}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {showInvite && classroomId && (
          <InviteTeacherModal classroomId={classroomId} onClose={() => setShowInvite(false)} />
        )}

        {/* 수업 시작 전 오늘의 주제 — 비워 두고 시작할 수도 있다(LessonTopicModal 주석) */}
        {topicGrade !== null && classroomId && (
          <LessonTopicModal
            grade={topicGrade}
            className={classroom?.name ?? '우리 반'}
            starting={busyGrade === topicGrade}
            onStart={(topic) => {
              setTopicGrade(null)
              void enterGrade(topicGrade, topic)
            }}
            onClose={() => setTopicGrade(null)}
          />
        )}
      </>
    </TeacherShell>
  )
}
