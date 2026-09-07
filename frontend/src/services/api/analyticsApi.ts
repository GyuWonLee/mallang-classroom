import { api } from './client'

/**
 * 신호등 밴드 — 셀 색의 근거. 표본이 적으면(`n < 3`) 밴드를 매기지 않는다.
 *
 * 저학년은 찍어서 맞히는 일이 잦아 문항 두 개로 100%/0% 가 쉽게 나온다.
 * 그걸 초록/빨강으로 칠하면 선생님이 없는 신호를 읽게 되므로 서버가 INSUFFICIENT 로 내려준다.
 */
export type Band = 'GOOD' | 'WARN' | 'RISK' | 'INSUFFICIENT'

/**
 * 히트맵 한 칸 — 학생 한 명 × 태그 하나.
 *
 * `accuracy: null` + `n: 0` 은 **그 태그 문항을 아직 안 풀었다**는 뜻이다. 0% 와 반드시
 * 구분해서 그려야 한다 — 안 푼 아이를 "다 틀렸다"로 보여주면 판단이 거꾸로 간다.
 */
export interface HeatmapCell {
  tag: string
  /** 정답률 % (정수). 미응시면 null */
  accuracy: number | null
  /** 채점된 문항 수(표본) */
  n: number
  band: Band
}

export interface HeatmapRow {
  studentId: number
  name: string
  /** 복식학급이라 한 학급에 학년이 섞인다 */
  grade: number | null
  /** 응답의 `tags` 와 **같은 순서** — 그대로 표의 한 행으로 그린다 */
  cells: HeatmapCell[]
}

/** 태그별 반평균 — 개인 약점과 학급 공통 이슈를 가르는 기준선 */
export interface TagAverage {
  tag: string
  accuracy: number | null
  n: number
  band: Band
}

/**
 * 학급 히트맵 — 학생 × 개념태그 매트릭스. "수업 전 30초 만에 오늘 누굴 챙길지" 보는 화면.
 *
 * **단일 이해도 점수는 없다(의도).** 아이를 한 숫자로 줄 세우지 않기로 팀이 확정했다(명세 §8) —
 * 그래서 프론트에서도 셀 값을 평균해 "이해도 72점" 같은 것을 만들지 않는다.
 */
export interface ClassHeatmap {
  classroomId: number
  /** 열 머리글. 각 학생 `cells` 의 순서와 동일하다 */
  tags: string[]
  classAverages: TagAverage[]
  students: HeatmapRow[]
}

/** 제출 한 건 — 같은 학생이 여러 번 냈으면 **최신 시도만** 온다 */
export interface SubmissionSummary {
  studentId: number
  name: string
  /** 점수 (미채점이면 null) */
  score: number | null
  attemptNo: number
  submittedAt: string
}

/** 학생들이 고른 오답 하나와 그 횟수 */
export interface ChoiceCount {
  /**
   * 학생이 보낸 값 그대로다 — **선택형은 0부터 세는 보기 index**("0" = 첫 번째 보기),
   * 받아쓰기는 입력한 문장. (백엔드 AssignmentSubmissionsService, 학생 화면 useQuiz)
   *
   * 화면에 그대로 적으면 맨 숫자가 되므로 `lib/problemAnswer` 의 `answerLabel` 을 거친다.
   */
  answer: string
  count: number
}

export interface ProblemStat {
  /** 문항 번호 */
  no: number
  conceptTags: string[]
  accuracy: number | null
  n: number
  band: Band
  /**
   * **오답만** 집계하고 많이 고른 순으로 정렬돼 온다 — 재수업 때 먼저 짚을 오답이 앞이다.
   * 의미 해석("소리 나는 대로 적었다")은 담기지 않는다. 그건 리포트의 LLM 몫이다.
   */
  choiceDistribution: ChoiceCount[]
}

/**
 * 과제별 제출 현황 — 미제출자 파악 + 재수업 대상 문항 찾기.
 * 통계는 조회 시 실시간 집계라(학급 20~30명) 별도 갱신 트리거가 없다.
 */
export interface AssignmentSubmissions {
  assignmentId: number
  title: string
  totalStudents: number
  submittedCount: number
  submissions: SubmissionSummary[]
  /** 독려 대상 — 이름은 없다. 학생 명단(`classroomApi`)과 id 로 맞춘다 */
  notSubmittedStudentIds: number[]
  problems: ProblemStat[]
}

/**
 * 학급 분석 API (백엔드 S15P11A407-127, 명세 v1.0 §8) — 둘 다 **선생님 전용**이다.
 *
 * 개인 리포트(`reportApi`)와 역할이 다르다: 이쪽은 반 전체를 훑어 "누구를/무엇을" 고르는 화면이고,
 * 개인 리포트는 고른 뒤 한 명을 파고드는 화면이다.
 */
export const analyticsApi = {
  /**
   * 학급 히트맵 — GET /api/classrooms/{id}/understanding.
   * 같은 과제 재제출은 최신 시도만 집계된다("지금 이해 상태"를 보는 화면이라 표본을 부풀리지 않는다).
   */
  async getClassHeatmap(classroomId: string | number): Promise<ClassHeatmap> {
    const { data } = await api.get<ClassHeatmap>(`/classrooms/${classroomId}/understanding`)
    return data
  },

  /** 과제별 제출 현황 — GET /api/assignments/{id}/submissions */
  async getAssignmentSubmissions(assignmentId: string | number): Promise<AssignmentSubmissions> {
    const { data } = await api.get<AssignmentSubmissions>(`/assignments/${assignmentId}/submissions`)
    return data
  },
}

/** 밴드별 표시 문구 — 색만으로 상태를 구분하지 않기 위해 항상 라벨을 병기한다 */
export const BAND_LABEL: Record<Band, string> = {
  GOOD: '잘해요',
  WARN: '더 볼까요',
  RISK: '챙겨주세요',
  INSUFFICIENT: '자료 부족',
}
