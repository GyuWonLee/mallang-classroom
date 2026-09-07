import { create } from 'zustand'
import type { AuthUser } from '@/types/auth'
import { getAccessToken } from '@/services/api/client'

/**
 * 인증 세션 상태 — 로그인한 사용자 정보와 로그인 여부만 보관 (원시/평범 객체).
 * 토큰 문자열 자체는 localStorage(client.ts)가 소유하고, 여기서는 파생 플래그만 둔다.
 */
interface AuthState {
  user: AuthUser | null
  /** 앱 부팅 시 토큰 존재 여부로 초기화 (me() 검증 전까지 낙관적) */
  isAuthenticated: boolean
  setUser: (user: AuthUser | null) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: Boolean(getAccessToken()),
  setUser: (user) => set({ user, isAuthenticated: Boolean(user) }),
  clear: () => set({ user: null, isAuthenticated: false }),
}))
