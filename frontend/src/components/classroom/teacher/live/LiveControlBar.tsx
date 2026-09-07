import { useRef, useState } from 'react'
import { Icon, type IconName } from '@/components/common/Icon'
import { cn } from '@/lib/cn'
import type { ShareSource } from '@/hooks/useTeacherMedia'
import { warmPdfjs } from '@/services/media/pdfjs'
import { PickLessonMaterialModal } from '@/components/classroom/teacher/live/PickLessonMaterialModal'

/**
 * 무대 하단에 떠 있는 컨트롤 바 — Zoom 하단 바.
 *
 * 예전엔 방송 패널 안에 "글자가 붙은 사각 필" 4개가 한 줄로 있었다. 무대가 화면을 꽉 채우게
 * 되면서 그 줄이 무대를 밀어낼 자리가 없어졌고, 무대 **위에 겹치는** 바로 옮겼다.
 *
 * 형태는 여전히 **아이콘 + 글자**다. 색만으로 상태를 구분하지 않는다는 규칙(가이드라인 2장)은
 * 자리가 바뀌어도 그대로다 — 좁은 화면에서만 글자를 접는다.
 *
 * 켜짐/꺼짐 색 규칙은 학생 화면 컨트롤과 맞춘다: **꺼짐 = 빨강**, 켬(공유·판서) = 하늘,
 * 평상시 = 흰색. 빨강은 "지금 막혀 있다"는 경고이므로 정상 상태에 쓰지 않는다.
 */
