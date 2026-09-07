import { Icon } from '@/components/common/Icon'
import { cn } from '@/lib/cn'
import type { RosterEntry } from '@/hooks/useLiveRoster'
import type { StudentAccount } from '@/types/teacher'

interface StudentsLivePanelProps {
  /**
   * 보여줄 학생 — **순서까지 정해진 목록**이다(`useLiveRoster`).
   *
   * 예전엔 발급 명단(`students`)과 접속 이름 집합(`onlineNames`)을 따로 받아 여기서 합쳤다.
   * 지금은 "누가 보이고 어떤 순서인가"(최근 입장 순 · 나간 학생 5분 유예 · 미입장 제외)가
   * 화면 규칙이라 훅으로 옮겼다 — 이 패널은 받은 순서대로 그리기만 한다.
   */
  entries: RosterEntry[]
  /** 아무도 없을 때 적을 말 — "발급된 학생이 없다"와 "아직 안 들어왔다"는 다른 상황이다 */
  emptyText?: string
  /**
   * 손든 학생 **userId**. 예전엔 이름 문자열로 맞췄는데, 명단(REST 로스터)이 아직 안 오면
   * 이름이 '학생' 으로 떨어져 어떤 타일과도 안 맞아 **손 배지가 아예 안 떴다**(간헐적 누락).
   * 동명이인이 있는 복식학급에서 엉뚱한 타일이 켜지는 문제도 함께 없어진다.
   */
  handRaisedIds: number[]
  onClearHands: () => void
  /*
    전체 제어(전체 음소거·전체 카메라 끄기·켜 달라고 하기)와 모둠 헤더는 여기서 빠졌다 —
    네 버튼은 하단 컨트롤 바의 '전체 제어' 하나로 묶여 갔고(`LiveControlBar`), 학년 이름은
    무대 좌상단 칩에 이미 있다. 이 패널은 **학생 한 명씩** 보고 만지는 자리다.
  */
  /*
    `onAssign`("이 모둠에 과제 내주기")은 없앴다 — 모둠 헤더에 있었지만 실제로는 과제를
    내주지 못하고 학급 관리 → 과제 탭으로 **보내기만** 했다(수업 화면을 떠나게 만들었다).
    과제는 같은 화면의 '학습자료 · 과제' 작업판에서 모달로 만들 수 있다.
  */
  /** 팀 룸에서 받은 학생 영상을 붙일 <video> 콜백 ref 팩토리 */
  attachStudentVideo?: (userId: number) => (el: HTMLVideoElement | null) => void
  /** 지금 영상이 들어오고 있는 학생 userId */
  liveUserIds?: number[]
  /** 판서 권한을 가진 학생 userId */
  boardGrantIds?: number[]
  onToggleBoardGrant?: (userId: number, grant: boolean) => void
  /**
   * 수업 중 강퇴 (백엔드 S15P11A407-137). **학급에서 빼는 게 아니라** 지금 수업에서만
   * 내보낸다. 되돌릴 수 없어 확인을 거치므로 부모가 콜백을 준다.
   */
  onKick?: (userId: number, name: string) => void
  /**
   * 타일 최소 폭(px). 좁은 오른쪽 패널(380px)에서는 작게, '전체 보기' 창에서는 크게 쓴다.
   * 값이 크면 한 줄에 들어가는 타일이 줄어드는 대신 얼굴이 커진다.
   */
  minTile?: number
  /**
   * 마이크/카메라가 **서버에서** 잠긴 학생 userId (GET /state 스냅샷).
   *
   * 예전엔 이 패널이 로컬 `Set` 으로 들고 있었다 — 타일 버튼을 누르면 여기서만 회색이 되고
   * 학생에게는 아무 일도 없었다. 잠금은 서버 상태이므로 원천도 서버여야 한다.
   */
  mutedIds?: number[]
  camOffIds?: number[]
  /** 학생 한 명 잠금 토글 — 서버에 보내고 스냅샷을 다시 읽는다 */
  onToggleStudentMute?: (userId: number, muted: boolean) => void
  onToggleStudentCam?: (userId: number, disabled: boolean) => void
}

