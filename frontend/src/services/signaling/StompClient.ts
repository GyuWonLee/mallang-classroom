import { Client, type IFrame, type IMessage, type StompSubscription } from '@stomp/stompjs'
import type { StompEnvelope } from '@/types/realtime'
import { resolveStompUrl } from '@/types/realtime'

/**
 * StompClient — 백엔드 STOMP over WebSocket 실시간 채널의 전송 계층. (SRP, no React)
 *
 * 백엔드 계약 (backend/global/config/WebSocketConfig.java):
 *  - 접속: wss://.../ws  — **SockJS 없음(네이티브 WebSocket)**, CONNECT 네이티브 헤더에
 *    `Authorization: Bearer {accessToken}` 필수 (StompAuthChannelInterceptor 가 검증)
 *  - 발행(pub) 접두사 `/pub`, 구독(sub) 접두사 `/sub` (관례적인 /app·/topic 이 아니다)
 *  - 구독 화이트리스트: `/sub/sessions/{id}`, `/sub/sessions/{id}/teams/{teamId}`,
 *    `/user/sub/notifications` — 그 외 destination 은 서버가 거절한다.
 *  - 봉투: { type, payload, at }
 *
 * 재연결 정책: stompjs 가 자동 재연결한다. 구독은 이 클래스가 **기억했다가** 매 접속마다 다시
 * 건다(desired-state 방식) — 접속 전에 subscribe() 를 호출해도 되고, 재접속 후에도 복구된다.
 *
 * 다만 desired 를 **무조건** 다시 거는 것은 위험하다. 두 가지를 반드시 지킨다:
 *
 *  1) **거절당한 구독은 desired 에서 뺀다.** 백엔드는 허용되지 않은 SUBSCRIBE 에
 *     `AccessDeniedException` 을 던지고, STOMP 규약대로 서버는 ERROR 프레임을 보낸 뒤
 *     **세션을 닫는다**. 즉 구독 한 건이 거절되면 개인 채널까지 통째로 끊긴다. 원인이 된
 *     destination 을 빼지 않으면 "접속 → 같은 구독 → ERROR → 종료"가 영원히 반복된다.
 *     (전형적인 트리거: 백엔드 SessionService.start() 가 트랜잭션 **안에서** SESSION_STARTED 를
 *     발행해서, 학생이 커밋 전에 `/sub/sessions/{id}` 를 구독하면 "존재하지 않는 수업입니다"로
 *     거절된다. 그래서 몇 번은 짧은 지연 뒤 다시 걸어 본다 — 무한이 아니라 횟수 제한.)
 *
 *  2) **매 접속마다 최신 accessToken 을 다시 읽는다.** access 는 30분이라 접속 시점 값을
 *     굳혀 두면 수업 도중 한 번 끊긴 뒤로는 영원히 인증에 실패한다.
 */

export type StompStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error'

/** 서버가 돌려준 ERROR 프레임 — 상위 계층이 낙관적 UI 를 되돌릴 수 있게 그대로 올려 준다. */
export interface StompServerError {
  /** ERROR 프레임의 message 헤더 (백엔드 예외 메시지) */
  message: string
  /** 원인으로 지목된 구독 destination (알아냈을 때만) */
  destination?: string
  /** 더 재시도하지 않고 포기했는가 */
  fatal: boolean
}

export interface StompClientEvents {
  onStatus?: (status: StompStatus) => void
  /** **사용자에게 보여줄** 안내. 재시도 중에는 부르지 않는다(3초마다 토스트 금지). */
  onError?: (message: string) => void
  /** 접속(재접속 포함)이 완료된 직후 — 스냅샷 재동기화 훅 */
  onConnected?: () => void
  /** ERROR 프레임 원본 — 토스트가 아니라 상태 되돌리기용(재시도 중에도 온다) */
  onServerError?: (error: StompServerError) => void
}

type EnvelopeHandler = (env: StompEnvelope) => void

/** 기본 재연결 간격. 인증 단계에서 계속 거절당하면 여기서부터 배로 늘린다. */
const RECONNECT_BASE = 3000
const RECONNECT_MAX = 60_000
/**
 * 구독 거절 재시도 지연. 수업 시작 커밋 직전에 건 구독처럼 **곧 사라질 거절**만 흡수하는 용도라
 * 짧고 유한하다. 이 배열을 다 쓰면 그 destination 은 포기한다.
 */
const SUBSCRIBE_RETRY_DELAYS = [800, 2500, 6000]
/** 접속/인증 단계 실패 상한 — 넘으면 재연결 자체를 멈춘다(무한 루프 차단). */
const MAX_CONNECT_FAILURES = 6
/** 인증만 되면 항상 통과하는 개인 채널 — ERROR 원인 후보에서 뺀다. */
const PERSONAL_DESTINATION = '/user/sub/notifications'

