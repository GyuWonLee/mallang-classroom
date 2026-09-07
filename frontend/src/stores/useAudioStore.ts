import { create } from 'zustand'

/**
 * 원격 오디오 재생 상태 — 계약 지점(Rule 5).
 *
 * 브라우저는 사용자가 페이지를 한 번도 건드리지 않았으면 소리 있는 미디어의 자동 재생을 막는다.
 * 그러면 학생은 **아무 안내 없이 선생님 목소리를 못 듣는다**. LiveKit 이 그 상황을
 * `RoomEvent.AudioPlaybackStatusChanged` 로 알려주므로 서비스(`RemoteAudioPlayer`)가 여기에
 * `blocked` 를 세운다.
 *
 * **이 값으로 버튼을 띄우지는 않는다.** 예전에는 `SoundUnlockBar` 가 "눌러서 선생님 목소리
 * 듣기" 배너를 띄웠지만, 해제에 필요한 것은 **사용자 제스처**이지 특정 버튼이 아니다.
 * 지금은 `RemoteAudioPlayer.armGestureUnlock()` 이 첫 클릭·키·터치에 조용히 푼다.
 * 이 플래그는 그 사이 "지금 소리가 막혀 있다"를 아는 용도로 남는다.
 *
 * 네이티브 객체는 넣지 않는다(Rule 2) — 불리언 하나뿐이다.
 */
interface AudioState {
  /** 자동 재생이 막혀 소리가 안 나는 중 */
  blocked: boolean
  setBlocked: (blocked: boolean) => void
}

export const useAudioStore = create<AudioState>((set) => ({
  blocked: false,
  setBlocked: (blocked) => set({ blocked }),
}))
