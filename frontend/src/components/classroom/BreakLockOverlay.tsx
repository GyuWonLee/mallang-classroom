import { Icon } from '@/components/common/Icon'
import { useLiveStore } from '@/stores/useLiveStore'

/**
 * 쉬는시간 잠금 덮개 (학생) — 선생님이 `PUT /sessions/{id}/broadcast-lock` 으로 켜면 덮인다.
 *
 * **방송 카드(캠) 안에만 깔린다.** 페이지 전체를 덮으면 쉬는 시간에 과제도 못 풀고 AI 말랑이와
 * 대화도 못 하는데, 잠금의 목적은 "선생님 화면·캠에서 잠깐 눈을 떼게" 하는 것이다.
 * 그래서 `absolute inset-0` 으로 VideoCard 안쪽에 놓고, 나머지 화면은 그대로 쓸 수 있게 둔다.
 * (부모 VideoCard 가 `relative isolate` 라 이 카드 안에만 갇힌다)
 *
 * **이 덮개가 잠금의 유일한 집행 수단이다.** 백엔드는 Redis 플래그만 세우고 STOMP 로 알릴 뿐
 * LiveKit 미디어 권한은 건드리지 않는다(명세 §5).
 *
 * 닫기 버튼을 두지 않는다. 학생이 닫을 수 있으면 잠금이 아니고, 선생님이 풀면(`locked:false`)
 * STOMP 가 알려 저절로 사라진다. 상태는 `useLiveStore.broadcastLocked` 하나가 원천이고
 * 재접속 시엔 `GET /sessions/{id}/state` 스냅샷이 복원한다.
 */
export function BreakLockOverlay() {
  const locked = useLiveStore((s) => s.broadcastLocked)

  if (!locked) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      /*
        z-[45]: 판서 캔버스(z-30)·셀프뷰·LIVE 칩(z-35)·컨트롤 바(z-40) 위에 덮는다.
        쉬는 시간에는 캠 영역의 어떤 것도 만지지 않게 한다.
      */
      className="absolute inset-0 z-[45] grid place-items-center bg-[rgba(24,32,64,.72)] p-6 text-center backdrop-blur-[6px]"
    >
      <div className="flex flex-col items-center">
        {/* 쉬는시간은 '지금 할 일' 계열 — task 노랑 (DESIGN_GUIDELINES 색 예산) */}
        <span className="grid h-[68px] w-[68px] place-items-center rounded-full bg-task animate-[floaty_2.4s_ease-in-out_infinite]">
          <Icon name="lock" className="h-8 w-8 text-task-deep" />
        </span>
        <h2 className="mt-3.5 text-[1.3rem] font-black text-white">지금은 쉬는 시간이에요</h2>
        <p className="mt-1.5 text-[.95rem] font-bold leading-relaxed text-white/85">
          잠깐 쉬면서 물도 마시고 스트레칭도 해요.
          <br />
          선생님이 수업을 다시 시작하면 저절로 열려요!
        </p>
      </div>
    </div>
  )
}
