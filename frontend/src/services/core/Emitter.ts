/**
 * Emitter<TState> — 서비스 계층 공용 옵저버 베이스. (SRP, React 의존성 없음)
 *
 * 미디어/시그널링 매니저들이 공통으로 쓰던 `listeners`/`subscribe`/`emit`
 * 보일러플레이트를 한 곳으로 모았다. 서브클래스는 `getState()`만 구현하면
 * 구독·해제·방출을 그대로 얻는다.
 *
 * - 상태 변화는 리스너로만 밖에 알린다(Rule 1: 스토어/React 직접 참조 금지).
 * - 새 구독자에게 현재 상태를 즉시 한 번 흘리고 싶으면 `emitOnSubscribe`를 true로 둔다.
 */
export type StateListener<TState> = (state: TState) => void

export abstract class Emitter<TState> {
  private listeners = new Set<StateListener<TState>>()

  /** 현재 스냅샷. 서브클래스가 자신의 원시 상태로 구현한다. */
  abstract getState(): TState

  /** 구독 즉시 현재 상태를 흘릴지 여부. 필요한 서브클래스만 true로 override. */
  protected readonly emitOnSubscribe: boolean = false

  /** 상태 변화 구독. 해제 함수를 반환한다. */
  subscribe(listener: StateListener<TState>): () => void {
    this.listeners.add(listener)
    if (this.emitOnSubscribe) listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 현재 상태를 모든 구독자에게 방출한다. */
  protected emit(): void {
    const state = this.getState()
    this.listeners.forEach((l) => l(state))
  }

  /** 모든 구독을 비운다(dispose 시). */
  protected clearListeners(): void {
    this.listeners.clear()
  }
}
