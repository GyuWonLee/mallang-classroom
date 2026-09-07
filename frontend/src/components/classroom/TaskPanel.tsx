import { useMemo, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import type { DailyTask } from '@/types/classroom'
import { useTaskStore, selectDoneCount } from '@/stores/useTaskStore'
import { useClassroomStore } from '@/stores/useClassroomStore'
import { useOpenModal } from '@/stores/useModalStore'
import starCh from '@/assets/characters/ch1-2.webp'

/**
 * 상태별 겉모습 — 카드 색·번호 원·꼬리표를 **한 곳에서** 정한다.
 *
 * 시안의 왼쪽 위 꼬리표(`진행중` / `잠겨있어요`)를 따르되 **자물쇠는 쓰지 않는다.** 우리 활동지는
 * 순서대로 잠기지 않고 아무 것이나 먼저 풀 수 있다 — 열리는 것에 자물쇠를 그리면 화면이
 * 거짓말을 한다. 그래서 아직 안 한 것은 `아직 안 했어요` 로만 적는다.
 */
const LOOK = {
  next: {
    card: 'border-task bg-task-soft',
    num: 'bg-task-deep text-white',
    tag: 'bg-task text-task-deep',
    /** 버튼은 셋 다 **같은 크기**고 색만 상태를 따른다 (아래 CTA 주석) */
    cta: 'bg-task text-task-deep',
    label: '진행중',
  },
  done: {
    card: 'border-success-deep/30 bg-success/40',
    num: 'bg-success-deep text-white',
    tag: 'bg-success-deep text-white',
    cta: 'bg-success-deep text-white',
    label: '완료',
  },
  todo: {
    /*
      테두리는 `sky-deep`(#cbe0f5) 이다. 예전엔 `canvas`(#fbfbfb) 였는데 흰 카드 위 흰 선이라
      **테두리가 있는지조차 안 보였다** — 진행중·완료 카드는 색 있는 배경으로 경계가 잡히는데
      이 카드만 배경이 흰색이라 테두리가 유일한 윤곽이다. 꼬리표·버튼과 같은 하늘색 계열로
      맞춰 셋이 한 카드의 것임이 색으로 이어진다.
    */
    card: 'border-sky-deep bg-card',
    num: 'bg-primary text-white',
    tag: 'bg-sky text-primary',
    cta: 'bg-sky text-primary',
    label: '아직 안 했어요',
  },
} as const

function TaskRow({ task }: { task: DailyTask }) {
  const setView = useClassroomStore((s) => s.setView)
  const setQuizAssignmentId = useClassroomStore((s) => s.setQuizAssignmentId)
  const openModal = useOpenModal()

  const done = task.status === 'done'
  const look = LOOK[task.status]

  const handleAction = () => {
    if (done) {
      /*
        다 푼 과제는 **내가 쓴 답을 되돌아보게** 한다 (GET .../submissions/me, -129).
        예전엔 퀴즈를 처음부터 다시 열어서, 아이가 무엇을 틀렸는지 보려다 재제출을 하게 됐다
        (서버는 재제출을 허용하고 최신 시도만 세므로 원래 기록이 밀려났다).
      */
      openModal({ type: 'myAnswers', assignmentId: Number(task.id), title: task.title })
      return
    }
    /*
      받아쓰기(read)도 퀴즈 화면이 푼다 — `QuizView` 에 받아쓰기 렌더러(문장 듣기 + 입력)가
      이미 있고 TTS 컨트롤러(`POST /api/tts`)도 구현돼 있다. `task.id = assignmentId`.
    */
    setQuizAssignmentId(task.id)
    setView('quiz')
  }

  return (
    /*
      꼬리표가 카드 위변에 걸치므로(`-top-2`) 카드에 `mt-2` 를 준다 — 안 주면 위 카드와 겹친다.
      `overflow` 를 자르지 않는 것도 그래서다(잘리면 꼬리표가 반만 보인다).
    */
    /*
      카드 사이 간격은 16px(`mt-4`)이다 — 8px 였을 때는 카드 둘이 붙어 하나처럼 읽혔고, 위변에
      걸친 꼬리표가 위 카드의 아래변에 닿았다. 첫 카드만 8px(`first:mt-2`): 스크롤 상자의
      위 패딩 8px 이 이미 꼬리표 자리를 벌어 두었으므로 그만큼 덜 준다.
    */
    <div
      className={`relative mt-4 rounded-[18px] border-2 p-[14px_16px_13px] first:mt-2 ${look.card}`}
    >
      {/*
        상태 꼬리표 — **오른쪽 위**.

        왼쪽에 뒀을 때는 바로 아래 번호 원과 세로로 겹쳐 보여서, 둘이 한 덩어리인지 별개인지
        읽히지 않았다. 오른쪽으로 보내면 왼쪽 열은 번호, 오른쪽 위는 상태로 역할이 갈린다.
      */}
      <span
        className={`absolute -top-2 right-4 rounded-full px-2.5 py-[3px] text-[.66rem] font-black ${look.tag}`}
      >
        {look.label}
      </span>

      <div className="flex items-center gap-3">
        <span
          className={`grid h-9 w-9 flex-none place-items-center rounded-full text-[.92rem] font-black ${look.num}`}
          aria-label={done ? '완료됨' : undefined}
        >
          {done ? <Icon name="check" className="h-[18px] w-[18px]" /> : task.order}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[.98rem] font-black">{task.title}</p>
          {/*
            문항 수·점수를 부제와 한 줄에 둔다 — 줄을 새로 만들면 목록이 세로로 길어져
            한눈에 보이는 활동지가 줄어든다.

            상세를 아직 못 읽었으면(problemCount === null) 아무것도 그리지 않는다 —
            개수를 지어내지 않는다. 점수도 `null` 이면 배지를 안 그린다: 채점 전과 0점을
            같은 모양으로 보여주면 다 맞힌 아이가 0점으로 오해한다.
          */}
          <div className="mt-[3px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[.78rem] font-bold text-ink-soft">
            {task.problemCount !== null && (
              <span className="inline-flex items-center gap-1">
                <Icon name="list" className="h-[13px] w-[13px] text-ink-mute" />
                {task.problemCount}문제
              </span>
            )}
            {task.score !== null && (
              <>
                <span aria-hidden="true" className="text-ink-mute">
                  |
                </span>
                <span className="font-black text-xp-deep">{task.score}점</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/*
        버튼은 셋 다 **같은 모양·같은 크기**(`이어하기` 기준: 전체 폭 · min-h-11 · .92rem)이고
        **색만** 상태를 따른다.

        예전엔 진행중만 넓은 노란 버튼이고 나머지는 작은 흰 테두리 버튼이었다. 크기와 색이 함께
        달라지니 셋이 다른 종류의 단추처럼 보였고, 정작 하는 일은 모두 "이 활동으로 들어가기"
        하나다. 크기를 맞추고 색만 카드와 맞추면 무엇이 어느 활동의 단추인지가 색으로 이어진다.
      */}
      <button
        type="button"
        onClick={handleAction}
        className={`mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full p-[11px_18px] text-[.92rem] font-black transition-transform duration-200 ease-bounce hover:-translate-y-0.5 active:scale-[1.02] ${look.cta}`}
      >
        {done ? '내 답안 보기' : task.status === 'next' ? '이어하기' : '시작하기'}
        <Icon name="play" className="h-[18px] w-[18px]" />
      </button>
    </div>
  )
}

/**
 * 활동지 패널 — 머리글 + 진행률 + 활동 카드 목록 + 마무리 안내.
 *
 * **스크롤은 목록 하나뿐이다.** 예전엔 이 카드 안 목록(`max-h-[360px]`)과 이걸 담은 패널 열이
 * 각각 스크롤해서 스크롤바가 둘이었다 — 밖의 것을 내려도 목록은 그대로여서 무엇을 내려야
 * 하는지 알 수 없었다. 지금은 카드가 열 높이를 꽉 채우고(`h-full`) 목록만 자기 안에서 넘긴다.
 */
/**
 * 목록에 놓이는 순서 — **진행중 → 아직 안 함 → 완료**.
 *
 * 다 한 활동은 아래로 내린다. 서버가 주는 순서(1,2,3…)를 그대로 두면 1번을 끝낸 아이가
 * "지금 할 것"을 찾으려고 완료된 카드를 지나쳐 내려가야 한다 — 목록의 맨 위는 다음에 할 일의
 * 자리다. 같은 무리 안에서는 원래 번호 순서를 지킨다(번호가 뒤죽박죽 되면 무엇이 몇 번째
 * 활동인지 알 수 없다).
 */
const STATUS_RANK = { next: 0, todo: 1, done: 2 } as const

export function TaskPanel() {
  const tasks = useTaskStore((s) => s.tasks)
  const doneCount = useTaskStore(selectDoneCount)
  const failed = useTaskStore((s) => s.error)
  const retry = useTaskStore((s) => s.retry)
  const [retrying, setRetrying] = useState(false)

  const onRetry = async () => {
    setRetrying(true)
    try {
      await retry()
    } finally {
      setRetrying(false)
    }
  }

  /* 정렬은 **표시용**이다 — 스토어의 원본 순서는 건드리지 않는다(다른 화면도 같은 배열을 본다) */
  const ordered = useMemo(
    () => [...tasks].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.order - b.order),
    [tasks],
  )

  /* 진행률 — 과제가 없을 때 0/0 으로 100% 가 되지 않게 분모를 확인한다 */
  const total = tasks.length
  const allDone = total > 0 && doneCount >= total
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0

  return (
    /*
      좌우 패딩은 22px 이다(18px 에서 늘렸다) — 제목·안내 문구가 카드 왼쪽 변에 붙어 답답했다.
      머리글에만 주지 않고 카드 패딩으로 늘린 이유: 아래 진행률·활동 카드와 **왼쪽 선이 맞아야**
      한다. 머리글만 밀면 제목이 목록보다 안쪽으로 들어가 층이 어긋난다.
    */
    <div className="isolate flex h-full flex-col overflow-hidden rounded-card bg-card p-[20px_22px_16px] shadow-card">
      {/*
        머리글 — 글이 왼쪽, **그림이 오른쪽**. 시안과 같은 자리다.

        그림은 `hw_ch`(연필 든 말랑이)로, **왼쪽 레일의 `활동지` 단추와 같은 그림**이다 —
        눌러서 열린 화면과 단추가 같은 얼굴이라 어디를 열었는지가 그림으로 이어진다.
        (예전에는 레일은 색 칩 아이콘, 여기는 클립보드 일러스트로 서로 달랐다.)

        제목 앞은 **과제 아이콘(`checklist`)** 이다. 한때 새싹이었고 그다음 `hw_ch` 를 작게
        넣어 봤는데, 같은 그림이 한 카드에 두 번(28px · 170px) 나오니 작은 쪽이 큰 쪽의
        축소판으로만 보였다 — 제목 앞 표식은 그림이 아니라 **뜻을 가리키는 기호**여야 한다.
      */}
      {/*
        그림은 **흐름 밖(`absolute`)** 이다. 한 줄에 나란히 뒀을 때는 그림을 키운 만큼 머리글이
        통째로 높아져 진행률·활동 카드가 아래로 밀렸다(42% 에서도 머리글이 104px 이었다).
        띄워 두면 그림 크기가 머리글 높이에 관여하지 않아, 키워도 아래가 그대로다.
        높이는 `min-h` 가 잡는다 — 그림이 진행률 카드를 덮지 않게 하는 하한이다.

        글에는 `pr-*`(%) 로 그림 자리를 비워 준다. 그림 폭도 %라서 함께 늘고 줄어야 한다.
      */}
      <div className="relative flex-none pr-[46%] pb-1">
          {/*
            그림이 **제목 앞**에 온다. 뒤에 뒀을 때는 제목 글자가 카드 왼쪽 끝(22px)에 그대로
            붙어서, 옆 AI 말랑이 패널(아이콘이 앞에 있어 글자가 50px 에서 시작)과 층이 달라
            패널을 갈아탈 때 제목이 좌우로 튀었다. 앞으로 옮기니 두 패널의 제목 글자가
            **같은 x(50px)** 에서 시작한다.

            아이콘 폭(24) + 간격(4) = 28 이어야 글자가 정확히 50px 에서 시작한다.

            머리글 블록 자체는 22px 에 그대로 둔다. 통째로 밀면 아래 활동 카드(22px)와
            어긋나 층이 두 개가 된다.
          */}
          <h2 className="flex items-center gap-1 text-[1.6rem] font-black leading-[1.15]">
            <Icon name="checklist" className="h-6 w-6 flex-none text-primary" />
            활동지
          </h2>
          {/* 제목 글자(50px)와 카드 왼쪽 끝(22px) 사이 — 제목에 딸린 글로 읽히게 살짝 들여쓴다 */}
          <p className="mt-1.5 pl-[10px] text-[.84rem] font-bold leading-[1.5] text-ink-soft">
            {/*
              줄바꿈을 **손으로 넣지 않는다.** 그림이 커져 글 폭이 좁아진 뒤로는 강제 줄바꿈이
              있으면 두 토막이 각각 또 접혀 네 줄이 됐다. 맡겨 두면 폭에 맞게 세 줄로 흐른다.
            */}
            오늘의 활동을 확인하고 하나씩 완료해 보세요!
          </p>
        <img
          src="/assets/hw_ch.webp"
          alt=""
          aria-hidden="true"
          /*
            크기는 **패널 폭에 비례**한다. 고정 px 로 두면 패널이 좁을 때(폭 하한 260px) 안내
            문구가 접혀 머리글이 커지고 활동 카드가 덜 보인다. 뷰포트 브레이크포인트로는 못
            고친다 — 화면은 넓은데 **패널만** 좁은 경우가 흔하다(무대가 넓게 서 있을 때).

            `-z-10` 으로 **진행률 카드 뒤에** 둔다. 그림이 머리글보다 커서 아래로 삐져나오는데,
            앞에 있으면 진행률을 가리고, 자리를 만들어 주면(`min-h` 를 그림 높이만큼) 아래
            요소가 통째로 밀린다. 뒤로 보내면 삐져나온 만큼만 카드에 가려 "뒤에 서 있다" 로
            읽히고 **아래는 한 픽셀도 움직이지 않는다.**
            (음수 z 가 카드 배경보다 뒤로 빠지지 않게 카드에 `isolate` 를 걸어 뒀다.)
          */
          /*
            `-top-8`(32px). 그림 상자는 카드 위로 12px 넘어가 잘리지만 **잘리는 부분은 전부
            투명 여백**이다 — 원본 1371x1148 에서 위 16.3%가 빈칸이라 실측했다(그릴 때 15~20px).

            여기가 **모든 폭에서** 안전한 한계다. 여백의 px 값은 그림이 작아질수록 함께 줄어드는데
            (좁은 패널에서 15px) 이 오프셋은 고정이라, 40px 까지 올렸더니 340px 에서는 딱 맞았지만
            260px 에서는 새싹 잎이 5px 잘렸다. 낮은 쪽에 맞춘다.
          */
          width={1371}
          height={1148}
          decoding="async"
          className="absolute -top-8 right-0 -z-10 h-auto w-[50%] min-w-[112px] max-w-[164px] object-contain"
        />
      </div>

      {/*
        진행률 — 시안의 회색 카드 안 막대. 과제가 없으면 그리지 않는다(0/0 은 뜻이 없다).

        머리글과의 간격을 좁혔다(14 → 8px). 머리글 그림이 커지면서 그 아래 여백이 넓어 보였고,
        진행률이 목록 쪽으로 내려앉아 **머리글보다 목록에 딸린 것처럼** 읽혔다 — 진행률은
        머리글이 말하는 "오늘 할 일"의 요약이라 위에 붙는 편이 맞다.
      */}
      {total > 0 && (
        <div className="mt-2 flex-none rounded-2xl bg-canvas p-[10px_14px_12px]">
          <p className="text-[.78rem] font-bold text-ink-soft">활동 진행률</p>
          <div className="mt-1.5 flex items-center gap-2.5">
            <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
              <span
                className="block h-full rounded-full bg-level-high transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="flex-none text-[.76rem] font-black text-ink-soft">
              {doneCount} / {total} 완료
            </span>
          </div>
        </div>
      )}

      {/*
        불러오기 실패 안내. 저학년이 읽을 문장으로 쓰고, 할 수 있는 일을 버튼 하나로만 준다.
        목록을 지우지 않으므로 이전에 받아 둔 과제가 있으면 그대로 아래에 남는다.
      */}
      {failed && (
        <div className="mt-3 flex flex-none flex-col items-center gap-2 rounded-2xl bg-task-soft p-4 text-center">
          <p className="text-[.9rem] font-bold text-ink-soft">
            인터넷이 잠깐 느려요. 다시 받아올까요?
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="rounded-full bg-task-deep px-5 py-2 text-[.9rem] font-black text-white disabled:opacity-60"
          >
            {retrying ? '받아오는 중…' : '다시 받기'}
          </button>
        </div>
      )}

      {/*
        목록 — **여기가 유일한 스크롤**이다.

        위쪽 `pt-2` 는 카드에 걸친 상태 꼬리표(`-top-2`)가 잘리지 않게 두는 여유다 — overflow 의
        자르는 경계는 content box 가 아니라 **padding box** 라서 이 8px 안에서는 삐져나와도 된다.

        **음수 마진(`-mt-2`)은 쓰지 않는다.** 간격을 되돌리려고 넣었더니 스크롤 상자가 위 진행률
        카드 위로 8px 올라와, 목록을 내릴 때 지나가는 카드가 **진행률 카드의 아래쪽을 덮어** 잘린
        것처럼 보였다. 반대로 `mt-2` 를 더해 진행률 카드와 첫 활동 카드 사이를 벌린다 —
        붙어 있으면 진행률이 첫 카드의 머리글처럼 읽힌다.
      */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-0.5 pt-2">
        {ordered.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
        {/*
          빈 상태 안내는 **남은 자리 가운데**에 둔다.

          예전엔 `mt-6` 로 위에 붙어 있었다. 활동지가 없을 때 이 칸은 화면 높이만큼 비어 있어서,
          위에 붙은 한 줄 아래로 큰 빈 자리가 남아 화면이 잘린 것처럼 보였다.
          `h-full`(= 이 스크롤 칸의 높이) + `place-items-center` 로 가로·세로 모두 가운데.

          `-mt-1`(4px)은 이 칸의 위 패딩(`pt-2`, 8px) 절반을 되돌린다 — 패딩은 카드에 걸친 상태
          꼬리표가 잘리지 않게 둔 것이고 빈 상태에는 꼬리표가 없다. 없으면 글이 정확히 4px
          아래로 앉는다(실측했다).
        */}
        {total === 0 && !failed && (
          <div className="-mt-1 grid h-full place-items-center px-2">
            <p className="text-center text-[.86rem] font-bold leading-[1.6] text-ink-mute">
              아직 받은 활동지가 없어요.
              <br />
              선생님이 활동지를 주면 여기에 나와요.
            </p>
          </div>
        )}
      </div>

      {/*
        마무리 띠 — **다 마쳤을 때만** 나온다.

        시안에는 `모든 활동을 완료하면 말랑이가 선물을 줄 거예요!` 가 늘 붙어 있었는데 없앴다
        (선생님 요청). 실제로 줄 선물이 없으니 지키지 못할 약속이고, 목록이 길 때는 그 띠가
        차지한 만큼 활동 카드가 덜 보인다. 다 했을 때의 칭찬 한 줄은 사실이라 남긴다.
      */}
      {allDone && (
        <div className="mt-3 flex flex-none items-center gap-2.5 rounded-2xl bg-success/40 p-[10px_14px]">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-white">
            <Icon name="star" className="h-[18px] w-[18px] text-xp-deep" />
          </span>
          <p className="min-w-0 flex-1 text-[.82rem] font-extrabold leading-[1.45] text-ink">
            오늘 활동을 모두 마쳤어요!
            <br />
            정말 잘했어요 🎉
          </p>
          {/* 별 말랑이 — 다 해냈을 때만 나오는 띠라 칭찬의 표시로 별을 쓴다 */}
          <img
            src={starCh}
            alt=""
            aria-hidden="true"
            decoding="async"
            className="h-11 w-11 flex-none object-contain"
          />
        </div>
      )}
    </div>
  )
}
