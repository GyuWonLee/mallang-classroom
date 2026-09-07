/** 교실 도메인 공유 타입 */

/** 비디오 그리드 레이아웃 모드 */
export type LayoutMode = 'grid' | 'speaker'

/** 콘텐츠 메인 뷰 (교실 ↔ 퀴즈) */
export type ClassroomView = 'classroom' | 'quiz'

/* 참가자 타입은 `types/signaling.ts` 의 `Participant` 하나만 쓴다.
   예전엔 여기에도 같은 이름의 인터페이스가 있어서, 이름만 보고 엉뚱한 쪽을 import 할 수 있었다. */

/** 활동지 한 줄의 진행 상태 */
export type TaskStatus = 'done' | 'next' | 'todo'

/**
 * 'chat'(AI 말랑이 대화)은 여기 없다 — **말랑이는 과제가 아니다.**
 * 대화창은 우측 열의 `AiTutorPanel` 이 늘 열려 있고(백엔드 S15P11A407-137), 이 값을 만드는
 * 과제 유형도 없다. 예전엔 도달할 수 없는 분기만 남아 있었다.
 */
export type TaskKind = 'read' | 'quiz'

export interface DailyTask {
  id: string
  order: number
  kind: TaskKind
  title: string
  subtitle: string
  status: TaskStatus
  /**
   * 내 점수 (백분율 0~100). 아직 안 냈거나 채점 전이면 null.
   * 서버 과제 목록의 `score` 가 원천이다(S15P11A407-130) — 새로고침해도 남는다.
   */
  score: number | null
  /**
   * 이 활동지의 문항 수. **아직 모르면 null** (그때는 화면에 아무것도 그리지 않는다).
   *
   * 목록 응답(`AssignmentSummaryResponse`)에는 문항 수가 없어서 과제 상세를 따로 읽어야
   * 알 수 있다. 그래서 목록이 먼저 뜨고 숫자가 나중에 채워진다(useTaskStore.load).
   */
  problemCount: number | null
}

/** 퀴즈 문제 */
export interface QuizQuestion {
  text: string
  /** 원고지로 표시할 지문 (없으면 null). 줄 구분은 " / " */
  passage: string | null
  answers: string[]
  correct: number
  hint: string
}

