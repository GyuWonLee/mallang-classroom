import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { Emitter } from '@/services/core/Emitter'
import { PDF_DATA_URLS, loadPdfjs } from '@/services/media/pdfjs'

/**
 * 송출 해상도 — **고정이다.**
 *
 * 페이지마다 캔버스 크기를 바꾸면 트랙 해상도가 따라 바뀌어 LiveKit 이 매번 재협상하고,
 * 판서 좌표의 기준(영상 종횡비)도 페이지마다 달라져 **획이 엉뚱한 곳에 찍힌다.**
 * 그래서 판을 16:9 로 고정해 두고 페이지를 그 안에 letterbox 로 앉힌다.
 */
const STAGE_W = 1920
const STAGE_H = 1080

/**
 * 캡처 프레임률.
 *
 * 내용이 거의 정지 화면이라 높을 이유가 없다. 낮게 잡아도 화면이 바뀐 순간은 다음 프레임에
 * 실려 나가고, 안 바뀌는 동안에는 인코더가 사실상 아무것도 보내지 않는다(시간축 압축).
 */
const CAPTURE_FPS = 4

/**
 * 여백(letterbox) 색 — **무대 배경(`--color-ink`)과 같은 값이어야 한다.**
 *
 * 페이지를 16:9 판에 앉히면 판 안쪽에 여백이 생기고, 그 판을 다시 무대에 `object-contain`
 * 으로 넣으면 판 바깥에도 여백이 생긴다. 두 여백의 색이 다르면 화면에 **테두리가 두 겹**으로
 * 보여 어디까지가 자료인지 흐려진다. 같은 색이면 하나의 배경으로 읽힌다.
 */
const MAT_COLOR = '#2E3137'

export interface PdfPresenterState {
  /** 발표 중인가 (트랙이 살아 있는가) */
  active: boolean
  loading: boolean
  fileName: string | null
  /** 1-based */
  page: number
  pageCount: number
  error: string | null
}

const BLANK: PdfPresenterState = {
  active: false,
  loading: false,
  fileName: null,
  page: 1,
  pageCount: 0,
  error: null,
}

/**
 * PDF 발표 — 페이지를 캔버스에 그리고 **그 캔버스만** 영상 트랙으로 내보낸다.
 *
 * ## 왜 화면 공유가 아닌가
 *
 * 선생님이 PDF 를 자기 뷰어로 열어 공유하면 페이지를 넘길 때마다 그 창으로 갔다가 판서하러
 * 우리 창으로 돌아와야 한다. 그렇다고 우리 화면에 PDF 를 띄우고 **그 탭을 공유하면** 두 가지가
 * 깨진다: 공유 미리보기가 자기 자신을 비추는 **무한 거울**이 되고, 판서 캔버스도 공유 영역에
 * 들어가 학생에게 **획이 두 번** 보인다(영상에 구워진 것 + 자기 캔버스에 그린 것).
 *
 * `captureStream()` 은 그 둘을 한 번에 없앤다. 화면을 캡처하지 않으니 거울이 없고, 캡처
 * 대상이 이 캔버스 하나뿐이라 판서는 절대 실려 가지 않는다. 공유할 창을 고르는 대화상자도
 * 뜨지 않는다 — 선생님은 파일만 고르면 된다.
 *
 * **판서를 영상에 굽지 않는다**는 원칙(`ScreenAnnotator` 주석)은 그대로다. 여기서 내보내는
 * 것은 PDF 픽셀뿐이고, 획은 지금처럼 STOMP 로 따로 간다.
 *
 * ## 학생 쪽은 손대지 않는다
 *
 * 이 트랙을 `Track.Source.ScreenShare` 로 게시하면 학생 화면은 이미 화면공유를 카메라보다
 * 우선해 그리고(`useStudentStage`), 판서 캔버스도 그 영상 위에 얹혀 있다. 즉 **학생 코드는
 * 한 줄도 바뀌지 않는다.**
 *
 * React 의존성 없음(CLAUDE.md Rule 1) — 상태는 `Emitter` 로만 알린다.
 */
