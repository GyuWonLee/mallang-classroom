import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { backTarget, teacherRoutes } from '@/lib/routes'
// 시간 문구는 아래 지역 timeLabel(어제 것은 날짜)이 만들고, 묶음 규칙만 공용을 쓴다
import { endsMinuteRun } from '@/lib/chatTime'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import { Icon } from '@/components/common/Icon'
import { Button } from '@/components/common/Button'
import { TeacherShell } from '@/components/classroom/teacher/TeacherShell'
import { useActiveSession } from '@/hooks/useActiveSession'
import { useClassroomSocket } from '@/hooks/useClassroomSocket'
import { chatApi, directChatApi, teacherRoomApi } from '@/services/api/chatApi'
import { classroomApi } from '@/services/api/classroomApi'
import { TEACHER_ROOM_ID, chatPeerId, isMine, isOtherTeacher } from '@/lib/chatMessage'
import { apiErrorMessage, errorStatus } from '@/lib/apiError'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToastStore } from '@/stores/useToastStore'
import type { ChatMessageDto } from '@/types/chat'
import type { ServerEvent } from '@/types/signaling'

/**
 * 채팅 관리 — 좌: 학생별 대화 목록 | 우: 스레드 + 답장.
 *
 * 두 종류의 대화를 **한 화면에 합쳐** 보여준다:
 *  - 수업 중 질문 — `GET /sessions/{id}/messages`, 답장은 STOMP `/pub/sessions/{id}/messages/reply`
 *    (교사 전용 발행구). 학생이 새로 물으면 개인 채널의 `CHAT` 으로 즉시 목록에 붙는다.
 *  - 수업 밖 1:1 — `GET/POST /classrooms/{id}/chat/...` (백엔드 S15P11A407-137 §11.1 #3·#4)
 *
 * 예전에는 앞의 것만 있어서 **수업이 없으면 이 화면이 통째로 비어 있었다**("진행 중인 수업이
 * 없어요"). 수업 밖 대화가 생기면서 그 전제가 깨졌다 — 수업이 없어도 주고받은 말이 있고,
 * 보낼 수도 있다. 사람에게는 "그 학생과 나눈 말"이 하나의 대화지 수업 단위로 갈린 둘이 아니다.
 */
interface ThreadMsg {
  from: 'student' | 'teacher'
  text: string
  at: string
  /**
   * 서버 메시지 id — **교사 단톡방에서만** 채운다.
   *
   * 그 방은 REST 이력과 실시간 이벤트가 같은 줄을 두 번 실어 올 수 있어서(이력 조회와 이벤트
   * 도착이 엇갈릴 때) id 로 걸러야 한다. 학생 대화는 (시각, 본문)으로 겹치는 것을 지우는
   * 방식을 쓰고 있어(아래 `open`) 여기서는 비워 둔다.
   */
  id?: number
  /** 단톡방에서 말한 사람 이름 — 여러 선생님이 섞여 있어 누가 한 말인지 적어야 한다 */
  senderName?: string
}

interface Convo {
  studentId: number
  name: string
  team: string
  /** 로그인 아이디 — 동명이인을 가르는 유일한 단서라 스레드 헤더에 함께 보여준다 */
  loginId: string
  at: string
  unread: number
  messages: ThreadMsg[]
}

/** 명단에서 얻는 화면용 부가 정보 (채팅 이력에는 없다) */
interface StudentMeta {
  /** 이름 — 이력의 senderName 은 **보낸 사람** 이름이라 내가 보낸 줄에서는 쓸 수 없다 */
  name: string
  team: string
  loginId: string
}

const firstChar = (name: string) => name.trim().charAt(0) || '?'

function timeLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
}

/**
 * 평평한 메시지 목록을 학생별 대화로 묶는다 (최근 대화가 위).
 *
 * 묶는 열쇠는 **대화 상대**(`chatPeerId`)다 — 보낸 사람이 아니다. 예전에는 보낸 사람으로 묶어서
 * 내가 보낸 말이 '나'라는 이름의 대화로 빠져나가 학생 대화에서 사라졌다.
 * 상대를 알 수 없는 줄은 어느 대화에도 넣지 않는다 (lib/chatMessage 주석).
 */
