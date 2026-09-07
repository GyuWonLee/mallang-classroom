import { useEffect, useState } from 'react'
import { classroomApi } from '@/services/api/classroomApi'
import { fetchClassProgress } from '@/services/classProgress'
import type { ManagedClassroom } from '@/types/teacher'

export interface ClassroomTileMeta {
  students: number
  /** `null` = 게시된 과제가 아직 없다 (0% 와 구분해야 한다) */
  progress: number | null
}

/**
 * 학급 카드가 보여주는 "학생 N명 · 과제 진행률" 을 학급별로 채운다.
 *
 * 둘 다 학급 **목록** API 에는 없다 (`ManagedClassroom` 은 id/name/alias/myRole/grades 뿐).
 * 학급 상세와 과제 현황을 학급 수만큼 병렬로 불러 채운다 — 한 선생님의 학급은 보통 몇 개뿐이라
 * 부담이 없고, 없는 숫자를 지어내지 않는다. 실패한 학급은 키가 아예 없어서 카드가 그 줄을
 * 비워 둔다(0명·0% 로 적으면 사실이 아닌 값을 큰 글씨로 보여주게 된다).
 *
 * 내 학급 화면과 학급 선택 화면이 같은 카드를 쓰므로 이 조회도 한 곳에 둔다.
 */
export function useClassroomTileMeta(classrooms: ManagedClassroom[]) {
  const [meta, setMeta] = useState<Record<string, ClassroomTileMeta>>({})

  useEffect(() => {
    let cancelled = false
    void Promise.all(
      classrooms.map((c) =>
        Promise.all([
          classroomApi.getClassroom(c.id).then((d) => d.memberCounts.students),
          fetchClassProgress(c.id).catch(() => null),
        ])
          .then(([students, progress]) => [c.id, { students, progress }] as const)
          .catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return
      setMeta(Object.fromEntries(rows.filter((r) => r !== null)))
    })
    return () => {
      cancelled = true
    }
  }, [classrooms])

  return meta
}
