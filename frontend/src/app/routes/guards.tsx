import type { ReactNode } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'
import { RouteFallback } from './RouteFallback'
import { homePathFor } from '@/hooks/useAuth'
import type { Role } from '@/types/auth'

/**
 * 로딩 자리표시자 — 세션 복원 중(토큰은 있으나 role 미확정) 짧게 노출.
 *
 * 라우트 청크를 받을 때 뜨는 화면과 **같은 것을 쓴다**(`RouteFallback`). 예전에는 여기만
 * 점 하나 + "불러오는 중…" 이라, 새로고침하면 두 로딩 화면이 잇달아 다른 모양으로 스쳤다.
 */
const Loading = RouteFallback

/** 인증 필요 — 토큰 없으면 로그인으로 */
export function RequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}

/** 특정 role 전용 — 다른 role 이면 각자 홈으로 되돌림 */
export function RequireRole({ role, children }: { role: Role; children?: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  // 세션 복원 중(user 미확정)에는 통과시키고, 확정되면 role 검사
  if (user && user.role !== role) {
    return <Navigate to={homePathFor(user.role)} replace />
  }
  return <>{children ?? <Outlet />}</>
}

/** 인덱스('/') 진입 — 로그인 여부/role 에 따라 알맞은 홈으로 */
export function RoleRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!user) return <Loading />
  return <Navigate to={homePathFor(user.role)} replace />
}
