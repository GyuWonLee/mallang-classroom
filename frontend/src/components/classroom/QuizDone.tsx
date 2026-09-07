import { useEffect } from 'react'
import { Button } from '@/components/common/Button'
import { confettiController } from '@/services/effects/confettiController'

/**
 * 폭죽 — **양옆 아래에서 화면 안쪽으로 터진다**(`burst`). 위에서 계속 내리는 `rain` 은 썼다가
 * 뺐다: 축하가 끝나지 않는 느낌이라 아이가 다음 단추를 누를 때를 잡지 못했다.
 *
 * 두 차례로 나눠 쏜다. 한 번에 다 넣으면 같은 프레임에 뿌려져 **한 덩어리로 솟았다 한꺼번에
 * 사라진다** — 260ms 뒤 두 번째 발이 따라가면 첫 발이 흩어지는 동안 화면이 이어진다.
 *
 * 양은 **140개**다. 처음에 500개로 넣었더니 화면이 종잇조각으로 덮여 그림·단추가 묻혔고,
 * 조각이 많으면 중력에 떨어지는 꼬리도 그만큼 길어져 "계속 떨어진다" 로 보였다.
 * 정답 하나에 100개(`useQuiz`)이니, 완료는 그보다 조금 더 많은 정도가 알맞다.
 */
const BURSTS = [
  { count: 80, delay: 0 },
  { count: 60, delay: 260 },
]

interface QuizDoneProps {
  /** 교실로 돌아가기 — 완료 처리·토스트는 useQuiz.closeCelebrate 가 한다 */
  onClose: () => void
}

/**
 * 과제를 다 푼 뒤 나오는 **완료 페이지**.
 *
 * 예전에는 모달(`CelebrateModal`)이었다. 화면 위에 뜬 카드라 뒤의 문제지가 흐릿하게 남아
 * "아직 문제 화면인데 뭔가 덮였다" 로 읽혔고, 폭죽이 모달 뒤로 가려질 여지도 있었다.
 * 지금은 **문제지의 다음 장**이다 — 마지막 문제를 넘기면 같은 종이 위에서 이 장이 나온다.
 *
 * 위에 뛰던 별 셋도 지웠다(선생님 요청) — 그림 하나와 단추만으로 축하가 전해지고,
 * 별까지 있으면 짧은 장에 움직이는 것이 둘이라 시선이 갈렸다.
 *
 * 문항 수·채점 점수는 적지 않는다. 다 푼 직후에 몇 개를 맞혔는지 따지는 자리가 아니고
 * (그건 활동지의 `내 답안 보기` 가 한다), 숫자를 지운 만큼 그림이 화면을 다 쓴다.
 * 채점 실패 사유는 `useQuiz.closeCelebrate` 의 토스트가 알린다.
 *
 * **좌우 여백은 이 컴포넌트가 정하지 않는다.** 문제 종이는 왼쪽 100px · 오른쪽 48px 로
 * 일부러 어긋나 있는데(발문 자리에 맞춘 값), 그 위에 그대로 얹으면 가운데 정렬한 것들이
 * 종이 기준으로 26px 오른쪽에 서게 된다. 그래서 완료 장은 QuizView 에서 **좌우가 같은**
 * 여백으로 감싼다 — 여기서 `mx-auto` 를 아무리 해도 그 어긋남은 사라지지 않는다.
 */
export function QuizDone({ onClose }: QuizDoneProps) {
  /*
    폭죽은 **이 장이 켜고 끈다.**

    예전에는 `useQuiz.finish()` 가 완료 시점에 한 번 불렀다. 그런데 그 시점은 마지막 정답 뒤
    900ms 이고 화면이 바뀌는 순간과 겹쳐서, 아이가 완료 장을 볼 때는 이미 끝나 있었다
    ("안 터진다" 로 보였다). 소유권도 여기가 맞다: 폭죽은 완료 화면의 일부이고 `finish()` 가
    하는 일은 제출이다. 그래서 `finish()` 쪽 호출은 지웠다.

    떠날 때 남은 타이머를 걷는다 — 안 걷으면 교실로 돌아간 뒤 두 번째 발이 터진다.

    ⚠ `prefers-reduced-motion: reduce` 가 켜져 있으면 `ConfettiEngine` 이 조용히 아무것도
    그리지 않는다(엔진 주석). 그건 운영체제 설정을 존중하는 동작이라 여기서 우회하지 않는다.
  */
  useEffect(() => {
    const timers = BURSTS.filter((b) => b.delay > 0).map((b) =>
      setTimeout(() => confettiController.burst(b.count), b.delay),
    )
    BURSTS.filter((b) => b.delay === 0).forEach((b) => confettiController.burst(b.count))
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className="grid min-h-full place-items-center p-[0_0_6px]">
      <div className="flex flex-col items-center text-center">
        {/*
          말랑이와 `과제 완료! 최고야!` 가 **한 장의 그림**(`end_ch`)이다. 예전에는 글자는 `<h2>`,
          말랑이는 따로 얹은 그림이었는데 — 그림 안에 이미 같은 글이 디자인돼 있어 굳이 나눌
          이유가 없다. 대신 지켜야 할 것이 하나 있다: 글이 그림 안으로 들어갔으니 `alt` 에
          **그 글을 그대로** 적어야 화면 낭독기에도 축하가 전해진다(`aria-hidden` 을 쓰면 안 된다).

          `role="heading"` 을 붙여 이 그림이 이 장의 제목 자리임을 남긴다 — `<h2>` 가 사라진
          만큼 문서 구조에서 제목이 빠지지 않게.

          폭 상한 560px 은 종이 안쪽을 넘지 않는 값이고, `max-h-[40vh]` 는 **세로로 넘치지 않게**
          하는 상한이다. 폭만 잡아 두면 낮은 화면에서 그림+단추가 종이보다 길어져 이 장에
          스크롤이 생겼다(문제 화면과 달리 완료 장은 한눈에 보여야 한다). 높이 상한이 걸리면
          그림이 비율을 지키며 줄어든다 — `height:auto` 라 letterbox 빈칸도 생기지 않는다.

          **움직이지 않는다.** 등장할 때 통통 뛰게(`animate-mascot-jump`) 해 뒀는데, 그림 안에
          글자가 함께 있어서 축하 문구까지 흔들려 읽기 어려웠다(선생님 요청으로 뺐다).
        */}
        <img
          src="/assets/end_ch.webp"
          alt="과제 완료! 최고야!"
          role="heading"
          aria-level={2}
          width={2156}
          height={1210}
          decoding="async"
          className="block h-auto w-full max-w-[560px] max-h-[40vh] object-contain"
        />

        {/*
          그림과 단추 사이를 40px 벌린다. 붙어 있으면 단추가 그림에 딸린 꼬리표처럼 읽히고,
          **그림이 그만큼 위로 올라가** 종이 위쪽 절반에 자리한다(선생님 요청).
          56px 이었는데 그만큼이 세로 길이에 더해져 낮은 화면에서 스크롤을 만들었다.
        */}
        <Button variant="primary" size="lg" onClick={onClose} className="mt-10">
          교실로 돌아가기
        </Button>
      </div>
    </div>
  )
}
