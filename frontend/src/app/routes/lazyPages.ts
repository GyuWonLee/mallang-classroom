import { lazyWithRetry } from './lazyWithRetry'

/*
  라우트 페이지의 **지연 로딩 선언만** 모은 파일.

  왜 router.tsx 에서 분리했나: `lazyWithRetry()` 로 만든 값은 컴포넌트인데 router.tsx 는 컴포넌트가 아닌
  `router` 를 export 한다. 한 파일에 둘이 섞이면 Vite 의 Fast Refresh 가 그 파일을 갱신 대상으로
  다루지 못해 oxlint 가 `react(only-export-components)` 를 11번 경고했다.
  선언을 여기로 옮기면 이 파일은 컴포넌트만 export 하므로 경고가 사라진다.

  코드 스플리팅 의도(무엇이 언제 내려오는지)는 router.tsx 주석에 적어 뒀다.

  `lazyWithRetry()` 는 default export 를 기대하는데 이 프로젝트는 named export 라 `.then` 으로 바꿔 준다.
*/

export const AuthPage = lazyWithRetry(() =>
  import('@/pages/AuthPage').then((m) => ({ default: m.AuthPage })),
)
export const ClassroomPage = lazyWithRetry(() =>
  import('@/pages/ClassroomPage').then((m) => ({ default: m.ClassroomPage })),
)
export const InviteAcceptPage = lazyWithRetry(() =>
  import('@/pages/InviteAcceptPage').then((m) => ({ default: m.InviteAcceptPage })),
)
export const PasswordResetPage = lazyWithRetry(() =>
  import('@/pages/PasswordResetPage').then((m) => ({ default: m.PasswordResetPage })),
)
export const TeacherHomePage = lazyWithRetry(() =>
  import('@/pages/teacher/TeacherHomePage').then((m) => ({ default: m.TeacherHomePage })),
)
export const TeacherClassDetailPage = lazyWithRetry(() =>
  import('@/pages/teacher/TeacherClassDetailPage').then((m) => ({
    default: m.TeacherClassDetailPage,
  })),
)
export const TeacherClassroomPage = lazyWithRetry(() =>
  import('@/pages/teacher/TeacherClassroomPage').then((m) => ({
    default: m.TeacherClassroomPage,
  })),
)
export const TeacherClassManagePage = lazyWithRetry(() =>
  import('@/pages/teacher/TeacherClassManagePage').then((m) => ({
    default: m.TeacherClassManagePage,
  })),
)
export const TeacherStudentsPage = lazyWithRetry(() =>
  import('@/pages/teacher/TeacherStudentsPage').then((m) => ({ default: m.TeacherStudentsPage })),
)
export const TeacherChatPage = lazyWithRetry(() =>
  import('@/pages/teacher/TeacherChatPage').then((m) => ({ default: m.TeacherChatPage })),
)
export const TeacherPickClassPage = lazyWithRetry(() =>
  import('@/pages/teacher/TeacherPickClassPage').then((m) => ({ default: m.TeacherPickClassPage })),
)
export const TeacherAssignmentsPage = lazyWithRetry(() =>
  import('@/pages/teacher/TeacherAssignmentsPage').then((m) => ({
    default: m.TeacherAssignmentsPage,
  })),
)
