import type { ReactNode } from 'react'
import { Icon } from '@/components/common/Icon'
import { cn } from '@/lib/cn'

/**
 * 무대 오른쪽에 **고정된** 채팅·도구 패널 — Zoom 의 오른쪽 사이드 패널.
 *
 * **한 열에 위 탭 · 아래 내용**이다. 채팅과 도구를 각자 카드로 늘어놓지 않는 이유:
 * 무대가 화면을 꽉 채우는 구조에서 카드가 늘어나면 그만큼 무대가 줄어든다.
 *
 * 열고 닫는 토글이 아니라 **늘 보인다.** 수업 중에는 둘 다 상시 필요한 것이고, 토글이면
 * 열 때마다 무대 폭이 바뀌어 영상이 리레이아웃된다(출렁인다). 컨트롤 바의 두 버튼은
 * 이제 여닫는 스위치가 아니라 **어느 쪽을 볼지 고르는** 스위치다.
 *
 * 무대를 **덮지 않고 옆에 선다**(overlay 가 아니라 flex 형제). 겹치면 필름스트립·컨트롤 바와
 * 층이 엉키고, 무엇보다 판서 중에 캔버스를 가려 획이 끊겨 보인다.
 * 좁은 화면(≤900px)에서는 옆에 설 폭이 없어 **무대 아래로 내려간다** — 덮어 버리면 닫는
 * 수단이 없는 패널이라 무대를 영구히 가린다.
 */
export function LiveDrawer({
  chat,
  tools,
  /** 지금 어느 쪽을 보고 있는지 */
  focus,
  onFocus,
  /** 탭에 적을 학생 수 (`학생 6`) — 패널을 열지 않고도 몇 명인지 보인다 */
  studentCount,
  /** 안 읽은 쪽지 수 — 학생 탭을 보는 동안 새 채팅을 놓치지 않게 */
  chatBadge,
  /** 손 든 학생 수 */
  handCount,
}: {
  chat: ReactNode
  tools: ReactNode
  focus: 'chat' | 'tools'
  onFocus: (which: 'chat' | 'tools') => void
  studentCount?: number
  chatBadge?: number
  handCount?: number
}) {
  return (
    <aside
      aria-label="수업 도구"
      className={cn(
        // 테두리를 두지 않는다 — 안의 카드들이 흰 면과 그림자로 이미 경계를 만든다
        'flex min-h-0 flex-col overflow-hidden',
        /*
          380px. 한때 420 으로 넓혀 타일을 키웠지만 패널이 화면을 너무 먹었다 — 무대가 그만큼
          좁아진다. 타일 폭은 이 값에서 나오므로(2열) 여기가 곧 "학생 화면 크기"다.
        */
        'w-[380px] flex-none',
        // 좁은 화면 — 옆이 아니라 아래. 무대와 높이를 나눠 쓴다
        'max-[900px]:w-full max-[900px]:flex-1',
      )}
    >
      {/*
        ── 탭 + 내용이 **한 카드** ────────────────────────────────────
        탭 줄을 따로 뜬 카드로 두었을 때는 아래 내용 카드와 그림자 두 개가 10px 간격으로
        떠 있어서, 스위치와 그 결과가 서로 관계없는 두 덩어리로 보였다(선생님 표현: "너무
        어색하게 떨어져 있다"). 같은 흰 면 안에 넣고 **구분선 하나로** 나누면 "위에서 고르면
        아래가 바뀐다"가 한 덩어리로 읽힌다 — 브라우저 탭과 같은 관계다.
      */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-card shadow-card">
      {/*
        탭 — **패널 맨 위**다(상단 바에서 내려왔다). 고르는 대상 바로 위에 있어야
        "이 스위치가 아래 내용을 바꾼다"가 자리로 읽힌다.
      */}
      <div className="flex flex-none items-center gap-1.5 border-b-[1.5px] border-live-line p-2">
        {(
          [
            {
              key: 'tools' as const,
              label: studentCount != null ? `학생 ${studentCount}` : '학생',
              icon: 'students' as const,
              badge: handCount,
            },
            { key: 'chat' as const, label: '채팅', icon: 'chat' as const, badge: chatBadge },
          ]
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onFocus(t.key)}
            data-on={focus === t.key}
            className="relative inline-flex flex-1 items-center justify-center gap-2 rounded-[14px] p-[9px_10px] text-[.88rem] font-extrabold text-ink-soft transition-colors hover:bg-canvas data-[on=true]:bg-sky data-[on=true]:text-primary"
          >
            <Icon name={t.icon} className="h-[17px] w-[17px] flex-none" />
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="grid h-[19px] min-w-[19px] place-items-center rounded-full bg-danger px-1 text-[.66rem] font-black text-white">
                {t.badge > 9 ? '9+' : t.badge}
              </span>
            )}
          </button>
        ))}
        {/* 닫기 버튼은 두지 않는다 — 고정 패널이라 닫는다는 개념이 없다 */}
      </div>

      {/*
        둘을 **모두 마운트해 두고 보이기만 바꾼다.** 채팅은 언마운트되면 이력을 다시 받고
        스크롤 위치를 잃는다 — 학생 화면 드로어(ClassroomPage)와 같은 판단이다.
      */}
      {/*
        스크롤은 여기서 걸지 않는다 — 내용(참여 학생)이 **남은 높이를 채우고 자기 안에서**
        스크롤한다. 이 층이 스크롤하면 '학습자료 / 과제' 줄이 화면 밖으로 밀려 내려간다.
      */}
      <div className="relative min-h-0 flex-1">
        <div
          data-on={focus === 'chat'}
          className="absolute inset-0 flex min-h-0 flex-col overflow-hidden opacity-0 invisible data-[on=true]:visible data-[on=true]:opacity-100"
        >
          {chat}
        </div>
        <div
          data-on={focus === 'tools'}
          className="absolute inset-0 flex min-h-0 flex-col overflow-hidden opacity-0 invisible data-[on=true]:visible data-[on=true]:opacity-100"
        >
          {tools}
        </div>
      </div>
      </div>
    </aside>
  )
}
