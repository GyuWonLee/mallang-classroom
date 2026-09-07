import { useToastStore } from '@/stores/useToastStore'

/**
 * 화면 상단 토스트. 항상 렌더하고 transform 으로 슬라이드시킨다.
 *
 * 숨길 때 `-translate-y-[160%]` 만으로는 부족했다 — 알림이 없을 때도 검은 알약의 아래쪽과
 * **그림자(0 10px 30px)가 화면 위쪽에 살짝 걸쳐 보였다.** 그림자는 요소 밖으로 40px 까지
 * 번지는데 이동량은 자기 높이 기준이라 다 못 가린다. 그래서 투명도까지 함께 0 으로 준다
 * (그림자는 요소의 opacity 를 따라간다). 슬라이드 애니메이션은 그대로 유지된다.
 *
 * `pointer-events-none` — 안 보이는 동안 상단의 클릭을 가로채지 않게.
 */
export function Toast() {
  const message = useToastStore((s) => s.message)
  const visible = useToastStore((s) => s.visible)

  return (
    <div
      role="status"
      aria-live="polite"
      data-show={visible && Boolean(message)}
      className={
        /*
          **가장 위 층(z-95)이다.** ref 는 `.toast{z-index:70}` 였는데, 그러면 모달 오버레이
          (`ModalShell` z-80)·생활기록부 오버레이(z-90)가 토스트를 덮는다 — 과제 생성 마법사에서
          저장이 실패했을 때, 그리고 모달 안에서 초대 링크·임시 비밀번호를 복사했을 때 그
          안내가 **창 뒤에 가려** 아무 일도 안 일어난 것처럼 보였다.
          토스트는 지금 보고 있는 화면이 무엇이든 읽혀야 하는 것이라 맨 위로 올린다.

          폭죽(z-90)보다도 위가 된다. ref 는 폭죽이 토스트 위로 떨어지게 두었지만, 그건 장식이고
          이쪽은 전달이다 — 가려서 못 읽는 쪽이 더 나쁘다.
        */
        'fixed left-1/2 top-6 z-[95] -translate-x-1/2 rounded-full bg-ink px-[26px] py-[13px] ' +
        'text-[.9rem] font-bold text-white shadow-[0_10px_30px_rgba(0,0,0,.25)] ' +
        'transition-[transform,opacity] duration-[450ms] ease-bounce ' +
        'data-[show=false]:pointer-events-none data-[show=false]:opacity-0 ' +
        'data-[show=false]:-translate-y-[200%] data-[show=true]:translate-y-0 data-[show=true]:opacity-100'
      }
    >
      {message}
    </div>
  )
}
