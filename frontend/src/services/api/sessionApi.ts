import { api } from './client'
import { hydrateLessonTopics } from '@/stores/useLessonTopicStore'
import type {
  AttendanceSummary,
  BoardGrantRequest,
  JoinResponse,
  MediaControlRequest,
  SessionHistoryItem,
  SessionParticipant,
  SessionState,
  SessionSummary,
  SessionTopicRequest,
  SessionTopics,
} from '@/types/session'

// ── 실서버 응답 매퍼 (백엔드 DTO -> 프론트 타입) ───────────────────────────
// 백엔드 SessionResponse { id, classroomId, startedAt } — 진행중 수업만 반환하므로 status 는 ACTIVE 고정
interface BackendSessionResponse {
  id: number
  classroomId: number
  startedAt: string
}
function toSessionSummary(res: BackendSessionResponse): SessionSummary {
  return { id: res.id, startedAt: res.startedAt, endedAt: null, status: 'ACTIVE' }
}

// 백엔드 SessionStateResponse (S15P11A407-46/-61 로 mutedMic·broadcastLocked 추가)
interface BackendSessionState {
  sessionId: number
  classroomId: number
  startedAt: string
  broadcastLocked: boolean
  hands: number[]
  mutedMic: number[]
  disabledCam: number[]
  boardGrants: number[]
  teamTeachers: Record<number, number[]>
  boardStrokes: SessionState['boardStrokes']
  /** 학년(문자열) -> 수업 주제. 옛 서버 응답에는 없다 */
  topics?: SessionTopics | null
}
function toSessionState(res: BackendSessionState): SessionState {
  return {
    handRaised: res.hands ?? [],
    mutedMic: res.mutedMic ?? [],
    disabledCam: res.disabledCam ?? [],
    broadcastLocked: res.broadcastLocked === true,
    boardGrants: res.boardGrants ?? [],
    boardStrokes: res.boardStrokes ?? [],
    // 프레즌스: 팀룸 접속 선생님 id (학생 프레즌스는 LiveKit 룸 참가자 목록이 출처 — useLiveStore)
    presence: Object.values(res.teamTeachers ?? {}).flat(),
    topics: res.topics ?? {},
  }
}

/**
 * 수업(세션) API — api-spec.md 5장. 실시간 제어 채널(STOMP)과 짝이지만 여기는 REST 부분.
 *
 * 백엔드 구현 현황(2026-07-30 기준, 명세 v1.1):
 *  - 구현됨(목업 없음, 항상 실서버): startSession · getState · endSession ·
 *    **join(LiveKit 토큰 = WebRTC 진입점)** · listParticipants · visitTeam · boardGrants ·
 *    muteMic · setBroadcastLock · **listSessions · getSession(수업 이력, v1.1 신설)**
 *  - S15P11A407-137 로 추가: **수업 중 강퇴**(예전에 "취소됨"으로 적혀 있었으나 구현됐다) ·
 *    미디어 켜기 요청(`requestMedia`) · 학생별 출석(`getAttendance`)
 */
