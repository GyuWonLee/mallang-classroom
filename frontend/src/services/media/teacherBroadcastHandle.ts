import type { TeacherBroadcast } from '@/services/media/TeacherBroadcast'

/**
 * 지금 잡혀 있는 선생님 방송의 **손잡이** — 방송을 만들지는 않고, 이미 있는 것을 잡거나 끊는다.
 *
 * ## 왜 `TeacherBroadcast.ts` 에서 떼어냈나 — 이게 이 파일의 존재 이유다
 *
 * "학급을 벗어나면 방송을 끈다"는 규칙은 앱 어디서 이동하든 걸려야 해서 최상위
 * (`RootLayout`)에 있다. 그런데 그 함수가 `TeacherBroadcast.ts` 에 있으면, 함수 하나를
 * 부르려고 **모듈 그래프가 통째로 딸려 온다**:
 *
 *     RootLayout -> TeacherBroadcast -> ClassroomSignaling -> livekit-client
 *
 * 그 결과 `livekit-client`(원본 1.2MB) 가 엔트리 청크에 박혀, **로그인 화면만 열어도**
 * 학생·선생님 가릴 것 없이 WebRTC SFU 클라이언트를 통째로 받아 파싱했다. 실측으로 엔트리가
 * gzip 149KB 였고 그 대부분이 이것이었다.
 *
 * 그래서 "지금 방송이 있는가 / 그걸 끊어라" 라는 **가벼운 사실만** 이 파일에 두고, 무거운
 * 구현(`TeacherBroadcast`)은 자기가 만들어질 때 여기에 자신을 등록한다. 방송을 한 번도 켜지
 * 않았으면 `current` 는 계속 null 이고, livekit 은 끝내 내려받지 않는다.
 *
 * 위의 `import type` 은 타입 전용이라 빌드에서 지워진다 — 런타임 의존이 생기지 않는다.
 * **이 파일에 값(value) import 를 추가하면 그 순간 위 효과가 사라진다.** 무언가를 더 넣고
 * 싶다면 그게 정말 엔트리에 있어도 되는 것인지 먼저 따져야 한다.
 */
let current: TeacherBroadcast | null = null

/** 방송을 만든 쪽(`acquireTeacherBroadcast`)이 자신을 등록한다 */
export function setTeacherBroadcast(broadcast: TeacherBroadcast | null): void {
  current = broadcast
}

/** 지금 잡혀 있는 방송 (없으면 null) — 화면 밖에서 상태를 볼 때 쓴다 */
export function getTeacherBroadcast(): TeacherBroadcast | null {
  return current
}

/** 수업을 끝냈다 — 방송도 함께 끈다 */
export function endTeacherBroadcast(): void {
  current?.dispose()
  current = null
}

/**
 * **학급을 벗어나면 끈다.** 같은 학급 안에서의 이동은 살려 둔다.
 *
 * `classroomId` 는 지금 보고 있는 학급이다. 학급 화면이 아니면 null 을 넘긴다.
 * 이 함수가 없으면 카메라가 켜진 채로 학급 목록·로그아웃까지 따라간다.
 */
export function releaseTeacherBroadcastUnlessInClassroom(classroomId: string | null): void {
  if (!current) return
  if (classroomId !== null && current.classroomId === classroomId) return
  endTeacherBroadcast()
}
