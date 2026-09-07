import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ClassroomView, LayoutMode } from '@/types/classroom'
import type { SignalingStatus } from '@/services/signaling/ClassroomSignaling'

/**
 * 교실 UI 상태 — 원시/평범 객체 상태만 (Rule 2).
 * MediaStream 같은 네이티브 객체는 절대 넣지 않는다.
 */
/*
  AI 말랑이(대화창)를 화면에서 뺐다. 함께 지운 상태:
  `chatOpen`(대화창 열림) · `currentHint`(AI 가 참조하던 힌트 — 실제로는 아무도 세팅하지 않던
  죽은 값) · `mascotNonce`/`bumpMascot`(대화창 마스코트 점프 트리거, 유일한 독자가 AI 챗이었다)
  · `activeNav`(좌측 사이드바 하이라이트 — 사이드바 자체를 없앴다).
*/
interface ClassroomState {
  view: ClassroomView
  layoutMode: LayoutMode
  micOn: boolean
  cameraOn: boolean
  /* 손 든 상태는 여기 없다 — 서버가 브로드캐스트하는 `useLiveStore.handRaisedIds` 가 진실이다.
     (백엔드 손들기는 토글이라 로컬 플래그를 따로 두면 서버와 어긋난다) */
  /** 공유 칠판에 그리는 중 (선생님이 판서 권한을 준 학생만 켤 수 있다) */
  boardPenOn: boolean
  fullscreen: boolean
  signalingStatus: SignalingStatus
  /** 지금 푸는 과제 id — 퀴즈 화면이 이 과제의 문항을 서버에서 받아온다 */
  quizAssignmentId: string | null

  setView: (view: ClassroomView) => void
  setQuizAssignmentId: (id: string | null) => void
  setLayoutMode: (mode: LayoutMode) => void
  setMicOn: (on: boolean) => void
  setCameraOn: (on: boolean) => void
  setBoardPenOn: (on: boolean) => void
  setFullscreen: (full: boolean) => void
  setSignalingStatus: (status: SignalingStatus) => void
}

/**
 * 마이크·카메라 on/off 만 **탭이 살아 있는 동안** 기억한다 (sessionStorage).
 *
 * 예전엔 아무 데도 저장하지 않아서, 카메라를 끈 학생이 새로고침하면 **켜진 채로** 돌아왔다
 * (스토어가 메모리에만 있어 기본값으로 다시 태어난다). 서버에는 학생 개인의 선택이 없다 —
 * 서버가 아는 건 선생님이 반 전체를 잠갔는지(`mutedMic`/`mutedCam`)뿐이고 성질이 다른 값이다.
 *
 * **localStorage 를 쓰지 않는 이유**: 기기에 영구히 남으면 한 번 끈 학생이 다음 수업에도
 * 계속 꺼진 채로 들어온다 — 선생님이 얼굴을 못 보는 것이 기본값이 되어 버린다.
 * 창을 닫으면 초기값(카메라 꺼짐 · 마이크 켜짐)으로 돌아가는 편이 맞다.
 *
 * 나머지 상태(view·fullscreen·signalingStatus 등)는 저장하지 않는다. 화면이나 연결의
 * **지금 모습**이라 복원하면 사실과 어긋난다 — 예: 끊긴 채로 `connected` 가 되살아난다.
 */
export const useClassroomStore = create<ClassroomState>()(
  persist(
    (set) => ({
      view: 'classroom',
      layoutMode: 'speaker',
      micOn: true,
      /*
        **처음 들어올 때 카메라는 꺼져 있다.** 켜는 건 학생이 직접 한다 — 교실에 들어오자마자
        얼굴이 나가는 것은 놀랄 일이고, 브라우저 권한 프롬프트도 아무 맥락 없이 뜬다.
      */
      cameraOn: false,
      boardPenOn: false,
      fullscreen: false,
      signalingStatus: 'idle',
      quizAssignmentId: null,

      setView: (view) => set({ view }),
      setQuizAssignmentId: (quizAssignmentId) => set({ quizAssignmentId }),
      setLayoutMode: (layoutMode) => set({ layoutMode }),
      setMicOn: (micOn) => set({ micOn }),
      setCameraOn: (cameraOn) => set({ cameraOn }),
      setBoardPenOn: (boardPenOn) => set({ boardPenOn }),
      setFullscreen: (fullscreen) => set({ fullscreen }),
      setSignalingStatus: (signalingStatus) => set({ signalingStatus }),
    }),
    {
      name: 'classroom-media',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ micOn: s.micOn, cameraOn: s.cameraOn }),
    },
  ),
)