export class StompClient {
  private client: Client | null = null
  private events: StompClientEvents
  /** 접속 때마다 호출해 최신 토큰을 읽는다 (REST 인터셉터와 같은 저장소를 쓴다) */
  private getToken: () => string | null = () => null
  /** 원하는 구독 상태(destination -> handler). 접속 전/재접속 후 모두 이걸 기준으로 복구한다. */
  private desired = new Map<string, EnvelopeHandler>()
  /** 현재 실제로 걸려 있는 구독 */
  private active = new Map<string, StompSubscription>()
  /** 이번 접속에서 SUBSCRIBE 를 보낸 destination(순서대로) — ERROR 원인 추적용 */
  private attempted: string[] = []
  /** destination 별 거절 횟수 */
  private rejections = new Map<string, number>()
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private connectFailures = 0
  /** 상한을 넘겨 스스로 멈췄다 — 같은 안내를 반복하지 않기 위한 표식 */
  private stopped = false

  constructor(events: StompClientEvents = {}) {
    this.events = events
  }

  get connected(): boolean {
    return this.client?.connected ?? false
  }

  /**
   * STOMP 접속. **토큰 값이 아니라 게터를 받는다** — 재연결 때마다 다시 읽어야 하기 때문이다.
   * 게터는 REST(`services/api/client.ts`)와 같은 저장소를 봐야 재발급이 소켓에도 반영된다.
   */
  connect(getToken: () => string | null, url: string = resolveStompUrl()): void {
    if (this.client) return
    this.getToken = getToken
    this.stopped = false
    this.connectFailures = 0
    this.events.onStatus?.('connecting')

    const client = new Client({
      brokerURL: url,
      connectHeaders: this.authHeaders(),
      reconnectDelay: RECONNECT_BASE,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      /*
        재연결 직전마다 CONNECT 헤더를 다시 만든다. 예전엔 접속 시점 토큰을 굳혀 놨는데,
        access 가 30분이라 수업 도중 한 번 끊기면 그 뒤로는 만료된 토큰으로만 재시도해
        실시간이 영구히 죽었다.
      */
      beforeConnect: () => {
        client.connectHeaders = this.authHeaders()
      },
      onConnect: () => {
        this.connectFailures = 0
        client.reconnectDelay = RECONNECT_BASE
        // 재연결이면 서버 쪽 구독은 사라졌으므로 기억해 둔 것을 전부 다시 건다.
        this.active.clear()
        this.attempted = []
        this.desired.forEach((handler, destination) => this.applySubscribe(destination, handler))
        this.events.onStatus?.('connected')
        this.events.onConnected?.()
      },
      onStompError: (frame) => this.handleStompError(frame),
      onWebSocketClose: () => {
        this.active.clear()
        this.attempted = []
        this.events.onStatus?.('closed')
      },
    })
    this.client = client
    client.activate()
  }

  /**
   * 구독 등록. 접속 전에 호출해도 되며(접속되면 자동 적용), 재접속 시에도 자동 복구된다.
   * destination 은 types/realtime.ts 의 `sub.*()` 로 만든다.
   */
  subscribe(destination: string, handler: EnvelopeHandler): void {
    this.desired.set(destination, handler)
    if (this.client?.connected && !this.active.has(destination)) {
      this.applySubscribe(destination, handler)
    }
  }

  /**
   * 발행. destination 은 types/realtime.ts 의 `pub.*()` 로 만든다.
   * **보냈는지 여부를 돌려준다** — 호출한 쪽이 실패를 알아야 "보냈다"고 거짓 안내를 안 한다.
   *
   * 주의: 이 `true` 는 "WebSocket 에 썼다"는 뜻일 뿐 **서버가 받아들였다는 뜻이 아니다.**
   * 백엔드에 `@MessageExceptionHandler` 가 없어서 `@MessageMapping` 안에서 난 예외(판서 권한
   * 없음·배정 안 된 학생·종료된 수업 등)는 서버 로그에만 남고 클라이언트로 오지 않는다.
   * 그래서 낙관적 UI 는 `onServerError` 와 화면 쪽 확인 절차로 되돌려야 한다.
   */
  publish(destination: string, body: Record<string, unknown> = {}): boolean {
    if (!this.client?.connected) {
      this.events.onError?.('아직 수업 서버에 연결되지 않았어요.')
      return false
    }
    this.client.publish({ destination, body: JSON.stringify(body) })
    return true
  }

  unsubscribe(destination: string): void {
    this.desired.delete(destination)
    if (this.client?.connected) this.active.get(destination)?.unsubscribe()
    this.active.delete(destination)
    this.rejections.delete(destination)
    this.clearRetryTimer(destination)
  }

