import { api } from './client'
import { classroomMeta } from '@/services/classroomMeta'
import type {
  ActiveSession,
  ClassStatus,
  ClassroomDetail,
  ClassroomMember,
  ClassroomRole,
  CreateClassroomInput,
  CreateStudentRequest,
  ManagedClassroom,
  StudentAccount,
  StudentCsvRow,
  StudentNote,
  UpdateClassroomRequest,
} from '@/types/teacher'

/**
 * 백엔드 ClassroomResponse 원형 (id: number).
 * `grades` 는 서버가 담당 학년을 갖게 되면서(S15P11A407-124) 추가됐다 — 이제 **서버가 진실**이다.
 * 뒤의 3개는 카드용 집계다(S15P11A407-137) — 생성 직후처럼 집계가 없는 경로는 비어 온다.
 */
interface ClassroomApiResponse {
  id: number
  name: string
  alias: string
  myRole: string
  grades: number[]
  studentCount?: number
  activeSession?: ActiveSession | null
  assignmentProgress?: number | null
}

function toManagedClassroom(res: ClassroomApiResponse): ManagedClassroom {
  return {
    id: String(res.id),
    name: res.name,
    alias: res.alias,
    myRole: res.myRole as ClassroomRole,
    // 서버가 List<Short> 로 주지만 JSON 에서는 number[] 다. 방어적으로 정렬해 표시 순서를 고정한다
    grades: [...(res.grades ?? [])].sort((a, b) => a - b),
    studentCount: res.studentCount ?? 0,
    activeSession: res.activeSession ?? null,
    /*
      **0 으로 메우지 않는다.** 서버의 null 은 "발행한 과제나 학생이 없다"는 뜻이라 0% 와
      다르다 — 0% 로 그리면 "다들 안 냈다"는 빨간 막대가 되어 사실과 어긋난다.
      화면은 null 이면 막대를 아예 안 그린다 (ClassProgressCard).
    */
    assignmentProgress: res.assignmentProgress ?? null,
  }
}

/** 백엔드 StudentSummaryResponse (명단 조회 — 임시비번 없음) */
interface StudentSummaryApiResponse {
  userId: number
  username: string
  name: string
  school: string
  grade: number
}

/**
 * 교실/학급 API — 백엔드 classroom 도메인.
 *
 * 백엔드 구현 현황(2026-07-28, 티켓 106·110·111·115 반영): **전 메서드 실서버.**
 *  - 111 이 PATCH/DELETE 와 구성원 제외를, 106 이 목록/상세/명단을 채웠다.
 *  - `kickStudent` 는 별도 엔드포인트가 아니라 `removeMember`(학급 제외)와 같은 동작이다.
 *    수업 중 강퇴(`sessionApi.kickParticipant`)와 **다른 기능이니 헷갈리지 말 것** —
 *    이쪽은 학급에서 영구히 빼는 것이고, 저쪽은 지금 이 수업에서만 내보내는 것이다.
 *  - 137 이 담당자 이양·학급 나가기·학생 메모를 채웠다.
 *  - setStatus(OPEN/CLOSED)는 백엔드에 대응 필드가 없는 프론트 표시 전용 메타다.
 */
