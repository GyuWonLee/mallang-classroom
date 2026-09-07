import { create } from 'zustand'

/**
 * 학생 화면 알림 스택 — 공지·쪽지·새 과제를 **카톡 알림처럼 겹쳐 쌓아** 보여준다.
 *
 * 기존 `useToastStore` 를 쓰지 않는 이유가 둘 있다:
 *  1. **토스트는 동시에 하나만 뜬다.** `show()` 가 message 문자열을 덮어쓰고 타이머를 리셋해서,
 *     공지와 새 과제가 연달아 오면 앞의 것이 읽히기 전에 사라진다. 지금 그 채널을 쓰는 곳이
 *     이미 6군데(수업 시작·쪽지·강퇴·과제·소켓 오류·손들기)라 경합이 잦다.
 *  2. **전체화면에서 토스트가 보이지 않는다.** `Toast` 는 RootLayout 에 마운트돼 있어
 *     전체화면 대상(VideoCard 카드 div)의 **바깥** 트리다. 브라우저 전체화면은 대상 요소와
 *     그 하위만 top layer 에 그리므로, z-index 를 얼마로 올려도 화면에 나오지 않는다.
 *     그래서 알림 UI 는 카드 **안쪽**에 렌더해야 하고, 데이터를 이 스토어가 들고 있는다.
 */

export type NoticeKind = 'notice' | 'message' | 'assignment'

export interface Notice {
  id: string
  kind: NoticeKind
  title: string
  body: string
}

interface NoticeState {
  items: Notice[]
  push: (notice: Omit<Notice, 'id'>) => void
  dismiss: (id: string) => void
  clear: () => void
}

/** 화면에 동시에 남겨 둘 최대 개수 — 넘치면 오래된 것부터 밀어낸다 */
const MAX_VISIBLE = 3
let seq = 0

export const useNoticeStore = create<NoticeState>((set) => ({
  items: [],

  push: (notice) => {
    seq += 1
    const id = `n${seq}`
    set((s) => ({ items: [...s.items, { ...notice, id }].slice(-MAX_VISIBLE) }))
  },

  dismiss: (id) => set((s) => ({ items: s.items.filter((n) => n.id !== id) })),
  clear: () => set({ items: [] }),
}))
