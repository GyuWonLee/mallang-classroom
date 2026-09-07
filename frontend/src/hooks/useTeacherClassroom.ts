import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useClassroomsStore } from '@/stores/useClassroomsStore'
import { useStudentsStore } from '@/stores/useStudentsStore'
import { useLiveStore } from '@/stores/useLiveStore'
import { useSignalStore } from '@/stores/useSignalStore'
import { useToastStore } from '@/stores/useToastStore'
import { confirmAction } from '@/stores/useConfirmStore'
import { useClassroomSocket } from '@/hooks/useClassroomSocket'
import { useActiveSession } from '@/hooks/useActiveSession'
import { endTeacherBroadcast } from '@/services/media/teacherBroadcastHandle'
import { sessionApi } from '@/services/api/sessionApi'
import { identityOf } from '@/services/signaling/ClassroomSocket'
import type { ServerEvent } from '@/types/signaling'
import type { StudentAccount } from '@/types/teacher'

/** 학생 요청 (손들기) */
export interface StudentRequest {
  id: number
  studentName: string
  type: 'HAND' | 'TOILET'
}

/**
 * 선생님 실시간 수업 Controller — STOMP 제어 채널 연결 + 라이브 뷰가 쓰는 상태·핸들러.
 *
 * 수업 id 는 `?session=N`(수업 시작 시 전달)을 우선 쓰고, 딥링크로 파라미터 없이 들어오면
 * 학급 상세의 `activeSession` 으로 복구한다.
 * 손든 학생은 STOMP `HAND_RAISED`(+ 접속 시 `GET /state` 스냅샷), 접속 중인 학생은
 * LiveKit 룸 참가자 목록이 출처다 — 둘 다 useLiveStore 를 통해 들어온다.
 */
