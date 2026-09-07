import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Icon } from '@/components/common/Icon'
import { api } from '@/services/api/client'
import { apiErrorMessage } from '@/lib/apiError'
import { PDF_DATA_URLS, loadPdfjs } from '@/services/media/pdfjs'
import { cn } from '@/lib/cn'

/**
 * 올린 PDF 를 그대로 보여준다.
 *
 * <p>확인 화면은 원래 **추출된 텍스트만** 보여줬다. 그런데 선생님이 올린 것은 PDF 이고, 뜯어낸
 * 글자 뭉치는 원본과 생김새가 전혀 달라서 "이게 내 자료가 맞나"를 판단하기 어려웠다.
 * 표·그림이 있는 자료일수록 심했다 — 화면에는 문장 조각만 남으니까.</p>
 *
 * ## 브라우저 내장 뷰어에 맡기지 않는다
 *
 * 처음에는 blob 을 `<iframe>` 에 물려 브라우저 PDF 뷰어에 맡겼다. 스크롤·확대가 공짜로
 * 딸려 오니까. 그런데 **두 환경에서 연달아 실패했다** — 파일 아이콘과 '열기' 단추만 있는
 * 대체 화면이 떴다. 내장 뷰어를 끄는 정책이나 blob URL 처리 차이 같은 것이라 우리가 손댈 수
 * 없고, 무엇보다 선생님 화면에서 실제로 그랬다.
 *
 * 그래서 pdf.js 로 직접 그린다. 이미 수업 중 PDF 발표(`PdfPresenter`)가 쓰고 있어 새로 들일
 * 의존성도 없고, 어느 브라우저에서든 같은 화면이 나온다. 대신 페이지 넘김은 우리가 만든다.
 *
 * ## 인증
 *
 * 파일 조회에는 `Authorization` 헤더가 필요하다. axios 로 받아야 토큰 재발급 인터셉터도
 * 그대로 타므로, 주소를 그대로 넘기지 않고 **바이트를 받아** pdf.js 에 건넨다.
 */
