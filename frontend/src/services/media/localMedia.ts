import { MediaDeviceManager } from './MediaDeviceManager'

/**
 * 로그인한 사용자 **본인**의 카메라/마이크 — 앱 전체에서 하나만 쓴다.
 *
 * 셀프뷰(내 얼굴 미리보기)와 LiveKit 송출이 같은 스트림을 공유해야 하기 때문이다.
 * 훅마다 `new MediaDeviceManager()` 를 만들면 getUserMedia 가 여러 번 호출돼
 * 카메라가 잠기거나 미리보기와 송출 화면이 서로 달라진다.
 *
 * 정리는 화면을 떠날 때 `release()` 로 한 번만 — 컴포넌트 언마운트마다 부르면 안 된다.
 */
export const localMedia = new MediaDeviceManager()
