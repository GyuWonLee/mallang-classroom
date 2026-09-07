import { useEffect, useState } from 'react'

/**
 * AI 가 문제를 만드는 동안 과제 마법사 안에 뜨는 화면.
 *
 * F5 로 보이는 로딩 화면(`RouteFallback`)과 **다른 화면이다.** 그쪽은 100ms 짜리 기다림이라
 * 글자를 넣지 않았는데, 이 작업은 **10~20초 걸린다**(서버가 202 로 jobId 만 주고 DONE 까지
 * 폴링한다 — AssignmentWizardModal.generate). 그만큼을 그림 하나로 버티게 하면 멈춘 것으로
 * 보여 선생님이 [만들기] 를 두 번 누르게 된다.
 *
 * ⚠ **진행률 숫자(`43%` 같은)는 쓰지 않는다.** 서버가 진행 정도를 주지 않으므로 어떤 숫자든
 * 시간으로 꾸며 낸 거짓이 된다. 기다림의 길이는 도는 고리로, "무엇을 하는 중"은 글로 말한다.
 *
 * 지금은 **첫 시안**이다 — 모양은 미리보기(`/dev/preview`)에서 보면서 다듬는다.
 */

/**
 * 제목 — 물결 애니메이션 때문에 한 자씩 쪼개 쓴다(아래 주석).
 * 끝은 점 **하나**다: 늘어나는 점 세 개는 아래 안내문이 맡으므로 여기까지 `...` 이면 한 화면에
 * 말줄임이 두 군데가 된다.
 */
const TITLE = 'AI가 문제를 만들고 있어요.'

/** 안내문 뒤 점이 한 칸씩 늘어나는 간격 (1개 → 2개 → 3개 → 다시 1개) */
const DOT_STEP_MS = 420

export function AiGeneratingView() {
  /*
    점 개수 1→2→3→1… 을 **JS 로 센다.**

    CSS 만으로 하려면 점 세 개에 각각 다른 키프레임을 줘야 한다(같은 키프레임에 지연만 달리
    주면 각자 자기 주기로 켜졌다 꺼져서 1→2→3 이 아니라 우르르 굴러가는 모양이 된다).
    키프레임 셋을 만드느니 상태 하나가 읽기 쉽고, 420ms 마다 한 번 다시 그리는 값은 무시할 만하다.
  */
  const [dots, setDots] = useState(1)
  useEffect(() => {
    const id = setInterval(() => setDots((n) => (n % 3) + 1), DOT_STEP_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      /*
        바깥 여백은 주지 않는다 — 이 화면은 `ModalShell` 안에 얹히고 그 카드가 이미
        `32px 34px 30px` 을 갖고 있다. 여기서 또 주면 이중 여백이 된다.
        높이만 잡아 둔다: 마법사 1단계(자료 고르기)보다 훨씬 짧아서, 생성이 시작되는 순간
        모달이 확 쪼그라들면 화면이 튀어 보인다.
      */
      className="grid min-h-[320px] place-items-center"
      role="status"
      aria-live="polite"
      aria-label="AI가 문제를 만들고 있어요"
    >
      <div className="flex flex-col items-center text-center">
        {/*
          말랑이를 감싸고 도는 고리 — 로딩 화면과 같은 짜임이다(연한 원 + 4분의 1 조각).
          같은 기다림에 두 가지 표기법을 쓰지 않으려고 맞췄다.
        */}
        <div className="relative grid h-[200px] w-[200px] place-items-center">
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
              strokeDasharray="72 217"
            />
          </svg>

          <img
            src="/assets/merged.gif"
            alt=""
            aria-hidden="true"
            decoding="async"
            className="h-[168px] w-[168px] object-contain"
          />
        </div>

        {/*
          제목이 **한 자씩 물결친다.** 20초를 기다리는 화면에서 글자가 멈춰 있으면 그림만 돌고
          화면은 굳은 것처럼 보인다. 지연을 글자 순서대로(`i * 0.06s`) 어긋내 왼쪽에서
          오른쪽으로 흐르게 했다 — 다 같이 뛰면 줄 전체가 출렁여 읽기 어렵다.

          한 자씩 쪼개므로 **낭독기에는 통째로 따로 알려 준다**: 이 제목은 `aria-hidden` 으로
          감추고, 바깥 `role="status"` 의 `aria-label` 이 같은 문장을 말한다. 안 그러면
          "A·I·가·문·제·를…" 처럼 한 자씩 읽는다.

          `whitespace-pre` 가 **띄어쓰기를 지킨다.** 조각 하나에 공백만 들어 있으면 보통은
          접혀 폭이 0 이 되어 `AI가문제를만들고있어요` 로 붙어 버린다(실제로 그랬다).
        */}
        <h3 className="mt-4 whitespace-pre text-[1.3rem] font-black text-ink" aria-hidden="true">
          {[...TITLE].map((ch, i) => (
            <span
              key={i}
              className="inline-block animate-text-wave"
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              {ch}
            </span>
          ))}
        </h3>

        <p className="mt-1.5 text-[.9rem] font-bold leading-[1.6] text-ink-soft">
          잠시만 기다려 주세요
          {/*
            점이 늘어나는 자리는 **폭을 고정한다**(`w-[1.4em]` + 왼쪽 정렬). 안 그러면 점이
            늘 때마다 글줄이 길어지고, 가운데 정렬이라 문장 전체가 좌우로 흔들린다.
            점 자체는 뜻이 없으므로 낭독기에서 감춘다.
          */}
          <span aria-hidden="true" className="inline-block w-[1.4em] text-left">
            {'.'.repeat(dots)}
          </span>
        </p>
      </div>
    </div>
  )
}
