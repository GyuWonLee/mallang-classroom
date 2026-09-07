import { Fragment } from 'react'

/**
 * 단추 얼굴로 쓰는 말랑이 그림 (public/assets, 원본 png 대신 webp).
 * 패널 안에서 쓰는 그림과 **같은 캐릭터**로 맞춘다 — 눌러서 열린 화면과 단추가 이어져 보인다.
 */
const ART: Record<'ai' | 'chat' | 'task', { src: string; size: string }> = {
  ai: { src: '/assets/student_ch.webp', size: 'h-[68px] w-[68px] max-[640px]:h-[52px] max-[640px]:w-[52px]' },
  /*
    1371x1148 (약 1.19:1). 아래 chat 과 같은 이유로 폭을 비율만큼 넓게 주는데, **높이도 함께
    올려야** 한다: `h-[70px] w-[84px]` 였을 때는 높이에 걸려 84x70 으로만 그려져 옆
    `선생님께 질문`(94x70)보다 작아 보였다. 지금은 폭 94px 에 맞춰 94x79 로 그려진다.
  */
  task: {
    src: '/assets/hw_ch.webp',
    size: 'h-[79px] w-[94px] max-w-none max-[640px]:h-[61px] max-[640px]:w-[73px]',
  },
  /*
    **네모 박스를 그림 비율에 맞춰 준다.** `chat_ch` 는 1451x1084(4:3에 가깝고) `student_ch` 는
    1254x1254(정사각)다. 둘에 똑같이 68x68 박스를 주면 `object-contain` 이 편지 말랑이를
    68x51 로 letterbox 해서 **혼자 25% 작아 보였다** — 같은 값을 줬는데 크기가 달라 보이는
    함정이다. 그림이 바뀌면 여기 비율도 함께 봐야 한다.

    `max-w-none` 이 필요하다: 높이를 맞추려면 폭이 94px 이어야 하는데 단추 안쪽은 84px 뿐이라
    그냥 두면 폭이 깎여 다시 납작해진다. 단추보다 살짝 넘치지만 기둥(112px) 안에는 들어간다.
  */
  chat: {
    src: '/assets/chat_ch.webp',
    size: 'h-[70px] w-[94px] max-w-none max-[640px]:h-[54px] max-[640px]:w-[72px]',
  },
}

/** 독이 여는 패널들 — ClassroomPage 의 드로어와 키를 공유한다 */
export type DockPanel = 'ai' | 'tasks' | 'chat'

interface DockItem {
  key: DockPanel
  label: string
  /**
   * 단추 얼굴로 쓸 캐릭터 그림.
   *
   * 예전에는 색 칩 위 선 아이콘(`icon`/`chip`)도 섞여 있었다. 셋 다 그림으로 바뀌면서
   * 그 두 필드와 렌더 분기를 지웠다 — 쓰는 항목이 하나도 없어 죽은 길이 되었고,
   * 아이콘과 그림이 섞이면 같은 기둥 안에서 두 가지 표기법이 부딪혔다.
   */
  art: 'ai' | 'chat' | 'task'
}

/*
  순서는 **활동지 → AI 말랑이 → 선생님께 질문** 이다(선생님이 정한 순서).
  수업 중 가장 자주 여는 것이 오늘 할 일(활동지)이라 맨 위에 둔다.
*/
const ITEMS: DockItem[] = [
  { key: 'tasks', label: '활동지', art: 'task' },
  { key: 'ai', label: 'AI 말랑이', art: 'ai' },
  { key: 'chat', label: '선생님께 질문', art: 'chat' },
]

/**
 * 학생 수업 화면 도구 레일 — 화면 **맨 왼쪽에 세로로 선 흰 기둥**.
 *
 * `AI 말랑이` · `선생님께 질문` · `활동지` 세 문이다. 같은 단추를 다시 누르면 닫힌다.
 * 누르면 **바로 오른쪽에 패널 열이 펼쳐지고 무대가 그만큼 줄어든다**(ClassroomPage) —
 * 무대 위에 떠서 방송을 가리지 않는다.
 *
 * 자리를 여러 번 옮긴 끝에 여기다: 무대 아래 가로 바(세로 120px 을 통째로 먹었다) → 무대 왼쪽
 * 세로 열 → 무대 안 오른쪽 겹침(영상을 가렸다) → 본문 맨 오른쪽 → **맨 왼쪽**(지금).
 * 왼쪽인 이유는 여는 방향과 맞추기 위해서다: 왼쪽 끝에서 눌러 오른쪽으로 펼치면 시선이
 * 읽는 방향과 같이 움직이고, 패널이 늘 같은 자리(레일 옆)에서 나온다.
 *
 * 마이크·카메라·손들기는 여기 없다 — 그건 방송 카드 안 `ControlBar` 가 갖는다. 성격이 다르다:
 * 이 레일은 **무엇을 열지**, 컨트롤 바는 **내 방송을 어떻게 할지**다.
 */
