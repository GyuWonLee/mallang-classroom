import { useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { Input } from '@/components/common/Input'
import { cn } from '@/lib/cn'
import type { AssignmentProblem, AssignmentType } from '@/types/assignment'

/**
 * 문항 검수 목록 — 만들 때(마법사 step2)와 저장된 초안(과제 상세 모달)이 **같은 컴포넌트**를 쓴다.
 *
 * 두 화면의 검수 규칙이 갈리면 안 되기 때문이다: 한쪽에서 지운 기준과 다른 쪽 기준이 다르면
 * 선생님은 같은 과제를 보는데 다른 말을 듣는다.
 *
 * `onChange` 를 주면 편집·삭제가 열리고, 주지 않으면 읽기 전용이다(공개된 과제).
 */

/** OX 문항인가 — 백엔드가 OX 를 `choices: ["O","X"]` 로 만든다 (lib/quiz 의 isOxChoices 와 같은 규칙) */
function isOx(type: AssignmentType, choices: string[] | null): boolean {
  if (type === 'OX') return true
  if (!choices || choices.length !== 2) return false
  const [a, b] = choices.map((c) => c.trim().toUpperCase())
  return (a === 'O' && b === 'X') || (a === 'X' && b === 'O')
}

/**
 * 검증 경고 — `verified === false` 인 문항에만.
 *
 * `undefined` 는 "검증을 못 했다"는 뜻이라 경고하지 않는다(AI 키가 없거나 판정이 실패하면
 * 서버가 플래그를 아예 안 붙인다). 판정은 서버가 하고 화면은 그리기만 한다.
 */
function VerifyWarning({ note }: { note?: string | null }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-danger-soft p-[7px_10px] text-[.78rem] font-black text-danger">
      <Icon name="alert" className="mt-px h-4 w-4 flex-none" />
      <span>
        학생이 이 문제만 보고 풀기 어려워요
        {note ? <span className="font-bold"> — {note}</span> : null}
      </span>
    </p>
  )
}

const ROW_BTN =
  'grid h-8 w-8 flex-none place-items-center rounded-full transition-transform hover:scale-110 disabled:opacity-40'

/**
 * 새 문항의 빈 껍데기 — 유형에 맞는 칸만 만들어 둔다.
 *
 * 백엔드는 이 모양을 그대로 저장한다(문항 스키마 검증이 없다). 그래서 유형별 규칙을
 * **여기서** 지켜야 한다:
 *  - 선택형 : `choices` 2개 이상 + `answer` 는 그 안의 인덱스, `answerText` 는 null
 *  - OX     : `choices` 는 반드시 `["O","X"]`, `answer` 0=맞아요 / 1=틀려요
 *  - 받아쓰기 : `prompt` 가 읽어 줄 문장, `answerText` 가 정답, choices·answer 는 null
 *
 * `conceptTags` 는 **비워 둔다.** 태그는 학급 히트맵·오답 클리닉의 축이고 서버가 학년별 고정
 * 사전에서만 고르게 하므로, 손으로 지어 넣으면 분석 축이 조용히 어긋난다. 비어 있으면 그
 * 문항이 집계에서 빠질 뿐이라 틀린 값이 섞이는 것보다 낫다.
 *
 * `sourceRef` 는 넣지 않는다 — 자료에서 따온 근거가 없는 문항이라 있는 척하면 안 된다.
 * `verified` 도 붙이지 않는다: 검증은 서버만 할 수 있어 "미검증"이 사실이다.
 */
function blankProblem(type: AssignmentType, no: number): AssignmentProblem {
  const base = { no, level: 1, conceptTags: [] as string[] }
  if (type === 'DICTATION') {
    return { ...base, prompt: '', choices: null, answer: null, answerText: '' }
  }
  if (type === 'OX') {
    return { ...base, prompt: '', choices: ['O', 'X'], answer: 0, answerText: null }
  }
  return { ...base, prompt: '', choices: ['', '', '', ''], answer: 0, answerText: null }
}

/**
 * 한 문항 편집 — **그 줄에서 바로 고친다**(별도 모달을 띄우지 않는다).
 *
 * 고칠 수 있는 것은 발문과 정답뿐이다. `conceptTags`·`level` 은 건드리지 않는다 —
 * 태그는 학급 히트맵과 오답 클리닉의 축이고 서버가 **학년별 고정 사전**에서만 고르게 하므로,
 * 자유 입력으로 열면 분석 축이 조용히 망가진다.
 */
