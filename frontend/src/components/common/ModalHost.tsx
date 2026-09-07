import { lazyWithRetry } from '@/app/routes/lazyWithRetry'
import { Suspense } from 'react'
import { useModalStore, type ModalRequest } from '@/stores/useModalStore'

/*
  모달도 **열릴 때 받아온다**(코드 스플리팅).

  ModalHost 는 RootLayout 에 항상 마운트돼 있어서, 정적 import 였을 때는 **한 번도 열지 않은
  모달까지 전부 첫 화면 번들에 들어갔다** — 과제 생성 마법사(AI 초안 검수 화면)가 특히 컸다.
  로그인 화면에 과제 마법사 코드가 실려 오는 셈이었다.

  모달은 사용자가 버튼을 누른 뒤에 뜨는 것이라 아주 짧은 지연이 자연스럽다.
  fallback 은 비워 둔다: 오버레이만 번쩍이면 오히려 깜빡임으로 보인다.
*/
const InviteTeacherModal = lazyWithRetry(() =>
  import('@/components/classroom/teacher/modals/InviteTeacherModal').then((m) => ({
    default: m.InviteTeacherModal,
  })),
)
const InviteStudentModal = lazyWithRetry(() =>
  import('@/components/classroom/teacher/modals/InviteStudentModal').then((m) => ({
    default: m.InviteStudentModal,
  })),
)
const JoinClassModal = lazyWithRetry(() =>
  import('@/components/classroom/teacher/modals/JoinClassModal').then((m) => ({
    default: m.JoinClassModal,
  })),
)
const StudentPasswordModal = lazyWithRetry(() =>
  import('@/components/classroom/teacher/modals/StudentPasswordModal').then((m) => ({
    default: m.StudentPasswordModal,
  })),
)
const AssignmentWizardModal = lazyWithRetry(() =>
  import('@/components/classroom/teacher/modals/AssignmentWizardModal').then((m) => ({
    default: m.AssignmentWizardModal,
  })),
)
const LiveWorkspaceModal = lazyWithRetry(() =>
  import('@/components/classroom/teacher/modals/LiveWorkspaceModal').then((m) => ({
    default: m.LiveWorkspaceModal,
  })),
)
const AssignmentDetailModal = lazyWithRetry(() =>
  import('@/components/classroom/teacher/modals/AssignmentDetailModal').then((m) => ({
    default: m.AssignmentDetailModal,
  })),
)
const ProblemDetailModal = lazyWithRetry(() =>
  import('@/components/classroom/teacher/modals/ProblemDetailModal').then((m) => ({
    default: m.ProblemDetailModal,
  })),
)
const ChangePasswordModal = lazyWithRetry(() =>
  import('@/components/common/ChangePasswordModal').then((m) => ({
    default: m.ChangePasswordModal,
  })),
)
const MyAnswersModal = lazyWithRetry(() =>
  import('@/components/classroom/MyAnswersModal').then((m) => ({ default: m.MyAnswersModal })),
)
const TutorFlagsModal = lazyWithRetry(() =>
  import('@/components/classroom/teacher/modals/TutorFlagsModal').then((m) => ({
    default: m.TutorFlagsModal,
  })),
)

/**
 * 모달 호스트 — 앱에 **한 번만** 마운트되고, 스토어 스택에 쌓인 모달을 렌더한다.
 *
 * 새 모달을 추가하는 절차는 세 곳뿐이다:
 *   1) `useModalStore.ts` 의 `ModalRequest` 유니온에 한 줄 추가 (필요한 값도 타입으로 강제)
 *   2) 위에 `lazyWithRetry(...)` 한 줄 추가
 *   3) 아래 switch 에 한 줄 추가
 * 페이지는 `openModal({ type, ... })` 만 부르면 되고, 열림 상태 boolean 을 들고 있지 않는다.
 */
function renderModal(request: ModalRequest, onClose: () => void) {
  switch (request.type) {
    case 'inviteTeacher':
      return <InviteTeacherModal classroomId={request.classroomId} onClose={onClose} />
    case 'inviteStudent':
      return <InviteStudentModal classroomId={request.classroomId} onClose={onClose} />
    case 'joinClass':
      return <JoinClassModal onClose={onClose} />
    case 'studentPassword':
      return <StudentPasswordModal student={request.student} onClose={onClose} />
    case 'assignmentWizard':
      return <AssignmentWizardModal classroomId={request.classroomId} onClose={onClose} />
    case 'liveWorkspace':
      return <LiveWorkspaceModal classroomId={request.classroomId} onClose={onClose} />
    case 'assignmentDetail':
      return <AssignmentDetailModal assignment={request.assignment} onClose={onClose} />
    case 'problemDetail':
      return (
        <ProblemDetailModal
          assignment={request.assignment}
          no={request.no}
          stats={request.stats}
          onClose={onClose}
        />
      )
    case 'changePassword':
      return <ChangePasswordModal onClose={onClose} />
    case 'myAnswers':
      return (
        <MyAnswersModal
          assignmentId={request.assignmentId}
          title={request.title}
          onClose={onClose}
        />
      )
    case 'tutorFlags':
      return (
        <TutorFlagsModal
          classroomId={request.classroomId}
          studentId={request.studentId}
          studentName={request.studentName}
          onClose={onClose}
        />
      )
  }
}

export function ModalHost() {
  const stack = useModalStore((s) => s.stack)
  const close = useModalStore((s) => s.close)

  // 스택이라 모달 위 모달도 자연스럽게 겹쳐 쌓인다 (닫으면 아래 것이 그대로 남는다)
  return (
    <>
      {stack.map((request, i) => (
        <Suspense key={i} fallback={null}>
          {renderModal(request, close)}
        </Suspense>
      ))}
    </>
  )
}
