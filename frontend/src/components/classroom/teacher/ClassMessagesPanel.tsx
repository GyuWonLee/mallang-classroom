import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { chatApi, directChatApi, teacherRoomApi } from '@/services/api/chatApi'
import { apiErrorMessage, errorStatus } from '@/lib/apiError'
import { TEACHER_ROOM_ID, chatPeerId, isMine, isOtherTeacher } from '@/lib/chatMessage'
import { useAuthStore } from '@/stores/useAuthStore'
import { cn } from '@/lib/cn'
// 시간 문구는 아래 지역 hhmm 이 만들고, 묶음 규칙만 공용을 쓴다 (lib/chatTime 주석 참고)
import { endsMinuteRun } from '@/lib/chatTime'
import { useClassroomSocket } from '@/hooks/useClassroomSocket'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import { useToastStore } from '@/stores/useToastStore'
import type { ChatMessageDto, DirectThread } from '@/types/chat'
import type { ServerEvent } from '@/types/signaling'
import type { StudentAccount } from '@/types/teacher'

/** 목록·스레드에서 함께 쓰는 한 줄 (이력·실시간·내가 방금 보낸 것을 같은 모양으로 다룬다) */
interface Row {
  key: string
  studentId: number
  name: string
  text: string
  at: string
  mine: boolean
}

const firstChar = (name: string) => name.trim().charAt(0) || '?'
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })

/**
 * 학급 화면의 메시지 패널 — **이 패널 안에서 바로 대화한다.**
 *
 * 예전에는 헤더의 + 나 학생 줄을 누르면 `/teacher/chat` 으로 **화면을 옮겨** 대화했다.
 * 학급 화면에서 학생 이름을 확인하고, 답장하러 나갔다가, 다시 돌아오는 왕복이 생겨
 * "지금 이 학급을 보고 있다"는 맥락이 끊겼다. 수업 중 채팅(LiveChatPanel)처럼 제자리에서
 * 목록 <-> 대화를 오간다.
 *
 * **수업이 없어도 보낼 수 있다** (백엔드 S15P11A407-137 §11.1 #3, 마이그레이션 V14).
 * 예전에는 전송이 STOMP `/pub/sessions/{id}/messages` 뿐이라 세션이 없으면 보낼 곳이 없었고,
 * 그래서 입력창을 감추고 "수업 중일 때만" 이라고 적어야 했다. 이제 수업 밖 1:1 REST 가 생겨
 * 경로를 상황에 따라 고른다:
 *  - 수업 중  → STOMP (실시간 배달 · 기존 그대로)
 *  - 수업 밖  → `POST /classrooms/{id}/chat/messages` (REST)
 *
 * 받는 쪽도 둘을 합쳐 보여준다. 수업 밖 메시지는 `sessionId` 가 null 로 저장되므로 서버에서
 * 이미 구분돼 있고, 화면에서는 같은 스레드에 시간순으로 섞으면 된다 — 사람에게는 "그 사람과
 * 주고받은 말"이 하나의 대화지 수업 단위로 갈린 두 개가 아니다.
 */
