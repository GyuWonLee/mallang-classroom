import { useCallback, useState, type ReactNode } from 'react'
import { ScreenAnnotationLayer } from '@/components/classroom/ScreenAnnotationLayer'
import { LessonSlide } from '@/components/classroom/LessonSlide'
import { cn } from '@/lib/cn'

/**
 * 선생님 방송 **무대**만 담당한다 — 수업 주제 슬라이드 · 실제 영상 · 판서 레이어.
 *
 * `LiveBroadcastPanel` 에서 떼어냈다. 이유: Zoom 식 화면(E1)에서 컨트롤이 무대 **밖**
 * 플로팅 바로 나가면서, 미디어 상태(`useTeacherMedia`)의 주인이 페이지로 올라갔다.
 * 무대는 이제 "받은 것을 그리는" 일만 한다 — 켜고 끄는 일은 컨트롤 바가 한다.
 *
 * 자식(`children`)으로 필름스트립·칩·컨트롤 바를 받는다. 그것들은 무대 **위에 겹쳐야**
 * 하는데(Zoom 처럼), 겹치는 요소가 무대 밖에 있으면 전체화면에서 사라진다 —
 * 브라우저는 전체화면 대상 엘리먼트의 하위 트리만 top layer 에 그린다.
 */
export function LiveStage({
  sessionId,
  topic,
  attachMain,
  showVideo,
  screenSharing,
  penOn,
  stageRef,
  children,
}: {
  sessionId: number | null
  topic: string
  /** 내 방송 <video> 배선 (useTeacherMedia.attachMain) */
  attachMain: (el: HTMLVideoElement | null) => void
  /** 카메라 또는 화면 공유가 켜져 있는지 — 켜지면 영상이 슬라이드를 덮는다 */
  showVideo: boolean
  screenSharing: boolean
  penOn: boolean
  /** 전체화면 대상 — 페이지가 useFullscreen 으로 잡는다 */
  stageRef: React.RefObject<HTMLDivElement | null>
  children?: ReactNode
}) {
  /** 판서 좌표 기준이 되는 내 방송 <video> */
  const [stageVideo, setStageVideo] = useState<HTMLVideoElement | null>(null)
  /**
   * **안정된 콜백이어야 한다.** 인라인 화살표는 렌더마다 새 함수라 React 가 ref 를 떼었다
   * 붙이고, 그 안의 setState 가 또 렌더를 불러 무한 루프가 된다 (학생 화면에서 실제로 겪었다).
   */
  const attachStage = useCallback(
    (el: HTMLVideoElement | null) => {
      attachMain(el)
      setStageVideo((prev) => (prev === el ? prev : el))
    },
    [attachMain],
  )

  return (
    <div
      ref={stageRef}
      className="relative isolate h-full w-full overflow-hidden bg-ink"
    >
      {/*
        방송이 없는 동안은 수업 주제 슬라이드 — 학생 화면과 **같은 컴포넌트**다.

        **방송이 시작되면 감춘다.** 예전에는 깔아 둔 채로 영상만 위에 얹었는데, 화면 공유는
        `object-contain` 이라 위아래(또는 좌우)에 여백이 남고 **그 틈으로 주제 슬라이드가
        비쳤다.** 자료를 띄운 화면에 "오늘의 수업 주제" 가 양옆에 남아 있는 꼴이라 무엇을 보는
        화면인지 흐려진다. 카메라(`object-cover`)일 때는 어차피 다 덮여 티가 안 났을 뿐이다.

        지우지 않고 투명도로 넘기는 이유: 영상이 페이드로 들어오는데 슬라이드가 즉시 사라지면
        그 사이가 검게 번쩍인다.
      */}
      <LessonSlide
        topic={topic}
        className={cn('rounded-none transition-opacity', showVideo && 'opacity-0')}
        hint="카메라나 화면 공유를 켜면 이 자리에서 방송이 시작돼요!"
      />

      {/*
        실제 방송 — 켜지면 슬라이드를 덮는다.
        화면 공유는 `contain`(글자가 잘리면 못 읽는다), 카메라는 `cover`(여백 없이 꽉).

        **좌우 반전(거울)은 내 카메라에만, 여기서만 걸린다.**
        예전엔 아예 걸지 않았다 — "내가 보는 화면 = 학생이 보는 화면" 으로 맞추려던 판단이다.
        그런데 웹캠 원본은 뒤집히지 않은 영상이라 사람 눈에는 반대로 보인다(우리는 거울에
        익숙하다). 손을 드는 방향이 어긋나 자기 화면을 보며 말하기가 어색했다.

        이 반전은 **CSS 뿐**이다 — 송출 트랙은 손대지 않으므로 학생이 받는 영상은 원본
        그대로다(학생 화면 `VideoCard` 도 반전을 걸지 않는다).

        반전하지 않는 경우는 **화면 공유 하나**다 — 공유 화면에는 글자가 있고, 뒤집으면 읽을 수 없다.

        한때 **필기 중**에도 반전을 풀었다. 판서 좌표가 영상과 어긋날까 걱정한 것인데, 실제로는
        어긋나지 않는다: 학생 화면도 선생님 카메라를 같이 뒤집고(`VideoCard`) 판서 레이어는
        양쪽 모두 뒤집지 않으므로, **두 사람이 보는 합성 결과가 똑같다.** 반대로 필기를 켤 때마다
        화면이 좌우로 홱 뒤집히는 것은 그 자체로 놀랄 일이었다. 그래서 지금은 그대로 둔다.
      */}
      <video
        ref={attachStage}
        autoPlay
        muted
        playsInline
        data-show={showVideo}
        data-fit={screenSharing ? 'contain' : 'cover'}
        data-mirror={!screenSharing}
        className={cn(
          'absolute inset-0 z-10 h-full w-full opacity-0 transition-opacity',
          'data-[fit=contain]:object-contain data-[fit=cover]:object-cover data-[show=true]:opacity-100',
          'data-[mirror=true]:-scale-x-100',
        )}
      />

      {/* 판서는 항상 영상 위(z-30 내부) — 좌표 기준으로 내 방송 <video> 를 넘긴다 */}
      <ScreenAnnotationLayer active={penOn} sessionId={sessionId} backgroundVideo={stageVideo} />

      {children}
    </div>
  )
}
