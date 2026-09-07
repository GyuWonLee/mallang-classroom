import type { ReactNode } from 'react'
import { QueryProvider } from './QueryProvider'

/** 앱 전역 Provider 조립 지점 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>
}
