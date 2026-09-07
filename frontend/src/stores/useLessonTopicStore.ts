import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { SessionTopics } from '@/types/session'

/**
 * 선생님이 수업을 시작하며 적은 **오늘의 수업 주제** — 수업(세션)·학년마다 하나.
 *
 * ## 수명은 **수업 하나**다
 *
 * 시작할 때 한 번 적고, 수업을 끌 때까지 그대로 이어진다(수업 중에 바꾸지 않는다). 그래서
 * 키에 **`sessionId` 를 넣는다** — 수업을 끝내고 새로 열면 세션 id 가 달라지므로 지난 주제가
 * 저절로 따라오지 않는다. 학급+학년으로만 키를 잡았을 때는 다음 수업에 지난 주제가 되살아나
 * "내가 안 적었는데 왜 떠 있지"가 됐다.
 *
 * 복식학급은 한 세션에 5·6학년이 함께 있어(세션은 학급당 1개) 학년도 키에 들어간다.
 *
 * ## 이제 **서버가 주인이다** (S15P11A407-146)
 *
 * 예전에는 서버 세션에 주제 필드가 없어서 이 스토어가 값의 유일한 보관소였고, 그래서
 * 주제를 적은 **선생님의 브라우저에만** 남았다 — 학생 화면은 학급 이름을 보여줬고 같이
 * 관리하는 다른 선생님에게도 안 보였다. 그 한계를 적어 두었던
 * `docs/backend-request-lesson-topic.md` 의 요청이 반영돼, 지금은:
 *
 *  - 쓰기: `PUT /sessions/{id}/topics/{grade}` (`sessionApi.setTopic`)
 *  - 읽기: `POST /sessions/{id}/join` 과 `GET /sessions/{id}/state` 의 `topics`
 *
 * **이 스토어는 그 값을 담아 두는 캐시다.** 서버에서 받은 것을 `hydrate` 로 부어 넣고,
 * 화면은 여기서 읽는다. 주인이 서버로 바뀌었으니 값이 없다고 "안 적었다"로 단정하지 않는다 —
 * 아직 안 받아 왔을 수도 있다.
 *
 * ## 왜 여전히 sessionStorage 인가
 *
 * 서버가 주인이 됐어도 캐시는 남긴다: 새로고침·화면 이동이 잦은데(수업 중 라이브 화면을
 * 오가는 것은 흔하다) 그때마다 주제가 한 박자 늦게 뜨면 제목이 깜빡인다. 탭을 닫으면 잊어도
 * 되는 값이라 sessionStorage 다 — localStorage 면 며칠 뒤 같은 세션 id 가 재사용될 때
 * 엉뚱한 주제가 붙을 수 있다.
 */

/** `${sessionId}:${grade}` — 수업 하나 안에서 학년별로 다른 주제를 갖는다 */
type TopicKey = string

interface LessonTopicState {
  byGrade: Record<TopicKey, string>
  /** 빈 문자열을 넣으면 지운다 — "주제 없음"과 "빈 문자열"을 따로 두지 않는다 */
  setTopic: (sessionId: number, grade: number, topic: string) => void
  /**
   * 서버에서 받은 이 수업의 주제 전체를 캐시에 부어 넣는다 (join·state 응답).
   *
   * **그 수업 몫은 통째로 갈아치운다.** 병합하면 서버에서 지워진 주제가 이 브라우저에만
   * 남아 계속 보인다 — 다른 선생님이 지웠는데 내 화면에는 그대로인 상태가 된다.
   */
  hydrate: (sessionId: number, topics: SessionTopics) => void
  /** 수업을 끝냈다 — 그 수업의 주제를 모두 버린다 */
  clearSession: (sessionId: number) => void
}

function keyOf(sessionId: number, grade: number): TopicKey {
  return `${sessionId}:${grade}`
}

/** 그 수업 몫만 걸러낸 새 맵 — hydrate·clearSession 이 함께 쓴다 */
function withoutSession(
  byGrade: Record<TopicKey, string>,
  sessionId: number,
): Record<TopicKey, string> {
  const prefix = `${sessionId}:`
  const next: Record<TopicKey, string> = {}
  for (const [key, value] of Object.entries(byGrade)) {
    if (!key.startsWith(prefix)) next[key] = value
  }
  return next
}

export const useLessonTopicStore = create<LessonTopicState>()(
  persist(
    (set) => ({
      byGrade: {},
      setTopic: (sessionId, grade, topic) =>
        set((s) => {
          const key = keyOf(sessionId, grade)
          const next = { ...s.byGrade }
          const trimmed = topic.trim()
          if (trimmed) next[key] = trimmed
          else delete next[key]
          return { byGrade: next }
        }),
      hydrate: (sessionId, topics) =>
        set((s) => {
          const next = withoutSession(s.byGrade, sessionId)
          for (const [grade, topic] of Object.entries(topics)) {
            // 서버가 빈 값을 줄 일은 없지만, 준다면 "주제 없음"과 같게 다룬다
            const trimmed = topic?.trim()
            if (trimmed) next[`${sessionId}:${grade}`] = trimmed
          }
          return { byGrade: next }
        }),
      clearSession: (sessionId) => set((s) => ({ byGrade: withoutSession(s.byGrade, sessionId) })),
    }),
    {
      name: 'lesson-topic',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
)

/** 이 수업·학년의 주제 (없으면 null) */
export function useLessonTopic(sessionId: number | null, grade: number | null): string | null {
  return useLessonTopicStore((s) =>
    sessionId !== null && grade !== null ? (s.byGrade[keyOf(sessionId, grade)] ?? null) : null,
  )
}

/** 훅 밖(서비스·API 응답 처리)에서 캐시를 채울 때 */
export function hydrateLessonTopics(sessionId: number, topics: SessionTopics | null | undefined) {
  if (!topics) return
  useLessonTopicStore.getState().hydrate(sessionId, topics)
}
