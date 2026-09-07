import { useEffect, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { Button } from '@/components/common/Button'
import { useSignalStore } from '@/stores/useSignalStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { chatApi, directChatApi } from '@/services/api/chatApi'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import { useToastStore } from '@/stores/useToastStore'
import { apiErrorMessage } from '@/lib/apiError'
import { endsMinuteRun, hhmm } from '@/lib/chatTime'
import { isMine } from '@/lib/chatMessage'

/** 두 출처를 합치는 동안만 쓰는 중간 모양 (스토어 모델은 시각을 문자열로 갖는다) */
interface Bubble {
  id: string
  text: string
  at: string
  from: 'me' | 'teacher'
}

/**
 * 선생님과의 개인 쪽지 (학생) — 주고받은 대화를 메신저처럼 보여준다.
 * 학생 간 대화는 허용하지 않으므로 상대는 항상 선생님이다.
 *
 * 지난 대화를 **두 곳**에서 받아 합친다:
 *  - `GET /me/messages` — 수업 중 질문과 그 답장 (세션 채팅)
 *  - `GET /classrooms/{id}/chat/threads/{peerId}` — 수업 밖 1:1 (백엔드 S15P11A407-137)
 *
 * 둘을 합치는 게 **필수**다. `/me/messages` 의 쿼리는 "내가 보냈거나, 내 메시지에 달린 답장"
 * 이라(`findAllInvolving`) 선생님이 **먼저 말을 건 쪽지는 아무것도 걸리지 않는다** —
 * 수업 밖 쪽지가 전부 그렇고, 수업 중이라도 선생님이 답장이 아니라 새로 보낸 것이 그렇다.
 * 합치기 전에는 그런 쪽지가 실시간으로 한 번 스쳐 지나갈 뿐, 새로고침하면 사라졌다.
 *
 * 내가 보낸 쪽지는 서버가 되돌려주지 않아 보낼 때 낙관적으로 넣는다(`pushMyMessage`).
 */
export function TeacherMessages() {
  const messages = useSignalStore((s) => s.teacherMessages)
  const send = useSignalStore((s) => s.send)
  const pushMyMessage = useSignalStore((s) => s.pushMyMessage)
  const userName = useAuthStore((s) => s.user?.name)
  const showToast = useToastStore((s) => s.show)
  const setTeacherMessages = useSignalStore((s) => s.setTeacherMessages)
  /** 재접속 신호 — 오르면 쪽지 이력을 다시 맞춘다 */
  const resyncTick = useSignalStore((s) => s.resyncTick)
  const [text, setText] = useState('')
  /** 수업이 없을 때 쪽지를 보낼 상대 (수업 밖 1:1 REST 경로) — 아래 로드 효과가 채운다 */
  const [dmTarget, setDmTarget] = useState<{ classroomId: number; peerId: number } | null>(null)
  /** REST 경로는 await 가 있어 재진입 가능 — 같은 쪽지가 두 번 가지 않게 막는다 */
  const [sending, setSending] = useState(false)
  // 하단 추적 규칙은 공용 훅이 갖는다 (채팅 화면 4곳이 같은 규칙을 쓰도록)
  const scroll = useStickToBottom<HTMLDivElement>(messages)

  // 지난 대화 복원 — 세션 채팅 + 수업 밖 1:1 을 합친다 (위 주석 참고)
  useEffect(() => {
    let cancelled = false
    const myId = useAuthStore.getState().user?.id

    /** 수업 밖 대화 — 상대(선생님)별로 스레드를 받아 평평하게 편다 */
    async function loadDirect(): Promise<Bubble[]> {
      const threads = await directChatApi.myThreads()
      /*
        수업이 없을 때 쪽지를 보낼 상대. 학생은 **학급 선생님 명단을 조회할 수 없다**
        (`GET /classrooms/{id}/members` 는 선생님 전용이고, 참가자 명단은 수업이 있어야 한다).
        그래서 이미 대화가 있는 스레드가 유일한 단서다 — 서버 정렬의 첫 줄(안 읽은 것 우선,
        그다음 최근 순)을 쓴다. 대화가 한 번도 없으면 null 이고, 그때는 정직하게 못 보낸다.
      */
      if (!cancelled) setDmTarget(threads[0] ? { classroomId: threads[0].classroomId, peerId: threads[0].peerId } : null)
      const conversations = await Promise.all(
        threads.map((t) =>
          directChatApi.conversation(t.classroomId, t.peerId).catch(() => []),
        ),
      )
      return conversations.flat().map((m) => ({
        id: `d${m.id}`,
        text: m.content,
        at: m.at,
        /* 보낸 사람이 나면 내 말풍선 — 세션 채팅과 달리 senderId 로 정확히 갈린다 */
        from: m.senderId === myId ? ('me' as const) : ('teacher' as const),
      }))
    }

    /** 수업 중 질문·답장 */
    async function loadSession(): Promise<Bubble[]> {
      const list = await chatApi.myMessages()
      return list.map((m) => ({
        id: `s${m.id}`,
        text: m.text,
        at: m.at,
        /* 위 1:1 과 같은 기준으로 가른다 — 예전엔 `replyToId` 유무로 역할을 추정했다 */
        from: isMine(m, myId) ? ('me' as const) : ('teacher' as const),
      }))
    }

    void Promise.allSettled([loadSession(), loadDirect()]).then(([s, d]) => {
      if (cancelled) return
      const merged = [
        ...(s.status === 'fulfilled' ? s.value : []),
        ...(d.status === 'fulfilled' ? d.value : []),
      ]
      // 서버 정렬을 믿지 않고 시간순으로 맞춘다 — 말풍선 순서가 뒤바뀌면 대화가 안 읽힌다
      merged.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      setTeacherMessages(
        merged.map((m) => ({
          id: m.id,
          text: m.text,
          time: hhmm(m.at),
          from: m.from,
        })),
      )
    })
    return () => {
      cancelled = true
    }
    /*
      `resyncTick` 을 의존성에 함께 둔다 — 브로커가 simple broker 라 끊긴 동안 온 쪽지를
      재전송해 주지 않는다. 넣지 않으면 재접속해도 그 사이 선생님이 보낸 말이 새로고침
      전까지 안 보인다. 이력을 통째로 다시 받아 덮으므로 중복은 생기지 않는다.
    */
  }, [setTeacherMessages, resyncTick])

  /** 보낸 것이 확정됐을 때만 화면에 남긴다 */
  function commit(trimmed: string) {
    // 내가 보낸 건 어디를 보고 있었든 끝까지 내려가서 보여준다
    scroll.stick()
    // 보낸 즉시 내 말풍선으로 남긴다 (토스트만 띄우면 뭐라고 보냈는지 사라진다)
    pushMyMessage(trimmed)
    setText('')
  }

  /**
   * 쪽지 보내기 — 수업 중이면 STOMP, 수업이 없으면 수업 밖 1:1 REST.
   *
   * 두 경로를 다 두는 이유: 선생님측은 이미 이렇게 동작한다(ClassMessagesPanel.submit).
   * 학생측에만 fallback 이 없어서, **수업이 없으면 아이는 답장조차 못 보냈다** —
   * 선생님은 수업 밖에서 말을 걸 수 있는데 학생은 대답할 길이 없는 비대칭이었다.
   *
   * `send()` 의 반환값을 **반드시 본다.** 예전엔 버리고 무조건 말풍선을 남겨서, 수업 미시작·
   * 소켓 미연결이면 아이 화면에는 보낸 것처럼 남는데 선생님에겐 아무것도 가지 않았다
   * (`send` 의 기본값이 `() => false` 라 소켓 등록 전에는 전부 그랬다).
   * 실패해도 입력한 글은 지우지 않는다 — 그대로 다시 누를 수 있어야 한다.
   */
  async function submit() {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    if (send('CHAT_MESSAGE', { senderRole: 'STUDENT', senderName: userName ?? '학생', message: trimmed })) {
      commit(trimmed)
      return
    }

    // STOMP 로 못 보냈다 — 사유는 ClassroomSocket.onError 가 이미 토스트로 알렸다
    if (!dmTarget) return

    setSending(true)
    try {
      await directChatApi.send(dmTarget.classroomId, dmTarget.peerId, trimmed)
      commit(trimmed)
    } catch (err) {
      showToast(apiErrorMessage(err, '쪽지를 보내지 못했어요. 잠시 후 다시 눌러주세요.'))
    } finally {
      setSending(false)
    }
  }

  return (
    /*
      **한 화면을 꽉 채우는 세로 3단**: 머리말 · 쪽지판(늘어남) · 입력줄(판 아래 고정).
      예전에는 카드가 내용만큼만 크고(`flex-none`) 목록이 `max-h-[240px]` 였다 — 쪽지가
      적으면 패널 아래가 통째로 비고, 쌓이면 카드가 자라 페이지째 스크롤이 생겼다.
      옆의 AI 말랑이 패널과 같은 골격이다(둘이 같은 자리에서 번갈아 열린다).
    */
    /*
      `isolate` 는 아래 캐릭터를 **쪽지판 뒤로** 보내기 위한 장치다 — 그림에 음수 z 를 주면
      "가장 가까운 쌓임 문맥의 배경 위, 내용 아래" 에 그려지는데, 여기서 문맥을 만들지 않으면
      카드 배경보다도 뒤로 빠져 **그림이 아예 안 보인다.** 카드를 문맥으로 만들어
      `카드 배경 → 캐릭터 → 쪽지판 배경` 순서를 고정한다.
    */
    <div className="relative isolate flex h-full min-h-0 flex-col rounded-card bg-note-paper p-[13px] shadow-card">
      {/*
        `min-h`/`pr` 은 **캐릭터 자리를 비워 두는 값**이다 — 그림이 흐름 밖(`absolute`)이라
        높이를 만들지 않으므로, 이걸 빼면 쪽지판이 위로 올라와 글이 그림에 덮인다.
        `pr` 을 %로 잡는 이유는 그림 폭도 %라서 같이 늘고 줄어야 하기 때문이다.
      */}
      <div className="min-h-[70px] flex-none pl-[9px] pr-[37%] pt-[19px]">
        <div className="flex items-center gap-2">
          <Icon name="chat" className="h-5 w-5 text-primary" />
          <h2 className="text-[1rem] font-black">선생님께 살짝</h2>
        </div>
        <p className="mt-1 text-[.8rem] font-medium leading-[1.5] text-ink-soft">
          선생님에게만 보이는 쪽지예요.
          <br />
          궁금한 걸 조용히 물어봐요.
        </p>
      </div>

      {/*
        쪽지판 — 남는 높이를 전부 가진다. 스크롤은 이 안 목록에만 생긴다.

        **판은 흰색, 그 뒤 카드가 파란색이다**(반대가 아니다) — 말이 오가는 자리를 가장 밝게
        두면 말풍선이 떠 보이고 판의 경계가 저절로 드러난다. 옆 AI 말랑이 패널과 같은 규칙이다
        (그쪽은 크림색 카드 + 흰 대화판).
      */}
      <div className="relative mt-3 flex min-h-0 flex-1 flex-col rounded-card-md bg-card p-3">
        {/*
          쪽지판 윗변에 선 **편지 든 말랑이.** 기준을 카드가 아니라 이 판으로 잡는다 —
          카드 기준으로 `top` 을 재면 머리말 글줄 수·화면 폭에 따라 판이 움직여서 겹치는
          깊이가 제멋대로다(옆 AI 말랑이 패널에서 6px ~ 51px 까지 벌어졌다).
          `bottom: calc(100% - 28px)` 이라 **발끝이 늘 윗변 28px 아래**다.

          `-z-10` 은 그림을 **쪽지판 뒤**로 보낸다 — 판 위에 얹히면 겹친 부분이 말풍선 자리를
          덮어 그림이 대화를 가린다. 뒤로 보내면 판에 가려 발끝만 살짝 사라지므로,
          "판 뒤에 서 있다" 로 읽히고 대화는 한 글자도 안 가린다.
          (음수 z 가 카드 배경보다 뒤로 빠지지 않게 카드에 `isolate` 를 걸어 뒀다 — 위 주석)
        */}
        <img
          src="/assets/chat_ch.webp"
          alt=""
          aria-hidden="true"
          width={1451}
          height={1084}
          decoding="async"
          className="pointer-events-none absolute -right-[5px] -z-10 bottom-[calc(100%-28px)] h-auto w-[54%] min-w-[118px] max-w-[176px] object-contain"
        />
        <div
          ref={scroll.ref}
          onScroll={scroll.onScroll}
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
        >
          {/*
            빈 목록에 아무것도 없으면 판이 그냥 빈 상자로 보인다 — 무엇을 하는 자리인지
            한 줄로 알려 준다. `place-items-center` 로 가운데 (위에 붙으면 잘린 것처럼 읽힌다).
          */}
          {messages.length === 0 && (
            <p className="grid h-full place-items-center px-4 text-center text-[.82rem] font-bold leading-[1.6] text-ink-mute">
              아직 주고받은 쪽지가 없어요.
              <br />
              선생님께 살짝 물어봐도 괜찮아요!
            </p>
          )}
          {messages.map((m, i) => {
            const mine = m.from === 'me'
            // 같은 사람이 같은 분에 연달아 보냈으면 마지막 것에만 시간을 보인다
            const showTime = endsMinuteRun(messages, i, (x) => `${x.from}|${x.time}`)
            return (
              <div
                key={m.id}
                data-mine={mine}
                className="flex max-w-[85%] flex-col items-start self-start data-[mine=true]:items-end data-[mine=true]:self-end"
              >
                {/*
                  **선생님은 흰 말풍선, 내 것은 하늘색.** 예전엔 내 것이 진한 파랑(흰 글씨)
                  이었는데, 아이가 보는 화면에서 자기 말이 가장 진한 덩어리가 되어 눈에
                  먼저 걸렸다. 파란 종이 위에서 흰 말풍선이 떠 보이므로 색을 뒤집는다 —
                  좌우 위치가 이미 누구 말인지 말해 주니 진하기까지 쓸 필요가 없다.
                */}
                <span
                  data-mine={mine}
                  className="break-words rounded-[16px_16px_16px_4px] border border-sky-deep bg-card px-3 py-2 text-[.85rem] font-medium leading-[1.5] text-ink data-[mine=true]:rounded-[16px_16px_4px_16px] data-[mine=true]:border-transparent data-[mine=true]:bg-sky data-[mine=true]:text-ink"
                >
                  {m.text}
                </span>
                {/*
                  내 말풍선에는 이름을 달지 않는다 — 좌우 위치와 색이 이미 누구 것인지 말해 준다.
                  시간은 묶음의 마지막에만(위 showTime).
                */}
                {showTime && (
                  <span className="mt-0.5 px-1 text-[.68rem] font-bold text-ink-mute">
                    {mine ? m.time : `선생님 · ${m.time}`}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/*
          입력줄도 **판 안에** 둔다 — 밖에 두면 "쪽지는 위, 쓰는 곳은 아래" 두 덩어리가
          되는데, 읽고 쓰는 건 한 일이다. 목록과 달리 스크롤되지 않고 판 아래에 붙어 있다.
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
            placeholder="선생님께 메시지"
            /* 흰 판 안이라 배경도 흰색이면 칸이 사라진다 — 옅은 파란 바탕 + 하늘색 테두리로 구분 */
            className="min-w-0 flex-1 rounded-2xl border-2 border-sky-deep bg-note-paper px-3 py-2 text-[.88rem] font-medium outline-none focus:border-primary focus:bg-white"
          />
          <Button variant="primary" size="sm" type="submit" disabled={!text.trim()}>
            보내기
          </Button>
        </form>
      </div>
    </div>
  )
}
