import { useEffect, type ReactNode } from 'react'
import { Icon, type IconName } from '@/components/common/Icon'
import { cn } from '@/lib/cn'
import { useMediaControls } from '@/hooks/useMediaControls'
import { useAuthStore } from '@/stores/useAuthStore'
import { useClassroomStore } from '@/stores/useClassroomStore'
import { useLiveStore } from '@/stores/useLiveStore'
import { useToastStore } from '@/stores/useToastStore'

interface CtrlButtonProps {
  icon: IconName
  label: string
  /** 켜져 있는지. 마이크/카메라처럼 on/off 가 있는 버튼만 넘긴다(손들기·펜은 raised 를 쓴다) */
  on?: boolean
  raised?: boolean
  /** 선생님이 잠갔는지 — 내가 켤 수 없다는 걸 자물쇠로 알린다 */
  locked?: boolean
  onClick: () => void
  children?: ReactNode
}

/**
 * 컨트롤 버튼.
 *
 * **꺼짐 = 빨강 + 슬래시, 켜짐 = 흰색.** 빨강은 "지금 무언가 막혀 있다"는 신호다 —
 * 마이크가 꺼진 채로 말하는 것이 실제 사고이고, 켜져 있는 건 정상 상태라 조용해야 한다.
 * (예전엔 반대였다: 빨강이 LIVE 를 뜻한다고 보고 **켜짐**을 빨강으로 칠했는데, 평상시
 * 버튼 두 개가 계속 빨간불이라 "문제가 있다"는 신호가 늘 켜져 있는 셈이었다.)
 *
 * 색만으로 구분하지 않으려고 꺼진 쪽에는 슬래시를 함께 그린다 (가이드라인 5장).
 *
 * 상태별 색을 data-* 조합이 아니라 **JS 분기로** 정하는 이유: `data-[on=false]` 와
 * `data-[raised=false]` 처럼 둘 다 맞는 규칙이 같은 속성(배경)을 다투면 어느 쪽이 이길지
 * CSS 출력 순서에 달린다 — 실제로 켜진 버튼에 마우스를 올리면 색이 엉뚱하게 바뀌었다.
 */
function CtrlButton({ icon, label, on, raised, locked, onClick }: CtrlButtonProps) {
  const toggle = on !== undefined
  /** 꺼진 토글만 빨강이다 (손들기·펜은 `on` 이 없어 여기 걸리지 않는다) */
  const off = toggle && !on
  return (
    <button
      type="button"
      aria-label={locked ? `${label} (선생님이 잠갔어요)` : label}
      aria-pressed={toggle ? on : undefined}
      data-on={toggle ? on : undefined}
      data-raised={raised ?? false}
      data-locked={locked ?? false}
      onClick={onClick}
      className={cn(
        'group relative grid h-[58px] w-[58px] place-items-center rounded-full',
        'shadow-[0_8px_20px_rgba(0,0,0,.16)] transition-transform duration-200 ease-bounce',
        'hover:-translate-y-1 hover:scale-105 active:scale-110',
        // 잠긴 버튼은 흐리게 — 누르면 왜 안 되는지 토스트로 알려 준다(막기만 하면 계속 누른다)
        locked && 'opacity-60',
        raised
          ? 'animate-wiggle bg-task'
          : off
            ? 'bg-danger' // 꺼짐 — hover 로 색을 바꾸지 않는다 (경고색이 흔들리면 안 된다)
            : 'bg-white hover:bg-sky',
        'max-[640px]:h-[50px] max-[640px]:w-[50px]',
      )}
    >
      <Icon name={icon} className={cn('h-6 w-6', off ? 'text-white' : 'text-ink')} />
      {/* 선생님이 잠근 표시 — 색·투명도만으로 구분하지 않는다 (가이드라인 5장) */}
      {locked && (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-ink text-white shadow-card">
          <Icon name="key" className="h-3 w-3" />
        </span>
      )}
      {/*
        꺼짐 표시용 슬래시 — 좌하에서 우상으로 (ref x1=3 y1=21 -> x2=21 y2=3).
        꺼진 쪽이 빨간 배경이므로 슬래시는 흰색이어야 보인다.
      */}
      {off && (
        <span className="pointer-events-none absolute h-[2.6px] w-[30px] -rotate-45 rounded-full bg-white" />
      )}
    </button>
  )
}

/**
 * 화상 카드 하단 컨트롤 (마이크/카메라/손들기 + 판서) — ref .controls 이관.
 *
 * 판서 버튼은 **선생님이 권한을 준 학생에게만** 나타난다. 백엔드가 권한 없는 학생의 획을
 * 거절하므로(BoardController), 버튼을 항상 보여주면 눌러도 안 되는 버튼이 된다.
 */
export function ControlBar() {
  const { micOn, cameraOn, micLocked, camLocked, handRaised, toggleMic, toggleCamera, raiseHand } =
    useMediaControls()

  const myId = useAuthStore((s) => s.user?.id)
  const boardGrantIds = useLiveStore((s) => s.boardGrantIds)
  const boardPenOn = useClassroomStore((s) => s.boardPenOn)
  const setBoardPenOn = useClassroomStore((s) => s.setBoardPenOn)
  const showToast = useToastStore((s) => s.show)

  const canDraw = myId !== undefined && boardGrantIds.includes(myId)

  // 권한이 회수되면 그리기 모드도 같이 내린다
  useEffect(() => {
    if (!canDraw && boardPenOn) setBoardPenOn(false)
  }, [canDraw, boardPenOn, setBoardPenOn])

  return (
    // z-40: 그리기 모드에서 판서 캔버스(z-30)가 컨트롤을 덮어 펜을 못 끄는 것을 막는다
    // 전체 화면에서도 하단 그대로다 — 예전엔 아래에 깔리던 선생님 바 + 캐릭터 줄을 피해
    // bottom:250px 로 올렸지만, 전체 화면에서는 그 스택을 더 이상 깔지 않는다(VideoCard).
    <div
      className="absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 gap-4 max-[640px]:bottom-3.5 max-[640px]:gap-3"
    >
      <CtrlButton
        icon="mic"
        label={micLocked ? '마이크 잠김' : micOn ? '마이크 끄기' : '마이크 켜기'}
        on={micOn}
        locked={micLocked}
        onClick={toggleMic}
      />
      <CtrlButton
        icon="cam"
        label={camLocked ? '카메라 잠김' : cameraOn ? '카메라 끄기' : '카메라 켜기'}
        on={cameraOn}
        locked={camLocked}
        onClick={toggleCamera}
      />
      <CtrlButton icon="hand" label="손들기" raised={handRaised} onClick={raiseHand} />
      {canDraw && (
        <CtrlButton
          icon="edit"
          label={boardPenOn ? '칠판에 그리기 끄기' : '칠판에 그리기'}
          raised={boardPenOn}
          onClick={() => {
            const next = !boardPenOn
            setBoardPenOn(next)
            if (next) showToast('칠판에 그릴 수 있어요! 화면에 직접 그려보세요')
          }}
        />
      )}
    </div>
  )
}
