import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/common/Icon'
import { ControlBar } from './ControlBar'
import { LessonSlide } from './LessonSlide'
import { ScreenAnnotationLayer } from './ScreenAnnotationLayer'
import { BreakLockOverlay } from './BreakLockOverlay'
import { NoticeStack } from './NoticeStack'
import { useLiveTimer } from '@/hooks/useLiveTimer'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useVideoHasPicture } from '@/hooks/useVideoHasPicture'
import { useClassroomStore } from '@/stores/useClassroomStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useLiveStore } from '@/stores/useLiveStore'

interface VideoCardProps {
  /** 선생님 원격 비디오를 붙일 <video> 콜백 ref */
  attachVideo: (el: HTMLVideoElement | null) => void
  /** 내 얼굴(셀프뷰)을 붙일 <video> 콜백 ref */
  attachSelfVideo?: (el: HTMLVideoElement | null) => void
  /** 팀 룸에 붙어 내 영상이 선생님에게 전달되는 중인지 */
  publishing?: boolean
  /** 지금 붙어 있는 선생님 트랙이 화면 공유인지 — 잘리지 않게 object-fit 을 바꾼다 */
  screenShare?: boolean
  /** 슬라이드에 적을 오늘의 수업 주제 (선생님 방송 패널과 같은 값) */
  topic?: string
  /** 선생님 판서를 이 영상 위에 겹쳐 그릴 수업 id */
  sessionId?: number | null
  /** 수업 시작 시각 — 경과 시간 타이머 기준. 없으면 타이머를 숨긴다 */
  startedAt?: string | null
  /**
   * 부모가 준 자리를 **꽉 채운다** (학생 화면의 무대 배치).
   * 기본값(false)은 16:10 비율 카드 — 선생님 화면 등 기존 호출부의 모양 그대로다.
   */
  fill?: boolean
  /** 카드 안에 겹쳐 놓을 것들 (전체화면에서도 함께 커진다) */
  children?: ReactNode
}

