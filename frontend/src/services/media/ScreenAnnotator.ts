/**
 * ScreenAnnotator — 화면 위 필기(펜/지우개) 엔진. (SRP, React 의존성 없음 · Model 계층)
 *
 * **획은 STOMP 로 오간다.** 백엔드가 이 방식을 구현해 뒀기 때문이다:
 *  - 발행 `/pub/sessions/{id}/board/strokes` (**strokeId 필수**) · `/board/clear`(교사 전용)
 *  - 수신 `/sub/sessions/{id}` 의 `BOARD_STROKE` / `BOARD_CLEAR`
 *  - 획은 Redis 에 쌓여 `GET /sessions/{id}/state` 의 boardStrokes 로 재접속 복원된다
 *
 * 서버는 영상과 획을 합성하지 않는다. 각 클라이언트가 [영상] 위에 [획 캔버스]를 겹쳐 그린다.
 * (영상에 획을 구워 보내는 방식은 백엔드 계약과 맞지 않아 폐기했다)
 *
 * 좌표는 0~1 정규화라 캔버스 크기/해상도가 달라도 학생 화면에서 같은 위치에 찍힌다.
 *
 * ## 실시간 전송 방식 (손을 떼기 전에 상대 화면에 그려진다)
 * 그리는 중에도 `STREAM_INTERVAL_MS` 간격으로 발행한다. 단 **조각마다 새 `strokeId` 를 쓴다** —
 * 백엔드가 `session:{id}:board:stroke-ids` SET 으로 **strokeId 재사용을 거부**하기 때문이다
 * (같은 id 로 점이 늘어난 스냅샷을 다시 보내면 "이미 사용된 strokeId입니다" 로 전부 막힌다).
 *
 * 그래서 한 번의 드래그는 **같은 `groupId` 를 가진 짧은 조각 여러 개**로 저장된다. 조각은 이전
 * 조각의 마지막 점에서 시작해 선이 끊겨 보이지 않는다. 되돌리기·지우기는 `groupId` 로 조각을
 * 모아 한꺼번에 처리한다.
 *
 * ## 지우개 권한 (백엔드 규칙)
 * - `tool:'eraser'` 획 발행은 **교사 전용**이다 (좌표 지우개는 남의 픽셀까지 지우므로).
 * - 학생은 `/board/strokes/delete` 로 **`authorId` 가 자기인 획만** 지운다.
 *   그래서 학생 지우개는 "닿은 획 중 내 것만 삭제 발행"으로 구현한다.
 * - 전체 지우기(`BOARD_CLEAR`)도 교사 전용이다.
 */
import { Emitter } from '@/services/core/Emitter'

export type AnnotationTool = 'pen' | 'eraser'

interface Point {
  x: number // 0~1 정규화
  y: number
}

/** 네트워크로 오가는 획 한 개 (백엔드는 strokeId 만 강제하고 나머지는 자유 형식) */
export interface BoardStrokeData {
  /** **매 조각마다 고유해야 한다** — 서버가 재사용을 거부한다 (아래 주석 참고) */
  strokeId: string
  tool: AnnotationTool
  color: string
  width: number
  points: Point[]
  /**
   * 한 번의 드래그(논리적인 한 획)를 묶는 id. 실시간 전송 때문에 한 획이 여러 조각으로
   * 쪼개지므로, 되돌리기/지우기는 이 값으로 조각을 모아 처리한다.
   */
  groupId?: string
  /** 서버가 인증 사용자로 덮어써 저장하는 작성자. 학생 지우개 권한 판단의 기준이다 */
  authorId?: number
}

type Stroke = BoardStrokeData

export interface AnnotatorHandlers {
  /**
   * 획 조각을 서버로 발행한다. **그리는 중에도 여러 번 불린다** — 조각마다 `strokeId` 가 다르고
   * 같은 드래그는 `groupId` 로 묶인다.
   */
  onStroke?: (stroke: BoardStrokeData) => void
  /** 획 하나 삭제 발행 (`/board/strokes/delete`) — 학생 지우개·되돌리기가 쓴다 */
  onDeleteStroke?: (strokeId: string) => void
  /** 전체 지우기 (교사 전용) */
  onClear?: () => void
}

