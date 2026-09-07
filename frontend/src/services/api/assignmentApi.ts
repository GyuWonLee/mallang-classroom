import { api } from './client'
import type {
  Assignment,
  AssignmentDraft,
  AssignmentSummary,
  CreateAssignmentRequest,
  GenerateAssignmentRequest,
  GenerationJob,
  MySubmission,
  MySubmissionDetail,
  SubmissionResult,
  SubmitRequest,
  UpdateAssignmentRequest,
} from '@/types/assignment'

/** 백엔드는 publishedAt(nullable)만 준다 — UI 가 쓰는 published 파생값을 붙여준다 */
function withPublished<T extends { publishedAt: string | null }>(raw: T): T & { published: boolean } {
  return { ...raw, published: raw.publishedAt !== null }
}

/**
 * 과제 API — api-spec.md 7장.
 * 백엔드 구현 완료: 생성·AI생성·폴링·목록·상세·수정·삭제(108) + **제출/자동채점(114)**.
 */
export const assignmentApi = {
  /** 과제 생성 (직접 작성 또는 AI 초안 확정) — POST /api/classrooms/{id}/assignments */
  async createAssignment(classroomId: string, body: CreateAssignmentRequest): Promise<Assignment> {
    const { data } = await api.post<Assignment>(`/classrooms/${classroomId}/assignments`, body)
    return withPublished(data)
  },

  /** AI 과제 생성 (비동기) — POST /api/classrooms/{id}/assignments/generate → 202 { jobId } */
  async generate(classroomId: string, body: GenerateAssignmentRequest): Promise<{ jobId: string }> {
    const { data } = await api.post<{ jobId: string }>(`/classrooms/${classroomId}/assignments/generate`, body)
    return data
  },

  /** AI 생성 작업 상태/결과 폴링 — GET /api/generation-jobs/{jobId} (만료 시 410) */
  async getJob(jobId: string): Promise<GenerationJob> {
    const { data } = await api.get<GenerationJob>(`/generation-jobs/${jobId}`)
    return data
  },

  /**
   * QUEUED/RUNNING 이 끝날 때까지 폴링한다.
   * LLM 호출이 수십 초 걸릴 수 있어(명세 §7) 상한을 넉넉히 잡는다.
   */
  async pollJob(
    jobId: string,
    { intervalMs = 1500, timeoutMs = 120_000 }: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<GenerationJob> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const job = await assignmentApi.getJob(jobId)
      if (job.status === 'DONE' || job.status === 'FAILED') return job
      if (Date.now() >= deadline) {
        throw new Error('생성이 오래 걸리고 있어요. 잠시 후 다시 시도해 주세요.')
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  },

  /** 과제 목록 (학생은 공개분만) — GET /api/classrooms/{id}/assignments */
  async listAssignments(classroomId: string): Promise<AssignmentSummary[]> {
    const { data } = await api.get<AssignmentSummary[]>(`/classrooms/${classroomId}/assignments`)
    return data.map(withPublished)
  },

  /** 과제 상세 (문제 content 포함) — GET /api/assignments/{assignmentId} */
  async getAssignment(assignmentId: number): Promise<Assignment> {
    const { data } = await api.get<Assignment>(`/assignments/${assignmentId}`)
    return withPublished(data)
  },

  /** 과제 수정 (마감일·공개 등) — PATCH /api/assignments/{assignmentId} */
  async updateAssignment(assignmentId: number, body: UpdateAssignmentRequest): Promise<Assignment> {
    const { data } = await api.patch<Assignment>(`/assignments/${assignmentId}`, body)
    return withPublished(data)
  },

  /** 과제 삭제 — DELETE /api/assignments/{assignmentId} */
  async deleteAssignment(assignmentId: number): Promise<void> {
    await api.delete(`/assignments/${assignmentId}`)
  },

  /**
   * 과제 제출 (제출 즉시 자동 채점) — POST /api/assignments/{assignmentId}/submissions → 201.
   *
   * 백엔드 구현 완료(S15P11A407-114). 별도 채점 엔드포인트는 없고 이 응답에 점수가 담겨 온다.
   * 재제출이 허용되며 서버가 `attemptNo` 를 올려 새 기록으로 남긴다(리포트는 **최신 시도**만 센다).
   * 주요 실패: `assignment-not-published`(409) · `assignment-past-due`(409) · `not-a-member`(403).
   */
  async submit(assignmentId: number, body: SubmitRequest): Promise<SubmissionResult> {
    const { data } = await api.post<SubmissionResult>(`/assignments/${assignmentId}/submissions`, body)
    return data
  },

  /**
   * 내 제출 목록 (학생) — GET /api/me/submissions (S15P11A407-129).
   * 과제별 **최신 시도**만 온다. 아직 낸 게 없으면 빈 배열(에러가 아니다).
   */
  async mySubmissions(): Promise<MySubmission[]> {
    const { data } = await api.get<MySubmission[]>('/me/submissions')
    return data
  },

  /**
   * 내 답안 상세 (학생) — GET /api/assignments/{id}/submissions/me (S15P11A407-129).
   * 안 낸 과제면 404 — 호출부는 "아직 안 냈다"로 다루면 된다(에러 토스트를 띄우지 말 것).
   */
  async mySubmission(assignmentId: number): Promise<MySubmissionDetail> {
    const { data } = await api.get<MySubmissionDetail>(
      `/assignments/${assignmentId}/submissions/me`,
    )
    return data
  },
}

/** AI 초안을 확정 저장용 요청으로 — 검수 화면에서 제목/마감일만 덧씌운다 */
export function draftToCreateRequest(
  draft: AssignmentDraft,
  overrides: {
    title?: string
    dueAt?: string | null
    publish?: boolean
    grade?: number | null
    /** 비우면 학급 전체 — 서버가 둘 다 빈 것을 "제한 없음"으로 읽는다 */
    targetGrades?: number[] | null
    targetStudentIds?: number[] | null
  } = {},
): CreateAssignmentRequest {
  return {
    title: overrides.title ?? draft.title,
    subject: draft.subject,
    type: draft.type,
    grade: overrides.grade ?? null,
    source: draft.source,
    sourceMaterialIds: draft.sourceMaterialIds,
    content: draft.content,
    dueAt: overrides.dueAt ?? draft.dueAt,
    publish: overrides.publish ?? false,
    targetGrades: overrides.targetGrades ?? null,
    targetStudentIds: overrides.targetStudentIds ?? null,
  }
}