/** 선생님 라이브 방송 카드 — 유일하게 색이 채워진 카드 (ref .video-card 이관) */
export function VideoCard({
  attachVideo,
  attachSelfVideo,
  publishing,
  screenShare = false,
  topic = '오늘의 수업',
  sessionId = null,
  startedAt = null,
  fill = false,
  children,
}: VideoCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  /** 판서 좌표 기준이 되는 선생님 방송 <video> (ScreenAnnotationLayer 로 내려간다) */
  const [stageVideo, setStageVideo] = useState<HTMLVideoElement | null>(null)
  const time = useLiveTimer(startedAt)
  const fullscreen = useClassroomStore((s) => s.fullscreen)
  const status = useClassroomStore((s) => s.signalingStatus)
  const cameraOn = useClassroomStore((s) => s.cameraOn)
  const boardPenOn = useClassroomStore((s) => s.boardPenOn)
  const myId = useAuthStore((s) => s.user?.id)
  const boardGrantIds = useLiveStore((s) => s.boardGrantIds)
  const canDraw = myId !== undefined && boardGrantIds.includes(myId)
  const { toggle } = useFullscreen(cardRef)
  /**
   * 지금 선생님 그림이 실제로 오고 있는지 — <video> 와 네이티브 트랙에서 직접 본다.
   * "트랙이 붙었는지"만으로는 부족하다: 선생님이 카메라를 끄면 트랙은
   * 그대로 있고 그림만 멈춘다. 반대로 우리 쪽 장부가 틀려도 그림이 오면 이 값이 켜지므로
   * **방송이 나오는데 슬라이드가 덮고 있는** 상태로는 굳지 않는다.
   */
  const hasPicture = useVideoHasPicture(stageVideo)

  /**
   * 스트림 배선(부모의 attachVideo) + 판서 좌표 기준 등록을 한 번에 하는 **안정된** ref.
   * 같은 엘리먼트면 상태를 다시 세우지 않는다 — 세우면 리렌더가 돌고 ref 가 또 불린다.
   */
  const attachStage = useCallback(
    (el: HTMLVideoElement | null) => {
      attachVideo(el)
      setStageVideo((prev) => (prev === el ? prev : el))
    },
    [attachVideo],
  )

  return (
    // isolate: 카드 안의 z-index 가 페이지 전체와 섞이지 않게 고정한다
    <div
      ref={cardRef}
      data-full={fullscreen}
      className={`relative isolate overflow-hidden rounded-card bg-sky shadow-card-lg data-[full=true]:aspect-auto data-[full=true]:h-full data-[full=true]:w-full data-[full=true]:rounded-none max-[640px]:data-[full=true]:aspect-auto ${
        fill
          ? // 무대 모드 — 부모(flex-1 min-h-0)가 정한 자리를 그대로 채운다. 비율을 걸면
            // 화면 높이가 남거나 넘친다 (학생 화면은 100dvh 안에서 헤더·독이 높이를 나눠 쓴다)
            'h-full w-full'
          : 'aspect-[16/10] min-h-[380px] flex-none max-[1120px]:min-h-0 max-[640px]:aspect-[16/11]'
      }`}
    >
      {/*
        <video> 를 **항상 마운트한다.** 예전엔 `status === 'connected'` 일 때만 렌더해서,
        LiveKit 이 접속 도중(`room.connect()` 가 resolve 되기 전)에 트랙을 구독하면 붙일
        엘리먼트가 아직 없었다 — 콜백 ref 가 뒤늦게 메워주긴 하지만, 재접속으로 status 가
        connecting 으로 떨어질 때마다 엘리먼트가 언마운트됐다가 새로 생기면서 선생님 화면이
        빈 채로 남는 경우가 있었다. 항상 두면 붙일 곳이 사라지지 않는다.

        화면 공유는 `contain` — 세로로 긴 화면을 `cover` 로 채우면 좌우(또는 위아래)가 잘려
        정작 보여주려던 내용이 안 보인다. 카메라는 여백 없이 꽉 채우는 `cover` 가 자연스럽다.
        어느 쪽인지는 LiveKit 트랙의 source 로 판별한다(useStudentStage).

        **선생님 카메라는 거울처럼 좌우를 뒤집는다** (`-scale-x-100`, CSS 뿐 — 받는 트랙은
        원본 그대로다). 선생님 무대(LiveStage)가 자기 카메라를 거울로 보므로, 학생도 같은
        방향을 봐야 "선생님이 보는 화면 = 학생이 보는 화면"이 유지된다. 화면 공유는 절대
        뒤집지 않는다 — 글자를 못 읽는다.

        대가: 선생님이 카메라에 책이나 글씨를 비추면 여기서 뒤집혀 보인다(그건 화면 공유로
        보여주는 게 맞다). 그리고 선생님이 영상 위에 필기하는 동안은 선생님 쪽 무대가
        원본으로 돌아가므로(LiveStage 의 penOn 예외) 그 순간 획과 그림이 좌우로 어긋날 수
        있다 — 학생은 선생님의 필기 상태를 모르니 여기서는 구분하지 못한다.
      */}
      <video
        /*
          콜백 ref 는 **반드시 안정된 함수**여야 한다 (useCallback).

          인라인 화살표로 두면 렌더마다 새 함수라 React 가 매 커밋에서 ref 를 `null` 로
          정리하고 다시 붙인다. 그 안에서 `setStageVideo` 가 null -> el 로 상태를 바꾸므로
          리렌더가 또 일어나고, 또 새 ref 가 만들어져 **무한 루프**가 됐다.
          그 사이 <video> 가 끊임없이 재바인딩돼 선생님 영상이 화면에 못 붙었다.
        */
        ref={attachStage}
        autoPlay
        muted
        playsInline
        data-screen={screenShare}
        className="absolute inset-0 h-full w-full object-cover [object-position:center_30%] data-[screen=false]:-scale-x-100 data-[screen=true]:bg-ink data-[screen=true]:object-contain data-[screen=true]:[object-position:center]"
      />

      {/*
        아직 방송이 안 붙었을 때 영상 위에 덮는 안내.

        기다리는 상태는 **교실 일러스트**(title_bg — 빈 칠판 교실)를 깔고, 안내 문구를 칠판 위에
        분필 글씨처럼 얹는다. 그림이 아주 가로로 길어서(약 4.3:1) cover 로 깔면 어느 화면에서든
        가운데 칠판 부분이 남는다 — 문구를 가운데 두면 칠판 위에 앉는 이유다. 마스코트는 그림
        왼쪽 끝(연단)이라 잘려 나가므로, 투명 배경 마스코트(student_ch)를 칠판 오른쪽에 따로
        세운다(목업의 "칠판 앞 캐릭터" 자리).

        **오류는 일러스트를 쓰지 않는다** — 예전에 배경 사진 위에 LIVE 칩이 함께 떠서 연결이
        실패해도 방송이 나오는 것처럼 보였던 사고가 있다. 잘못된 상태는 장식 없이 그대로 말한다.
      */}
      {status === 'error' ? (
        <div className="absolute inset-0 z-[20] grid place-items-center bg-sky p-6 text-center">
          <div className="flex flex-col items-center gap-2.5">
            <Icon name="alert" className="h-12 w-12 text-primary" />
            <p className="text-[1.05rem] font-black text-ink">수업에 연결하지 못했어요</p>
            <p className="text-[.85rem] font-medium text-ink-soft">
              새로고침한 뒤 다시 들어와 주세요.
            </p>
          </div>
        </div>
      ) : (
        !hasPicture && (
          /*
            보여줄 방송이 없는 동안은 **선생님이 보고 있는 것과 같은 화면**을 깐다 —
            수업 주제 슬라이드(LessonSlide, ref .bpn-slide). 예전엔 여기 교실 일러스트와
            '선생님 방송을 기다리고 있어요' 가 있었고, 그것도 `status !== 'connected'` 일
            때만 나왔다. 그래서 접속은 됐는데 선생님이 카메라를 안 켠 흔한 상황에서는
            **아무것도 없는 검은 화면**이 남았다.

            아래 문구는 학생 기준으로 적는다 — 켜는 사람은 학생이 아니라 선생님이다.
          */
          <div className="absolute inset-0 z-[20]">
            <LessonSlide
              topic={topic}
              className="rounded-none"
              hint={
                status === 'connected'
                  ? '선생님이 카메라나 화면 공유를 켜면 여기에 바로 나와요.'
                  : '수업을 기다리는 중이에요...'
              }
            />
          </div>
        )
      )}

      {/*
        z-35: 판서 캔버스(z-30) 위에 둔다. 예전엔 z-auto 라 그림이 LIVE 칩·타이머·전체화면 버튼과
        아래 "내 얼굴" 화면을 덮어버렸고, 전체화면 버튼은 캔버스가 클릭까지 가로채 눌리지 않았다.
        (컨트롤바는 같은 이유로 이미 z-40 에 올려져 있다)
      */}
      {/*
        LIVE 칩 + 경과 시간 — **연결됐을 때만** 보여준다.
        미연결 상태에서도 떠 있어서 "지금 방송 중"이라는 거짓 신호를 줬다.
      */}
      {status === 'connected' && (
        <span className="absolute left-[18px] top-[18px] z-[35] flex items-center gap-[9px] rounded-full bg-white p-[8px_16px] text-[.85rem] font-black shadow-[0_4px_14px_rgba(0,0,0,.10)]">
          <span className="flex items-center gap-1.5 rounded-full bg-danger p-[3px_10px] text-[.75rem] text-white">
            <span className="h-[7px] w-[7px] animate-pulse-dot rounded-full bg-white" aria-hidden="true" />
            LIVE
          </span>
          <span className="font-black text-ink">{time}</span>
        </span>
      )}

      {/* 전체 화면 버튼 */}
      <button
        type="button"
        aria-pressed={fullscreen}
        onClick={toggle}
        className="absolute right-[18px] top-[18px] z-[35] flex items-center gap-2 rounded-full bg-white p-[9px_16px_9px_10px] text-[.85rem] font-black text-ink shadow-[0_4px_14px_rgba(0,0,0,.10)] transition-transform duration-200 ease-bounce hover:-translate-y-0.5 active:scale-105"
      >
        <Icon name="fullscreen" className="h-[18px] w-[18px] text-primary" />
        {fullscreen ? '화면 나가기' : '전체 화면'}
      </button>

      {/*
        공유 칠판 — 선생님/권한 받은 학생이 그린 획이 모두 이 위에 겹쳐 보인다.
        권한이 없으면 보기 전용(readOnly)이라 캔버스가 포인터를 먹지 않는다.
      */}
      {/* 선생님 방송 영상을 좌표 기준으로 넘긴다 — 안 넘기면 16:10 가정이라 획이 어긋난다 */}
      <ScreenAnnotationLayer
        active={canDraw && boardPenOn}
        readOnly={!canDraw}
        sessionId={sessionId}
        backgroundVideo={stageVideo}
      />

      {/*
        내 얼굴(셀프뷰) — 좌하단 작은 화면. 로컬 미리보기라 수업에 접속하지 않아도 보인다.

        **거울처럼 좌우를 뒤집는다** (`-scale-x-100`). 웹캠 원본은 뒤집히지 않은 영상이라
        사람 눈에는 반대로 보인다 — 아이가 자기 얼굴을 보며 "내가 반대로 나온다" 고 느낀다.
        선생님 무대(`LiveStage`)와 같은 처리다.

        반전은 **CSS 뿐**이다 — 송출 트랙은 손대지 않으므로 선생님이 받는 영상은 원본 그대로다
        (선생님 화면의 학생 타일도 반전을 걸지 않는다). "왼손 들어볼까?" 는 그대로 통한다:
        아이는 화면이 아니라 자기 몸으로 손을 든다.

        대신 아이가 공책이나 글씨를 카메라에 비추면 **자기 화면에서만** 뒤집혀 보인다
        (선생님 쪽은 정상). 얼굴을 보는 시간이 훨씬 길어 이쪽을 택했다.
      */}
      {attachSelfVideo && (
        /*
          ref 의 .video-card 안에는 셀프뷰가 없다 — 기능은 살리되 시각 밸런스를 깨지 않게 작게(104px) 둔다.

          위치는 **좌하단 모서리**(left/bottom 18px)로 LIVE 칩(left/top 18px)과 같은 여백을 쓴다.
          예전엔 bottom:92px 이었다 — 컨트롤 바(bottom 20 + 높이 58 = 78~92px)에 겹치지 않으려고
          위로 밀어둔 값이라 모서리에서 붕 떠 보였다. 컨트롤 바는 카드 **가운데** 정렬이고
          (left-1/2 -translate-x-1/2) 셀프뷰는 104px 폭이라, 모서리로 내려도 서로 닿지 않는다.

          전체 화면에서도 같은 자리다. 예전엔 하단 스택(선생님 바 + 캐릭터 줄) 높이만큼
          `bottom-[322px]` 로 밀어 올렸는데, 그 스택을 없앴으므로 밀 이유도 없어졌다 —
          그대로 두면 셀프뷰가 화면 중간에 붕 뜬다.
        */
        <div
          data-on={cameraOn}
          className="absolute bottom-[18px] left-[18px] z-[35] w-[104px] overflow-hidden rounded-[14px] border border-white/80 bg-ink-mute opacity-0 shadow-[0_4px_12px_rgba(0,0,0,.16)] transition-opacity data-[on=true]:opacity-100 max-[640px]:bottom-3.5 max-[640px]:left-3.5 max-[640px]:w-[84px]"
        >
          <video
            ref={attachSelfVideo}
            autoPlay
            muted
            playsInline
            className="block aspect-[4/3] w-full -scale-x-100 object-cover"
          />
          <span className="absolute bottom-1 left-1 rounded-full bg-black/50 px-1.5 py-[1px] text-[.58rem] font-black text-white">
            내 얼굴{publishing ? '' : ' · 나만 보여요'}
          </span>
        </div>
      )}

      {/*
        마이크·카메라·손들기 — **이 카드 안**이다.

        한 번 무대 아래(카드 밖)로 내려 봤다가 되돌렸다. 카드 안이어야 하는 이유가 둘이다:
        전체화면이 이 카드 단위로 걸리므로 밖에 두면 전체화면에서 단추가 사라지고,
        방송을 조작하는 것들이라 방송 화면과 한 덩어리로 있는 편이 손에 맞는다.
      */}
      <ControlBar />

      {/* 쉬는시간 잠금 — 이 카드(캠 영역)만 덮는다. 과제·쪽지는 계속 쓸 수 있다 */}
      <BreakLockOverlay />

      {/*
        공지·쪽지·새 과제 알림 — **반드시 이 카드 안**이어야 한다. 전체화면은 이 카드 div 를
        대상으로 걸리고, 브라우저는 그 하위 트리만 top layer 에 그리기 때문에 페이지 레벨
        토스트는 전체화면 중 보이지 않는다(z-index 로 해결되지 않음).
      */}
      <NoticeStack />

      {/* 카드 안에 겹치는 것들(학생 독) — 전체화면에서도 함께 커진다 */}
      {children}

      {/*
        전체 화면에는 선생님 바·캐릭터 줄(= '채팅 열기')을 **깔지 않는다.**

        예전에는 ref 를 따라 전체화면일 때만 이 카드 안쪽 하단에 둘을 쌓았다. 그런데 전체화면의
        목적은 화면 공유를 크게 보는 것이고, 하단 스택이 250px 을 먹으면서 정작 봐야 할 영상이
        그만큼 작아졌다. 선생님 라이브 화면은 이미 반대로 되어 있다 — LiveBroadcastPanel 은
        무대만 전체화면 대상으로 잡고 컨트롤을 그 밖에 둬서 전체화면에서 자연히 사라진다.

        평상시(비전체화면) 선생님 바·캐릭터 줄은 ClassroomPage 가 카드 **밖**에 그대로 렌더한다.
      */}
    </div>
  )
}