export function useTeacherClassroom(classroomId: string | undefined) {
  const classroom = useClassroomsStore((s) => (classroomId ? s.getById(classroomId) : undefined))
  // 딥링크(홈 거치지 않고 URL 직접 진입) 대비 — 학급 목록이 비어 있으면 복원
  const classroomsLoaded = useClassroomsStore((s) => s.loaded)
  const loadClassrooms = useClassroomsStore((s) => s.load)
  useEffect(() => {
    if (!classroomsLoaded) void loadClassrooms()
  }, [classroomsLoaded, loadClassrooms])

  // 발급 학생 목록 — 진입 시 복원
  const byClassroom = useStudentsStore((s) => s.byClassroom)
  const loadStudents = useStudentsStore((s) => s.load)
  const studentAccounts = useMemo<StudentAccount[]>(
    () => (classroomId ? (byClassroom[classroomId] ?? []) : []),
    [byClassroom, classroomId],
  )
  useEffect(() => {
    if (classroomId) void loadStudents(classroomId)
  }, [classroomId, loadStudents])

  // ── 수업 id 해석 ─────────────────────────────────────────────
  const [params] = useSearchParams()
  const raw = Number(params.get('session'))
  const paramSession = Number.isFinite(raw) && raw > 0 ? raw : null
  const active = useActiveSession(paramSession === null ? classroomId : undefined)
  const sessionId = paramSession ?? active.sessionId

  const [ended, setEnded] = useState(false)
  const showToast = useToastStore((s) => s.show)

  /**
   * 지금 보고 있는 수업 id — 소켓 콜백이 읽는다.
   *
   * 콜백을 sessionId 에 의존시키면 수업이 정해지는 순간 구독이 갈아 끼워진다. 값은 최신이어야
   * 하되 콜백은 그대로여야 해서 ref 로 읽는다.
   */
  const sessionIdRef = useRef<number | null>(null)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const onEvent = useCallback((event: ServerEvent) => {
    /*
      **끝난 것이 내 수업일 때만** 나간다.

      예전에는 종료 알림이 수업 토픽(`/sub/sessions/{id}`)으로만 와서, 받았다는 것 자체가
      "내 수업이 끝났다"는 뜻이었다. 지금은 학급 구성원 전원의 개인 채널로도 온다 — 학급
      화면에서 카드만 보고 있는 동료 선생님에게 알리려고 그렇게 바꿨다.

      그 바람에 학년별로 두 수업이 나란히 돌 때, 1학년 선생님이 수업을 끝내면 5학년 수업을
      하던 선생님까지 화면이 종료로 넘어갔다. 서버의 5학년 수업은 멀쩡히 열려 있는데
      화면만 나가진 것이라, 겉보기에는 "둘 다 종료됐다"로 보인다.
    */
    if (event.event !== 'SESSION_ENDED') return
    if (event.sessionId != null && event.sessionId !== sessionIdRef.current) return
    setEnded(true)
  }, [])

  const { participants, send } = useClassroomSocket({ sessionId, onEvent })

  // 하위 컴포넌트(판서 레이어 등)가 prop drilling 없이 발행할 수 있게 신호 버스에 등록
  const setSend = useSignalStore((s) => s.setSend)
  useEffect(() => {
    setSend(send)
  }, [send, setSend])

  // ── 파생 상태 ────────────────────────────────────────────────
  const handRaisedIds = useLiveStore((s) => s.handRaisedIds)
  const onlineIdentities = useLiveStore((s) => s.onlineIdentities)
  const boardGrantIds = useLiveStore((s) => s.boardGrantIds)

  const nameById = useMemo(
    () => new Map(participants.map((p) => [p.userId, p.name])),
    [participants],
  )

  /** 손든 학생 — 화면은 이름으로 표시한다 */
  const requests = useMemo<StudentRequest[]>(
    () =>
      handRaisedIds.map((userId) => ({
        id: userId,
        studentName: nameById.get(userId) ?? '학생',
        type: 'HAND' as const,
      })),
    [handRaisedIds, nameById],
  )

  /**
   * 학년 → 팀 id. 학생 영상은 팀 룸에만 있어서, 모둠 탭을 열려면 그 학년의 팀 id 가 필요하다.
   * 팀은 백엔드가 학생 등록 시 학년별로 자동 배정한다(참가자 명단의 teamId).
   */
  const teamIdByGrade = useMemo(() => {
    const gradeOf = new Map(studentAccounts.map((a) => [a.userId, a.grade]))
    const map = new Map<number, number>()
    for (const p of participants) {
      const grade = gradeOf.get(p.userId)
      if (p.role === 'STUDENT' && grade !== undefined && p.teamId != null && !map.has(grade)) {
        map.set(grade, p.teamId)
      }
    }
    return map
  }, [participants, studentAccounts])

  /** 지금 교실(LiveKit 룸)에 실제로 들어와 있는 학생 이름 */
  const onlineNames = useMemo(() => {
    const online = new Set(onlineIdentities)
    return new Set(
      participants
        .filter((p) => p.role === 'STUDENT' && online.has(identityOf(p.role, p.userId)))
        .map((p) => p.name),
    )
  }, [participants, onlineIdentities])

  // ── 핸들러 ───────────────────────────────────────────────────
  /**
   * 전체 마이크/카메라 잠금 — target: 'ALL' 한 번으로 끝낸다 (백엔드 -128).
   * 서버가 대상 학생만큼 LiveKit 을 호출하므로 **학생 수만큼 요청을 보내지 않는다.**
   *
   * STOMP 통지가 없는 API 라(명세 v1.2 에서 정정) 다른 기기의 선생님 화면과 맞추려면
   * 스냅샷을 다시 읽어야 한다 — 성공 후 `refreshState()` 로 잠금 목록을 갱신한다.
   *
   * 토글 기준은 "한 명이라도 잠겨 있으면 전체 해제, 아니면 전체 잠금"이다.
   */
  const mutedMicIds = useLiveStore((s) => s.mutedMicIds)
  const disabledCamIds = useLiveStore((s) => s.disabledCamIds)

  const refreshState = useCallback(async () => {
    if (sessionId === null) return
    try {
      const state = await sessionApi.getState(sessionId)
      useLiveStore.getState().setMutedMicIds(state.mutedMic)
      useLiveStore.getState().setDisabledCamIds(state.disabledCam)
    } catch {
      /* 스냅샷 실패는 화면을 막지 않는다 — 다음 조작이나 재접속 때 다시 맞춰진다 */
    }
  }, [sessionId])

  const muteAll = useCallback(async () => {
    if (sessionId === null) {
      showToast('수업이 시작되지 않아 제어할 수 없어요.')
      return
    }
    const unlocking = mutedMicIds.length > 0
    try {
      await sessionApi.muteAll(sessionId, !unlocking)
      await refreshState()
      showToast(unlocking ? '모두의 마이크를 열었어요' : '모두의 마이크를 잠갔어요')
    } catch {
      showToast('마이크를 바꾸지 못했어요. 수업을 시작한 선생님만 할 수 있어요.')
    }
  }, [sessionId, mutedMicIds.length, refreshState, showToast])

  const camOffAll = useCallback(async () => {
    if (sessionId === null) {
      showToast('수업이 시작되지 않아 제어할 수 없어요.')
      return
    }
    const unlocking = disabledCamIds.length > 0
    try {
      await sessionApi.disableCamAll(sessionId, !unlocking)
      await refreshState()
      showToast(unlocking ? '모두의 카메라를 열었어요' : '모두의 카메라를 잠갔어요')
    } catch {
      showToast('카메라를 바꾸지 못했어요. 수업을 시작한 선생님만 할 수 있어요.')
    }
  }, [sessionId, disabledCamIds.length, refreshState, showToast])

  /**
   * 학생 **한 명** 마이크/카메라 잠금 토글.
   *
   * 예전엔 이게 없어서 학생 타일의 마이크·카메라 버튼이 `StudentsLivePanel` 안의 로컬 `Set`
   * 만 바꿨다 — **선생님 화면에서 그 타일만 회색이 되고 학생에게는 아무 일도 일어나지
   * 않았다.** 서버 API(`target: 'PARTICIPANT'`)와 학생 쪽 수신(`MEDIA_CONTROL` →
   * `forcedMedia`)은 이미 있었고, 그 사이를 잇는 호출만 비어 있었다.
   *
   * 상태의 원천은 서버 스냅샷(`mutedMicIds`/`disabledCamIds`)이다 — 낙관적으로 미리
   * 칠하지 않는다. 실패했는데 꺼진 것처럼 보이면 선생님은 조용한 학생을 계속 기다린다.
   */
  const muteStudent = useCallback(
    async (userId: number, muted: boolean) => {
      if (sessionId === null) {
        showToast('수업이 시작되지 않아 제어할 수 없어요.')
        return
      }
      try {
        await sessionApi.muteMic(sessionId, userId, muted)
        await refreshState()
      } catch {
        showToast('마이크를 바꾸지 못했어요. 수업을 시작한 선생님만 할 수 있어요.')
      }
    },
    [sessionId, refreshState, showToast],
  )

  const camStudent = useCallback(
    async (userId: number, disabled: boolean) => {
      if (sessionId === null) {
        showToast('수업이 시작되지 않아 제어할 수 없어요.')
        return
      }
      try {
        await sessionApi.disableCam(sessionId, userId, disabled)
        await refreshState()
      } catch {
        showToast('카메라를 바꾸지 못했어요. 수업을 시작한 선생님만 할 수 있어요.')
      }
    },
    [sessionId, refreshState, showToast],
  )

  /**
   * "마이크·카메라 켜 주세요" (백엔드 S15P11A407-137) — 잠금과 달리 **강제가 아니다.**
   * 서버가 상태를 안 바꾸므로 `refreshState()` 를 부르지 않는다(불러도 달라질 게 없다).
   */
  const requestMedia = useCallback(
    async (kind: 'mic' | 'cam') => {
      if (sessionId === null) {
        showToast('수업이 시작되지 않아 제어할 수 없어요.')
        return
      }
      try {
        await sessionApi.requestMedia(sessionId, kind, { target: 'ALL' })
        showToast(kind === 'mic' ? '마이크를 켜 달라고 부탁했어요' : '카메라를 켜 달라고 부탁했어요')
      } catch {
        showToast('요청을 보내지 못했어요. 수업을 시작한 선생님만 할 수 있어요.')
      }
    },
    [sessionId, showToast],
  )

  /**
   * 수업 중 강퇴 — POST /sessions/{id}/participants/{userId}/kick (S15P11A407-137).
   *
   * **학급에서 빼는 게 아니다** — 지금 수업에서만 내보내고 재입장을 막는다. 되돌릴 수 없어
   * 반드시 확인을 받는다. 서버가 KICKED 를 방송하므로 대상 학생은 알아서 나간다.
   */
  const kickParticipant = useCallback(
    async (userId: number, name: string) => {
      if (sessionId === null) {
        showToast('수업이 시작되지 않아 제어할 수 없어요.')
        return
      }
      const ok = await confirmAction({
        title: `${name} 학생을 이 수업에서 내보낼까요?`,
        message: '이번 수업에는 다시 들어올 수 없어요.\n학급에서 빠지는 것은 아니에요.',
        confirmLabel: '내보내기',
        danger: true,
      })
      if (!ok) return
      try {
        await sessionApi.kickParticipant(sessionId, userId)
        showToast(`${name} 학생을 내보냈어요`)
      } catch {
        showToast('내보내지 못했어요. 수업을 시작한 선생님만 할 수 있어요.')
      }
    },
    [sessionId, showToast],
  )

  const clearHands = useCallback(() => {
    // 손 내리기는 학생이 토글하는 구조라 서버 상태를 교사가 지울 수는 없다 — 화면에서만 정리
    useLiveStore.getState().setHandRaisedIds([])
  }, [])

  /**
   * 학생에게 판서 권한 주기/뺏기 — POST /sessions/{id}/board/grants.
   * 서버가 BOARD_GRANT 를 방송하므로 목록 갱신은 소켓이 알아서 해준다.
   */
  const toggleBoardGrant = useCallback(
    async (userId: number, grant: boolean) => {
      if (sessionId === null) return
      try {
        await sessionApi.boardGrants(sessionId, {
          target: 'PARTICIPANT',
          action: grant ? 'GRANT' : 'REVOKE',
          userId,
        })
      } catch {
        showToast('판서 권한을 바꾸지 못했어요.')
      }
    },
    [sessionId, showToast],
  )

  /**
   * **학급 전체** 판서 권한 주기/거두기 — 같은 엔드포인트의 `target: 'ALL'`.
   *
   * 학생 한 명씩 주는 것(`toggleBoardGrant`)과 성격이 다르다: 한 명은 "이 아이가 나와서
   * 풀어 봐라" 이고, 전체는 "다 같이 칠판에 써 보자" 다. 후자를 낱개로 하려면 스무 번을
   * 눌러야 했다.
   *
   * 서버가 대상 학생만큼 처리하고 `BOARD_GRANT` 를 방송하므로 **프론트에서 학생 수만큼 요청을
   * 보내지 않는다**(미디어 제어와 같은 규칙).
   */
  const grantBoardAll = useCallback(
    async (grant: boolean) => {
      if (sessionId === null) {
        showToast('수업이 시작되지 않아 제어할 수 없어요.')
        return
      }
      try {
        await sessionApi.boardGrants(sessionId, {
          target: 'ALL',
          action: grant ? 'GRANT' : 'REVOKE',
        })
        showToast(grant ? '모두에게 판서를 열었어요' : '모두의 판서를 거뒀어요')
      } catch {
        showToast('판서 권한을 바꾸지 못했어요. 수업을 시작한 선생님만 할 수 있어요.')
      }
    },
    [sessionId, showToast],
  )

  /**
   * 쉬는시간 화면 잠금 — PUT /sessions/{id}/broadcast-lock.
   *
   * 낙관적 갱신을 하지 않는다. 서버가 BROADCAST_LOCK 을 방송하면 소켓이 스토어를 갱신하므로
   * 화면은 **서버가 실제로 잠근 뒤에** 바뀐다. 학생 화면은 안 잠겼는데 선생님 버튼만 잠긴 것처럼
   * 보이는 상태가 가장 위험하다(선생님이 쉬는 줄 알고 자리를 비운다).
   *
   * 권한은 수업을 시작한 선생님뿐이다 — 공동 선생님이 누르면 403 이라 그 사실을 알려준다.
   */
  const broadcastLocked = useLiveStore((s) => s.broadcastLocked)
  const [lockPending, setLockPending] = useState(false)

  const toggleBreakLock = useCallback(async () => {
    if (sessionId === null) {
      showToast('수업이 시작되지 않아 잠글 수 없어요.')
      return
    }
    const next = !broadcastLocked
    setLockPending(true)
    try {
      await sessionApi.setBroadcastLock(sessionId, next)
    } catch {
      showToast(
        next
          ? '화면을 잠그지 못했어요. 수업을 시작한 선생님만 잠글 수 있어요.'
          : '잠금을 풀지 못했어요. 잠시 후 다시 시도해주세요.',
      )
    } finally {
      setLockPending(false)
    }
  }, [sessionId, broadcastLocked, showToast])

  /**
   * 수업 종료 — **이 수업 하나를 끝낸다.**
   *
   * 확인을 한 번 받는다. 되돌릴 수 없고, 학생이 전부 나가기 때문이다.
   *
   * 문구가 한 번 바뀐 자리다. 서버 세션이 학급당 1개이던 시절에는 1학년 방에서 종료를 눌러도
   * 5학년 아이들까지 함께 나갔고("한 수업만 껐는데 둘 다 꺼졌다"), 그 사실을 여기서 알렸다.
   * 지금은 수업이 학년별로 따로 돌아(V31) 이 수업의 학생만 나간다 — 옆 학년 수업은 그대로다.
   */
  const endSession = useCallback(async () => {
    if (sessionId === null) {
      setEnded(true)
      return
    }
    const ok = await confirmAction({
      title: '수업을 종료할까요?',
      message:
        '이 수업에 들어와 있는 학생이 모두 나가요.\n같은 학급의 다른 학년 수업은 그대로 진행돼요.\n종료하면 되돌릴 수 없어요.',
      confirmLabel: '수업 종료',
      danger: true,
    })
    if (!ok) return
    try {
      await sessionApi.endSession(sessionId)
      /*
        방송도 함께 끈다. 카메라·마이크는 이제 화면이 아니라 수업에 매여 있어서
        (`TeacherBroadcast`) 여기서 끄지 않으면 수업이 끝난 뒤에도 카메라가 켜진 채 남는다.
      */
      endTeacherBroadcast()
      setEnded(true)
    } catch {
      showToast('수업을 종료하지 못했어요. 잠시 후 다시 시도해주세요.')
    }
  }, [sessionId, showToast])

  return {
    classroom,
    sessionId,
    startedAt: active.startedAt,
    studentAccounts,
    teamIdByGrade,
    onlineNames,
    requests,
    clearHands,
    boardGrantIds,
    toggleBoardGrant,
    grantBoardAll,
    ended,
    endSession,
    broadcastLocked,
    lockPending,
    toggleBreakLock,
    muteAll,
    camOffAll,
    muteStudent,
    camStudent,
    requestMedia,
    kickParticipant,
    /** 잠긴 학생 목록 — 버튼 문구를 "잠그기/열기"로 바꾸는 데 쓴다 */
    mutedMicIds,
    disabledCamIds,
    send,
  }
}
