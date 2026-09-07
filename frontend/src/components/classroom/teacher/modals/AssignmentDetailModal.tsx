import { useState } from 'react'
import { Button } from '@/components/common/Button'
import { ModalShell, MODAL_SUB } from '@/components/common/ModalShell'
import { assignmentApi } from '@/services/api/assignmentApi'
import { useToastStore } from '@/stores/useToastStore'
import { confirmAction } from '@/stores/useConfirmStore'
import { assignmentDateLabel } from '@/lib/assignmentDate'
import { AssignmentSubmissionsPanel } from './AssignmentSubmissionsPanel'
import { ProblemReviewList } from '@/components/classroom/teacher/assignments/ProblemReviewList'
import { apiErrorMessage } from '@/lib/apiError'
import type { Assignment, AssignmentProblem, AssignmentType } from '@/types/assignment'

const TYPE_LABEL: Record<AssignmentType, string> = {
  DICTATION: '받아쓰기',
  MULTIPLE_CHOICE: '객관식',
  PARTICLE_CHOICE: '조사 고르기',
  OX: 'OX 퀴즈',
  QUIZ_GAME: '퀴즈 게임',
}

/**
 * 과제 상세 — 레퍼런스 teacher.html `assignDetailModal` 이관.
 *
 * 이 창의 일은 **문항을 읽고 고치는 것**이다 (과제 설정 탭의 '문항 열기'가 여기로 온다).
 * 문항 편집은 `ProblemReviewList` 가 맡고(마법사 step2 와 같은 컴포넌트 — 검수 규칙이 갈리지
 * 않게), 이 창은 그것을 어떤 크기·순서로 보여줄지만 정한다.
 *
 * 예전 배치는 읽는 것부터 막고 있었다:
 *  - 카드 폭 480px 에 발문·보기가 다 들어가 매 문항이 세 줄로 접혔다
 *  - 문항 목록만 `max-height:38vh` 로 잘라 **스크롤 안의 스크롤**이 됐다 (6문항 중 3개만 보였다)
 *  - 카드 자체는 스크롤하지 않는데 위에 제출 현황이 먼저 오니, 제출·미제출 명단이 실제로
 *    내려온 학급에서는 카드 내용이 카드 높이를 넘겨 아래가 잘렸다 (1280x720 에서 실측 600 > 552)
 *
 * 그래서 **스크롤을 카드 하나로 합치고**(ModalShell 이 모든 모달에 기본 적용), 폭을 늘리고, 문항을 맨 위로
 * 올렸다. 제출 현황은 문항 아래로 내린다 — 그쪽은 과제 관리 화면의 요약·학생별 현황 탭이
 * 더 크게 보여주고, 이 창을 여는 이유는 문항이다.
 */
