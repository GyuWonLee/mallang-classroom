import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RootLayout } from './RootLayout'
import { RouteError } from './RouteError'
import { RequireAuth, RequireRole, RoleRedirect } from './guards'
/*
  페이지는 **라우트 단위로 쪼개** 지연 로딩한다(선언은 ./lazyPages).

  전에는 전부 정적 import 라 번들이 하나(1.3MB)였다. 그래서 **로그인 화면 하나를 열어도
  livekit-client(WebRTC SFU 클라이언트, gzip 129kB)와 framer-motion 을 통째로 받아야** 했다 —
  둘 다 수업 화면에서만 쓰는데 학교 회선에서 첫 화면이 그만큼 늦어졌다.

  지금 내려오는 순서:
   - 첫 진입: 엔트리(react·router·zustand·query) + api client + 해당 페이지 청크
   - livekit-client → 수업 화면(학생 `/classroom`, 선생님 라이브)에 들어갈 때만
   - framer-motion → 학생 교실(퀴즈·AI 챗)에서만
   - 과제 마법사 등 모달 → 그 모달을 열 때만 (ModalHost 참고)

  로딩 중 화면은 RootLayout 의 <Suspense fallback={<RouteFallback />}> 이 한 번만 담당한다.
*/
import {
  AuthPage,
  ClassroomPage,
  InviteAcceptPage,
  PasswordResetPage,
  TeacherAssignmentsPage,
  TeacherChatPage,
  TeacherClassDetailPage,
  TeacherClassManagePage,
  TeacherClassroomPage,
  TeacherHomePage,
  TeacherPickClassPage,
  TeacherStudentsPage,
} from './lazyPages'
/* 개발용 미리보기는 지연 로딩하지 않는다 — 아래 DEV 가지와 함께 배포에서 통째로 빠진다 */
import { DevPreviewPage } from '@/pages/DevPreviewPage'

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    /*
      라우트에서 터진 예외를 여기서 받는다. 없으면 react-router 기본 화면(영문
      "Unexpected Application Error!")이 떠서 저학년에게는 흰 화면과 다를 바 없고
      다시 시도할 버튼도 없다. 가장 흔한 원인은 배포 직후의 청크 404 다.
    */
    errorElement: <RouteError />,
    children: [
      // 공개 라우트 (통합 인증 화면 — 탭 전환)
      { path: '/login', element: <AuthPage initialTab="login" />, handle: { title: '로그인' } },
      { path: '/signup', element: <AuthPage initialTab="signup" />, handle: { title: '회원가입' } },
      // 초대 수락 — 백엔드에서 유일하게 비인증 공개인 엔드포인트라 가드 밖에 둔다
      { path: '/invite/:code', element: <InviteAcceptPage />, handle: { title: '초대 받기' } },
      // 비밀번호 재설정(선생님) — 비밀번호를 잊은 사람이 오는 곳이라 당연히 가드 밖이다.
      // ?token= 유무로 "메일 요청"과 "새 비밀번호 정하기"를 한 화면이 겸한다.
      { path: '/reset-password', element: <PasswordResetPage />, handle: { title: '비밀번호 재설정' } },
      { path: '/', element: <RoleRedirect /> },

      // 인증 필요
      {
        element: <RequireAuth />,
        children: [
          // 학생 — 로그인 후 바로 수업으로
          { path: '/classroom', element: <ClassroomPage />, handle: { title: '우리 교실' } },

          // 선생님 전용
          {
            element: <RequireRole role="TEACHER" />,
            children: [
              { path: '/teacher', element: <TeacherHomePage />, handle: { title: '내 학급' } },
              { path: '/teacher/chat', element: <TeacherChatPage />, handle: { title: '채팅 관리' } },
              { path: '/teacher/pick', element: <TeacherPickClassPage />, handle: { title: '학급 고르기' } },
              {
                path: '/teacher/classroom/:classroomId/enter',
                element: <TeacherClassDetailPage />,
                handle: { title: '학급 화면' },
              },
              {
                path: '/teacher/classroom/:classroomId',
                element: <TeacherClassroomPage />,
                handle: { title: '수업 중' },
              },
              {
                path: '/teacher/classroom/:classroomId/manage',
                element: <TeacherClassManagePage />,
                handle: { title: '학급 관리' },
              },
              {
                path: '/teacher/classroom/:classroomId/students',
                element: <TeacherStudentsPage />,
                handle: { title: '학생 관리' },
              },
              {
                path: '/teacher/classroom/:classroomId/assignments',
                element: <TeacherAssignmentsPage />,
                handle: { title: '과제 관리' },
              },
            ],
          },
        ],
      },

      /*
        개발용 미리보기 — **개발 서버에서만** 등록한다(`import.meta.env.DEV`).
        짧게 스쳐 가는 화면(AI 생성 로딩 등)을 로그인·마법사 없이 계속 보면서 고치기 위한 문이다.
        `DEV` 는 빌드 때 `false` 로 박히므로 이 가지와 페이지 코드가 배포 번들에서 통째로 빠진다.
      */
      ...(import.meta.env.DEV
        ? [{ path: '/dev/preview', element: <DevPreviewPage /> }]
        : []),

      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
