import { GreetBar } from '@/components/classroom/GreetBar'
import { VideoCard } from '@/components/classroom/VideoCard'
import { TaskPanel } from '@/components/classroom/TaskPanel'
import { QuizView } from '@/components/classroom/QuizView'
import { ConfettiCanvas } from '@/components/classroom/ConfettiCanvas'
import { TeacherMessages } from '@/components/classroom/TeacherMessages'
import { AiTutorPanel } from '@/components/classroom/AiTutorPanel'
import { StudentDock, type DockPanel } from '@/components/classroom/StudentDock'
import { SessionEndedOverlay } from '@/components/classroom/SessionEndedOverlay'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStudentStage } from '@/hooks/useStudentStage'
import { useClassroomSocket } from '@/hooks/useClassroomSocket'
import { useActiveSession } from '@/hooks/useActiveSession'
import { useClassroomStore } from '@/stores/useClassroomStore'
import { useSignalStore } from '@/stores/useSignalStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useToastStore } from '@/stores/useToastStore'
import { useNoticeStore } from '@/stores/useNoticeStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useLessonTopic } from '@/stores/useLessonTopicStore'
import { parseNotice } from '@/lib/notice'
import { breakChime } from '@/services/effects/breakChime'
import { useAuth } from '@/hooks/useAuth'
import type { ServerEvent } from '@/types/signaling'

/**
 * 상담 라우팅 안내 3종의 제목. 본문은 서버가 실어 보내는 문구를 그대로 쓰고
 * (`ChatNoticePayload.message`), 없을 때만 아래 폴백을 쓴다.
 *
 * 이 세 이벤트는 **학생이 질문했을 때 서버가 돌려주는 유일한 응답**이다. 오랫동안 번역만
 * 되고 소비처가 없어서, 응답 가능한 선생님이 없으면 화면에 아무 일도 일어나지 않았다
 * (아이는 쪽지가 갔는지조차 알 수 없었다).
 *
 * 제목과 본문이 겹치지 않게 골랐다 — CHAT_ASSIGNED 의 본문에는 배정된 선생님 이름이
 * 들어 있어서(ClassroomSocket.translate) 제목까지 같은 말이면 두 번 읽힌다.
 */
const CHAT_NOTICE: Record<string, { title: string; body: string }> = {
  CHAT_WAITING: { title: '선생님을 기다리고 있어요', body: '조금만 기다려 주세요.' },
  CHAT_ASSIGNED: { title: '선생님과 연결됐어요', body: '선생님과 연결됐어요.' },
  CHAT_ENDED: { title: '쪽지 연결이 종료됐어요', body: '다음에 또 물어봐 주세요.' },
}

/**
 * 열린 패널 열의 폭. 하한(260px)은 쪽지·활동지가 한 줄에 두세 글자만 들어가지 않게,
 * 상한(380px)은 무대가 지나치게 깎이지 않게 잡는다.
 */
const PANEL_W = 'clamp(260px,27vw,380px)'

/**
 * 교실 페이지 — 레이아웃 조립 및 뷰(교실 ↔ 퀴즈) 전환.
 *
 * **한 판 안에 [도구 레일] · [패널 열] · [무대] 한 줄이다.**
 * 레일 단추를 누르면 그 오른쪽에 패널 열이 펼쳐지고 무대가 그만큼 줄어든다 — 패널이 무대 위에
 * 떠서 방송을 가리지 않는다. 닫으면 폭이 0 이 되어 무대가 다시 화면을 다 쓴다.
 *
 * 마이크·카메라·손들기는 방송 카드 **안**(ControlBar)에 있다. 전체화면이 카드 단위로 걸리기
 * 때문에 미디어 조작이 카드 밖에 있으면 전체화면에서 사라진다. 같은 이유로 레일·패널은 카드
 * 밖이라 전체화면에서는 자연히 안 보인다 — 전체화면의 목적은 화면을 크게 보는 것이다.
 *
 * (배율(zoom) 방식을 버리고 반응형으로 바꾼 이력은 유지 — 컨테이너가 화면을 따라간다.)
 */
