import { api, setTokens, clearTokens, getRefreshToken } from './client'
import type {
  AuthUser,
  LoginRequest,
  TeacherSignupRequest,
  TokenResponse,
} from '@/types/auth'

/**
 * 인증 API — 백엔드 /api/auth/* 계약과 1:1 대응.
 * 토큰 저장/삭제는 client.ts 헬퍼에 위임한다. (세션 상태는 useAuthStore에서 관리)
 */
export const authApi = {
  /** 선생님 회원가입 → 생성된 UserSummary 반환(자동 로그인 아님) */
  async signupTeacher(body: TeacherSignupRequest): Promise<AuthUser> {
    const { data } = await api.post<AuthUser>('/auth/teachers/signup', body)
    return data
  },

  /** 로그인 (선생님: 이메일 / 학생: 발급 아이디) */
  async login(body: LoginRequest): Promise<TokenResponse> {
    const { data } = await api.post<TokenResponse>('/auth/login', body)
    setTokens(data.accessToken, data.refreshToken)
    return data
  },

  /** accessToken 재발급 (refresh 회전) */
  async refresh(): Promise<TokenResponse> {
    const refreshToken = getRefreshToken()
    const { data } = await api.post<TokenResponse>('/auth/refresh', { refreshToken })
    setTokens(data.accessToken, data.refreshToken)
    return data
  },

  /** 내 정보 */
  async me(): Promise<AuthUser> {
    const { data } = await api.get<AuthUser>('/auth/me')
    return data
  },

  /**
   * 비밀번호 변경 — POST /api/auth/password (204). 학생·선생님 공용 (백엔드 S15P11A407-131).
   *
   * 학생 계정은 선생님이 발급한 임시 비밀번호로 시작하므로 본인이 바꿀 수단이 반드시 필요하다.
   * 새 비밀번호는 8자 이상(선생님 회원가입과 같은 규칙).
   *
   * **변경하면 모든 기기에서 재로그인이 필요하다** — 서버가 기존 refresh 토큰을 무효화한다.
   * 그래서 성공 후에는 토큰을 지워 로그인 화면으로 보내야 한다(호출부가 처리).
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api.post('/auth/password', { currentPassword, newPassword })
  },

  /**
   * 재설정 메일 요청 — POST /api/auth/password-reset/request (204). **선생님 전용.**
   *
   * 가입된 주소든 아니든 **응답이 같다.** 서버가 일부러 구분하지 않는다 — 다르게 주면
   * 이 화면이 가입 여부 조회기가 된다. 그래서 화면도 "메일이 갔는지" 를 단정하지 말고
   * "가입된 주소라면 갔다" 로 안내해야 한다.
   *
   * 학생은 이메일이 없어 이 길을 쓸 수 없다 — 선생님이 학생 관리에서 초기화해 준다.
   */
  async requestPasswordReset(email: string): Promise<void> {
    await api.post('/auth/password-reset/request', { email })
  },

  /**
   * 재설정 완료 — POST /api/auth/password-reset/confirm (204).
   * 토큰은 단회용이고 30분이면 만료된다. 성공하면 모든 기기의 세션이 끊긴다.
   *
   * **이 브라우저의 토큰도 함께 버린다.** 서버가 지우는 것은 refresh 토큰이고 access 토큰은
   * 무상태(JWT)라 만료까지 그대로 통한다 — 로그인한 채로 비밀번호를 바꾸면 "모든 기기에서
   * 로그아웃됐다"고 안내받은 화면이 정작 이 탭에서는 계속 로그인 상태로 남는다.
   * 남겨 두면 다음 갱신 시점에 refresh 가 거절되며 뒤늦게 튕겨 나가기도 한다.
   */
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    await api.post('/auth/password-reset/confirm', { token, newPassword })
    clearTokens()
  },

  /** 로그아웃 (refresh 무효화 + 로컬 토큰 삭제) */
  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } finally {
      clearTokens()
    }
  },
}
