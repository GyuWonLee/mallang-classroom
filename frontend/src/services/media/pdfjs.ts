import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/**
 * 워커 주소에 붙이는 값 — **망가진 캐시를 한 번 밀어내기 위한 것**이다.
 *
 * 워커 파일은 내용 해시가 이름에 있어 `immutable` 로 1년 캐시된다. 그런데 nginx 가 .mjs 를
 * `application/octet-stream` 으로 내려주던 동안(mime.types 에 .mjs 가 없었다) 브라우저들이
 * **그 잘못된 응답을 캐시에 넣었다.** `immutable` 은 새로 고쳐도 재검증하지 않겠다는 뜻이라,
 * 서버를 고친 뒤에도 그 사이 접속한 사람은 계속 실패한다 — 강력 새로고침을 하기 전까지.
 *
 * 파일 이름은 라이브러리를 올리기 전까지 안 바뀌므로, 주소를 바꿔 캐시 열쇠를 갈아 끼운다.
 * 한 번 지나가면 필요 없는 값이라 pdfjs 를 올릴 때 함께 지워도 된다.
 */
const WORKER_CACHE_BUST = 'mime-fix-1'

type PdfjsModule = typeof import('pdfjs-dist')
let pdfjsPromise: Promise<PdfjsModule> | null = null

/**
 * pdf.js 를 한 번만 받아 온다 — **PDF 를 실제로 열 때** 받는다(동적 import).
 *
 * <p>정적으로 import 하면 그 화면 번들에 통째로 들어간다. 재 보니 40kB 가 474kB(gzip 141kB)가
 * 됐다. PDF 는 가끔 쓰는 기능인데 그 값을 화면 진입이 매번 치르는 셈이고, 이 앱이 도는
 * 학교망에서는 그 차이가 지연으로 나타난다.</p>
 *
 * <p>워커는 반드시 붙인다. 없어도 돌지만(메인 스레드 폴백) 그러면 페이지를 그리는 동안 화면이
 * 멈춘다 — 수업 중 판서와 같은 화면에서는 획이 끊긴다.</p>
 *
 * <p>수업 중 PDF 발표(`PdfPresenter`)와 학습자료 미리보기(`MaterialPdfView`)가 함께 쓴다.
 * 두 곳에 따로 두면 워커 설정이 갈라지고, 갈라진 쪽은 조용히 메인 스레드로 떨어진다.</p>
 */
export function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist').then((mod) => {
    mod.GlobalWorkerOptions.workerSrc = `${workerUrl}?v=${WORKER_CACHE_BUST}`
    return mod
  })
  return pdfjsPromise
}

/**
 * `getDocument` 에 함께 넘겨야 하는 데이터 경로.
 *
 * <p>PDF 를 그리려면 번들 밖에서 받아 가는 것이 둘 더 있다.</p>
 * <ul>
 *   <li>{@code cMapUrl} — CID 글꼴의 문자 대응표. <b>한글 PDF 는 거의 다 CID 라 없으면 못 그린다.</b></li>
 *   <li>{@code standardFontDataUrl} — 파일에 글꼴이 안 박힌 경우 쓰는 표준 14종(Helvetica 등).</li>
 * </ul>
 *
 * <p>둘 다 없으면 {@code getDocument} 는 성공하는데 <b>{@code render} 가 끝나지 않는다.</b>
 * 오류도 안 나서 화면에는 빈 종이나 "열지 못했어요"만 남는다 — 실제로 그 상태였고,
 * 수업 중 PDF 공유와 학습자료 미리보기가 함께 막혀 있었다.</p>
 *
 * <p>파일은 빌드 때 node_modules 에서 {@code public/pdfjs/} 로 복사된다
 * (scripts/copy-pdfjs-assets.mjs). {@code public/} 는 Vite 가 가공 없이 옮기므로 경로가 고정이다.</p>
 *
 * <p>여기 한 곳에 둔다 — 호출부마다 적으면 한쪽만 빠졌을 때 "어떤 PDF 는 되고 어떤 건 안 되는"
 * 형태로 나타나 원인을 찾기 어렵다.</p>
 */
export const PDF_DATA_URLS = {
  cMapUrl: '/pdfjs/cmaps/',
  /** 위 파일들은 .bcmap(압축본)이다 */
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
} as const

/**
 * pdf.js 를 <b>미리 받아 둔다</b> — 결과를 기다리지 않는다.
 *
 * <p>여는 순간까지 아무것도 안 받아 두면, 선생님이 파일을 고른 <b>뒤에야</b> 500KB 를 받기
 * 시작한다(pdf 모듈 126KB + 워커 373KB, gzip 기준). 학교망에서는 그 시간이 그대로
 * "파일을 골랐는데 한참 아무 일도 안 일어나는" 구간이 된다.</p>
 *
 * <p>그렇다고 화면에 들어갈 때 받으면 PDF 를 쓰지 않는 수업까지 그 값을 치른다 — 이 모듈이
 * 애초에 동적 import 인 이유가 그것이다. 그래서 <b>파일 대화상자를 여는 순간</b> 부른다:
 * 선생님이 파일을 찾는 몇 초 동안 받아 두면 고르는 즉시 그릴 수 있고, 안 여는 사람은
 * 여전히 아무것도 받지 않는다.</p>
 *
 * <p>워커는 첫 {@code getDocument} 때 만들어지므로 모듈만 받아서는 절반이다. 주소를 미리
 * 훑어 브라우저 캐시에 넣어 둔다 — 실패해도 그냥 넘어간다(그때는 평소대로 그때 받는다).</p>
 */
export function warmPdfjs(): void {
  void loadPdfjs()
    .then(() => fetch(`${workerUrl}?v=${WORKER_CACHE_BUST}`, { cache: 'force-cache' }))
    .catch(() => {
      /* 미리 받기 실패는 기능이 아니다 — 열 때 다시 받는다 */
    })
}
