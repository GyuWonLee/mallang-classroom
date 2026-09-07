import { useCallback, useMemo, useRef, useState } from 'react'
import { confettiController } from '@/services/effects/confettiController'
import { assignmentApi } from '@/services/api/assignmentApi'
import { apiErrorMessage } from '@/lib/apiError'
import { normalizeDictation, type QuizItem } from '@/lib/quiz'
import type { SubmissionResult } from '@/types/assignment'
import { useClassroomStore } from '@/stores/useClassroomStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useToastStore } from '@/stores/useToastStore'

export type AnswerState = 'idle' | 'correct' | 'wrong' | 'tried'
type Feedback = { text: string; kind: 'good' | 'bad' } | null

/** 정답/오답 피드백 문구 — 문제 데이터가 아니라 화면 문구다 */
const PRAISE = ['정확해요! 대단한데요? 🎉', '딩동댕! 아주 잘했어요 ✨', '완벽해요! 계속 가볼까요? 🌟']
const ENCOURAGE = ['조금만 더 생각해볼까요? 🤔', '괜찮아요, 다시 한 번! 💪', '거의 다 왔어요! 🍀']

/** 서버로 보낼 답안 맵 — 키는 **원본 문항 번호 문자열** (lib/quiz 의 QuizItem.no) */
type AnswerMap = Record<string, number | string>

/**
 * 퀴즈 진행 Controller.
 * 문제 렌더링·정오답 판정·진행도·완료 축하 + **서버 제출**까지의 상태 기계.
 *
 * 채점이 두 겹인 이유:
 *  - 화면의 즉시 피드백(정답 폭죽/오답 흔들림)은 **로컬 판정**이다. 서버 왕복을 기다리면
 *    아이가 버튼을 누른 뒤 한참 아무 일도 안 일어난다.
 *  - 기록에 남는 점수는 **서버 채점**이다(`POST /assignments/{id}/submissions`).
 *    리포트·오답 클리닉이 전부 이 제출 기록 위에서 돈다.
 *
 * 그래서 답안은 **문항마다 처음 고른 답**만 기록한다. 마지막(=맞힐 때까지 다시 고른) 답을 보내면
 * 서버 점수가 언제나 100 점이 되어 리포트가 거짓말을 한다.
 */
