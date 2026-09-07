import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@/components/common/Icon'
import { Button } from '@/components/common/Button'
import { QuizDone } from './QuizDone'
/* 진행도 별 — 완료 장(QuizDone)이 쓰는 것과 **같은 그림**이다(별이 두 종류로 갈리지 않게) */
import starArt from '@/assets/characters/ch1-2.webp'
import { fadeUp } from '@/lib/motion'
import { useQuiz } from '@/hooks/useQuiz'
import { useClassroomStore } from '@/stores/useClassroomStore'
import { assignmentApi } from '@/services/api/assignmentApi'
import { ttsApi } from '@/services/api/ttsApi'
import { apiErrorMessage } from '@/lib/apiError'
// 보기 라벨은 lib/quiz 가 갖는다 — TTS 가 읽는 라벨과 화면 라벨이 어긋나지 않게 한 곳에서 온다
import { answerKey, toQuizQuestions, type QuizItem } from '@/lib/quiz'
import { subjectImage } from '@/lib/subject'
import type { Subject } from '@/types/assignment'

/**
 * 과제 과목 → 옆에 세울 마스코트 그림.
 *
 * 과제의 `subject` 는 백엔드 enum(`'KOREAN' | 'ENGLISH' | …`)이고 `subjectImage` 는 화면용
 * 한글 이름(`'국어' | '수학' …`)을 받는다 — 두 축이 달라서 여기서 이어 준다.
 *
 * `Record<Subject, string>` 로 **빠짐없이** 적는다: 과목이 늘어나면 이 표에서 컴파일이 깨져
 * 그림을 정하라고 알려 준다(빠진 과목이 조용히 국어 그림으로 떨어지지 않는다).
 */
const MASCOT: Record<Subject, string> = {
  KOREAN: subjectImage('국어'),
  ENGLISH: subjectImage('영어'),
  MATH: subjectImage('수학'),
  SOCIAL: subjectImage('사회'),
  SCIENCE: subjectImage('과학'),
}

/**
 * 문장 읽어주기 (TTS).
 *
 * `GET /api/files/{id}/content` 는 Authorization 헤더가 필요해서 `<audio src>` 로 바로 못 건다.
 * blob 으로 받아 objectURL 로 재생하고, 같은 문항을 다시 눌러도 서버를 또 부르지 않게 캐시한다.
 * 만든 objectURL 은 화면을 떠날 때 전부 해제한다(안 하면 탭이 살아 있는 동안 계속 쌓인다).
 */
function useSentenceAudio() {
  const cache = useRef(new Map<number, string>())
  const audio = useRef<HTMLAudioElement | null>(null)
  const [loadingKey, setLoadingKey] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () => () => {
      audio.current?.pause()
      cache.current.forEach((url) => URL.revokeObjectURL(url))
      cache.current.clear()
    },
    [],
  )

  /**
   * 재생 중인 소리를 즉시 끊는다.
   *
   * `pause()` 만으로는 부족하다 — 같은 `Audio` 를 다시 재생하면 멈춘 지점부터 이어지므로
   * 재생 위치를 0 으로 되돌린다. 캐시(objectURL)는 그대로 둔다: 다시 들을 때 서버를 또
   * 부르지 않기 위해서다.
   */
  const stop = useCallback(() => {
    const el = audio.current
    if (!el) return
    el.pause()
    el.currentTime = 0
  }, [])

  const play = useCallback(async (key: number, text: string) => {
    setError(null)
    try {
      let url = cache.current.get(key)
      if (!url) {
        setLoadingKey(key)
        url = await ttsApi.speak(text)
        cache.current.set(key, url)
      }
      audio.current?.pause()
      audio.current = new Audio(url)
      await audio.current.play()
    } catch (err) {
      setError(apiErrorMessage(err, '소리를 불러오지 못했어요. 다시 눌러볼까요?'))
    } finally {
      setLoadingKey(null)
    }
  }, [])

  return { play, stop, loadingKey, error }
}

/**
 * 원고지 지문: " / "로 줄 구분, 글자당 한 칸.
 *
 * ⚠ **지금은 그려지지 않는다.** 백엔드 문항 스키마에 학생용 지문 필드가 없어서 `q.passage` 가
 * 항상 null 이다(lib/quiz.ts). 예전엔 근거 인용(`sourceRef.quote`)을 여기에 넣었는데 그게
 * 정답을 그대로 보여줬다 — **그 값을 다시 연결하지 말 것.** 자세한 이유는 lib/quiz.ts 주석.
 */
