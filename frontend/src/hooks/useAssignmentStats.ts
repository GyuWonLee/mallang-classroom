import { useCallback, useEffect, useState } from 'react'
import { analyticsApi, type AssignmentSubmissions } from '@/services/api/analyticsApi'
import type { AssignmentSummary } from '@/types/assignment'

/**
 * 과제별 제출 현황을 한 번에 모아 둔다 — 과제 관리 화면의 **모든 숫자가 여기서 나온다**:
 * 배너 요약 3칸, 목록 카드의 제출률 링, 상세의 4개 탭.
 *
 * 과제 목록 응답(`AssignmentSummary`)에는 교사 시점 제출률·점수가 없다(`submitted`/`score` 는
 * 학생이 호출할 때만 채워진다). 그래서 과제마다 `GET /assignments/{id}/submissions` 를 불러야
 * 하는데, 카드·링·탭이 제각기 부르면 같은 과제를 여러 번 조회하게 된다 — 한 곳에서 받아 나눠 쓴다.
 *
 * **미게시 과제는 건너뛴다.** 학생에게 아직 안 보이므로 제출이 있을 수 없고, 그만큼 요청도 줄인다.
 * 실패한 과제는 키가 없어서 화면이 그 자리를 비워 둔다(0% 로 적으면 사실이 아니다).
 */
export function useAssignmentStats(items: AssignmentSummary[]) {
  const [stats, setStats] = useState<Record<number, AssignmentSubmissions>>({})

  const load = useCallback(() => {
    const targets = items.filter((a) => a.published)
    if (targets.length === 0) {
      setStats({})
      return () => {}
    }
    let cancelled = false
    void Promise.all(
      targets.map((a) =>
        analyticsApi
          .getAssignmentSubmissions(a.id)
          .then((s) => [a.id, s] as const)
          .catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return
      setStats(Object.fromEntries(rows.filter((r) => r !== null)))
    })
    return () => {
      cancelled = true
    }
  }, [items])

  useEffect(load, [load])

  return stats
}

/** 제출률 0~100. 낼 사람이 0명이면 null (0% 와 구분한다) */
export function submitRate(s: AssignmentSubmissions | undefined): number | null {
  if (!s || s.totalStudents === 0) return null
  return Math.round((s.submittedCount / s.totalStudents) * 100)
}

/** 채점된 제출의 평균 점수. 채점된 게 없으면 null */
export function avgScore(s: AssignmentSubmissions | undefined): number | null {
  if (!s) return null
  const scored = s.submissions.filter((x) => x.score !== null)
  if (scored.length === 0) return null
  return Math.round(scored.reduce((sum, x) => sum + (x.score ?? 0), 0) / scored.length)
}