/** 학생 타일 — 레퍼런스 .student-tile 이관 */
function StudentTile({
  acc,
  online,
  hand,
  muted,
  camOff,
  hasVideo,
  attachVideo,
  canDraw,
  onToggleMute,
  onToggleCam,
  onToggleDraw,
  onKick,
}: {
  acc: StudentAccount
  online: boolean
  hand: boolean
  muted: boolean
  camOff: boolean
  hasVideo: boolean
  attachVideo?: (el: HTMLVideoElement | null) => void
  canDraw: boolean
  onToggleMute: () => void
  onToggleCam: () => void
  onToggleDraw?: () => void
  onKick?: () => void
}) {
  // 영상이 오면 아바타 대신 얼굴을 보여준다
  const showVideo = hasVideo && !camOff
  return (
    <div
      /*
        **회색은 오프라인 하나만 뜻한다.** 예전엔 `camOff || !online` 로 카메라를 잠근 학생도
        같은 회색이 됐다 — 들어와 있는 아이인지 나간 아이인지 색으로 구분되지 않았다.
        카메라 잠금은 타일 우상단 버튼이 빨강 + 사선으로 이미 말한다.
      */
      data-offline={!online}
      /*
        비율은 **16:10**이다. 4:3 이었을 때는 좁은 패널(2열)에서 6명이면 세로 3줄이 되어
        마지막 줄이 스크롤 밖으로 밀려났다 — 얼굴은 가로로 넓게 잡히므로, 세로를 깎아도
        잃는 것이 적다(웹캠 원본도 16:9 쪽에 가깝다).
      */
      className="relative flex aspect-[16/10] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[18px] bg-sky shadow-card data-[offline=true]:bg-[#DDE1E8]"
    >
      {/*
        **거울처럼 좌우를 뒤집는다** (`-scale-x-100`) — 선생님 요청.
        내 카메라(`LiveStage`)·학생 셀프뷰(`VideoCard`)와 같은 처리로, 이 화면의 모든 얼굴이
        같은 방향을 본다. 반전은 **CSS 뿐**이라 학생이 송출하는 트랙은 그대로다.

        대가: 학생이 공책이나 글씨를 카메라에 비추면 여기서 **뒤집혀 보인다.** 글씨를 읽어야
        할 때는 학생에게 화면 공유를 받거나 과제로 제출받는 편이 낫다.
      */}
      {attachVideo && (
        <video
          ref={attachVideo}
          autoPlay
          muted
          playsInline
          data-show={showVideo}
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover opacity-0 transition-opacity data-[show=true]:opacity-100"
        />
      )}

      <span
        data-hidden={showVideo}
        data-offline={!online}
        className="grid h-12 w-12 place-items-center rounded-full bg-white text-[.9rem] font-black text-primary data-[offline=true]:text-ink-mute data-[hidden=true]:hidden"
      >
        {acc.name.slice(0, 1)}
      </span>

      {/*
        손들기 배지 — 타일 **왼쪽 위**. 오른쪽 위는 마이크·카메라·판서·내보내기 단추가 쓰므로
        비어 있는 왼쪽이 자리다.

        키웠다(26 → 32px). 12px 아이콘은 작은 타일(2열 140px) 위에서 노란 점처럼만 보여서,
        선생님이 흔들리는 것을 눈치채기 전에는 손인지 알 수 없었다. 흔들림(`animate-wiggle`)과
        흰 테두리를 함께 둬서 영상 위에서도 배지가 뜬다.
      */}
      {hand && (
        <span
          title={`${acc.name} 학생이 손을 들었어요`}
          aria-label={`${acc.name} 학생이 손을 들었어요`}
          className="absolute left-2 top-2 grid h-8 w-8 animate-wiggle place-items-center rounded-full border-2 border-white bg-task text-task-deep shadow-[0_2px_8px_rgba(0,0,0,.18)]"
        >
          <Icon name="hand" className="h-4 w-4" />
        </span>
      )}

      {/*
        잠긴 상태는 **색과 모양 둘 다** 바꾼다 — 빨강만으로는 구분되지 않는다(색각 이상,
        저채도 화면, 작은 26px 원). 사선이 그려진 `micOff`·`camOff` 아이콘으로 갈아 끼운다.
        학생 화면 `ControlBar` 와 같은 규칙이다.
      */}
      <div className="absolute right-2 top-2 flex gap-[5px]">
        <button
          type="button"
          aria-label={muted ? '음소거 해제' : '음소거'}
          onClick={onToggleMute}
          className={cn(
            'grid h-[26px] w-[26px] place-items-center rounded-full transition-transform hover:scale-110',
            muted ? 'bg-danger text-white' : 'bg-white/90 text-ink',
          )}
        >
          <Icon name={muted ? 'micOff' : 'mic'} className="h-[13px] w-[13px]" />
        </button>
        <button
          type="button"
          aria-label={camOff ? '카메라 켜기' : '카메라 끄기'}
          onClick={onToggleCam}
          className={cn(
            'grid h-[26px] w-[26px] place-items-center rounded-full transition-transform hover:scale-110',
            camOff ? 'bg-danger text-white' : 'bg-white/90 text-ink',
          )}
        >
          <Icon name={camOff ? 'camOff' : 'cam'} className="h-[13px] w-[13px]" />
        </button>
        {onToggleDraw && (
          <button
            type="button"
            aria-label={canDraw ? '판서 권한 회수' : '판서 권한 주기'}
            aria-pressed={canDraw}
            title={canDraw ? '판서 권한 회수' : '판서 권한 주기'}
            onClick={onToggleDraw}
            className={cn(
              'grid h-[26px] w-[26px] place-items-center rounded-full transition-transform hover:scale-110',
              canDraw ? 'bg-task text-task-deep' : 'bg-white/90 text-ink',
            )}
          >
            <Icon name="edit" className="h-[13px] w-[13px]" />
          </button>
        )}
        {/*
          강퇴는 되돌릴 수 없어 다른 버튼과 같은 무게로 두면 안 된다 — **접속 중일 때만**
          보여주고(안 들어온 학생을 내보낼 일은 없다), 색도 다른 토글과 구분한다.
        */}
        {onKick && online && (
          <button
            type="button"
            aria-label={`${acc.name} 학생 내보내기`}
            title="이 수업에서 내보내기"
            onClick={onKick}
            className="grid h-[26px] w-[26px] place-items-center rounded-full bg-white/90 text-ink transition-transform hover:scale-110 hover:bg-danger hover:text-white"
          >
            <Icon name="logout" className="h-[13px] w-[13px]" />
          </button>
        )}
      </div>

      {/*
        ref .tile-name 은 이름만 적는다. 오프라인은 라벨에 덧붙이지 않고 타일 상태(cam-off 회색
        배경 + 흐린 아바타)로 드러낸다 — 이름 줄이 길어지면 정작 이름이 잘린다.
      */}
      <span
        title={online ? acc.name : `${acc.name} (아직 안 들어왔어요)`}
        className="absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate rounded-full bg-black/45 px-2.5 py-[3px] text-[.72rem] font-extrabold text-white"
      >
        {acc.name}
      </span>
    </div>
  )
}