export function StudentDock({
  open,
  onToggle,
  chatBadge = 0,
}: {
  /** 지금 열려 있는 패널 — 눌린 단추 표시와 토글 판단에 쓴다 */
  open: DockPanel | null
  onToggle: (key: DockPanel) => void
  /** '선생님께 질문' 위에 붙는 새 쪽지 수 (0 이면 배지 없음) */
  chatBadge?: number
}) {
  return (
    <nav
      aria-label="수업 도구"
      /*
        독립 기둥. 폭은 **고정**한다 — 라벨 길이에 따라 흔들리면 옆 무대 폭도 함께 흔들린다.

        단추는 **기둥 높이에 퍼져** 놓인다: 사이의 점선(아래 `flex-1`)이 남는 높이를 나눠 먹어
        간격을 만든다. 예전에는 셋이 위에 몰려 있고 아래가 통째로 비어서, 기둥이 길다는 것만
        드러나고 단추는 구석에 처박힌 모양이었다.

        좁은 화면에서도 **세로를 유지한다.** 가로로 눕히면 그 옆에서 열리는 패널과 방향이
        어긋나(위에서 눌러 옆으로 펼침) 단추와 패널의 관계가 끊어진다 — 폭만 줄인다.
      */
      className="flex h-full w-[112px] flex-none flex-col items-stretch rounded-card bg-card p-[14px_8px] shadow-card max-[900px]:w-[96px] max-[640px]:w-[76px] max-[640px]:p-[10px_5px]"
    >
      {ITEMS.map((item, i) => (
        <Fragment key={item.key}>
          {/*
            항목 사이 **점선 이음줄** — 시안의 세로 점 세 개 자리다. 실선이면 기둥이 칸칸이
            나뉘어 보이고, 아무것도 없으면 단추 둘이 붙어 하나처럼 읽힌다.

            `flex-1` 로 **남는 높이를 이 줄들이 나눠 먹는다** — 그래서 단추가 기둥 높이에 고르게
            퍼지고, 벌어진 자리는 점선이 이어 준다(빈 공간이 아니라 연결로 읽힌다).
            `min-h-[18px]` 은 기둥이 짧을 때도 점선이 사라지지 않게 하는 하한이다.
          */}
          {i > 0 && (
            <span
              aria-hidden="true"
              className="mx-auto my-1.5 min-h-[18px] w-px flex-1 border-l border-dashed border-track"
            />
          )}
        <button
          type="button"
          onClick={() => onToggle(item.key)}
          aria-expanded={open === item.key}
          data-on={open === item.key}
          /* 폭은 부모에 맞긴다(w-full) — 둘이 같은 폭이어야 기둥이 반듯하다 */
          className="relative flex w-full flex-none flex-col items-center gap-1 rounded-[18px] p-[10px_6px_8px] transition-colors hover:bg-canvas data-[on=true]:bg-sky max-[640px]:gap-0.5 max-[640px]:p-[6px_3px_5px]"
        >
          {/*
            그림 자리. **높이를 하나로 통일**해 세 라벨이 나란히 선다 — 그림 비율이 서로 달라
            (정사각 / 4:3 / 1.19:1) 각자 폭은 다르지만 이 칸의 높이는 같다.
          */}
          <span className="grid h-[80px] place-items-center max-[640px]:h-[62px]" aria-hidden="true">
            <img
              src={ART[item.art].src}
              alt=""
              decoding="async"
              className={`object-contain ${ART[item.art].size}`}
            />
          </span>
          <span className="whitespace-nowrap text-[.74rem] font-extrabold text-ink max-[640px]:text-[.62rem]">
            {item.label}
          </span>
          {item.key === 'chat' && chatBadge > 0 && (
            <span className="absolute right-3 top-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-danger px-1 text-[.68rem] font-black text-white">
              {chatBadge > 9 ? '9+' : chatBadge}
            </span>
          )}
        </button>
        </Fragment>
      ))}

      {/*
        기둥 맨 아래 **로고**.

        단추를 더 만들지 않은 이유: 지금 학생 화면에 더 열 것이 없어서(설정·비밀번호는 위
        내 메뉴에 있다) 눌러도 아무 일이 없는 단추가 된다 — 빈손 단추는 빈자리보다 나쁘다.

        말랑이 그림 + "오늘도 함께 해요!" 였는데 로고로 바꿨다. 위 단추 두 개가 이미 말랑이
        캐릭터라 같은 얼굴이 셋이 되어 어수선했고, 학생 화면에는 서비스 이름이 나오는 곳이
        없었다. `flex-none` 으로 자기 높이만 쓰고(늘어나면 위 점선 간격을 먹는다),
        기둥이 짧은 작은 화면에서는 접는다.

        장식으로 둔다(`aria-hidden`) — 도구 기둥을 훑는 중에 서비스 이름이 낭독되면 방해다.
      */}
      <div
        aria-hidden="true"
        className="mt-3 flex flex-none items-center justify-center border-t border-dashed border-track pt-3 max-[900px]:hidden"
      >
        <img
          src="/assets/title.webp"
          alt=""
          width={1536}
          height={1024}
          decoding="async"
          className="h-auto w-[78px] object-contain"
        />
      </div>
    </nav>
  )
}
