import { MediaDeviceManager } from '@/services/media/MediaDeviceManager'
import { ScreenShareManager } from '@/services/media/ScreenShareManager'
import { PdfPresenter } from '@/services/media/PdfPresenter'
import { ClassroomSignaling, type SignalingStatus } from '@/services/signaling/ClassroomSignaling'
import {
  getTeacherBroadcast,
  setTeacherBroadcast,
} from '@/services/media/teacherBroadcastHandle'
import { Emitter } from '@/services/core/Emitter'
import { sessionApi } from '@/services/api/sessionApi'
import { useLiveStore } from '@/stores/useLiveStore'

/**
 * 선생님 방송 한 벌 — 카메라·마이크·화면공유·PDF 발표·LiveKit 접속.
 *
 * ## 왜 화면(React) 밖에 있나
 *
 * 예전에는 이 넷을 `useTeacherMedia` 가 `useRef` 로 들고 있어서, **수업 화면을 벗어나는
 * 순간 전부 정리됐다.** 선생님이 과제를 내려고 잠깐 나가면 카메라·마이크·PDF 가 끊기고
 * LiveKit 접속까지 끊겨, 학생 화면에서는 선생님이 통째로 사라졌다. 돌아와도 공유하던
 * 자료는 없어져 파일을 다시 골라야 했다. 수업 세션은 서버에 그대로 살아 있으니
 * "연결은 되어 있는데 화면만 날아간" 것처럼 보인다.
 *
 * 방송의 수명은 **화면이 아니라 수업**에 매여야 한다. 그래서 이 클래스가 모듈 수준에
 * 살고, 화면은 구독만 한다.
 *
 * ## 언제 꺼지나 — 이게 이 파일의 핵심이다
 *
 * 카메라를 켜 둔 채 잊는 것은 그 자체로 사고다. 끄는 길을 좁고 분명하게 둔다:
 *  1. 수업 종료 (`endTeacherBroadcast`)
 *  2. **그 학급을 벗어남** — 학급 밖으로 이동하면 `releaseUnlessInClassroom` 이 끈다
 *  3. 다른 수업으로 갈아탐 — `acquire` 가 이전 것을 정리하고 새로 만든다
 *  4. 탭을 닫음 — 브라우저가 트랙을 회수한다
 *
 * 같은 학급 안에서의 이동(수업 ↔ 과제 관리 ↔ 학생 관리)만 살아남는다. 그게 이 변경이
 * 노린 딱 하나의 경우다.
 *
 * React 의존성 없음(Rule 1) — 상태는 `Emitter` 로만 알린다.
 */
export class TeacherBroadcast extends Emitter<SignalingStatus> {
  protected readonly emitOnSubscribe = true

  readonly camera = new MediaDeviceManager()
  readonly screen = new ScreenShareManager()
  readonly pdf = new PdfPresenter()
  readonly signaling: ClassroomSignaling

  /**
   * 지금 LiveKit 에 **실제로 게시돼 있는** 화면 출처.
   *
   * <p>이 기억이 화면(React) 안에 있으면 안 된다. 수업 화면을 나갔다 오면 컴포넌트가 다시
   * 마운트되면서 기억이 초기화되고, 이미 게시 중인데도 "게시된 게 없다"고 판단해 <b>다시
   * 게시</b>한다. 그런데 LiveKit 은 게시를 내릴 때 원본 트랙을 정지시킨다
   * (`stopLocalTrackOnUnpublish` 기본값 true). 그 순간 <b>PDF 캔버스 캡처 트랙이 죽어
   * 선생님도 학생도 검은 화면</b>을 본다 — 발표는 "PDF 3/8 쪽" 이라고 켜져 있는데 그림만
   * 안 나오는 상태다. PDF 를 껐다 켜면 캔버스가 새로 만들어져 되살아나는 것도 같은 이유다.</p>
   *
   * <p>게시는 방송(이 객체)이 하는 일이므로 그 기억도 여기 있어야 한다.</p>
   */
  publishedSource: 'display' | 'pdf' | null = null