export const sessionApi = {
  /**
   * 수업 시작 — POST /api/classrooms/{id}/sessions.
   *
   * `grade` 를 주면 **그 학년의 수업**이라 같은 학급의 다른 학년 수업과 나란히 돌아간다
   * (백엔드 V31) — 1학년은 A 선생님, 3학년은 B 선생님. 같은 학년이 이미 열려 있으면 409 다.
   *
   * 생략하면 예전과 같은 학급 전체 수업인데, 그때는 그 학급에 다른 수업이 하나도 없어야
   * 열린다. 학년을 아는 화면은 **반드시 넘길 것** — 안 넘기면 옆 학년 수업 때문에 409 가 난다.
   */
  async startSession(classroomId: string, grade?: number): Promise<SessionSummary> {
    const { data } = await api.post<BackendSessionResponse>(
      `/classrooms/${classroomId}/sessions`,
      grade === undefined ? {} : { grade },
    )
    return toSessionSummary(data)
  },

  /** 수업 종료 (LiveKit 룸 삭제 + SESSION_ENDED 방송) — POST /api/sessions/{id}/end */
  async endSession(sessionId: number): Promise<void> {
    await api.post(`/sessions/${sessionId}/end`)
  },

  /**
   * 입장: LiveKit 토큰 발급 — POST /api/sessions/{id}/join
   * 응답의 livekitUrl 을 그대로 써서 접속한다(프론트 env 로 추측하지 않는다).
   * 학생 토큰은 학급 룸에서 canPublish=false(수신 전용), 자기 팀 룸에서만 게시 가능.
   */
  async join(sessionId: number): Promise<JoinResponse> {
    const { data } = await api.post<JoinResponse>(`/sessions/${sessionId}/join`)
    /*
      수업 주제 캐시를 여기서 채운다 (S15P11A407-146).

      호출부가 아니라 이 안에서 하는 이유: join 은 선생님(`TeacherBroadcast`)과
      학생(`useStudentStage`) 두 길로 불리고, 학생 쪽은 **같은 약속을 여러 화면이 공유**한다
      (`freshJoin` 의 캐시). 호출부마다 넣으면 한 곳을 빠뜨렸을 때 그 화면만 주제가 안 뜨는데,
      원인이 join 응답이 아니라 "그 화면에 한 줄이 없어서"라 찾기가 어렵다.

      스토어를 React 밖에서 갱신하는 방식은 CLAUDE.md Rule 1 이 정한 그대로다.
    */
    hydrateLessonTopics(sessionId, data.topics)
    return data
  },

  /**
   * 학년별 수업 주제 정하기 — PUT /api/sessions/{id}/topics/{grade} (204, S15P11A407-146).
   *
   * **빈 문자열을 보내면 그 학년 주제를 지운다** — 서버가 blank 를 삭제로 읽는다. 그래서
   * 화면의 '주제 없이 시작'도 별도 API 없이 이 하나로 처리된다.
   *
   * 수업을 시작한 선생님만 할 수 있고(403 `not-session-teacher`), 진행 중인 수업이 아니면
   * 404 `session-not-open`, 학급이 담당하지 않는 학년이면 400 `grade-not-in-classroom` 이다.
   */
  async setTopic(sessionId: number, grade: number, topic: string): Promise<void> {
    const body: SessionTopicRequest = { topic }
    await api.put(`/sessions/${sessionId}/topics/${grade}`, body)
  },

  /** 참가자 명단 (LiveKit identity 매칭용: 이름·역할·팀) — GET /api/sessions/{id}/participants */
  async listParticipants(sessionId: number): Promise<SessionParticipant[]> {
    const { data } = await api.get<SessionParticipant[]>(`/sessions/${sessionId}/participants`)
    return data
  },

  /** 선생님 팀 순회 토큰 — POST /api/sessions/{id}/teams/{teamId}/visit (livekitUrl 은 미포함) */
  async visitTeam(sessionId: number, teamId: number): Promise<{ token: string; teamId: number }> {
    const { data } = await api.post(`/sessions/${sessionId}/teams/${teamId}/visit`)
    return data
  },

  /** 상태 스냅샷 (접속/재접속 복원용) — GET /api/sessions/{id}/state */
  async getState(sessionId: number): Promise<SessionState> {
    const { data } = await api.get<BackendSessionState>(`/sessions/${sessionId}/state`)
    // 복원 경로에서도 주제를 맞춘다 — 다른 선생님이 그 사이 바꿨을 수 있다 (join 주석 참고)
    hydrateLessonTopics(sessionId, data.topics)
    return toSessionState(data)
  },

  /** 판서 권한 부여/회수 (BOARD_GRANT 방송) — POST /api/sessions/{id}/board/grants */
  async boardGrants(sessionId: number, body: BoardGrantRequest): Promise<void> {
    await api.post(`/sessions/${sessionId}/board/grants`, body)
  },

  /**
   * 수업 중 강퇴 — POST /api/sessions/{id}/participants/{userId}/kick (204).
   *
   * **학급에서 빼는 게 아니다.** 지금 이 수업에서만 내보내고 재입장을 막는다(학급 구성원으로는
   * 남아 다음 수업에는 들어온다). 학급에서 영구히 빼려면 `classroomApi.kickStudent`.
   *
   * 호출할 수 있는 사람은 **지금 이 수업을 시작한 그 선생님뿐**이다(다른 형제 API 와 같은 규칙).
   * 성공하면 서버가 `KICKED` 를 방송하므로, 프론트가 대상 학생을 따로 내보낼 필요는 없다.
   */
  async kickParticipant(sessionId: number, userId: number): Promise<void> {
    await api.post(`/sessions/${sessionId}/participants/${userId}/kick`)
  },

  /**
   * 미디어 제어 — POST /api/sessions/{id}/media-controls (204). 명세 v1.2 (백엔드 -47/-128).
   *
   * **수업을 시작한 그 선생님만** 호출할 수 있다(`not-session-teacher`).
   * 서버는 LiveKit 룸 권한을 바꾸고 Redis 에 기록한다 — **STOMP 이벤트가 없다.**
   * 그래서 다른 기기의 선생님 화면은 `getState()` 를 다시 읽어야 동기화된다
   * (문서에 "STOMP 로 통지"라고 적혀 있던 것은 v1.2 에서 사실이 아니라고 정정됐다).
   *
   * 대상 범위별 필요 필드와 팀 미배정 처리가 다르다:
   *  - `PARTICIPANT` + `userId` — 팀 미배정이면 `409 student-team-not-assigned`
   *  - `TEAM` + `teamId` — 다른 학급 팀이면 `404 team-not-found`
   *  - `ALL` — 학급 학생 전원. **팀 미배정 학생은 조용히 건너뛴다**
   *    ("전체 음소거"가 한 명 때문에 통째로 실패하면 안 되므로 PARTICIPANT 와 규칙이 다르다)
   *
   * `ALL`·`TEAM` 은 서버가 대상 학생만큼 LiveKit 을 호출한다 — **프론트에서 학생 수만큼
   * 요청을 보내지 말 것.**
   *
   * `REQUEST_UNMUTE_MIC`·`REQUEST_ENABLE_CAM` 은 성격이 다르다 — 아래 `requestMedia` 참고.
   */
  async mediaControls(sessionId: number, body: MediaControlRequest): Promise<void> {
    await api.post(`/sessions/${sessionId}/media-controls`, body)
  },

  /** 학생 한 명 마이크 잠금/해제 (위 mediaControls 의 흔한 조합) */
  async muteMic(sessionId: number, userId: number, muted: boolean): Promise<void> {
    await sessionApi.mediaControls(sessionId, {
      target: 'PARTICIPANT',
      action: muted ? 'MUTE_MIC' : 'UNLOCK_MIC',
      userId,
    })
  },

  /** 학급 전체 마이크 잠금/해제 — 팀 미배정 학생은 서버가 건너뛴다 */
  async muteAll(sessionId: number, muted: boolean): Promise<void> {
    await sessionApi.mediaControls(sessionId, {
      target: 'ALL',
      action: muted ? 'MUTE_MIC' : 'UNLOCK_MIC',
    })
  },

  /**
   * "마이크/카메라 켜 주세요" 요청 (백엔드 S15P11A407-137) — 같은 media-controls 엔드포인트.
   *
   * **잠금과 달리 강제가 아니다.** 브라우저는 사용자 제스처 없이 장치를 켜 주지 않으므로
   * 서버는 LiveKit 권한도 Redis 잠금도 건드리지 않고 `MEDIA_REQUEST` 만 방송한다 —
   * 실제로 켜는 것은 요청을 받은 학생이다. 그래서 호출이 성공해도 상태는 안 바뀐다
   * (`getState()` 를 다시 읽어도 소용없다. 켜졌는지는 LiveKit 트랙으로 확인한다).
   *
   * 잠가 둔 학생에게는 보낼 수 없다 — 잠가 놓고 켜 달라는 건 모순이고 학생은 응할 방법이 없다.
   * 지목이면 `409 media-locked`, 일괄이면 조용히 빠진다. 그때 필요한 건 `UNLOCK_*` 이다.
   */
  async requestMedia(
    sessionId: number,
    kind: 'mic' | 'cam',
    scope: { target: 'ALL' } | { target: 'TEAM'; teamId: number } | { target: 'PARTICIPANT'; userId: number },
  ): Promise<void> {
    await sessionApi.mediaControls(sessionId, {
      ...scope,
      action: kind === 'mic' ? 'REQUEST_UNMUTE_MIC' : 'REQUEST_ENABLE_CAM',
    })
  },

  /** 학생 한 명 카메라 잠금/해제 — `muteMic` 의 카메라 짝 */
  async disableCam(sessionId: number, userId: number, disabled: boolean): Promise<void> {
    await sessionApi.mediaControls(sessionId, {
      target: 'PARTICIPANT',
      action: disabled ? 'DISABLE_CAM' : 'UNLOCK_CAM',
      userId,
    })
  },

  /** 학급 전체 카메라 잠금/해제 (백엔드 -47) */
  async disableCamAll(sessionId: number, disabled: boolean): Promise<void> {
    await sessionApi.mediaControls(sessionId, {
      target: 'ALL',
      action: disabled ? 'DISABLE_CAM' : 'UNLOCK_CAM',
    })
  },

  /**
   * 쉬는시간 화면 잠금 — PUT /api/sessions/{id}/broadcast-lock (204).
   * (형제 엔드포인트와 달리 **PUT** 이다)
   *
   * 서버는 플래그만 세우고 `BROADCAST_LOCK` 을 방송한다 — 미디어 권한은 건드리지 않는다.
   * 즉 **화면을 가리는 건 프론트 몫**이고, 학생의 발행을 서버가 막아주지는 않는다.
   */
  async setBroadcastLock(sessionId: number, locked: boolean): Promise<void> {
    await api.put(`/sessions/${sessionId}/broadcast-lock`, { locked })
  },

  /**
   * 수업 이력 목록 — GET /api/classrooms/{id}/sessions (명세 v1.1).
   * 최근 수업이 먼저 오고 **진행중 수업도 포함**된다(오늘 수업이 목록에서 빠지면 안 되므로).
   * 페이지네이션은 없다. 학급 멤버가 아니면 403.
   */
  async listSessions(classroomId: string | number): Promise<SessionHistoryItem[]> {
    const { data } = await api.get<SessionHistoryItem[]>(`/classrooms/${classroomId}/sessions`)
    return data
  },

  /**
   * 수업 상세 — GET /api/sessions/{id} (명세 v1.1).
   * **종료된 수업도 조회된다** — 오히려 그게 주 대상이다. 없는 수업은 404 session-not-found.
   * 실시간 상태(손든 학생·획)가 필요하면 이게 아니라 `getState()` 를 쓴다.
   */
  async getSession(sessionId: number): Promise<SessionHistoryItem> {
    const { data } = await api.get<SessionHistoryItem>(`/sessions/${sessionId}`)
    return data
  },

  /**
   * 학생별 출석 — GET /api/classrooms/{id}/students/{sid}/attendance (S15P11A407-137).
   *
   * **선생님 또는 본인**만 볼 수 있다. 결석한 수업도 함께 오므로 목록 길이가 곧 그 학급의
   * 수업 수다 — 출석한 것만 세려면 `attendedSessions` 를 쓴다.
   */
  async getAttendance(classroomId: string | number, studentId: number): Promise<AttendanceSummary> {
    const { data } = await api.get<AttendanceSummary>(
      `/classrooms/${classroomId}/students/${studentId}/attendance`,
    )
    return data
  },
}
