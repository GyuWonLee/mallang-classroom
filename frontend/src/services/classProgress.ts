import { assignmentApi } from '@/services/api/assignmentApi'
import { analyticsApi } from '@/services/api/analyticsApi'

/**
 * 학급의 "과제 진행률" — ref 학급 카드(`.pk-card-prog`)가 보여주는 값.
 *
 * ref 목업은 `c.progress` 라는 숫자를 그냥 들고 있지만 서버엔 그런 필드가 없다. 대신 **게시된
 * 과제 전체를 합쳐** `낸 사람 / 내야 할 사람` 으로 계산한다 — 학급 카드가 알려주려는 것이
 * "이 반이 낼 걸 얼마나 냈나" 이므로 뜻이 같고, 지어낸 숫자가 아니다.
 *
 * 과제별로 학생 수가 다를 수 있어(중간에 학생이 들고 나감) 과제별 비율의 평균이 아니라
 * **분자·분모를 각각 합친 뒤** 나눈다. 과제 3개 중 하나만 20명이고 둘은 2명짜리일 때,
 * 비율 평균은 작은 과제 둘이 전체를 끌고 가버린다.
 *
 * 아직 게시된 과제가 없거나 낼 사람이 0명이면 `null` — 0% 와 구분해야 한다.
 * 0% 는 "다들 아직 안 냈다", null 은 "낼 게 아직 없다"로 화면 표기가 갈린다.
 *
 * 요청 수는 학급당 `과제 목록 1번 + 과제 수` 다. 과제 하나가 실패하면 그 과제만 빼고 계산한다
 * (전체를 null 로 떨어뜨리면 나머지가 멀쩡한데도 카드가 비어 버린다).
 */
export async function fetchClassProgress(classroomId: string): Promise<number | null> {
  const assignments = await assignmentApi.listAssignments(classroomId)
  // 미게시 과제는 학생에게 아직 안 보이므로 "내야 할 것"에 넣지 않는다
  const published = assignments.filter((a) => a.published)
  if (published.length === 0) return null

  const stats = await Promise.all(
    published.map((a) => analyticsApi.getAssignmentSubmissions(a.id).catch(() => null)),
  )

  let submitted = 0
  let total = 0
  for (const s of stats) {
    if (!s) continue
    submitted += s.submittedCount
    total += s.totalStudents
  }
  if (total === 0) return null
  return Math.round((submitted / total) * 100)
}