export function AssignmentDetailModal({
  assignment,
  onClose,
  onSaved,
}: {
  assignment: Assignment
  onClose: () => void
  /** 문항을 저장했을 때 — 목록을 다시 읽어 문항 수 표시를 맞춘다 */
  onSaved?: () => void
}) {
  const showToast = useToastStore((s) => s.show)
  const [published, setPublished] = useState(assignment.published)
  const [busy, setBusy] = useState(false)

  /**
   * 편집 중인 문항. 서버에 저장하기 전까지는 화면에만 있다.
   *
   * `assignment.content.problems` 를 직접 고치지 않는 이유: 저장에 실패했을 때 되돌릴
   * 원본이 남아 있어야 하고, "고친 게 있는지"(`dirty`)를 그 둘을 비교해 알 수 있다.
   */
  const [problems, setProblems] = useState<AssignmentProblem[]>(assignment.content.problems)
  /**
   * 마지막으로 **서버에 저장된** 문항. `dirty` 와 '되돌리기'의 기준이다.
   *
   * `assignment.content.problems` 를 기준으로 쓰면 저장에 성공한 뒤에도 배열이 달라
   * `dirty` 가 계속 true 로 남아 저장 버튼이 사라지지 않는다.
   */
  const [saved, setSaved] = useState<AssignmentProblem[]>(assignment.content.problems)
  /** 고친 게 있는지 — 되돌리기·저장 버튼은 이때만 나온다 */
  const dirty = problems !== saved

  /**
   * 문항 저장 — `PATCH /assignments/{id}` 에 `content` 를 통째로 보낸다.
   *
   * **미공개일 때만 가능하다** (서버가 공개된 과제에 409 `assignment-content-locked`).
   * 성공하면 목록도 다시 읽어야 문항 수 같은 표시가 맞으므로 `onSaved` 로 알린다.
   */
  async function saveProblems() {
    setBusy(true)
    try {
      await assignmentApi.updateAssignment(assignment.id, { content: { problems } })
      setSaved(problems)
      showToast('문항을 저장했어요')
      onSaved?.()
    } catch (err) {
      showToast(apiErrorMessage(err, '문항을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'))
    } finally {
      setBusy(false)
    }
  }

  async function togglePublish() {
    setBusy(true)
    try {
      await assignmentApi.updateAssignment(assignment.id, { publish: !published })
      setPublished(!published)
      showToast(!published ? '학생에게 공개했어요' : '비공개로 바꿨어요')
    } catch {
      showToast('상태를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = await confirmAction({
      title: `'${assignment.title}' 과제를 삭제할까요?`,
      message: '학생들이 푼 기록도 함께 사라지고, 되돌릴 수 없어요.',
      confirmLabel: '과제 삭제',
      danger: true,
    })
    if (!ok) return
    try {
      await assignmentApi.deleteAssignment(assignment.id)
      showToast('과제를 삭제했어요')
      onClose()
    } catch {
      showToast('삭제하지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      label={`${assignment.title} 과제 상세`}
      /*
        발문 + 보기 넷이 한 줄에 들어가는 폭 — 480 에서는 문항마다 세 줄로 접혔다.
        640 은 문항을 다루는 다른 창(과제 만들기 마법사)과 같은 값이다.
      */
      width={640}
      /*
        스크롤은 **한 겹**이다 — 이제 오버레이가 스크롤한다(ModalShell 이 `scroll` 프롭을 없애고
        기본 동작으로 만들었다). 그래서 아래 문항 목록에는 높이 상한을 주지 않는다(`max-h-none`):
        상한을 주면 스크롤 안에 스크롤이 생긴다.

        카드 아래 패딩은 아래 액션 띠가 대신 갖는다(`pb-30px`). sticky 는 부모의 **콘텐츠 박스**를
        벗어나지 못해서, 카드에 아래 패딩이 남아 있으면 띠가 그만큼 위에 멈추고 그 틈으로
        지나가는 문항이 보인다.

        **`max-[640px]:pb-0` 이 반드시 필요하다.** ModalShell 카드의 좁은 화면 패딩
        (`max-[640px]:p-[24px_20px]`)은 미디어 쿼리라 그냥 `pb-0` 을 이긴다 — 이 줄이 없으면
        좁은 창에서만 아래 패딩 24px 이 되살아나고, 띠가 그만큼 위에서 멈춰 **문항이 띠 아래로
        비쳐 보였다**(실제로 겪었다).
      */
      className="pb-0 max-[640px]:pb-0"
      /*
        제목 글씨는 카드 폭과 함께 올린다 — 480px 카드의 1.3rem 을 640px 카드에 그대로 두니
        과제 이름이 창 안에서 제일 작은 제목처럼 보였다. 아래 문항 발문(.98rem)과도 층이 벌어진다.
        길면 두 줄로 접히게 두고(닫기 버튼 자리는 ModalShell 이 flex 로 지킨다) 낱말 중간에서는
        끊지 않는다.
      */
      title={
        <h2 className="break-keep text-[1.55rem] font-black leading-[1.3] tracking-[-.4px]">
          {assignment.title}
        </h2>
      }
    >
      {/* ref .assign-type-tag — 과제 유형은 민트(= AI 말랑이 계열) 배지로 통일 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-block rounded-full bg-mint-bg px-2.5 py-[3px] text-[.74rem] font-extrabold text-mint-deep">
          {TYPE_LABEL[assignment.type]}
        </span>
        {assignment.source === 'AI_GENERATED' && (
          <span className="inline-block rounded-full bg-mint-bg px-2.5 py-[3px] text-[.74rem] font-extrabold text-mint-deep">
            AI 생성
          </span>
        )}
      </div>
      {/* 마감이 아니라 **언제 학생에게 나갔는지**를 말한다 (lib/assignmentDate) */}
      <p className={`mt-2.5 ${MODAL_SUB}`}>
        {[
          assignmentDateLabel(assignment),
          `${problems.length}문항`,
          assignment.published ? '공개 중' : '비공개',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {/*
        문항 — 이 창을 여는 이유라 맨 위에 둔다.
        목록 자신이 "문항 N개 — 고치거나 지울 수 있어요"를 적으므로, 이 줄은 **상태와 저장**만
        맡는다: 왼쪽은 지금 무엇을 할 수 있는지, 오른쪽은 고친 게 있을 때만 뜨는 되돌리기·저장.
        */}
      <div className="mb-2 mt-[18px] flex flex-wrap items-center justify-between gap-2">
        {/*
          **공개된 과제는 문항을 고칠 수 없다.** 서버가 409 `assignment-content-locked` 로 막는다
          (이미 푼 학생의 답안과 어긋나기 때문). 그래서 `published` 면 아래 목록을 읽기 전용으로
          넘기고, 고치려면 먼저 비공개로 내리라고 알려 준다 — 눌리지 않는 버튼을 두는 것보다 낫다.
        */}
        <span className="text-[.78rem] font-bold text-ink-mute">
          {published
            ? '공개 중에는 문항을 고칠 수 없어요. 먼저 비공개로 바꿔 주세요.'
            : '정답은 초록으로 표시돼요. 문항을 눌러 고칠 수 있어요.'}
        </span>

        {/* 고친 게 있을 때만 — 평소엔 누를 일이 없는 버튼 두 개가 자리를 차지하지 않는다 */}
        {dirty && (
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={() => setProblems(saved)}
              className="rounded-full bg-canvas px-3 py-1.5 text-[.8rem] font-black text-ink-soft"
            >
              되돌리기
            </button>
            <button
              type="button"
              onClick={() => void saveProblems()}
              disabled={busy}
              className="rounded-full bg-primary px-3 py-1.5 text-[.8rem] font-black text-white disabled:opacity-40"
            >
              {busy ? '저장 중…' : '문항 저장'}
            </button>
          </div>
        )}
      </div>
      {/*
        `max-h-none` — 목록의 기본값은 `max-h-72` 라 창 안에 **또 스크롤**이 생긴다. 이 창은
        카드 하나만 스크롤하는 배치(위 ModalShell `scroll`)이므로 목록의 높이 상한을 푼다.
        문항이 비어 있을 때의 안내와 '문제 추가' 버튼도 이 목록이 갖고 있다.
      */}
      <ProblemReviewList
        problems={problems}
        type={assignment.type}
        onChange={published ? undefined : setProblems}
        listClassName="max-h-none"
      />

      {/*
        ref 의 "제출 현황"·"미제출 학생" 칩이 여기다. 백엔드 -127 로 실제 API 가 생겨
        (GET /assignments/{id}/submissions) 하드코딩 대신 실데이터로 채운다.
        문항 **아래**다 — 예전엔 위에 있어서, 명단이 길게 내려오면 문항이 화면 밖으로 밀렸다.
      */}
      <div className="mt-[22px] border-t-[1.5px] border-track pt-[18px]">
        <AssignmentSubmissionsPanel
          assignmentId={assignment.id}
          classroomId={assignment.classroomId}
        />
      </div>

      {/*
        ref .modal-actions — gap 10px.

        **바닥에 붙이지(sticky) 않는다.** 한때는 붙여 두었다 — 문항이 20개면 공개 버튼이
        스크롤 저 아래라 누르려고 끝까지 내려야 했기 때문이다. 하지만 늘 떠 있는 띠가 문항과
        제출 현황 위를 계속 가려서, 이 창의 본래 일(문항 읽기)을 방해했다. 지금은 내용 맨 끝에
        놓이고 스크롤해서 만난다 — 삭제·공개는 자주 누르는 버튼이 아니다.

        좌우 음수 마진 + 같은 만큼의 패딩 = 카드 패딩을 뚫고 바닥 폭을 다 쓰는 띠.
        (카드는 `pb-0` 이라 이 띠의 아래 패딩이 카드의 바닥 여백을 대신한다.)
      */}
      <div className="-mx-[34px] mt-[22px] rounded-b-[32px] flex justify-between gap-2.5 border-t-[1.5px] border-track bg-card p-[14px_34px_30px] max-[640px]:-mx-5 max-[640px]:p-[12px_20px_24px]">
        {/* ref .btn 수치 + 옅은 빨강 (파괴적 액션은 확인 대화상자를 한 번 더 거친다) */}
        <button
          type="button"
          onClick={() => void remove()}
          className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-danger-soft p-[13px_22px] text-[.92rem] font-black text-danger transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:brightness-95"
        >
          과제 삭제
        </button>
        <Button disabled={busy} onClick={() => void togglePublish()}>
          {published ? '비공개로 바꾸기' : '학생에게 공개하기'}
        </Button>
      </div>
    </ModalShell>
  )
}

