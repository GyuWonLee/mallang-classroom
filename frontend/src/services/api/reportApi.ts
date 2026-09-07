import { api } from './client'
import type { AssignmentType, Subject } from '@/types/assignment'

/** 개념 태그별 정답률 한 줄 */
export interface TagStat {
  tag: string
  correct: number
  total: number
  /** 정답률 % (정수) */
  accuracy: number
}

/**
 * 학습 리포트 — 학급 안에서 그 학생의 **모든 과제를 합친** 집계다.
 * 과제 하나짜리 리포트나 학급 전체 리포트 엔드포인트는 없다.
 */
export interface StudentReport {
  studentId: number
  /** 채점된 과제 수 (과제별 최신 시도만 셈) */
  gradedAssignments: number
  /**
   * 전체 정답률 % (0~100).
   *
   * **서버 필드명은 `overall` 이다.** 예전엔 여기를 `overallAccuracy` 로 선언해 둬서
   * 응답에 없는 키를 읽었고, 화면에 `undefined%` 가 그대로 찍혔다(도넛은 NaN 이라
   * 진행 호가 조용히 안 그려졌다). 제출 이력이 없어도 서버는 `int 0` 을 주므로
   * "데이터 없음" 문제가 아니라 이름이 어긋난 것이었다.
   */
  overall: number
  /** 개념별 정답률 — **약한 것부터** 정렬돼 온다 */
  tagStats: TagStat[]
  /** 정답률 80% 이상 개념 */
  strengths: string[]
  /** 정답률 60% 미만 개념 */
  weaknesses: string[]
  /** 격려·조언 문장. 서버가 의도적으로 숫자를 넣지 않는다 */
  comment: string
}

/**
 * 점수 추이의 한 점 — 과제 하나에 대한 그 학생의 **최신 시도**.
 * `score` 가 null 인 것은 수동 채점 유형이라서다 (안 낸 게 아니다 — 제출한 것은 사실).
 */
export interface ScoreTrendPoint {
  assignmentId: number
  assignmentTitle: string
  subject: Subject
  type: AssignmentType
  score: number | null
  attemptNo: number
  submittedAt: string
}

/**
 * 학생별 과제 점수 추이 (백엔드 S15P11A407-137 §11.4).
 *
 * `submissions` 는 **오래된 것부터** 온다 — 추이선이 왼쪽에서 오른쪽으로 읽히도록 서버가
 * 그렇게 정렬한다(다른 목록들과 반대이니 주의). `averageScore` 는 채점된 제출만의 평균이고,
 * 채점된 게 하나도 없으면 null 이다 — **0점이 아니다.**
 */
export interface ScoreTrend {
  studentId: number
  averageScore: number | null
  submissions: ScoreTrendPoint[]
}

/** 오답 클리닉 생성 옵션 — 둘 다 생략 가능(기본 객관식 5문항) */
export interface ClinicOptions {
  type?: AssignmentType
  count?: number
}

/**
 * 학습 리포트 · 오답 클리닉 API (백엔드 S15P11A407-114).
 *
 * 경로가 `/classrooms/{classroomId}/students/{studentId}/...` 라서 **학생이 자기 리포트를 볼 때도
 * classroomId 가 필요**하다.
 *
 * ⚠ "오답 목록/오답 노트" 엔드포인트는 백엔드에 **없다.** 틀린 문항은 제출 응답의 `results` 로,
 * 개념별 약점은 리포트의 `tagStats`/`weaknesses` 로 얻는다. 클리닉은 그 약점으로 **새 문제를
 * 만들어 주는 생성기**다(오답을 다시 보여주는 게 아니다).
 */
export const reportApi = {
  /**
   * 학습 리포트 — GET /api/classrooms/{classroomId}/students/{studentId}/report.
   * 선생님(OWNER/MAINTAINER) 또는 **본인**만 열람 가능 (아니면 `report-forbidden` 403).
   * 제출 이력이 없으면 정답률 0 · 빈 목록 · 템플릿 코멘트가 온다.
   */
  async getReport(classroomId: string, studentId: number): Promise<StudentReport> {
    const { data } = await api.get<StudentReport>(
      `/classrooms/${classroomId}/students/${studentId}/report`,
    )
    return data
  },

  /**
   * 과제 점수 추이 — GET .../students/{studentId}/submissions (S15P11A407-137).
   * 리포트와 같은 권한(선생님 또는 본인)이고, 과제별 최신 시도만 온다.
   *
   * 리포트(`getReport`)와 역할이 다르다: 저쪽은 **개념별** 정답률 집계이고 이쪽은 **시간순**
   * 점수 흐름이다. "무엇을 약해하나"와 "나아지고 있나"는 다른 질문이라 API 도 따로다.
   */
  async getScoreTrend(classroomId: string, studentId: number): Promise<ScoreTrend> {
    const { data } = await api.get<ScoreTrend>(
      `/classrooms/${classroomId}/students/${studentId}/submissions`,
    )
    return data
  },

  /**
   * 오답 클리닉 생성 (선생님 전용) — POST .../clinic → 202 + jobId.
   *
   * 비동기다. 반환된 jobId 를 `assignmentApi.pollJob` 으로 폴링해 초안을 받고, 초안은 평소처럼
   * 과제 생성으로 확정한다. 약점이 없으면 `no-weak-areas`(409) 로 거절된다.
   */
  async startClinic(
    classroomId: string,
    studentId: number,
    options: ClinicOptions = {},
  ): Promise<{ jobId: string }> {
    const { data } = await api.post<{ jobId: string }>(
      `/classrooms/${classroomId}/students/${studentId}/clinic`,
      options,
    )
    return data
  },
}