function Btn({
  icon,
  label,
  tone = 'idle',
  onClick,
  badge,
}: {
  icon: IconName
  label: string
  /** idle 흰색 · off 빨강(꺼짐) · active 하늘(켜 둔 기능) · break 노랑(쉬는시간) · danger 종료 */
  tone?: 'idle' | 'off' | 'active' | 'break' | 'danger'
  onClick: () => void
  /** 안 읽은 수 같은 숫자 배지 (0 이면 안 그린다) */
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'relative inline-flex min-h-[42px] items-center gap-2 rounded-[14px] border-[1.5px] p-[10px_14px] text-[.84rem] font-extrabold',
        'transition-transform duration-200 ease-bounce hover:-translate-y-px',
        tone === 'idle' && 'border-live-line bg-card text-ink',
        tone === 'off' && 'border-[#F5C9C2] bg-danger-soft text-danger',
        tone === 'active' && 'border-[#BFDBF3] bg-sky text-primary',
        tone === 'break' && 'border-task-deep bg-task text-task-deep',
        tone === 'danger' && 'border-danger bg-danger text-white',
      )}
    >
      <Icon name={icon} className="h-[17px] w-[17px] flex-none" />
      {/* 좁은 화면에서는 아이콘만 — 바가 무대를 가리는 것보다 낫다 */}
      <span className="max-[900px]:hidden">{label}</span>
      {badge != null && badge > 0 && (
        <span className="absolute -right-1 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-danger px-1 text-[.66rem] font-black text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

/**
 * 학급 전체 제어를 **버튼 하나**로 묶은 것 — 열면 위로 작은 메뉴가 뜬다.
 *
 * 예전엔 학생 패널 안에 낱개 버튼 네 개(전체 음소거 / 전체 카메라 끄기 / 마이크·카메라
 * 켜 달라고 하기)가 한 줄로 있었다. 넷 다 **학급 전체에 한 번에 가는** 동작이라 자주 쓰지
 * 않는데도 자리를 많이 차지했고, 되돌리기 번거로운 잠금이 학생 타일과 같은 무게로 보였다.
 * 하나로 접으면 바가 짧아지고, 한 겹 열어야 눌리므로 실수로 학급을 잠그는 일도 줄어든다.
 * '켜 달라고 하기' 두 개는 그 뒤 아예 없앴다(아래 주석 참고) — 지금 남은 건 잠금 둘이다.
 *
 * 잠금 중이면 버튼 자체가 빨강이 된다 — 접혀 있어도 "지금 뭔가 막혀 있다"가 보여야 한다.
 */
function ClassControls({
  micLocked,
  camLocked,
  boardOpen,
  onMuteAll,
  onCamAll,
  onBoardAll,
}: {
  micLocked: boolean
  camLocked: boolean
  /** 지금 판서 권한을 가진 학생이 한 명이라도 있는지 — 문구를 상태에 맞춘다 */
  boardOpen: boolean
  onMuteAll: () => void
  onCamAll: () => void
  onBoardAll: (grant: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const locked = micLocked || camLocked

  /** 메뉴 한 줄 — 누르면 실행하고 닫는다 (연달아 잠글 일은 없다) */
  const item = (icon: IconName, label: string, run: () => void, tone?: 'danger') => (
    <button
      type="button"
      onClick={() => {
        run()
        setOpen(false)
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[12px] p-[10px_12px] text-left text-[.84rem] font-extrabold',
        tone === 'danger' ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-sky',
      )}
    >
      <Icon name={icon} className="h-[17px] w-[17px] flex-none" />
      {label}
    </button>
  )

  return (
    <div className="relative">
      {open && (
        <>
          {/*
            바깥 클릭으로 닫는 투명 막 — 무대 전체를 덮는다(fixed). z 는 메뉴보다 낮고
            컨트롤 바보다 높다: 막이 없으면 메뉴를 닫으려 누른 곳이 그대로 다른 버튼을
            누른다(전체화면이 켜지는 등).
          */}
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute bottom-[calc(100%+10px)] left-1/2 z-50 w-[228px] -translate-x-1/2 rounded-[16px] border-[1.5px] border-live-line bg-white p-1.5 shadow-card-lg">
            {/*
              문구가 상태를 따라간다 — 이미 잠겨 있는데 "전체 음소거"라고 적혀 있으면
              선생님은 다시 눌러 잠긴 줄 알고 자리를 비운다(실제로는 해제된다).
              잠금 여부는 서버 스냅샷(GET /state.mutedMic)이 원천이다.
            */}
            {item(
              micLocked ? 'mic' : 'micOff',
              micLocked ? '마이크 잠금 해제' : '전체 음소거',
              onMuteAll,
              micLocked ? undefined : 'danger',
            )}
            {item(
              camLocked ? 'cam' : 'camOff',
              camLocked ? '카메라 잠금 해제' : '전체 카메라 끄기',
              onCamAll,
              camLocked ? undefined : 'danger',
            )}
            {/*
              '마이크·카메라 켜 달라고 하기' 는 없앴다 — 선생님 요청.
              강제가 아니라 알림이라(서버는 MEDIA_REQUEST 만 방송하고 실제로 켜는 건 학생이다)
              눌러도 화면에 아무 변화가 없었고, 말로 하면 되는 일이었다.
              서버 API(`sessionApi.requestMedia`)와 학생 쪽 수신은 그대로 남아 있다.
            */}

            <span aria-hidden="true" className="my-1 block h-px bg-track" />

            {/*
              **전체 판서** — 마이크·카메라와 성격이 반대다(막는 것이 아니라 여는 것). 그래서
              구분선 아래에 두고 색도 danger 를 쓰지 않는다.

              학생 한 명씩 주는 길은 학생 타일의 연필 단추가 그대로 갖고 있다. 여기는 "다 같이
              칠판에 써 보자" 를 한 번에 하는 자리다 — 낱개로 하려면 스무 번을 눌러야 했다.
            */}
            {item(
              'edit',
              boardOpen ? '권한 없애기' : '모두에게 판서 열기',
              () => onBoardAll(!boardOpen),
            )}
          </div>
        </>
      )}
      {/*
        평소엔 students 아이콘 — 이 묶음의 대상이 '학급 전체'다(자물쇠는 옆의 쉬는 시간이 쓴다).

        **잠겨 있으면 사선 아이콘으로 갈아 끼운다.** 빨강만으로 알리면 색각 이상이나 저채도
        화면에서 구분되지 않는다.

        라벨은 늘 '전체 제어' 다. 한때 '카메라 잠김' 처럼 상태를 적었는데, 이 값은 학생
        **한 명**만 잠가도 참이 되므로 반 전체가 잠긴 것처럼 과장해 읽혔다. 누가 잠겼는지는
        학생 타일이 정확히 보여주고, 이 버튼은 "여기 잠긴 게 있다" 까지만 알린다.
      */}
      <Btn
        icon={micLocked ? 'micOff' : camLocked ? 'camOff' : 'students'}
        label="전체 제어"
        tone={locked ? 'off' : open ? 'active' : 'idle'}
        onClick={() => setOpen((v) => !v)}
      />
    </div>
  )
}

/**
 * 공유 — **한 버튼에 두 갈래**(화면 공유 / PDF 발표)를 담은 드롭다운.
 *
 * 둘을 나란히 놓지 않은 이유: LiveKit 의 화면 소스는 하나뿐이라 **동시에 켤 수 없는데**,
 * 버튼이 둘이면 둘 다 켜 두려다 한쪽이 조용히 꺼지는 것처럼 보인다. 하나를 고르는 자리로
 * 만들면 배타 관계가 모양에 드러난다. (옆 '전체 제어' 와 같은 형태다)
 *
 * 켜져 있는 동안에는 드롭다운 대신 **끄기**가 된다.
 *
 * 쪽 넘김은 여기 없다 — 무대 우하단에 겹쳐 둔다(`TeacherClassroomPage`). 보고 있는 자료
 * 바로 위에서 넘기는 편이 시선이 덜 움직이고, 전체 화면일 때도 함께 커진다.
 */
function ShareControls({
  classroomId,
  shareSource,
  onShareScreen,
  onSharePdf,
  onStopShare,
}: {
  /** 학습자료 목록을 부르는 데 쓴다 — 수업 중 공유할 PDF 를 여기서 고른다 */
  classroomId: string | undefined
  shareSource: ShareSource
  onShareScreen: () => void
  onSharePdf: (file: File) => void
  onStopShare: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pickingMaterial, setPickingMaterial] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const pick = (run: () => void) => {
    setOpen(false)
    run()
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // 같은 파일을 다시 고를 수 있게 즉시 비운다 (끄고 같은 자료를 또 여는 흐름)
          e.target.value = ''
          if (file) onSharePdf(file)
        }}
      />

      <div className="relative">
        {open && (
          <>
            {/* 바깥 클릭으로 닫는 투명 막 — 없으면 닫으려 누른 곳이 다른 버튼을 누른다 */}
            <button
              type="button"
              aria-label="메뉴 닫기"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div className="absolute bottom-[calc(100%+10px)] left-1/2 z-50 w-[236px] -translate-x-1/2 rounded-[16px] border-[1.5px] border-live-line bg-white p-1.5 shadow-card-lg">
              <button
                type="button"
                onClick={() => pick(onShareScreen)}
                className="flex w-full items-center gap-2.5 rounded-[12px] p-[10px_12px] text-left text-[.84rem] font-extrabold text-ink hover:bg-sky"
              >
                <Icon name="screen" className="h-[17px] w-[17px] flex-none" />
                화면 공유
              </button>
              {/*
                **수업 자료를 먼저 둔다.** 띄울 PDF 는 대개 학급에 이미 올라가 있는 것이다 —
                과제를 만들려고 올렸고 확인까지 마친 그 파일이다. 수업 중에 폴더를 뒤지는 것은
                그대로 수업이 멈추는 시간이라, 디스크에서 고르는 길은 아래로 내린다.
              */}
              {classroomId && (
                <button
                  type="button"
                  onClick={() => {
                    warmPdfjs()
                    pick(() => setPickingMaterial(true))
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[12px] p-[10px_12px] text-left text-[.84rem] font-extrabold text-ink hover:bg-sky"
                >
                  <Icon name="folder" className="h-[17px] w-[17px] flex-none" />
                  수업 자료에서 고르기
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  /*
                    파일 대화상자를 여는 순간 pdf.js 를 미리 받는다. 고르는 몇 초가 그대로
                    내려받는 시간이 되어, 고른 뒤 기다림이 사라진다(services/media/pdfjs 주석).
                  */
                  warmPdfjs()
                  pick(() => fileRef.current?.click())
                }}
                className="flex w-full items-center gap-2.5 rounded-[12px] p-[10px_12px] text-left text-[.84rem] font-extrabold text-ink hover:bg-sky"
              >
                <Icon name="doc" className="h-[17px] w-[17px] flex-none" />
                내 컴퓨터에서 PDF 고르기
              </button>
              {/*
                무엇이 다른지 한 줄로 알린다 — 선생님 화면은 "왜 갈래가 둘인가"를 스스로
                설명해야 한다. 창을 옮겨 다닐 필요가 없다는 것이 PDF 쪽의 유일한 이유다.
              */}
            </div>
          </>
        )}

        {pickingMaterial && classroomId && (
          <PickLessonMaterialModal
            classroomId={classroomId}
            onPick={(file) => {
              setPickingMaterial(false)
              onSharePdf(file)
            }}
            onClose={() => setPickingMaterial(false)}
          />
        )}

        <Btn
          icon={shareSource === 'pdf' ? 'doc' : 'screen'}
          label={
            shareSource === 'pdf' ? 'PDF 끄기' : shareSource === 'display' ? '공유 중지' : '공유'
          }
          tone={shareSource ? 'active' : 'idle'}
          onClick={() => (shareSource ? onStopShare() : setOpen((v) => !v))}
        />
      </div>
    </>
  )
}

export function LiveControlBar({
  classroomId,
  micOn,
  cameraOn,
  penOn,
  shareSource,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onSharePdf,
  onStopShare,
  onTogglePen,
  onEnd,
  ending,
  micLocked = false,
  camLocked = false,
  boardOpen = false,
  onMuteAll,
  onCamAll,
  onBoardAll,
  breakLocked,
  breakPending,
  onToggleBreak,
}: {
  /** 수업 자료에서 공유할 PDF 를 고를 때 쓴다 */
  classroomId: string | undefined
  micOn: boolean
  cameraOn: boolean
  penOn: boolean
  /** 지금 내보내는 것 — 화면 / PDF / 없음 */
  shareSource: ShareSource
  onSharePdf: (file: File) => void
  onStopShare: () => void
  /*
    '채팅'·'학생·도구' 버튼은 없앴다 — 오른쪽 패널은 늘 열려 있고 **패널 자신이 탭을
    갖고 있어서**, 같은 스위치가 두 군데 있는 셈이었다. 바는 방송 조작만 갖는다.
  */
  onToggleMic: () => void
  onToggleCamera: () => void
  onToggleScreenShare: () => void
  onTogglePen: () => void
  onEnd: () => void
  ending?: boolean
  /** 지금 학급 전체 마이크/카메라가 잠겨 있는지 — '전체 제어' 문구·색을 상태에 맞춘다 */
  micLocked?: boolean
  camLocked?: boolean
  onMuteAll: () => void
  onCamAll: () => void
  /** 판서 권한을 가진 학생이 한 명이라도 있는지 */
  boardOpen?: boolean
  /** 학급 전체 판서 권한 주기/거두기 */
  onBoardAll: (grant: boolean) => void
  /**
   * 쉬는시간 잠금 — 빠른 도구 패널에서 옮겨 왔다. 학생 전원의 화면을 덮는 동작이라
   * 방송 조작과 같은 무게이고, 급히 잠글 때 스크롤을 내리지 않아도 된다.
   * 상태는 서버(STOMP)가 알려준 값이다.
   */
  breakLocked: boolean
  breakPending?: boolean
  onToggleBreak: () => void
}) {
  return (
    /*
      무대 **아래** 한 줄 — 겹치지 않는다.

      한때 무대 위에 떠 있는(absolute + backdrop-blur) 바였다. 무대가 방송이면 영상 위에
      반투명 판이 얹혀 아이 얼굴을 가렸고, 판서를 켜면 캔버스와 층 다툼이 났다(z-40 으로
      눌러 두어야 펜을 끌 수 있었다). 무대 밖으로 내리면 그 두 문제가 함께 없어진다.

      가운데 정렬 + wrap: 버튼이 7개라 좁은 창에서는 두 줄이 되어야 한다. 줄이 늘면 무대가
      그만큼 줄어들 뿐, 눌러야 하는 버튼이 화면 밖으로 밀려나지 않는다.
    */
    <div className="flex flex-none justify-center p-2">
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-[20px] bg-card p-2">
        <Btn
          icon={micOn ? 'mic' : 'micOff'}
          label={micOn ? '음소거' : '음소거 해제'}
          tone={micOn ? 'idle' : 'off'}
          onClick={onToggleMic}
        />
        <Btn
          icon={cameraOn ? 'cam' : 'camOff'}
          label={cameraOn ? '카메라 끄기' : '카메라 켜기'}
          tone={cameraOn ? 'idle' : 'off'}
          onClick={onToggleCamera}
        />
        {/* 화면 공유와 PDF 발표가 한 버튼에 들어간다 — 둘은 동시에 켤 수 없다 */}
        <ShareControls
          classroomId={classroomId}
          shareSource={shareSource}
          onShareScreen={onToggleScreenShare}
          onSharePdf={onSharePdf}
          onStopShare={onStopShare}
        />
        <Btn
          icon="edit"
          label={penOn ? '끄기' : '필기'}
          tone={penOn ? 'active' : 'idle'}
          onClick={onTogglePen}
        />

        {/* 구분선 — 왼쪽은 '내 방송', 오른쪽은 '학급·도구' 라는 두 묶음이다 */}
        <span aria-hidden="true" className="mx-1 h-7 w-px flex-none bg-track" />

        <ClassControls
          micLocked={micLocked}
          camLocked={camLocked}
          boardOpen={boardOpen}
          onMuteAll={onMuteAll}
          onCamAll={onCamAll}
          onBoardAll={onBoardAll}
        />
        {/*
          쉬는 시간 — 잠긴 동안은 노랑(task)으로 켜 둔 상태를 보여준다. 빨강을 쓰지 않는
          이유는 이것이 고장·차단이 아니라 **의도한 쉬는시간**이기 때문이다. 문구도
          상태를 따라간다: 잠겨 있으면 다음 동작인 '수업 재개'가 적힌다.

          아이콘은 커피잔이다. 자물쇠(`lock`)를 쓰다가 바꿨다 — 옆의 '전체 제어'(학급 미디어
          잠금)와 그림이 겹쳐서, 나란히 놓인 두 버튼이 같은 종류의 '잠금'으로 보였다.
        */}
        <Btn
          icon="coffee"
          label={breakPending ? '바꾸는 중…' : breakLocked ? '수업 재개' : '쉬는 시간'}
          tone={breakLocked ? 'break' : 'idle'}
          onClick={onToggleBreak}
        />
        {/* 전체 화면은 무대 우상단으로 옮겼다 — 영상 플레이어의 관례이고, 바는 방송 조작만 갖는다 */}
        <Btn
          icon="close"
          label={ending ? '종료 중…' : '수업 종료'}
          tone="danger"
          onClick={onEnd}
        />
      </div>
    </div>
  )
}
