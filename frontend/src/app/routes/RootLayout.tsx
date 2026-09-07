import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useSessionRestore } from '@/hooks/useAuth'
/*
  방송을 끊는 함수는 **`TeacherBroadcast` 가 아니라 손잡이 모듈에서** 가져온다.
  본체를 import 하면 `ClassroomSignaling -> livekit-client` 가 엔트리 청크로 딸려 와,
  로그인 화면만 열어도 WebRTC 클라이언트를 통째로 받는다 (teacherBroadcastHandle 주석 참고).
*/
import { releaseTeacherBroadcastUnlessInClassroom } from '@/services/media/teacherBroadcastHandle'
import { armChunkReloadBudget } from './lazyWithRetry'
import { ModalHost } from '@/components/common/ModalHost'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Toast } from '@/components/common/Toast'
import { RouteFallback } from './RouteFallback'
import { DocumentTitle } from './DocumentTitle'

/**
 * 모든 라우트의 최상위 — 부팅 시 저장된 토큰으로 세션(내 정보)을 복원한다.
 *
 * 모달 호스트와 토스트도 여기 한 번만 둔다. 예전엔 토스트가 학생 페이지에만 있어서
 * **선생님 화면의 안내/에러가 전부 보이지 않았다.**
 *
 * 페이지는 `lazy()` 로 쪼개져 있어(router.tsx) `<Suspense>` 가 필요하다. 여기 한 곳에만 두면
 * 라우트마다 fallback 을 적지 않아도 된다.
 *
 * **Suspense 는 `<Outlet />` 만 감싼다.** 토스트·모달·확인 대화상자까지 감싸면 페이지 청크를
 * 받는 동안 그것들이 언마운트돼, 화면 전환 중에 뜬 안내 토스트가 사라진다.
 */
/**
 * **학급을 벗어나면 방송을 끈다.**
 *
 * 카메라·마이크·PDF 는 이제 화면이 아니라 수업에 매여 있어(`TeacherBroadcast`), 수업 화면을
 * 벗어나도 살아 있다 — 선생님이 과제를 내러 잠깐 나갔다 오는 동안 학생 화면이 끊기지 않게
 * 하려는 것이다. 그 대신 **끄는 자리를 누군가는 반드시 맡아야 한다.** 여기가 그 자리다:
 * 주소가 그 학급 밖으로 나가는 순간(학급 목록·다른 학급·로그아웃) 끈다.
 *
 * 이게 없으면 카메라가 켜진 채로 앱 전체를 따라다닌다.
 */
function useBroadcastLifetime() {
  const { pathname } = useLocation()
  useEffect(() => {
    const inClassroom = pathname.match(/^\/teacher\/classroom\/([^/]+)/)
    releaseTeacherBroadcastUnlessInClassroom(inClassroom ? inClassroom[1] : null)
  }, [pathname])
}

export function RootLayout() {
  useSessionRestore()
  useBroadcastLifetime()
  /*
    앱이 멀쩡히 떴으니 '청크 실패 시 새로고침 한 번' 예산을 되돌린다. 배포가 하루에 여러 번
    나가면 그때마다 한 번씩 필요하다 (`lazyWithRetry` 주석 참고).
  */
  useEffect(armChunkReloadBudget, [])
  return (
    <>
      {/* 탭 제목 — Suspense 밖에 둔다. 페이지 청크를 받는 동안에도 제목은 이미 정해져 있다 */}
      <DocumentTitle />
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
      <ModalHost />
      {/* 확인 대화상자는 모달 위에도 떠야 하므로(모달 안의 삭제 버튼) ModalHost 뒤에 둔다 */}
      <ConfirmDialog />
      <Toast />
    </>
  )
}
