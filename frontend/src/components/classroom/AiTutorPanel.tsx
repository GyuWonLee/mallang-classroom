import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { Button } from '@/components/common/Button'
import { tutorApi } from '@/services/api/tutorApi'
import { errorSlug } from '@/lib/apiError'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import { useAuthStore } from '@/stores/useAuthStore'
import type { TutorAnsweredBy, TutorProposedAction } from '@/types/tutor'

/**
 * AI 말랑이 (학생) — POST /ai/tutor/messages (백엔드 S15P11A407-137 §11.1 #1).
 *
 * 옆의 "선생님께 살짝"(TeacherMessages)과 나란히 놓이지만 **다른 상대**다: 저쪽은 사람이라
 * 답이 언제 올지 모르고 STOMP 로 오지만, 이쪽은 바로 답이 온다(REST 왕복 한 번). 그래서
 * 소켓을 쓰지 않고, 보낸 말은 응답을 기다리는 동안 화면에 먼저 띄운다.
 *
 * **지난 대화는 되살린다.** 열 때 서버에서 이 학생의 기록을 받아 말풍선으로 되돌린다. 화면이
 * 말풍선이 쌓이는 메신저 모양이라 아이는 당연히 남는다고 믿는데, 예전에는 새로고침하면
 * 사라져 그 믿음과 어긋났다.
 *
 * 하루 30회 제한이 있다. LLM 실패는 에러가 아니라 안내 문구로 200 이 오므로(`answeredBy`
 * 가 `TEMPLATE`) **AI 가 답한 것처럼 꾸미지 않는다.**
 */
interface Bubble {
  id: number
  from: 'me' | 'mallang'
  text: string
  /** 말풍선이 생긴 시각 — 아래에 `오후 3:44` 로 적는다 (서버는 시각을 주지 않는다) */
  at: number
  answeredBy?: TutorAnsweredBy
  /**
   * 말랑이가 이 답에 붙인 제안 (백엔드 `proposedAction`). 확인받기 전까지 아무 일도
   * 일어나지 않는다. 처리하면 `null` 로 지워 **버튼을 다시 누를 수 없게** 한다
   * (이미 처리한 제안을 또 보내면 409 no-pending-action 이다).
   */
  action?: TutorProposedAction | null
  /** 이 제안의 서버 기록 id — 확인/거절에 필요하다 */
  messageId?: number
}

/**
 * 제안 확인 버튼을 만들어도 되는 종류인지.
 *
 * **`ASK_TEACHER` 만이다. `SHOW_MATERIAL` 은 앞으로도 뺀다.**
 *
 * 학습자료는 **선생님만 보는 것으로 팀이 정했다**(2026-08-03 확인). 백엔드도 그렇게 잠겨
 * 있다 — `MaterialService` 는 목록·상세·미리보기까지 전부 `requireManager` 이고
 * (MaterialService.java:59,95,103) `GET /files/{id}/content` 도 업로더 또는 그 관리자만
 * 통과한다(FileService.java:98-106). 학생용 자료 화면도 없다.
 *
 * 즉 이건 **아직 안 된 기능이 아니라 안 하기로 한 기능이다** — "백엔드가 열어주면 붙이자"로
 * 읽지 말 것. 버튼을 만들면 "응, 보여줘" 를 눌러도 열리는 게 없고, 그건 이 프로젝트가
 * 금지하는 가짜 성공이다. 그래서 제안이 와도 조용히 무시한다(말랑이 답 문장은 그대로 보인다).
 *
 * 서버가 `SHOW_MATERIAL` 을 계속 제안하는 것 자체는 백엔드 쪽에서 정리할 일이다.
 */
function isActionable(action: TutorProposedAction | null | undefined): boolean {
  return action?.type === 'ASK_TEACHER'
}

