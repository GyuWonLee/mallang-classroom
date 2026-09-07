import { create } from 'zustand'
import type { CreateStudentRequest, StudentAccount } from '@/types/teacher'
import { classroomApi } from '@/services/api/classroomApi'

/**
 * 학급별 발급된 학생 계정 목록 — 발급 응답(username/임시비밀번호)을 보관.
 * temporaryPassword 는 서버가 다시 주지 않으므로(1회 노출) 여기서 붙잡아 선생님이 확인/전달한다.
 * 목록(`load`)은 실서버 조회라 임시비밀번호가 없다 — 발급 직후 화면에서만 보인다.
 */
interface StudentsState {
  byClassroom: Record<string, StudentAccount[]>
  load: (classroomId: string) => Promise<void>
  create: (classroomId: string, body: CreateStudentRequest) => Promise<StudentAccount>
  /**
   * 발급된 계정들을 그대로 돌려준다.
   * 예전에는 `length` 만 돌려줘서 **일괄 발급한 학생들의 임시 비밀번호가 화면에 한 번도
   * 뜨지 못하고 사라졌다** (호출부가 곧바로 모달을 닫았다). 그러면 학생 수만큼 초기화를
   * 다시 돌리는 수밖에 없다.
   */
  createBulk: (classroomId: string, file: File) => Promise<StudentAccount[]>
  kick: (classroomId: string, userId: number) => Promise<void>
}

export const useStudentsStore = create<StudentsState>((set) => ({
  byClassroom: {},

  load: async (classroomId) => {
    const accounts = await classroomApi.listStudents(classroomId)
    set((s) => ({ byClassroom: { ...s.byClassroom, [classroomId]: accounts } }))
  },

  // 발급 결과를 돌려준다 — 임시 비밀번호는 이 응답에만 있고 다시 조회할 수 없다
  create: async (classroomId, body) => {
    const account = await classroomApi.createStudent(classroomId, body)
    set((s) => ({
      byClassroom: {
        ...s.byClassroom,
        [classroomId]: [account, ...(s.byClassroom[classroomId] ?? [])],
      },
    }))
    return account
  },

  createBulk: async (classroomId, file) => {
    const accounts = await classroomApi.createStudentsBulk(classroomId, file)
    set((s) => ({
      byClassroom: {
        ...s.byClassroom,
        [classroomId]: [...accounts, ...(s.byClassroom[classroomId] ?? [])],
      },
    }))
    return accounts
  },

  kick: async (classroomId, userId) => {
    await classroomApi.kickStudent(classroomId, userId)
    set((s) => ({
      byClassroom: {
        ...s.byClassroom,
        [classroomId]: (s.byClassroom[classroomId] ?? []).filter((a) => a.userId !== userId),
      },
    }))
  },
}))
