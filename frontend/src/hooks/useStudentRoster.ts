import { useEffect, useMemo, useState } from 'react'
import { assignmentApi } from '@/services/api/assignmentApi'
import { sessionApi } from '@/services/api/sessionApi'
import { useAssignmentStats } from '@/hooks/useAssignmentStats'
import type { AssignmentSummary } from '@/types/assignment'
import { assignmentTargetsStudent } from '@/lib/assignmentTarget'

/** 이 훅이 필요한 학생 정보 — 학년은 과제 대상 판정에 쓴다 */
export interface RosterStudent {
  userId: number
  grade: number
}

/** 학생 한 명의 목록용 지표 — 전부 **서버 값**이다 (지어낸 숫자가 아니다) */
export interface RosterRow {
  /** **가장 최근 수업**에 왔는가 — 목록의 O/X. 연 수업이 없으면 null */
  lastAttended: boolean | null
  /** 출석률 0~100. 정렬의 2차 기준으로만 쓴다 (목록에는 안 적는다) */
  attendanceRate: number | null
  /** 과제 제출률 0~100. 게시된 과제가 없으면 null */
  submitRate: number | null
}

/** 학생 한 명의 출석 조회 결과에서 화면이 쓰는 부분만 */
interface AttendanceBit {
  /** 누적 출석률 0~100. 연 수업이 없으면 null */
  rate: number | null
  /** **가장 최근 수업**에 왔는가. 수업이 없으면 null */
  lastAttended: boolean | null
}

export interface Roster {
  byStudent: Record<number, RosterRow>
  /** 학급 평균 출석률 — 수업이 없으면 null */
  avgAttendance: number | null
  /** 가장 최근 수업에 온 학생 수 — 수업이 없으면 null */
  presentCount: number | null
  /** 게시된 과제 중 **하나라도 안 낸** 학생 수 — 게시 과제가 없으면 null */
  notSubmittedCount: number | null
  /** 학급 전체 과제 제출률(낸 칸 / 내야 할 칸) — 게시 과제가 없으면 null */
  submitRate: number | null
  /**
   * 게시된 과제 수. **`null` 은 "아직 모름"** 이다 (조회 중이거나 실패).
   * 0 과 갈라 두지 않으면 화면이 로딩 중에 "아직 공개한 과제가 없어요" 라고 단정한다.
   */
  publishedCount: number | null
  /** 아직 받아오는 중 — 화면은 숫자 대신 `—` 를 둔다 */
  loading: boolean
}

/** 상태 초기값을 매번 새 객체로 만들지 않게 — 새 객체면 effect 가 헛돈다 */
const NO_ATTENDANCE: Record<number, AttendanceBit> = {}
const EMPTY_ASSIGNMENTS: AssignmentSummary[] = []

/**
 * 학생 관리 화면의 숫자를 한 곳에서 모은다 — 목록의 출석·제출률 열과 배너 통계가 같은 값을 쓴다.
 *
 * **예전에는 이 두 값이 없어서 `deriveStudent()` 가 해시로 지어냈다.** 그 숫자로 정렬까지 해서
 * 사실상 난수로 학생을 줄 세우고 있었다. 지금은 둘 다 실제 엔드포인트가 있다:
 *  - 출석 `GET /classrooms/{id}/students/{sid}/attendance` (S15P11A407-137 §11.3 #9)
 *  - 제출 `GET /assignments/{id}/submissions` — 과제마다 낸 사람 명단이 온다
 *
 * **호출 수가 서로 다르다.** 출석은 학생 단위라 명단 크기(N)만큼, 제출은 과제 단위라 게시된
 * 과제 수(A)만큼 부른다. 복식학급은 N 이 10~20 이라 감당되지만, 명단이 커지면 출석 쪽이 먼저
 * 부담이 된다 — 학급 단위 출석 집계 API 가 생기면 그걸로 갈아끼우면 된다.
 *
 * 학습 성취(정답률)는 **여기 두지 않는다.** 명세 §8 이 학생당 단일 이해도 점수 노출을 막는다 —
 * 제출률은 "얼마나 냈나"라 성취가 아니고, 이해도는 학급 관리의 히트맵과 개인 리포트가 맡는다.
 */
