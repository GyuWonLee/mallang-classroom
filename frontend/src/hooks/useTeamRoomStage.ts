import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteTrack } from 'livekit-client'
import { ClassroomSignaling } from '@/services/signaling/ClassroomSignaling'
import { sessionApi } from '@/services/api/sessionApi'
import { useLiveStore } from '@/stores/useLiveStore'

/** identity `student-12` → 12 (백엔드 SessionTicketService.identity 규칙) */
function userIdOf(identity: string): number | null {
  const m = identity.match(/^(?:student|teacher)-(\d+)$/)
  return m ? Number(m[1]) : null
}

/**
 * 선생님이 **한 모둠(팀 룸)을 들여다보는** Controller.
 *
 * 학생은 학급 룸에서 canPublish=false 라 거기엔 영상이 없다. 학생 영상은 전부 팀 룸
 * `session-{id}-team-{teamId}` 에 있고, 선생님은 `POST /sessions/{id}/teams/{teamId}/visit`
 * 로 그 룸의 티켓을 받아 들어가야 볼 수 있다. **이 훅이 없으면 선생님 화면에 학생이 안 보인다.**
 *
 * 모둠 탭을 바꾸면 이전 팀 룸에서 나가고 새 팀 룸으로 옮겨 붙는다(한 번에 한 모둠).
 * 선생님 방송은 학급 룸으로 나가므로 여기서는 **구독만** 하고 게시하지 않는다.
 */
export function useTeamRoomStage(sessionId: number | null, teamId: number | null) {
  const signalingRef = useRef<ClassroomSignaling | null>(null)
  /** userId -> 그 학생의 비디오 트랙 */
  const tracksRef = useRef(new Map<number, RemoteTrack>())
  /** userId -> 붙여야 할 <video> */
  const elementsRef = useRef(new Map<number, HTMLVideoElement>())
  /** 화면 갱신 트리거 — 트랙 자체는 스토어에 넣지 않는다(Rule 2) */
  const [liveUserIds, setLiveUserIds] = useState<number[]>([])

  const livekitUrl = useLiveStore((s) => s.livekitUrl)

  const sync = useCallback(() => {
    setLiveUserIds([...tracksRef.current.keys()])
    // 늦게 마운트된 <video> 에도 붙여준다
    tracksRef.current.forEach((track, userId) => {
      const el = elementsRef.current.get(userId)
      if (el) track.attach(el)
    })
  }, [])

  if (!signalingRef.current) {
    signalingRef.current = new ClassroomSignaling({
      onRemoteVideo: (track, participant) => {
        const userId = userIdOf(participant.identity)
        if (userId === null) return
        tracksRef.current.set(userId, track)
        sync()
      },
      onRemoteVideoGone: (track) => {
        for (const [userId, t] of tracksRef.current) {
          if (t === track) tracksRef.current.delete(userId)
        }
        track.detach()
        sync()
      },
    })
  }

  useEffect(() => {
    const signaling = signalingRef.current
    if (!signaling || sessionId === null || teamId === null || !livekitUrl) return
    // 정리 시점에 ref.current 를 다시 읽지 않도록 지금 붙잡아 둔다 (Map 은 한 번만 만들어진다)
    const tracks = tracksRef.current
    const elements = elementsRef.current

    let cancelled = false
    void (async () => {
      try {
        // 티켓 발급 함수로 넘긴다 — 재접속마다 visit 을 다시 불러 새 토큰을 받는다(TTL 5분).
        // 순회 중 잠깐 끊겼을 때 죽은 토큰으로 재시도를 다 태우면 그 팀은 다시 안 보였다.
        if (cancelled) return
        await signaling.connectWithTicket(async () => {
          const { token } = await sessionApi.visitTeam(sessionId, teamId)
          return { url: livekitUrl, token }
        })
      } catch {
        /* 팀이 없거나 권한이 없으면 학생 영상 없이 아바타만 보인다 */
      }
    })()

    return () => {
      cancelled = true
      void signaling.disconnect()
      tracks.clear()
      elements.clear()
      setLiveUserIds([])
    }
  }, [sessionId, teamId, livekitUrl])

  /** 학생 타일의 <video> 콜백 ref — 트랙이 이미 와 있으면 즉시 붙인다 */
  const attachStudentVideo = useCallback(
    (userId: number) => (el: HTMLVideoElement | null) => {
      if (el) {
        elementsRef.current.set(userId, el)
        tracksRef.current.get(userId)?.attach(el)
      } else {
        elementsRef.current.delete(userId)
      }
    },
    [],
  )

  return { attachStudentVideo, liveUserIds }
}
