/** 인증/사용자 도메인 타입 — 백엔드 계약(UserSummary/TokenResponse)과 1:1 대응 */

/** 백엔드 User.role 과 동일한 대문자 표기 */
export type Role = 'TEACHER' | 'STUDENT'

/** 백엔드 UserSummary */
export interface AuthUser {
  id: number
  name: string
  role: Role
  /** 선생님: 재직 학교 */
  school: string | null
  /** 학생: 학년 (1~6) */
  grade: number | null
}

/** POST /api/auth/login — 선생님은 이메일, 학생은 발급 아이디/코드 */
export interface LoginRequest {
  username: string
  password: string
}

/** POST /api/auth/teachers/signup */
export interface TeacherSignupRequest {
  email: string
  password: string
  name: string
  school: string
}

/** 로그인/재발급 응답 */
export interface TokenResponse {
  accessToken: string
  refreshToken: string
  user: AuthUser
}
