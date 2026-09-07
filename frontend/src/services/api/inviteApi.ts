import { api } from './client'
import type {
  AcceptInviteRequest,
  AcceptInviteResponse,
  CreateInviteRequest,
  Invite,
  InvitePreview,
  PasswordResetResponse,
} from '@/types/invite'

/**
 * 초대/비밀번호 초기화 API — api-spec.md 3장.
 * 학생 계정 직접 생성(create/bulk)은 classroomApi 에 있고, 여기는 초대 링크·비번 초기화를 담당.
 *
 * 백엔드 112(초대)·115(비번 초기화) 구현 완료 — 전 메서드 실서버.
 * 만료·사용소진·회수된 코드는 수락 시 `410 invite-expired` 로 돌아온다.
 */
export const inviteApi = {
  /** 초대 생성 — POST /api/classrooms/{id}/invites */
  async createInvite(classroomId: string, body: CreateInviteRequest): Promise<Invite> {
    const { data } = await api.post<Invite>(`/classrooms/${classroomId}/invites`, body)
    return data
  },

  /** 유효한 초대 목록 (만료·회수·소진은 서버가 제외) — GET /api/classrooms/{id}/invites */
  async listInvites(classroomId: string): Promise<Invite[]> {
    const { data } = await api.get<Invite[]>(`/classrooms/${classroomId}/invites`)
    return data
  },

  /** 초대 즉시 만료 — DELETE /api/invites/{inviteId} */
  async revokeInvite(inviteId: number): Promise<void> {
    await api.delete(`/invites/${inviteId}`)
  },

  /**
   * 초대 코드 미리보기 — GET /api/invites/{code} (백엔드 S15P11A407-137, **공개**).
   *
   * 수락 전에 "어느 학급인지 · 지금 쓸 수 있는지"를 먼저 보여주려고 만든 것이다. 예전엔 이게
   * 없어서 화면이 코드만으로는 초대 타입을 몰랐고, 만료된 코드인지도 폼을 다 채워 보내야 알았다.
   *
   * **못 쓰는 코드도 200 이다** (`usable: false` + `reason`). 404 는 아예 없는 코드뿐이고,
   * 조회 폭주는 레이트리밋에 걸려 429 가 온다.
   */
  async previewInvite(code: string): Promise<InvitePreview> {
    const { data } = await api.get<InvitePreview>(`/invites/${code}`)
    return data
  },

  /**
   * 초대 수락 (학생 가입+등록 / 선생님 MAINTAINER 등록) — POST /api/invites/{code}/accept.
   * 이 엔드포인트만 비인증 공개다. TEACHER 초대는 로그인 상태여야 하고(403 teacher-login-required),
   * STUDENT 초대는 body 의 계정 정보가 필수다(400 student-info-required).
   */
  async acceptInvite(code: string, body: AcceptInviteRequest = {}): Promise<AcceptInviteResponse> {
    const { data } = await api.post<AcceptInviteResponse>(`/invites/${code}/accept`, body)
    return data
  },

  /** 학생 비밀번호 초기화 — POST /api/students/{studentId}/password-reset */
  async resetStudentPassword(studentId: number): Promise<PasswordResetResponse> {
    const { data } = await api.post<PasswordResetResponse>(`/students/${studentId}/password-reset`)
    return data
  },
}
