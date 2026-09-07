/**
 * StreamRegistry — 활성 MediaStream 객체를 메모리에 보관/참조하는 유일한 책임.
 *
 * Rule 2: MediaStream/RTCPeerConnection 같은 네이티브 객체는 절대 Zustand/Redux에
 * 넣지 않는다. 여기(Map)나 useRef에만 보관한다. React 의존성 없음.
 */
class StreamRegistryImpl {
  /** 로컬 학생 스트림의 예약 키 */
  readonly LOCAL_ID = 'local'

  private streams = new Map<string, MediaStream>()

  set(id: string, stream: MediaStream): void {
    this.streams.set(id, stream)
  }

  get(id: string): MediaStream | undefined {
    return this.streams.get(id)
  }

  has(id: string): boolean {
    return this.streams.has(id)
  }

  /** 스트림을 제거하고 트랙을 정지한다. */
  remove(id: string): void {
    const stream = this.streams.get(id)
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
      this.streams.delete(id)
    }
  }

  clear(): void {
    this.streams.forEach((stream) => stream.getTracks().forEach((t) => t.stop()))
    this.streams.clear()
  }
}

/** 앱 전역 단일 인스턴스 */
export const StreamRegistry = new StreamRegistryImpl()

