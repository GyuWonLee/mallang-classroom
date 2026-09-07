import { useCallback, useEffect, useState } from 'react'
import { ModalShell } from '@/components/common/ModalShell'
import { Button } from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { MaterialsCard } from '@/components/classroom/teacher/MaterialsCard'
import { AssignmentListCard } from '@/components/classroom/teacher/AssignmentListCard'
import { assignmentApi } from '@/services/api/assignmentApi'
import { useOpenModal } from '@/stores/useModalStore'
import type { AssignmentSummary } from '@/types/assignment'

/**
 * 수업 중 '학습자료 · 과제' 작업판 — 빠른 도구의 타일이 이 모달을 연다.
 *
 * 예전에는 오른쪽 패널의 아래 줄을 통째로 이 내용으로 갈아 끼웠다. 그러면 작업하는 동안
 * **학생 얼굴이 전부 사라졌고**, 돌아오는 길이 '학생 관리로' 버튼 하나뿐이라 어디에 있는지
 * 헷갈렸다. 모달이면 뒤에 무대와 학생이 그대로 남고, 닫으면 원래 자리로 정확히 돌아온다.
 *
 * 자료를 보면서 그 자리에서 과제를 만드는 흐름이라 둘을 한 창에 좌우로 둔다.
 * 과제 마법사는 **이 모달 위에** 쌓인다(모달 스택) — 만들고 닫으면 여기로 돌아온다.
 */
export function LiveWorkspaceModal({
  classroomId,
  onClose,
}: {
  classroomId: string
  onClose: () => void
}) {
  const openModal = useOpenModal()
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([])

  const load = useCallback(() => {
    if (!classroomId) return
    void assignmentApi
      .listAssignments(classroomId)
      .then(setAssignments)
      .catch(() => setAssignments([]))
  }, [classroomId])

  useEffect(load, [load])

  return (
    <ModalShell
      open
      onClose={onClose}
      label="학습자료와 과제"
      width={860}
      title={
        <div className="flex items-center gap-3.5">
          <span className="grid h-14 w-14 flex-none place-items-center rounded-2xl bg-task-soft text-[#D9A916]">
            <Icon name="book" className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[1.3rem] font-black">학습자료 · 과제</h2>
            <p className="mt-0.5 text-[.88rem] font-medium text-ink-soft">
              수업을 끊지 않고 자료를 열고 과제를 만들 수 있어요.
            </p>
          </div>
        </div>
      }
    >
      {/*
        좌우 반반. 좁은 화면(모달 폭이 줄어드는 태블릿)에서는 한 줄로 쌓는다 —
        두 칸을 억지로 유지하면 자료 이름이 잘려 무슨 파일인지 못 읽는다.
      */}
      <div className="mt-6 grid grid-cols-2 gap-3.5 max-[760px]:grid-cols-1">
        <section className="min-w-0 rounded-card-md border-[1.5px] border-track bg-canvas p-[16px_18px]">
          <MaterialsCard id={classroomId} bare listMaxHeight="max-h-[300px]" />
        </section>
        <section className="min-w-0 rounded-card-md border-[1.5px] border-track bg-canvas p-[16px_18px]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
            <span className="flex items-center gap-2 text-[1.05rem] font-black">
              <Icon name="checklist" className="h-[22px] w-[22px] flex-none text-primary" />
              과제 ({assignments.length})
            </span>
            <Button size="sm" onClick={() => openModal({ type: 'assignmentWizard', classroomId })}>
              <Icon name="plus" className="h-[17px] w-[17px]" />
              과제 만들기
            </Button>
          </div>
          <div className="max-h-[300px] overflow-y-auto pr-0.5">
            <AssignmentListCard
              items={assignments}
              onReload={load}
              emptyHint="“과제 만들기”로 지금 만들 수 있어요."
              emptyMinHeight="min-h-[160px]"
            />
          </div>
        </section>
      </div>
    </ModalShell>
  )
}
