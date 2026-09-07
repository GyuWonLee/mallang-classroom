import { create } from 'zustand'

/**
 * "지금 내가 **들어가 있는** 학년 방" — 학급마다 하나.
 *
 * 학년 카드의 세 상태 중 `live`(회색·잠김)를 가르는 값이다. 회색은 "이 방에 선생님이 있다"는
 * 뜻이고 그래서 들어갈 수 없다 — 그러니 이 값은 **방을 나가는 순간 사라져야 한다.**
 * 남겨 두면 수업에 들어갔다 돌아온 선생님이 자기 수업으로 다시 못 들어간다.
 *
 * 그래서 **저장하지 않는다(메모리 전용).** 새로고침하면 잊는 게 맞다 — 그 순간 선생님은
 * 방 안에 없기 때문이다. 라이브 화면(`TeacherClassroomPage`)이 뜰 때 다시 표시한다.
 *
 * **서버에는 이 정보가 없다.** 백엔드 세션은 학급당 1개이고 학년(모둠) 필드가 없다
 * (`ActiveSession` = `{ id, startedAt }`). 학년은 세션을 나누는 단위가 아니라 그 안에서 지금
 * 집중할 모둠(`?group=N`)일 뿐이다. 그래서 여기 있는 건 **내 브라우저가 아는 내 위치**뿐이고,
 * 같이 관리하는 다른 선생님 화면에는 내가 어느 방에 있는지 보이지 않는다.
 * 서버가 재실 정보를 주면 이 스토어를 그걸로 갈아끼우면 된다 — 화면 쪽은 그대로 둬도 된다.
 */

interface Entry {
  sessionId: number
  grade: number
}

interface LiveGradeState {
  byClassroom: Record<string, Entry>
  /** 이 학년 방에 들어왔다 — 라이브 화면이 떠 있는 동안 유지된다 */
  enter: (classroomId: string, sessionId: number, grade: number) => void
  /** 방에서 나왔다 (라이브 화면 언마운트) */
  leave: (classroomId: string) => void
}

export const useLiveGradeStore = create<LiveGradeState>((set) => ({
  byClassroom: {},
  enter: (classroomId, sessionId, grade) =>
    set((s) => ({ byClassroom: { ...s.byClassroom, [classroomId]: { sessionId, grade } } })),
  leave: (classroomId) =>
    set((s) => {
      if (!(classroomId in s.byClassroom)) return s
      const byClassroom = { ...s.byClassroom }
      delete byClassroom[classroomId]
      return { byClassroom }
    }),
}))

/**
 * 지금 진행 중인 수업과 **짝이 맞을 때만** 학년을 돌려준다.
 * 수업이 끝났거나(`sessionId === null`) 다른 수업으로 바뀌었으면 null 이다.
 */
export function useLiveGrade(
  classroomId: string | undefined,
  sessionId: number | null,
): number | null {
  const entry = useLiveGradeStore((s) => (classroomId ? s.byClassroom[classroomId] : undefined))
  if (!entry || sessionId === null || entry.sessionId !== sessionId) return null
  return entry.grade
}