/**
 * 제안 처리 실패를 아이 말투로 옮긴다. 슬러그는 전부 백엔드 실물에서 확인한 것이다.
 *
 * `no-pending-action` 은 "오류"라고 말하지 않는다 — 이미 처리된 정상 상태이고 버튼은 어차피
 * 사라진다. 여기서 고장이라고 하면 잘 된 일을 잘못된 것처럼 보이게 한다.
 *
 * `material-not-available` 은 **넣지 않았다.** 그건 `SHOW_MATERIAL` 을 확인할 때만 나오는데
 * 이 화면은 그 제안에 버튼을 만들지 않으므로(위 `isActionable`) 도달할 수 없다 —
 * 닿지 않는 분기를 깔아 두면 그 경로가 살아 있다고 읽힌다.
 */
function messageForActionError(err: unknown): string {
  switch (errorSlug(err)) {
    case 'action-expired':
      return '시간이 지났어. 다시 물어봐 줄래?'
    case 'no-pending-action':
      return '이건 벌써 처리했어!'
    case 'no-teacher-in-classroom':
      return '지금 우리 반에 담당 선생님이 안 계셔서 전달하지 못했어.'
    default:
      /*
        **서버 문구를 그대로 옮기지 않는다.** 예전에는 `apiErrorMessage(err, ...)` 로 서버가
        준 message 를 말풍선에 넣었는데, 그건 어른에게 쓴 존댓말 설명이라 말랑이 말투와
        어긋나고("...할 수 없습니다") 때로는 내부 사정을 그대로 드러낸다. 위에서 아는
        슬러그는 아이 말로 옮겨 뒀고, 모르는 것은 아이가 할 수 있는 일만 말해 준다.
      */
      return '지금은 보내지 못했어. 잠시 뒤에 다시 해 볼래?'
  }
}

/** `오후 3:44` — 서버가 시각을 주지 않으므로 말풍선이 화면에 생긴 시각을 그대로 적는다 */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
}