export function ClassMessagesPanel({
  sessionId,
  classroomId,
  students,
  className,
}: {
  sessionId: number | null
  /** 수업 밖 1:1 전송·조회에 필요하다 (수업이 없어도 학급은 있다) */
  classroomId: string
  students: StudentAccount[]
  /**
   * 껍데기 위치·크기 (호출부가 정한다).
   *
   * 이 패널은 **자기 높이를 스스로 정하면 안 된다.** 내부는 이미
   * `min-h-0 flex-1 overflow-y-auto` 라 높이가 정해지면 알아서 스크롤하는데, 높이가 없으면
   * 대화 길이만큼 늘어나 **같은 그리드 행의 옆 카드까지 끌고 늘어난다.**
   */
  className?: string
}) {
  const showToast = useToastStore((s) => s.show)
  /** 내 userId — 이력 한 줄이 내 말인지 가르는 기준 (추정하지 않는다, lib/chatMessage) */
  const myUserId = useAuthStore((s) => s.user?.id ?? null)

  /** 저장된 이력 (수업이 있을 때만 조회 대상이 있다) */
  const [history, setHistory] = useState<ChatMessageDto[]>([])
  /** 소켓으로 새로 도착한 것 */
  const [live, setLive] = useState<Row[]>([])
  /** 내가 방금 보낸 것 — 서버가 되돌려주지 않으므로 화면에 즉시 남긴다 */
  const [sent, setSent] = useState<Row[]>([])
  /** 지금 열어 둔 상대와의 **수업 밖** 대화 (수업 이력과 합쳐 한 스레드로 보여준다) */
  const [direct, setDirect] = useState<Row[]>([])

  /**
   * 학급 교사 단톡방 — 마지막 한 줄과 안 읽은 수 (목록에 칸을 그릴 근거).
   *
   * 학생 대화와 출처가 완전히 달라 따로 둔다. 상대가 없는 방이라 `summaries`(상대별 요약)에
   * 끼워 넣을 자리가 없고, 저장도 다른 계통이다(recipient 가 없는 줄).
   */
  const [room, setRoom] = useState<{ lastText: string; lastAt: string; unread: number } | null>(null)
  /** 이 학급 선생님이 아니다(403) — 그때만 칸을 접는다. 그 밖의 실패로는 지우지 않는다 */
  const [roomDenied, setRoomDenied] = useState(false)
  /** 열어 둔 단톡방의 대화 — 학생 스레드(`threads`)와 섞이면 안 되므로 별도 */
  const [roomRows, setRoomRows] = useState<Row[]>([])

  /** 패널 껍데기 — 대화를 열 때 화면 안으로 끌어오는 데 쓴다 (openThread 주석) */
  const rootRef = useRef<HTMLDivElement>(null)

  const [view, setView] = useState<'list' | 'pick'>('list')
  const [activeId, setActiveId] = useState<number | null>(null)
  /**
   * 소켓 콜백이 읽는 `activeId`.
   *
   * 콜백을 activeId 에 의존시키면 대화를 열고 닫을 때마다 구독이 갈아 끼워진다. 값은 최신이어야
   * 하되 콜백은 그대로여야 해서 ref 로 읽는다 — 방을 보고 있으면 안 읽음을 올리지 않으려는 것뿐이다.
   */
  const activeIdRef = useRef<number | null>(null)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')

  const onEvent = useCallback((event: ServerEvent) => {
    /*
      교사 단톡방 새 메시지 — 개인 채널로 온다(수업이 없어도 열려 있다). **동료가 보낸 것만**
      온다: 서버가 발신자를 푸시 대상에서 뺀다.

      지금 보고 있는 학급의 방만 반영한다 — 선생님은 학급을 여럿 맡을 수 있고, 다른 학급
      방의 말이 이 패널에 섞이면 안 된다.
    */
    if (event.event === 'TEACHER_ROOM_MESSAGE') {
      if (String(event.classroomId) !== String(classroomId)) return
      const at = event.occurredAt ?? new Date().toISOString()
      const key = event.messageId != null ? `r${event.messageId}` : `r${at}-${event.message ?? ''}`
      /* 방을 열어 두었으면 대화에 붙이고, 아니면 목록의 안 읽은 수만 올린다 */
      setRoomRows((prev) =>
        prev.some((r) => r.key === key)
          ? prev
          : [
              ...prev,
              {
                key,
                studentId: TEACHER_ROOM_ID,
                name: event.senderName ?? '선생님',
                text: event.message ?? '',
                at,
                mine: false,
              },
            ],
      )
      setRoom((prev) => ({
        lastText: event.message ?? '',
        lastAt: at,
        unread: activeIdRef.current === TEACHER_ROOM_ID ? 0 : (prev?.unread ?? 0) + 1,
      }))
      return
    }
    if (event.event !== 'CHAT_MESSAGE') return
    const studentId = Number(event.studentId ?? 0)
    const at = event.occurredAt ?? new Date().toISOString()
    setLive((prev) => [
      ...prev,
      {
        key: `l${studentId}-${at}-${event.message ?? ''}`,
        studentId,
        name: event.senderName ?? '학생',
        text: event.message ?? '',
        at,
        mine: event.senderRole === 'TEACHER',
      },
    ])
  }, [classroomId])

  const { send } = useClassroomSocket({ sessionId, onEvent })

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

  // 수업이 바뀌면 방금 보낸 것·받은 것은 그 수업의 것이라 함께 비운다
  useEffect(() => {
    setLive([])
    setSent([])
    setActiveId(null)
    setView('list')
  }, [sessionId])

  /**
   * 열어 둔 상대와의 수업 밖 대화를 받아 오고, 동시에 읽음으로 찍는다.
   *
   * 스레드를 연 시점이 곧 "읽었다"는 뜻이라 서버 호출을 여기 붙였다. 읽음 처리는 실패해도
   * 화면을 막지 않는다 — 안 읽은 배지가 남을 뿐이고, 다음에 열면 다시 시도된다.
   */
  useEffect(() => {
    /* 단톡방은 상대가 없어 1:1 API 를 부를 수 없다 — 아래 전용 effect 가 맡는다 */
    if (activeId === null || activeId === TEACHER_ROOM_ID || !classroomId) {
      setDirect([])
      return
    }
    let cancelled = false
    void directChatApi
      .conversation(classroomId, activeId)
      .then((list) => {
        if (cancelled) return
        setDirect(
          list.map((m) => ({
            key: `d${m.id}`,
            studentId: activeId,
            name: m.senderName,
            text: m.content,
            at: m.at,
            /* 상대(=activeId)가 보낸 게 아니면 내가 보낸 것이다 */
            mine: m.senderId !== activeId,
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setDirect([])
      })
    /*
      읽음 처리. 성공하면 그 스레드의 안 읽은 수만 로컬로 내린다 — 목록 전체를 다시 받지
      않는다. 실패하면 아무것도 건드리지 않는다: 배지가 남아 있는 편이 정직하고, 다음에 열면
      다시 시도된다. (요청 자체는 취소하지 않는다 — 스레드를 연 건 사실이라 늦게 도착해도 맞다)
    */
    void directChatApi
      .markRead(classroomId, activeId)
      .then(() => {
        if (cancelled) return
        setSummaries((prev) =>
          prev.map((t) => (t.peerId === activeId ? { ...t, unreadCount: 0 } : t)),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeId, classroomId])

  /**
   * 교사 단톡방 요약 — 목록에 칸을 그릴 근거.
   *
   * 칸은 **요약 성공에 걸지 않는다.** 방이 있느냐는 학급 관리자냐로 정해지고(서버도 그렇게
   * 판정한다), 요약은 미리보기와 안 읽은 수를 얹어 줄 뿐이다. 요약이 500 이던 동안 칸이
   * 통째로 사라져 "방이 안 생긴다"로 보였던 적이 있어(d7bcf83) 실패를 삼키지 않는다.
   */
  useEffect(() => {
    if (!classroomId) return
    let cancelled = false
    void teacherRoomApi
      .summary(classroomId)
      .then((s) => {
        if (cancelled) return
        setRoomDenied(false)
        setRoom({
          lastText: s.lastMessage?.content ?? '',
          lastAt: s.lastMessage?.at ?? '',
          unread: s.unreadCount,
        })
      })
      .catch((err) => {
        if (cancelled) return
        /* 403 은 정말로 내 방이 아니라는 뜻 — 그때만 접는다 */
        const denied = errorStatus(err) === 403
        setRoomDenied(denied)
        setRoom(null)
        if (!denied) {
          showToast(apiErrorMessage(err, '선생님 단톡방 정보를 불러오지 못했어요.'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [classroomId, showToast])

  /**
   * 단톡방을 열면 대화를 받아 오고 읽음으로 찍는다 (학생 스레드와 같은 규칙).
   *
   * 못 받아도 목록의 마지막 한 줄은 남는다 — 빈 화면으로 만들지 않되, 눌렀는데 아무 일도
   * 안 일어난 것처럼 보이지 않게 이유는 말해 준다.
   */
  useEffect(() => {
    if (activeId !== TEACHER_ROOM_ID || !classroomId) return
    let cancelled = false
    void teacherRoomApi
      .list(classroomId)
      .then((list) => {
        if (cancelled) return
        setRoomRows(
          list.map((m) => ({
            key: `r${m.id}`,
            studentId: TEACHER_ROOM_ID,
            name: m.senderName,
            text: m.content,
            at: m.at,
            mine: m.senderId === myUserId,
          })),
        )
      })
      .catch((err) => {
        if (!cancelled) showToast(apiErrorMessage(err, '단톡방 대화를 불러오지 못했어요.'))
      })
    void teacherRoomApi
      .markRead(classroomId)
      .then(() => {
        if (!cancelled) setRoom((prev) => (prev ? { ...prev, unread: 0 } : prev))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeId, classroomId, myUserId, showToast])

  /** 네 출처를 시간순 한 줄로 합친다 */
  const rows = useMemo<Row[]>(() => {
    /*
      이력 한 줄이 **누구와의 대화인지**는 `chatPeerId` 가 정한다 — 내가 보낸 줄이면 답장 원본의
      주인(그 학생), 학생이 보낸 줄이면 보낸 사람 자신.
      예전에는 `m.studentId`(실은 보낸 사람 id)를 그대로 썼다. 그래서 내가 보낸 줄은 '내 id' 라는
      없는 대화방으로 들어가 화면에서 사라졌다.
      상대를 알 수 없는 줄(peer null)은 **끼워 넣지 않는다** — 그 값은 서버에도 없다(chatMessage 주석).
    */
    const fromHistory = history.flatMap<Row>((m) => {
      // 동료 선생님이 보낸 줄은 학생 대화가 아니다 (lib/chatMessage.isOtherTeacher 주석)
      if (isOtherTeacher(m, myUserId)) return []
      const peer = chatPeerId(m, myUserId)
      if (peer == null) return []
      const mine = isMine(m, myUserId)
      return [
        {
          key: `h${m.id}`,
          studentId: peer,
          name: mine ? '선생님' : m.senderName,
          text: m.text,
          at: m.at,
          mine,
        },
      ]
    })
    return [...fromHistory, ...direct, ...live, ...sent].sort((a, b) => a.at.localeCompare(b.at))
  }, [history, direct, live, sent, myUserId])

  const threads = useMemo(() => {
    const map = new Map<number, Row[]>()
    for (const r of rows) {
      const list = map.get(r.studentId)
      if (list) list.push(r)
      else map.set(r.studentId, [r])
    }
    return map
  }, [rows])

  /**
   * 대화 목록 요약 — GET /me/chat/threads (백엔드 S15P11A407-137 §11.1 #4).
   *
   * 안 읽은 개수만 쓰는 게 아니라 **목록에 누구를 띄울지**의 근거이기도 하다. 수업 이력
   * (`chatApi.listMessages`)에는 수업 밖 대화가 없고, 수업 밖 대화는 스레드를 열어야
   * 받아 오므로, 이게 없으면 **수업 밖에서만 주고받은 상대는 목록에 아예 안 뜬다**
   * (+ 로 이름을 찾아 들어가야 보인다).
   *
   * 이 학급 것만 골라 쓴다 — 목록은 내가 속한 모든 학급의 대화를 준다.
   *
   * **학급이 바뀔 때만 부른다.** 예전엔 스레드를 열 때마다(`activeId` 의존) 다시 받았는데,
   * 읽음 처리로 달라지는 값은 방금 연 그 스레드의 안 읽은 수 하나뿐이다. 그건 아래에서
   * 로컬로 0 으로 내리면 되므로, 대화방을 오갈 때마다 목록 전체를 왕복시킬 이유가 없었다.
   */
  const [summaries, setSummaries] = useState<DirectThread[]>([])
  useEffect(() => {
    if (!classroomId) return
    let cancelled = false
    void directChatApi
      .myThreads()
      .then((list) => {
        if (cancelled) return
        setSummaries(list.filter((t) => String(t.classroomId) === classroomId))
      })
      .catch(() => {
        if (!cancelled) setSummaries([])
      })
    return () => {
      cancelled = true
    }
  }, [classroomId])

  const summaryOf = useMemo(
    () => new Map(summaries.map((t) => [t.peerId, t])),
    [summaries],
  )

  /**
   * 대화가 오간 상대만 목록에 남긴다 (새 대화는 헤더의 + 로 시작).
   * 근거는 둘이다: 수업 채팅 이력(`threads`)과 수업 밖 대화 요약(`summaryOf`).
   */
  const conversations = useMemo(() => {
    const q = query.trim()
    return students
      .filter((s) => (threads.get(s.userId)?.length ?? 0) > 0 || summaryOf.has(s.userId))
      .map((s) => {
        const thread = threads.get(s.userId) ?? []
        const summary = summaryOf.get(s.userId)
        const lastRow = thread[thread.length - 1]
        /*
          두 출처 중 **더 최근 것**을 미리보기로 쓴다. 스레드를 안 열어 본 상대는 lastRow 가
          없고, 열어 본 상대는 direct 가 rows 에 합류해 lastRow 가 더 정확하다.
        */
        const useSummary =
          summary != null && (lastRow == null || summary.lastAt.localeCompare(lastRow.at) > 0)
        return {
          student: s,
          last: useSummary
            ? { text: summary.lastContent, at: summary.lastAt, mine: false }
            : lastRow,
        }
      })
      .filter((c) => !q || c.student.name.includes(q) || (c.last?.text ?? '').includes(q))
      .sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? ''))
  }, [students, threads, summaryOf, query])

  const pickable = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return students
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.username.toLowerCase().includes(q),
    )
  }, [students, query])

  const activeStudent = students.find((s) => s.userId === activeId) ?? null
  /** 단톡방을 열어 두었나 — 학생 스레드와 갈리는 분기점이라 이름을 붙여 둔다 */
  const roomOpen = activeId === TEACHER_ROOM_ID
  /** 대화 화면인가 (학생이든 단톡방이든) — 검색창·입력창의 표시 조건 */
  const inThread = activeStudent !== null || roomOpen
  const activeThread = roomOpen
    ? roomRows
    : activeId === null
      ? []
      : (threads.get(activeId) ?? [])

  // 하단 추적은 공용 훅 (useStickToBottom) — 새 메시지는 따라가고, 올려 읽는 중이면 자리를 지킨다
  const scroll = useStickToBottom<HTMLDivElement>(activeThread.length)

  // 대화를 새로 열면 **무조건** 최신 메시지로 — 예전엔 가드에 걸려 긴 이력이 맨 위에서 시작했다
  useEffect(() => {
    if (activeId !== null) scroll.stick()
  }, [activeId, scroll])

  /** 화면에 내 말풍선을 즉시 남긴다 (두 전송 경로가 같은 모양을 쓴다) */
  function pushMine(studentId: number, text: string) {
    const at = new Date().toISOString()
    setSent((prev) => [
      ...prev,
      { key: `s${studentId}-${at}-${text}`, studentId, name: '선생님', text, at, mine: true },
    ])
    setDraft('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return

    /*
      단톡방은 REST 하나뿐이다 — 수업과 무관한 방이라 STOMP 발행구가 없다.

      돌려받은 메시지를 **직접 목록에 붙인다.** 서버가 발신자를 푸시 대상에서 빼기 때문에
      메아리를 기다리면 내가 보낸 말이 화면에 안 뜬다(chatApi.teacherRoomApi 주석).
    */
    if (roomOpen) {
      try {
        const sent = await teacherRoomApi.send(classroomId, text)
        setRoomRows((prev) => [
          ...prev,
          {
            key: `r${sent.id}`,
            studentId: TEACHER_ROOM_ID,
            name: sent.senderName,
            text: sent.content,
            at: sent.at,
            mine: true,
          },
        ])
        setRoom({ lastText: sent.content, lastAt: sent.at, unread: 0 })
        setDraft('')
      } catch (err) {
        showToast(apiErrorMessage(err, '메시지를 보내지 못했어요.'))
      }
      return
    }

    if (activeStudent === null) return

    /*
      수업이 없으면 STOMP 로 보낼 곳이 없다 — 수업 밖 1:1 REST 로 보낸다.
      학생 입장에서는 어느 경로로 왔든 같은 대화라 화면 표시는 똑같다.
    */
    if (sessionId === null) {
      try {
        await directChatApi.send(classroomId, activeStudent.userId, text)
        pushMine(activeStudent.userId, text)
      } catch (err) {
        showToast(apiErrorMessage(err, '메시지를 보내지 못했어요.'))
      }
      return
    }

    /*
      백엔드 답장 발행구는 `replyToId` 를 받는다. 그 학생이 마지막으로 보낸 이력 메시지를 물려준다.

      전에는 이 값이 **"누구와의 대화인지"의 유일한 근거**여서, 비우면 새로고침 뒤 내 말풍선이
      어느 대화에도 붙지 못했다. 이제 서버가 recipient 를 저장하므로 그 위험은 없다 —
      그래도 계속 물려주는 이유는 답장 사슬 자체가 대화의 맥락이기 때문이다(옛 데이터 호환 겸).
    */
    const replyToId =
      history.filter((m) => !isMine(m, myUserId) && m.senderId === activeStudent.userId).at(-1)?.id ??
      null
    if (!send('CHAT_MESSAGE', { studentId: activeStudent.userId, message: text, replyToId })) {
      showToast('메시지를 보내지 못했어요. 수업 연결을 확인해 주세요.')
      return
    }
    pushMine(activeStudent.userId, text)
  }

  function openThread(userId: number) {
    setActiveId(userId)
    setView('list')
    setQuery('')
    /*
      대화를 열면 **패널을 화면 안으로 끌어온다.**

      입력창은 패널 맨 아래에 있다. 학급 화면에서 이 패널은 오른쪽 열(학년별 수업 + 오늘의 활동)
      높이만큼 자리를 갖는데, 그 합이 화면보다 크면 대화를 열어도 입력창이 화면 밖에 있어서
      **답장하려면 아래로 스크롤해서 입력창을 찾아야 했다.**

      호출부가 패널 높이를 보이는 칸 이하로 묶어 두므로(TeacherClassDetailPage 의 max-h),
      `block:'nearest'` 는 **필요한 만큼만** 스크롤해 패널을 통째로 보이게 한다 — 이미 다 보이면
      아무 일도 하지 않는다. 스크롤 컨테이너가 무엇인지 이 패널이 알 필요는 없다.
    */
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const headTitle = roomOpen
    ? '선생님 단톡방'
    : activeStudent
      ? `${activeStudent.name} 학생`
      : view === 'pick'
        ? '학생 고르기'
        : '메시지'

  /**
   * 목록에 단톡방 칸을 보이나.
   *
   * 403(내 방이 아님)이면 접는다. 검색 중에는 방 이름이나 마지막 줄에 걸릴 때만 남긴다 —
   * 학생 대화가 검색으로 걸러지는데 방만 계속 붙어 있으면 결과가 아니라 고정 장식이 된다.
   */
  const showRoom = useMemo(() => {
    if (roomDenied || !classroomId) return false
    const q = query.trim()
    if (!q) return true
    return '선생님 단톡방'.includes(q) || (room?.lastText ?? '').includes(q)
  }, [roomDenied, classroomId, query, room])

  return (
    <div
      ref={rootRef}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-card border-[1.5px] border-panel-line bg-white shadow-panel',
        className,
      )}
    >
      {/* 헤더는 진한 단색이 아니라 연라벤더 밴드 — 배너와 같은 톤 (ref .msg-panel-head) */}
      <div className="flex items-center justify-between gap-2.5 bg-sidebar-soft p-[20px_22px] text-ink">
        <span className="flex min-w-0 items-center gap-2.5 text-panel-title font-black">
          {inThread || view === 'pick' ? (
            <button
              type="button"
              aria-label="메시지 목록으로"
              onClick={() => {
                setActiveId(null)
                setView('list')
                setQuery('')
              }}
              className="grid h-8 w-8 flex-none place-items-center rounded-full text-sidebar transition-colors hover:bg-white/70"
            >
              <Icon name="back" className="h-[18px] w-[18px]" />
            </button>
          ) : (
            <Icon name="mail" className="h-7 w-7 flex-none text-sidebar" />
          )}
          <span className="truncate">{headTitle}</span>
        </span>
        {!inThread && view === 'list' && (
          <button
            type="button"
            aria-label="새 메시지 쓰기"
            onClick={() => {
              setView('pick')
              setQuery('')
            }}
            className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full bg-sidebar text-white transition-[background,transform] duration-150 hover:-translate-y-px hover:bg-[#5C70AC]"
          >
            <Icon name="plus" className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 검색은 목록/고르기에서만 — 대화 중에는 자리를 입력창에 준다 */}
      {!inThread && (
        <div className="border-b border-track p-[14px_16px]">
          <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-track bg-canvas p-[10px_16px]">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="text"
              placeholder={view === 'pick' ? '학생 이름 검색' : '메시지 검색'}
              className="min-w-0 flex-1 bg-transparent text-[.88rem] outline-none placeholder:text-ink-mute"
            />
            <Icon name="search" className="h-4 w-4 flex-none text-ink-mute" />
          </div>
        </div>
      )}

      <div ref={scroll.ref} onScroll={scroll.onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {/* ── 대화 ─────────────────────────────────────────── */}
        {inThread ? (
          activeThread.length === 0 ? (
            <EmptyState
              icon="chat"
              title="아직 대화가 없어요"
              hint={
                roomOpen
                  ? '같은 학급 선생님들이 함께 보는 방이에요.'
                  : '아래에 첫 메시지를 적어 보세요.'
              }
              className="min-h-[200px]"
            />
          ) : (
            <ul className="flex flex-col gap-2.5 p-4">
              {activeThread.map((m, i) => (
                <li key={m.key} data-mine={m.mine} className="flex flex-col data-[mine=true]:items-end">
                  {/*
                    단톡방에는 선생님이 여럿이라 **누가 한 말인지** 적어야 한다. 1:1 대화는
                    상대가 한 명뿐이라(헤더에 이름이 있다) 붙이지 않는다.
                    같은 사람이 연달아 말하면 첫 줄에만 — 이름이 줄마다 반복되면 읽기 나쁘다.
                  */}
                  {roomOpen && !m.mine && activeThread[i - 1]?.name !== m.name && (
                    <span className="mb-1 text-[.76rem] font-bold text-ink-mute">{m.name}</span>
                  )}
                  <span
                    data-mine={m.mine}
                    className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl p-[10px_14px] text-[.92rem] font-medium data-[mine=false]:bg-sky data-[mine=false]:text-ink data-[mine=true]:bg-primary data-[mine=true]:text-white"
                  >
                    {m.text}
                  </span>
                  {/* 같은 사람이 같은 분에 연달아 보냈으면 마지막 것에만 시간을 보인다 */}
                  {endsMinuteRun(activeThread, i, (x) => `${x.mine}|${hhmm(x.at)}`) && (
                    <span className="mt-1 text-[.72rem] font-semibold text-ink-mute">{hhmm(m.at)}</span>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : view === 'pick' ? (
          /* ── 학생 고르기 ────────────────────────────────── */
          pickable.length === 0 ? (
            <EmptyState
              icon="students"
              title={students.length ? '검색 결과가 없어요' : '아직 등록된 학생이 없어요'}
              hint={students.length ? undefined : '학급 관리에서 학생 계정을 먼저 만들어 주세요.'}
              className="min-h-[200px]"
            />
          ) : (
            pickable.map((s) => (
              <button
                key={s.userId}
                type="button"
                onClick={() => openThread(s.userId)}
                className="flex w-full items-center gap-3 border-b border-track p-[14px_16px] text-left transition-colors hover:bg-canvas"
              >
                <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-sky text-base font-black text-primary">
                  {firstChar(s.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[1rem] font-extrabold">{s.name}</span>
                  <span className="block text-[.82rem] font-medium text-ink-mute">{s.grade}학년</span>
                </span>
                <Icon name="chevronRight" className="h-4 w-4 flex-none text-ink-mute" />
              </button>
            ))
          )
        ) : (
          /* ── 대화 목록 ──────────────────────────────────── */
          <>
            {/*
              교사 단톡방은 **늘 맨 위에 고정**한다 — 최근 순으로 섞으면 조용한 날에는 학생
              대화 아래로 내려가 매번 찾아야 한다. 아무도 말하지 않았어도 칸을 만든다:
              방이 있다는 것을 알려야 첫 말을 걸 수 있다.
            */}
            {showRoom && (
              <button
                type="button"
                onClick={() => openThread(TEACHER_ROOM_ID)}
                className="flex w-full gap-3 border-b border-track bg-sidebar-soft/40 p-[14px_16px] text-left transition-colors hover:bg-sidebar-soft"
              >
                <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-sidebar text-white">
                  <Icon name="students" className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[1.05rem] font-extrabold">선생님 단톡방</span>
                      {!roomOpen && (room?.unread ?? 0) > 0 && (
                        <span className="flex-none rounded-full bg-primary px-[7px] py-[1px] text-[.7rem] font-black text-white">
                          {room?.unread}
                        </span>
                      )}
                    </span>
                    <span className="flex-none text-[.8rem] text-ink-mute">
                      {room?.lastAt ? hhmm(room.lastAt) : ''}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[.94rem] text-ink-soft">
                    {room?.lastText || '우리 학급 선생님들 · 아직 대화가 없어요'}
                  </p>
                </div>
              </button>
            )}

            {conversations.length === 0 ? (
              /* 단톡방 칸이 이미 있으면 큰 빈 화면 대신 한 줄만 — 목록이 빈 것은 아니다 */
              showRoom ? (
                <p className="p-[18px_16px] text-[.88rem] font-medium text-ink-mute">
                  {query.trim()
                    ? '학생 대화 중에는 검색 결과가 없어요.'
                    : '학생과 주고받은 메시지는 아직 없어요. 오른쪽 위 + 로 말을 걸 수 있어요.'}
                </p>
              ) : (
                <EmptyState
                  icon="mail"
                  title={query.trim() ? '검색 결과가 없어요' : '아직 온 메시지가 없어요'}
                  hint={query.trim() ? undefined : '오른쪽 위 + 를 눌러 먼저 말을 걸 수 있어요.'}
                  className="min-h-[200px]"
                />
              )
            ) : (
              conversations.map(({ student, last }) => (
            <button
              key={student.userId}
              type="button"
              onClick={() => openThread(student.userId)}
              className="flex w-full gap-3 border-b border-track p-[14px_16px] text-left transition-colors hover:bg-canvas"
            >
              <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-sky text-base font-black text-primary">
                {firstChar(student.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[1.05rem] font-extrabold">{student.name}</span>
                    {/* 안 읽은 것은 "문제"가 아니라 "할 일"이라 빨강이 아닌 파랑을 쓴다 */}
                    {/*
                      지금 열어 둔 스레드에는 배지를 달지 않는다 — 여는 순간 읽음으로 찍히지만
                      요약 재조회와 경쟁하므로, 읽고 있는 대화 옆에 잠깐 숫자가 남을 수 있다.
                    */}
                    {student.userId !== activeId &&
                      (summaryOf.get(student.userId)?.unreadCount ?? 0) > 0 && (
                        <span className="flex-none rounded-full bg-primary px-[7px] py-[1px] text-[.7rem] font-black text-white">
                          {summaryOf.get(student.userId)?.unreadCount}
                        </span>
                      )}
                  </span>
                  <span className="flex-none text-[.8rem] text-ink-mute">
                    {last ? hhmm(last.at) : ''}
                  </span>
                </div>
                <p className="mt-1 truncate text-[.94rem] text-ink-soft">
                  {last ? `${last.mine ? '나: ' : ''}${last.text}` : ''}
                </p>
              </div>
            </button>
              ))
            )}
          </>
        )}
      </div>

      {/* ── 입력창 — 대화 중일 때만 ───────────────────────── */}
      {inThread && (
          <form
            onSubmit={(e) => void submit(e)}
            className="flex gap-2 border-t border-track p-[12px_14px]"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              type="text"
              placeholder={
                roomOpen ? '같은 학급 선생님들에게 보낼 말' : `${activeStudent?.name} 학생에게 보낼 말`
              }
              className="min-w-0 flex-1 rounded-full border-[1.5px] border-track bg-canvas p-[11px_16px] text-[.9rem] outline-none focus:border-primary focus:bg-white placeholder:text-ink-mute"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="보내기"
              className="grid h-11 w-11 flex-none place-items-center rounded-full bg-primary text-white transition-transform duration-200 ease-bounce hover:-translate-y-0.5 active:scale-105 disabled:opacity-40 disabled:hover:translate-y-0"
            >
              <Icon name="send" className="h-[18px] w-[18px]" />
            </button>
          </form>
      )}
    </div>
  )
}
