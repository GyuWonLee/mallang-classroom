import { useRouteError } from 'react-router-dom'

/**
 * 라우트에서 예외가 터졌을 때 대신 그리는 화면.
 *
 * 전에는 `errorElement` 가 한 곳도 없어 react-router 의 기본 화면(영문
 * "Unexpected Application Error!")이 떴다. 저학년에게는 흰 화면과 다르지 않고,
 * 무엇보다 **다시 시도할 방법이 없었다.**
 *
 * 가장 흔한 원인은 배포 직후의 청크 404 다(`lazyWithRetry` 가 두 번까지 막아 준다).
 * 여기까지 왔다는 것은 그 방어도 통과하지 못했다는 뜻이므로, 새로고침 버튼 하나만 준다.
 * 문구는 RouteFallback 과 같은 톤으로 — 마스코트 하나, 짧은 문장, 큰 버튼.
 */
export function RouteError() {
  const error = useRouteError()

  return (
    <div className="grid min-h-screen place-items-center bg-canvas p-6">
      <div className="flex max-w-[26rem] flex-col items-center gap-4 rounded-[32px] bg-card p-[42px_38px] text-center shadow-card-lg">
        <span className="text-[2.6rem]" aria-hidden="true">
          🌱
        </span>
        <p className="text-[1.15rem] font-black">화면을 여는 데 실패했어요</p>
        <p className="text-[.95rem] font-medium text-ink-soft">
          잠깐 문제가 있었어요. 아래 버튼을 누르면 다시 열어볼게요.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-1 min-h-11 rounded-full bg-primary px-7 py-2.5 text-[.98rem] font-black text-white"
        >
          다시 열기
        </button>
        {/*
          개발 중에만 원인을 보여 준다. 운영 화면에 영문 스택을 띄우면
          아이가 읽을 수 없는 글자만 늘어난다.
        */}
        {import.meta.env.DEV && (
          <pre className="mt-2 max-h-40 w-full overflow-auto rounded-xl bg-canvas p-3 text-left text-[.72rem] text-ink-mute">
            {error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)}
          </pre>
        )}
      </div>
    </div>
  )
}
