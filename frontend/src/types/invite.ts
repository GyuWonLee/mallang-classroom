/** 초대 도메인 타입 — api-spec.md 3장 (Invite) */

export type InviteType = 'TEACHER' | 'STUDENT'

/** 초대 (POST/GET /classrooms/{id}/invites 응답) */
export interface Invite {
  id: number
  code: string
  type: InviteType
  maxUses: number
  usedCount: number
  expiresAt: string
  /** 회수 시각 (유효하면 null) */
  revokedAt: string | null
}

/** 초대 생성 요청 */
export interface CreateInviteRequest {
  type: InviteType
  /** 만료까지 시간 (기본 48) */
  expiresInHours?: number
  /** 사용 횟수 (기본: STUDENT 30, TEACHER 1) */
  maxUses?: number
}

/**
 * 초대 코드 미리보기 (GET /invites/{code} — 공개, 백엔드 S15P11A407-137 §11.1 #2).
 *
 * 가입 폼을 채우기 전에 "어느 학급인지 · 지금 쓸 수 있는지"를 보여준다.
 * **못 쓰는 코드도 200 으로 온다** — 없는 코드만 404 다. 그래서 `usable` 로 분기하고,
 * `reason` 이 있으면 폼을 막고 안내 문구를 띄운다. 레이트리밋이 걸려 있어 폭주 조회는 429.
 */
export interface InvitePreview {
  classroomName: string
  type: InviteType
  usable: boolean
  /** 못 쓰는 이유 — 쓸 수 있으면 null */
  reason: 'REVOKED' | 'EXPIRED' | 'USED_UP' | null
}

/** 초대 수락 요청 — 학생은 계정 정보 입력, 선생님은 로그인 상태로 수락 */
export interface AcceptInviteRequest {
  /** 학생 계정 정보 (STUDENT 초대 시) */
  name?: string
  grade?: number
  school?: string
  password?: string
}

/**
 * 초대 수락 응답.
 * STUDENT 초대는 서버가 아이디를 발급해 `username` 을 채우고, TEACHER 초대는 null 이다.
 */
export interface AcceptInviteResponse {
  classroomId: number
  classroomName: string
  role: string
  username: string | null
}

/** 학생 비밀번호 초기화 응답 (새 임시 비밀번호 1회 노출) */
export interface PasswordResetResponse {
  username: string
  temporaryPassword: string
}
