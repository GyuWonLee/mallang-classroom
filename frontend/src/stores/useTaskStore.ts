import { create } from 'zustand'
import type { DailyTask, TaskKind } from '@/types/classroom'
import { assignmentApi } from '@/services/api/assignmentApi'
// 문항 수를 화면과 **같은 규칙**으로 세기 위해 퀴즈 변환기를 그대로 쓴다 (countProblems 주석)
import { toQuizQuestions } from '@/lib/quiz'
import type { AssignmentSummary, AssignmentType } from '@/types/assignment'

/** 과제 유형 -> 학생 화면의 아이콘/문구 계열 */
const KIND_BY_TYPE: Record<AssignmentType, TaskKind> = {
  DICTATION: 'read',
  MULTIPLE_CHOICE: 'quiz',
  PARTICLE_CHOICE: 'quiz',
  OX: 'quiz',
  QUIZ_GAME: 'quiz',
}

const SUBTITLE_BY_TYPE: Record<AssignmentType, string> = {
  DICTATION: '듣고 받아쓰기',
  MULTIPLE_CHOICE: '보기 중에 고르기',
  PARTICLE_CHOICE: '알맞은 조사 고르기',
  OX: '맞는지 틀린지 고르기',
  QUIZ_GAME: '놀이처럼 풀기',
}

/**
 * 활동지 상태 — **서버의 공개된 과제**가 원천이다.
 *
 * 학생용 목록 API 는 공개(publish)된 과제만 돌려준다(백엔드 `AssignmentAccessGuard`).
 *
 * **완료 여부도 이제 서버가 준다**(S15P11A407-130 의 `submitted`·`score`). 예전엔 이 세션
 * 동안만 기억해서 새로고침하면 다 푼 과제가 "안 한 과제"로 되살아났다 — 아이는 같은 과제를
 * 또 풀었다. 지금은 목록을 다시 불러오면 제출 상태가 그대로 복원된다.
 */
interface TaskState {
  tasks: DailyTask[]
  loaded: boolean
  /**
   * 불러오기가 실패했는가. **실패를 빈 목록으로 뭉개면 안 된다** — 빈 목록은 화면에서
   * "활동지 전부 완료! 🎉"(done 0 / 전체 0)로 읽혀, 과제를 못 받은 아이가 칭찬 문구를 본다.
   * 실패일 때는 이전 목록을 그대로 두고 이 값만 세워 화면이 다시 시도할 수 있게 한다.
   */
  error: boolean
  /** 학급의 공개 과제를 불러온다 */
  load: (classroomId: string) => Promise<void>
  /**
   * 마지막으로 불렀던 학급으로 다시 시도한다. 화면이 classroomId 를 들고 있지 않아도
   * "다시 받기" 버튼을 그릴 수 있게 store 가 기억한다.
   */
  retry: () => Promise<void>
  /**
   * 과제를 완료 처리하고 다음 순서 과제를 'next'로 승격.
   * `score` 를 함께 넘기면 점수 배지도 바로 보인다(제출 응답의 점수) — 목록을
   * 다시 불러오지 않아도 화면이 서버와 같은 값을 말한다.
   */
  completeTask: (id: string, score?: number | null) => void
}

function toDailyTask(a: AssignmentSummary, index: number): DailyTask {
  return {
    id: String(a.id),
    order: index + 1,
    kind: KIND_BY_TYPE[a.type] ?? 'quiz',
    title: a.title,
    subtitle: SUBTITLE_BY_TYPE[a.type] ?? '과제 풀기',
    // 서버가 "냈다"고 한 과제는 완료. 나머지 순서는 아래 promoteNext 가 정한다.
    // `submitted` 는 학생이 부를 때만 채워지므로 true 만 신뢰한다(null 은 '모름'이다).
    status: a.submitted === true ? 'done' : 'todo',
    score: a.score,
    // 목록 응답에는 문항 수가 없다 — 아래 load 가 상세를 읽어 채운다
    problemCount: null,
  }
}

