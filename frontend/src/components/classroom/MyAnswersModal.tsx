import { useEffect, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { ModalShell, MODAL_SUB } from '@/components/common/ModalShell'
import { assignmentApi } from '@/services/api/assignmentApi'
import { errorSlug } from '@/lib/apiError'
import type { MySubmissionDetail, MySubmissionItemResult } from '@/types/assignment'

/**
 * 답 하나를 사람이 읽는 문장으로.
 *
 * 선택형은 인덱스(0-based)라 그대로 보여주면 학생이 헷갈린다 — 보기 글이 있으면 **글로**,
 * 없으면 1부터 센 번호로 바꾼다. 받아쓰기는 쓴 글 그대로다.
 */
function answerText(raw: number | string | null | undefined, choices?: string[] | null): string {
  if (raw === null || raw === undefined || raw === '') return '(빈 답)'
  if (typeof raw !== 'number') return String(raw)
  const choice = choices?.[raw]
  return choice ? `${raw + 1}. ${choice}` : `${raw + 1}번`
}

/** 그 문항의 정답 — 선택형(`answer`)과 받아쓰기(`answerText`) 중 채워진 쪽을 쓴다 */
function correctAnswerOf(r: MySubmissionItemResult): string | null {
  if (r.answerText) return r.answerText
  if (r.answer === null || r.answer === undefined) return null
  return answerText(r.answer, r.choices)
}

/**
 * 내 답안 다시 보기 (학생) — GET /assignments/{id}/submissions/me (백엔드 S15P11A407-129).
 *
 * "내가 뭘 틀렸는지" 돌아보는 화면이다. 최신 시도만 온다.
 *
 * 서버는 저장된 JSON 이 깨져 있어도 점수·제출시각은 준다(히트맵과 같은 원칙 — 하나가 깨져서
 * 화면 전체가 막히지 않게). 그래서 `results` 가 비어 있을 수 있고, 그때도 점수는 보여준다.
 *
 * 문항에는 이제 **발문·보기·정답이 함께 실려 온다** — 서버가 채점 결과에 과제 content 를
 * 문항 번호로 합쳐 주기 때문이다. 과제를 따로 조회하지 않는다. 다만 content 가 깨졌으면
 * 그 칸들이 비어 오므로 **있을 때만** 그린다.
 *
 * `feedback` 은 과제 전체 AI 총평이다(학생 말투·숫자 없음). 첫 조회 때 한 번 만들어 저장되므로
 * 다시 열어도 문구가 바뀌지 않는다. 문항 결과가 없으면 null 이라 그때는 영역을 숨긴다.
 *
 * 아직 안 낸 과제는 404 다 — **에러가 아니라 "안 냈다"** 로 다룬다(빨간 토스트를 띄우지 않는다).
 */
export function MyAnswersModal({
  assignmentId,
  title,
  onClose,
}: {
  assignmentId: number
  title: string
  onClose: () => void
}) {
  const [detail, setDetail] = useState<MySubmissionDetail | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    void assignmentApi
      .mySubmission(assignmentId)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        setState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const notFound =
          errorSlug(err) === 'submission-not-found' ||
          (err as { response?: { status?: number } })?.response?.status === 404
        setState(notFound ? 'none' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [assignmentId])

  const wrong = detail?.results.filter((r) => !r.correct) ?? []

  return (
    <ModalShell
      open
      onClose={onClose}
      label={`${title} 내 답안`}
      width={460}
      title={<h2 className="text-[1.25rem] font-black">내 답안 다시 보기</h2>}
    >
      <p className={MODAL_SUB}>{title}</p>

      {state === 'loading' && <EmptyState title="불러오는 중..." className="min-h-[180px]" />}

      {state === 'none' && (
        <EmptyState
          icon="checklist"
          title="아직 이 과제를 안 냈어요"
          hint="과제를 풀고 나면 여기에서 내 답을 다시 볼 수 있어요."
          className="min-h-[180px]"
        />
      )}

      {state === 'error' && (
        <EmptyState
          icon="alert"
          title="내 답안을 불러오지 못했어요"
          hint="잠시 뒤에 다시 열어 주세요."
          className="min-h-[180px]"
        />
      )}

      {state === 'ready' && detail && (
        <>
          {/* 점수 — 채점 전(null)이면 숫자를 만들어내지 않는다 */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-task-soft p-[16px_18px]">
            <span className="text-[.9rem] font-bold text-task-deep">
              {detail.attemptNo > 1 ? `${detail.attemptNo}번째로 낸 답이에요` : '내 점수에요'}
            </span>
            <span className="text-[1.4rem] font-black text-task-deep">
              {detail.score === null ? '채점 중' : `${detail.score}점`}
            </span>
          </div>

          {detail.results.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-canvas p-[14px_16px] text-[.85rem] font-bold text-ink-mute">
              문항별 결과는 남아 있지 않아요.
              <br />
              점수만 확인할 수 있어요.
            </p>
          ) : (
            <>
              <h4 className="mb-2 mt-4 text-[.9rem] font-black text-ink-soft">
                {wrong.length === 0
                  ? '전부 맞혔어요! 정말 잘했어요 🎉'
                  : `다시 볼 문제 ${wrong.length}개`}
              </h4>
              <ul className="no-scrollbar flex max-h-[42vh] flex-col gap-2 overflow-y-auto">
                {detail.results.map((r) => {
                  /* 서버가 합쳐 준 내 답을 먼저 쓰고, 없으면 예전처럼 answers 맵에서 찾는다 */
                  const mine = r.myAnswer ?? detail.answers[String(r.no)]
                  const right = correctAnswerOf(r)
                  return (
                    <li
                      key={r.no}
                      data-correct={r.correct}
                      className="flex items-start gap-3 rounded-2xl p-[12px_14px] data-[correct=false]:bg-danger-soft data-[correct=true]:bg-canvas"
                    >
                      <span
                        data-correct={r.correct}
                        className="mt-px grid h-7 w-7 flex-none place-items-center rounded-full data-[correct=false]:bg-danger data-[correct=true]:bg-success"
                      >
                        <Icon
                          name={r.correct ? 'check' : 'close'}
                          data-correct={r.correct}
                          className="h-4 w-4 data-[correct=false]:text-white data-[correct=true]:text-success-deep"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        {/* 발문이 있으면 번호 대신 문제를 보여준다 — 번호만으로는 뭘 틀렸는지 모른다 */}
                        <span className="block break-keep text-[.9rem] font-black">
                          {r.no}번{r.prompt ? `. ${r.prompt}` : ''}
                        </span>

                        {/*
                          틀린 선택형은 **보기까지 펼친다.** 객관식은 보기가 있어야 문제가
                          완성되고, "2번을 골랐는데 정답은 1번"만으로는 무엇을 왜 틀렸는지
                          알 수 없다. 맞힌 문제는 접어 둔다 — 다 맞은 목록까지 길어지면
                          정작 "다시 볼 문제"가 묻힌다.
                        */}
                        {!r.correct && r.choices && r.choices.length > 0 ? (
                          <span className="mt-1.5 flex flex-col gap-1">
                            {r.choices.map((choice, i) => {
                              const isAnswer = r.answer === i
                              const isMine = mine === i
                              return (
                                <span
                                  key={i}
                                  data-answer={isAnswer}
                                  data-mine={isMine && !isAnswer}
                                  className="flex items-baseline gap-1.5 rounded-lg px-2 py-1 text-[.82rem] font-medium data-[answer=true]:bg-success data-[answer=true]:font-extrabold data-[answer=true]:text-success-deep data-[mine=true]:bg-white/70 data-[mine=true]:font-bold data-[mine=true]:text-danger"
                                >
                                  <span className="flex-none">{i + 1}.</span>
                                  <span className="min-w-0 flex-1 break-keep">{choice}</span>
                                  {/* 색만으로 알리지 않는다 — 글자를 함께 둔다 */}
                                  {isAnswer && <span className="flex-none text-[.72rem]">정답</span>}
                                  {isMine && !isAnswer && (
                                    <span className="flex-none text-[.72rem]">내가 고른 답</span>
                                  )}
                                </span>
                              )
                            })}
                            {/* 아무것도 안 골랐으면 위 목록에 표시될 곳이 없다 */}
                            {mine === undefined || mine === null || mine === '' ? (
                              <span className="px-2 text-[.8rem] font-bold text-ink-mute">
                                이 문제는 답을 고르지 않았어요.
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <>
                            <span className="mt-0.5 block text-[.82rem] font-medium text-ink-soft">
                              내 답: {answerText(mine, r.choices)}
                            </span>
                            {/* 맞힌 문제에까지 정답을 다시 적으면 잔소리가 된다 — 틀린 것만 */}
                            {!r.correct && right && (
                              <span className="mt-0.5 block text-[.82rem] font-bold text-success-deep">
                                정답: {right}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                      {/* conceptTags 는 null 로 올 수 있다 — 길이를 바로 읽으면 화면이 통째로 죽는다 */}
                      {r.conceptTags && r.conceptTags.length > 0 && (
                        <span className="mt-px flex-none rounded-full bg-mint-bg px-2.5 py-[3px] text-[.72rem] font-extrabold text-mint-deep">
                          {r.conceptTags[0]}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {/*
            과제 전체 AI 총평 — 학생에게 말하는 말투라 그대로 읽히면 된다.
            문항 결과가 없으면 서버가 null 을 주므로 영역째 사라진다.
          */}
          {detail.feedback && (
            <div className="mt-4 rounded-2xl border-2 border-mint bg-mint-bg p-[14px_16px]">
              <h4 className="mb-2 flex items-center gap-2 text-[.88rem] font-black text-mint-deep">
                <Icon name="aichat" className="h-[17px] w-[17px] flex-none" />
                말랑이가 남긴 이야기
              </h4>
              <p className="break-keep text-[.86rem] font-semibold leading-[1.7]">
                {detail.feedback}
              </p>
            </div>
          )}
        </>
      )}
    </ModalShell>
  )
}