export class PdfPresenter extends Emitter<PdfPresenterState> {
  protected readonly emitOnSubscribe = true

  /**
   * 송출용 판. **DOM 에 붙이지 않는다** — 화면에 보일 필요가 없다(선생님도 송출 트랙을
   * 미리보기로 본다). 떠 있지 않은 캔버스도 `captureStream` 은 정상 동작한다.
   */
  private canvas: HTMLCanvasElement | null = null
  private stream: MediaStream | null = null
  private doc: PDFDocumentProxy | null = null
  /**
   * 문서를 버리는 길은 **로딩 태스크에만** 있다 — `PDFDocumentProxy` 에는 `destroy` 가 없고
   * 워커까지 정리하려면 이쪽을 붙들어야 한다. 안 버리면 파일을 바꿀 때마다 워커가 쌓인다.
   */
  private loadingTask: PDFDocumentLoadingTask | null = null
  private task: RenderTask | null = null
  /** 렌더 세대 — 빠르게 넘길 때 늦게 끝난 이전 렌더가 화면을 덮지 않게 한다 */
  private generation = 0
  /**
   * 마지막으로 렌더한 페이지 그림. **다시 그리려면 들고 있어야 한다** —
   * 송출 판은 매 프레임 지워지므로 원본이 없으면 여백만 남는다(`paint`).
   */
  private pageCanvas: HTMLCanvasElement | null = null
  /** 다시 그리기 타이머 — `startPainting` 주석 참고 */
  private painter: number | null = null

  private state: PdfPresenterState = { ...BLANK }

  getState(): PdfPresenterState {
    return this.state
  }

  /** 게시할 트랙. 발표 중이 아니면 null */
  getStream(): MediaStream | null {
    return this.stream
  }

  private patch(next: Partial<PdfPresenterState>): void {
    this.state = { ...this.state, ...next }
    this.emit()
  }

  /** 파일을 열어 발표를 시작한다. 이미 발표 중이면 문서만 갈아 끼운다(트랙은 유지). */
  async start(file: File): Promise<void> {
    this.patch({ loading: true, error: null, fileName: file.name })
    try {
      const pdfjs = await loadPdfjs()
      const data = await file.arrayBuffer()
      await this.destroyDoc()

      // `data` 는 pdf.js 가 소유권을 가져간다(transfer) — 재사용하지 않는다
      const loadingTask = pdfjs.getDocument({ data, ...PDF_DATA_URLS })
      this.loadingTask = loadingTask
      this.doc = await loadingTask.promise

      /*
        **1쪽을 다 그린 뒤에 캡처를 시작한다.** 순서를 뒤집으면 첫 프레임이 아직 아무것도 안
        그린 판(단색)으로 잡혀, 학생 화면이 페이지를 넘길 때까지 회색으로 남는다 — 실제로 그랬다.
        캡처는 캔버스가 바뀔 때 프레임을 뜨는데, 발행 직후의 그 한 장이 계속 물려 있었다.

        `active` 도 여기서 켜지 않는다. 켜는 순간 게시 effect 가 스트림을 찾으므로, 내용이
        준비되기 전에 켜면 같은 문제가 난다.
      */
      this.ensureCanvas()
      this.patch({ pageCount: this.doc.numPages, page: 1 })
      // `loading` 은 renderPage 가 끈다 (거기 finally 가 유일한 지점이다)
      await this.renderPage(1)

      this.ensureStream()
      this.patch({ active: true })
    } catch {
      /*
        트랙을 만들기 전에 실패했으면 발표를 시작하지 않는다 — 빈 판을 송출하면 학생 화면이
        회색으로 덮이고 선생님 카메라까지 가린다(학생은 화면공유를 우선한다).
      */
      await this.destroyDoc()
      this.patch({
        loading: false,
        error: 'PDF를 열지 못했어요. 다른 파일로 다시 시도해 주세요.',
        pageCount: 0,
        active: this.stream !== null,
      })
    }
  }

