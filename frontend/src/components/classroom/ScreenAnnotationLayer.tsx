import { useScreenAnnotation } from '@/hooks/useScreenAnnotation'
import { AnnotationToolbar } from './AnnotationToolbar'

interface ScreenAnnotationLayerProps {
  /** 그리기 모드 (선생님이 펜을 켰을 때). 학생 화면에서는 항상 false */
  active: boolean
  /** 재접속 시 이미 그려진 판서를 복원할 수업 id */
  sessionId?: number | null
  /** 학생 화면 — 받아서 보기만 한다 */
  readOnly?: boolean
  /**
   * 좌표 기준 영상. **교사·학생 양쪽이 같은 영상을 넘겨야 획이 같은 자리에 찍힌다** —
   * 넘기지 않으면 엔진이 16:10 을 가정하므로 16:9 화면공유에서 위치가 어긋난다.
   */
  backgroundVideo?: HTMLVideoElement | null
}

/**
 * 화면 필기 레이어 — 미디어 스테이지(<video>) 위에 얹는 오버레이 컨테이너.
 *
 * 선생님이 그리면 획이 STOMP 로 나가고, 학생 화면의 같은 레이어가 받아서 영상 위에 겹쳐 그린다
 * (서버는 합성하지 않는다). 좌표는 **배경 영상의 letterbox 박스** 기준 0~1 정규화라,
 * 화면 크기가 달라도 같은 위치에 찍힌다 — 그래서 `backgroundVideo` 를 꼭 넘겨야 한다.
 * 부모(video Card)는 position:relative 여야 하며, 이 레이어는 그 안에 절대배치된다.
 */
export function ScreenAnnotationLayer({
  active,
  sessionId = null,
  readOnly = false,
  backgroundVideo = null,
}: ScreenAnnotationLayerProps) {
  const anno = useScreenAnnotation({ sessionId, readOnly, backgroundVideo })
  const drawable = active && !readOnly

  return (
    <>
      <canvas
        ref={anno.attachCanvas}
        data-active={drawable}
        className="absolute inset-0 z-30 h-full w-full touch-none data-[active=false]:pointer-events-none data-[active=true]:cursor-crosshair"
      />
      {drawable && (
        <AnnotationToolbar
          tool={anno.tool}
          color={anno.color}
          width={anno.width}
          canUndo={anno.canUndo}
          canClear={anno.canClear}
          canClearAll={anno.canClearAll}
          onTool={anno.setTool}
          onColor={anno.setColor}
          onWidth={anno.setWidth}
          onUndo={anno.undo}
          onClear={anno.clear}
        />
      )}
    </>
  )
}
