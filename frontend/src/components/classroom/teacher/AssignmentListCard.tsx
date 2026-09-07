import { useCallback, useEffect } from 'react'
import { Icon, type IconName } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { useModalStore, useOpenModal } from '@/stores/useModalStore'
import { useToastStore } from '@/stores/useToastStore'
import { assignmentApi } from '@/services/api/assignmentApi'
import { assignmentDateLabel } from '@/lib/assignmentDate'
import type { AssignmentSummary, AssignmentType } from '@/types/assignment'

/**
 * 과제 카드 목록 — 과제 관리 화면과 라이브 수업의 빠른 도구가 함께 쓴다.
 *
 * 카드를 누르면 **상세 모달**이 뜬다(화면 이동 없음). 그래서 라이브 수업 중에도
 * 수업 화면을 떠나지 않고 과제를 확인할 수 있다.
 *
 * 목록 응답에는 `content` 가 없어 상세를 따로 받아 모달에 넘긴다.
 * 모달이 닫히면(스택이 비면) 목록을 다시 불러온다 — 모달에서 공개/삭제를 하기 때문이다.
 */

const ASSIGNMENT_TYPES: { value: AssignmentType; label: string; icon: IconName }[] = [
  { value: 'DICTATION', label: '받아쓰기', icon: 'edit' },
  { value: 'MULTIPLE_CHOICE', label: '객관식', icon: 'checklist' },
  { value: 'PARTICLE_CHOICE', label: '조사 고르기', icon: 'list' },
  { value: 'OX', label: 'OX 퀴즈', icon: 'check' },
  { value: 'QUIZ_GAME', label: '퀴즈 게임', icon: 'star' },
]

/**
 * ref `.status-pill` 에 **실제로 있는** 상태만 배정한다.
 * (제출률은 이제 서버가 주지만 상태 칩이 아니라 아래 진행바로 그린다 — S15P11A407-137)
 *
 * 예전에는 공개 전 → 진행 중 → 마감 3단계였는데 '마감'은 도달할 수 없는 상태였다:
 * 과제를 만드는 경로에 마감 입력이 없어 `dueAt` 이 항상 null 이기 때문이다.
 */
function assignStatus(a: AssignmentSummary): { label: string; cls: string } {
  if (!a.published) return { label: '공개 전', cls: 'bg-task-soft text-task-deep' }
  return { label: '진행 중', cls: 'bg-sky text-primary' }
}

export function AssignmentListCard({
  items,
  onReload,
  emptyHint = '“새 과제 만들기”로 첫 과제를 만들어 보세요.',
  emptyMinHeight = 'min-h-[320px]',
}: {
  items: AssignmentSummary[]
  /** 모달이 닫힌 뒤 목록을 다시 받아올 콜백 (공개/삭제가 모달에서 일어난다) */
  onReload: () => void
  emptyHint?: string
  emptyMinHeight?: string
}) {
  const openModal = useOpenModal()
  const showToast = useToastStore((s) => s.show)
  const modalCount = useModalStore((s) => s.stack.length)

  // 모달 스택이 비면(= 상세를 닫으면) 목록을 새로 받는다
  const reload = useCallback(onReload, [onReload])
  useEffect(() => {
    if (modalCount === 0) reload()
  }, [modalCount, reload])

  async function openDetail(assignmentId: number) {
    try {
      const assignment = await assignmentApi.getAssignment(assignmentId)
      openModal({ type: 'assignmentDetail', assignment })
    } catch {
      showToast('과제를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    /* ref .assign-list — gap 14 */
    <div className="flex flex-col gap-3.5">
      {items.length === 0 && (
        <EmptyState
          icon="book"
          title="아직 만든 과제가 없어요"
          hint={emptyHint}
          className={emptyMinHeight}
        />
      )}
      {items.map((a) => {
        const type = ASSIGNMENT_TYPES.find((t) => t.value === a.type)
        const status = assignStatus(a)
        const when = assignmentDateLabel(a)
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => void openDetail(a.id)}
            /* ref .assign-card — transition 은 transform 만이 아니라 box-shadow 도 함께 탄다 */
            className="flex flex-wrap items-center gap-4 rounded-card bg-card p-[20px_22px] text-left shadow-card transition-[transform,box-shadow] duration-200 ease-bounce hover:-translate-y-[3px] hover:shadow-card-lg"
          >
            <span
              className="grid h-[52px] w-[52px] flex-none place-items-center rounded-[18px] bg-mint-bg text-mint-deep"
              aria-hidden="true"
            >
              <Icon name={type?.icon ?? 'book'} className="h-6 w-6" />
            </span>
            <span className="min-w-[180px] flex-1">
              <span className="block text-[1.02rem] font-black">{a.title}</span>
              <span className="mt-1 inline-block rounded-full bg-mint-bg px-2.5 py-[3px] text-[.74rem] font-extrabold text-mint-deep">
                {type?.label ?? '과제'}
                {a.source === 'AI_GENERATED' ? ' · AI' : ''}
              </span>
              {when && (
                <span className="mt-1.5 block text-[.8rem] font-semibold text-ink-soft">{when}</span>
              )}

              {/*
                ref 의 제출 n/m 진행바 — 목록 응답이 집계를 주게 되면서 살아났다
                (백엔드 S15P11A407-137 §11.2 #7).

                **선생님이 부를 때만** 채워지므로 `submissionRate` 가 null 이면 그리지 않는다.
                학생 시점이거나(전부 null) 학급에 학생이 없다는(분모 0) 뜻인데, 둘 다 0% 막대로
                보여주면 사실과 다르다.
              */}
              {a.submissionRate !== null && a.submissionRate !== undefined && (
                <span className="mt-2 block max-w-[320px]">
                  <span className="mb-1 flex items-baseline justify-between text-[.76rem] font-extrabold text-ink-soft">
                    <span>
                      제출 {a.submittedCount ?? 0}/{a.totalStudents ?? 0}명
                    </span>
                    <span className="flex items-center gap-2">
                      {/* 채점된 제출이 없으면 서버가 null 을 준다 — 0점으로 바꿔 쓰지 않는다 */}
                      {a.averageScore !== null && a.averageScore !== undefined && (
                        <span className="text-ink-mute">평균 {a.averageScore}점</span>
                      )}
                      <span className="text-ink">{a.submissionRate}%</span>
                    </span>
                  </span>
                  <span className="block h-[7px] w-full overflow-hidden rounded-full bg-canvas">
                    <span
                      className="block h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${a.submissionRate}%` }}
                    />
                  </span>
                </span>
              )}
            </span>
            <span
              className={`flex-none whitespace-nowrap rounded-full px-[13px] py-1.5 text-[.76rem] font-black ${status.cls}`}
            >
              {status.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
