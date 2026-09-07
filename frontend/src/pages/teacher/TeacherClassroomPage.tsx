import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { teacherRoutes } from '@/lib/routes'
import { Icon } from '@/components/common/Icon'
import { useTeacherClassroom } from '@/hooks/useTeacherClassroom'
import { useTeamRoomStage } from '@/hooks/useTeamRoomStage'
import { useLiveRoster } from '@/hooks/useLiveRoster'
import { useLessonTopic, useLessonTopicStore } from '@/stores/useLessonTopicStore'
import { useLiveGradeStore } from '@/stores/useLiveGradeStore'
import { useLiveStore } from '@/stores/useLiveStore'
import { useTeacherMedia } from '@/hooks/useTeacherMedia'
import { useFullscreen } from '@/hooks/useFullscreen'
import { LiveStage } from '@/components/classroom/teacher/live/LiveStage'
import { LiveTopBar } from '@/components/classroom/teacher/live/LiveTopBar'
import { LiveControlBar } from '@/components/classroom/teacher/live/LiveControlBar'
import { LiveDrawer } from '@/components/classroom/teacher/live/LiveDrawer'
import { LiveChatPanel } from '@/components/classroom/teacher/live/LiveChatPanel'
import { LiveToolsPanel } from '@/components/classroom/teacher/live/LiveToolsPanel'
import { ParticipantsCard } from '@/components/classroom/teacher/live/ParticipantsCard'
import { StudentsLivePanel } from '@/components/classroom/teacher/live/StudentsLivePanel'
import { SessionEndedModal } from '@/components/classroom/teacher/SessionEndedModal'
import { useOpenModal } from '@/stores/useModalStore'


/**
 * 선생님 실시간 수업 — 레퍼런스 teacher.html `viewLive`(리디자인본) 이관.
 *
 * 구성: 칠판 배너(title_bg.png) + `cam | chat / cam | tools` 그리드.
 * 레퍼런스는 학생 타일 그리드와 판서를 리디자인에서 빼고 `#liveLegacyHooks[hidden]` 으로
 * 감춰뒀지만, 우리는 그 기능이 실제로 동작하므로 **배너 아래 별도 줄로 살려 둔다.**
 * 몰입형 화면이라 사이드바는 두지 않는다(팀 결정) — 나가는 문은 배너의 "돌아가기" 하나.
 */