export function useQuiz(questions: QuizItem[], assignmentId?: string) {
  const [qIndex, setQIndex] = useState(0)
  const [answerStates, setAnswerStates] = useState<Record<number, AnswerState>>({})
  const [locked, setLocked] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [showNext, setShowNext] = useState(false)
  const [celebrateOpen, setCelebrateOpen] = useState(false)

  /**
   * 문항별 **정답 여부** (index → true/false). 진행도 별을 색/흑백으로 가르는 값이다.
   *
   * `dots`(지나갔는지)로는 못 가른다: 선택형·OX 는 맞힐 때까지 다음으로 못 넘어가지만
   * **받아쓰기는 틀려도 정답을 알려주고 넘어간다**(submitDictation). 그래서 "지나갔다"와
   * "맞혔다"가 다르고, 별은 맞힌 것만 색이 들어와야 한다.
   *
   * 여기 없는(아직 안 푼) 문항은 `undefined` 다 — false 와 구분해야 흑백 처리가 어긋나지 않는다.
   */
  const [correctByIndex, setCorrectByIndex] = useState<Record<number, boolean>>({})

  /**
   * 누적 답안. 렌더에 쓰이지 않고 "제출 순간의 최신값"만 필요해서 ref 로 둔다
   * (state 로 두면 마지막 문항을 맞힌 그 렌더에서 아직 반영 전인 값을 보내게 된다).
   */
  const answersRef = useRef<AnswerMap>({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SubmissionResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const setView = useClassroomStore((s) => s.setView)
  const completeTask = useTaskStore((s) => s.completeTask)

  const question = questions[qIndex]
  const isLast = qIndex === questions.length - 1

  const resetQuestion = useCallback(() => {
    setAnswerStates({})
    setLocked(false)
    setFeedback(null)
    setShowNext(false)
  }, [])

  const start = useCallback(() => {
    setQIndex(0)
    answersRef.current = {}
    setResult(null)
    setSubmitError(null)
    /* 정답 기록은 **한 판 단위**다 — 문항을 넘길 때(resetQuestion)가 아니라 여기서만 비운다 */
    setCorrectByIndex({})
    resetQuestion()
  }, [resetQuestion])

  /** 이 문항에 대한 **첫** 답만 남긴다 (다시 고른 답으로 덮어쓰지 않는다) */
  const recordAnswer = useCallback((no: number, value: number | string) => {
    const key = String(no)
    if (!(key in answersRef.current)) answersRef.current[key] = value
  }, [])

  /**
   * 마지막 문항까지 끝났다 — 축하는 바로 띄우고 제출은 뒤에서 보낸다.
   * 제출이 실패하면 조용히 넘어가지 않고 사유를 알린다(기록이 안 남았는데 완료로 보이면 안 된다).
   */
  const finish = useCallback(async () => {
    setCelebrateOpen(true)
    /*
      폭죽은 **완료 장(QuizDone)이 켜고 끈다.** 여기서 `rain()` 을 한 번 부르던 것을 옮겼다 —
      한 차례는 2초면 그쳐서, 아이가 화면을 보는 사이에 이미 끝나 있었다.
    */

    if (!assignmentId) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await assignmentApi.submit(Number(assignmentId), { answers: answersRef.current })
      setResult(res)
    } catch (error) {
      const message = apiErrorMessage(error, '답안을 보내지 못했어요. 잠시 뒤에 다시 해볼까요?')
      setSubmitError(message)
      useToastStore.getState().show(message)
    } finally {
      setSubmitting(false)
    }
  }, [assignmentId])

  /**
   * 선택형 — 보기 하나 고르기. **O/X 도 여기로 온다.**
   *
   * 예전 가드는 `question?.kind !== 'choice'` 였다. O/X 문항은 `lib/quiz.ts` 가
   * `kind: 'ox'` 로 만들고 QuizView 도 전용 O/X 버튼을 그리는데, 그 버튼이 부르는 건
   * 이 함수라서 **클릭이 통째로 무시됐다** — 색도 안 바뀌고 피드백도, '다음 문제' 버튼도
   * 안 떠서 아이가 문제를 넘길 수 없었다. 에러도 안 나서 조용히 막혀 있었다.
   * (역설적으로 O/X 판별이 실패해 'choice' 로 떨어졌다면 동작했다. 그래서 O/X 에서만 났다.)
   *
   * 판정은 O/X 도 선택형과 같다 — 고른 보기 인덱스를 `correct` 와 비교한다.
   * 받아쓰기만 입력 방식이 달라 `submitDictation` 이 따로 맡는다.
   */
  const pickAnswer = useCallback(
    (i: number) => {
      const kind = question?.kind
      if (locked || answerStates[i] === 'tried') return
      if (kind !== 'choice' && kind !== 'ox') return
      if (!question) return
      recordAnswer(question.no, i)

      if (i === question.correct) {
        setAnswerStates((s) => ({ ...s, [i]: 'correct' }))
        setCorrectByIndex((s) => ({ ...s, [qIndex]: true }))
        setLocked(true)
        setFeedback({ text: PRAISE[qIndex % PRAISE.length], kind: 'good' })
        confettiController.burst(100)
        if (isLast) {
          setTimeout(() => void finish(), 900)
        } else {
          setShowNext(true)
        }
      } else {
        setAnswerStates((s) => ({ ...s, [i]: 'wrong' }))
        setFeedback({ text: ENCOURAGE[Math.floor(Math.random() * ENCOURAGE.length)], kind: 'bad' })
        setTimeout(() => setAnswerStates((s) => ({ ...s, [i]: 'tried' })), 600)
      }
    },
    [answerStates, finish, isLast, locked, qIndex, question, recordAnswer],
  )

  /**
   * 받아쓰기 — 들은 문장을 적어서 확인하기.
   * 로컬 판정 규칙은 백엔드와 같다(공백·문장부호 무시) — 화면과 서버 점수가 어긋나지 않게.
   */
  const submitDictation = useCallback(
    (text: string) => {
      if (locked || question?.kind !== 'dictation') return
      const typed = text.trim()
      if (!typed) return
      recordAnswer(question.no, typed)

      const ok =
        normalizeDictation(question.answerText ?? '') !== '' &&
        normalizeDictation(question.answerText ?? '') === normalizeDictation(typed)

      if (ok) {
        setCorrectByIndex((s) => ({ ...s, [qIndex]: true }))
        setLocked(true)
        setFeedback({ text: PRAISE[qIndex % PRAISE.length], kind: 'good' })
        confettiController.burst(100)
        if (isLast) setTimeout(() => void finish(), 900)
        else setShowNext(true)
      } else {
        // 정답을 알려주고 넘어간다 — 받아쓰기는 계속 다시 쓰게 하면 아이가 지친다
        setCorrectByIndex((s) => ({ ...s, [qIndex]: false }))
        setLocked(true)
        setFeedback({ text: `아쉬워요! 정답은 "${question.answerText}" 예요`, kind: 'bad' })
        if (isLast) setTimeout(() => void finish(), 1400)
        else setShowNext(true)
      }
    },
    [finish, isLast, locked, qIndex, question, recordAnswer],
  )

  const next = useCallback(() => {
    setQIndex((i) => i + 1)
    resetQuestion()
  }, [resetQuestion])

  /**
   * 완료 장(QuizDone)의 "교실로 돌아가기".
   * 완료 표시는 **서버가 제출을 받아준 경우에만** 한다 — 제출이 실패했는데 완료로 칠하면
   * 새로고침 때 되살아나 아이가 두 번 속는다.
   */
  const closeCelebrate = useCallback(() => {
    setCelebrateOpen(false)
    const saved = !assignmentId || result !== null
    // 제출 응답의 점수를 함께 넘겨 과제 줄에 바로 점수 배지가 뜨게 한다
    if (assignmentId && saved) completeTask(assignmentId, result?.score ?? null)
    setView('classroom')
    // 완료 장을 떠난 뒤에도 무엇을 얻었는지 남겨준다 (ref 와 동일)
    /*
      예전엔 "+30 XP를 받았어요!" 였는데, 그 XP 는 서버에 저장되지 않아 새로고침하면 사라졌다
      (칭찬 점수 막대·식물과 함께 화면에서 뺐다). 지금은 **서버가 실제로 채점한 결과**만 말한다.
    */
    const score = result ? `${result.correctCount}/${result.totalCount} 정답이에요!` : '다 풀었어요!'
    useToastStore.getState().show(saved ? score : submitError ?? '답안을 보내지 못했어요.')
  }, [assignmentId, completeTask, result, setView, submitError])

  /**
   * 진행도 별 상태 — 문항 하나당 하나.
   *
   *  - `correct` 맞혔다 → 화면에서 **색 있는 별**
   *  - `wrong`   틀린 채 넘어갔다(받아쓰기) → 흑백 별
   *  - `now`     지금 풀고 있다 → 흑백이지만 살짝 크게(여기가 몇 번째인지 표시)
   *  - `idle`    아직 안 왔다 → 흑백 + 옅게
   *
   * 예전 `dots`(ok/now/idle)를 대신한다. `ok` 는 "지나갔다" 였는데, 받아쓰기는 틀려도 넘어가므로
   * 틀린 문항까지 맞힌 것처럼 칠해졌다.
   */
  const stars = useMemo(
    () =>
      questions.map((_, i) => {
        const passed = i < qIndex || (i === qIndex && locked)
        if (passed) return correctByIndex[i] ? 'correct' : 'wrong'
        return i === qIndex ? 'now' : 'idle'
      }),
    [questions, qIndex, locked, correctByIndex],
  )

  return {
    question,
    qIndex,
    total: questions.length,
    answerStates,
    locked,
    feedback,
    showNext,
    stars,
    celebrateOpen,
    /** 서버 제출 중 */
    submitting,
    /** 서버 채점 결과 (제출 전/실패면 null) */
    result,
    /** 제출 실패 사유 (성공이면 null) */
    submitError,
    start,
    pickAnswer,
    submitDictation,
    next,
    closeCelebrate,
  }
}
