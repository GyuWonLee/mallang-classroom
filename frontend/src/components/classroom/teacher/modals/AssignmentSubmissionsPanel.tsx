import { useEffect, useMemo, useState } from 'react'
import { FillBar } from '@/components/common/FillBar'
import { useStudentsStore } from '@/stores/useStudentsStore'
import { analyticsApi, type AssignmentSubmissions } from '@/services/api/analyticsApi'

/**
 * 과제별 제출 현황 — GET /assignments/{id}/submissions (백엔드 S15P11A407-127).
 *
 * 답하는 것은 하나다: **누가 안 냈나**(독려 대상).
 *
 * 한때 "다시 짚어줄 문항"(밴드가 낮은 문항 + 많이 고른 오답)도 여기서 함께 보여줬는데,
 * 문항 이야기는 과제 관리 화면의 **문항 분석 탭 아래**로 옮겼다 — 문항별 정답률 막대 바로 밑이
 * 그 이야기의 자리다. 같은 내용을 두 곳에서 다르게 그리면 어느 쪽이 최신인지 알 수 없다.
 *
 * `notSubmittedStudentIds` 는 **id 만** 온다. 이름은 이미 받아 둔 학급 명단(`useStudentsStore`)에서
 * 맞춘다 — 모달이 열릴 때마다 명단을 다시 받지 않는다. 명단이 아직 없으면 id 대신 "학생"으로
 * 두되 몇 명인지는 정확히 보여준다(빈 목록으로 위장하지 않는다).
 */
export function AssignmentSubmissionsPanel({
  assignmentId,
  classroomId,
}: {
  assignmentId: number
  classroomId: number
}) {
  const [data, setData] = useState<AssignmentSubmissions | null>(null)
  const [error, setError] = useState(false)

  const accounts = useStudentsStore((s) => s.byClassroom[String(classroomId)])
  const studentNames = useMemo(
    () => new Map((accounts ?? []).map((a) => [a.userId, a.name])),
    [accounts],
  )

  useEffect(() => {
    let cancelled = false
    setError(false)
    void analyticsApi
      .getAssignmentSubmissions(assignmentId)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [assignmentId])

  if (error) {
    return (
      <p className="mb-4 rounded-2xl bg-canvas p-[14px_16px] text-[.85rem] font-bold text-ink-mute">
        제출 현황을 불러오지 못했어요.
      </p>
    )
  }

  if (!data) {
    return (
      <p className="mb-4 rounded-2xl bg-canvas p-[14px_16px] text-[.85rem] font-bold text-ink-mute">
        제출 현황을 불러오는 중...
      </p>
    )
  }

  const rate =
    data.totalStudents > 0 ? Math.round((data.submittedCount / data.totalStudents) * 100) : 0

  return (
    <>
      <h4 className="mb-2.5 text-[.92rem] font-black text-ink-soft">제출 현황</h4>
      <div className="rounded-2xl bg-canvas p-4">
        <div className="flex items-end justify-between gap-3">
          <span className="text-[.9rem] font-bold text-ink-soft">
            <b className="text-[1.3rem] font-black text-ink">{data.submittedCount}</b> / {data.totalStudents}명 제출
          </span>
          <span className="text-[.95rem] font-black text-primary">{rate}%</span>
        </div>
        {/* 막대는 보조 표현 — 숫자를 이미 위에 적었다. 빈 상태에서 차오른다 (ref animateFills) */}
        <FillBar pct={rate} className="mt-2 h-2.5" />

        {data.notSubmittedStudentIds.length > 0 && (
          <div className="mt-3.5">
            <p className="mb-1.5 text-[.82rem] font-black text-ink-soft">아직 안 낸 학생</p>
            <ul className="flex flex-wrap gap-1.5">
              {data.notSubmittedStudentIds.map((id) => (
                <li
                  key={id}
                  className="inline-block rounded-full bg-task-soft px-2.5 py-1 text-[.8rem] font-extrabold text-task-deep"
                >
                  {studentNames.get(id) ?? '학생'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  )
}
