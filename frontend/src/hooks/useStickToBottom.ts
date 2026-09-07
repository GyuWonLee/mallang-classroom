import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * 대화 목록을 **맨 아래에 붙여 두는** 훅.
 *
 * 채팅 화면 4곳(학생 쪽지 · 라이브 채팅 · 학급 메시지 · 채팅 관리)이 각자 다른 규칙을 갖고 있었다 —
 * 임계값이 40px/80px/없음으로 갈렸고, 특히 **보낼 때도 가드에 걸려** 위로 올려 읽던 중에
 * 전송하면 내가 방금 쓴 말풍선으로 내려가지 않았다. 방을 처음 열 때도 `scrollTop === 0` 이라
 * 가드를 통과하지 못해 **긴 이력이 맨 위(가장 오래된 메시지)에서 시작**했다.
 *
 * 규칙:
 *  - 하단 근처(THRESHOLD 안)에 있으면 새 메시지를 따라 내려간다.
 *  - 위로 올려 **읽고 있는 중이면 자리를 지킨다** (읽던 곳을 빼앗지 않는다).
 *  - `stick()` 을 부르면 어디를 보고 있었든 즉시 내려간다 — **보낼 때와 방을 열 때** 쓴다.
 *
 * `useLayoutEffect` 인 이유: 페인트 전에 옮겨야 스크롤이 튀지 않는다.
 */

/** 이 거리 안에 있으면 "하단을 보고 있다"로 본다 */
const THRESHOLD = 80

export function useStickToBottom<T extends HTMLElement = HTMLDivElement>(
  /** 이 값이 바뀔 때마다 하단 추적을 시도한다 (메시지 배열·개수 등) */
  ...deps: unknown[]
) {
  const ref = useRef<T | null>(null)
  /** 지금 하단을 따라갈지. 초기값 true — 처음 열면 최신 메시지가 보여야 한다 */
  const following = useRef(true)

  /**
   * 사용자 스크롤에만 반응해 추적 여부를 갱신한다.
   * 새 메시지가 붙은 **뒤에** 거리를 재면 이미 늘어난 높이 때문에 항상 "멀다"가 나온다.
   */
  const onScroll = useCallback((e: React.UIEvent<T>) => {
    const el = e.currentTarget
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD
  }, [])

  /** 어디를 보고 있었든 맨 아래로 — 내가 보낼 때, 대화방을 열 때 */
  const stick = useCallback(() => {
    following.current = true
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (el && following.current) el.scrollTop = el.scrollHeight
    // deps 는 호출부가 넘긴 값들 — 개수가 렌더마다 고정이라 스프레드해도 안전하다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { ref, onScroll, stick }
}
