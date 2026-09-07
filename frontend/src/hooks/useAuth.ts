import { useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/services/api/authApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { getAccessToken } from '@/services/api/client'
import type { AuthUser, LoginRequest, Role, TeacherSignupRequest } from '@/types/auth'

/** role 에 따른 로그인 후 진입 경로 (학생은 로비 없이 바로 수업으로) */
export function homePathFor(role: Role): string {
  return role === 'TEACHER' ? '/teacher' : '/classroom'
}

/**
 * 인증 Controller — authApi(서비스)와 라우팅/세션 스토어를 잇는다.
 * 로그인 성공 시 응답의 role 로 학생/선생님 화면을 분기한다.
 */
export function useAuth() {
  const navigate = useNavigate()
  const setUser = useAuthStore((s) => s.setUser)
  const clear = useAuthStore((s) => s.clear)

  const login = useMutation({
    mutationFn: (body: LoginRequest) => authApi.login(body),
    onSuccess: ({ user }) => {
      setUser(user)
      /*
        로그인 후 첫 화면은 **언제나 각자의 홈**이다 — 선생님은 내 학급 대시보드, 학생은 수업.

        예전엔 `?from=` 을 읽어 세션이 끊기기 직전 화면으로 되돌려 줬는데, 그러면 로그인할
        때마다 도착지가 달라져 어디서 시작할지 예측할 수 없었다(학급 하나 안쪽 깊은 화면에서
        시작하기도 했다). 되돌아갈 화면은 홈에서 두어 번 눌러 다시 찾아갈 수 있다.
      */
      navigate(homePathFor(user.role), { replace: true })
    },
  })

  const signup = useMutation({
    mutationFn: (body: TeacherSignupRequest) => authApi.signupTeacher(body),
    onSuccess: () => navigate('/login', { replace: true }),
  })

  const logout = useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: () => {
      clear()
      navigate('/login', { replace: true })
    },
  })

  return { login, signup, logout }
}

/**
 * 앱 부팅 시 저장된 토큰으로 내 정보를 복원한다.
 * 토큰이 없으면 요청하지 않고, 성공하면 세션 스토어를 채운다.
 */
export function useSessionRestore() {
  const setUser = useAuthStore((s) => s.setUser)
  const hasToken = Boolean(getAccessToken())

  const onUser = useCallback((user: AuthUser) => setUser(user), [setUser])

  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const user = await authApi.me()
      onUser(user)
      return user
    },
    enabled: hasToken,
    retry: false,
    staleTime: Infinity,
  })
}