export function TeacherClassroomPage() {
  const navigate = useNavigate()
  const { classroomId } = useParams()
  const [params] = useSearchParams()
  const c = useTeacherClassroom(classroomId)
  const openModal = useOpenModal()

  /** 한 단계 위 = 학급 화면(L2). 목록(L1)까지 튕기지 않는다 */
  const classDetail = teacherRoutes.classDetail(classroomId ?? '')
  /*
    출발지를 실어 보내던 `here`(fromState)는 '학급 관리' 버튼과 함께 사라졌다 —
    이 화면에서 새어나갈 곳이 없어졌으므로 되돌아올 길을 실을 이유도 없다.
  */

  /**
   * 발급 학생이 있는 학년들 — 오름차순.
   *
   * 예전엔 이걸로 화면 안에 **모둠(학년) 탭**을 그렸다. 지웠다: 이 화면은 학급 화면에서
   * **학년을 고르고 들어오는** 곳이다(`?group=N`). 들어와서 또 고르게 하면 같은 선택이
   * 두 군데 있고, 무대는 이미 그 학년 팀 룸에 붙어 있는데 탭만 옮겨져 어긋날 수 있다.
   * 다른 학년을 보려면 돌아가서 그 학년으로 들어오는 것이 한 가지 길로 정리된다.
   *
   * 목록 자체는 남는다 — 주소에 `group` 이 없을 때의 기본값(첫 학년)이 필요하다.
   */
  const grades = useMemo(
    () => [...new Set(c.studentAccounts.map((a) => a.grade))].sort((a, b) => a - b),
    [c.studentAccounts],
  )

  /** 학급 화면에서 고른 학년. 이 화면에서는 바뀌지 않는다 */
  const focus = Number(params.get('group')) || null

  const focusGrade = focus ?? grades[0] ?? 1

  /*
    "지금 이 학년 방에 있다" 를 표시해 둔다 — 학급 화면의 학년 카드가 이걸 보고 회색 '수업중'
    (잠김) 이 된다. 이 화면이 사라지면 지워야 한다: 방을 나온 뒤에도 회색이 남으면 자기
    수업으로 다시 들어갈 길이 막힌다. 그래서 **소유자는 이 화면**이고, 학급 화면은 읽기만 한다.
    모둠 탭을 옮기면 표시도 따라 옮겨간다 (focusGrade 가 바뀌면 다시 표시).
  */
  const enterLiveGrade = useLiveGradeStore((s) => s.enter)
  const leaveLiveGrade = useLiveGradeStore((s) => s.leave)
  useEffect(() => {
    if (!classroomId || c.sessionId === null) return
    enterLiveGrade(classroomId, c.sessionId, focusGrade)
    return () => leaveLiveGrade(classroomId)
  }, [classroomId, c.sessionId, focusGrade, enterLiveGrade, leaveLiveGrade])

  const focusStudents = useMemo(
    () => c.studentAccounts.filter((a) => a.grade === focusGrade),
    [c.studentAccounts, focusGrade],
  )
  // 이름 대신 userId 를 넘긴다 — 명단이 늦게 오면 이름이 '학생' 이 되어 매칭이 깨졌다
  const handRaisedIds = useMemo(
    () => c.requests.filter((r) => r.type === 'HAND').map((r) => r.id),
    [c.requests],
  )

  // 학생 영상은 팀 룸에만 있다 — 지금 보고 있는 모둠의 팀 룸에 방문해 구독한다
  const { attachStudentVideo, liveUserIds } = useTeamRoomStage(
    c.sessionId,
    c.teamIdByGrade.get(focusGrade) ?? null,
  )

  /**
   * 지금 접속해 있는 학생 userId.
   *
   * 두 곳을 합친다: STOMP 프레즌스(이름)와 팀 룸에서 실제로 영상이 오는 목록(userId).
   * 이름만 보면 명단이 늦게 올 때 매칭이 깨지고, 영상만 보면 카메라를 끈 학생이 빠진다.
   */
  const onlineIds = useMemo(
    () =>
      focusStudents
        .filter((s) => c.onlineNames.has(s.name) || liveUserIds.includes(s.userId))
        .map((s) => s.userId),
    [focusStudents, c.onlineNames, liveUserIds],
  )

  /**
   * 화면에 보여줄 학생 — **순서까지 정해진 목록**이다: 최근 입장이 맨 위, 나간 학생은 5분간
   * 회색으로 남고 그 뒤 사라지며, 한 번도 안 들어온 학생은 아예 없다(useLiveRoster 주석).
   */
  const roster = useLiveRoster(focusStudents, onlineIds)

  /*
    학년 표시는 **지금 들어와 있는 학년 하나**다. 예전엔 학급의 학년을 모두 붙여
    "5,6학년" 이라고 적었는데, 화면이 실제로 보고 있는 건 그중 한 학년의 팀 룸이라
    무대 내용과 어긋나 보였다.
  */
  /*
    상단 칩 — `6학년 3반`. 학년은 지금 들어와 있는 팀 룸의 학년이고, 뒤는 학급 이름이다.
    시안의 "6학년 3반 / 씨앗놀이" 처럼 **학급 이름과 수업 주제를 따로** 적으려면 세션에
    주제 필드가 있어야 하는데 백엔드에 없다 — 그래서 제목은 학급 이름을 그대로 쓴다.
  */
  const gradeLabel = grades.length ? `${focusGrade}학년` : '우리 반'
  const className = c.classroom?.name || '오늘의 수업'

  /**
   * 수업을 시작하며 적은 오늘의 주제 — 없으면 null (`useLessonTopicStore`).
   *
   * 무대 슬라이드는 '오늘의 수업 주제' 라고 적어 놓고 그동안 **학급 이름**을 띄우고 있었다.
   * 주제가 있으면 그 자리를 주제에게 넘긴다 — 이름이 주제 자리에 앉아 있던 셈이었다.
   *
   * **이 수업 세션에 매달려 있다.** 시작할 때 한 번 정하고 끌 때까지 그대로 가며(수업 중에
   * 바꾸지 않는다), 수업을 끝내면 아래 `endSession` 에서 함께 지운다.
   *
   * **학생 화면에는 전해지지 않는다.** 서버에 주제를 담을 자리가 없어 이 브라우저에만
   * 저장되고, 학생 쪽 슬라이드는 여전히 학급 이름을 보여준다(주제를 적는 창이 이 사실을
   * 직접 말한다). 필요한 서버 작업은 `docs/backend-request-lesson-topic.md` 에 있다.
   */
  const lessonTopic = useLessonTopic(c.sessionId, grades.length ? focusGrade : null)
  const clearLessonTopics = useLessonTopicStore((s) => s.clearSession)
  const stageTopic = lessonTopic || className

  /*
    ── Zoom 식 화면(E1) ─────────────────────────────────────────────
    미디어 상태의 **주인이 이 페이지**다. 예전에는 `LiveBroadcastPanel` 안에 있었는데,
    컨트롤이 무대 밖(플로팅 바)으로 나가면서 무대와 바가 같은 상태를 봐야 해졌다.
  */
  const media = useTeacherMedia(classroomId ?? null, c.sessionId)
  const [penOn, setPenOn] = useState(false)
  /**
   * 전체화면 대상은 **무대 + 컨트롤 바를 함께 감싼 왼쪽 카드**다.
   *
   * 무대만 잡으면 컨트롤 바가 무대 밖(형제)이라 전체화면에서 사라진다 — 브라우저는 전체화면
   * 대상의 하위 트리만 top layer 에 그린다. 그러면 마이크도 필기도 끌 수 없고 나갈 길은
   * Esc 뿐이다. 바가 무대 위에 떠 있던 시절에는 무대만 잡아도 됐지만, 바를 아래로 내린
   * 뒤로는 카드를 잡아야 한다.
   */
  const liveRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const { toggle: toggleFullscreen } = useFullscreen(liveRef)

  /*
    '전체 보기'(큰 창으로 타일 보기)는 없앴다 — 선생님 요청. 참여 학생 카드의 타일에 개별
    조작(음소거·카메라·판서 권한·내보내기)이 다 들어 있어서, 큰 창을 여는 길이 없어도
    여기서 할 일은 다 된다. 다시 필요하면 `ModalShell` + `StudentsLivePanel` 조합이다.
  */
  /**
   * 오른쪽 고정 패널이 지금 보여주는 것. **닫힘 상태가 없다** — 늘 열려 있다.
   *
   * 기본은 **학생·도구**다. 수업을 열면 먼저 확인하는 것이 "누가 들어왔나"이고,
   * 무대 위 필름스트립을 걷어낸 뒤로는 학생을 볼 수 있는 자리가 여기뿐이다.
   * 채팅은 새 쪽지가 오면 아래 `chatBadge` 가 탭에 숫자를 띄워 알려 준다.
   */
  const [drawer, setDrawer] = useState<'chat' | 'tools'>('tools')

  /*
    채팅 탭 배지 — **학생 탭을 보는 동안 도착한 학생 메시지 수.**

    `LiveDrawer` 는 처음부터 `chatBadge` 를 받도록 돼 있었는데 아무도 넘기지 않아
    한 번도 뜬 적이 없었다. 선생님은 기본 탭인 '학생'을 보고 있으므로, 아이가 질문을 해도
    채팅 탭을 눌러 보기 전에는 알 수 없었다.

    `liveMessages` 는 수업 중 STOMP 로 도착한 것만 담는다(이력은 REST 로 따로 불러온다).
    그래서 학생 화면(ClassroomPage)처럼 "처음 밀려드는 이력을 새 쪽지로 세지 않으려는"
    유예가 필요 없다 — 빈 배열에서 시작하는 것이 곧 정확한 기준선이다.

    **학생이 보낸 것만 센다.** 내 답장까지 세면 답장할 때마다 배지가 오른다.
  */
  const liveMessages = useLiveStore((s) => s.liveMessages)
  const fromStudents = useMemo(() => liveMessages.filter((m) => !m.teacher).length, [liveMessages])
  const [chatSeen, setChatSeen] = useState(0)
  useEffect(() => {
    if (drawer === 'chat') setChatSeen(fromStudents)
  }, [drawer, fromStudents])
  const chatBadge = Math.max(0, fromStudents - chatSeen)

  return (
    /*
      ── 스크롤 없는 한 화면(100dvh): 위 상단 바 · 아래 [왼쪽 무대 카드 | 오른쪽 패널] ──

      상단 바가 다시 있다. 한때 지웠다가(무대 높이를 아끼려고) 되돌린 이유는 `LiveTopBar`
      주석에 적었다 — 요약하면 오버레이 칩은 방송 위에서 읽히지 않고, 패널을 고르는 버튼이
      방송 조작 버튼과 한 줄에 섞였다.

      오른쪽 패널은 **늘 열려 있다**(토글이 아니다). 여닫으면 그때마다 무대 폭이 바뀌어
      <video> 가 리레이아웃되고 영상이 출렁인다. 상단 바의 두 버튼은 여닫는 스위치가 아니라
      **패널이 무엇을 보여줄지 고르는** 스위치다.

      무대와 패널은 **형제**다(겹치지 않는다). 겹치면 컨트롤 바와 층이 엉키고, 판서 중에는
      캔버스를 가려 획이 끊겨 보인다.
    */
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-page">
      <LiveTopBar
        /* 학년 번호는 색·그림용, 라벨은 글자용 — 학년이 없는 학급이면 grade 만 null 이 된다 */
        grade={grades.length ? focusGrade : null}
        gradeLabel={gradeLabel}
        topic={className}
        lessonTopic={lessonTopic}
        onBack={() => navigate(classDetail)}
      />

      <div className="flex min-h-0 flex-1 gap-3 p-3 max-[900px]:flex-col">
        {/*
          왼쪽 카드 = 무대 + 컨트롤 바. 둘을 한 카드로 감싸는 이유는 두 가지다:
          전체화면 대상이 이 카드여야 바가 함께 커지고(그러지 않으면 전체화면에서 바가
          사라진다), 시각적으로도 "방송하는 것" 한 덩어리로 읽힌다.
        */}
        <div
          ref={liveRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card bg-card p-2.5 shadow-card max-[900px]:flex-[1.6]"
        >
          <div className="min-h-0 flex-1 overflow-hidden rounded-tile">
            <LiveStage
              sessionId={c.sessionId}
              /* 주제를 적었으면 슬라이드 제목은 주제다 — 안 적었으면 예전처럼 학급 이름 */
              topic={stageTopic}
              attachMain={media.attachMain}
              showVideo={media.cameraOn || media.screenSharing}
              screenSharing={media.screenSharing}
              penOn={penOn}
              stageRef={stageRef}
            >
              {/*
                전체 화면 — 무대 **안** 우상단. 영상 플레이어의 관례이고, 무엇이 커지는지가
                자리로 드러난다.

                누르면 커지는 것은 무대가 아니라 **무대를 감싼 카드**(`liveRef`)다. 무대만
                커지면 컨트롤 바가 전체화면 하위 트리 밖이라 사라져서, 마이크도 필기도 끌 수
                없고 나갈 길이 Esc 뿐이 된다.
              */}
              <button
                type="button"
                onClick={toggleFullscreen}
                title="전체 화면"
                aria-label="전체 화면"
                className="absolute right-3 top-3 z-30 inline-flex items-center gap-1.5 rounded-full bg-black/45 p-[8px_13px] text-[.8rem] font-extrabold text-white backdrop-blur-sm transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:bg-black/65"
              >
                <Icon name="expand" className="h-[15px] w-[15px] flex-none" />
                <span className="max-[900px]:hidden">전체 화면</span>
              </button>

              {/*
                PDF 쪽 넘김 — 무대 **안** 우하단.

                컨트롤 바(무대 아래)에 두지 않은 이유가 둘이다. 보고 있는 자료에서 시선이
                내려가지 않아도 되고, **전체 화면일 때도 함께 커진다** — 전체화면 대상은 무대를
                감싼 카드라 바도 같이 오지만, 자료 위에 겹쳐 있는 편이 손이 덜 움직인다.

                `z-[35]`: 판서 캔버스(z-30) 위여야 필기를 켠 채로도 쪽을 넘길 수 있다.
                이 버튼들은 송출에 **찍히지 않는다** — 내보내는 것은 PDF 캔버스 하나뿐이다.
              */}
              {media.shareSource === 'pdf' && (
                <div className="absolute bottom-3 right-3 z-[35] flex items-center gap-1 rounded-full bg-black/55 p-[6px_8px] text-white backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={media.pdfPrev}
                    disabled={media.pdf.page <= 1}
                    aria-label="이전 쪽"
                    className="grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-transparent"
                  >
                    <Icon name="back" className="h-4 w-4" />
                  </button>
                  {/* 지금 몇 쪽이 나가고 있는지 — 자료 자체에는 쪽 표시가 없을 수 있다 */}
                  <span className="min-w-[54px] text-center text-[.85rem] font-black tabular-nums">
                    {media.pdf.pageCount === 0
                      ? '…'
                      : `${media.pdf.page} / ${media.pdf.pageCount}`}
                  </span>
                  <button
                    type="button"
                    onClick={media.pdfNext}
                    disabled={media.pdf.page >= media.pdf.pageCount}
                    aria-label="다음 쪽"
                    className="grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-transparent"
                  >
                    <Icon name="chevronRight" className="h-4 w-4" />
                  </button>
                </div>
              )}
            </LiveStage>
          </div>

          {/*
            컨트롤 바는 무대 **아래 형제**다 — 무대 위에 겹치지 않으므로 방송 화면을 가리지
            않고, 판서 캔버스와 z 다툼도 없다.
          */}
          <LiveControlBar
              classroomId={classroomId}
              micOn={media.micOn}
              cameraOn={media.cameraOn}
              penOn={penOn}
              shareSource={media.shareSource}
              onToggleMic={() => void media.toggleMic()}
              onToggleCamera={() => void media.toggleCamera()}
              onToggleScreenShare={() => void media.toggleScreenShare()}
              onSharePdf={(file) => void media.startPdfShare(file)}
              onStopShare={media.stopShare}
              onTogglePen={() => setPenOn((v) => !v)}
              /* 수업을 끄면 주제도 함께 버린다 — 다음 수업에 지난 주제가 따라오지 않게 */
              onEnd={() => {
                const sid = c.sessionId
                void c.endSession().then(() => {
                  if (sid !== null) clearLessonTopics(sid)
                })
              }}
              ending={c.ended}
              /*
                학급 전체 제어는 학생 패널이 아니라 **여기**다 — 낱개 버튼 네 개를 '전체 제어'
                하나로 접었다. 전체 음소거·카메라 잠금은 방송 조작과 같은 성격(수업 진행을
                바꾸는 일)이고, 학생 패널은 학생 한 명씩 만지는 자리로 남는다.
              */
              micLocked={c.mutedMicIds.length > 0}
              camLocked={c.disabledCamIds.length > 0}
              onMuteAll={() => void c.muteAll()}
              onCamAll={() => void c.camOffAll()}
              /* 전체 판서 — 한 명이라도 권한이 있으면 다음 동작은 '거두기'다(전체 음소거와 같은 규칙) */
              boardOpen={c.boardGrantIds.length > 0}
              onBoardAll={(grant) => void c.grantBoardAll(grant)}
              /* 쉬는시간 잠금도 빠른 도구 패널에서 여기로 올라왔다 */
              breakLocked={c.broadcastLocked}
              breakPending={c.lockPending}
              onToggleBreak={() => void c.toggleBreakLock()}
          />
        </div>

        <LiveDrawer
          focus={drawer}
          onFocus={setDrawer}
          /* 탭에 적는 수는 **발급 인원**이다 — 접속 인원은 카드 머리글이 `3/6명` 으로 말한다 */
          studentCount={focusStudents.length}
          handCount={handRaisedIds.length}
          chatBadge={chatBadge}
          chat={
            /*
              **지금 보고 있는 학년의 학생만** 넘긴다. 학급 전체 명단을 넘기던 때는 3학년 수업
              중에 보낸 전체 공지가 1학년 아이에게도 갔다 — 공지는 명단을 돌며 한 명씩 배달되므로
              (LiveChatPanel.submitGroup) 명단이 곧 수신자다. 같은 화면의 타일·모둠은 이미
              focusStudents 로 좁혀 그리고 있어, 채팅 패널만 다른 기준을 보고 있었다.
            */
            <LiveChatPanel sessionId={c.sessionId} students={focusStudents} send={c.send} />
          }
          tools={
            /*
              카드 한 장 안을 나눠 쓴다: 참여 학생이 남는 높이를 다 먹고(flex-1),
              '학습자료 / 과제' 는 맨 아래 한 줄. 사이 간격(gap)을 두지 않는다 —
              둘은 구분선으로 나뉜 **같은 카드의 두 영역**이다.
            */
            <div className="flex h-full min-h-0 flex-col">
              {/*
                학생 화면 — 아이 얼굴은 수업 내내 보여야 하므로 오른쪽 패널 **맨 위**다.
                타일 안에 개별 조작(음소거·카메라·판서 권한·내보내기)이 다 들어 있고,
                좁아서 잘 안 보일 때 '전체 보기' 로 크게 연다.
              */}
              <ParticipantsCard
                students={focusStudents}
                onlineNames={c.onlineNames}
                liveUserIds={liveUserIds}
              >
                <StudentsLivePanel
                  entries={roster}
                  emptyText={
                    focusStudents.length === 0
                      ? '이 학년에 발급된 학생이 없어요.\n‘학급 관리’에서 계정을 만들어 주세요.'
                      : '아직 들어온 학생이 없어요.\n학생이 들어오면 여기에 바로 나와요.'
                  }
                  handRaisedIds={handRaisedIds}
                  onClearHands={c.clearHands}
                  attachStudentVideo={attachStudentVideo}
                  liveUserIds={liveUserIds}
                  boardGrantIds={c.boardGrantIds}
                  onToggleBoardGrant={(userId, grant) => void c.toggleBoardGrant(userId, grant)}
                  onKick={(userId, name) => void c.kickParticipant(userId, name)}
                  mutedIds={c.mutedMicIds}
                  camOffIds={c.disabledCamIds}
                  onToggleStudentMute={(userId, muted) => void c.muteStudent(userId, muted)}
                  onToggleStudentCam={(userId, disabled) => void c.camStudent(userId, disabled)}
                  /*
                    **이 값은 열 수만 정한다** — 실제 타일 폭은 `1fr` 이라 패널 폭에서 나온다.
                    420px 패널에서 2열이 되는 범위(약 130~185)면 결과가 같다. 타일을 키우려면
                    이 숫자가 아니라 패널 폭(LiveDrawer)을 넓혀야 한다.
                    3열로 내려가면 타일이 120px 아래가 되어 타일 안 조작 버튼이 넘친다.
                  */
                  minTile={150}
                />
              </ParticipantsCard>

              {/*
                '학습자료 / 과제' 는 **모달**로 열린다 — 패널 내용을 갈아 끼우지 않으므로
                작업하는 동안에도 학생 얼굴이 그대로 남고, 닫으면 원래 자리로 돌아온다.
              */}
              <LiveToolsPanel
                onWorkspace={() =>
                  openModal({ type: 'liveWorkspace', classroomId: classroomId ?? '' })
                }
              />
            </div>
          }
        />
      </div>

      {/* 수업이 끝났으니 한 단계 위(학급 화면)로 — 목록까지 나가지 않는다 */}
      <SessionEndedModal open={c.ended} onExit={() => navigate(classDetail)} />
    </div>
  )
}
