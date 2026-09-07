import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { chatApi } from '@/services/api/chatApi'
import { useLiveStore } from '@/stores/useLiveStore'
import { useToastStore } from '@/stores/useToastStore'
import { cn } from '@/lib/cn'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import { markNotice } from '@/lib/notice'
import { chatPeerId, isMine, isOtherTeacher } from '@/lib/chatMessage'
import { useAuthStore } from '@/stores/useAuthStore'
// 시간 문구는 아래 지역 hhmm(날짜 폴백 포함)이 만들고, 묶음 규칙만 공용을 쓴다
import { endsMinuteRun } from '@/lib/chatTime'
import type { ChatMessageDto } from '@/types/chat'
import type { StudentAccount } from '@/types/teacher'

/** 이름 첫 글자 아바타 색 — ref 는 하드코딩이라 이름 해시로 같은 팔레트를 돌린다 */
const AVATAR_COLORS = ['#3CB878', '#F2994A', '#8B7CF6', '#4A90D9', '#E0679B']
function avatarColor(name: string): string {
  let sum = 0
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i)
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** 전체 공지 방의 가상 스레드 키 — 실제 학생 userId 와 겹치지 않는 음수 */
const NOTICE = -1

/** 선생님 아바타 색 (ref TEACHER_AV) */
const TEACHER_AV = '#3CB878'

// ── ref 클래스 → 유틸 (한 번만 적고 재사용) ────────────────────────────
const HEAD = 'flex items-center gap-2.5 p-[20px_22px_16px]'
/**
 * 방 안(공지·1:1·학생 고르기)은 옅은 띠 + 진한 경계선으로 "한 단계 들어왔다"를 알린다.
 *
 * 위쪽 라운드(`rounded-t-[26px]`)는 뺐다 — 이 패널이 자기 카드였을 때 카드 모서리를 따라가던
 * 값인데, 지금은 드로어 카드 **안쪽**이라 둥근 선이 네모난 면 위에 홀로 떠 보였다.
 */
const HEAD_INNER = 'justify-start border-b-2 border-[#E1E4EF] bg-[#F5F6FB]'
const TITLE = 'flex items-center gap-2 text-widget-title font-black'
const BACK_BTN =
  'grid h-[30px] w-[30px] flex-none place-items-center rounded-[10px] text-ink-soft transition-colors hover:bg-[#F1F2F6] hover:text-primary'
const LIST = 'flex min-h-0 flex-1 flex-col overflow-y-auto pb-2 [overscroll-behavior:contain]'
/** 행 구분선은 아바타 폭(20+30+10)만큼 들여써 이름 글씨에 맞춘다 */
const ROW =
  "relative flex w-full items-center gap-2.5 p-[11px_20px] text-left transition-colors hover:bg-chat-surface after:absolute after:bottom-0 after:left-[60px] after:right-0 after:h-px after:bg-[#F1F2F6] after:content-[''] last:after:content-none"
const AVATAR =
  'grid h-[30px] w-[30px] flex-none place-items-center rounded-full text-[.72rem] font-black text-white'
const ROW_NAME = 'flex items-center gap-1.5 text-[.88rem] font-extrabold text-ink'
const ROW_SUB = 'mt-0.5 block truncate text-[.74rem] font-semibold text-ink-mute'
/** ref `.empty-state.lchat-empty` — 크기는 .empty-state(1rem 상속 / 700), 패딩·행간은 .lchat-empty */
const EMPTY =
  'grid flex-1 place-items-center p-[20px_22px] text-center text-base font-bold leading-[1.6] text-ink-mute [word-break:keep-all]'
const SCROLL =
  'flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-[16px_20px_0] [overscroll-behavior:contain]'
const INPUT_ROW = 'mt-3.5 flex flex-none gap-2 border-t-[1.5px] border-[#EFF0F4] p-[14px_16px_16px]'
const INPUT =
  'min-w-0 flex-1 rounded-xl border-[1.5px] border-transparent bg-chat-surface p-[11px_14px] text-[.85rem] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-mute focus:border-primary focus:bg-card'
