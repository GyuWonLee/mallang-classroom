/**
 * 선생님 화면의 경로와 **뎁스 규칙**을 한 곳에 모은 곳.
 *
 * 뎁스(깊이) 구조 — 아래로 갈수록 깊다:
 *
 * ```
 * L1    /teacher                                    내 학급 (학급 목록)
 * L1.5  /teacher/pick?for=students|assignments|…    담당 학급 선택
 * L2    /teacher/classroom/:id/enter                학급 화면 (학년 선택)
 * L3    /teacher/classroom/:id?group=N&session=M    라이브 수업   <- 몰입형(사이드바 없음)
 * L3    /teacher/classroom/:id/manage               학급 관리
 * L3    /teacher/classroom/:id/students             학생 관리
 * L3    /teacher/classroom/:id/assignments          과제 관리
 * ```
 *
 * **규칙 1 — 뒤로가기는 "온 길"이 아니라 "흐름의 한 단계 위"로 간다.**
 *
 * 사이드바는 화면 어디서나 옆으로 건너뛸 수 있는 지름길이라, 방문 이력을 그대로 따르면
 * 과제 관리 -> (사이드바) 학생 관리 -> 뒤로 -> 과제 관리 처럼 **같은 깊이를 오가며 제자리**를 돈다.
 * 그래서 뒤로가기는 지름길을 기억하지 않고 정식 관문으로 되돌린다:
 *
 * ```
 * 학생/과제/학급 관리(L3)  ->  담당 학급 선택(L1.5)   <- 사이드바로 곧장 들어왔을 때의 상위
 * 학급 화면(L2)            ->  내 학급(L1)
 * ```
 *
 * 이 "정식 상위"는 각 화면이 `backTarget()` 에 넘기는 **fallback** 으로 표현된다.
 *
 * **규칙 2 — 옆으로 새면 돌아올 길을 남긴다.** 같은 흐름 안에서 이어지는 이동(내 학급 카드 ->
 *   학급 관리, 학급 화면 -> 전체 학생 보기, 라이브 -> 학급 관리)은 `fromState()` 로 출발지를
 *   실어 보내고, 도착지의 뒤로가기가 그 출발지로 되돌아간다 — 이때는 방문 이력과 흐름이 같다.
 *   덕분에 **사용자가 나가기를 누르지 않는 한 수업 밖으로 튕기지 않는다.**
 *   반대로 사이드바는 출발지를 **일부러 싣지 않아** 규칙 1 의 fallback 이 걸리게 둔다.
 */

/**
 * 학급 관리 화면의 탭 — URL(?tab=)로 딥링크할 수 있다.
 * 학생 관리는 탭이 아니라 **별도 화면**(`students`)이다 — ref 의 화면 4.
 */
/**
 * 학급 관리 화면의 탭. 과제는 ref `viewAssignments` 처럼 **독립 화면**이라 여기 없다.
 * (학생 관리도 마찬가지 — ref 화면 4)
 */
export type ManageTab = 'overview' | 'materials' | 'understanding'

/** 학급 선택 화면이 "고른 뒤 어디로 갈지" — ref PC_TARGETS */
export type PickIntent = 'assignments' | 'students' | 'overview'

export const teacherRoutes = {
  /** L1 — 내 학급. 레퍼런스 사이드바에 있는 최상위 목적지는 이것뿐이다 */
  home: '/teacher',
  /** 채팅 관리 — 사이드바가 아니라 학급 화면의 메시지 패널·라이브에서 진입한다 */
  chat: '/teacher/chat',

  /**
   * L1.5 — 학급 선택. 사이드바의 과제/학생 관리를 학급 없이 눌렀을 때 거쳐 가는 화면.
   * ref `viewPickClass` 처럼 **모달이 아니라 화면**이라 뒤로가기·새로고침·딥링크가 다 된다.
   */
  pickClass: (intent: PickIntent) => `/teacher/pick?for=${intent}`,

  /** L2 — 학급 화면 (학년별 수업 선택). "수업 참여"의 도착지 */
  classDetail: (classroomId: string) => `/teacher/classroom/${classroomId}/enter`,

  /** L3 — 학급 관리. tab 을 주면 그 탭으로 바로 연다 (사이드바의 과제/설정) */
  classManage: (classroomId: string, tab?: ManageTab) =>
    `/teacher/classroom/${classroomId}/manage${tab ? `?tab=${tab}` : ''}`,

  /** L3 — 학생 관리. 목록 + 상세를 한 화면에서 다루는 독립 화면 (ref 화면 4) */
  students: (classroomId: string) => `/teacher/classroom/${classroomId}/students`,

  /** L3 — 과제 관리. 툴바 + 과제 카드 목록의 독립 화면 (ref 화면 5 viewAssignments) */
  assignments: (classroomId: string) => `/teacher/classroom/${classroomId}/assignments`,

  /** L3 — 라이브 수업. session 은 LiveKit/STOMP 입장에 필요하다 */
  live: (classroomId: string, opts: { group: number; session: number }) =>
    `/teacher/classroom/${classroomId}?group=${opts.group}&session=${opts.session}`,
} as const

/** 라우터 state 로 실어 보내는 출발지 */
export interface FromState {
  from?: string
}

/** 현재 위치를 출발지로 실어 보낼 때 — `navigate(to, fromState(location))` */
export function fromState(location: { pathname: string; search?: string }): {
  state: FromState
} {
  return { state: { from: `${location.pathname}${location.search ?? ''}` } }
}

/**
 * 뒤로가기 목적지. 출발지가 실려 있으면 그리로, 없으면 `fallback`(= 흐름상 정식 상위)으로.
 *
 * 출발지는 **같은 흐름 안에서 이어지는 이동에만** 실린다(규칙 2). 사이드바 같은 지름길은
 * 싣지 않으므로 여기서 fallback 이 걸리고, 그게 규칙 1 의 "흐름의 한 단계 위"가 된다.
 *
 * 외부 URL 주입을 막기 위해 `/` 로 시작하는 내부 경로만 받아들인다.
 */
export function backTarget(state: unknown, fallback: string): string {
  const from = (state as FromState | null)?.from
  if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) return from
  return fallback
}

/** 돌아갈 곳이 라이브 수업이면 문구를 "수업으로"로 바꾼다 (어디로 가는지 보이게) */
export function isLiveTarget(target: string): boolean {
  return target.includes('session=')
}

/**
 * 뒤로가기 버튼 문구 — **실제 목적지**를 그대로 말한다.
 *
 * 학급 선택 화면에서 들어온 경우가 특히 중요하다. 예전엔 fallback 이 늘 `classDetail` 이라
 * 학급에 **들어간 적이 없는데도** 뒤로가기가 학급 안으로 들여보내면서 문구까지
 * "3·4학년 국어로" 라고 떠서, 사용자는 자기가 그 학급에 있었다고 착각하게 됐다.
 */
export function backLabelFor(target: string, className?: string): string {
  if (isLiveTarget(target)) return '수업으로 돌아가기'
  if (target.startsWith('/teacher/pick')) return '학급 선택으로'
  if (target === teacherRoutes.home) return '내 학급으로'
  if (target === teacherRoutes.chat) return '채팅 관리로'
  // 같은 깊이(L3)끼리 오간 경우 — 학급 이름을 말하면 학급 화면으로 가는 것처럼 읽힌다
  if (target.includes('/manage')) return '학급 관리로'
  if (target.includes('/students')) return '학생 관리로'
  if (target.includes('/assignments')) return '과제 관리로'
  // 남은 건 학급 화면(L2 `/enter`) 뿐이다
  return className ? `${className}로` : '학급 화면으로'
}
