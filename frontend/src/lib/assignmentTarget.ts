import type { AssignmentSummary } from '@/types/assignment'

/**
 * 이 과제가 그 학생에게 나가는가 — 백엔드 `Assignment.isVisibleTo` 와 **같은 규칙**이다.
 *
 * <p>대상 학년·대상 학생이 둘 다 비어 있으면 학급 전체, 지정돼 있으면 그 <b>합집합</b>이다
 * (학년이 맞거나, 본인이 지목됐거나).</p>
 *
 * <p>학생 상세의 학습 현황이 이 판정 없이 학급의 공개 과제를 그대로 세고 있었다. 그래서
 * 1학년 아이 화면에 3학년 과제가 섞여 "안 낸 과제"로 잡혔다 — 아이에게는 보이지도 않는
 * 과제인데 제출률만 깎였다.</p>
 *
 * <p>규칙을 화면마다 적지 않고 여기 한 곳에 둔다. 서버와 두 벌이 되는 것만으로도 위험한데
 * 화면끼리도 갈리면 같은 아이의 진도가 화면마다 달라진다.</p>
 */
export function assignmentTargetsStudent(
  assignment: Pick<AssignmentSummary, 'targetGrades' | 'targetStudentIds'>,
  student: { userId: number; grade: number },
): boolean {
  const grades = assignment.targetGrades ?? []
  const students = assignment.targetStudentIds ?? []
  if (grades.length === 0 && students.length === 0) {
    return true
  }
  return grades.includes(student.grade) || students.includes(student.userId)
}