const SEND_BTN =
  'flex-none rounded-xl bg-primary p-[11px_18px] text-[.85rem] font-extrabold text-white transition-colors hover:bg-primary-hover'

/** 묶음 열쇠 — 보낸 사람이 바뀌거나 분이 넘어가면 묶음이 끊긴다 (lib/chatTime) */
const minuteKey = (m: Msg): string => `${m.mine}|${hhmm(m.at)}`

/**
 * 말풍선 한 줄 (ref .chat-msg) — 내 것은 아바타까지 오른쪽으로 넘긴다.
 *
 * 머리줄(이름·시간)은 **보일 게 있을 때만** 그린다. 내 말풍선에는 이름을 달지 않고
 * (오른쪽 정렬과 색이 이미 누구 것인지 말해 준다), 시간은 분 묶음의 마지막에만 보인다
 * (`showTime`). 빈 `<p>` 를 남기면 말풍선 사이가 그만큼 벌어진다.
 */
function Bubble({ m, av, showTime }: { m: Msg; av: string; showTime: boolean }) {
  return (
    <div className={cn('flex items-start gap-2.5', m.mine && 'flex-row-reverse')}>
      <span className={AVATAR} style={{ background: av }} aria-hidden="true">
        {m.name.slice(0, 1)}
      </span>
      <div className={cn('min-w-0', m.mine && 'text-right')}>
        {(showTime || !m.mine) && (
          <p className="text-[.78rem] font-extrabold text-ink">
            {!m.mine && m.name}
            {showTime && (
              <span className={cn('text-[.7rem] font-semibold text-ink-mute', !m.mine && 'ml-1')}>
                {hhmm(m.at)}
              </span>
            )}
          </p>
        )}
        {/* 말풍선 위치만 오른쪽이고 안의 글은 그대로 왼쪽 정렬 — 여러 줄일 때 오른쪽 정렬은 읽기 나쁘다 */}
        <span
          className={cn(
            'mt-[5px] inline-block rounded-[4px_14px_14px_14px] bg-chat-surface p-[8px_12px] text-left text-[.84rem] font-semibold leading-[1.45] text-ink',
            m.mine && 'rounded-[14px_4px_14px_14px] bg-sky',
          )}
        >
          {m.text}
        </span>
      </div>
    </div>
  )
}

/** 패널 안에서 갈아 끼우는 4개 뷰 (ref data-lview) */
type LView = 'rooms' | 'pick' | 'group' | 'dm'

interface Msg {
  key: string
  /** 이 메시지가 속한 스레드 (학생 userId, 전체 공지는 NOTICE) */
  threadId: number
  name: string
  text: string
  at: string
  /** 내가(선생님) 보낸 것 */
  mine: boolean
}

interface LiveChatPanelProps {
  sessionId: number | null
  /** 학급 명단 — 학생 고르기(pick) 목록과 전체 공지 배달 대상 */
  students: StudentAccount[]
  /** STOMP 발행 (보냈으면 true). 교사 역할이면 `/pub/sessions/{id}/messages/reply` 로 나간다 */
  send: (event: string, payload?: Record<string, unknown>) => boolean
}

/**
 * 수업 채팅 — 레퍼런스 teacher.html `.chat-panel` 이관 (한 패널 안 4개 뷰).
 *
 *  rooms : 방 목록 (전체 공지 + 대화가 있는 학생)
 *  pick  : 학생 고르기 (+ 버튼, 학급 명단 전체 + 검색)
 *  group : 전체 공지 방
 *  dm    : 1:1 방
 *
 * 전송은 전부 실제 STOMP 발행이다. 백엔드 채팅은 **학생↔담당 교사 1:1** 라우팅뿐이라
 * "반 전체 발행구"가 없어서, 전체 공지는 학급 명단을 돌며 1:1 로 배달한다(방 안에 그 사실을
 * 그대로 적어 둔다 — 화면에만 뿌리고 안 보내는 척은 하지 않는다).
 * `send()` 가 false 면 낙관적 표시 없이 실패를 알린다.
 */