  private status: SignalingStatus = 'idle'
  /** 접속을 두 번 걸지 않기 위한 빗장 (StrictMode 이중 마운트 대비) */
  private connecting: Promise<void> | null = null
  private disposed = false

  /*
    필드를 생성자 파라미터로 선언하지 않는다(`constructor(readonly classroomId: string)`).
    그 문법은 타입만 지워서는 사라지지 않고 코드를 만들어 내므로, 이 프로젝트의
    `erasableSyntaxOnly` 설정이 막는다 — 빌드(`tsc -b`)에서 TS1294 로 떨어진다.
  */
  readonly classroomId: string
  readonly sessionId: number

  constructor(classroomId: string, sessionId: number) {
    super()
    this.classroomId = classroomId
    this.sessionId = sessionId
    this.signaling = new ClassroomSignaling({
      onStatus: (status) => {
        this.status = status
        this.emit()
      },
      onPresence: (ids) => useLiveStore.getState().setOnlineIdentities(ids),
      onSpeakers: (ids) => useLiveStore.getState().setSpeakingIdentities(ids),
    })
  }

  getState(): SignalingStatus {
    return this.status
  }

  /**
   * LiveKit 접속. 여러 번 불러도 한 번만 건다.
   *
   * `connect(url, token)` 이 아니라 티켓 발급 함수를 넘긴다 — 토큰 TTL 이 5분이라 한 번 받은
   * 토큰을 재접속에 다시 쓰면 서버가 거절한다. 수업 중반에 네트워크가 한 번 끊기면 재시도
   * 5회를 죽은 토큰으로 전부 태우고 방송이 끝까지 안 돌아왔다.
   */
  connect(): Promise<void> {
    if (this.connecting) return this.connecting
    this.connecting = (async () => {
      try {
        await this.signaling.connectWithTicket(async () => {
          const { livekitUrl, classroomRoom } = await sessionApi.join(this.sessionId)
          // 팀 룸 방문은 토큰만 받고 URL 은 안 오므로 여기서 보관해둔다
          useLiveStore.getState().setLivekitUrl(livekitUrl)
          return { url: livekitUrl, token: classroomRoom.token }
        })
      } catch {
        // 세션 종료/권한 없음 등 — 미연결 유지 (원인은 onStatus 'error' 로 노출)
        if (!this.disposed) {
          this.status = 'error'
          this.emit()
        }
      }
    })()
    return this.connecting
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.camera.dispose()
    this.screen.dispose()
    this.pdf.dispose()
    void this.signaling.disconnect()
    useLiveStore.getState().setOnlineIdentities([])
    this.clearListeners()
  }
}

// ── 모듈 수준 보관 ──────────────────────────────────────────────────
// 한 번에 하나다. 선생님이 두 수업을 동시에 진행할 수는 없다(백엔드도 학년별로 하나씩
// 열되 카메라는 한 대다). 둘을 허용하면 어느 쪽이 방송 중인지 알 수 없어진다.
//
// 그 "하나"를 **여기 두지 않고** `teacherBroadcastHandle` 에 둔다. 방송을 끊는 쪽
// (`RootLayout`)이 이 파일을 import 하면 livekit-client 가 엔트리 청크로 딸려 오기
// 때문이다 — 자세한 사정은 그 파일의 주석에 적어 두었다.

/**
 * 이 수업의 방송을 가져온다 — 없으면 만들고 접속까지 건다.
 * 다른 수업이 잡혀 있으면 그것을 먼저 정리한다.
 */
export function acquireTeacherBroadcast(classroomId: string, sessionId: number): TeacherBroadcast {
  const current = getTeacherBroadcast()
  if (current && current.classroomId === classroomId && current.sessionId === sessionId) {
    return current
  }
  current?.dispose()
  const next = new TeacherBroadcast(classroomId, sessionId)
  /* 접속보다 **먼저** 등록한다 — connect() 는 비동기라, 그 사이에 화면을 벗어나면
     아직 등록되지 않은 방송을 아무도 끊지 못해 카메라가 남는다 */
  setTeacherBroadcast(next)
  void next.connect()
  return next
}
