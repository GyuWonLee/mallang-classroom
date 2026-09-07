/**
 * 무언가를 기다리는 동안 뜨는 **전체 화면 로딩**.
 *
 * 쓰이는 곳이 둘이다: 라우트 청크를 받는 동안(RootLayout 의 `<Suspense>`)과 세션을 복원하는
 * 동안(`guards.tsx`). 예전에는 각자 다른 모양이었다 — 한쪽은 흔들리는 🌱 이모지, 한쪽은
 * 점 하나 + "불러오는 중…" 이라 같은 기다림이 두 얼굴로 보였다. 한 컴포넌트로 합쳤다.
 *
 * 그림은 **말랑이가 통통 뛰는 GIF**(`merged.gif`)고, 그것을 **동그란 고리**가 감싸고 돈다.
 * 움직임이 GIF 안에 이미 있으므로 그림 자체에는 CSS 애니메이션을 겹치지 않는다 — 예전
 * 이모지에 걸었던 `floaty` 를 그대로 두면 뛰는 그림이 위아래로 또 흔들려 멀미가 난다.
 *
 * 글자는 **넣지 않는다.** 보통 100ms 안에 사라지므로 글이 번쩍이는 게 더 거슬리고, 무엇을
 * 기다리는지는 이 화면이 정할 수 없다(청크 · 세션 · 그 밖). 화면 낭독기에는 `role="status"` +
 * `aria-label` 로 말로 전한다.
 */
export function RouteFallback() {
  return (
    /* 바탕은 **완전한 흰색**(`bg-card` = #ffffff)이다 — `bg-canvas`(#fbfbfb)는 살짝 회색기가 돌았다 */
    <div className="grid min-h-screen place-items-center bg-card" role="status" aria-label="불러오는 중">
      {/*
        고리는 **채워지지 않고 돌아간다.** 얼마나 남았는지 알 수 있는 값이 없으므로(청크를 받는
        일에 진행률이 없다) 채우는 시늉을 하면 거짓 표시가 된다. 연한 원(track)을 깔고 그 위에
        4분의 1 조각을 돌린다 — 조각만 있으면 고리의 크기가 드러나지 않아 그림 옆을 스치는
        선처럼 보인다.
      */}
      <div className="relative grid h-[248px] w-[248px] place-items-center max-[640px]:h-[190px] max-[640px]:w-[190px]">
        <svg
          viewBox="0 0 100 100"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full animate-spin [animation-duration:1.6s]"
        >
          <circle cx="50" cy="50" r="46" fill="none" stroke="var(--color-sky)" strokeWidth="3.5" />
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="3.5"
            strokeLinecap="round"
            /* 둘레 2π·46 ≈ 289 중 72 만 그린다 = 4분의 1 조각 */
            strokeDasharray="72 217"
          />
        </svg>

        <img
          src="/assets/merged.gif"
          alt=""
          aria-hidden="true"
          decoding="async"
          /* 그림 안에 여백이 넉넉해서(480x480 중 캐릭터는 아래쪽 절반) 큼직하게 잡아야 제 크기로 보인다 */
          className="h-[210px] w-[210px] object-contain max-[640px]:h-[160px] max-[640px]:w-[160px]"
        />
      </div>
    </div>
  )
}
