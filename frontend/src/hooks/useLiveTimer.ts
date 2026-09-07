import { useEffect, useState } from 'react'

/**
 * 수업 경과 시간 타이머 — mm:ss 또는 h:mm:ss.
 *
 * 서버의 수업 시작 시각(`activeSession.startedAt`)을 기준으로 계산한다.
 * 예전에는 `startSeconds = 754` 가 기본값이어서 **수업이 없어도 "12:34"가 흘러갔다** —
 * 진행 중이 아닌데 진행 중처럼 보이는 가장 나쁜 종류의 가짜 상태였다.
 * `startedAt` 이 없으면 빈 문자열을 돌려주므로 호출부가 타이머를 숨길 수 있다.
 */
export function useLiveTimer(startedAt: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  if (!startedAt) return ''

  const started = new Date(startedAt).getTime()
  if (!Number.isFinite(started)) return ''

  const seconds = Math.max(0, Math.floor((now - started) / 1000))
  const h = Math.floor(seconds / 3600)
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const s = String(seconds % 60).padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}
