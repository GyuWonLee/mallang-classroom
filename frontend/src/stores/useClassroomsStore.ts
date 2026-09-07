import { create } from 'zustand'
import type { ClassStatus, CreateClassroomInput, ManagedClassroom } from '@/types/teacher'
import { classroomApi } from '@/services/api/classroomApi'

/**
 * 선생님이 관리하는 학급 목록 — 조회/생성/삭제를 classroomApi 에 위임하고 결과를 캐시한다.
 *
 * **목업은 없다. 전부 실서버다.** 딱 하나 `setStatus`(진행중/닫힘)만 서버에 대응 필드가 없어
 * 브라우저 로컬(`services/classroomMeta`)에 남는다 — 그래서 기기를 바꾸면 따라오지 않는다.
 */
interface ClassroomsState {
  classrooms: ManagedClassroom[]
  loaded: boolean
  load: () => Promise<void>
  create: (input: CreateClassroomInput) => Promise<ManagedClassroom>
  remove: (id: string) => Promise<void>
  setStatus: (id: string, status: ClassStatus) => Promise<void>
  getById: (id: string) => ManagedClassroom | undefined
}

export const useClassroomsStore = create<ClassroomsState>((set, get) => ({
  classrooms: [],
  loaded: false,

  load: async () => {
    const classrooms = await classroomApi.listClassrooms()
    set({ classrooms, loaded: true })
  },

  create: async (input) => {
    const classroom = await classroomApi.createClassroom(input)
    set((s) => ({ classrooms: [...s.classrooms, classroom] }))
    return classroom
  },

  remove: async (id) => {
    await classroomApi.deleteClassroom(id)
    set((s) => ({ classrooms: s.classrooms.filter((c) => c.id !== id) }))
  },

  // 표시 전용 상태라 서버 왕복 없이 로컬 메타 저장 + 목록 패치로 끝난다
  setStatus: async (id, status) => {
    await classroomApi.setStatus(id, status)
    set((s) => ({ classrooms: s.classrooms.map((c) => (c.id === id ? { ...c, status } : c)) }))
  },

  getById: (id) => get().classrooms.find((c) => c.id === id),
}))
