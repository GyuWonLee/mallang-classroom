import type { ReactNode } from 'react'
import { Icon } from '@/components/common/Icon'
import { cn } from '@/lib/cn'

interface ModalShellProps {
  open: boolean
  onClose?: () => void
  /** 스크린리더용 이름 */
  label: string
  /**
   * 모달 제목 — ref `.modal-head` 는 제목과 닫기 버튼이 **같은 flex 행**이다.
   * 여기에 넘기면 닫기 버튼과 나란히 놓여, 각 모달이 `pr-12` 로 자리를 피할 필요가 없다.
   */
  title?: ReactNode
  /** ref 기본은 460px. 마법사처럼 넓은 모달은 늘려 쓴다 */
  width?: number
  /*
    `scroll` 프롭은 **없앴다.**

    예전엔 이 프롭을 준 모달만 `max-h-[88vh] overflow-y-auto` 를 얻었는데, 12개 중 2개만
    주고 있었다. 나머지는 높이 상한이 없어서 내용이 화면보다 길어지면 카드가 오버레이를
    넘쳐흘렀고, 오버레이가 `place-items-center` 로 가운데 정렬이라 **넘친 만큼이 위아래로
    반씩 잘렸다.** 오버레이에 스크롤도 없어 잘린 부분에 닿을 방법이 아예 없었다
    (화면을 110% 로 키우면 내용이 뷰포트보다 커지기 쉬워 훨씬 자주 걸렸다).

    이제 **오버레이가 스크롤한다.** 모달마다 켜고 끌 것이 아니라 껍데기가 늘 지켜야 하는
    성질이라, 옵션을 없애고 기본 동작으로 만들었다 — 새 모달을 만들 때 프롭을 잊어도 안전하다.
  */
  /** 닫기 버튼을 숨긴다 (수업 종료처럼 반드시 선택해야 하는 경우) */
  hideClose?: boolean
  className?: string
  children: ReactNode
}

/** ref `.modal-sub` — 제목 아래 한 줄 설명. 모달마다 값이 어긋나지 않게 여기 모아 둔다 */
export const MODAL_SUB = 'mb-5 text-[.88rem] font-medium text-ink-soft'

/**
 * 모달 공용 껍데기 — 레퍼런스 teacher.html `.modal-overlay` / `.modal-card` 이관.
 *
 * 값(라운드 32px, 패딩, 그림자, 오버레이 색·블러, 팝 애니메이션)을 여기 한 곳에만 두고
 * 모든 모달이 같은 언어를 쓰게 한다 (컴포넌트마다 클래스를 복붙하면 금방 어긋난다).
 * 배경 클릭으로 닫히고, 우상단에 항상 명시적 닫기 버튼을 둔다 (DESIGN_GUIDELINES 6장).
 */
export function ModalShell({
  open,
  onClose,
  label,
  title,
  width = 460,
  hideClose = false,
  className,
  children,
}: ModalShellProps) {
  if (!open) return null

  const showClose = !hideClose && !!onClose

  /** 카드 밖(오버레이·여백)을 눌렀을 때만 닫는다 — 카드 안쪽 클릭은 통과시킨다 */
  const closeOnBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose?.()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={closeOnBackdrop}
      /*
        오버레이가 스크롤을 맡는다. 카드에 높이 상한을 걸어 안쪽을 스크롤시키는 방법도 있지만,
        그러면 스크롤 주체가 카드라 **모달마다 안쪽 목록의 상한과 이중으로 겹친다.**
        여기서 스크롤하면 긴 모달은 화면 가장자리의 평범한 스크롤바로 내려볼 수 있다.
      */
      className="fixed inset-0 z-[80] overflow-y-auto bg-[rgba(63,61,86,.45)] p-5 backdrop-blur-[4px]"
    >
      {/*
        `min-h-full` + `items-center` 가 핵심이다. 내용이 짧으면 화면 가운데에 놓이고,
        화면보다 길어지면 위에서부터 자라며 오버레이가 스크롤된다 — **어느 쪽이든 잘리지 않는다.**
        예전 `grid place-items-center` 는 길어질 때 넘친 만큼을 위아래로 반씩 잘라 버렸다.

        닫기 판정을 여기에도 붙인다: 이 래퍼가 오버레이를 꽉 채우므로 카드 옆 빈자리를 누르면
        `currentTarget` 이 오버레이가 아니라 이 래퍼다(안 붙이면 배경 클릭이 먹지 않는다).
      */}
      <div
        onClick={closeOnBackdrop}
        className="flex min-h-full items-center justify-center"
      >
        <div
          style={{ width: `min(${width}px, 100%)` }}
          className={cn(
            // ref .modal-card + @media(max-width:640px) 축소 패딩
            'relative animate-modal-in rounded-[32px] bg-card p-[32px_34px_30px] shadow-[0_30px_80px_rgba(0,0,0,.3)] max-[640px]:p-[24px_20px]',
            className,
          )}
        >
          {/* ref .modal-head — 제목과 닫기가 같은 flex 행. title 을 안 넘긴 모달은
              제목이 children 안에 있으므로 예전처럼 우상단에 띄워 둔다 (겹침 방지). */}
          {title !== undefined ? (
            <div className="mb-1.5 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">{title}</div>
              {showClose && <CloseButton onClose={onClose!} />}
            </div>
          ) : (
            showClose && (
              <div className="absolute right-[34px] top-8 z-1 max-[640px]:right-5 max-[640px]:top-6">
                <CloseButton onClose={onClose!} />
              </div>
            )
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

/** ref .modal-close — 38px 원형, 배경 --bg, hover 는 배경색만 바뀐다(부상 없음) */
function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="닫기"
      onClick={onClose}
      className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full bg-canvas text-ink-soft transition-colors hover:bg-track"
    >
      <Icon name="close" className="h-[13px] w-[13px]" />
    </button>
  )
}