function ProblemEditor({
  problem,
  type,
  onSave,
  onCancel,
}: {
  problem: AssignmentProblem
  type: AssignmentType
  onSave: (next: AssignmentProblem) => void
  onCancel: () => void
}) {
  const dictation = type === 'DICTATION'
  const ox = isOx(type, problem.choices)

  const [prompt, setPrompt] = useState(problem.prompt)
  const [choices, setChoices] = useState<string[]>(problem.choices ?? [])
  const [answer, setAnswer] = useState<number | null>(problem.answer)
  const [answerText, setAnswerText] = useState(problem.answerText ?? '')

  /** 저장해도 되는가 — 서버가 받아 주는 모양인지 여기서 막는다 */
  const valid = dictation
    ? prompt.trim() !== '' && answerText.trim() !== ''
    : prompt.trim() !== '' &&
      choices.length >= 2 &&
      choices.every((c) => c.trim() !== '') &&
      answer !== null &&
      answer >= 0 &&
      answer < choices.length

  function save() {
    if (!valid) return
    /*
      **검증 플래그를 떼고 저장한다.** `verified` 는 고치기 전 문장에 대한 판정이라, 발문이나
      정답을 바꾼 뒤에도 남겨 두면 거짓말이 된다(false 였는데 잘 고쳤어도 계속 빨갛고,
      true 였는데 이상하게 고쳐도 통과로 보인다). 다시 판정하는 것은 서버만 할 수 있으므로
      "미검증"(플래그 없음)으로 되돌린다 — 그게 지금 아는 사실 그대로다.
    */
    const { verified: _v, verifyNote: _n, ...rest } = problem
    void _v
    void _n
    onSave(
      dictation
        ? { ...rest, prompt: prompt.trim(), answerText: answerText.trim(), choices: null, answer: null }
        : { ...rest, prompt: prompt.trim(), choices: choices.map((c) => c.trim()), answer, answerText: null },
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <label className="block">
        <span className="mb-1 block text-[.78rem] font-black text-ink-soft">
          {dictation ? '읽어 줄 문장' : '발문'}
        </span>
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="p-[10px_12px] text-[.88rem]"
        />
      </label>

      {dictation ? (
        <label className="block">
          <span className="mb-1 block text-[.78rem] font-black text-ink-soft">정답 문장</span>
          <Input
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            className="p-[10px_12px] text-[.88rem]"
          />
        </label>
      ) : (
        <div>
          <span className="mb-1 block text-[.78rem] font-black text-ink-soft">
            보기 — 동그라미가 정답이에요
          </span>
          <div className="flex flex-col gap-1.5">
            {choices.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`answer-${problem.no}`}
                  checked={answer === i}
                  onChange={() => setAnswer(i)}
                  aria-label={`${i + 1}번째 보기를 정답으로`}
                  className="h-4 w-4 flex-none accent-primary"
                />
                {/*
                  OX 는 보기 글자를 고치지 못한다 — 백엔드·학생 화면이 `["O","X"]` 를 전제하고
                  (answer 0=O, 1=X) 글자를 바꾸면 학생 화면의 O/X 판별이 깨진다.
                */}
                {ox ? (
                  <span className="text-[.88rem] font-bold">
                    {c.trim().toUpperCase() === 'O' ? 'O (맞아요)' : 'X (틀려요)'}
                  </span>
                ) : (
                  <Input
                    value={c}
                    onChange={(e) =>
                      setChoices((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    className="min-w-0 flex-1 p-[8px_12px] text-[.88rem]"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full bg-canvas px-3 py-1.5 text-[.8rem] font-black text-ink-soft"
        >
          취소
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!valid}
          className="rounded-full bg-primary px-3 py-1.5 text-[.8rem] font-black text-white disabled:opacity-40"
        >
          저장
        </button>
      </div>
    </div>
  )
}

export function ProblemReviewList({
  problems,
  type,
  onChange,
  listClassName = 'max-h-72',
}: {
  problems: AssignmentProblem[]
  type: AssignmentType
  /** 주면 편집·삭제가 열린다. 없으면 읽기 전용 (공개된 과제는 서버가 409 로 막는다) */
  onChange?: (next: AssignmentProblem[]) => void
  listClassName?: string
}) {
  /** 지금 고치는 중인 문항 번호 (한 번에 하나) */
  const [editing, setEditing] = useState<number | null>(null)
  /**
   * 방금 '문제 추가'로 만든 문항 번호.
   *
   * 새 문항은 발문이 비어 있어 저장할 수 없다. 취소하면 **빈 문항을 남기지 말고 지워야** 한다 —
   * 안 그러면 발문 없는 문항이 목록에 남고, 그대로 저장되면 학생 화면에 빈 문제가 뜬다.
   */
  const [addedNo, setAddedNo] = useState<number | null>(null)
  const editable = onChange !== undefined
  const flagged = problems.filter((p) => p.verified === false).length

  /**
   * 문항을 빼고 **번호를 1..N 으로 다시 매긴다.**
   *
   * 재번호는 필수다: 제출 답안의 키가 문항 `no` 라서(백엔드 `GradingService` 가
   * `answers.path(String.valueOf(no))` 로 찾는다) 3번을 지운 뒤 4,5 가 그대로 남으면
   * 학생 화면의 "문제 3" 과 서버가 채점하는 3번이 어긋난다.
   */
  function remove(no: number) {
    onChange?.(problems.filter((p) => p.no !== no).map((p, i) => ({ ...p, no: i + 1 })))
    setEditing(null)
    setAddedNo(null)
  }

  function replace(no: number, next: AssignmentProblem) {
    onChange?.(problems.map((p) => (p.no === no ? { ...next, no } : p)))
    setEditing(null)
    setAddedNo(null)
  }

  /** 맨 뒤에 빈 문항을 붙이고 **바로 편집을 연다** (빈 줄만 생기고 끝나면 뭘 하라는지 모른다) */
  function add() {
    const no = problems.length + 1
    onChange?.([...problems, blankProblem(type, no)])
    setEditing(no)
    setAddedNo(no)
  }

  /** 편집 취소 — 방금 추가한 빈 문항이면 되돌리지 말고 없앤다 */
  function cancelEdit(no: number) {
    if (addedNo === no) remove(no)
    else setEditing(null)
  }

  return (
    <div className={cn('overflow-y-auto rounded-[20px] bg-canvas p-4', listClassName)}>
      <p className="text-[.9rem] font-black">
        문항 {problems.length}개{editable ? ' — 고치거나 지울 수 있어요' : ''}
      </p>
      {/* 경고가 하나라도 있으면 목록 위에서 먼저 알린다 (스크롤 안에 묻히지 않게) */}
      {flagged > 0 && (
        <p className="mt-1.5 text-[.82rem] font-bold text-danger">
          {flagged}문항은 학생이 풀기 어려워 보여요. 고치거나 지워 주세요.
        </p>
      )}

      <ol className="mt-3 flex flex-col gap-3">
        {problems.map((p) => (
          <li key={p.no} className="rounded-2xl bg-white p-3">
            {editing === p.no ? (
              <ProblemEditor
                problem={p}
                type={type}
                onSave={(next) => replace(p.no, next)}
                onCancel={() => cancelEdit(p.no)}
              />
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[.9rem] font-bold">
                    {p.no}. {p.prompt}
                  </p>
                  {editable && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(p.no)}
                        aria-label={`${p.no}번 문항 고치기`}
                        title="이 문항 고치기"
                        className={cn(ROW_BTN, 'bg-sky text-primary')}
                      >
                        <Icon name="edit" className="h-4 w-4" />
                      </button>
                      {/* 마지막 한 문항은 남긴다 — 문항이 0개인 과제는 저장해도 풀 수 없다 */}
                      <button
                        type="button"
                        onClick={() => remove(p.no)}
                        disabled={problems.length <= 1}
                        aria-label={`${p.no}번 문항 지우기`}
                        title={problems.length <= 1 ? '문항이 하나는 있어야 해요' : '이 문항 지우기'}
                        className={cn(ROW_BTN, 'bg-danger-soft text-danger')}
                      >
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>

                {p.choices && (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.choices.map((c, i) => (
                      <li
                        key={`${p.no}-${i}`}
                        data-answer={i === p.answer}
                        className="rounded-full bg-canvas px-2.5 py-1 text-[.82rem] font-semibold text-ink-soft data-[answer=true]:bg-success data-[answer=true]:text-white"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
                {p.answerText && (
                  <p className="mt-1.5 text-[.82rem] font-semibold text-ink-soft">
                    정답 <b className="font-black text-ink">{p.answerText}</b>
                  </p>
                )}
                {/*
                  근거 인용은 **선생님에게만** 보여준다 — 자료 원문과 대조하는 것이 검수의 핵심이다.
                  학생 화면에는 절대 넣지 않는다(교재 정답란이 그대로 들어 있다 — lib/quiz.ts).
                */}
                {p.sourceRef?.quote && (
                  <p className="mt-1.5 text-[.78rem] font-medium text-ink-soft">
                    근거 “{p.sourceRef.quote}”
                  </p>
                )}
                {p.verified === false && <VerifyWarning note={p.verifyNote} />}
              </>
            )}
          </li>
        ))}
      </ol>

      {/* 편집 중에는 숨긴다 — 빈 문항을 여러 개 만들어 놓고 헤매게 하지 않는다 */}
      {editable && editing === null && (
        <button
          type="button"
          onClick={add}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-track bg-white p-2.5 text-[.85rem] font-black text-ink-soft transition-colors hover:border-primary hover:text-primary"
        >
          <Icon name="plus" className="h-4 w-4" />
          문제 추가
        </button>
      )}
    </div>
  )
}
