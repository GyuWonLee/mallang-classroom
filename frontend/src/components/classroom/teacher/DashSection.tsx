import type { ReactNode } from 'react'

interface DashSectionProps {
  title: string
  /** 제목 아래 한 줄 요약 (ref `.pk-sec-sub`) — 카드를 세어 보지 않아도 규모를 알 수 있게 */
  subtitle?: ReactNode
  /** 헤더 우측 액션 (예: 수업 생성) */
  action?: ReactNode
  children: ReactNode
}

/**
 * 학급 패널 안의 한 묶음 — 레퍼런스 teacher.html `.pk-sec` + `.pk-panel-head` 이관.
 *
 * 예전에는 섹션마다 테두리 있는 흰 박스(`.dash-section`)를 둘렀는데, 히어로 배너까지 셋이
 * 되면서 화면이 여러 덩어리로 갈려 보였다. ref 는 그 스타일을 폐기하고 **패널 하나 안에서
 * 얇은 구분선으로만** 나눈다(구분선은 부모 패널이 `section + section` 으로 그린다).
 * 그래서 여기엔 아이콘도, 가로 구분선도, 자체 테두리도 없다.
 */
export function DashSection({ title, subtitle, action, children }: DashSectionProps) {
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-[18px]">
        {/*
          ref `.pk-sec-title` — 제목과 개수를 **한 줄에 나란히**, baseline 으로 맞춘다.
          center 로 맞추면 작은 개수 글씨가 제목 가운데에 떠 보이고, 위아래로 쌓으면
          섹션 머리가 두 줄이 되어 오른쪽 버튼과 높이가 어긋난다.

          제목 1.8rem 은 ref `#viewList .pk-panel-head h2` 값이다 — 내 학급 두 섹션만
          키운 값이라 이 컴포넌트(내 학급 전용)에 그대로 박는다. 개수는 따라 커지면
          안 되므로 `.pk-sec-sub` 의 .9rem 을 유지한다.
        */}
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-[1.8rem] font-black tracking-[-.3px]">{title}</h2>
          {subtitle && <p className="text-[.9rem] font-bold text-ink-soft">{subtitle}</p>}
        </div>
        {action}
      </div>

      {children}
    </section>
  )
}
