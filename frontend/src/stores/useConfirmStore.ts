import { create } from 'zustand'

/**
 * 확인 대화상자(Confirm) — `window.confirm()` 을 대체하는 공용 계약.
 *
 * 브라우저 기본 `confirm()` 은 (1) 디자인 시스템 밖의 OS 팝업이라 화면 톤이 깨지고,
 * (2) 줄바꿈·강조·버튼 라벨을 못 바꿔서 "무엇이 지워지는지"를 제대로 못 알려주고,
 * (3) 메인 스레드를 멈춰 세운다. 되돌리기 어려운 행동에는 항상 이 모달을 쓴다
 * (DESIGN_GUIDELINES 6장 · 10장 ④).
 *
 * 쓰는 쪽은 `await confirmAction({...})` 한 줄이면 된다 — `confirm()` 과 모양이 같다:
 *
 * ```ts
 * if (!(await confirmAction({ title: '수업을 삭제할까요?', confirmLabel: '수업 삭제' }))) return
 * ```
 */
export interface ConfirmRequest {
  /** 무엇을 하려는지 — 물음표로 끝나는 한 문장 */
  title: string
  /** 결과가 어떻게 되는지 (특히 무엇이 함께 사라지는지) */
  message?: string
  /** 실행 버튼 라벨 — "확인" 대신 동사+목적어로 ("수업 삭제", "학생 내보내기") */
  confirmLabel: string
  cancelLabel?: string
  /** 삭제·내보내기·종료처럼 되돌릴 수 없는 행동이면 true (빨간 버튼 + 경고 아이콘) */
  danger?: boolean
}

interface Pending extends ConfirmRequest {
  resolve: (ok: boolean) => void
}

interface ConfirmState {
  pending: Pending | null
  /** 확인 대화상자를 띄우고, 사용자가 고를 때까지 기다린다 */
  ask: (request: ConfirmRequest) => Promise<boolean>
  /** 대화상자의 답 — true 면 실행, false/닫기면 취소 */
  answer: (ok: boolean) => void
}

export const useConfirmStore = create<ConfirmState>((set, getState) => ({
  pending: null,

  ask: (request) =>
    new Promise<boolean>((resolve) => {
      // 이미 열려 있으면 앞의 요청은 취소로 정리한다 (약속을 미해결로 남기지 않는다)
      getState().pending?.resolve(false)
      set({ pending: { ...request, resolve } })
    }),

  answer: (ok) => {
    const pending = getState().pending
    if (!pending) return
    set({ pending: null })
    pending.resolve(ok)
  },
}))

/** React 밖(핸들러·서비스)에서도 쓸 수 있는 호출 함수 */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return useConfirmStore.getState().ask(request)
}
