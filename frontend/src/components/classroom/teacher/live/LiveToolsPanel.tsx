import { Icon } from '@/components/common/Icon'

/**
 * 빠른 도구 — 수업을 떠나지 않고 여는 것들.
 *
 * 예전엔 2열 타일 그리드였다. 눌러도 "준비 중" 토스트만 뜨던 세 칸(자료실·설문&퀴즈·타이머)을
 * 없애고 나니 **한 칸만 남아** 그리드가 어색해졌고, 정사각 타일은 무슨 일이 일어나는지
 * 설명할 자리도 없었다. 그래서 설명 한 줄을 품는 **가로 줄 카드**로 바꿨다.
 *
 * 쉬는시간 잠금은 여기 있었지만 하단 컨트롤 바로 옮겼다 — 학생 전원의 화면을 덮는 동작이라
 * 방송 조작과 같은 무게이고, 급할 때 스크롤을 내려서 찾을 것이 아니다.
 *
 * **높이를 최소로 쓴다.** 예전엔 '빠른 도구' 제목 + 큰 줄 카드로 세로 110px 을 먹었는데,
 * 그만큼이 학생 얼굴에서 깎여 나가 6명이 한 화면에 안 들어왔다. 제목을 지우고(버튼 글자가
 * 이미 무엇인지 말한다) 한 줄만 남겼다.
 *
 * 흰 카드가 아니라 **패널 카드 안의 마지막 줄**이다 — 위 구분선으로 학생 영역과 나뉜다.
 * 카드 안에 카드를 겹치면 흰 면 위 흰 면이 되어 경계가 사라진다(ParticipantsCard 와 같은 이유).
 */
export function LiveToolsPanel({ onWorkspace }: { onWorkspace: () => void }) {
  return (
    /* flex-none — 위 '참여 학생' 이 남는 높이를 다 쓰므로 이 줄은 내용 높이만 갖는다 */
    <button
      type="button"
      onClick={onWorkspace}
      className="flex w-full flex-none items-center gap-3 border-t-[1.5px] border-live-line p-[13px_18px] text-left transition-colors hover:bg-canvas"
    >
      <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-xl bg-task-soft text-[#D9A916]">
        <Icon name="folder" className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[.92rem] font-black">학습자료 / 과제</span>
      <Icon name="chevronRight" className="h-[17px] w-[17px] flex-none text-ink-mute" />
    </button>
  )
}