export function LiveChatPanel({ sessionId, students, send }: LiveChatPanelProps) {
  const [history, setHistory] = useState<ChatMessageDto[]>([])
  /** 내가 방금 보낸 것 — 서버가 교사에게 자기 답장을 되돌려주지 않아 화면 유지는 이쪽 몫 */
  const [sent, setSent] = useState<Msg[]>([])
  const liveMessages = useLiveStore((s) => s.liveMessages)
  const showToast = useToastStore((s) => s.show)
  /** 내 userId — 이력 한 줄이 내 말인지 가르는 기준 (lib/chatMessage) */
  const myUserId = useAuthStore((s) => s.user?.id ?? null)

  const [view, setView] = useState<LView>('rooms')
  const [dmId, setDmId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [groupDraft, setGroupDraft] = useState('')
  const [dmDraft, setDmDraft] = useState('')
  useEffect(() => {
    if (sessionId === null) {
      setHistory([])
      return
    }
    let cancelled = false
    void chatApi
      .listMessages(sessionId)
      .then((list) => {
        if (!cancelled) setHistory(list)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  /** 이력(REST) + 수업 중 실시간 도착분(STOMP) + 내가 보낸 것을 시간순으로 합친다 */
  const messages = useMemo<Msg[]>(() => {
    /*
      한 줄이 **누구 방**인지는 `chatPeerId` 가 정한다 (내가 보낸 줄이면 답장 원본의 주인).
      예전에는 `m.studentId`(실은 보낸 사람 id)를 방 번호로 써서, 내가 보낸 말이 '내 id' 방으로
      들어가 어느 대화에도 안 보였다. 상대를 알 수 없는 줄은 방에 끼우지 않는다.
    */
    const fromHistory = history.flatMap<Msg>((m) => {
      // 동료 선생님이 보낸 줄은 학생 방이 아니다 (lib/chatMessage.isOtherTeacher 주석)
      if (isOtherTeacher(m, myUserId)) return []
      const peer = chatPeerId(m, myUserId)
      if (peer == null) return []
      const mine = isMine(m, myUserId)
      return [
        {
          key: `h${m.id}`,
          threadId: peer,
          name: mine ? '선생님' : m.senderName || '학생',
          text: m.text,
          at: m.at,
          mine,
        },
      ]
    })
    const fromLive = liveMessages.map<Msg>((m) => ({
      key: `l${m.id}`,
      threadId: m.teacher ? NOTICE : m.from,
      name: m.teacher ? '선생님' : m.name,
      text: m.text,
      at: m.at,
      mine: m.teacher,
    }))
    // 같은 메시지가 이력과 실시간 양쪽에 있을 수 있어 (보낸사람+내용+분)으로 한 번 걸러낸다
    const seen = new Set<string>()
    return [...fromHistory, ...fromLive, ...sent]
      .sort((a, b) => a.at.localeCompare(b.at))
      .filter((m) => {
        const sig = `${m.threadId}|${m.mine}|${m.text}|${m.at.slice(0, 16)}`
        if (seen.has(sig)) return false
        seen.add(sig)
        return true
      })
  }, [history, liveMessages, sent, myUserId])

  // 하단 추적은 공용 훅 (채팅 화면 4곳이 같은 규칙) — messages 선언 뒤에 와야 한다
  const scroll = useStickToBottom<HTMLDivElement>(messages)

  /** 스레드별로 나눠 둔다 — 방 목록 미리보기와 각 방의 본문이 같은 출처를 쓴다 */
  const threads = useMemo(() => {
    const map = new Map<number, Msg[]>()
    for (const m of messages) {
      const list = map.get(m.threadId)
      if (list) list.push(m)
      else map.set(m.threadId, [m])
    }
    return map
  }, [messages])

  const dmStudent = students.find((s) => s.userId === dmId) ?? null
  const noticeMsgs = threads.get(NOTICE) ?? []
  const dmMsgs = dmId === null ? [] : (threads.get(dmId) ?? [])

  /** 대화가 오간 학생만 방 목록에 남긴다 (새 대화는 헤더의 + 로 시작) */
  const rooms = students.filter((s) => (threads.get(s.userId)?.length ?? 0) > 0)

  const picked = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return students
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.username.toLowerCase().includes(q),
    )
  }, [students, query])

  /*
    하단 추적은 공용 훅이 맡는다(useStickToBottom). 예전에는 여기서 직접 재면서
    **뷰를 바꿀 때도 가드를 통과해야 해서**, 대화방을 처음 열면 `scrollTop === 0` 이라
    긴 이력이 맨 위(가장 오래된 메시지)에서 시작했다.
  */
  useEffect(() => {
    // 방/뷰를 바꿔 들어오면 최신 메시지가 보여야 한다
    scroll.stick()
  }, [view, dmId, scroll])

  /**
   * 한 명에게 보내기. 백엔드 답장 발행구는 `replyToId` 를 받으므로, 그 학생이 마지막으로 보낸
   * 이력 메시지를 물려 준다.
   *
   * 전에는 이게 **"누구와의 대화인지"의 유일한 근거**라 빼면 새로고침 뒤 말풍선이 어느 방에도
   * 안 붙었다. 이제 서버가 recipient 를 저장하므로(lib/chatMessage) 그 위험은 없고, 답장 사슬은
   * 맥락 표시·옛 데이터 호환용으로만 남는다.
   */
  function publishTo(studentId: number, text: string): boolean {
    const replyToId =
      history.filter((m) => !isMine(m, myUserId) && m.senderId === studentId).at(-1)?.id ?? null
    return send('CHAT_MESSAGE', { studentId, message: text, replyToId })
  }

  function localEcho(threadId: number, text: string) {
    const at = new Date().toISOString()
    setSent((prev) => [
      ...prev,
      { key: `s${threadId}-${at}-${text}`, threadId, name: '선생님', text, at, mine: true },
    ])
  }

  function submitDm(e: React.FormEvent) {
    e.preventDefault()
    const text = dmDraft.trim()
    if (!text || dmStudent === null) return
    if (!publishTo(dmStudent.userId, text)) {
      showToast('메시지를 보내지 못했어요. 수업 연결을 확인해 주세요.')
      return
    }
    localEcho(dmStudent.userId, text)
    setDmDraft('')
  }

  function submitGroup(e: React.FormEvent) {
    e.preventDefault()
    const text = groupDraft.trim()
    if (!text) return
    if (students.length === 0) {
      showToast('보낼 학생이 없어요. 학급 관리에서 계정을 먼저 만들어 주세요.')
      return
    }
    /*
      **공지 표식을 붙여 보낸다** (lib/notice). 서버에는 공지 개념이 없어 1:1 쪽지와 payload 가
      똑같으므로, 이 표식이 없으면 학생 화면이 공지를 따로 알릴 방법이 없다.
      학생 쪽에서 표식을 벗기고 알림으로 띄운다 — 본문에는 보이지 않는다.
    */
    const failed = students.filter((s) => !publishTo(s.userId, markNotice(text)))
    if (failed.length === students.length) {
      showToast('공지를 보내지 못했어요. 수업 연결을 확인해 주세요.')
      return
    }
    if (failed.length > 0) showToast(`${failed.length}명에게는 전달하지 못했어요.`)
    localEcho(NOTICE, text)
    setGroupDraft('')
  }

  function openDm(studentId: number) {
    setDmId(studentId)
    setView('dm')
  }

  function back() {
    setDmId(null)
    setView('rooms')
  }

  return (
    /*
      높이를 스스로 정하지 않는다. 예전엔 `h-[450px]` 고정이었는데, Zoom 식 드로어 안에서는
      드로어가 준 높이를 꽉 채워야 한다 — 고정 높이면 입력창이 드로어 중간에 떠 버린다.
      호출부가 높이를 주지 않는 경우를 대비해 `min-h-0 flex-1` 로 부모를 따른다.

      **자기 카드 껍데기(라운드·테두리·그림자·흰 면)를 갖지 않는다.** 드로어가 이미 카드 한
      장이고(탭 줄과 같은 흰 면), 그 안에 또 카드를 그리면 흰 면 위 흰 면에 둥근 선이 겹쳐
      이중 액자가 된다 — 학생 영역(`ParticipantsCard`)과 같은 판단이다.
    */
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── 상태 1(루트): 채팅방 목록 ── */}
      {view === 'rooms' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn(HEAD, 'justify-between border-b-2 border-[#E1E4EF]')}>
            <span className={TITLE}>
              <Icon name="chat" className="h-[22px] w-[22px] flex-none text-primary" />
              수업 채팅
            </span>
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setView('pick')
              }}
              title="학생에게 새로 메시지 보내기"
              aria-label="학생에게 새로 메시지 보내기"
              className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full text-ink-mute transition-[background,color,transform] duration-200 ease-bounce hover:-translate-y-0.5 hover:bg-sky hover:text-primary"
            >
              <Icon name="plus" className="h-4 w-4" />
            </button>
          </div>

          <div className={LIST}>
            {/* 전체 공지는 메시지가 없어도 항상 첫 줄에 고정한다 */}
            <button type="button" onClick={() => setView('group')} className={ROW}>
              <span className={cn(AVATAR, 'bg-primary')} aria-hidden="true">
                <Icon name="bell" className="h-[15px] w-[15px]" />
              </span>
              <span className="block min-w-0 flex-1">
                <span className={ROW_NAME}>전체 공지</span>
                <span className={ROW_SUB}>
                  {noticeMsgs.at(-1) ? `나: ${noticeMsgs.at(-1)?.text}` : '반 전체에게 보내요'}
                </span>
              </span>
            </button>

            {rooms.length === 0 ?
              <p className={EMPTY}>학생과의 대화는 오른쪽 위 + 로 시작해요</p>
            : rooms.map((s) => {
                const last = threads.get(s.userId)?.at(-1)
                return (
                  <button
                    key={s.userId}
                    type="button"
                    onClick={() => openDm(s.userId)}
                    className={ROW}
                  >
                    <span className={AVATAR} style={{ background: avatarColor(s.name) }} aria-hidden="true">
                      {s.name.slice(0, 1)}
                    </span>
                    <span className="block min-w-0 flex-1">
                      <span className={ROW_NAME}>{s.name}</span>
                      <span className={ROW_SUB}>
                        {last ? `${last.mine ? '나: ' : ''}${last.text}` : '아직 대화가 없어요'}
                      </span>
                    </span>
                  </button>
                )
              })
            }
          </div>
        </div>
      )}

      {/* ── 상태 2: 학생 고르기 ── */}
      {view === 'pick' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn(HEAD, HEAD_INNER)}>
            <button
              type="button"
              onClick={back}
              aria-label="채팅방 목록으로 돌아가기"
              className={BACK_BTN}
            >
              <Icon name="back" className="h-4 w-4" />
            </button>
            <span className={TITLE}>학생 선택</span>
          </div>

          <div className="relative flex-none border-b-[1.5px] border-[#EFF0F4] p-[12px_16px]">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="학생 이름으로 찾기"
              autoComplete="off"
              aria-label="학생 이름으로 찾기"
              className="w-full rounded-[10px] border-[1.5px] border-transparent bg-chat-surface p-[9px_36px_9px_13px] text-[.84rem] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-mute focus:border-primary focus:bg-card"
            />
            <Icon
              name="search"
              className="pointer-events-none absolute right-7 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute"
            />
          </div>

          <div className={LIST}>
            {picked.length === 0 ?
              <p className={EMPTY}>
                {students.length === 0 ?
                  '이 수업에 학생이 없어요'
                : `'${query.trim()}' 검색 결과가 없어요`}
              </p>
            : picked.map((s) => (
                <button key={s.userId} type="button" onClick={() => openDm(s.userId)} className={ROW}>
                  <span className={AVATAR} style={{ background: avatarColor(s.name) }} aria-hidden="true">
                    {s.name.slice(0, 1)}
                  </span>
                  <span className="block min-w-0 flex-1">
                    <span className={ROW_NAME}>{s.name}</span>
                    <span className={ROW_SUB}>
                      {s.grade}학년 모둠 · {s.username}
                    </span>
                  </span>
                </button>
              ))
            }
          </div>
        </div>
      )}

      {/* ── 상태 3: 전체 공지 방 ── */}
      {view === 'group' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn(HEAD, HEAD_INNER)}>
            <button
              type="button"
              onClick={back}
              aria-label="채팅방 목록으로 돌아가기"
              className={BACK_BTN}
            >
              <Icon name="back" className="h-4 w-4" />
            </button>
            <span className="flex min-w-0 items-center gap-[9px] text-widget-title font-black">
              <span className={cn(AVATAR, 'bg-primary')} aria-hidden="true">
                <Icon name="bell" className="h-[15px] w-[15px]" />
              </span>
              <span className="truncate">전체 공지</span>
            </span>
          </div>

          <div ref={scroll.ref} onScroll={scroll.onScroll} className={SCROLL}>
            {/*
              백엔드에 "반 전체" 발행구가 없다는 사실을 숨기지 않는다. 실제로는 학급 명단을 돌며
              1:1 로 배달하므로, 학생 화면에는 선생님이 개인적으로 보낸 메시지로 도착한다.
            */}
            <p className="rounded-[12px] bg-task-soft p-[9px_12px] text-[.76rem] font-semibold leading-[1.5] text-task-deep">
              전체 공지는 학생 {students.length}명에게 한 명씩 따로 배달돼요.
              <br />
              학생 화면에는 선생님이 보낸 메시지로 보여요.
            </p>
            {noticeMsgs.length === 0 ?
              <p className={EMPTY}>반 전체에게 보낼 첫 공지를 적어 보세요</p>
            : noticeMsgs.map((m, i) => (
                <Bubble
                  key={m.key}
                  m={m}
                  av={TEACHER_AV}
                  showTime={endsMinuteRun(noticeMsgs, i, minuteKey)}
                />
              ))}
          </div>

          <form onSubmit={submitGroup} className={INPUT_ROW}>
            <input
              type="text"
              value={groupDraft}
              onChange={(e) => setGroupDraft(e.target.value)}
              placeholder="반 전체에게 보낼 메시지"
              autoComplete="off"
              className={INPUT}
            />
            <button type="submit" className={SEND_BTN}>
              전송
            </button>
          </form>
        </div>
      )}

      {/* ── 상태 4: 1:1 방 ── */}
      {view === 'dm' && dmStudent && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn(HEAD, HEAD_INNER)}>
            <button
              type="button"
              onClick={back}
              aria-label="채팅방 목록으로 돌아가기"
              className={BACK_BTN}
            >
              <Icon name="back" className="h-4 w-4" />
            </button>
            <span className="flex min-w-0 items-center gap-[9px] text-widget-title font-black">
              <span
                className={AVATAR}
                style={{ background: avatarColor(dmStudent.name) }}
                aria-hidden="true"
              >
                {dmStudent.name.slice(0, 1)}
              </span>
              <span className="truncate">{dmStudent.name}</span>
            </span>
          </div>

          <div ref={scroll.ref} onScroll={scroll.onScroll} className={SCROLL}>
            {dmMsgs.length === 0 ?
              <p className={EMPTY}>첫 메시지를 보내 보세요</p>
            : dmMsgs.map((m, i) => (
                <Bubble
                  key={m.key}
                  m={m}
                  av={m.mine ? TEACHER_AV : avatarColor(dmStudent.name)}
                  showTime={endsMinuteRun(dmMsgs, i, minuteKey)}
                />
              ))
            }
          </div>

          <form onSubmit={submitDm} className={INPUT_ROW}>
            <input
              type="text"
              value={dmDraft}
              onChange={(e) => setDmDraft(e.target.value)}
              placeholder="답장을 입력하세요"
              autoComplete="off"
              className={INPUT}
            />
            <button type="submit" className={SEND_BTN}>
              전송
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