function Passage({ text }: { text: string }) {
  const lines = text.split(' / ')
  return (
    <div className="mt-5 flex w-fit max-w-full flex-col" aria-label="시 지문">
      {lines.map((line, li) => (
        <div key={li} className="flex">
          {[...line].map((ch, ci) => (
            <span
              key={ci}
              className="-m-[.75px] grid h-[42px] w-[42px] flex-none place-items-center border-[1.5px] border-canvas bg-[#FBFAFE] text-[1.15rem] font-bold text-ink max-[640px]:h-8 max-[640px]:w-8 max-[640px]:text-[.95rem]"
            >
              {ch === ' ' ? '' : ch}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

/** 퀴즈 화면 (ref .quiz 이관) — 문항은 실제 과제(`GET /assignments/{id}`)에서 온다 */
export function QuizView() {
  const setView = useClassroomStore((s) => s.setView)
  const assignmentId = useClassroomStore((s) => s.quizAssignmentId)

  const [questions, setQuestions] = useState<QuizItem[]>([])
  /**
   * 이 과제의 과목 — 옆에 세우는 마스코트를 고른다(`subjectImage`).
   *
   * 과제 응답에 있는 값을 그대로 둔다. 지금 서비스는 국어 전용이라 늘 '국어' 지만, 과목이
   * 늘어나면 그림도 따라 바뀌어야 한다 — 여기서 하드코딩하면 그때 이 자리를 찾아야 한다.
   */
  const [subject, setSubject] = useState<Subject>('KOREAN')
  /** 불러오기 실패 — '문제 없음'과 구분한다 */
  const [failed, setFailed] = useState(false)
  /** '다시 받기'가 effect 를 다시 돌리게 하는 값 */
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const quiz = useQuiz(questions, assignmentId ?? undefined)
  const audio = useSentenceAudio()

  // 받아쓰기 입력칸 — 문항이 바뀌면 비운다
  const [typed, setTyped] = useState('')
  useEffect(() => setTyped(''), [quiz.qIndex])

  /*
    읽어주던 소리를 끊는다 — **답이 정해지는 순간과 문항이 넘어가는 순간** 둘 다.

    예전엔 한 번 재생을 시작하면 끝까지 흘렀다. 그래서 정답을 맞혀 폭죽이 터지는 동안에도
    문제를 계속 읽어 주고, '다음 문제' 로 넘어간 뒤에도 **이전 문항의 보기를 읽고 있었다**.
    보기까지 읽어 주게 되면서(lib/quiz 의 speakText) 문장이 길어져 더 두드러졌다.

    `quiz.locked` 는 정답·오답이 확정돼 더 고를 수 없게 된 상태다(받아쓰기 오답 포함).
    `quiz.qIndex` 는 문항 이동. 마지막 문항을 맞히면 locked 로 먼저 끊기므로 완료 장이
    뜰 때도 조용하다.
  */
  // 멤버 접근(`audio.stop`)을 의존성에 두면 lint 가 `audio` 전체를 요구한다 — 함수만 꺼내 쓴다
  const stopAudio = audio.stop

  useEffect(() => {
    if (quiz.locked) stopAudio()
  }, [quiz.locked, stopAudio])

  useEffect(() => {
    stopAudio()
  }, [quiz.qIndex, stopAudio])

  useEffect(() => {
    if (!assignmentId) {
      setQuestions([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setFailed(false)
    void assignmentApi
      .getAssignment(Number(assignmentId))
      .then((a) => {
        // 채점 방식은 문항이 아니라 과제 type 이 정한다 (lib/quiz 주석)
        if (cancelled) return
        setQuestions(toQuizQuestions(a.content.problems, a.type))
        setSubject(a.subject)
      })
      .catch(() => {
        // 실패를 "문제 없음"으로 뭉개지 않는다 — 아이가 "선생님이 아직 안 올렸구나"로
        // 오해하고 기다리게 된다. 못 가져왔다는 사실과 다시 시도할 방법을 준다.
        if (!cancelled) {
          setQuestions([])
          setFailed(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [assignmentId, reloadKey])

  // 문항이 준비되면 퀴즈 시작
  useEffect(() => {
    if (questions.length > 0) quiz.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions])

  // 힌트를 스토어에 올리던 effect 는 뺐다 — 읽던 쪽(AI 튜터)이 사라졌다
  const goBack = () => setView('classroom')

  const q = quiz.question

  // 문항을 못 가져온 경우 — 빈 화면 대신 왜 못 푸는지 알려준다
  if (loading || questions.length === 0) {
    return (
      <motion.section
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-[780px]"
        aria-label="국어 문제 풀기"
      >
        <button
          type="button"
          onClick={goBack}
          className="mb-5 flex items-center gap-2 rounded-full bg-card p-[12px_20px] text-[.9rem] font-bold text-ink-soft shadow-card transition-transform duration-200 ease-bounce hover:-translate-x-1"
        >
          <Icon name="back" className="h-[15px] w-[15px]" />
          교실로
        </button>
        <div className="rounded-[32px] bg-card p-[42px_46px] text-center shadow-card-lg">
          {/* ref 는 이모지를 쓰지 않는다 — 대기는 시계, 준비 중은 새싹 심볼로 */}
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-sky">
            <Icon name={loading ? 'clock' : 'sprout'} className="h-8 w-8 text-primary" />
          </span>
          <p className="mt-3 text-[1.1rem] font-black">
            {loading
              ? '문제를 가져오고 있어요…'
              : failed
                ? '문제를 못 받아왔어요'
                : '아직 풀 수 있는 문제가 없어요'}
          </p>
          {!loading && !failed && (
            <p className="mt-2 text-[.95rem] font-medium text-ink-soft">
              선생님이 문제를 올리면 여기에서 풀 수 있어요.
            </p>
          )}
          {!loading && failed && (
            <>
              <p className="mt-2 text-[.95rem] font-medium text-ink-soft">
                인터넷이 잠깐 느린 것 같아요.
              </p>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="mt-4 min-h-11 rounded-full bg-primary px-6 py-2.5 text-[.95rem] font-black text-white"
              >
                다시 받기
              </button>
            </>
          )}
        </div>
      </motion.section>
    )
  }

  const listening = audio.loadingKey === q.no


  return (
    <motion.section
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      /*
        폭을 여기서 묶지 않는다(예전 `mx-auto max-w-[780px]`). 맨 윗줄이 **화면 폭 전체**를 써야
        `교실로` 가 판 왼쪽 끝에 붙고 별이 화면 정가운데에 온다. 780px 제한은 아래 문제 종이가
        자기 클래스로 갖는다 — 글줄이 지나치게 길어지면 안 되는 것은 종이뿐이다.

        높이는 **부모가 준 만큼 꽉 쓴다**(`min-h-0 flex-1 flex-col`). 문항마다 화면이 들썩이지
        않게 하는 기준이 이것이다.
      */
      className="flex min-h-0 w-full flex-1 flex-col"
      aria-label="국어 문제 풀기"
    >
      {/*
        ── 맨 윗줄: `교실로`(왼쪽 끝) · 진행도 별(가운데) ─────────────────────────
        두 줄을 **한 줄로 합쳤다.** 각각 한 줄을 쓰면서 문제가 그만큼 아래로 내려가 있었다.

        `grid-cols-[1fr_auto_1fr]` 이 핵심이다: 가운데 칸이 내용 폭(`auto`)이고 양옆이 같은
        `1fr` 이라 **별 알약이 화면 정가운데**에 온다. `justify-between` 으로는 안 된다 —
        오른쪽에 짝이 없으므로 별이 오른쪽으로 밀린다.

        이 줄은 문제 카드(780px)에 갇히지 않고 **화면 폭 전체**를 쓴다. 그래서 `교실로` 가
        판 왼쪽 끝에 붙는다(카드 안에 있을 때는 카드 왼쪽 변에서 시작했다).

        별 알약에 흰 배경을 깔아 배경 그림(잔디·하늘) 위에서도 별과 글자가 읽히게 한다.
      */}
      <div className="mb-2.5 grid flex-none grid-cols-[1fr_auto_1fr] items-center gap-3">
        <button
          type="button"
          onClick={goBack}
          className="justify-self-start flex items-center gap-2 rounded-full bg-card p-[12px_20px] text-[.9rem] font-bold text-ink-soft shadow-card transition-transform duration-200 ease-bounce hover:-translate-x-1 active:scale-105"
        >
          <Icon name="back" className="h-[15px] w-[15px]" />
          교실로
        </button>

        {/*
          별만 남았으니 알약 여백도 줄인다(8/18 → 5/12px) — 글자가 있을 때 잡아 둔 여백이라
          그대로 두면 별 옆에 빈 흰 자리가 남는다. 알약 자체는 유지한다: 배경 그림(하늘·잔디)
          위에서 흑백 별이 묻히지 않게 흰 면이 필요하다.
        */}
        <div
          className="flex items-center gap-1 rounded-full bg-card/90 p-[5px_12px] shadow-card backdrop-blur-sm"
          role="img"
          aria-label={`${quiz.total}문제 중 ${quiz.qIndex + 1}번째`}
        >
          {quiz.stars.map((state, i) => (
            <img
              key={i}
              src={starArt}
              alt=""
              aria-hidden="true"
              decoding="async"
              data-state={state}
              /*
                **맞힌 순간부터 다음 문제로 넘길 때까지 계속 뛴다.**

                기준은 `feedback.kind === 'good'` 이다 — 정답일 때만 켜지고 `next()` 가 문항을
                넘길 때 비워지므로 "맞힌 뒤 대기 중" 과 정확히 겹친다. 클래스가 붙는 순간
                애니메이션이 시작되고 떨어지는 순간 멈추므로, 다시 재생시키려고 요소를 새로
                만들 필요도 없다(예전에는 `key` 에 맞힌 개수를 넣어 강제로 재마운트했다).

                `locked`·`showNext` 를 쓰지 않은 이유: 받아쓰기는 **틀려도** 정답을 알려주고
                넘어가면서 둘 다 켜진다 — 그걸 기준으로 삼으면 틀린 답에도 별이 축하한다.
              */
              data-cheer={quiz.feedback?.kind === 'good'}
              /*
                **파도타기** — 왼쪽부터 차례로 0.1초씩 늦게 뛴다.

                한때 1·3·5 / 2·4 두 무리로 나눠 봤는데, 떨어진 별끼리 같이 뛰어 물결이 아니라
                **두 덩어리가 번갈아 덜컹거리는** 모양이 됐다. 순서대로 흘리면 왼쪽에서
                오른쪽으로 파도가 지나간다.

                지연이 별 수만큼 누적되므로(5번째 = 0.4초) 애니메이션 한 바퀴(0.55초)와 겹쳐
                파도가 끊기지 않고 이어진다.
              */
              style={state === 'correct' ? { animationDelay: `${i * 0.1}s` } : undefined}
              /*
                흑백은 `grayscale` 필터로 만든다 — 별 그림이 하나뿐이라 색 버전·회색 버전을
                따로 두지 않아도 된다(그림이 바뀌면 한 곳만 고친다).
                `now` 는 흑백이지만 크게 둔다: 색으로 "맞혔다"를 말하고 있으므로 현재 위치는
                크기로 말해야 뜻이 겹치지 않는다.
              */
              /*
                점프는 **맞힌 별에만, 축하 중일 때만.** 두 조건을 함께 걸어야 한다
                (`data-[state=correct]:data-[cheer=true]:` 는 Tailwind 문법이 아니므로
                `group` 없이 두 변형을 이어 쓴다 — 아래처럼 순서대로 붙이면 둘 다 참일 때만 적용된다).
                흑백 별이 뛰면 아직 못 맞힌 것도 축하하는 셈이 된다.
              */
              className="h-[52px] w-[52px] object-contain transition-all duration-300 ease-bounce data-[cheer=true]:data-[state=correct]:animate-star-jump data-[cheer=true]:data-[state=correct]:[animation-iteration-count:infinite] data-[state=idle]:opacity-40 data-[state=idle]:grayscale data-[state=now]:scale-110 data-[state=now]:grayscale data-[state=wrong]:opacity-70 data-[state=wrong]:grayscale max-[640px]:h-[38px] max-[640px]:w-[38px]"
            />
          ))}
          {/*
            `2 / 5 문제` 글자는 없앴다 — 선생님 요청.

            별 다섯 개가 이미 전체 개수(별 수)와 지금 어디까지 왔는지(색·크기)를 말한다.
            같은 것을 숫자로 한 번 더 적으면 눈이 두 번 확인하게 되고, 별을 키울 자리도 숫자가
            먹고 있었다. 세는 값은 스크린리더용 `aria-label` 로만 남긴다.
          */}
        </div>
      </div>

      {/*
        문제 카드 바탕은 **종이 그림**(`paper_bg`)이다. 방송 슬라이드가 쓰는 공책(`cam_bg`)을
        쓰다가 바꿨다 — 그쪽은 가로로 아주 긴 그림(방송 화면 비율)이라 세로로 긴 문제 카드에
        늘리면 스프링 구멍과 줄이 늘어져 보였다. `paper_bg` 는 문제지 자체를 그린 것이다.

        **그림 뒤에 네모 카드를 깔지 않는다**(예전 `bg-paper` + `shadow-card-lg`). 종이 그림이
        모양·그림자를 이미 갖고 있어서, 뒤에 사각형을 한 겹 더 두면 배경(잔디·하늘) 위에
        **네모 판이 떠 있는 것처럼** 보였다.

        `bg-[length:100%_100%]` — 종이 그림을 **문제에 맞춰 늘린다.** `cover` 로 두면 문항 길이에
        따라 그림이 잘리는 위치가 달라져 종이 테두리가 흔들린다.

        ── 높이 규칙 ────────────────────────────────────────────────────────
        바깥 칸(`min-h-0 flex-1`)이 남는 높이를 잡고, 종이는 그 안에서 **최소 전체 높이**를
        쓴다(`min-h-full`). 그래서
         - 짧은 문제  → 종이가 화면을 꽉 채운다(빈 화면에 종이가 쪼그라들지 않는다)
         - 긴 문제    → 종이가 더 길어지고 **이 칸만** 스크롤한다(바깥 틀은 그대로)
        문항을 넘길 때 바깥 크기가 변하지 않으므로 화면이 들썩이지 않는다.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {/*
        다 풀면 **같은 자리에 완료 장이 나온다.** 모달로 덮지 않는 이유는 QuizDone 주석에 있다.
        종이 그림(`paper_bg`)을 함께 쓰므로 문제 → 완료가 한 권의 다음 장으로 이어진다.
      */}
      {quiz.celebrateOpen ? (
        <div
          /*
            여백이 **좌우 같다**(문제 종이는 왼쪽 100 · 오른쪽 48 로 어긋나 있다). 문제지에서는
            그 어긋남이 발문 자리를 맞추는 값이지만, 완료 장은 그림·단추를 종이 **가운데**에
            세우는 장이라 그대로 쓰면 모든 것이 26px 오른쪽으로 밀린다.
          */
          className="relative mx-auto min-h-full max-w-[780px] bg-[url('/assets/paper_bg.webp')] bg-[length:100%_100%] bg-no-repeat p-[48px_56px_34px] max-[640px]:p-[32px_24px_24px]"
        >
          <QuizDone onClose={quiz.closeCelebrate} />
        </div>
      ) : (
      <>
      {/*
        여백은 **왼쪽 100px · 오른쪽 48px** 로 좌우가 다르다.

        처음엔 좌우가 같았고(46px), 발문만 따로 들여써서 오른쪽으로 밀었다. 그러면 발문은
        제자리를 찾았지만 **아래 보기·버튼의 왼쪽 선이 발문과 어긋났다.** 왼쪽 여백을 발문 자리
        (48 + 52)까지 늘리면 종이 안의 모든 것이 한 선에서 시작하고, 오른쪽 끝은 그대로여서
        보기·버튼의 **폭만 52px 줄어든다** — "발문에 맞춰 폭만 조금 줄인다" 가 이것이다.
      */}
      <div className="relative mx-auto min-h-full max-w-[780px] bg-[url('/assets/paper_bg.webp')] bg-[length:100%_100%] bg-no-repeat p-[48px_48px_34px_100px] max-[640px]:p-[32px_20px_24px_34px]">
        {/*
          과목 마스코트 — 공책 **오른쪽 바깥**에 세운다(`left-full`). 시안에서 새싹이 공책 옆에
          서서 같이 문제를 보는 자리다.

          그림은 과제의 과목으로 고른다(`MASCOT`) — 지금은 국어뿐이지만 과목이 늘면 따라 바뀐다.
          `pointer-events-none` — 장식이라 보기 클릭을 가로채면 안 된다.
          좁은 화면(≤1240px)에서는 옆에 설 자리가 없어 접는다: 공책 폭(780px)에 마스코트까지
          들어가려면 좌우 여백이 그만큼 필요하고, 없으면 바깥 판(`overflow-hidden`)에 잘린다.
        */}
        <img
          src={MASCOT[subject]}
          alt=""
          aria-hidden="true"
          /* 과목 그림 5장 모두 424x386 (lib/subject.ts) — 받기 전에도 자리를 잡아 둔다 */
          width={424}
          height={386}
          decoding="async"
          /* 마스코트는 **고정**이다 — 축하하며 뛰는 것은 위 진행도 별이 맡는다(선생님 요청) */
          /*
            바닥에서 띄운다(`bottom-[18%]`). `bottom-0` 이었을 때는 마스코트가 배경의 **잔디와
            겹쳐** 초록 위에 초록이 되어 캐릭터 윤곽이 뭉개졌다. 종이 중간 높이로 올리면 하늘색
            배경을 등지므로 초록 몸이 또렷하다.
          */
          className="pointer-events-none absolute bottom-[18%] left-full ml-3 w-[clamp(130px,13vw,190px)] object-contain max-[1240px]:hidden"
        />

      {/*
        배지와 발문을 한 상자로 묶어 둔다 — 들여쓰기는 위 종이의 왼쪽 여백이 갖는다(둘만 밀면
        아래 보기·버튼의 왼쪽 선이 어긋났다). 이 상자는 둘을 한 덩어리로 읽히게 하는 역할만 한다.
      */}
      <div>
        <span className="mb-4 inline-block rounded-full bg-sky p-[8px_18px] text-[.88rem] font-black text-primary">
          문제 {quiz.qIndex + 1}
        </span>
        {/*
          발문 + 읽어주기. 받아쓰기는 아래에 큰 '문장 듣기' 버튼이 따로 있으므로 여기엔 두지
          않는다 — 두 버튼이 나란히 있으면 어느 쪽이 받아쓸 문장인지 헷갈린다.
          아직 글을 더듬더듬 읽는 저학년이 문제를 소리로 확인할 수 있게 하는 것이 목적이다.

          발문과 읽어주기 단추 사이는 8px — 단추가 문장에 딸린 것으로 읽히게.
        */}
        <div className="flex items-start gap-2">
          {/*
            발문은 배지와 **거의 같은 선**이다 — 4px 만 들여쓴다.

            20px → 8px → 4px 로 줄여 왔다. 배지와 발문은 같은 문제의 딱지와 문장이라 왼쪽 선이
            어긋나면 둘이 따로 떠 보인다. 4px 은 층을 만들려는 것이 아니라 글자 왼쪽 여백을
            시각적으로 배지 알약의 곡면과 맞추는 정도다.
          */}
          <h2 className="min-w-0 flex-1 pl-1 text-[1.55rem] font-black leading-[1.45] tracking-[-.3px] max-[640px]:pl-0 max-[640px]:text-[1.25rem]">
            {q.text}
          </h2>
          {q.kind !== 'dictation' && (
            <button
              type="button"
              onClick={() => void audio.play(q.no, q.speakText)}
              disabled={listening}
              aria-label={
                listening
                  ? '문제를 읽어주는 중이에요'
                  : q.kind === 'choice'
                    ? '문제와 보기 읽어주기'
                    : '문제 읽어주기'
              }
              title={listening ? '읽는 중이에요' : '문제 읽어주기'}
              /*
                **원 안에 아이콘만.** 글자(`문제 읽어주기`)는 뺐다 — 발문과 나란히 서서 무엇이
                문제 문장인지 헷갈리게 했다. 하지만 **원은 남긴다**: 원이 없으면 그림이 종이에
                그려진 장식처럼 보여 누를 수 있다는 것이 드러나지 않는다.

                원은 흰색이다. 원래 하늘색(`bg-sky`)이었는데 종이색과 부딪혔다 — 흰 원은 어느
                종이색 위에서도 뜨고, 성격은 아이콘 색(보라)이 말한다.

                **테두리는 또렷한 색(`sky-deep`) 2px 이다.** `track`(#ececec)은 크림색 종이 위에서
                거의 보이지 않아 흰 원이 종이에 스며들었다 — 눌리는 것에는 윤곽이 있어야 한다.

                글자를 지운 대신 `aria-label`·`title` 을 남긴다: 눈으로 보는 사람에게는 그림이,
                스크린리더·마우스를 올린 사람에게는 말이 알려 준다.
              */
              className="grid h-11 w-11 flex-none place-items-center rounded-full border-2 border-sky-deep bg-white text-primary shadow-card transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:scale-105 active:scale-100 disabled:opacity-60"
            >
              <Icon name={listening ? 'clock' : 'volume'} className="h-[22px] w-[22px]" />
            </button>
          )}
        </div>
        {q.kind !== 'dictation' && audio.error && (
          <p role="alert" className="mt-2 text-[.85rem] font-bold text-danger">
            {audio.error}
          </p>
        )}
      </div>
      {/* 들여쓰기 상자는 여기서 닫는다 — 아래 지문·보기·버튼은 종이 폭을 그대로 쓴다 */}

        {q.passage && <Passage text={q.passage} />}

        {q.kind === 'dictation' ? (
          <div className="mt-7">
            {/*
              받아쓰기는 "듣기"가 문제 자체다. 정답 문장은 화면에 절대 적지 않고 소리로만 준다.
            */}
            <button
              type="button"
              onClick={() => void audio.play(q.no, q.speakText)}
              disabled={listening}
              className="mx-auto flex min-h-[72px] w-full max-w-[420px] items-center justify-center gap-3 rounded-[22px] bg-primary p-[18px_24px] text-[1.1rem] font-black text-white shadow-card transition-transform duration-200 ease-bounce hover:-translate-y-1 active:scale-105 disabled:opacity-70"
            >
              {/* 위 '문제 읽어주기' 와 **같은 스피커 아이콘** — 둘 다 소리를 내는 단추다 */}
              <Icon name={listening ? 'clock' : 'volume'} className="h-6 w-6" />
              {listening ? '소리를 준비하고 있어요…' : '문장 듣기'}
            </button>
            {audio.error && (
              <p role="alert" className="mt-3 text-center text-[.9rem] font-bold text-danger">
                {audio.error}
              </p>
            )}

            <label htmlFor="dictationInput" className="mt-6 mb-2 block text-[1rem] font-black">
              들은 문장을 그대로 써 보세요
            </label>
            <input
              id="dictationInput"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') quiz.submitDictation(typed)
              }}
              disabled={quiz.locked}
              autoComplete="off"
              placeholder="여기에 적어요"
              className="w-full rounded-2xl border-[2.5px] border-canvas bg-canvas p-[16px_18px] text-[1.05rem] font-bold text-ink transition-colors focus:border-primary focus:outline-none disabled:opacity-70"
            />
            {/* '다음 문제' 와 같은 자리(오른쪽) — 같은 `mx-auto` 문제가 여기에도 있었다 */}
            {!quiz.locked && (
              <div className="mt-4 flex justify-end">
                <Button
                  variant="primary"
                  size="lg"
                  disabled={!typed.trim()}
                  onClick={() => quiz.submitDictation(typed)}
                  className="px-[46px] text-[1.05rem]"
                >
                  확인하기
                </Button>
              </div>
            )}
          </div>
        ) : q.kind === 'ox' ? (
          /*
            OX 는 보기 목록이 아니라 큰 O·X 두 개다. 백엔드가 `choices: ["O","X"]` 로 주므로
            보기 문자열을 그대로 쓰고, 판정은 선택형과 같은 인덱스 비교다(answer 0=O, 1=X).
            저학년이 누르기 쉽게 정사각형에 가깝게 크게 둔다.
          */
          <div className="mt-7 grid grid-cols-2 gap-4 max-[640px]:gap-3">
            {q.answers.map((ans, i) => {
              const state = quiz.answerStates[i] ?? 'idle'
              const disabled = quiz.locked || state === 'tried'
              const isO = ans.trim().toUpperCase() === 'O'
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  data-state={state}
                  aria-label={isO ? '맞아요' : '틀려요'}
                  onClick={() => quiz.pickAnswer(i)}
                  className="group flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-[24px] border-[3px] border-canvas bg-white transition-transform duration-200 ease-bounce hover:-translate-y-1 hover:border-primary active:scale-[1.03] disabled:cursor-default data-[state=correct]:border-success-deep data-[state=correct]:bg-success data-[state=tried]:border-[#F2C4BD] data-[state=tried]:bg-danger-soft data-[state=tried]:opacity-60 data-[state=wrong]:animate-shake data-[state=wrong]:border-danger data-[state=wrong]:bg-danger-soft max-[640px]:min-h-[116px]"
                >
                  {/* 글리프만으로 알리지 않고 아래에 말로 한 번 더 적는다 */}
                  <span
                    data-o={isO}
                    className="text-[3.4rem] font-black leading-none data-[o=false]:text-danger data-[o=true]:text-primary max-[640px]:text-[2.6rem]"
                    aria-hidden="true"
                  >
                    {isO ? 'O' : 'X'}
                  </span>
                  <span className="text-[1rem] font-extrabold text-ink-soft">
                    {isO ? '맞아요' : '틀려요'}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="mt-7 grid grid-cols-2 gap-3.5 max-[640px]:grid-cols-1">
            {q.answers.map((ans, i) => {
              const state = quiz.answerStates[i] ?? 'idle'
              const disabled = quiz.locked || state === 'tried'
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  data-state={state}
                  onClick={() => quiz.pickAnswer(i)}
                  className="group flex min-h-[72px] items-center gap-3.5 rounded-[18px] border-[2.5px] border-canvas bg-white p-[18px_20px] text-left text-[1.02rem] font-bold transition-transform duration-200 ease-bounce hover:-translate-y-1 hover:border-primary active:scale-[1.03] disabled:cursor-default data-[state=correct]:border-success-deep data-[state=correct]:bg-success data-[state=tried]:border-[#F2C4BD] data-[state=tried]:bg-danger-soft data-[state=tried]:opacity-60 data-[state=wrong]:animate-shake data-[state=wrong]:border-danger data-[state=wrong]:bg-danger-soft"
                >
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-sky text-[.92rem] font-black text-primary transition-transform duration-200 ease-bounce group-hover:scale-110 group-data-[state=correct]:bg-success-deep group-data-[state=correct]:text-white group-data-[state=tried]:bg-[#F2C4BD] group-data-[state=tried]:text-white group-data-[state=wrong]:bg-danger group-data-[state=wrong]:text-white">
                    {answerKey(i)}
                  </span>
                  <span>{ans}</span>
                </button>
              )
            })}
          </div>
        )}

        <p
          role="status"
          aria-live="polite"
          data-kind={quiz.feedback?.kind ?? 'none'}
          /*
            위 여백을 22 → 8px 로 줄였다. 종이 위쪽 패딩을 24 → 48px 로 늘려 문제 요소들을
            아래로 내렸는데, 그러면 그 아래 `다음 문제` 버튼까지 함께 내려간다 — 버튼 자리는
            이미 맞았으므로(선생님 확인) 사이 여백을 그만큼 덜어 버튼을 제자리에 남긴다.
          */
          className="mt-2 min-h-[34px] text-center text-[1.15rem] font-black data-[kind=bad]:animate-status-pop data-[kind=good]:animate-status-pop data-[kind=bad]:text-danger data-[kind=good]:text-success-deep"
        >
          {quiz.feedback?.text ?? ''}
        </p>

        {/*
          '다음 문제' 는 **오른쪽**이다 — 앞으로 나아가는 동작이라 읽는 방향의 끝에 둔다.

          `flex justify-end` 로 감싼다. 예전엔 버튼에 `mx-auto` 만 줬는데 `Button` 이
          `inline-flex`(인라인 레벨)라 **좌우 auto 마진이 아무 일도 하지 않았다** — 가운데로
          보낼 의도였는데 실제로는 왼쪽에 붙어 있었다. 정렬은 부모가 하게 맡긴다.
        */}
        {quiz.showNext && (
          /* 위 피드백 줄과 함께 여백을 덜어, 문제 요소들이 내려가도 이 버튼은 제자리에 남는다 */
          <div className="mt-1.5 flex justify-end">
            <Button
              variant="primary"
              size="lg"
              onClick={quiz.next}
              // ref .next-btn 은 1.05rem / 16px 46px — size="lg"(1.02rem, 42px) 위에 덮어쓴다
              className="animate-status-pop px-[46px] text-[1.05rem]"
            >
              다음 문제
            </Button>
          </div>
        )}
      </div>
      </>
      )}
      </div>
    </motion.section>
  )
}
