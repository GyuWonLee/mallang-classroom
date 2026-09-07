import type { Subject } from '@/types/assignment'
import type { ClassSubject } from '@/types/teacher'

/**
 * 백엔드 과목 코드 → 화면 한글 표기. **한글을 붙이는 곳은 여기 하나다.**
 *
 * 서버는 과목을 enum 이름(`"KOREAN"`)으로만 내려준다. `Subject.label()` 이 서버에 있지만
 * 어느 DTO 에도 실리지 않고, 통지표는 응답에서 `subjectLabel` 을 일부러 뺐다(72c7bce) —
 * "과목 한글표기는 FE 매핑" 이 정해진 역할 분담이다. 그래서 화면 곳곳이 제각각 한글을
 * 만들지 않게 이 표를 거치게 한다.
 *
 * `ClassSubject`(학급 카드용 한글 리터럴)와 값이 정확히 겹치므로 그 타입을 그대로 쓴다 —
 * 과목 이름이 두 벌로 갈라지지 않게 하려는 것이다.
 */
export const SUBJECT_LABEL: Record<Subject, ClassSubject> = {
  KOREAN: '국어',
  ENGLISH: '영어',
  MATH: '수학',
  SOCIAL: '사회',
  SCIENCE: '과학',
}

/**
 * 화면에 늘어놓을 때의 과목 순서 — **백엔드 enum 선언 순서와 같게 맞춴다.**
 *
 * 통지표 초안(`POST .../report-card/draft`)이 `Subject` 선언 순서대로 5행을 돌려주므로,
 * 화면이 다른 순서로 그리면 서버가 준 행과 눈으로 대조가 안 된다.
 */
export const SUBJECT_CODES = ['KOREAN', 'ENGLISH', 'MATH', 'SOCIAL', 'SCIENCE'] as const

/**
 * 과목 코드를 한글로. **모르는 코드는 국어로 메우지 않고 `null` 을 준다** —
 * 서버가 과목을 늘렸을 때 엉뚱한 과목 이름을 붙여 보여주는 게 빈칸보다 나쁘다.
 */
export function subjectLabel(subject: Subject | null | undefined): ClassSubject | null {
  if (!subject) return null
  return SUBJECT_LABEL[subject] ?? null
}

/** 과목별 마스코트 캐릭터 이미지 (public/assets) */
const SUBJECT_IMAGE: Record<ClassSubject, string> = {
  수학: '/assets/math-ch.webp',
  영어: '/assets/english-ch.webp',
  사회: '/assets/social-ch.webp',
  과학: '/assets/science-ch.webp',
  국어: '/assets/korean-ch.webp',
}

export function subjectImage(subject: ClassSubject = '국어'): string {
  return SUBJECT_IMAGE[subject] ?? SUBJECT_IMAGE.국어
}

/** 학년별 식물 이미지 (public/assets 1st_g~6th_g) — 모둠(학년) 아바타에 사용 */
const GRADE_ORDINAL = ['1st', '1st', '2nd', '3rd', '4th', '5th', '6th'] as const
export function gradePlantImage(grade: number): string {
  const ord = GRADE_ORDINAL[grade] ?? '1st'
  return `/assets/${ord}_g.webp`
}

/** 담당 학년을 사람이 읽는 라벨로 — [3,4] -> "3·4학년" */
export function gradeLabelOf(grades: readonly number[] | undefined): string {
  if (!grades || grades.length === 0) return '학년 미정'
  return `${[...grades].sort((a, b) => a - b).join('·')}학년`
}

/** 학년별 카드 팔레트 (레퍼런스 teacher.html .module-card.grade-N) */
export interface GradePalette {
  bg: string
  border: string
  cta: string
  pill: string
  pillText: string
}
export const GRADE_PALETTE: Record<number, GradePalette> = {
  1: { bg: '#FDF5E0', border: '#FDECB6', cta: '#E3A72F', pill: '#FDF5E0', pillText: '#E3A72F' },
  2: { bg: '#F1EBFC', border: '#EADFFD', cta: '#8B6FE0', pill: '#F1EBFC', pillText: '#8B6FE0' },
  3: { bg: '#E9F1FE', border: '#D0E1FD', cta: '#5C9DDB', pill: '#E9F1FE', pillText: '#5C9DDB' },
  4: { bg: '#E5F7F3', border: '#CEF2EA', cta: '#0F9B7E', pill: '#E5F7F3', pillText: '#0F9B7E' },
  5: { bg: '#FEEBDD', border: '#FEDFCD', cta: '#E8813A', pill: '#FEEBDD', pillText: '#E8813A' },
  6: { bg: '#D3DAEF', border: '#AFBEE2', cta: '#2E4374', pill: '#D3DAEF', pillText: '#2E4374' },
}