export const classroomApi = {
  /** 내가 담당/참여하는 학급 목록 — GET /api/classrooms (grades 포함) */
  async listClassrooms(): Promise<ManagedClassroom[]> {
    const { data } = await api.get<ClassroomApiResponse[]>('/classrooms')
    // status(진행중/닫힘)만 백엔드에 없는 표시 메타라 로컬 저장분을 얹는다
    return data.map((c) => classroomMeta.apply(toManagedClassroom(c)))
  },

  /**
   * 학급 생성 (생성자 OWNER) — POST /api/classrooms.
   * **담당 학년(1~2개)은 필수**다. 서버가 이 학년으로 학년별 팀까지 파생하므로
   * 로컬에 따로 저장하지 않는다 (응답의 grades 가 진실).
   */
  async createClassroom(input: CreateClassroomInput): Promise<ManagedClassroom> {
    const { data } = await api.post<ClassroomApiResponse>('/classrooms', {
      name: input.name,
      grades: input.grades,
    })
    const created = toManagedClassroom(data)
    classroomMeta.save(created.id, { status: 'OPEN' })
    return classroomMeta.apply(created)
  },

  /**
   * 진행중/닫힘 전환 — 백엔드에 대응 필드가 없는 **표시 전용** 상태라 로컬에만 기록한다.
   * (서버에 PATCH 를 보내면 404 이고, GET 상세는 alias 가 없는 다른 DTO 라 되읽을 수도 없다)
   */
  async setStatus(classroomId: string, status: ClassStatus): Promise<void> {
    classroomMeta.save(classroomId, { status })
  },

  /**
   * 학급 상세 (구성원 수·진행중 수업 포함) — GET /api/classrooms/{id}.
   *
   * `activeSessions` 를 빈 배열로 메운다. 서버는 늘 배열을 주지만, 이 필드가 없던 시절의
   * 응답이 캐시나 예전 배포본에서 올 수 있다 — 화면이 곧바로 `.map` 을 부르므로
   * 여기서 한 번 막아 두는 편이 낫다.
   */
  async getClassroom(classroomId: string): Promise<ClassroomDetail> {
    const { data } = await api.get<ClassroomDetail>(`/classrooms/${classroomId}`)
    return { ...data, activeSessions: data.activeSessions ?? [] }
  },

  /** 학급 정보 수정 (name 만 반영 — 서버가 school 은 무시) — PATCH /api/classrooms/{id} */
  async updateClassroom(classroomId: string, body: UpdateClassroomRequest): Promise<ManagedClassroom> {
    const { data } = await api.patch<ClassroomApiResponse>(`/classrooms/${classroomId}`, body)
    return classroomMeta.apply(toManagedClassroom(data))
  },

  /** 학급 삭제 (soft delete, OWNER 만) — DELETE /api/classrooms/{id} */
  async deleteClassroom(classroomId: string): Promise<void> {
    await api.delete(`/classrooms/${classroomId}`)
    classroomMeta.remove(classroomId)
  },

  /** 구성원 목록 (역할·팀 포함) — GET /api/classrooms/{id}/members */
  async listMembers(classroomId: string): Promise<ClassroomMember[]> {
    const { data } = await api.get<ClassroomMember[]>(`/classrooms/${classroomId}/members`)
    return data
  },

  /** 구성원 제외 (학생 학급 제외 / MAINTAINER 해제) — DELETE /api/classrooms/{id}/members/{userId} */
  async removeMember(classroomId: string, userId: number): Promise<void> {
    await api.delete(`/classrooms/${classroomId}/members/${userId}`)
  },

  /** 학급의 학생 명단 (임시비번 미포함) — GET /api/classrooms/{id}/students */
  async listStudents(classroomId: string): Promise<StudentAccount[]> {
    const { data } = await api.get<StudentSummaryApiResponse[]>(
      `/classrooms/${classroomId}/students`,
    )
    return data
  },

  /** 학생 계정 단건 발급 (임시비번 1회 노출) — POST /api/classrooms/{id}/students */
  async createStudent(classroomId: string, body: CreateStudentRequest): Promise<StudentAccount> {
    const { data } = await api.post<StudentAccount>(`/classrooms/${classroomId}/students`, body)
    return data
  },

  /**
   * CSV 미리보기 — POST /api/classrooms/{id}/students/bulk/preview.
   *
   * 아래 일괄 발급과 **같은 파서**로 읽기만 하고 계정은 만들지 않는다. 화면에서 CSV 를 따로
   * 해석하지 않는 이유가 이것이다 — 인코딩(UTF-8/CP949)·헤더·따옴표 판정이 조금이라도
   * 어긋나면 "미리보기는 멀쩡했는데 등록은 실패한다"가 된다.
   * 형식이 틀리면 일괄 발급과 똑같이 400 과 행 번호가 온다.
   */
  async previewStudentsBulk(classroomId: string, file: File): Promise<StudentCsvRow[]> {
    const form = new FormData()
    form.append('file', file)
    const { data } = await api.post<StudentCsvRow[]>(
      `/classrooms/${classroomId}/students/bulk/preview`,
      form,
    )
    return data
  },

  /** 학생 계정 CSV 일괄 발급 (형식: 이름,학교,학년[,학부모이메일]) — POST /api/classrooms/{id}/students/bulk */
  async createStudentsBulk(classroomId: string, file: File): Promise<StudentAccount[]> {
    const form = new FormData()
    form.append('file', file)
    const { data } = await api.post<StudentAccount[]>(
      `/classrooms/${classroomId}/students/bulk`,
      form,
    )
    return data
  },

  /** 학생 내보내기 = 학급 구성원 제외 — DELETE /api/classrooms/{id}/members/{userId} */
  async kickStudent(classroomId: string, userId: number): Promise<void> {
    await api.delete(`/classrooms/${classroomId}/members/${userId}`)
  },

  /**
   * 담당자 이양 (OWNER → MAINTAINER) — PATCH /api/classrooms/{id}/owner (204).
   *
   * **넘긴 쪽은 MAINTAINER 가 된다** (학급에서 빠지는 게 아니다). 두 역할이 한 트랜잭션에서
   * 바뀌므로 중간 상태(주인 둘 / 주인 없음)는 없다. 넘겨받을 사람은 이미 그 학급의
   * MAINTAINER 여야 한다.
   */
  async transferOwner(classroomId: string, newOwnerId: number): Promise<void> {
    await api.patch(`/classrooms/${classroomId}/owner`, { newOwnerId })
  },

  /**
   * 학급 나가기 (본인) — DELETE /api/classrooms/{id}/members/me (204).
   *
   * 위 `removeMember`(남을 내보내기)와 방향이 반대다. **OWNER 는 이양 후에만** 나갈 수 있다 —
   * 주인 없는 학급이 생기지 않게 서버가 막는다(먼저 `transferOwner`).
   */
  async leaveClassroom(classroomId: string): Promise<void> {
    await api.delete(`/classrooms/${classroomId}/members/me`)
  },

  // ── 학생 메모 (선생님 전용, S15P11A407-137 §11.3 #8) ────────────────────────
  // 예전엔 서버 엔드포인트가 없어 브라우저 localStorage 에만 남아 기기마다 달랐다.
  // 이제 서버가 진실이라 다른 기기·다른 선생님도 같은 메모를 본다.

  /** 학생 메모 목록 (최근 것이 위) — GET /api/classrooms/{id}/students/{sid}/notes */
  async listNotes(classroomId: string, studentId: number): Promise<StudentNote[]> {
    const { data } = await api.get<StudentNote[]>(
      `/classrooms/${classroomId}/students/${studentId}/notes`,
    )
    return data
  },

  /** 학생 메모 작성 — POST /api/classrooms/{id}/students/{sid}/notes (201) */
  async writeNote(classroomId: string, studentId: number, content: string): Promise<StudentNote> {
    const { data } = await api.post<StudentNote>(
      `/classrooms/${classroomId}/students/${studentId}/notes`,
      { content },
    )
    return data
  },

  /** 학생 메모 수정 (작성자만) — PATCH /api/notes/{noteId} */
  async editNote(noteId: number, content: string): Promise<StudentNote> {
    const { data } = await api.patch<StudentNote>(`/notes/${noteId}`, { content })
    return data
  },

  /** 학생 메모 삭제 (작성자만) — DELETE /api/notes/{noteId} */
  async deleteNote(noteId: number): Promise<void> {
    await api.delete(`/notes/${noteId}`)
  },
}