export function AiTutorPanel({ classroomId }: { classroomId: number }) {
  /*
    첫 말풍선은 **말랑이의 인사**로 시작한다 — 빈 화면이면 무엇을 물어봐도 되는 곳인지
    아이가 알 수 없다. 서버를 부르지 않고 만드는 화면용 문장이라 `answeredBy` 를 붙이지
    않는다(붙이면 "AI 가 만든 답" 으로 읽힌다).
  */
  const [bubbles, setBubbles] = useState<Bubble[]>(() => [
    {
      id: 0,
      at: Date.now(),
      from: 'mallang',
      text: '안녕! 나는 AI 말랑이야 🌱\n궁금한 게 있으면 편하게 물어봐.\n선생님께 전할 말도 도와줄 수 있어!',
    },
  ])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  /*
    **지난 대화를 되살린다.** 예전에는 새로고침하면 화면에서 사라졌다 — 서버에는 남아 있는데
    학생용 조회를 붙이지 않았기 때문이다. 그런데 화면이 말풍선이 쌓이는 메신저 모양이라
    아이는 당연히 남는다고 믿는다. 그 어긋남을 없앤다.

    응답은 최신순이라 뒤집는다. 시각도 서버가 준 `createdAt` 을 쓴다 — 예전에는 화면에 뜬
    시각(Date.now)을 썼는데 그건 대화 시각이 아니다.

    실패해도 조용히 넘어간다. 인사 말풍선은 이미 떠 있고, 아이는 바로 물어볼 수 있다 —
    지난 대화를 못 불러왔다고 새 대화를 막을 이유가 없다.
  */
  const myId = useAuthStore((s) => s.user?.id ?? null)
  useEffect(() => {
    if (myId === null) return
    let cancelled = false
    void tutorApi
      .history(classroomId, myId)
      .then((list) => {
        if (cancelled || list.length === 0) return
        setBubbles((prev) => [
          ...prev,
          ...[...list].reverse().flatMap((m): Bubble[] => [
            { id: takeId(), at: Date.parse(m.createdAt), from: 'me', text: m.question },
            {
              id: takeId(),
              at: Date.parse(m.createdAt),
              from: 'mallang',
              text: m.answer,
              answeredBy: m.answeredBy,
            },
          ]),
        ])
      })
      .catch(() => {
        /* 지난 대화를 못 불러온 것뿐이다 — 새 대화는 그대로 된다 */
      })
    return () => {
      cancelled = true
    }
  }, [classroomId, myId])
  const scroll = useStickToBottom<HTMLDivElement>(bubbles.length)
  /*
    말풍선 key — **단조 증가 카운터**다. 예전엔 `Date.now()` 와 `그 값 + 1` 을 썼는데,
    같은 밀리초에 두 개가 생기거나 "질문 시각 + 1" 이 다음 질문의 시각과 겹치면 key 가
    충돌한다. 지금은 `busy` 가 연속 전송을 막아 실제로 부딪히기 어렵지만, 화면의 정합성이
    타이밍 운에 기대게 두지 않는다. 카운터는 이 컴포넌트 안에서만 유일하면 되므로 충분하다.
  */
  const nextId = useRef(0)
  const takeId = () => (nextId.current += 1)

  async function submit() {
    const question = text.trim()
    if (!question || busy) return
    setBusy(true)
    setText('')
    /* 내 질문은 먼저 띄운다 — 답을 기다리는 몇 초 동안 화면이 비어 있으면 안 보낸 줄 안다 */
    setBubbles((prev) => [...prev, { id: takeId(), at: Date.now(), from: 'me', text: question }])
    scroll.stick()
    try {
      const res = await tutorApi.ask(classroomId, question)
      setBubbles((prev) => [
        ...prev,
        {
          id: takeId(),
          at: Date.now(),
          from: 'mallang',
          text: res.answer,
          answeredBy: res.answeredBy,
          messageId: res.messageId,
          // 다룰 수 없는 종류(SHOW_MATERIAL)는 아예 들고 있지 않는다 — isActionable 주석 참고
          action: isActionable(res.proposedAction) ? res.proposedAction : null,
        },
      ])
    } catch (err) {
      /*
        하루 한도는 "고장"이 아니라 규칙이라 문구를 따로 준다.

        그 밖의 실패는 **한 문장으로 고정한다.** 서버 message 를 그대로 옮기면 말랑이가
        어른 말투로 사정을 설명하게 되고, 아이가 할 수 있는 일은 어차피 하나뿐이다.
      */
      const quota = errorSlug(err) === 'tutor-quota-exceeded'
      setBubbles((prev) => [
        ...prev,
        {
          id: takeId(),
          at: Date.now(),
          from: 'mallang',
          text: quota
            ? '오늘은 말랑이랑 많이 이야기했어요. 내일 다시 물어봐 줄래요?'
            : '지금은 대답하기 어려워요. 잠시 뒤에 다시 물어봐 주세요.',
          answeredBy: 'TEMPLATE',
        },
      ])
    } finally {
      setBusy(false)
      scroll.stick()
    }
  }

  /** 제안 처리 중인 말풍선 id — 두 번 누르는 것을 막는다 (서버는 두 번째를 409 로 거절한다) */
  const [deciding, setDeciding] = useState<number | null>(null)

  /**
   * 제안 확인/거절. **어떤 결과든 버튼을 없앤다**(`action: null`) — 성공이든 실패든 그 제안은
   * 다시 누를 수 있는 상태가 아니다. 실패 사유는 말랑이 말풍선으로 아이 말투로 알려준다.
   */
  async function decide(bubbleId: number, messageId: number, decision: 'CONFIRM' | 'REJECT') {
    if (deciding !== null) return
    setDeciding(bubbleId)
    const clearAction = () =>
      setBubbles((prev) => prev.map((b) => (b.id === bubbleId ? { ...b, action: null } : b)))
    try {
      const res = await tutorApi.decideAction(messageId, decision)
      clearAction()
      if (res.status === 'REJECTED') {
        say('알겠어! 안 보낼게. 더 궁금한 게 있으면 물어봐.')
        return
      }
      /*
        확인됨 — `delivery` 로 문구가 갈린다. 수업 중이면 선생님 화면에 바로 떴고(SESSION_ROUTED),
        아니면 쪽지함에 남았다(DIRECT_MESSAGE). 같은 말로 뭉개면 아이가 지금 답을 기다려야
        하는지 나중에 확인하면 되는지 알 수 없다.
      */
      say(
        res.delivery === 'SESSION_ROUTED'
          ? '선생님께 전달했어! 곧 답을 주실 거야.'
          : '선생님 쪽지함에 남겨뒀어! 확인하시면 답이 올 거야.',
      )
    } catch (err) {
      clearAction()
      say(messageForActionError(err))
    } finally {
      setDeciding(null)
      scroll.stick()
    }
  }

  /** 말랑이 말풍선 한 줄 추가 (제안 처리 결과 안내용) */
  function say(text: string) {
    setBubbles((prev) => [...prev, { id: takeId(), at: Date.now(), from: 'mallang', text }])
    scroll.stick()
  }

  return (
    /*
      **한 화면을 꽉 채우는 세로 3단**: 머리말 · 대화(늘어남) · 입력줄(맨 아래 고정).
      예전에는 카드가 내용만큼만 크고(`flex-none`) 대화가 `max-h-[240px]` 였다 — 말이
      쌓이면 카드가 자라 페이지째 스크롤이 생기고, 입력칸이 아래로 밀려 내려갔다.
      지금은 **대화만 안에서 스크롤**하고 물어보는 칸은 늘 같은 자리에 있다.
    */
    <div className="relative flex h-full min-h-0 flex-col rounded-card bg-tutor-paper p-[13px] shadow-card">
      {/*
        `min-h-*` 은 **캐릭터 자리를 비워 두는 값**이다. 그림이 흐름 밖에 있어 높이를 만들지
        않으므로, 머리말이 짧아지면 흰 상자가 위로 올라와 글이 그림에 덮인다.

        `pt-*` 로 제목·설명을 아래로 내리는데, **높이는 `min-h` 가 잡고 있어 그대로다** —
        글만 내려가고 흰 상자는 올라오지 않는다(마진으로 밀면 상자가 같이 밀린다).

        `pl-*` 은 카드 안쪽 여백을 13px 로 줄인 보상이다 — 흰 상자는 넓게 쓰고 싶지만
        글이 테두리에 붙으면 답답하다. 상자에는 여백을 주지 않고 글에만 준다.
        `pr-*` 은 **%** 다: 그림 폭도 %(아래)라서 같이 늘고 줄어야 글이 안 덮인다.
      */}
      <div className="min-h-[70px] flex-none pl-[9px] pr-[37%] pt-[19px] max-[900px]:min-h-[62px] max-[900px]:pt-[10px]">
        <div className="flex items-center gap-2">
          <Icon name="aichat" className="h-5 w-5 text-mint-deep" />
          <h2 className="text-[1rem] font-black">
            <span className="text-mint-deep">AI 말랑이</span>에게 질문해요!
          </h2>
        </div>
        <p className="mt-1 text-[.8rem] font-medium leading-[1.5] text-ink-soft">
          모르는 게 있으면 언제든지 물어봐요.
        </p>
      </div>

      {/*
        대화판은 **흰색**, 그 뒤 카드가 크림색이다(반대가 아니다) — 말이 오가는 자리를
        가장 밝게 두면 말풍선이 떠 보이고, 대화판의 경계가 저절로 드러난다.

        **묻는 칸도 이 흰 상자 안에** 있다. 밖에 두면 "대화는 위, 입력은 아래" 로 두 덩어리가
        되는데, 묻고 답하는 건 한 일이다. 안에 넣으면 흰 자리가 입력칸 몫까지 넓어진다.
        스크롤은 말풍선 목록만(안쪽 `div`) — 입력칸은 상자 아래에 붙어 함께 스크롤되지 않는다.
      */}
      <div className="relative mt-3 flex min-h-0 flex-1 flex-col rounded-card-md bg-card p-3">
        {/*
          **흰 상자 윗변에 걸터앉은 말랑이.** 그림 아래가 잘려 있고 두 손이 턱에 얹힌
          모양이라(원본 그대로) 손이 윗변을 살짝 덮어야 "여기 올라앉았다" 로 읽힌다.

          기준을 **카드가 아니라 이 상자**로 잡는 게 요점이다. 카드 위에서 `top` 으로 재던
          동안은 상자 위치가 머리말 높이·글줄 수·화면 폭에 따라 움직여서 겹치는 깊이가
          6px ~ 51px 로 제멋대로였다. 이제 `bottom: calc(100% - 11px)` 이라 **그림 밑변이
          늘 상자 윗변에서 11px 아래**다 — 어떤 크기에서도 붙어 있다.

          크기도 `w-[44%]`(상자 폭 기준) + 높이 자동이라 패널이 좁아지면 같이 줄어든다.
          `max-w` 는 넓을 때 위로 자라다 카드 밖으로 나가 잘리는 것을 막는 상한이다.
          흐름 밖(`absolute`)이라 상자 높이는 한 픽셀도 먹지 않는다.
        */}
        <img
          src="/assets/ai_chat.webp"
          alt=""
          aria-hidden="true"
          width={1404}
          height={1120}
          decoding="async"
          className="pointer-events-none absolute -right-[5px] bottom-[calc(100%-11px)] z-[1] h-auto w-[44%] min-w-[104px] max-w-[142px] object-contain"
        />
      <div
        ref={scroll.ref}
        onScroll={scroll.onScroll}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
      >
          {bubbles.map((b) => {
            const mine = b.from === 'me'
            /*
              지역 const 로 꺼내 둔다. `b.action`/`b.messageId` 를 그대로 쓰면 JSX 조건에서
              좁혀진 타입이 아래 onClick 클로저까지 따라오지 않아 `!` 단정을 써야 한다.
            */
            const action = b.action
            const messageId = b.messageId
            return (
              <div
                key={b.id}
                data-mine={mine}
                className="flex max-w-[85%] flex-col items-start self-start data-[mine=true]:items-end data-[mine=true]:self-end"
              >
                {/*
                  말랑이 말풍선 **왼쪽 아래에 작은 말랑이 얼굴.** 레일의 `AI 말랑이` 단추와
                  같은 그림이라 "그 말랑이와 지금 이야기하는 중" 으로 이어진다.

                  `items-end` 로 얼굴을 **말풍선 밑변에** 맞춘다 — 메신저에서 아바타가 말풍선
                  꼬리 쪽에 붙는 관례다. 이 줄(얼굴+말풍선)을 따로 감싸는 이유는, 아래
                  이름·시각까지 한 줄에 넣으면 얼굴이 시각 옆까지 내려가기 때문이다.
                */}
                <div className="flex items-end gap-1.5">
                  {!mine && (
                    <img
                      src="/assets/student_ch.webp"
                      alt=""
                      aria-hidden="true"
                      decoding="async"
                      className="h-10 w-10 flex-none object-contain"
                    />
                  )}
                  <span
                    data-mine={mine}
                    className="min-w-0 whitespace-pre-line break-words rounded-[16px_16px_16px_4px] bg-tutor-bubble px-3 py-2 text-[.85rem] font-medium leading-[1.5] text-mint-deep data-[mine=true]:rounded-[16px_16px_4px_16px] data-[mine=true]:bg-primary data-[mine=true]:text-white"
                  >
                    {b.text}
                  </span>
                </div>
                {/*
                  내 말풍선에는 이름을 달지 않는다 (좌우 위치와 색으로 이미 구분된다).
                  말랑이 쪽은 남긴다 — 사람이 아니라 AI 가 한 말임을 아이가 알아야 한다.
                */}
                {/*
                  선생님께 보낼 내용을 **그대로** 보여준 뒤 확인을 받는다.
                  무엇이 자기 이름으로 나가는지 아이가 읽지 않은 채 누르게 하면 안 된다 —
                  서버가 `content` 를 내려주는 이유가 이것뿐이다.
                */}
                {!mine && action && messageId !== undefined && (
                  <div className="mt-1.5 w-full rounded-[14px] border-2 border-mint bg-mint-bg/60 p-3">
                    <p className="flex items-center gap-1.5 text-[.78rem] font-black text-mint-deep">
                      <Icon name="send" className="h-4 w-4" />
                      선생님께 보낼 내용
                    </p>
                    {action.content && (
                      <p className="mt-1.5 whitespace-pre-line break-words rounded-[10px] bg-white p-2 text-[.82rem] font-medium leading-[1.55] text-ink">
                        {action.content}
                      </p>
                    )}
                    <div className="mt-2.5 flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={deciding !== null}
                        onClick={() => void decide(b.id, messageId, 'CONFIRM')}
                      >
                        응, 보내줘
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deciding !== null}
                        onClick={() => void decide(b.id, messageId, 'REJECT')}
                      >
                        아니야
                      </Button>
                    </div>
                  </div>
                )}
                {/* 이름 + 시각 한 줄 — 시각은 서버 값이 아니라 이 화면에 뜬 시각이다 */}
                {!mine && (
                  /* 얼굴(40) + 간격(6) 만큼 들여써서 말풍선 아래에 놓는다 — 얼굴 밑이 아니라 */
                  <span className="mt-0.5 pl-[50px] pr-1 text-[.68rem] font-bold text-ink-mute">
                    말랑이 · {clock(b.at)}
                    {/*
                      폴백을 AI 가 생각해서 준 답으로 오해하지 않게 표시한다.

                      `BLOCKED` 에는 **아무 라벨도 붙이지 않는다.** 서버가 그때 돌려주는 문장이
                      이미 "앗, 그런 말은 말랑이랑 함께 쓰지 않기로 해요…" 라서, 여기에 딱지를
                      더 붙이면 한 번 더 지적하는 셈이 된다 — 백엔드가 "혼내기보다 다정하게
                      돌려세운다"고 정해 둔 톤을 화면이 깨뜨리면 안 된다.
                      (`BLOCKED` 구분이 필요한 쪽은 선생님의 대화 기록 화면이다.)
                    */}
                    {b.answeredBy === 'TEMPLATE' && ' · 지금은 대답을 못 만들었어요'}
                  </span>
                )}
              </div>
            )
          })}
          {/*
            생각하는 중 — 글자 대신 **점 세 개**다. 글로 쓰면 그것도 말랑이가 한 말처럼
            읽히지만, 점은 "아직 오지 않았다" 로만 읽힌다. `aria-label` 로 화면 읽어 주는
            아이에게는 말로 전한다.
          */}
          {busy && (
            <div role="status" aria-label="말랑이가 생각하고 있어요" className="flex items-end gap-1.5 self-start">
              {/* 기다리는 동안에도 얼굴을 둔다 — 답이 오면 같은 자리에 말풍선만 바뀐다 */}
              <img
                src="/assets/student_ch.webp"
                alt=""
                aria-hidden="true"
                decoding="async"
                className="h-10 w-10 flex-none object-contain"
              />
              <span className="flex gap-1 rounded-[16px_16px_16px_4px] bg-tutor-bubble px-3.5 py-3">
                {[0, 1, 2].map((i) => (
                  <i
                    key={i}
                    aria-hidden="true"
                    style={{ animationDelay: `${i * 0.16}s` }}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-mint-deep"
                  />
                ))}
              </span>
            </div>
          )}
      </div>

      {/*
        물어보는 칸 — 알약 한 덩어리 + 동그란 보내기 단추. 글자 단추("물어보기")를 쓰면
        좁은 패널에서 입력칸을 크게 잡아먹는다. 아이콘 단추는 폭이 고정이라 입력칸이 넓다.
      */}
      <form
        className="mt-2 flex flex-none items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          /* 서버 상한이 500자다 — 넘겨 보내고 400 을 받느니 여기서 막는다 */
          maxLength={500}
          placeholder="AI 말랑이에게 질문해보세요!"
          /* 흰 상자 안이라 배경도 흰색이면 칸이 사라진다 — 테두리 + 옅은 바탕으로 구분한다 */
          className="min-w-0 flex-1 rounded-full border-2 border-track bg-tutor-paper px-4 py-2.5 text-[.88rem] font-medium outline-none placeholder:text-ink-mute focus:border-primary focus:bg-white"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="말랑이에게 보내기"
          className="grid h-[42px] w-[42px] flex-none place-items-center rounded-full bg-mint-deep text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Icon name="send" className="h-[18px] w-[18px]" />
        </button>
      </form>
      </div>
    </div>
  )
}
