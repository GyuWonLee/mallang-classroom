import { create } from 'zustand'

interface ToastState {
  message: string
  visible: boolean
  show: (text: string) => void
  hide: () => void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

/** 화면 상단 토스트 (ref showToast 이관) */
export const useToastStore = create<ToastState>((set) => ({
  message: '',
  visible: false,
  show: (text) => {
    set({ message: text, visible: true })
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => set({ visible: false }), 2600)
  },
  hide: () => set({ visible: false }),
}))