export function MaterialPdfView({
  fileId,
  title,
  className,
}: {
  /** 없으면 볼 파일이 없다는 뜻 — 옛 자료이거나 업로드가 덜 끝난 경우다 */
  fileId: string | null
  title: string
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  /** 렌더 세대 — 빠르게 넘길 때 늦게 끝난 이전 렌더가 화면을 덮지 않게 한다 */
  const genRef = useRef(0)
  /**
   * 지금 도는 렌더 — **다음 렌더 전에 반드시 취소한다.**
   *
   * pdf.js 는 같은 캔버스에 두 렌더가 겹치는 것을 거절한다. 붙들지 않았을 때 실제로 그랬다:
   * 개발 모드에서 effect 가 두 번 도는 것만으로 1쪽이 흰 종이로 남고, 쪽을 넘기면
   * "페이지를 그리지 못했어요"가 떴다.
   */
  const taskRef = useRef<{ cancel: () => void } | null>(null)

  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  /** 한 쪽을 캔버스에 그린다 — 칸 너비에 맞춘다(가로 스크롤이 생기면 읽기 나쁘다) */
  const renderPage = useCallback(async (pageNo: number) => {
    const doc = docRef.current
    const canvas = canvasRef.current
    if (!doc || !canvas) return
    const mine = ++genRef.current

    // 앞선 렌더가 남아 있으면 먼저 접는다 — 겹치면 pdf.js 가 거절한다
    taskRef.current?.cancel()
    taskRef.current = null
    setError(null)

    try {
      const pdfPage = await doc.getPage(pageNo)
      if (mine !== genRef.current) return

      const boxWidth = boxRef.current?.clientWidth ?? 0
      const base = pdfPage.getViewport({ scale: 1 })
      /*
        폭이 아직 0 이면(첫 그림 전) 1 배로 둔다 — 0 으로 곱하면 캔버스가 사라진다.
        `devicePixelRatio` 를 곱해 두지 않으면 고해상도 화면에서 글자가 뭉갠다.
      */
      const fit = boxWidth > 0 ? boxWidth / base.width : 1
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = pdfPage.getViewport({ scale: fit * dpr })

      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      // CSS 크기는 dpr 을 뺀 값 — 안 그러면 캔버스가 칸을 넘어 두 배로 커진다
      canvas.style.width = '100%'
      canvas.style.height = 'auto'

      const task = pdfPage.render({ canvas, viewport })
      taskRef.current = task
      await task.promise
    } catch (err) {
      // 취소는 실패가 아니다 — 이 렌더를 밀어낸 다음 렌더가 이어서 돈다
      if ((err as { name?: string })?.name === 'RenderingCancelledException') return
      if (mine === genRef.current) setError('페이지를 그리지 못했어요.')
    }
  }, [])

  // 파일이 바뀌면 받아서 연다
  useEffect(() => {
    if (!fileId) {
      setError(null)
      setPageCount(0)
      return
    }
    let cancelled = false
    let task: { destroy: () => Promise<void> } | null = null
    setError(null)
    setLoading(true)
    setPageCount(0)
    setPage(1)

    void (async () => {
      try {
        const [pdfjs, { data }] = await Promise.all([
          loadPdfjs(),
          api.get<Blob>(`/files/${fileId}/content`, { responseType: 'blob' }),
        ])
        if (cancelled) return
        const bytes = await data.arrayBuffer()
        if (cancelled) return

        const loadingTask = pdfjs.getDocument({ data: bytes, ...PDF_DATA_URLS })
        task = loadingTask
        const doc = await loadingTask.promise
        if (cancelled) {
          void loadingTask.destroy()
          return
        }
        docRef.current = doc
        setPageCount(doc.numPages)
        await renderPage(1)
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err, 'PDF를 불러오지 못했어요.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      genRef.current += 1
      taskRef.current?.cancel()
      taskRef.current = null
      docRef.current = null
      /* 문서를 버리는 길은 로딩 태스크에만 있다 — 안 버리면 자료를 옮겨 볼 때마다 워커가 쌓인다 */
      void task?.destroy().catch(() => {})
    }
  }, [fileId, renderPage])

  const go = (next: number) => {
    if (next < 1 || next > pageCount) return
    setPage(next)
    void renderPage(next)
  }

  const shell = cn(
    'flex flex-col overflow-hidden rounded-2xl border-2 border-track bg-white',
    className,
  )

  if (!fileId) {
    return (
      <div className={cn(shell, 'items-center justify-center p-6')}>
        <p className="text-center text-[.85rem] font-semibold text-ink-mute">
          원본 파일을 찾을 수 없어요.
          <br />
          아래 읽어 낸 내용으로 확인해 주세요.
        </p>
      </div>
    )
  }

  return (
    <div className={shell}>
      {/* 그림이 길어도 칸 밖으로 넘치지 않게 — 스크롤은 이 안에서만 */}
      <div ref={boxRef} className="min-h-0 flex-1 overflow-y-auto bg-canvas p-2.5">
        {/*
          오류가 나도 캔버스를 **떼지 않는다.** 떼면 다음 렌더가 그릴 곳을 못 찾아 영영
          복구되지 않는다 — 쪽을 넘기다 한 번 실패하면 그 뒤로 아무것도 안 나왔다.
        */}
        {error && (
          <p className="p-4 text-center text-[.85rem] font-semibold text-danger">{error}</p>
        )}
        <>
          {loading && (
            <p className="p-6 text-center text-[.85rem] font-semibold text-ink-mute">
              PDF를 불러오는 중…
            </p>
          )}
            {/* 로딩 중에도 캔버스를 지우지 않는다 — 페이지를 넘길 때 화면이 깜빡인다 */}
            {/* 캔버스는 읽어 줄 것이 없으므로 무엇을 그린 것인지 이름으로 알린다 */}
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={pageCount > 1 ? `${title} ${page}쪽` : title}
              className="mx-auto block rounded-lg shadow-card"
          />
        </>
      </div>

      {/* 쪽 넘김 — 여러 쪽일 때만. 오류가 났어도 숨기지 않는다: 다시 시도할 길이 이것뿐이다 */}
      {pageCount > 1 && (
        <div className="flex flex-none items-center justify-center gap-3 border-t border-track bg-white p-2">
          <button
            type="button"
            onClick={() => go(page - 1)}
            disabled={page <= 1}
            aria-label="이전 쪽"
            className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition-colors hover:bg-canvas disabled:opacity-35"
          >
            <Icon name="back" className="h-4 w-4" />
          </button>
          <span className="text-[.82rem] font-bold text-ink-soft">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => go(page + 1)}
            disabled={page >= pageCount}
            aria-label="다음 쪽"
            className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition-colors hover:bg-canvas disabled:opacity-35"
          >
            <Icon name="chevronRight" className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