function groupByStudent(
  messages: ChatMessageDto[],
  metaOf: Map<number, StudentMeta>,
  myUserId: number | null,
): Convo[] {
  const map = new Map<number, Convo>()
  for (const m of messages) {
    /*
      동료 선생님이 보낸 줄은 **학생 대화가 아니다.** 넣으면 그 선생님 이름으로 된 학생 칸이
      하나 생긴다 (`lib/chatMessage.isOtherTeacher` 주석).
    */
    if (isOtherTeacher(m, myUserId)) continue
    const peer = chatPeerId(m, myUserId)
    if (peer == null) continue
    const mine = isMine(m, myUserId)
    let convo = map.get(peer)
    if (!convo) {
      const meta = metaOf.get(peer)
      convo = {
        studentId: peer,
        /* 이름은 **학생 줄에서만** 가져온다 — 내가 보낸 줄의 senderName 은 내 이름이다 */
        name: (mine ? '' : m.senderName) || meta?.name || '학생',
        team: meta?.team ?? '',
        loginId: meta?.loginId ?? '',
        at: m.at,
        unread: 0,
        messages: [],
      }
      map.set(peer, convo)
    } else if (!mine && m.senderName && convo.name === '학생') {
      convo.name = m.senderName
    }
    convo.messages.push({
      from: mine ? 'teacher' : 'student',
      text: m.text,
      at: m.at,
    })
    if (m.at > convo.at) convo.at = m.at
  }
  return [...map.values()].sort((a, b) => b.at.localeCompare(a.at))
}

