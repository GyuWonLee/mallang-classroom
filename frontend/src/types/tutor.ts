/**
 * AI 말랑이 (학생 질문 챗봇) — 백엔드 S15P11A407-137 §11.1 #1 / `tutor` 도메인.
 *
 * 수업 채팅(선생님에게 묻기)과 **다른 기능**이다: 상대가 사람이 아니고 수업 세션에도 매이지
 * 않는다. 그래서 STOMP 가 아니라 REST 한 번 왕복으로 끝난다(질문 보내면 답이 그 응답에 온다).
 */

/**
 * 누가 답했는지 (백엔드 `AiTutorMessage.AnsweredBy`). **노출하는 이유가 있다** — 폴백 안내
 * 문구를 AI 가 생각해서 준 답으로 오해하면 안 되기 때문이다.
 *
 * 값 이름에 주의: `AI`/`FALLBACK` 이 아니라 **`LLM`/`TEMPLATE`** 다. LLM 호출이 실패하면
 * (키 없음·타임아웃) 서버가 에러 대신 고정 문구를 200 으로 주고 `TEMPLATE` 로 표시한다.
 */
export type TutorAnsweredBy = 'LLM' | 'TEMPLATE' | 'BLOCKED'

/**
 * 말랑이가 제안할 수 있는 행동 (백엔드 `TutorActionType`).
 *
 * - `ASK_TEACHER` — 아이 질문을 선생님에게 전달한다.
 * - `SHOW_MATERIAL` — 학급 학습자료를 열어 보여준다.
 *   ⚠ **학생 화면에서는 쓰지 않는다.** 학습자료는 선생님만 보는 것으로 팀이 정했고
 *   (2026-08-03 확인) 백엔드도 그렇게 잠겨 있다 — `MaterialService` 는 조회까지 전부
 *   `requireManager` 이고 `GET /files/{id}/content` 도 업로더/관리자만 통과한다.
 *   그래서 이 제안에는 확인 버튼을 만들지 않는다(자세한 근거는 `AiTutorPanel.isActionable`).
 *   **못 해서가 아니라 안 하기로 한 것이므로 되살리지 말 것.**
 */
export type TutorActionType = 'ASK_TEACHER' | 'SHOW_MATERIAL'

/** 제안의 처리 상태 (백엔드 `TutorActionStatus`) */
export type TutorActionStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED'

/**
 * ASK_TEACHER 를 확인했을 때 **어떻게 전달됐는지** (백엔드 `TutorActionExecutor.Delivery`).
 * 수업 중이면 채팅으로 바로 뜨고(`SESSION_ROUTED`), 아니면 쪽지로 남는다(`DIRECT_MESSAGE`).
 * 화면 문구가 갈리므로 그대로 구분해서 안내한다.
 */
export type TutorDelivery = 'SESSION_ROUTED' | 'DIRECT_MESSAGE'

/**
 * 말랑이의 제안. **확인 전까지 아무 일도 일어나지 않는다.**
 *
 * `content` 는 선생님에게 **실제로 갈 본문**이다. 서버가 이걸 내려주는 이유는 하나뿐이다 —
 * 무엇이 전달되는지 아이에게 보여준 다음 확인을 받으라는 것이다. 보여주지 않고 버튼만
 * 만들면 아이는 자기 이름으로 무슨 말이 나가는지 모른 채 누른다.
 */
export interface TutorProposedAction {
  type: TutorActionType
  /** ASK_TEACHER: 선생님에게 갈 제목 / SHOW_MATERIAL: 자료 제목 */
  title: string | null
  /** ASK_TEACHER: 선생님에게 **실제로 갈 본문** (반드시 화면에 보여줄 것) */
  content: string | null
  materialId: number | null
  /** ISO. 24시간 뒤 만료 — 지나서 확인하면 409 `action-expired` */
  expiresAt: string
}

/** 제안 확인/거절 결과 (POST /ai/tutor/messages/{id}/action) */
export interface TutorActionResult {
  messageId: number
  status: TutorActionStatus
  actionType: TutorActionType
  /** ASK_TEACHER 를 확인했을 때만 — 그 외에는 null */
  delivery: TutorDelivery | null
  /** SHOW_MATERIAL 을 확인했을 때만 */
  material: { id: number; title: string } | null
}

/**
 * 말랑이에게 묻기 (POST /ai/tutor/messages).
 *
 * `classroomId` 가 필요한 건 권한(그 학급 학생인가)과 기록의 소속을 정하는 기준이라서다.
 * 질문 길이 상한(500자)은 비용 상한의 일부다 — 토큰이 그대로 크레딧이다.
 * 하루 30회 제한이 있고, 넘기면 서버가 거절한다.
 */
export interface TutorAskRequest {
  classroomId: number
  question: string
}

/** 말랑이 답 (POST /ai/tutor/messages 응답) */
export interface TutorAnswer {
  /** 제안이 없어도 온다 — 기록 참조·제안 확인에 쓴다 */
  messageId: number
  answer: string
  answeredBy: TutorAnsweredBy
  /**
   * 말랑이의 제안. **대부분 null 이다.** 한 답에 제안은 최대 하나뿐이므로
   * 버튼이 두 개 뜨는 경우는 없다.
   */
  proposedAction: TutorProposedAction | null
}

/**
 * 대화 기록 한 줄 (GET /classrooms/{id}/students/{sid}/tutor-messages — 최근 것이 위).
 * **학급 선생님 또는 본인**만 볼 수 있다.
 */
export interface TutorMessage {
  id: number
  question: string
  answer: string
  answeredBy: TutorAnsweredBy
  /** 제안이 있었던 줄만 채워진다 (없으면 null) */
  actionType: TutorActionType | null
  /** 아이가 확인했는지 — 선생님이 "전달된 질문"인지 알아볼 근거다 (없으면 null) */
  actionStatus: TutorActionStatus | null
  createdAt: string
  /**
   * 아이의 말에서 **위험 신호**가 잡혔는가 (백엔드 `TutorSafetyFilter`, ce47a1f).
   *
   * ⚠ **선생님 화면에만 그린다.** 아이 자기 화면에는 절대 띄우지 않는다 — 표시가 뜨는 것을
   * 아이가 알면 다음부터 그런 말을 하지 않게 된다. 서버도 같은 판단이라 학급 단위 목록
   * (`FlaggedStudent`)에서는 사유를 아예 빼고 건수만 준다(어깨 너머로 읽히지 않게).
   */
  flagged: boolean
  /**
   * 무엇이 잡혔는지 — 서버가 정한 **세 가지 중 하나**다
   * (`자해·자살 신호` · `폭력 피해 신호` · `괴롭힘 신호`). 안 잡혔으면 null.
   */
  flagReason: string | null
}

/**
 * 위험 신호가 잡힌 학생 한 줄 (GET /classrooms/{id}/tutor-flags).
 *
 * **선생님 전용**(학생은 403 `tutor-flags-forbidden`). 신호가 한 건도 없는 학생은 목록에
 * 오지 않으므로, 빈 배열은 "학급에 아무 신호도 없다"는 뜻이다.
 *
 * 사유가 없는 것은 실수가 아니다 — 위 `flagReason` 주석 참고. 무엇이 잡혔는지는 그 학생의
 * 대화 기록을 열어야 보인다.
 */
export interface FlaggedStudent {
  studentId: number
  /** 잡힌 대화 수 */
  count: number
}