/** 학생 패널 — 손들기 배너 + 학생 타일 그리드 */
export function StudentsLivePanel({
  entries,
  emptyText = '아직 들어온 학생이 없어요.',
  handRaisedIds,
  onClearHands,
  attachStudentVideo,
  liveUserIds = [],
  boardGrantIds = [],
  onToggleBoardGrant,
  onKick,
  minTile = 150,
  mutedIds = [],
  camOffIds = [],
  onToggleStudentMute,
  onToggleStudentCam,
}: StudentsLivePanelProps) {
  // 배너 문구용 — 지금 보이는 학생 중 손든 학생 이름
  const handNames = entries
    .filter((e) => handRaisedIds.includes(e.acc.userId))
    .map((e) => e.acc.name)

  return (
    <div className="flex flex-col gap-2.5">
      {/* 손들기 배너 — 이 모둠 밖 학생이 든 손도 놓치지 않게 전체 인원 수로 안내한다 */}
      {handRaisedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[18px] bg-task-soft p-[12px_18px] text-[.88rem] font-extrabold text-task-deep">
          <Icon name="hand" className="h-[18px] w-[18px] flex-none animate-wiggle" />
          <span className="flex-1">
            {handNames.length > 0 ? `${handNames.join(', ')} 학생이 손을 들었어요` : '손을 든 학생이 있어요'}
            {handRaisedIds.length > handNames.length && ` (다른 학생 ${handRaisedIds.length - handNames.length}명 포함)`}
          </span>
          {/*
            "내리기"가 아니라 "확인했어요"다. 백엔드에는 교사가 학생 손을 내리는 API 가 없고
            (학생이 토글하는 구조) 이 버튼은 **선생님 화면에서만** 배너를 치운다.
            예전 "모두 내리기" 라벨은 서버 상태까지 내린 것처럼 보여서, 그 뒤 학생이 손을 다시
            누르면 서버 토글이 꺼지며 아무 알림도 안 뜨는 혼란을 만들었다.
          */}
          <button
            type="button"
            onClick={onClearHands}
            title="선생님 화면에서만 배너를 치워요. 학생 손은 학생이 내려요."
            className="rounded-full bg-white px-3.5 py-1.5 text-[.78rem] font-black text-task-deep"
          >
            확인했어요
          </button>
        </div>
      )}

      {/* 학생 타일 그리드 — 최소 폭은 호출부가 정한다(패널이 좁으면 작게) */}
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${minTile}px,1fr))` }}
      >
        {/* `whitespace-pre-line` — 호출부가 `\n` 으로 줄을 나눈다(문구가 두 줄이다) */}
        {entries.length === 0 && (
          <div className="col-span-full whitespace-pre-line rounded-card-md bg-canvas p-8 text-center text-[.9rem] font-medium leading-[1.6] text-ink-mute">
            {emptyText}
          </div>
        )}
        {entries.map(({ acc, online }) => (
          <StudentTile
            key={acc.userId}
            acc={acc}
            online={online}
            hand={handRaisedIds.includes(acc.userId)}
            muted={mutedIds.includes(acc.userId)}
            camOff={camOffIds.includes(acc.userId)}
            hasVideo={liveUserIds.includes(acc.userId)}
            attachVideo={attachStudentVideo?.(acc.userId)}
            canDraw={boardGrantIds.includes(acc.userId)}
            onToggleDraw={
              onToggleBoardGrant &&
              (() => onToggleBoardGrant(acc.userId, !boardGrantIds.includes(acc.userId)))
            }
            onToggleMute={() =>
              onToggleStudentMute?.(acc.userId, !mutedIds.includes(acc.userId))
            }
            onToggleCam={() => onToggleStudentCam?.(acc.userId, !camOffIds.includes(acc.userId))}
            onKick={onKick && (() => onKick(acc.userId, acc.name))}
          />
        ))}
      </div>
    </div>
  )
}
