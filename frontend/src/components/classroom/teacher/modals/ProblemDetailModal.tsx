import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { ModalShell, MODAL_SUB } from '@/components/common/ModalShell'
import { EmptyState } from '@/components/common/EmptyState'
import { FillBar } from '@/components/common/FillBar'
import { ProblemReviewList } from '@/components/classroom/teacher/assignments/ProblemReviewList'
import { answerLabel, choiceIndexOf } from '@/lib/problemAnswer'
import { levelFill } from '@/lib/studentMeta'
import { BAND_LABEL, type ProblemStat } from '@/services/api/analyticsApi'
import type { Assignment } from '@/types/assignment'

/**
 * 문항 하나 — 문항 분석 탭의 '다시 짚어줄 문항' 카드를 누르면 뜬다.
 *
 * 카드에는 번호·정답률·오답만 있어서 **정작 무슨 문제였는지**를 알 수 없었다(선생님이 문항을
 * 확인하려면 '과제 설정 → 문항 열기'로 돌아가 목록에서 그 번호를 찾아야 했다).
 * 이 창은 그 한 문항의 발문·보기·정답을 통계와 나란히 놓는다.
 *
 * 문항 본문은 목록 응답에 없어서(`AssignmentSummary` 에는 content 가 없다) 부모가
 * `GET /assignments/{id}` 로 받아 온 전체 과제를 넘겨준다.
 *
 * 창 안에서 **이전·다음 문항으로 옮겨 다닌다.** 옮겨 다니는 범위는 눌러서 들어온 '다시 짚어줄
 * 문항'이 아니라 **과제의 문항 순서 전체**다 — 3번을 건너뛰고 2번에서 4번으로 가면 "다음 문제"라는
 * 말과 어긋난다. 집계도 문항마다 갈아 끼워야 해서, 하나가 아니라 문항별 집계 전부를 받는다.
 */