function newStrokeId(): string {
  return crypto.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 외부(UI)로 노출하는 원시 상태 */
export interface AnnotationState {
  tool: AnnotationTool
  color: string
  width: number
  /** 되돌릴 내 획이 있는가 — 되돌리기는 언제나 **내가 그린 것**만 대상이다 */
  canUndo: boolean
  /**
   * 지울 것이 남아 있는가. `canUndo` 와 **기준이 다르다.**
   *
   * 교사는 칠판을 통째로 비우므로 **누가 그렸든 획이 하나라도 있으면** 누를 수 있어야 한다.
   * 예전엔 이 버튼도 `canUndo`(= 내 획이 있나)로 막혀 있어서 두 가지가 조용히 망가졌다:
   *  1) 아무것도 안 그린 교사가 **학생 낙서를 지울 수 없었다** (버튼이 처음부터 잠김).
   *  2) 한 번 비운 뒤에는 내 획이 없어져 다시 잠겼다 — 학생이 계속 그려도 못 지웠다.
   * 그래서 "전체 지우기에 쿨타임이 걸린 것 같다"고 보였다(타이머는 없었다).
   *
   * 학생은 자기 획만 지울 수 있으므로 기준이 `canUndo` 와 같다.
   */
  canClear: boolean
}

export class ScreenAnnotator extends Emitter<AnnotationState> {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private dpr = 1

  private strokes: Stroke[] = []
  private current: Stroke | null = null

  private tool: AnnotationTool = 'pen'
  private color = '#ff3b30'
  private width = 4

  private resizeObserver: ResizeObserver | null = null
  private handlers: AnnotatorHandlers = {}
  /** 판서 권한이 없으면 보기만 한다 — 포인터 입력을 받지 않는다 */
  private readOnly = false
  /** strokeId -> strokes 안의 같은 객체. 실시간 조각을 id 로 찾아 갱신하기 위한 색인 */
  private byId = new Map<string, Stroke>()
  /** 내가 그린 획 id — 서버가 되돌려주는 내 조각은 무시한다(로컬로 이미 그리고 있다) */
  private mine = new Set<string>()

  /**
   * 그리는 중 발행 간격(ms). 짧으면 상대 화면이 더 매끄럽지만 트래픽이 늘어난다.
   * 80ms = 초당 12~13회. 아래 MIN_POINT_GAP 과 함께 한 획의 총 전송량을 눌러 준다.
   */
  private static readonly STREAM_INTERVAL_MS = 80
  /**
   * 이 거리(정규화 좌표)보다 가까운 점은 버린다. 마우스는 1초에 수백 점을 만드는데 그걸 다 담으면
   * 전송량과 렌더가 무거워진다. 0.0025 = 논리 보드 폭의 0.25% — 눈으로는 차이가 없다.
   */
  private static readonly MIN_POINT_GAP = 0.0025
  /**
   * 지우개 히트 반경(정규화 좌표) — 논리 보드 폭의 4%.
   * 아이들이 손가락/마우스로 대충 문질러도 지워져야 한다. 좁으면 "안 지워진다"가 된다.
   */
  private static readonly ERASER_RADIUS = 0.04

  private lastStreamAt = 0
  /** 지금 그리는 획에서 이미 보낸 점 개수 (여기부터 잘라 조각으로 보낸다) */
  private streamedPoints = 0
  /** 지금 그리는 드래그의 groupId — 조각들을 한 획으로 묶는다 */
  private currentGroupId: string | null = null

  /** 내 userId — 학생이 "내 획만" 지울 수 있는지 판단하는 기준 (서버 규칙과 동일) */
  private myUserId: number | null = null
  /** 교사인가 — 교사만 좌표 지우개(`tool:'eraser'`)와 전체 지우기를 발행할 수 있다 */
  private teacher = false
  /** 학생 지우개로 문지르는 중 (획을 그리지 않고 내 획 삭제만 발행한다) */
  private erasingByTouch = false

  // 새 구독자에게 현재 도구 상태를 즉시 흘린다(UI 초기 동기화).
  protected readonly emitOnSubscribe = true

  getState(): AnnotationState {
    return {
      tool: this.tool,
      color: this.color,
      width: this.width,
      canUndo: this.myGroupIds().length > 0,
      // 교사는 남의 획도 지운다 — 칠판에 뭐라도 있으면 누를 수 있다 (canClear 주석 참고)
      canClear: this.teacher ? this.strokes.length > 0 : this.myGroupIds().length > 0,
    }
  }

  setHandlers(handlers: AnnotatorHandlers): void {
    this.handlers = handlers
  }

  /** 누가 그리고 있는지 — 지우개 권한 판단에 쓴다 */
  setIdentity(userId: number | null, teacher: boolean): void {
    this.myUserId = userId
    this.teacher = teacher
    this.emit()
  }

  /** 내가 그린 획들의 groupId (되돌리기 대상). 그린 순서를 유지한다 */
  private myGroupIds(): string[] {
    const ids: string[] = []
    for (const s of this.strokes) {
      const gid = s.groupId ?? s.strokeId
      if (this.isMine(s) && !ids.includes(gid)) ids.push(gid)
    }
    return ids
  }

  private isMine(stroke: Stroke): boolean {
    // authorId 가 아직 없는 로컬 조각은 내가 방금 그린 것이다
    if (stroke.authorId === undefined) return this.mine.has(stroke.strokeId)
    return this.myUserId !== null && stroke.authorId === this.myUserId
  }

  /** 보기 전용 여부 (학생 화면). 이미 붙어 있으면 리스너를 다시 건다. */
  setReadOnly(readOnly: boolean): void {
    if (this.readOnly === readOnly) return
    this.readOnly = readOnly
    const canvas = this.canvas
    if (canvas) {
      this.detach()
      this.attach(canvas)
    }
  }

  // ── 캔버스 부착/해제 ─────────────────────────────────────────
  attach(canvas: HTMLCanvasElement): void {
    if (this.canvas === canvas) return // 이미 같은 캔버스에 붙어 있으면 no-op (중복 리스너 방지)
    if (this.canvas) this.detach() // 다른 캔버스로 교체 시 이전 것 정리
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.syncSize()

    if (!this.readOnly) {
      canvas.addEventListener('pointerdown', this.onPointerDown)
      canvas.addEventListener('pointermove', this.onPointerMove)
      window.addEventListener('pointerup', this.onPointerUp)
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.syncSize()
      this.render()
    })
    this.resizeObserver.observe(canvas)
    this.render()
  }

  detach(): void {
    const canvas = this.canvas
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown)
      canvas.removeEventListener('pointermove', this.onPointerMove)
    }
    window.removeEventListener('pointerup', this.onPointerUp)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.canvas = null
    this.ctx = null
  }

  // ── 도구 설정 ────────────────────────────────────────────────
  setTool(tool: AnnotationTool): void {
    this.tool = tool
    this.emit()
  }
  setColor(color: string): void {
    this.color = color
    this.tool = 'pen' // 색을 고르면 펜으로 전환
    this.emit()
  }
  setWidth(width: number): void {
    this.width = width
    this.emit()
  }

  /**
   * 내가 그린 마지막 획 취소.
   *
   * 이제 서버에 "획 하나 삭제"가 있으므로(`/board/strokes/delete`) 전체 지우기 + 재전송 같은
   * 난폭한 방법을 쓰지 않는다. 한 획은 조각 여러 개라 **그 groupId 의 조각을 모두** 지운다.
   * 내 획만 대상이므로 학생도 그대로 쓸 수 있다.
   */
  undo(): void {
    const groups = this.myGroupIds()
    const lastGroup = groups[groups.length - 1]
    if (!lastGroup) return
    this.deleteGroup(lastGroup)
  }

  /** 한 논리 획(= 같은 groupId 조각 전체)을 지우고 서버에도 알린다 */
  private deleteGroup(groupId: string): void {
    const ids = this.strokes
      .filter((s) => (s.groupId ?? s.strokeId) === groupId)
      .map((s) => s.strokeId)
    if (ids.length === 0) return
    for (const id of ids) {
      this.removeLocal(id)
      this.handlers.onDeleteStroke?.(id)
    }
    this.render()
    this.emit()
  }

  private removeLocal(strokeId: string): void {
    const stroke = this.byId.get(strokeId)
    if (!stroke) return
    this.byId.delete(strokeId)
    this.mine.delete(strokeId)
    const at = this.strokes.indexOf(stroke)
    if (at >= 0) this.strokes.splice(at, 1)
  }

  /**
   * 전체 지우기 — 역할에 따라 **의미가 다르다.**
   *
   * - 교사: `BOARD_CLEAR` 로 칠판을 통째로 비운다 (서버가 교사만 허용 — BoardSessionGuard).
   * - 학생: **내가 그린 것만** 전부 지운다. `BOARD_CLEAR` 는 학생이 보내도 서버가 조용히
   *   삼키므로(예외를 잡아 주는 `@MessageExceptionHandler` 가 없어 ERROR 프레임도 안 온다)
   *   내 획을 `BOARD_STROKE_DELETE` 로 하나씩 지운다 — 그건 학생도 허용된다.
   *
   * 예전에는 `if (!this.teacher) return` 으로 학생 클릭을 통째로 버렸다. 로컬 삭제도, 발행도,
   * 안내도 없어서 **버튼을 눌러도 아무 일이 없었다.** 반대로 그 가드만 풀면 `BOARD_CLEAR` 가
   * 나가고 서버가 삼켜서, **내 화면만 비워지고 다른 사람 화면에는 그대로 남는** 더 나쁜
   * 상태가 된다. 그래서 학생은 삭제 경로로 우회한다.
   */
  clear(): void {
    if (this.teacher) {
      this.resetStrokes()
      this.render()
      this.emit()
      this.handlers.onClear?.()
      return
    }
    /*
      한 번의 드래그가 조각 여러 개로 쪼개져 있어(서버가 strokeId 재사용을 거부한다) 삭제도
      조각 수만큼 나간다. `deleteGroup` 이 그룹 단위로 묶어 처리하므로 그룹만 돌면 된다.
    */
    for (const groupId of this.myGroupIds()) this.deleteGroup(groupId)
  }

  /** 내가 지울 수 있는 획이 있는가 — 버튼 활성 여부에 쓴다 */
  hasMine(): boolean {
    return this.strokes.some((s) => this.isMine(s))
  }

  private resetStrokes(): void {
    this.strokes = []
    this.byId.clear()
    this.mine.clear()
  }

  // ── 원격 반영 (서버 → 나) ────────────────────────────────────
  /**
   * 서버가 보내준 획을 화면에 얹는다.
   *
   * 같은 획이 그리는 중에 **여러 번** 온다(점이 늘어난 스냅샷). 그래서 처음 보는 id 는 추가하고,
   * 이미 있는 id 는 점 목록을 갈아 끼운다(upsert). 예전엔 본 id 를 전부 무시해서 첫 조각만 남고
   * 뒤가 안 그려졌다 — 그게 "손을 떼야 반영된다"의 원인이었다.
   *
   * 순서가 뒤바뀌어 짧은 조각이 늦게 도착할 수 있으니 **점이 더 많을 때만** 반영한다(누적 전송이라
   * 점 개수가 곧 최신도다). 내가 보낸 획은 로컬로 이미 그리고 있으므로 되돌아와도 무시한다.
   */
  applyStroke(stroke: BoardStrokeData): void {
    if (!stroke?.strokeId || !Array.isArray(stroke.points)) return
    // 내가 보낸 조각이 되돌아온 것 — 로컬로 이미 그렸다. 단 서버가 채운 authorId 는 받아 둔다
    const own = this.byId.get(stroke.strokeId)
    if (own) {
      if (stroke.authorId !== undefined) own.authorId = stroke.authorId
      return
    }
    // 처음 도착한 순서 = 그린 순서. 지우개(destination-out)가 순서에 의존하므로 중요하다
    this.byId.set(stroke.strokeId, stroke)
    this.strokes.push(stroke)
    this.render()
    this.emit()
  }

  /** 서버가 알려준 "획 하나 삭제" 반영 (내가 지운 것도 여기로 되돌아온다 — 이미 지웠으면 no-op) */
  applyStrokeDeleted(strokeId: string): void {
    if (!this.byId.has(strokeId)) return
    this.removeLocal(strokeId)
    this.render()
    this.emit()
  }

  /** 서버의 전체 지우기 반영 (콜백을 되쏘지 않는다 — 무한 반사 방지) */
  applyClear(): void {
    this.resetStrokes()
    this.render()
    this.emit()
  }

  /**
   * 재접속 복원 — GET /sessions/{id}/state 의 boardStrokes 로 통째로 교체.
   *
   * 서버는 조각을 **기록된 순서대로** 준다. 조각마다 strokeId 가 고유하므로 합치거나 고를 것이
   * 없고 순서대로 그리면 된다 (지우개가 순서에 의존하므로 순서 보존이 중요하다).
   */
  /**
   * 지금 획을 그리는 중인가.
   *
   * 재접속 재동기화(`replaceAll`)가 드래그 도중에 끼어들면 진행 중인 획이 통째로 사라진다.
   * 호출하는 쪽이 그 순간을 피할 수 있게 열어 둔다.
   */
  get drawing(): boolean {
    return this.current !== null
  }

  replaceAll(strokes: BoardStrokeData[]): void {
    const byId = new Map<string, Stroke>()
    for (const s of strokes) {
      if (!s?.strokeId || !Array.isArray(s.points)) continue
      byId.set(s.strokeId, s)
    }
    this.byId = byId
    this.strokes = [...byId.values()]
    this.mine.clear()
    this.render()
    this.emit()
  }

  // ── 포인터 입력 ──────────────────────────────────────────────
  private onPointerDown = (ev: PointerEvent): void => {
    if (!this.canvas) return
    // 포인터 캡처 실패가 스트로크 시작을 막지 않도록 방어
    try {
      this.canvas.setPointerCapture?.(ev.pointerId)
    } catch {
      /* ignore */
    }
    const point = this.toNormalized(ev)

    /*
      학생 지우개는 획을 발행하지 않는다 — 서버가 학생의 `tool:'eraser'` 발행을 거절한다.
      대신 닿은 획 중 **내 것만** 삭제를 발행한다 (서버 권한 규칙과 같은 판단).
    */
    if (this.tool === 'eraser' && !this.teacher) {
      this.erasingByTouch = true
      this.eraseAt(point)
      return
    }

    this.currentGroupId = newStrokeId()
    this.current = {
      strokeId: newStrokeId(),
      groupId: this.currentGroupId,
      tool: this.tool,
      color: this.color,
      width: this.width,
      points: [point],
    }
    this.streamedPoints = 0
    this.render()
    // 첫 점을 바로 보낸다: 점 찍기(탭)나 짧은 획도 상대 화면에 즉시 뜬다
    this.streamCurrent()
  }

  /** 학생 지우개: 이 좌표에 닿은 내 획을 찾아 지운다 */
  private eraseAt(point: Point): void {
    const hit = [...this.strokes].reverse().find((s) => this.isMine(s) && this.touches(s, point))
    if (hit) this.deleteGroup(hit.groupId ?? hit.strokeId)
  }

  /**
   * 획이 이 점 근처를 지나가는가 (지우개 히트 반경).
   *
   * 예전 반경은 `max(0.012, width/400)` — 정규화 1.2% 라 900px 카드에서 가로 약 11px 이었다.
   * 게다가 획은 **샘플링된 점들**로만 저장돼(MIN_POINT_GAP) 점과 점 사이를 문지르면 안 맞는다.
   * 초등학생 손가락·마우스 정밀도로는 사실상 "지워지지 않는" 크기였다.
   *
   * 그래서 두 가지를 고쳤다:
   *  1) 반경을 ERASER_RADIUS(4%)로 넓혔다 — 손끝만큼.
   *  2) 점이 아니라 **선분과의 거리**로 판정한다. 샘플 간격이 넓어도 획 위를 지나면 잡힌다.
   */
  private touches(stroke: Stroke, point: Point): boolean {
    const r = Math.max(ScreenAnnotator.ERASER_RADIUS, this.width / 400)
    const pts = stroke.points
    if (pts.length === 1) return Math.hypot(pts[0].x - point.x, pts[0].y - point.y) <= r
    for (let i = 0; i < pts.length - 1; i++) {
      if (ScreenAnnotator.distanceToSegment(point, pts[i], pts[i + 1]) <= r) return true
    }
    return false
  }

  /** 점에서 선분까지의 최단 거리 (정규화 좌표계) */
  private static distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
    // 선분 위로 사영한 위치를 0~1 로 자른다 (선분 밖이면 가까운 끝점까지의 거리)
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }

  private onPointerMove = (ev: PointerEvent): void => {
    if (this.erasingByTouch) {
      this.eraseAt(this.toNormalized(ev))
      return
    }
    const stroke = this.current
    if (!stroke) return
    const point = this.toNormalized(ev)
    // 거의 같은 자리는 버린다 (전송량·렌더 비용 절감, 눈에 보이는 차이는 없다)
    const last = stroke.points[stroke.points.length - 1]
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < ScreenAnnotator.MIN_POINT_GAP) {
      return
    }
    stroke.points.push(point)
    this.render()

    // 그리는 중에도 일정 간격으로 내보낸다 — 상대 화면이 손을 떼기 전에 따라 그려진다
    const now = performance.now()
    if (now - this.lastStreamAt >= ScreenAnnotator.STREAM_INTERVAL_MS) this.streamCurrent()
  }

  private onPointerUp = (): void => {
    if (this.erasingByTouch) {
      this.erasingByTouch = false
      return
    }
    if (!this.current) return
    // 남은 꼬리 점을 마지막 조각으로 내보낸다 (점 하나짜리 탭도 여기서 발행된다)
    this.streamCurrent()
    this.current = null
    this.currentGroupId = null
    this.streamedPoints = 0
    this.emit()
  }

  /**
   * 그리는 중 조각을 발행한다 — 지난 조각 이후에 새로 찍힌 점들만, **새 strokeId** 로.
   *
   * 서버가 strokeId 재사용을 거부하므로 같은 id 를 갱신하는 방식은 쓸 수 없다.
   * 대신 이어붙인 조각들이 한 획처럼 보이도록 **직전 조각의 마지막 점에서 시작**하고,
   * 같은 드래그는 `groupId` 로 묶어 되돌리기·지우기가 한 획 단위로 동작하게 한다.
   */
  private streamCurrent(): void {
    const stroke = this.current
    if (!stroke) return
    // 이어짐을 위해 직전 조각의 마지막 점을 한 번 더 포함한다
    const from = Math.max(0, this.streamedPoints - 1)
    const points = stroke.points.slice(from)
    if (points.length === 0) return

    const chunk: Stroke = {
      strokeId: newStrokeId(),
      groupId: this.currentGroupId ?? stroke.strokeId,
      tool: stroke.tool,
      color: stroke.color,
      width: stroke.width,
      points: [...points],
    }
    this.streamedPoints = stroke.points.length
    this.lastStreamAt = performance.now()

    // 로컬에도 확정 조각으로 쌓아 둔다 (되돌리기·지우기 대상이 되도록)
    this.mine.add(chunk.strokeId)
    this.byId.set(chunk.strokeId, chunk)
    this.strokes.push(chunk)
    this.handlers.onStroke?.({ ...chunk, points: [...chunk.points] })
  }

  /**
   * 공유 칠판의 논리 비율. 선생님 슬라이드(가로로 넓음)와 학생 방송 카드(16:10)는 모양이 달라서,
   * 각자 캔버스 기준으로 정규화하면 같은 그림이 상대 화면에서 찌그러진다.
   * 그래서 **양쪽 캔버스 안에 같은 비율의 보드를 letterbox 로 잡고** 그 안에서만 좌표를 주고받는다.
   *
   * 기준 비율은 **배경 영상의 실제 비율**이다. 예전엔 16:10 으로 고정했는데, 영상은 화면 공유일 때
   * `object-contain` 으로 자기 비율(16:9 · 3:2 · 세로 등)대로 letterbox 되므로 보드와 영상의 박스가
   * 어긋났다 → 선생님이 단어에 동그라미를 쳐도 학생 화면에서는 위치가 밀렸다.
   * 같은 트랙을 양쪽이 함께 보므로 videoWidth/videoHeight 는 두 화면에서 동일하다.
   * 영상이 아직 없거나 메타데이터 전이면 예전 고정값으로 폴백한다.
   *
   * (카메라는 `object-cover` 라 컨테이너 모양대로 잘린다 — 이때는 어느 기준을 써도 정확히 맞출 수
   *  없다. 판서는 화면 공유 위에서 쓰는 기능이라 공유 기준으로 맞춘다.)
   */
  private static readonly FALLBACK_RATIO = 16 / 10

  /** 좌표 기준이 되는 배경 영상 */
  private background: HTMLVideoElement | null = null
  /** 영상 크기를 알게 되면 이미 그려진 획을 새 박스로 다시 그린다 */
  private readonly onBackgroundResize = (): void => {
    this.render()
  }

  /**
   * 판서의 좌표 기준이 될 배경 영상을 주입한다.
   *
   * **넣지 않으면 배경 없이 폴백 비율(16:10)로 그린다** — 자동 탐색은 없다(아래 주석 참고).
   * `null` 을 넣으면 배경을 떼고 폴백으로 돌아간다.
   */
  setBackgroundVideo(video: HTMLVideoElement | null): void {
    this.bindBackground(video)
  }

  private bindBackground(video: HTMLVideoElement | null): void {
    if (this.background === video) return
    if (this.background) {
      this.background.removeEventListener('loadedmetadata', this.onBackgroundResize)
      this.background.removeEventListener('resize', this.onBackgroundResize)
    }
    this.background = video
    if (video) {
      video.addEventListener('loadedmetadata', this.onBackgroundResize)
      video.addEventListener('resize', this.onBackgroundResize)
    }
    this.render()
  }

  /*
    예전에는 `discoverBackground()` 가 캔버스 부모의 직계 `<video>` 를 스스로 찾아 배경으로
    삼았다. 지금은 호출부가 `setBackgroundVideo()` 로 **명시적으로 넣어준다** — 어느 영상이
    좌표 기준인지 화면이 정하는 게 맞고(선생님 방송 / 학생 카드 셀프뷰가 섞여 있다),
    자동 탐색은 DOM 구조가 바뀌면 조용히 엉뚱한 영상을 잡았다.
    그래서 그 메서드는 호출부가 사라진 채 남아 `tsc -b` 를 막고 있었고, 여기서 지웠다.
  */

  /** 배경 영상의 실제 비율 (모르면 폴백) */
  private boardRatio(): number {
    const video = this.background
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      return video.videoWidth / video.videoHeight
    }
    return ScreenAnnotator.FALLBACK_RATIO
  }

  /** 주어진 크기 안에 들어가는 가장 큰 보드 박스(가운데 정렬) — 영상의 letterbox 와 같은 계산 */
  private boardBox(width: number, height: number) {
    const ratio = this.boardRatio()
    let w = width
    let h = width / ratio
    if (h > height) {
      h = height
      w = height * ratio
    }
    return { x: (width - w) / 2, y: (height - h) / 2, w, h }
  }

  private toNormalized(ev: PointerEvent): Point {
    const rect = this.canvas!.getBoundingClientRect()
    const box = this.boardBox(rect.width, rect.height)
    return {
      x: (ev.clientX - rect.left - box.x) / box.w,
      y: (ev.clientY - rect.top - box.y) / box.h,
    }
  }

  // ── 렌더링 ───────────────────────────────────────────────────
  private syncSize(): void {
    const canvas = this.canvas
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    this.dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(rect.width * this.dpr))
    canvas.height = Math.max(1, Math.round(rect.height * this.dpr))
  }

  private render(): void {
    const ctx = this.ctx
    const canvas = this.canvas
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const stroke of this.strokes) this.drawStroke(ctx, canvas, stroke)
    if (this.current) this.drawStroke(ctx, canvas, this.current)
  }

  private drawStroke(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    stroke: Stroke,
  ): void {
    const { points } = stroke
    if (points.length === 0) return
    // 지우개는 캔버스를 투명하게 파낸다(합성 시 영상이 비쳐 보임)
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = stroke.color
    ctx.fillStyle = stroke.color
    ctx.lineWidth = stroke.width * this.dpr
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // 좌표는 논리 보드(16:10) 기준이므로, 캔버스 안의 같은 박스로 되돌려 그린다
    const box = this.boardBox(canvas.width, canvas.height)
    const toX = (p: Point) => box.x + p.x * box.w
    const toY = (p: Point) => box.y + p.y * box.h

    if (points.length === 1) {
      // 점 하나 = 원 하나
      ctx.beginPath()
      ctx.arc(toX(points[0]), toY(points[0]), (stroke.width * this.dpr) / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      return
    }
    ctx.beginPath()
    ctx.moveTo(toX(points[0]), toY(points[0]))
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(toX(points[i]), toY(points[i]))
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
  }

}
