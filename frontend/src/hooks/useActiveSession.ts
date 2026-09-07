import { useCallback, useEffect, useState } from 'react'
import { classroomApi } from '@/services/api/classroomApi'
import type { ActiveSession as ApiActiveSession } from '@/types/teacher'

interface ActiveSession {
  /**
   * 진행 중인 수업 id (없으면 null).
   *
   * 한 학급에 학년별로 여러 개가 열릴 수 있게 된 뒤로(V31) 이건 **그중 하나**다 — 학년을
   * 아는 화면은 아래 `sessions` 에서 자기 학년 것을 골라야 한다. 학년 개념이 없는 쪽
   * (라이브 화면은 이미 `?session=N` 을 들고 오고, 학생은 자기 수업이 하나뿐이다)은 이 값으로 충분하다.
   */
  sessionId: number | null
  /** 이 학급에서 진행 중인 수업 전부 — 학년 오름차순 */
  sessions: ApiActiveSession[]
  /** 실제로 붙은 학급 id — 학생처럼 파라미터 없이 들어온 경우 조회 결과가 들어온다 */
  classroomId: string | null
  /** 학급 이름 (수업 제목으로 표시) */
  classroomName: string | null
  /** 수업 시작 시각 (경과 시간 타이머 기준). 진행 중이 아니면 null */
  startedAt: string | null
  loading: boolean
  /** 수업 시작/종료 알림을 받았을 때 즉시 반영 */
  setSessionId: (id: number | null) => void
  /** 서버에서 다시 확인 */
  refresh: () => void
}

/**
 * 진행 중인 수업을 찾아준다.
 *
 * - 선생님: `?session=N` 없이 딥링크로 들어와도 학급 상세의 `activeSession` 으로 복구된다.
 * - 학생: 학급 id 를 모른 채 `/classroom` 으로 들어오므로, 내 학급 목록의 첫 학급을 잡아
 *   그 학급의 진행 중 수업을 찾는다. 아직 수업 전이면 null 이고, 이후 STOMP 개인 채널의
 *   `SESSION_STARTED` 를 받아 `setSessionId` 로 채운다.
 *
 * 폴링은 하지 않는다 — 시작/종료는 실시간 이벤트로 오기 때문이다.
 */
/**
 * 이 사람이 들어가야 할 수업을 고른다.
 *
 * **아무거나 고르면 안 된다.** 한 학급에 학년별 수업이 나란히 돌 수 있게 되면서(V31),
 * 예전처럼 목록의 첫 번째를 잡으면 3학년 학생이 1학년 수업 방으로 들어간다(목록은 학년
 * 오름차순이다). 그러면 그 학생의 LiveKit 룸은 선생님이 방송하는 룸과 **다른 방**이라
 * 화면도 소리도 영영 오지 않는다 — 접속은 멀쩡해 보여서 원인을 찾기가 어렵다.
 *
 * 고르는 순서:
 *  1. 내 학년 수업
 *  2. 학급 전체 수업(`grade === null`) — V31 이전에 시작됐거나 학년 없이 연 수업이라 나도 대상이다
 *  3. 없으면 **null** — 옆 학년 수업으로 떨어지지 않는다. 내 수업이 없는 것이 사실이다.
 *
 * 학년을 안 넘기면(선생님 화면 등) 예전처럼 첫 번째를 쓴다 — 그쪽은 `?session=N` 이나
 * `sessions` 에서 직접 고르므로 대표값이면 충분하다.
 */
function pickSession(
  open: ApiActiveSession[],
  preferGrade: number | null | undefined,
): ApiActiveSession | null {
  if (preferGrade == null) return open[0] ?? null
  return open.find((s) => s.grade === preferGrade) ?? open.find((s) => s.grade === null) ?? null
}

/**
 * @param preferGrade 내 학년. 넘기면 **그 학년 수업만** 고른다(위 `pickSession`).
 *                    학생 화면은 반드시 넘길 것 — 안 넘기면 옆 학년 방으로 들어간다.
 */
export function useActiveSession(
  classroomIdParam?: string,
  preferGrade?: number | null,
): ActiveSession {
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [sessions, setSessions] = useState<ApiActiveSession[]>([])
  const [classroomId, setClassroomId] = useState<string | null>(classroomIdParam ?? null)
  const [classroomName, setClassroomName] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        let targetId = classroomIdParam
        if (!targetId) {
          const mine = await classroomApi.listClassrooms()
          targetId = mine[0]?.id
        }
        if (!targetId) {
          if (!cancelled) {
            setClassroomId(null)
            setClassroomName(null)
            setStartedAt(null)
            setSessionId(null)
            setSessions([])
          }
          return
        }
        const detail = await classroomApi.getClassroom(targetId)
        if (cancelled) return
        setClassroomId(targetId)
        setClassroomName(detail.name)
        const open = detail.activeSessions ?? []
        setSessions(open)
        const mine = pickSession(open, preferGrade)
        setStartedAt(mine?.startedAt ?? null)
        setSessionId(mine?.id ?? null)
      } catch {
        // 권한 없음/네트워크 오류 — 수업 미연결 상태로 두고 UI 는 대체 화면을 보여준다
        if (!cancelled) {
          setSessionId(null)
          setSessions([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [classroomIdParam, preferGrade, nonce])

  return { sessionId, sessions, classroomId, classroomName, startedAt, loading, setSessionId, refresh }
}