/**
 * 수업 중인 학년 카드 — 레퍼런스 `.module-card[data-status="live"]` 의 회색.
 *
 * **지금 선생님이 들어가 있는 방 하나만** 이 색이 된다(어느 학년인지는 `useLiveGradeStore`).
 * 나머지 학년은 학년 컬러 그대로라, 회색 카드가 "내가 지금 여기 있다"를 가리킨다.
 *
 * ref 처럼 CTA 도 함께 잠근다 — 이미 사람이 있는 방이라 들어갈 데가 없다. 회색인데 눌리면
 * "잠긴 것처럼 보이는데 왜 눌리지" 가 되므로 hover 로 떠오르는 효과도 같이 끈다.
 */
export const LIVE_GRADE_PALETTE: GradePalette = {
  bg: '#EBEBEE',
  border: '#D6D6DC',
  cta: '#8B8B93',
  pill: '#EBEBEE',
  pillText: '#6B6B72',
}

/**
 * 학년 카드가 가질 수 있는 상태 — 카드 색·배지·버튼이 모두 이 하나에서 갈린다.
 *
 *  - `idle` 수업 없음          학년색 · '수업 가능' · [수업 시작하기] · 눌림
 *  - `live` 수업 중 · 방에 사람  **회색** · '수업중'   · [수업 중]   · **잠김**
 *  - `join` 수업 중 · 방은 빔   학년색 · '수업중'   · [이 수업 들어가기] · 눌림
 *
 * `join` 의 배지는 `idle` 과 **달라야 한다.** 예전엔 둘 다 '수업 가능'(초록)이라, 1학년 수업을
 * 열어 둔 복식학급 선생님 눈에 5학년 카드가 "아직 아무 수업도 없다"로 보였다. 그래서 두 수업이
 * 따로 도는 줄 알았고, 1학년 수업을 끝냈을 때 5학년까지 꺼지는 것이 고장으로 보였다 —
 * 사실은 처음부터 **학급에 수업 하나**였다. 수업이 열려 있으면 어느 학년 카드도 '수업 가능'이라고
 * 말하지 않는다. 카드가 가르는 것은 수업의 유무가 아니라 **내가 그 방에 있는지**뿐이다.
 *
 * `live` 는 **그 방에 선생님이 들어가 있다**는 뜻이라 잠근다(ref 와 같다). 잠가도 자기 수업으로
 * 못 돌아가는 일은 없다 — 방을 나오는 순간 `live` 가 풀려 `join` 이 되기 때문이다
 * (`useLiveGradeStore` 의 소유자는 라이브 화면이다).
 *
 * `join` 을 `idle` 과 갈라 두는 것도 핵심이다. 백엔드 세션은 **학급당 1개**라 이때 버튼을 눌러도
 * 새 수업이 열리지 않고 이미 열린 수업에 그 학년으로 합류한다(새로 만들면 409). 예전엔 둘 다
 * '수업 시작' 이라, 수업이 이미 돌아가는데 새로 여는 줄 알기 쉬웠다.
 */
export type GradeCardState = 'idle' | 'live' | 'join'

/**
 * @param sessionOpen 이 학급에 진행 중인 수업이 있는가 (서버가 아는 사실)
 * @param iAmHere     그 수업에서 내가 **이 학년 방**에 들어가 있는가 (화면이 기억하는 값 —
 *                    서버 세션에 학년이 없어서다. `useLiveGradeStore` 참고)
 */
export function gradeCardState(sessionOpen: boolean, iAmHere: boolean): GradeCardState {
  // 수업이 없으면 어디에도 들어가 있을 수 없다 — 기억이 남아 있어도 세션이 진실이다
  if (!sessionOpen) return 'idle'
  return iAmHere ? 'live' : 'join'
}

/** 상태별 CTA 문구·아이콘 — 문구가 화면 곳곳에서 어긋나지 않게 여기 모아 둔다 */
export const GRADE_CARD_CTA: Record<
  GradeCardState,
  { label: string; busy: string; icon: 'cam' | 'play' }
> = {
  idle: { label: '수업 시작하기', busy: '수업 여는 중…', icon: 'play' },
  // 잠긴 상태라 누를 수 없다 — `busy` 는 쓰이지 않지만 타입을 갈라 두지 않으려고 같은 말을 둔다
  live: { label: '수업 중', busy: '수업 중', icon: 'cam' },
  // '참가하기'였다. 새 수업을 여는 것처럼 읽혀서, 이미 도는 수업에 합류한다는 뜻을 말로 박는다
  join: { label: '이 수업 들어가기', busy: '들어가는 중…', icon: 'cam' },
}

/** 학년 카드 상태 뱃지 색 (레퍼런스 statusCycle) */
export const GRADE_STATUS = {
  live: {
    label: '수업중',
    badgeBg: '#FCE9E7',
    badgeText: '#C6362A',
    badgeBorder: '#F6C3BC',
  },
  ready: { label: '수업 가능', badgeBg: '#E4F6E9', badgeText: '#1F8A45', badgeBorder: '#BFE9CB' },
  quiz: { label: '문제풀이중', badgeBg: '#E9EAFB', badgeText: '#4A50C4', badgeBorder: '#CBCEF2' },
  break: { label: '쉬는시간', badgeBg: '#FFF3D6', badgeText: '#9A6B00', badgeBorder: '#F6DFA0' },
} as const