export function useStudentRoster(classroomId: string, students: RosterStudent[]): Roster {
  /** 명단이 같으면 다시 부르지 않게 — 배열은 렌더마다 새 객체다 */
  const idKey = useMemo(
    () => [...students].sort((a, b) => a.userId - b.userId).map((s) => s.userId).join(','),
    [students],
  )
  /** id → 학년. 과제가 그 아이에게 나갔는지 가리는 데 쓴다 */
  const gradeOf = useMemo(() => {
    const map = new Map<number, number>()
    for (const s of students) map.set(s.userId, s.grade)
    return map
  }, [students])

  /** `null` = 아직 모름 (조회 중이거나 실패). 빈 배열과 갈라 둔다 — 아래 주석 참고 */
  const [assignments, setAssignments] = useState<AssignmentSummary[] | null>(null)
  useEffect(() => {
    if (!classroomId) return
    let cancelled = false
    setAssignments(null)
    void assignmentApi
      .listAssignments(classroomId)
      .then((a) => !cancelled && setAssignments(a))
      // 실패도 `null` 이다 — `[]` 로 두면 "과제가 하나도 없다"는 **사실이 아닌 단정**이 된다
      .catch(() => !cancelled && setAssignments(null))
    return () => {
      cancelled = true
    }
  }, [classroomId])

  // 게시된 과제만 조회한다 (미게시는 학생에게 안 보이니 제출이 있을 수 없다)
  const stats = useAssignmentStats(assignments ?? EMPTY_ASSIGNMENTS)

  const [attendance, setAttendance] = useState<Record<number, AttendanceBit>>(NO_ATTENDANCE)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const ids = idKey ? idKey.split(',').map(Number) : []
    if (!classroomId || ids.length === 0) {
      setAttendance(NO_ATTENDANCE)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const miss: AttendanceBit = { rate: null, lastAttended: null }
    void Promise.all(
      ids.map((id) =>
        sessionApi
          .getAttendance(classroomId, id)
          .then((a) => {
            // 수업이 한 번도 없으면 서버가 0 을 준다 — 0% 로 적으면 "다 빠졌다"로 읽힌다
            if (a.totalSessions === 0) return [id, miss] as const
            // `sessions` 는 최근 수업이 먼저다 (types/session 주석)
            const last = a.sessions[0]
            return [id, { rate: a.attendanceRate, lastAttended: last?.attended ?? null }] as const
          })
          // 한 명이 실패해도 나머지는 보여준다 — 그 칸만 `—` 가 된다
          .catch(() => [id, miss] as const),
      ),
    ).then((rows) => {
      if (cancelled) return
      setAttendance(Object.fromEntries(rows))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [classroomId, idKey])

  return useMemo(() => {
    const ids = idKey ? idKey.split(',').map(Number) : []
    const published = (assignments ?? []).filter((a) => a.published)
    const publishedCount = assignments === null ? null : published.length

    /**
     * 학생별로 "낸 과제 수"와 **"내야 할 과제 수"**를 센다.
     *
     * 분모가 학생마다 다르다 — 과제는 학년·학생을 골라 나가기 때문이다. 예전에는 게시된
     * 과제 전부를 모두의 분모로 썼다. 그래서 1학년 아이의 학습 진도에 3학년 과제나 다른 과목
     * 과제가 "안 낸 것"으로 들어가, 다 낸 아이도 진도가 절반으로 찍혔다.
     */
    const submitted = new Map<number, number>()
    const due = new Map<number, number>()
    for (const a of published) {
      const s = stats[a.id]
      if (!s) continue // 그 과제 조회가 실패했다 — 분모에서도 빼야 비율이 안 틀어진다
      for (const id of ids) {
        const grade = gradeOf.get(id)
        if (grade == null || !assignmentTargetsStudent(a, { userId: id, grade })) continue
        due.set(id, (due.get(id) ?? 0) + 1)
      }
      for (const sub of s.submissions) {
        submitted.set(sub.studentId, (submitted.get(sub.studentId) ?? 0) + 1)
      }
    }

    const byStudent: Record<number, RosterRow> = {}
    for (const id of ids) {
      const cells = due.get(id) ?? 0
      byStudent[id] = {
        lastAttended: attendance[id]?.lastAttended ?? null,
        attendanceRate: attendance[id]?.rate ?? null,
        submitRate: cells === 0 ? null : Math.round(((submitted.get(id) ?? 0) / cells) * 100),
      }
    }

    const rates = ids.map((id) => attendance[id]?.rate).filter((v): v is number => v != null)
    const avgAttendance = rates.length
      ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
      : null

    /*
      "출석 학생"은 **가장 최근 수업**에 온 사람 수다 (누적 비율이 아니다).
      아직 아무 수업도 안 열렸으면 셀 대상이 없으므로 null — 0명으로 적으면 "다 빠졌다"가 된다.
    */
    const known = ids.map((id) => attendance[id]?.lastAttended).filter((v) => v != null)
    const presentCount = known.length === 0 ? null : known.filter(Boolean).length

    /*
      학급 제출률은 학생별 평균이 아니라 **낸 칸 / 내야 할 칸** 이다 (학생 수가 달라도 안 흔들린다).
      내야 할 칸도 학생마다 다르므로 `due` 를 모두 더한다 — 게시 과제 수 × 학생 수로 두면
      학년이 갈린 학급에서 분모가 실제보다 커져 학급 제출률이 늘 낮게 나온다.
    */
    const filled = [...submitted.values()].reduce((a, b) => a + b, 0)
    const cells = [...due.values()].reduce((a, b) => a + b, 0)
    const submitRate = cells === 0 ? null : Math.round((filled / cells) * 100)
    /** 자기에게 나온 과제 중 하나라도 안 낸 학생 수 */
    const notSubmittedCount =
      cells === 0
        ? null
        : ids.filter((id) => {
            const mine = due.get(id) ?? 0
            return mine > 0 && (submitted.get(id) ?? 0) < mine
          }).length

    return {
      byStudent,
      avgAttendance,
      presentCount,
      notSubmittedCount,
      submitRate,
      publishedCount,
      loading,
    }
  }, [idKey, assignments, stats, attendance, loading, gradeOf])
}
