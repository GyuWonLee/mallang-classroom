import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

/** 공용 axios 인스턴스 — 모든 REST 호출은 이걸 import해서 사용 */
export const api = axios.create({
  baseURL: API_BASE_URL,
})

const ACCESS_TOKEN_KEY = 'accessToken'
const REFRESH_TOKEN_KEY = 'refreshToken'

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

/** 로그인 성공 시 accessToken(+refreshToken)을 함께 저장 */
export function setTokens(accessToken: string, refreshToken?: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

// 로그인 후 저장된 JWT를 모든 요청에 자동 첨부
api.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── 401 → accessToken 자동 재발급 (single-flight) ──────────────────────────
// 백엔드 계약: accessToken 30분 / refreshToken 14일. 401 이 오면 refresh 로 한 번 재발급 후
// 원 요청을 재시도한다. 재발급도 실패하면 세션을 정리하고 로그인 화면으로 보낸다.
// 여러 요청이 동시에 401 을 받아도 refresh 는 한 번만 돌도록 in-flight 프라미스를 공유한다.

/** 재시도 여부 플래그를 실은 요청 설정 */
type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean }

let refreshInFlight: Promise<string> | null = null

/**
 * 탭/새로고침 간 재발급 경쟁 방지용 락.
 *
 * 백엔드는 refresh 토큰을 **회전**시키고, 저장된 것과 다른 토큰이 오면 재사용 공격으로 보고
 * 저장분을 지워버린다. 그래서 두 곳에서 동시에 재발급을 시도하면 늦은 쪽이 옛 토큰을 보내
 * **세션이 통째로 날아간다.** 한 번에 하나만 재발급하도록 localStorage 로 문지기를 둔다.
 */
const LOCK_KEY = 'mallang.refresh.lock'
const LOCK_TTL = 10_000
const WAIT_TIMEOUT = 8_000

function lockHeldElsewhere(): boolean {
  const at = Number(localStorage.getItem(LOCK_KEY) ?? 0)
  return Number.isFinite(at) && Date.now() - at < LOCK_TTL
}

/** 다른 컨텍스트가 재발급을 끝내 accessToken 이 바뀌기를 기다린다 */
function waitForNewToken(previous: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const current = getAccessToken()
      if (current && current !== previous) {
        clearInterval(timer)
        resolve(current)
      } else if (Date.now() - started > WAIT_TIMEOUT) {
        clearInterval(timer)
        reject(new Error('refresh wait timeout'))
      }
    }, 100)
  })
}

/** refresh 엔드포인트는 인터셉터를 타지 않도록 raw axios 로 호출 */
async function callRefresh(refreshToken: string): Promise<string> {
  const { data } = await axios.post<{ accessToken: string; refreshToken?: string }>(
    `${API_BASE_URL}/auth/refresh`,
    { refreshToken },
  )
  setTokens(data.accessToken, data.refreshToken)
  return data.accessToken
}

async function runRefresh(): Promise<string> {
  const before = getAccessToken()

  // 다른 탭이 이미 돌리는 중이면 내가 또 쏘지 않고 결과만 받아 쓴다
  if (lockHeldElsewhere()) return waitForNewToken(before)

  const refreshToken = getRefreshToken()
  if (!refreshToken) throw new Error('no refresh token')

  localStorage.setItem(LOCK_KEY, String(Date.now()))
  try {
    return await callRefresh(refreshToken)
  } catch (err) {
    // 내가 쏘는 사이 다른 곳이 먼저 회전시켰다면 저장된 토큰이 새것이다 — 그걸로 한 번 더
    const current = getRefreshToken()
    if (current && current !== refreshToken) return callRefresh(current)
    throw err
  } finally {
    localStorage.removeItem(LOCK_KEY)
  }
}

/**
 * 세션이 끊기면 로그인으로 보낸다.
 *
 * 보던 위치를 `?from=` 으로 남기지 않는다 — 재로그인 후 진입 화면은 언제나 각자의 홈이라
 * (useAuth 의 login.onSuccess) 읽는 쪽이 없다. 남겨 두면 아무도 안 보는 쿼리가 로그인
 * 주소에 붙고, 다음 사람은 그게 아직 동작하는 복귀 장치라고 읽는다.
 */
function redirectToLogin(): void {
  clearTokens()
  if (window.location.pathname !== '/login') window.location.href = '/login'
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined
    const status = error.response?.status
    const url = original?.url ?? ''

    // 인증 엔드포인트 자체의 401(로그인 실패 등)이나 이미 재시도한 요청은 그대로 실패시킨다.
    const isAuthCall = url.includes('/auth/login') || url.includes('/auth/refresh')
    if (status !== 401 || !original || original._retry || isAuthCall) {
      if (status === 401 && !isAuthCall && !original?._retry) redirectToLogin()
      return Promise.reject(error)
    }

    original._retry = true
    try {
      refreshInFlight ??= runRefresh().finally(() => {
        refreshInFlight = null
      })
      const newToken = await refreshInFlight
      original.headers.Authorization = `Bearer ${newToken}`
      return api(original)
    } catch (refreshError) {
      redirectToLogin()
      return Promise.reject(refreshError)
    }
  },
)