export function ClassroomPage() {
  const view = useClassroomStore((s) => s.view)
  const applyEvent = useSignalStore((s) => s.applyEvent)
  const setSend = useSignalStore((s) => s.setSend)
  const showToast = useToastStore((s) => s.show)
  const { logout } = useAuth()

  /**
   * 수업 세션 id 해석: `?session=N` 이 있으면 그걸 쓰고, 없으면 내 학급의 진행 중 수업을 찾는다.
   * 아직 수업 전이면 null 이고, 선생님이 시작하면 개인 채널의 SESSION_STARTED 로 채워진다.
   */
  const [params] = useSearchParams()
  const raw = Number(params.get('session'))
  const paramSession = Number.isFinite(raw) && raw > 0 ? raw : null
  /**
   * 내 학년을 넘겨 **내 수업만** 고르게 한다 (V31: 학급에 학년별 수업이 나란히 돈다).
   *
   * 안 넘기면 목록의 첫 번째(= 가장 낮은 학년) 수업을 잡아, 3학년 학생이 1학년 방으로 들어간다.
   * 접속은 성공하므로 화면은 멀쩡해 보이는데 선생님 영상·소리가 영영 오지 않는다 —
   * 서로 다른 LiveKit 룸이기 때문이다.
   */
  const myGrade = useAuthStore((s) => s.user?.grade ?? null)
  const active = useActiveSession(undefined, myGrade)
  const sessionId = paramSession ?? active.sessionId
  /* 콜백 의존성을 `active` 통째가 아니라 이 함수 하나로 좁힌다 (매 렌더 새 객체다) */
  const refreshSession = active.refresh

  // 선생님 방송 수신(학급 룸) + 내 캠 송출(팀 룸) + 셀프뷰
  const { attachTeacherVideo, attachSelfVideo, publishing, teacherScreenShare } =
    useStudentStage(sessionId)

  // 활동지 = 내 학급의 **공개된 과제** (서버가 원천)
  const loadTasks = useTaskStore((s) => s.load)
  /** 공지·쪽지·새 과제 알림 — 방송 카드 안쪽에 쌓인다(전체화면에서도 보인다) */
  const pushNotice = useNoticeStore((s) => s.push)
  /** 미디어 요청이 나를 지목한 것인지 가리는 데 쓴다 (서버가 대상 userId 를 풀어서 보낸다) */
  const myUserId = useAuthStore((s) => s.user?.id)

  // 선생님 → 학생 이벤트를 신호 버스로 흘려보내고, 눈에 띄는 것은 토스트로도 알린다
  const onEvent = useCallback(
    (event: ServerEvent) => {
      /*
        **남의 수업 종료는 여기서 끊는다.**

        종료 알림은 학급 구성원 전원의 개인 채널로도 온다(동료 선생님 화면을 갱신하려고).
        학년별로 두 수업이 나란히 도는 지금, 이 검사가 없으면 1학년 수업이 끝났을 때
        5학년 아이까지 교실에서 튕겨 나간다 — 그 아이 수업은 멀쩡히 열려 있는데도.

        전역 신호 스토어(`applyEvent`)보다 **먼저** 끊어야 한다. 그쪽은 어느 수업인지 모른 채
        `sessionEnded` 를 켜고, 그러면 '수업이 끝났어요' 덮개가 화면을 가린다.

        SESSION_STARTED 는 거르지 않는다 — 아직 수업이 없는 상태로 기다리는 아이에게
        "시작됐다"를 알리는 유일한 길이고, 그때는 비교할 내 수업이 없다.
      */
      if (event.event === 'SESSION_ENDED' && event.sessionId !== sessionId) return

      applyEvent(event)

      /*
        수업 시작·종료 — **알림의 id 를 그대로 쓰지 않고 다시 조회한다.**

        이 알림은 학급 **전원**에게 가고 payload 에 학년이 없다(`{sessionId, classroomId}`,
        백엔드 SessionStartNotifier). 그래서 id 를 그대로 받아 들어가면 옆 학년 수업이 열릴
        때마다 그 방으로 끌려 들어간다 — 선생님이 없는 방이라 화면도 소리도 오지 않는다.

        다시 조회하면 `useActiveSession` 이 내 학년 수업을 골라 준다. 판단하는 곳이 한 군데로
        모여, "어느 수업이 내 것인가" 규칙이 두 벌로 갈리지 않는다.

        종료도 마찬가지다. 예전엔 어느 수업이 끝나든 무조건 비워서, 옆 학년 수업이 끝나면
        내 수업이 멀쩡히 도는데도 교실에서 튕겨 나갔다.
      */
      if (event.event === 'SESSION_STARTED' || event.event === 'SESSION_ENDED') {
        refreshSession()
      }

      /*
        쉬는 시간 종소리.

        **스토어(`broadcastLocked`)가 아니라 이 이벤트를 방아쇠로 쓴다.** 스토어는 재접속
        스냅샷(`GET /state`)으로도 채워지는데, 그건 "쉬는 시간이 시작됐다"가 아니라 "지금
        쉬는 시간이더라"는 복원이다. 상태 변화를 보고 울리면 **쉬는 시간에 새로고침할 때마다
        종이 다시 울린다.** 이벤트는 선생님이 실제로 누른 순간에만 온다.

        끄는 쪽도 여기서 함께 본다 — 일찍 끝나면(locked:false) 울리던 소리를 끊는다.
        다시 시작하면 `play()` 가 처음부터 다시 울리며 앞 소리를 끊는다(breakChime 주석).
      */
      if (event.event === 'BROADCAST_LOCK') {
        if (event.locked) breakChime.play()
        else breakChime.stop()
      }

      /*
        선생님 쪽지 — **공지는 따로 눈에 띄게** 알린다.

        공지 여부는 본문 표식으로만 알 수 있다(lib/notice). 서버에 공지 타입이 없어서
        전체 공지와 1:1 쪽지의 payload 가 완전히 같기 때문이다.

        알림은 토스트가 아니라 방송 카드 안의 스택(NoticeStack)으로 띄운다 —
        토스트는 동시에 하나만 뜨고, 전체화면에서는 아예 보이지 않는다.
      */
      if (event.event === 'CHAT_MESSAGE' && event.senderRole === 'TEACHER') {
        const { isNotice, text } = parseNotice(event.message ?? '')
        pushNotice(
          isNotice
            ? { kind: 'notice', title: '선생님 공지', body: text }
            : { kind: 'message', title: '선생님 쪽지', body: text },
        )
      }

      /*
        선생님이 마이크·카메라를 **켜 달라고 부탁했다** (백엔드 S15P11A407-137).

        MEDIA_CONTROL(강제 잠금/해제)과 달리 서버가 아무것도 안 바꿨다 — 브라우저는 사용자
        제스처 없이 장치를 켜 주지 않으므로 **학생이 직접 눌러야** 한다. 그래서 상태를 건드리지
        않고 안내만 띄운다. 대상은 서버가 풀어서 보내주므로 `userIds` 에 내가 있는지만 본다.
      */
      if (
        event.event === 'MEDIA_REQUEST' &&
        myUserId != null &&
        (event.userIds ?? []).includes(myUserId)
      ) {
        const mic = event.mediaAction === 'REQUEST_UNMUTE_MIC'
        pushNotice({
          kind: 'message',
          title: mic ? '마이크를 켜 주세요' : '카메라를 켜 주세요',
          body: mic
            ? '선생님이 목소리를 듣고 싶어 해요. 아래 마이크 단추를 눌러 주세요.'
            : '선생님이 얼굴을 보고 싶어 해요. 아래 카메라 단추를 눌러 주세요.',
        })
      }

      /*
        상담 라우팅 안내(대기·배정·종료) — 개인 알림함으로 온다.
        토스트가 아니라 알림 스택을 쓰는 이유는 다른 알림과 같다: 토스트는 동시에 하나만
        뜨고 전체화면에서는 아예 보이지 않는다(useNoticeStore 주석).
      */
      const chatNotice = CHAT_NOTICE[event.event]
      if (chatNotice) {
        pushNotice({
          kind: 'message',
          title: chatNotice.title,
          body: event.message || chatNotice.body,
        })
      }

      /*
        수업에서 내보내짐 → 안내 후 로그아웃.

        **`userIds` 에 내가 있는지 반드시 본다.** 이 이벤트는 대상자 개인 채널이 아니라
        세션 토픽으로 오기 때문에(SessionKickService) 같은 수업의 학생 전원이 받는다 —
        가드가 없으면 한 명을 내보낼 때 **반 전체가 로그아웃된다.**
        (`myUserId` 를 아직 모르면 아무것도 하지 않는다 — 남의 강퇴로 나가는 것보다
        내 강퇴를 한 번 놓치는 편이 낫다.)
      */
      if (
        event.event === 'KICKED' &&
        myUserId != null &&
        (event.userIds ?? []).includes(myUserId)
      ) {
        showToast('선생님이 수업에서 내보냈어요. 잠시 후 로그아웃돼요.')
        // 토스트 노출 시간(useToastStore 2600ms)보다 길게 — 짧으면 왜 나가는지 못 읽는다
        setTimeout(() => logout.mutate(), 3000)
      }

      /*
        선생님이 과제를 공개함 — 목록을 다시 받아 '활동지'에 바로 띄운다.
        예전에는 이 알림을 무시해서 **새로고침해야만 새 과제가 보였다.**

        학급을 대조하는 이유: 개인 알림함은 내가 속한 **모든 학급**의 알림이 들어오는
        통로라, 지금 보고 있지 않은 학급의 과제 공개에도 목록을 다시 받게 된다.
        (id 타입이 서버 응답에서 number/string 으로 갈릴 수 있어 문자열로 비교한다)
      */
      if (
        event.event === 'ASSIGNMENT_PUBLISHED' &&
        active.classroomId &&
        String(event.classroomId) === String(active.classroomId)
      ) {
        void loadTasks(active.classroomId)
        pushNotice({
          kind: 'assignment',
          title: '새 과제가 도착했어요',
          body: '활동지에서 바로 풀 수 있어요.',
        })
      }
    },
    [
      applyEvent,
      showToast,
      logout,
      loadTasks,
      active.classroomId,
      refreshSession,
      pushNotice,
      myUserId,
      /*
        **빠뜨리면 안 된다.** 위 종료 관문이 `sessionId` 와 비교하는데, 의존성에서 빠지면
        콜백이 만들어질 당시의 값(대개 아직 수업이 없어 null)을 계속 붙든다. 그러면 정작
        내 수업이 끝났을 때 `event.sessionId !== null` 이라 걸러져, 아이가 끝난 교실에
        남는다. dev/fe 병합 충돌을 풀면서 한 번 빠졌던 자리다.
      */
      sessionId,
    ],
  )

  /**
   * "수업이 시작됐어요" 안내는 **내 수업이 실제로 잡혔을 때** 띄운다.
   *
   * 알림을 받은 자리에서 바로 띄우면 옆 학년 수업이 열릴 때도 뜬다 — 들어가지도 않는데
   * 교실로 들어간다고 말하는 셈이다. 다시 조회한 결과가 null 에서 값으로 바뀌는 순간이
   * "내 수업이 열렸다"의 정확한 정의다.
   */
  /*
    쉬는 시간 종소리는 교실에 있는 동안만 쓴다.

    들어올 때 미리 받아 둔다 — 울려야 하는 순간에 파일을 받기 시작하면 학교망에서는 몇 초
    늦게 울린다. 나갈 때는 끊는다: 종이 울리는 중에 교실을 떠나면 다른 화면에서 계속 들린다
    (오디오 요소는 페이지에 매여 있지 컴포넌트에 매여 있지 않다).
  */
  useEffect(() => {
    breakChime.prime()
    return () => breakChime.stop()
  }, [])

  const prevSessionId = useRef<number | null>(null)
  useEffect(() => {
    const before = prevSessionId.current
    prevSessionId.current = active.sessionId
    if (before === null && active.sessionId !== null) {
      showToast('수업이 시작됐어요! 교실로 들어갈게요')
    }
  }, [active.sessionId, showToast])

  // participants 는 '친구 보기' 패널이 쓰던 값이다 — 패널을 걷어내면서 함께 뺐다
  const { send } = useClassroomSocket({ sessionId, onEvent })

  // 손들기·쪽지 등 하위 컴포넌트가 prop drilling 없이 발행할 수 있도록 신호 버스에 등록
  useEffect(() => {
    setSend(send)
  }, [send, setSend])

  // 첫 진입 로드. 이후 갱신은 위 onEvent 의 ASSIGNMENT_PUBLISHED 가 맡는다
  useEffect(() => {
    if (active.classroomId) void loadTasks(active.classroomId)
  }, [active.classroomId, loadTasks])

  /* ── 헤더에 적을 것들 ─────────────────────────────────── */

  /** `3학년 · 국어교실` — 아는 조각만 잇는다. 둘 다 모르면 기본 인사 문구로 둔다 */
  const grade = useAuthStore((s) => s.user?.grade)
  const classLabel =
    [grade != null ? `${grade}학년` : null, active.classroomName].filter(Boolean).join(' · ') ||
    undefined

  /**
   * 내 학년의 수업 주제 — 선생님이 수업을 열며 적은 말 (S15P11A407-146).
   *
   * `join` 응답의 `topics` 가 스토어에 담기고 여기서 읽는다. 학년을 모르면(`grade` 가 null)
   * 고를 수 없으니 `useLessonTopic` 이 null 을 준다 — 그때는 아래에서 학급 이름으로 떨어진다.
   */
  const myTopic = useLessonTopic(active.sessionId, grade ?? null)

  /*
    시청 인원('N명 시청 중')은 없앴다 — 선생님 요청. 아이가 자기 화면에서 볼 이유가 없는
    숫자였다(GreetBar 주석 참고). 그걸 세느라 읽던 `onlineIdentities`·`signalingStatus` 도
    이 페이지에서는 더 필요하지 않아 함께 걷어냈다.
  */
  /* ── 하단 독이 여닫는 드로어 ───────────────────────────── */

  const [panel, setPanel] = useState<DockPanel | null>(null)
  const togglePanel = useCallback((k: DockPanel) => setPanel((p) => (p === k ? null : k)), [])


  // 활동지에서 '시작하기' → 퀴즈로 전환되면 드로어는 접는다 (퀴즈 위에 떠 있을 이유가 없다)
  useEffect(() => {
    if (view !== 'classroom') setPanel(null)
  }, [view])

  // Esc 로 닫기 — 아이가 드로어에 갇히지 않게 (GreetBar 메뉴와 같은 규칙)
  useEffect(() => {
    if (panel === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel])

  /*
    새 쪽지 배지 — 선생님이 보낸 쪽지가 **드로어가 닫힌 동안** 몇 개 왔는지.

    서버에 "읽음" 개념이 없어서(수업 중 쪽지는 STOMP 로 흘러올 뿐) 화면이 직접 센다:
    지금까지 본 수(chatSeen)와 전체 수의 차이가 배지다. 기준을 0 에서 시작하면
    TeacherMessages 가 마운트 때 받아 오는 **지난 이력 전체가 "새 쪽지"로 보이므로**,
    첫 값이 오거나 3초가 지난 시점의 수를 기준으로 삼는다(그 뒤에 오는 것만 새 것).
  */
  const teacherMessages = useSignalStore((s) => s.teacherMessages)
  const teacherCount = useMemo(
    () => teacherMessages.filter((m) => m.from === 'teacher').length,
    [teacherMessages],
  )
  const [chatSeen, setChatSeen] = useState<number | null>(null)
  useEffect(() => {
    if (chatSeen !== null) return
    if (teacherCount > 0) {
      setChatSeen(teacherCount)
      return
    }
    const t = setTimeout(() => setChatSeen((v) => (v === null ? 0 : v)), 3000)
    return () => clearTimeout(t)
  }, [teacherCount, chatSeen])
  useEffect(() => {
    if (panel === 'chat') setChatSeen(teacherCount)
  }, [panel, teacherCount])
  const chatBadge = chatSeen === null ? 0 : Math.max(0, teacherCount - chatSeen)

  /**
   * 패널 한 칸 — 안 열린 것은 `invisible` 로만 숨긴다(레이아웃은 유지). `display:none` 으로
   * 숨기면 숨겨진 동안 쪽지 목록의 scrollHeight 가 0 이라 "맨 아래 따라가기"가 멈춘다.
   *
   * **여기서는 스크롤하지 않는다**(`overflow-hidden`). 스크롤은 각 패널이 자기 안에서 한다 —
   * 활동지는 목록만, 말랑이·쪽지는 말풍선 목록만 넘긴다. 이 칸에도 `overflow-y-auto` 가
   * 있었을 때는 스크롤바가 둘로 겹쳐서, 밖의 것을 내려도 정작 목록은 그대로였다.
   */
  const drawerPane =
    'pointer-events-none absolute inset-0 overflow-hidden rounded-card opacity-0 invisible transition-opacity duration-150 data-[on=true]:pointer-events-auto data-[on=true]:visible data-[on=true]:opacity-100'

  return (
    /*
      교실 뷰는 **스크롤 없는 한 화면**(100dvh)이다 — 무대가 남는 높이를 전부 쓰고, 넘칠 게
      없다. **퀴즈 뷰도 같다.**

      예전엔 퀴즈만 세로로 흐르는 페이지였다. 그래서 **문항마다 화면 크기가 바뀌었다** —
      보기 4개짜리 문제에서 2개짜리로 넘어가면 종이가 쑥 줄고, 피드백 한 줄이 붙거나
      '다음 문제' 버튼이 나타날 때마다 또 늘었다. 아이 눈에는 화면이 계속 들썩인다.

      이제 **꽉 찬 한 화면이 기준**이다: 바깥 틀은 늘 같은 크기고, 문항 길이는 그 안에서
      종이가 늘어나거나(길면) 남는 자리를 채우거나(짧으면) 하며 흡수한다.

      `max-w` 는 큰 모니터에서 글줄이 지나치게 길어지지 않게만 잡는다(1760px).
    */
    <div className="mx-auto flex h-[100dvh] w-full max-w-[1760px] flex-col overflow-hidden p-[clamp(12px,1.8vw,24px)]">
      {/*
        ── 화면 전체를 **한 판**으로 묶는다 ────────────────────────────
        예전엔 인사줄 카드와 무대 카드가 각자 떠 있었다. 둘 사이 여백으로 배경이 비쳐 한 화면이
        두 덩어리로 갈렸고, 아이 눈에는 "교실"이 어디까지인지 경계가 없었다.

        머리글과 본문을 **같은 테두리 안**에 넣고 구분선 하나로 나눈다 — 선생님 화면들
        (`TeacherHomePage`)이 헤더·히어로·패널을 이어 한 줄로 만든 것과 같은 방식이다.

        두 뷰 모두 높이를 꽉 채우고 판 밖으로 넘치지 않는다 — 교실은 무대가, 퀴즈는 문제 종이가
        남는 높이를 쓴다.
      */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-page border-[1.5px] border-frame bg-card shadow-card">
        <GreetBar classLabel={classLabel} />

        {/*
          본문 — 머리글과 **같은 판 안**이지만 배경 한 단계를 눌러(`bg-page`) 층을 만든다.
          머리글까지 같은 흰색이면 구분선 하나에 기대야 하고, 안에 놓이는 흰 카드(무대·퀴즈
          문항)가 배경에 묻힌다. 시안의 "머리글은 흰 줄, 아래는 연한 판" 이 이 구조다.
        */}
        <div
          className={
            view === 'classroom'
              ? 'flex min-h-0 flex-1 flex-col bg-page p-[clamp(10px,1.1vw,16px)]'
              : /*
                  퀴즈 뷰 바탕은 **하늘·잔디 그림**(`p_bg`)이다 — 문제 종이와 버튼이 그 위에 얹힌다.
                  `bg-cover` + 아래쪽 정렬로 잔디를 바닥에 붙인다(지평선이 허공에 뜨지 않게).
                  색(`bg-page`)을 함께 두는 이유는 그림이 늦게 올 때 흰 화면이 번쩍이지 않게 하는 것.

                  높이는 **판이 주는 만큼 꽉 채운다**(`flex-1`) — 문항 길이에 따라 이 칸이
                  늘었다 줄었다 하지 않아야 화면이 들썩이지 않는다. 위 여백만 작게(8px):
                  문제가 위에 붙어 있어야 아이가 고개를 들지 않는다.
                */
                "flex min-h-0 flex-1 flex-col bg-page bg-[url('/assets/p_bg.webp')] bg-cover bg-[position:center_bottom] bg-no-repeat p-[8px_clamp(14px,1.6vw,22px)_clamp(14px,1.6vw,22px)]"
          }
        >
        {view === 'classroom' ? (
          /*
            ── 본문 한 줄: [도구 레일] · [패널 열] · [무대] ─────────────────────────
            레일은 **맨 왼쪽**이고, 단추를 누르면 그 오른쪽에 패널 열이 펼쳐지며 **무대가 그만큼
            줄어든다**(무대를 덮지 않는다). 예전엔 패널이 무대 위에 떠 있는 드로어라 방송을
            가렸고, 무대가 줄지 않으니 둘이 겹쳐 어느 쪽을 보라는 것인지 애매했다.

            스크롤은 **패널 안쪽 하나만** 둔다. 예전엔 이 줄에도 `overflow-y-auto` 가 있어
            좁은 화면에서 스크롤바가 둘이었다(밖의 것을 내려도 안의 내용은 그대로).
          */
          <div className="flex min-h-0 flex-1 gap-3 max-[640px]:gap-2">
            <StudentDock open={panel} onToggle={togglePanel} chatBadge={chatBadge} />

            {/*
              패널 열 — **닫혀도 언마운트하지 않는다.** AI 말랑이의 대화는 컴포넌트 로컬 상태라
              언마운트되면 사라지고(서버에 복원할 곳이 없다 — AiTutorPanel 주석), 쪽지는
              마운트마다 이력 전체를 다시 받는다. 그래서 **폭만 0 으로 접는다.**

              안쪽에 폭이 고정된 상자를 하나 더 두는 이유: 바깥 폭이 0 이 될 때 내용이 0px 로
              눌리면 목록의 스크롤 위치와 줄바꿈이 망가진다. 안쪽은 늘 제 폭을 유지하고
              바깥이 잘라낸다.
            */}
            {/*
              폭·높이는 **인라인 스타일**이다. `w-0` 과 `data-[open=true]:w-[...]` 두 유틸이 같은
              속성을 다투는데, 어느 쪽이 이기는지는 생성된 CSS 순서에 달려 있어서 실제로 열려도
              0 으로 남는 일이 있었다(브라우저에서 재봐서 확인했다). 상태에 따라 값을 직접 주면
              그 다툼이 없다 — transition 만 클래스가 맡는다.
            */}
            <div
              aria-hidden={panel === null}
              style={{ width: panel !== null ? PANEL_W : 0 }}
              className="relative min-h-0 flex-none overflow-hidden transition-[width] duration-200 ease-out"
            >
              <div className="absolute inset-y-0 left-0" style={{ width: PANEL_W }}>
                <div data-on={panel === 'ai'} className={drawerPane}>
                  {/*
                    학급을 모르면 서버가 권한을 판단할 수 없어 말랑이를 띄우지 않는다.

                    **"수업에 들어오면"이 아니다.** `active.classroomId` 는 수업이 열려
                    있는지와 무관하게 **내가 속한 학급**이 있으면 채워진다
                    (useActiveSession — 내 학급 목록의 첫 번째). 그래서 예전 문구는 아이에게
                    수업 참여를 기다리라고 말했지만, 정작 수업에 들어가도 아무것도 달라지지
                    않았다. 진짜 조건은 '아직 반이 없다'이고, 그건 아이가 아니라 선생님이
                    풀어야 할 일이라 그렇게 적는다.

                    불러오는 중과 구분한다 — 잠깐 뜨는 안내가 사실과 다르면 그것도 거짓말이다.
                  */}
                  {active.loading ? (
                    <div className="rounded-card bg-card p-[18px] shadow-card">
                      <p className="text-[.9rem] font-bold text-ink-soft">불러오는 중이에요...</p>
                    </div>
                  ) : active.classroomId != null ? (
                    <AiTutorPanel classroomId={Number(active.classroomId)} />
                  ) : (
                    <div className="rounded-card bg-card p-[18px] shadow-card">
                      <p className="text-[.9rem] font-bold text-ink-soft">
                        아직 우리 반이 없어요.
                        <br />
                        선생님이 반에 넣어 주시면 말랑이와 이야기할 수 있어요.
                      </p>
                    </div>
                  )}
                </div>
                <div data-on={panel === 'tasks'} className={drawerPane}>
                  <TaskPanel />
                </div>
                <div data-on={panel === 'chat'} className={drawerPane}>
                  <TeacherMessages />
                </div>
              </div>
            </div>

            {/*
              무대 — 마이크·카메라·손들기 바는 **카드 안**에 있다(`VideoCard` → `ControlBar`).
              한 번 카드 밖 아래로 내려 봤다가 되돌렸다: 전체화면이 카드 단위로 걸려서 밖에 두면
              전체화면에서 단추가 사라지고, 방송 조작은 방송 화면과 한 덩어리인 편이 손에 맞는다.
            */}
            <section className="relative min-h-0 min-w-0 flex-1" aria-label="선생님 실시간 방송">
              <VideoCard
                fill
                attachVideo={attachTeacherVideo}
                attachSelfVideo={attachSelfVideo}
                publishing={publishing}
                screenShare={teacherScreenShare}
                /*
                  선생님이 적은 **오늘의 수업 주제**. 서버가 학년별로 갖게 되면서
                  (S15P11A407-146) 학생 화면에도 같은 말이 뜬다 — 주제는 `join` 응답의
                  `topics` 로 실려 와 `useLessonTopicStore` 에 담긴다.

                  주제가 없으면(선생님이 비워 둔 채 시작) 예전처럼 학급 이름이 그 자리에 남는다.
                  내 학년 주제만 본다 — 복식학급은 한 수업에 5·6학년이 함께 있어서, 학년을
                  안 가리면 옆 학년 주제가 뜬다.
                */
                topic={myTopic || active.classroomName || '오늘의 수업'}
                sessionId={sessionId}
                startedAt={active.startedAt}
              />
            </section>
          </div>
        ) : (
          <QuizView />
        )}
        </div>
      </div>

      {/* 화면 전체를 덮는 것들 — 판 밖에 둔다(판 안에 두면 `overflow-hidden` 에 잘린다) */}
      <ConfettiCanvas />
      <SessionEndedOverlay />
      {/*
        "눌러서 선생님 목소리 듣기" 배너는 뺐다 — 자동 재생이 막혀도 학생 화면에 버튼을
        하나 더 띄우지 않는다. 브라우저가 요구하는 건 아무 제스처이지 그 버튼이 아니라서,
        이제 `RemoteAudioPlayer` 가 첫 클릭·키·터치에 조용히 푼다(armGestureUnlock).
      */}
    </div>
  )
}