  async next(): Promise<void> {
    await this.goto(this.state.page + 1)
  }
  async prev(): Promise<void> {
    await this.goto(this.state.page - 1)
  }

  async goto(page: number): Promise<void> {
    if (!this.doc || page < 1 || page > this.state.pageCount) return
    this.patch({ page })
    await this.renderPage(page)
  }

  /** 발표 종료 — 트랙을 끊고 문서를 버린다 */
  stop(): void {
    // 타이머를 먼저 끈다 — 캔버스를 지운 뒤에도 돌면 매 250ms 마다 헛일을 한다
    this.stopPainting()
    void this.destroyDoc()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.canvas = null
    this.pageCanvas = null
    this.state = { ...BLANK }
    this.emit()
  }

  dispose(): void {
    this.stop()
    this.clearListeners()
  }

  // ── 내부 ──────────────────────────────────────────────────────

  /** 송출 판을 만든다(아직 캡처하지 않는다) — 내용을 먼저 그리려면 판이 있어야 한다 */
  private ensureCanvas(): void {
    if (this.canvas) return
    const canvas = document.createElement('canvas')
    canvas.width = STAGE_W
    canvas.height = STAGE_H
    // 아직 아무것도 안 그린 캔버스는 **투명**이라 받는 쪽에서 검게 보인다 — 먼저 칠해 둔다
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = MAT_COLOR
      ctx.fillRect(0, 0, STAGE_W, STAGE_H)
    }
    this.canvas = canvas
  }

  /** 캡처 시작 — **내용을 그린 뒤에** 부른다(`start` 주석 참고) */
  private ensureStream(): void {
    if (this.stream || !this.canvas) return
    this.stream = this.canvas.captureStream(CAPTURE_FPS)
    this.startPainting()
    // [pdf-share] 진단 로그 — 학생에게 안 보이는 문제를 쫓는 중. 원인이 잡히면 지운다.
    const [track] = this.stream.getVideoTracks()
    console.info('[pdf-share] 1. 캔버스 트랙 생성', {
      있음: !!track,
      readyState: track?.readyState,
      설정: track?.getSettings(),
    })
  }

  /**
   * **같은 그림을 계속 다시 그린다.** 이게 없으면 학생 화면에 아무것도 안 나온다.
   *
   * `captureStream(fps)` 는 초당 fps 장을 자동으로 만들어 주지 않는다 — **캔버스에 그림이
   * 그려질 때** 프레임을 뜨고, fps 는 그 상한일 뿐이다. PDF 는 정지 화면이라 페이지를 한 번
   * 그린 뒤로는 캔버스가 그대로여서 **프레임 공급이 멈춘다.**
   *
   * 그러면 이미 받고 있던 사람은 마지막 프레임에 멈춰 있고(정지 화면이라 티가 안 난다),
   * **그 뒤에 구독을 시작한 학생은 디코딩할 프레임 자체가 없어 빈 화면**을 본다. 선생님
   * 화면은 멀쩡해 보이므로 원인을 찾기 어렵다. 페이지를 넘기면 그때 한 장이 나가서 잠깐
   * 보이다가 다시 멈추는 것도 같은 이유다.
   *
   * 그려 둔 페이지를 다시 얹기만 하므로 비용은 정지 이미지 `drawImage` 하나다. 화면이 안
   * 바뀌면 인코더가 시간축 압축으로 거의 아무것도 보내지 않아 대역폭도 늘지 않는다.
   */
  private startPainting(): void {
    if (this.painter !== null) return
    this.painter = window.setInterval(() => this.paint(), Math.round(1000 / CAPTURE_FPS))
  }

  private stopPainting(): void {
    if (this.painter !== null) window.clearInterval(this.painter)
    this.painter = null
  }

  /** 판을 한 장 그린다 — 여백을 칠하고 그 위에 마지막으로 렌더한 페이지를 얹는다 */
  private paint(): void {
    const ctx = this.canvas?.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = MAT_COLOR
    ctx.fillRect(0, 0, STAGE_W, STAGE_H)
    const page = this.pageCanvas
    if (!page) return
    ctx.drawImage(
      page,
      Math.floor((STAGE_W - page.width) / 2),
      Math.floor((STAGE_H - page.height) / 2),
    )
  }

  private async renderPage(pageNo: number): Promise<void> {
    const canvas = this.canvas
    const ctx = canvas?.getContext('2d')
    if (!this.doc || !canvas || !ctx) return

    const mine = ++this.generation
    this.patch({ loading: true })

    // 앞선 렌더가 남아 있으면 취소한다 — 같은 캔버스에 둘이 그리면 깨진다
    this.task?.cancel()
    this.task = null

    try {
      const page = await this.doc.getPage(pageNo)
      if (mine !== this.generation) return

      /*
        페이지를 임시 캔버스에 제 크기로 그린 뒤 송출 판 가운데에 얹는다.

        송출 판에 바로 그리지 않는 이유: 판은 16:9 고정인데 A4 는 세로로 길어, 바로 그리면
        페이지가 눌리거나 잘린다. 비율을 지켜 넣고 남는 곳을 여백으로 두는 편이 읽힌다.
      */
      const base = page.getViewport({ scale: 1 })
      const fit = Math.min(STAGE_W / base.width, STAGE_H / base.height)
      const viewport = page.getViewport({ scale: fit })

      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = Math.max(1, Math.floor(viewport.width))
      pageCanvas.height = Math.max(1, Math.floor(viewport.height))

      this.task = page.render({ canvas: pageCanvas, viewport })
      await this.task.promise
      if (mine !== this.generation) return

      /*
        그린 페이지를 **보관하고** 곧바로 한 장 얹는다. 보관하는 이유는 `paint` 가 매 프레임
        판을 지우고 이 그림을 다시 올리기 때문이다 — 그래야 정지 화면에도 프레임이 계속
        흘러 늦게 들어온 학생도 볼 수 있다(`startPainting` 주석).

        타이머를 기다리지 않고 여기서 한 번 더 그리는 것은 쪽 넘김을 즉시 반영하기 위해서다.
      */
      this.pageCanvas = pageCanvas
      this.paint()
      this.patch({ error: null })
    } catch (err) {
      // 취소는 실패가 아니다 — 이 렌더를 밀어낸 다음 렌더가 이어서 돈다
      if (isCancel(err) || mine !== this.generation) return
      this.patch({ error: '페이지를 그리지 못했어요.' })
    } finally {
      /*
        `loading` 을 끄는 곳은 **여기 하나뿐이다.**

        예전에는 성공 경로에서만 껐다. 그런데 이 함수에는 중간에 빠져나가는 길이 셋(세대가
        밀렸을 때 둘, 렌더 취소 하나)이라, 마지막 렌더가 그중 하나로 끝나면 **`loading` 이
        true 로 남았다** — 쪽을 넘기면 실제로 재현됐다.

        조건을 `mine === generation` 으로 두는 이유: 밀려난 렌더가 끄면, 그 뒤에 시작된
        최신 렌더가 아직 그리는 중인데도 다 끝난 것처럼 보인다.
      */
      if (mine === this.generation) this.patch({ loading: false })
    }
  }

  private async destroyDoc(): Promise<void> {
    this.task?.cancel()
    this.task = null
    const loadingTask = this.loadingTask
    this.loadingTask = null
    this.doc = null
    try {
      await loadingTask?.destroy()
    } catch {
      /* 이미 정리됨 */
    }
  }
}

/** pdf.js 는 렌더 취소를 예외로 알린다 — 이름으로만 구분할 수 있다 */
function isCancel(err: unknown): boolean {
  return (err as { name?: string })?.name === 'RenderingCancelledException'
}