export function TeacherChatPage() {
  const navigate = useNavigate()
  const location = useLocation()
  /** 학급 화면에서 메시지를 눌러 들어왔다면 그 학급으로 되돌아간다 */
  const back = backTarget(location.state, teacherRoutes.home)
  /** 돌아갈 경로에 학급 id 가 있으면 그 학급의 수업을 본다 */
  const classroomIdFromBack = back.match(/\/teacher\/classroom\/([^/?]+)/)?.[1]

  const { sessionId, classroomId, loading } = useActiveSession(classroomIdFromBack)

  const showToast = useToastStore((s) => s.show)
  const [convos, setConvos] = useState<Convo[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [metaOf, setMetaOf] = useState<Map<number, StudentMeta>>(new Map())
  const [classroomName, setClassroomName] = useState<string>()
  /** 내 userId — 이력 한 줄이 내 말인지 가르는 기준 (lib/chatMessage) */
  const myUserId = useAuthStore((s) => s.user?.id ?? null)

  // 학년 라벨 (백엔드에 팀 이름 API 가 없어 학년으로 표시) + 로그인 아이디
  useEffect(() => {
    if (!classroomId) return
    void classroomApi
      .listStudents(classroomId)
      .then((list) =>
        setMetaOf(
          new Map(
            list.map((s) => [
              s.userId,
              { name: s.name, team: `${s.grade}학년 모둠`, loginId: s.username },
            ]),
          ),
        ),
      )
      .catch(() => setMetaOf(new Map()))
  }, [classroomId])

  // 섹션 제목에 학급 이름을 붙인다 (ref `채팅 관리 · ${c.name}`)
  useEffect(() => {
    if (!classroomId) {
      setClassroomName(undefined)
      return
    }
    void classroomApi
      .getClassroom(classroomId)
      .then((c) => setClassroomName(c.name))
      .catch(() => setClassroomName(undefined))
  }, [classroomId])

  /**
   * 목록을 채우는 두 출처를 합친다.
   *
   * 수업 이력은 세션이 있을 때만 있고, 수업 밖 대화 요약(`/me/chat/threads`)은 세션과 무관하게
   * 항상 있다. 둘 다 없을 때만 정말로 빈 화면이다.
   *
   * 요약에는 마지막 한 줄만 담겨 있다 — 전체 대화는 그 스레드를 **열 때** 받아 온다
   * (아래 `open`). 목록을 그리자고 상대 수만큼 왕복하지 않는다.
   */
  useEffect(() => {
    let cancelled = false
    const historyOf = sessionId === null ? Promise.resolve([]) : chatApi.listMessages(sessionId)
    const summariesOf = classroomId ? directChatApi.myThreads() : Promise.resolve([])
    /*
      교사 단톡방 요약. 학급이 정해져 있을 때만 부른다 — 방은 학급마다 하나다.
      실패해도 학생 대화 목록은 그대로 뜬다(`allSettled`).
    */
    const roomOf = classroomId ? teacherRoomApi.summary(classroomId) : Promise.resolve(null)

    void Promise.allSettled([historyOf, summariesOf, roomOf]).then(([h, s, r]) => {
      if (cancelled) return
      const fromSession =
        h.status === 'fulfilled' ? groupByStudent(h.value, metaOf, myUserId) : []
      const summaries =
        s.status === 'fulfilled'
          ? s.value.filter((t) => String(t.classroomId) === String(classroomId))
          : []

      const byId = new Map(fromSession.map((c) => [c.studentId, c]))
      for (const t of summaries) {
        const existing = byId.get(t.peerId)
        if (existing) {
          // 수업 이력이 이미 있는 상대 — 안 읽은 수와 최신 시각만 요약에서 보탠다
          existing.unread = t.unreadCount
          if (t.lastAt > existing.at) existing.at = t.lastAt
          continue
        }
        const meta = metaOf.get(t.peerId)
        byId.set(t.peerId, {
          studentId: t.peerId,
          name: t.peerName,
          team: meta?.team ?? '',
          loginId: meta?.loginId ?? '',
          at: t.lastAt,
          unread: t.unreadCount,
          /* 미리보기 한 줄만 넣어 둔다 — 스레드를 열면 전체로 갈아 끼운다 */
          messages: [{ from: 'student', text: t.lastContent, at: t.lastAt }],
        })
      }
      const students = [...byId.values()].sort((a, b) => b.at.localeCompare(a.at))

      /*
        교사 단톡방은 **늘 맨 위에 고정**한다 — 최근 순으로 섞으면 조용한 날에는 목록 아래로
        내려가 있어 "우리 학급 선생님들 방"이 어디 있는지 매번 찾아야 한다. 아무도 말하지
        않았어도 칸을 만든다: 방이 있다는 것을 알려야 첫 말을 걸 수 있다.

        그리고 칸은 **요약 성공에 걸지 않는다.** 예전에는 요약이 실패하면 칸을 통째로
        지웠는데, 안 읽음 쿼리 버그로 요약이 500 이던 동안 화면에는 아무 말도 안 뜬 채
        칸만 사라져서 "선생님을 초대했는데 방이 안 생긴다"로 보였다. 정작 대화 조회는
        200 이라 방은 멀쩡히 열 수 있는 상태였다.

        방이 있느냐를 정하는 것은 학급 관리자냐이지 요약이 오느냐가 아니다(서버도 그렇게
        판정한다). 요약은 미리보기와 안 읽은 수를 얹어 줄 뿐이라, 실패하면 그 둘만 비우고
        칸은 남긴다. 403 일 때만 접는다 — 그때는 정말로 내 방이 아니다.
      */
      const room = r.status === 'fulfilled' ? r.value : null
      const roomDenied = r.status === 'rejected' && errorStatus(r.reason) === 403
      const roomConvo: Convo[] =
        classroomId && !roomDenied
          ? [
              {
                studentId: TEACHER_ROOM_ID,
                name: '선생님 단톡방',
                team: '',
                loginId: '',
                at: room?.lastMessage?.at ?? '',
                unread: room?.unreadCount ?? 0,
                messages: room?.lastMessage
                  ? [
                      {
                        from: 'student',
                        text: room.lastMessage.content,
                        at: room.lastMessage.at,
                        id: room.lastMessage.id,
                        senderName: room.lastMessage.senderName,
                      },
                    ]
                  : [],
              },
            ]
          : []

      /*
        실패를 삼키지 않는다. 학생 목록은 그대로 두되(allSettled 의 본래 목적), 무엇이
        안 됐는지는 말해 준다 — 조용히 사라지는 화면은 고칠 사람에게도 아무 단서를 안 준다.
      */
      if (r.status === 'rejected' && !roomDenied) {
        showToast(apiErrorMessage(r.reason, '선생님 단톡방 정보를 불러오지 못했어요.'))
      }

      setConvos([...roomConvo, ...students])
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, classroomId, metaOf, myUserId, showToast])

  // 새 질문이 오면 즉시 반영 (개인 채널의 CHAT → CHAT_MESSAGE 로 번역돼 온다)
  const onEvent = useCallback((event: ServerEvent) => {
    /*
      교사 단톡방 새 메시지 — 개인 채널로 온다. **동료가 보낸 것만** 온다(서버가 발신자를
      대상에서 뺀다). 지금 보고 있는 학급의 방만 반영한다: 선생님은 학급을 여럿 맡을 수 있고,
      다른 학급 방의 말이 이 목록에 섞이면 안 된다.

      id 로 중복을 막는다 — 방을 여는 REST 조회와 이 이벤트가 엇갈리면 같은 줄이 두 번 온다.
    */
    if (event.event === 'TEACHER_ROOM_MESSAGE') {
      if (String(event.classroomId) !== String(classroomId)) return
      const at = event.occurredAt ?? new Date().toISOString()
      setConvos((prev) =>
        prev.map((c) => {
          if (c.studentId !== TEACHER_ROOM_ID) return c
          if (event.messageId != null && c.messages.some((m) => m.id === event.messageId)) return c
          return {
            ...c,
            at,
            messages: [
              ...c.messages,
              {
                from: 'student' as const,
                text: event.message ?? '',
                at,
                id: event.messageId,
                senderName: event.senderName,
              },
            ],
            unread: activeId === TEACHER_ROOM_ID ? 0 : c.unread + 1,
          }
        }),
      )
      return
    }

    /*
      1:1 쪽지 도착 — 수업이 안 열려 있을 때 학생이(또는 말랑이가 대신) 보낸 것이 여기로 온다.

      이 처리가 없으면 쪽지는 **선생님이 이 화면을 다시 열기 전까지 아무 데도 안 나타났다.**
      아이 화면은 "선생님 쪽지함에 남겼어요"라고 말해 놓은 상태라, 그 말을 지키는 자리다.

      그 상대의 칸이 아직 없을 수 있다 — 한 번도 주고받은 적 없는 학생이 첫 쪽지를 보낸
      경우다. 그때는 칸을 새로 만든다(이름은 이벤트가 실어 온다). 칸이 없다고 흘려보내면
      정확히 '처음 말을 건 아이'의 말만 사라진다.
    */
    if (event.event === 'DIRECT_MESSAGE') {
      if (String(event.classroomId) !== String(classroomId)) return
      const from = Number(event.senderId)
      if (!Number.isFinite(from)) return
      const at = event.occurredAt ?? new Date().toISOString()
      setConvos((prev) => {
        const i = prev.findIndex((c) => c.studentId === from)
        if (i < 0) {
          const meta = metaOf.get(from)
          return [
            {
              studentId: from,
              name: event.senderName ?? meta?.name ?? '학생',
              team: meta?.team ?? '',
              loginId: meta?.loginId ?? '',
              at,
              unread: activeId === from ? 0 : 1,
              messages: [{ from: 'student' as const, text: event.message ?? '', at, id: event.messageId }],
            },
            ...prev,
          ]
        }
        const c = prev[i]
        // id 로 중복을 막는다 — 스레드를 여는 REST 조회와 이 이벤트가 엇갈릴 수 있다
        if (event.messageId != null && c.messages.some((m) => m.id === event.messageId)) return prev
        const next = [...prev]
        next[i] = {
          ...c,
          at,
          messages: [
            ...c.messages,
            { from: 'student' as const, text: event.message ?? '', at, id: event.messageId },
          ],
          unread: activeId === from ? 0 : c.unread + 1,
        }
        return next
      })
      return
    }

    if (event.event !== 'CHAT_MESSAGE' || event.senderRole !== 'STUDENT') return
    const studentId = Number(event.studentId)
    if (!Number.isFinite(studentId)) return
    const at = event.occurredAt ?? new Date().toISOString()
    setConvos((prev) => {
      const next = [...prev]
      const i = next.findIndex((c) => c.studentId === studentId)
      const msg: ThreadMsg = { from: 'student', text: event.message ?? '', at }
      if (i >= 0) {
        const c = next[i]
        next[i] = {
          ...c,
          at,
          messages: [...c.messages, msg],
          unread: c.studentId === activeId ? 0 : c.unread + 1,
        }
      } else {
        next.push({
          studentId,
          name: event.senderName ?? '학생',
          team: '',
          loginId: '',
          at,
          unread: 1,
          messages: [msg],
        })
      }
      return next.sort((a, b) => b.at.localeCompare(a.at))
    })
    /* metaOf — 처음 쪽지를 보낸 학생의 칸을 새로 만들 때 팀·아이디를 여기서 찾는다 */
  }, [activeId, classroomId, metaOf])

  const { send } = useClassroomSocket({ sessionId, onEvent })

  const active = useMemo(
    () => convos.find((c) => c.studentId === activeId) ?? null,
    [convos, activeId],
  )

  /*
    하단 추적은 공용 훅 (useStickToBottom). 예전에는 `active` 가 바뀔 때마다 **무조건** 맨 아래로
    점프해서, 지난 대화를 올려 읽는 중에 새 메시지가 오면 자리를 빼앗겼다.
    이제 하단 근처에서만 따라가고, 대화방을 새로 열 때는 `stick()` 으로 확실히 내려간다.
  */
  const scroll = useStickToBottom<HTMLDivElement>(active?.messages.length ?? 0)
  useEffect(() => {
    scroll.stick()
  }, [activeId, scroll])

  /**
   * 스레드 열기 — 여는 순간이 곧 "읽었다"라 서버에도 읽음으로 찍는다.
   *
   * 이때 수업 밖 대화 전체를 받아 수업 이력과 시간순으로 합친다. 목록에서는 마지막 한 줄만
   * 갖고 있었으므로, 열지 않으면 지난 대화를 볼 수 없다.
   */
  function open(studentId: number) {
    setActiveId(studentId)
    setConvos((prev) => prev.map((c) => (c.studentId === studentId ? { ...c, unread: 0 } : c)))
    if (!classroomId) return

    /*
      교사 단톡방은 경로가 다르다 — 상대가 없으니 1:1 API 를 부를 수 없다. 여기서 갈라 두고
      아래 학생 대화 경로는 그대로 둔다.

      이력을 통째로 갈아 끼운다: 목록에는 마지막 한 줄만 있었고, 서버가 오래된 것부터 정렬해
      주므로 다시 정렬할 필요도 없다.
    */
    if (studentId === TEACHER_ROOM_ID) {
      void teacherRoomApi.markRead(classroomId).catch(() => {})
      void teacherRoomApi
        .list(classroomId)
        .then((list) => {
          setConvos((prev) =>
            prev.map((c) =>
              c.studentId === TEACHER_ROOM_ID
                ? {
                    ...c,
                    messages: list.map((m) => ({
                      /* 내가 보낸 줄이면 오른쪽(teacher), 동료가 보낸 줄이면 왼쪽 */
                      from: m.senderId === myUserId ? ('teacher' as const) : ('student' as const),
                      text: m.content,
                      at: m.at,
                      id: m.id,
                      senderName: m.senderName,
                    })),
                  }
                : c,
            ),
          )
        })
        .catch((err) => {
          /*
            못 받아도 목록의 마지막 한 줄은 남겨 둔다 — 빈 화면으로 만들지 않는다.
            대신 말은 해 준다: 눌렀는데 아무 일도 안 일어나면 선생님은 방이 고장난 건지
            원래 빈 방인지 구분할 수 없다.
          */
          showToast(apiErrorMessage(err, '단톡방 대화를 불러오지 못했어요.'))
        })
      return
    }

    void directChatApi.markRead(classroomId, studentId).catch(() => {})
    void directChatApi
      .conversation(classroomId, studentId)
      .then((list) => {
        const direct: ThreadMsg[] = list.map((m) => ({
          /* 상대가 보낸 게 아니면 내가 보낸 것이다 */
          from: m.senderId === studentId ? 'student' : 'teacher',
          text: m.content,
          at: m.at,
        }))
        setConvos((prev) =>
          prev.map((c) => {
            if (c.studentId !== studentId) return c
            /*
              목록용 미리보기 한 줄이 남아 있으면 진짜 대화와 겹친다 — 같은 (시각, 본문)을
              지워 중복 말풍선을 막는다.
            */
            const seen = new Set(direct.map((m) => `${m.at}|${m.text}`))
            const kept = c.messages.filter((m) => !seen.has(`${m.at}|${m.text}`))
            return {
              ...c,
              messages: [...kept, ...direct].sort((a, b) => a.at.localeCompare(b.at)),
            }
          }),
        )
      })
      .catch(() => {
        /* 수업 밖 대화를 못 받아도 수업 이력은 그대로 보인다 */
      })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || activeId == null) return

    /*
      교사 단톡방 — REST 로만 보낸다(전용 발행구가 없다).

      **보낸 메시지를 직접 붙인다.** 서버가 발신자를 푸시 대상에서 빼기 때문에(201 응답으로
      이미 줬으니까) 메아리를 기다리면 내가 보낸 말이 화면에 뜨지 않는다. 실패하면 아무것도
      붙이지 않고 입력칸도 비우지 않는다 — 적은 말을 잃지 않게.
    */
    if (activeId === TEACHER_ROOM_ID) {
      if (!classroomId) return
      try {
        const sent = await teacherRoomApi.send(classroomId, text)
        setConvos((prev) =>
          prev.map((c) =>
            c.studentId === TEACHER_ROOM_ID
              ? {
                  ...c,
                  at: sent.at,
                  messages: [
                    ...c.messages,
                    {
                      from: 'teacher' as const,
                      text: sent.content,
                      at: sent.at,
                      id: sent.id,
                      senderName: sent.senderName,
                    },
                  ],
                }
              : c,
          ),
        )
        setDraft('')
      } catch (err) {
        showToast(apiErrorMessage(err, '메시지를 보내지 못했어요.'))
      }
      return
    }

    if (sessionId === null) {
      // 수업이 없으면 STOMP 로 보낼 곳이 없다 — 수업 밖 1:1 REST 로 보낸다
      if (!classroomId) return
      try {
        await directChatApi.send(classroomId, activeId, text)
      } catch {
        return
      }
    } else {
      // 교사 역할이라 ClassroomSocket 이 /messages/reply 로 발행한다
      send('CHAT_MESSAGE', { studentId: activeId, message: text })
    }

    const at = new Date().toISOString()
    setConvos((prev) =>
      prev.map((c) =>
        c.studentId === activeId
          ? { ...c, at, messages: [...c.messages, { from: 'teacher' as const, text, at }] }
          : c,
      ),
    )
    setDraft('')
  }

  /*
    수업이 없다고 빈 화면이 아니다 — 수업 밖 대화가 있으면 목록이 찬다. 그래서 "수업을
    시작하세요"라고 말하지 않는다(예전 문구는 이제 사실이 아니다).
  */
  const emptyLabel = loading ? '불러오는 중…' : '아직 주고받은 메시지가 없어요.'

  // 채팅 관리는 사이드바에 항목이 없다 — active 를 비워 아무 메뉴에도 불이 들어오지 않게 한다
  return (
    <TeacherShell>
      <Button variant="back" className="mb-4" onClick={() => navigate(back)}>
        <Icon name="back" className="h-[15px] w-[15px]" />
        {back === teacherRoutes.home ? '내 학급으로' : '학급 화면으로'}
      </Button>

      {/* ref .section-head — margin-bottom 28px */}
      <div className="mb-7">
        <h2 className="text-[1.8rem] font-black leading-[1.5] tracking-[-.3px]">
          채팅 관리{classroomName ? ` · ${classroomName}` : ''}
        </h2>
        {/* ref .section-head p — .88rem / 500 / line-height 1.6 / margin-top 6px */}
        <p className="mt-1.5 text-[.88rem] font-medium leading-[1.6] text-ink-soft">
          학생이 보낸 메시지를 확인하고 답장할 수 있어요.
          <br />
          학생 간 채팅은 지원하지 않아요.
        </p>
      </div>

      {/* ref .chat-inbox — 600px 고정, @media(max-width:640px) 에서만 세로로 쌓인다 */}
      <div className="flex h-[600px] overflow-hidden rounded-card bg-card shadow-card max-[640px]:h-auto max-[640px]:flex-col">
        {/* 대화 목록 */}
        <div className="w-[300px] flex-none overflow-y-auto border-r border-canvas max-[640px]:max-h-[220px] max-[640px]:w-full max-[640px]:border-b max-[640px]:border-r-0">
          {convos.length === 0 && (
            <p className="whitespace-pre-line p-6 text-center text-[.85rem] font-medium text-ink-mute">
              {emptyLabel}
            </p>
          )}
          {convos.map((c) => (
            <button
              key={c.studentId}
              type="button"
              onClick={() => open(c.studentId)}
              data-active={c.studentId === activeId}
              className="group flex w-full items-center gap-3 border-b border-canvas p-[14px_16px] text-left transition-colors hover:bg-[#FBFBFD] data-[active=true]:bg-sky"
            >
              {/*
                단톡방은 사람이 아니라 방이라 이름 첫 글자('선') 대신 아이콘을 쓴다 — 학생 칸과
                한눈에 갈라지고, 여러 사람이 있는 자리라는 뜻도 함께 전한다.
              */}
              <span className="grid h-[42px] w-[42px] flex-none place-items-center rounded-full bg-sky text-[.9rem] font-black text-primary">
                {c.studentId === TEACHER_ROOM_ID ? (
                  <Icon name="friends" className="h-5 w-5" />
                ) : (
                  firstChar(c.name)
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[.92rem] font-black">
                  {c.name}
                  {/* 안 읽은 메시지는 "문제"가 아니라 "할 일"이라 빨강이 아닌 파랑을 쓴다 (ref .unread-dot) */}
                  {c.unread > 0 && (
                    <span
                      className="h-[9px] w-[9px] flex-none rounded-full bg-primary"
                      aria-label="읽지 않음"
                    />
                  )}
                </div>
                <div className="text-[.72rem] font-bold text-ink-soft">
                  {c.studentId === TEACHER_ROOM_ID ? '우리 학급 선생님들' : c.team}
                </div>
                <div className="mt-[3px] truncate text-[.8rem] font-medium text-ink-soft group-data-[active=true]:text-primary-hover">
                  {/* 아직 아무도 말하지 않은 방은 빈 줄 대신 첫 말을 걸라고 알려 준다 */}
                  {c.messages.at(-1)?.text ??
                    (c.studentId === TEACHER_ROOM_ID ? '아직 대화가 없어요' : '')}
                </div>
              </div>
              <span className="mt-0.5 flex-none self-start text-[.7rem] font-bold text-ink-mute">
                {timeLabel(c.at)}
              </span>
            </button>
          ))}
        </div>

        {/* 스레드 */}
        <div className="flex min-w-0 flex-1 flex-col max-[640px]:min-h-[360px]">
          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 p-8 font-bold text-ink-mute">
              <Icon name="mail" className="h-10 w-10" />
              왼쪽에서 대화를 선택해 주세요
            </div>
          ) : (
            <>
              <div className="flex flex-none items-center gap-3 border-b border-canvas p-[16px_20px]">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-sky text-[.85rem] font-black text-primary">
                  {activeId === TEACHER_ROOM_ID ? (
                    <Icon name="friends" className="h-[18px] w-[18px]" />
                  ) : (
                    firstChar(active.name)
                  )}
                </span>
                <div>
                  <div className="text-[.98rem] font-black">{active.name}</div>
                  {/* ref `${s.team} · ${s.loginId}` — 명단을 못 읽었으면 있는 것만 보여준다 */}
                  <div className="text-[.78rem] font-semibold text-ink-soft">
                    {activeId === TEACHER_ROOM_ID
                      ? /* 학생에게는 안 보이는 방이라는 것을 분명히 해 둔다 — 아이 이야기를 나누는 자리다 */
                        '이 학급 선생님만 볼 수 있어요'
                      : [active.team, active.loginId].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>

              <div ref={scroll.ref} onScroll={scroll.onScroll} className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-[18px_20px]">
                {active.messages.map((m, i) => (
                  <div
                    key={i}
                    data-me={m.from === 'teacher'}
                    className="flex max-w-[70%] flex-col self-start data-[me=true]:self-end"
                  >
                    {/*
                      단톡방은 말하는 사람이 여럿이라 **누가 한 말인지 이름을 얹는다.** 1:1
                      대화에서는 상대가 한 명뿐이라(헤더에 이름이 있다) 줄마다 적으면 군더더기다.
                      내가 한 말에는 안 붙인다 — 오른쪽 파랑이 이미 '나'를 뜻한다.
                      같은 사람이 연달아 말하면 첫 줄에만 붙여 이름이 반복되지 않게 한다.
                    */}
                    {activeId === TEACHER_ROOM_ID &&
                      m.from === 'student' &&
                      m.senderName &&
                      active.messages[i - 1]?.senderName !== m.senderName && (
                        <span className="mb-1 px-1 text-[.72rem] font-black text-ink-soft">
                          {m.senderName}
                        </span>
                      )}
                    <div
                      data-me={m.from === 'teacher'}
                      /* break-words: 붙여넣은 URL 처럼 띄어쓰기 없는 긴 문자열이 말풍선을 뚫고 나가면
                         패널 overflow-hidden 에 잘려 아예 안 보인다 */
                      className="break-words rounded-[18px] p-[11px_15px] text-[.88rem] font-medium leading-[1.5] data-[me=false]:rounded-bl-[6px] data-[me=false]:bg-canvas data-[me=false]:text-ink data-[me=true]:rounded-br-[6px] data-[me=true]:bg-primary data-[me=true]:text-white"
                    >
                      {m.text}
                    </div>
                    {/* 같은 사람이 같은 분에 연달아 보냈으면 마지막 것에만 시간을 보인다 */}
                    {endsMinuteRun(active.messages, i, (x) => `${x.from}|${timeLabel(x.at)}`) && (
                      <span className="mt-1 px-1 text-[.68rem] font-bold text-ink-mute">
                        {timeLabel(m.at)}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <form onSubmit={(e) => void submit(e)} className="flex flex-none gap-2.5 border-t border-canvas p-[14px_18px]">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  type="text"
                  /* 단톡방은 답장하는 자리가 아니라 먼저 말을 거는 자리다 */
                  placeholder={
                    activeId === TEACHER_ROOM_ID
                      ? '선생님들에게 보낼 말을 입력하세요'
                      : '답장을 입력하세요'
                  }
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-full border-2 border-canvas bg-canvas p-[12px_18px] text-[.9rem] font-medium outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  aria-label="전송"
                  className="grid h-[46px] w-[46px] flex-none place-items-center rounded-full bg-primary text-white transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:bg-primary-hover"
                >
                  <Icon name="send" className="h-[18px] w-[18px]" />
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </TeacherShell>
  )
}
