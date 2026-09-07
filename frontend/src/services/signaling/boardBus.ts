import type { BoardStrokeData } from '@/services/media/ScreenAnnotator'

type StrokeListener = (stroke: BoardStrokeData) => void
type StrokeDeletedListener = (strokeId: string) => void
type ClearListener = () => void

/**
 * 판서 이벤트 버스 — 소켓(수신)과 캔버스(렌더)를 잇는 얇은 통로. (no React)
 *
 * 획은 초당 여러 개가 들어올 수 있어서 Zustand 스토어에 담으면 화면 전체가 리렌더된다.
 * 캔버스는 스스로 그리면 되므로 상태로 만들지 않고 이벤트로 흘려보낸다.
 */
class BoardBus {
  private strokeListeners = new Set<StrokeListener>()
  private strokeDeletedListeners = new Set<StrokeDeletedListener>()
  private clearListeners = new Set<ClearListener>()

  onStroke(listener: StrokeListener): () => void {
    this.strokeListeners.add(listener)
    return () => this.strokeListeners.delete(listener)
  }

  onStrokeDeleted(listener: StrokeDeletedListener): () => void {
    this.strokeDeletedListeners.add(listener)
    return () => this.strokeDeletedListeners.delete(listener)
  }

  emitStrokeDeleted(strokeId: string): void {
    this.strokeDeletedListeners.forEach((l) => l(strokeId))
  }

  onClear(listener: ClearListener): () => void {
    this.clearListeners.add(listener)
    return () => this.clearListeners.delete(listener)
  }

  emitStroke(stroke: BoardStrokeData): void {
    this.strokeListeners.forEach((l) => l(stroke))
  }

  emitClear(): void {
    this.clearListeners.forEach((l) => l())
  }
}

export const boardBus = new BoardBus()