  disconnect(): void {
    if (this.client?.connected) this.active.forEach((s) => s.unsubscribe())
    this.active.clear()
    this.desired.clear()
    this.attempted = []
    this.rejections.clear()
    this.retryTimers.forEach((timer) => clearTimeout(timer))
    this.retryTimers.clear()
    this.connectFailures = 0
    this.stopped = false
    void this.client?.deactivate()
    this.client = null
    this.events.onStatus?.('idle')
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.getToken() ?? ''}` }
  }

  private applySubscribe(destination: string, handler: EnvelopeHandler): void {
    if (!this.client) return
    this.attempted.push(destination)
    const sub = this.client.subscribe(destination, (message: IMessage) => {
      try {
        handler(JSON.parse(message.body) as StompEnvelope)
      } catch {
        /* 파싱 실패한 프레임은 무시 */
      }
    })
    this.active.set(destination, sub)
  }

  private handleStompError(frame: IFrame): void {
    const message = frame.headers['message'] ?? 'STOMP 오류가 발생했어요.'
    this.events.onStatus?.('error')
    const destination = this.blame(message)
    if (destination !== null) this.rejectSubscription(destination, message)
    else this.rejectConnection(message)
  }

  /**
   * ERROR 프레임에는 원인 destination 이 들어 있지 않다(스프링은 예외 메시지만 싣는다).
   *  1) 화이트리스트 거절 메시지에는 destination 이 그대로 박혀 있으니 그걸 쓰고,
   *  2) 아니면 이번 접속에서 마지막으로 시도한 "개인 채널이 아닌" 구독을 원인으로 본다.
   * 둘 다 아니면 접속/인증 단계 문제로 본다(구독을 지운다고 낫지 않는다).
   */
  private blame(message: string): string | null {
    const named = /(\/sub\/\S+)/.exec(message)?.[1]
    if (named !== undefined && this.desired.has(named)) return named
    for (let i = this.attempted.length - 1; i >= 0; i -= 1) {
      const destination = this.attempted[i]
      if (destination !== PERSONAL_DESTINATION && this.desired.has(destination)) return destination
    }
    return null
  }

  /** 구독 한 건이 거절됐다 — 그 destination 만 떼어내고 몇 번만 다시 시도한다. */
  private rejectSubscription(destination: string, message: string): void {
    const handler = this.desired.get(destination)
    // 빼지 않으면 다음 접속이 같은 자리에서 또 끊긴다 (접속-구독-ERROR-종료 무한 루프)
    this.desired.delete(destination)
    this.active.delete(destination)

    const tries = (this.rejections.get(destination) ?? 0) + 1
    this.rejections.set(destination, tries)
    const delay = SUBSCRIBE_RETRY_DELAYS[tries - 1]

    if (handler !== undefined && delay !== undefined) {
      // 수업 시작 알림이 커밋보다 먼저 오는 경우가 있어, 짧게 기다렸다 정해진 횟수만 다시 건다
      this.clearRetryTimer(destination)
      this.retryTimers.set(
        destination,
        setTimeout(() => {
          this.retryTimers.delete(destination)
          this.subscribe(destination, handler)
        }, delay),
      )
      this.events.onServerError?.({ message, destination, fatal: false })
      return
    }
    // 일시적인 문제가 아니다 — 조용히 계속 시도하지 않고 딱 한 번만 알린다
    this.events.onServerError?.({ message, destination, fatal: true })
    this.events.onError?.(`수업 채널에 연결하지 못했어요. (${message})`)
  }

  /** 접속/인증 단계 거절 — 간격을 늘려 버티다가 상한을 넘으면 멈춘다. */
  private rejectConnection(message: string): void {
    this.connectFailures += 1
    const fatal = this.connectFailures >= MAX_CONNECT_FAILURES
    this.events.onServerError?.({ message, fatal })
    if (!fatal) {
      /*
        토큰 만료라면 REST 쪽 401 → 재발급이 끝나야 붙는다. beforeConnect 가 매번 최신 토큰을
        다시 읽으므로, 여기서는 간격만 늘려 그 시간을 벌어 준다.
      */
      if (this.client) {
        this.client.reconnectDelay = Math.min(
          RECONNECT_BASE * 2 ** this.connectFailures,
          RECONNECT_MAX,
        )
      }
      return
    }
    this.stop()
    this.events.onError?.(`실시간 연결이 계속 거절돼요. 새로고침해 주세요. (${message})`)
  }

  /** 무한 재연결을 끊는다. 다시 붙으려면 disconnect() 후 connect() 를 새로 불러야 한다. */
  private stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.retryTimers.forEach((timer) => clearTimeout(timer))
    this.retryTimers.clear()
    this.active.clear()
    const client = this.client
    this.client = null
    void client?.deactivate()
    this.events.onStatus?.('error')
  }

  private clearRetryTimer(destination: string): void {
    const timer = this.retryTimers.get(destination)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.retryTimers.delete(destination)
    }
  }
}
