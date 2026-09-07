import type { ClassStatus, ManagedClassroom } from '@/types/teacher'

/**
 * 학급의 로컬 보조 저장소 — **백엔드에 대응 필드가 없는 값만** 담는다.
 *
 * 지금 남은 것은 `status`(진행중/닫힘) 하나뿐 — 순수 표시 상태로 서버 개념이 아니다.
 * 담당 학년(grades)은 서버 필드가 되어(S15P11A407-124) 여기서 빠졌다.
 */
const KEY = 'mallang.classroom.meta'

export interface ClassroomMeta {
  status?: ClassStatus
}

type MetaMap = Record<string, ClassroomMeta>

/**
 * 저장된 값에서 **우리가 아는 필드만** 남긴다.
 *
 * 예전 버전은 담당 학년(grades)도 여기에 저장했다. 그 값이 사용자 브라우저에 그대로 남아 있는데
 * `apply` 가 통째로 spread 하고 있어서, **서버가 준 grades 를 옛 로컬 값이 덮어썼다** —
 * 서버는 3학년이라고 하는데 화면엔 "2·4학년 복식반"이 나오는 원인이었다.
 * 타입만으로는 못 막는다(JSON.parse 결과를 캐스팅하므로). 그래서 읽는 순간 걸러낸다.
 */
function sanitize(raw: unknown): ClassroomMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const status = (raw as { status?: unknown }).status
  return status === 'OPEN' || status === 'CLOSED' ? { status } : undefined
}

function readAll(): MetaMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
    const clean: MetaMap = {}
    for (const [id, value] of Object.entries(parsed)) {
      const meta = sanitize(value)
      if (meta) clean[id] = meta
    }
    return clean
  } catch {
    return {}
  }
}

function writeAll(map: MetaMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* 저장 공간이 없으면 표시 메타는 포기한다 (기능은 계속 동작) */
  }
}

export const classroomMeta = {
  /**
   * 서버에서 온 학급에 저장해둔 표시 메타를 얹는다.
   *
   * **필드를 하나씩 명시해 얹는다.** `{ ...classroom, ...meta }` 로 통째로 펼치면 저장소에 남은
   * 옛 키(grades 등)가 서버 값을 조용히 덮어쓴다 — 서버가 진실인 필드를 로컬이 이기면 안 된다.
   */
  apply(classroom: ManagedClassroom): ManagedClassroom {
    const meta = readAll()[classroom.id]
    return meta?.status ? { ...classroom, status: meta.status } : classroom
  },

  save(classroomId: string, patch: ClassroomMeta): void {
    const map = readAll()
    map[classroomId] = { ...map[classroomId], ...patch }
    writeAll(map)
  },

  remove(classroomId: string): void {
    const map = readAll()
    delete map[classroomId]
    writeAll(map)
  },
}