export function ProblemDetailModal({
  assignment,
  no,
  stats,
  onClose,
}: {
  assignment: Assignment
  /** 처음 열 문항 번호 */
  no: number
  /** 문항별 집계 — 넘겨준 것 중 지금 문항의 것만 골라 쓴다 (없으면 통계 묶음을 그리지 않는다) */
  stats?: ProblemStat[]
  onClose: () => void
}) {
  const problems = assignment.content.problems

  /* 지금 보고 있는 문항의 **자리**를 들고 있는다 — 번호가 아니라 index 다(번호가 1부터가
     아닐 수도 있고, 자리로 세면 이전·다음이 곧 index ±1 이라 계산할 것이 없다) */
  const [at, setAt] = useState(() => {
    const i = problems.findIndex((p) => p.no === no)
    return i < 0 ? 0 : i
  })

  const problem = problems[at]
  const stat = problem ? stats?.find((s) => s.no === problem.no) : undefined
  const shownNo = problem?.no ?? no

  const canPrev = at > 0
  const canNext = at < problems.length - 1

  /*
    문항을 옮기면 카드를 맨 위로 되돌린다 — 긴 문항을 내려 보다가 다음으로 넘어가면
    새 문항의 발문이 화면 위로 지나가 있고, 중간부터 읽게 된다.
  */
  const bodyRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    bodyRef.current?.closest<HTMLElement>('[role="dialog"] > div')?.scrollTo({ top: 0 })
  }, [at])

  /* 화살표 키로도 옮긴다 — 창에 입력칸이 없어서 좌우 키를 가져가도 빼앗을 것이 없다 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setAt((i) => Math.min(problems.length - 1, i + 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [problems.length])

  return (
    <ModalShell
      open
      onClose={onClose}
      label={`${shownNo}번 문항`}
      width={520}
      title={
        /*
          제목 줄 오른쪽에 ‹ 자리/전체 › — 달력의 달 넘기기와 같은 모양이다.
          닫기 버튼은 ModalShell 이 이 줄 오른쪽에 붙인다.
        */
        <div className="flex items-center gap-3">
          <h2 className="text-[1.4rem] font-black">{shownNo}번 문항</h2>
          {problems.length > 1 && (
            <div className="ml-auto flex flex-none items-center gap-1">
              <button
                type="button"
                onClick={() => setAt((i) => i - 1)}
                disabled={!canPrev}
                aria-label="이전 문항"
                className="grid h-8 w-8 place-items-center rounded-full bg-canvas text-ink-soft transition-colors enabled:hover:bg-sky enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="back" className="h-3.5 w-3.5" />
              </button>
              {/* 몇 번째인지 — tabular-nums 로 폭이 고정돼 화살표가 밀리지 않는다 */}
              <span
                aria-live="polite"
                className="min-w-[46px] text-center text-[.82rem] font-black tabular-nums text-ink-soft"
              >
                {at + 1}
                <span className="text-ink-mute"> / {problems.length}</span>
              </span>
              <button
                type="button"
                onClick={() => setAt((i) => i + 1)}
                disabled={!canNext}
                aria-label="다음 문항"
                className="grid h-8 w-8 place-items-center rounded-full bg-canvas text-ink-soft transition-colors enabled:hover:bg-sky enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="chevronRight" className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      }
    >
      <p ref={bodyRef} className={MODAL_SUB}>
        {assignment.title}
      </p>

      {!problem ? (
        /* 번호는 집계에서 왔고 본문은 과제에서 왔다 — 그 사이에 문항이 지워졌을 수 있다 */
        <EmptyState
          icon="alert"
          title="이 문항을 찾지 못했어요"
          hint="과제가 수정돼 문항이 바뀌었을 수 있어요."
          className="min-h-[160px]"
        />
      ) : (
        <>
          {/*
            문항을 그리는 모양은 `ProblemReviewList` 하나뿐이다 — '문항 열기' 창·과제 마법사와
            같은 것을 쓴다(같은 문항이 화면마다 다르게 보이지 않게).
            여기서는 **읽기 전용**이다: `onChange` 를 주지 않는다. 고치는 자리는 '문항 열기' 창이고,
            이 창은 분석 결과를 보다가 "그게 무슨 문제였나" 를 확인하는 자리다.
            `max-h-none` — 문항 하나뿐이라 목록 기본 상한(max-h-72)이 걸릴 이유가 없다.
          */}
          <ProblemReviewList
            problems={[problem]}
            type={assignment.type}
            listClassName="max-h-none"
          />

          {stat && (
            <>
              <h4 className="mb-2.5 mt-[22px] text-[.92rem] font-black text-ink-soft">
                이 문항의 결과
              </h4>
              <div className="rounded-2xl bg-canvas p-4">
                <div className="flex items-end justify-between gap-3">
                  <span className="text-[.9rem] font-bold text-ink-soft">
                    {stat.n}명 채점
                    {/* 밴드 이름은 정답률이 없을 때(표본 부족) 유일한 설명이라 늘 함께 적는다 */}
                    <span className="text-ink-mute"> · {BAND_LABEL[stat.band]}</span>
                  </span>
                  <span className="text-[1.15rem] font-black">
                    {stat.accuracy === null ? (
                      <span className="text-ink-mute">정답률 —</span>
                    ) : (
                      `정답률 ${stat.accuracy}%`
                    )}
                  </span>
                </div>
                {stat.accuracy !== null && (
                  <FillBar
                    pct={stat.accuracy}
                    className="mt-2 h-2.5"
                    fillClassName={levelFill(stat.accuracy)}
                  />
                )}

                {/*
                  보기가 있는 문항 — **보기 전부**를 늘어놓고 각 보기를 몇 명이 골랐는지 붙인다.
                  예전에는 서버가 준 오답 분포를 그대로 적어서 `2 · 5명` 같은 맨 숫자가 나왔다
                  (그 값이 0부터 세는 보기 index 다). 무슨 보기였는지 알 수 없었고, **아무도
                  고르지 않은 보기**는 아예 보이지 않아 "다른 선택지가 뭐였나"에 답하지 못했다.
                */}
                {problem.choices && problem.choices.length > 0 ? (
                  <>
                    <p className="mb-1.5 mt-3.5 text-[.82rem] font-black text-ink-soft">
                      보기별로 고른 학생
                    </p>
                    <ul className="flex flex-col gap-1">
                      {problem.choices.map((choice, i) => {
                        const picked =
                          stat.choiceDistribution.find((c) => choiceIndexOf(c.answer) === i)
                            ?.count ?? 0
                        const isAnswer = i === problem.answer
                        return (
                          <li
                            key={`${i}-${choice}`}
                            data-answer={isAnswer}
                            className="flex items-center gap-2 rounded-2xl bg-white p-[8px_12px] text-[.86rem] font-bold text-ink-soft data-[answer=true]:bg-success data-[answer=true]:text-success-deep"
                          >
                            <b className="w-4 flex-none font-black">{i + 1}</b>
                            <span className="min-w-0 flex-1 break-keep">{choice}</span>
                            {isAnswer ? (
                              <span className="inline-flex flex-none items-center gap-1 text-[.8rem] font-black">
                                <Icon name="check" className="h-3.5 w-3.5" />
                                정답
                              </span>
                            ) : (
                              /* 0명도 적는다 — 빈칸이면 "집계가 없다"로 읽힌다 */
                              <span
                                data-none={picked === 0}
                                className="flex-none text-[.82rem] font-black text-danger data-[none=true]:font-bold data-[none=true]:text-ink-mute"
                              >
                                {picked}명
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                    {/*
                      오답을 고른 학생 수의 합이 채점 인원과 다를 수 있다 — 서버는 **오답만**
                      분포에 담고, 정답을 고른 학생은 위 정답률이 말한다.
                    */}
                    <p className="mt-1.5 text-[.74rem] font-semibold text-ink-mute">
                      정답을 고른 학생 수는 위 정답률로 보여줘요.
                    </p>
                  </>
                ) : (
                  /* 받아쓰기는 보기가 없다 — 대신 학생이 **쓴 답**이 그 자리를 대신한다 */
                  <>
                    <p className="mb-1.5 mt-3.5 text-[.82rem] font-black text-ink-soft">
                      학생들이 쓴 답
                    </p>
                    {stat.choiceDistribution.length === 0 ? (
                      <p className="text-[.82rem] font-bold text-ink-mute">
                        틀린 답이 아직 없어요. 이 문항은 보기가 없어서, 학생이 직접 쓴 답만
                        모여요.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {/* 빈도순으로 와서 맨 앞이 가장 많이 쓴 오답이다 */}
                        {stat.choiceDistribution.map((c) => (
                          <li
                            key={c.answer}
                            className="flex items-center gap-2 rounded-2xl bg-white p-[8px_12px] text-[.86rem] font-bold text-ink-soft"
                          >
                            <Icon name="close" className="h-3 w-3 flex-none text-danger" />
                            <span className="min-w-0 flex-1 break-keep">
                              {answerLabel(c.answer, problem.choices)}
                            </span>
                            <b className="flex-none font-black text-ink">{c.count}명</b>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </ModalShell>
  )
}
