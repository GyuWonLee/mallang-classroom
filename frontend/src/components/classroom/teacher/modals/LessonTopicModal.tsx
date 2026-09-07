import { useState } from 'react'
import { ModalShell } from '@/components/common/ModalShell'
import { Button } from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { GRADE_PALETTE, gradePlantImage } from '@/lib/subject'

/** 수업 주제 최대 길이 — 무대 슬라이드 제목(2.1rem)이 두 줄을 넘지 않는 선 */
const MAX_LEN = 30

/**
 * 수업 시작 전 **오늘의 수업 주제**를 적는 창.
 *
 * 여기서 적은 말이 두 곳에 나온다: 라이브 화면 상단 알약(학급 이름 옆)과 방송 전 무대의
 * 수업 주제 슬라이드. 슬라이드는 원래 '오늘의 수업 주제' 라고 적어 놓고 학급 이름을 띄우고
 * 있었다 — 이름이 주제 자리에 앉아 있던 셈이라, 적을 자리를 만들었다.
 *
 * **비워 둔 채 시작할 수 있다.** 수업을 열려는 손을 주제 입력으로 막지 않는다 — 그때는
 * 예전처럼 학급 이름이 그 자리에 남는다.
 *
 * 적은 주제는 **서버에 저장된다**(S15P11A407-146) — 학생 화면과 다른 선생님 화면에도 같은
 * 주제가 나온다. 예전에는 담을 자리가 없어 이 브라우저에만 남았고 창 안에서 그 한계를
 * 알렸는데, 서버가 받아 주게 되면서 그 문구를 걷었다. `useLessonTopicStore` 주석 참고.
 */
export function LessonTopicModal({
  grade,
  className,
  starting,
  onStart,
  onClose,
}: {
  grade: number
  /** 학급 이름 — 주제를 비워 두면 이 이름이 슬라이드에 남는다는 안내에 쓴다 */
  className: string
  /** 세션을 여는 중 — 버튼을 잠근다 */
  starting?: boolean
  /** 주제와 함께 수업 시작. 빈 문자열이면 주제 없이 시작한다는 뜻이다 */
  onStart: (topic: string) => void
  onClose: () => void
}) {
  /*
    늘 빈칸에서 시작한다. 이 창은 **수업을 새로 시작할 때만** 뜨므로(이미 주제가 있는 수업에
    다시 들어갈 때는 묻지 않는다) 채워 둘 이전 값이 없다.
  */
  const [topic, setTopic] = useState('')
  const palette = GRADE_PALETTE[grade]

  return (
    <ModalShell
      open
      onClose={onClose}
      label={`${grade}학년 수업 주제 정하기`}
      width={480}
      title={
        <div className="flex items-center gap-3.5">
          <span
            style={palette ? { background: palette.bg } : undefined}
            className="grid h-14 w-14 flex-none place-items-center rounded-2xl"
          >
            <img
              src={gradePlantImage(grade)}
              alt=""
              aria-hidden="true"
              decoding="async"
              className="h-9 w-9 object-contain"
            />
          </span>
          <div className="min-w-0">
            <h2 className="text-[1.3rem] font-black">오늘 무엇을 배울까요?</h2>
            <p className="mt-0.5 text-[.88rem] font-medium text-ink-soft">
              {grade}학년 · {className}
            </p>
          </div>
        </div>
      }
    >
      <label className="mt-6 block">
        <span className="mb-2 block text-base font-black">수업 주제</span>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value.slice(0, MAX_LEN))}
          placeholder="예) 받아쓰기 연습, 씨앗의 성장"
          /* 창이 열리면 바로 적을 수 있게 — 이 창의 목적이 입력 하나다 */
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !starting) onStart(topic.trim())
          }}
          className="w-full rounded-2xl border-[1.5px] border-track bg-canvas p-[14px_16px] text-[1rem] font-bold text-ink outline-none placeholder:font-medium placeholder:text-ink-mute focus:border-primary focus:bg-card"
        />
        <span className="mt-1.5 block text-right text-[.78rem] font-bold text-ink-mute">
          {topic.length}/{MAX_LEN}
        </span>
      </label>

      {/*
        어디에 보이는지 적는다 — 적은 것이 누구에게 가는지 알고 쓰게 하려는 안내다.

        예전에는 여기에 "아직 학생 화면에는 전해지지 않아요 — 서버에 주제를 담을 자리가 없어서,
        이 브라우저에만 저장돼요" 가 붙어 있었다. 서버가 학년별 수업 주제를 갖게 되면서
        (S15P11A407-146: `PUT /sessions/{id}/topics/{grade}`, join·state 응답의 `topics`)
        **사실이 아니게 됐다.** 없어진 한계를 계속 알리면 선생님이 쓸 수 있는 기능을 피한다.
      */}
      <p className="mt-4 rounded-2xl bg-sky/60 p-4 text-[.86rem] font-semibold leading-[1.65] text-ink-soft">
        적은 주제는 <b className="font-black text-ink">학생 수업 화면</b>과 선생님 화면의 칠판·
        위쪽 이름 옆에 함께 나와요.
        <br />
        수업을 끝내면 지워져요 — 다음 수업에는 새로 적어요.
      </p>

      {/*
        버튼은 **하나**고 **언제나 눌린다.**

        예전엔 둘이었다: 비어 있으면 '이 주제로 수업 시작' 을 비활성으로 잠그고, 옆에
        '주제 없이 시작' 을 따로 뒀다. 그게 **눌리지 않는 버튼**을 만들었다 — 주제를 안 적고
        기본 버튼을 누른 사람에게는 아무 일도 일어나지 않아 "수업이 안 열린다"로 보였다.
        (회색 보조 버튼이 옆에 있었지만, 큰 파란 버튼을 누른 손이 그걸 찾아가지 않는다.)

        지금은 빈칸이면 주제 없이 열고, 적었으면 그 주제로 연다. 글자가 어느 쪽인지 알려 준다.
      */}
      <Button
        className="mt-5 w-full"
        disabled={starting}
        onClick={() => onStart(topic.trim())}
      >
        <Icon name="playTri" className="h-[17px] w-[17px]" />
        {starting
          ? '수업을 여는 중…'
          : topic.trim()
            ? '이 주제로 수업 시작'
            : '주제 없이 수업 시작'}
      </Button>
    </ModalShell>
  )
}