/**
 * 각 활동지의 **실제로 풀게 되는** 문항 수를 세어 온다.
 *
 * 목록 API 에 문항 수가 없어서 과제 상세(`GET /assignments/{id}`)를 하나씩 읽는다.
 * 공개된 과제만 목록에 오므로 보통 몇 건이고, 목록을 먼저 그린 뒤 뒤에서 채운다.
 *
 * **`content.problems.length` 를 그대로 쓰지 않는다.** `toQuizQuestions` 가 보기가 없거나
 * 정답이 빠진 문항을 걸러내므로(받아쓰기는 answerText 없는 문항), 원본 개수를 적으면
 * "5문제" 라고 적어 놓고 4문제만 나오는 일이 생긴다. 화면이 쓰는 것과 같은 함수로 센다.
 *
 * 실패한 건은 null 로 남겨 둔다 — 숫자를 지어내지 않고 그 줄만 배지를 안 그린다.
 */
async function countProblems(tasks: DailyTask[]): Promise<Record<string, number>> {
  const counted = await Promise.all(
    tasks.map(async (t) => {
      try {
        const a = await assignmentApi.getAssignment(Number(t.id))
        return [t.id, toQuizQuestions(a.content.problems, a.type).length] as const
      } catch {
        return null
      }
    }),
  )
  return Object.fromEntries(counted.filter((x): x is readonly [string, number] => x !== null))
}

function promoteNext(tasks: DailyTask[]): DailyTask[] {
  if (tasks.some((t) => t.status === 'next')) return tasks
  const firstTodo = tasks.find((t) => t.status === 'todo')
  if (!firstTodo) return tasks
  return tasks.map((t) => (t.id === firstTodo.id ? { ...t, status: 'next' } : t))
}

/**
 * 이 store 를 몇 번째로 불렀는지. 문항 수는 목록보다 늦게 도착하므로, 그 사이에 목록을
 * 다시 불렀다면(과제 공개 알림 등) **늦게 온 옛 결과가 새 목록을 덮어쓰지 않게** 한다.
 */
let loadSeq = 0

/** 다시 시도할 때 쓸 마지막 학급. 화면이 id 를 몰라도 재시도할 수 있게 한다. */
let lastClassroomId: string | null = null

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  loaded: false,
  error: false,
  load: async (classroomId) => {
    lastClassroomId = classroomId
    const seq = (loadSeq += 1)
    try {
      const list = await assignmentApi.listAssignments(classroomId)
      if (seq !== loadSeq) return
      // 안 낸 과제 중 첫 번째를 '지금 할 일'로 올린다 (전부 냈으면 아무것도 승격하지 않는다)
      const tasks = promoteNext(list.map(toDailyTask))
      // 목록을 먼저 그린다 — 문항 수를 기다리느라 화면이 비어 있으면 안 된다
      set({ tasks, loaded: true, error: false })

      const counts = await countProblems(tasks)
      if (seq !== loadSeq) return
      set((s) => ({
        tasks: s.tasks.map((t) =>
          counts[t.id] === undefined ? t : { ...t, problemCount: counts[t.id] },
        ),
      }))
    } catch {
      // 권한/네트워크 오류. **목록을 비우지 않는다** — 비우면 "전부 완료"로 보인다.
      // 이전 목록을 그대로 두고 error 만 세워, 화면이 안내와 다시 받기 버튼을 그리게 한다.
      if (seq === loadSeq) set({ loaded: true, error: true })
    }
  },
  retry: async () => {
    if (lastClassroomId) await useTaskStore.getState().load(lastClassroomId)
  },
  completeTask: (id, score) =>
    set((s) => {
      const updated = s.tasks.map(
        (t): DailyTask =>
          t.id === id ? { ...t, status: 'done', score: score ?? t.score } : t,
      )
      return { tasks: promoteNext(updated) }
    }),
}))

/** 완료 개수 셀렉터 */
export const selectDoneCount = (s: TaskState): number =>
  s.tasks.filter((t) => t.status === 'done').length
