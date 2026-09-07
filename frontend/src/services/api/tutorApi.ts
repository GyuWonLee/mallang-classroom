import { api } from './client'
import type {
  FlaggedStudent,
  TutorActionResult,
  TutorAnswer,
  TutorAskRequest,
  TutorMessage,
} from '@/types/tutor'

/**
 * AI 말랑이 API (백엔드 S15P11A407-137 §11.1 #1).
 *
 * 수업 채팅과 헷갈리기 쉬운데 **완전히 다른 경로**다: 여기는 STOMP 를 쓰지 않는다.
 * 질문을 POST 하면 그 응답에 답이 실려 온다(왕복 한 번). 수업 중이 아니어도 쓸 수 있다.
 */
export const tutorApi = {
  /**
   * 말랑이에게 묻기 (학생 전용) — POST /api/ai/tutor/messages.
   *
   * LLM 호출이라 몇 초 걸린다(백엔드가 타임아웃을 걸어 둔다 — S15P11A407-138).
   * **실패해도 에러가 아니라 안내 문구가 200 으로 온다** — 그때 `answeredBy` 가 `TEMPLATE` 이다.
   * 하루 30회 제한이 있고 넘기면 서버가 거절한다(`errorSlug` 로 분기).
   */
  async ask(classroomId: number, question: string): Promise<TutorAnswer> {
    const body: TutorAskRequest = { classroomId, question }
    const { data } = await api.post<TutorAnswer>('/ai/tutor/messages', body)
    return data
  },

  /**
   * 말랑이 제안 확인/거절 — POST /api/ai/tutor/messages/{messageId}/action.
   *
   * **확인해야만 실행된다.** `CONFIRM` 이면 그 자리에서 선생님에게 질문이 전달되고
   * (`delivery` 로 어떻게 갔는지 온다), `REJECT` 면 아무 일도 일어나지 않는다.
   *
   * **한 번만 부를 수 있다** — 응답을 받으면 호출부는 버튼을 없애야 한다.
   * 실패 슬러그(전부 백엔드 실물 확인):
   *  - `409 no-pending-action` — 이미 확인/거절했다 (버튼을 없앤다)
   *  - `409 action-expired` — 24시간이 지났다
   *  - `409 material-not-available` — 그 사이 자료가 삭제됐다
   *  - `409 no-teacher-in-classroom` — **명세에 없던 것.** 학급에 담당 선생님(OWNER)이 없어
   *    전달할 대상이 없다 (TutorActionExecutor.java:104)
   *  - `404 tutor-message-not-found` — **명세에 없던 것.** 없는 messageId
   *  - `403 tutor-action-forbidden` — 남의 제안 (발생하면 버그)
   */
  async decideAction(
    messageId: number,
    decision: 'CONFIRM' | 'REJECT',
  ): Promise<TutorActionResult> {
    const { data } = await api.post<TutorActionResult>(
      `/ai/tutor/messages/${messageId}/action`,
      { decision },
    )
    return data
  },

  /**
   * 대화 기록 (**학급 선생님 또는 본인**) — GET /api/classrooms/{id}/students/{sid}/tutor-messages.
   * 최근 것이 위로 온다 — 시간순 말풍선으로 그리려면 뒤집어야 한다.
   */
  async history(classroomId: string | number, studentId: number): Promise<TutorMessage[]> {
    const { data } = await api.get<TutorMessage[]>(
      `/classrooms/${classroomId}/students/${studentId}/tutor-messages`,
    )
    return data
  },

  /**
   * 위험 신호가 잡힌 학생 목록 (**선생님 전용**) — GET /api/classrooms/{id}/tutor-flags.
   *
   * 신호가 한 건도 없는 학생은 오지 않는다 → 빈 배열 = 학급에 아무 신호도 없다.
   * 학생이 부르면 403 `tutor-flags-forbidden` 이므로 **학생 화면에서는 호출하지 않는다.**
   *
   * 사유는 담기지 않는다(건수만) — 어깨 너머로 읽히지 않게 서버가 일부러 뺐다.
   * 무엇이 잡혔는지는 그 학생의 `history` 를 열어야 보인다.
   */
  async flags(classroomId: string | number): Promise<FlaggedStudent[]> {
    const { data } = await api.get<FlaggedStudent[]>(`/classrooms/${classroomId}/tutor-flags`)
    return data
  },
}
