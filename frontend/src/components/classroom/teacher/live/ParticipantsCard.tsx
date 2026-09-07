import type { ReactNode } from 'react'
import { Icon } from '@/components/common/Icon'
import type { StudentAccount } from '@/types/teacher'

/**
 * 참여 학생 — 머리글(누가 몇 명 들어왔나)과 그 아래 **학생 화면**.
 *
 * 한때 여기에 아바타 그림만 3열로 깔았다. 세로를 아껴 아래 카드를 살리려던 것인데, 수업 중에
 * 선생님이 계속 봐야 하는 것은 그림이 아니라 **아이 얼굴**이었다. 그래서 타일(영상 + 개별
 * 음소거·카메라·판서 권한·내보내기)을 다시 이 자리에 둔다.
 *
 * 타일 자체는 이 컴포넌트가 그리지 않는다 — `children` 으로 받는다. 영상 배선(팀 룸 트랙 ref)과
 * 조작 콜백이 전부 페이지에 있어서, 여기서 다시 받아 넘기면 프롭이 열 개 넘게 겹친다.
 *
 * **자기 카드 껍데기(흰 면·그림자·라운드)를 갖지 않는다.** 위 탭 줄과 한 카드 안에 함께 있고
 * (`LiveDrawer`), 카드 안에 카드를 겹치면 흰 면 위 흰 면이 되어 경계가 사라진다.
 */
export function ParticipantsCard({
  students,
  onlineNames,
  liveUserIds = [],
  children,
}: {
  students: StudentAccount[]
  onlineNames: ReadonlySet<string>
  liveUserIds?: number[]
  /** 학생 타일 그리드 (`StudentsLivePanel`) */
  children: ReactNode
}) {
  const online = students.filter(
    (s) => onlineNames.has(s.name) || liveUserIds.includes(s.userId),
  ).length

  return (
    /*
      남은 높이를 다 쓴다(flex-1). 학생이 적어도 아래가 텅 비지 않고, 늘어난 높이는 타일이
      커지는 데 쓰인다. 넘치면 타일 그리드 안에서만 스크롤한다.
    */
    <section className="flex min-h-0 flex-1 flex-col">
      {/*
        머리글에 **위아래 여백**을 준다(`p-[18px_18px_14px]`). 예전엔 패딩 없이 붙어 있어서
        탭 구분선·타일과 글자가 맞닿아 답답했다 — 제목은 붙어 있으면 "빽빽하다"로 읽히고,
        여백이 곧 제목의 무게가 된다.

        '전체 보기' 는 없앴다(선생님 요청). 타일에 이미 개별 조작이 다 들어 있어서, 큰 창을
        따로 여는 길이 없어도 여기서 할 일은 다 된다.
      */}
      <h3 className="flex flex-none items-center gap-2 p-[18px_18px_14px] text-[1.05rem] font-black">
        <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-lg bg-sky text-primary">
          <Icon name="students" className="h-[15px] w-[15px]" />
        </span>
        참여 학생
        {/*
          들어온 인원 / 발급 인원. 발급 인원만 적으면 아무도 안 들어와도 "6명" 이라
          적혀 접속 여부를 알 수 없다. 위 탭의 `학생 6` 은 발급 인원이라 이쪽이 더 자세하다.
        */}
        <span className="text-primary">
          {online}
          <span className="text-ink-mute">/{students.length}명</span>
        </span>
      </h3>

      {/* 타일이 많으면 여기서만 스크롤한다 — 머리글은 늘 보인다 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-[18px]">{children}</div>
    </section>
  )
}
