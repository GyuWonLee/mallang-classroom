import { useClassroomSocket } from '@/hooks/useClassroomSocket'

/**
 * 선생님을 "지금 응답 가능한 사람"으로 만들어 두는 훅. 화면에는 아무것도 그리지 않는다.
 *
 * 백엔드는 **STOMP 접속 자체를 온라인 판정으로 쓴다**(WebSocketEventListener → PresenceService.
 * teacherOnline). 그래서 소켓을 붙이지 않는 화면에 있으면 그 선생님은 오프라인이고,
 * 학생이 질문해도 담당 배정이 되지 않아 `CHAT_WAITING` 으로 대기열에 들어간다.
 * 예전에는 소켓을 여는 화면이 라이브 수업·채팅 인박스·학급 화면뿐이라, 선생님이 내 학급 홈에
 * 앉아 있는 동안 학생 질문이 아무에게도 배달되지 않았다.
 *
 * 접속되면 개인 알림함(`/user/sub/notifications`)이 열리므로 질문은 그 화면에서도 도착하고,
 * `useClassroomSocket` 이 선생님에게 토스트로 알린다. 서버는 선생님이 막 접속하면
 * 대기 중이던 학생을 바로 연결해 준다(ChatRouterService.drainWaitingQueue).
 *
 * **수업(`sessionId`)은 잡지 않는다.** 수업 게시판(손들기·판서·잠금)은 이 화면들이 쓰지 않고,
 * 상담 배달은 세션 토픽이 아니라 개인 알림함으로 오기 때문이다.
 *
 * ⚠ **소켓을 이미 여는 화면에서는 부르지 말 것.** 백엔드 프레즌스는 STOMP 세션별 refcount 가
 * 아니라 teacherId 단순 Set 이라(`SADD`/`SREM`), 한 선생님이 소켓을 둘 열면 **하나만 닫혀도
 * 완전히 오프라인 처리된다.** 개인 알림함도 두 번 구독돼 질문이 두 번 도착한다.
 * 지금 소켓을 직접 여는 곳: `TeacherClassroomPage`(useTeacherClassroom) ·
 * `TeacherChatPage` · `ClassMessagesPanel`(→ TeacherClassDetailPage).
 * 라우트는 서로 배타적이라 그 세 곳만 피하면 겹치지 않는다.
 */
export function useTeacherPresence(): void {
  useClassroomSocket({ sessionId: null })
}
