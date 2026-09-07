import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, type IconName } from '@/components/common/Icon'
import { TeacherEasterEgg } from '@/components/classroom/teacher/TeacherEasterEgg'
import { useAuth } from '@/hooks/useAuth'
import { useRapidTaps } from '@/hooks/useRapidTaps'
import { useToastStore } from '@/stores/useToastStore'
import { teacherRoutes, type PickIntent } from '@/lib/routes'
import { topicParticle } from '@/lib/korean'
import { TEACHER_CONTENT_ID } from '@/lib/teacherLayout'

export type TeacherNavKey = 'home' | 'assignments' | 'students' | 'settings'

/** 이스터에그가 열리는 연속 클릭 수 (셈하는 규칙은 `useRapidTaps`) */
const EGG_CLICKS = 20

/** 레퍼런스 teacher.html `.sidebar` 와 동일한 4개 — 순서까지 맞춘다 */
const NAV: { key: TeacherNavKey; label: string; icon: IconName }[] = [
  { key: 'home', label: '내 학급', icon: 'home' },
  { key: 'assignments', label: '과제 관리', icon: 'book' },
  { key: 'students', label: '학생 관리', icon: 'friends' },
  { key: 'settings', label: '설정', icon: 'gear' },
]


/**
 * 학급 안에서만 뜻이 있는 메뉴 — 그 학급의 해당 화면으로 보낸다.
 * 학급을 아직 고르지 않았으면 학급 선택 화면(ref viewPickClass)을 먼저 거친다.
 *
 * ref 기준 과제·학생 관리는 **각각 독립 화면**이고(화면 4·5), 학급 관리 탭에 들어가지 않는다.
 * 설정만 학급 관리(개요 탭)로 간다 — ref 의 설정은 클릭 핸들러가 없는 죽은 버튼이라
 * 대응 화면이 없어, 실제로 동작하는 우리 학급 설정을 그대로 쓴다.
 */
const NAV_SCREEN: Partial<
  Record<TeacherNavKey, { to: (classroomId: string) => string; pick: PickIntent }>
> = {
  assignments: { to: (id) => teacherRoutes.assignments(id), pick: 'assignments' },
  students: { to: (id) => teacherRoutes.students(id), pick: 'students' },
  settings: { to: (id) => teacherRoutes.classManage(id, 'overview'), pick: 'overview' },
}

interface TeacherSidebarProps {
  /**
   * 지금 화면에 해당하는 메뉴. **생략하면 아무 곳에도 불이 들어오지 않는다** —
   * 예전 기본값이 'home' 이라, 사이드바에 항목이 없는 화면(채팅 관리)이나 다른 메뉴로 들어온
   * 화면(학급 관리의 설정 탭)에서도 "내 학급"에 불이 들어와 위치를 잘못 알려줬다.
   */
  active?: TeacherNavKey
  /** 현재 보고 있는 학급 — 있으면 학급 관리 탭으로 바로 갈 수 있다 */
  classroomId?: string
}

/** 선생님 좌측 딥블루 사이드바 — 레퍼런스 teacher.html .sidebar 이관 */
export function TeacherSidebar({ active, classroomId }: TeacherSidebarProps) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const showToast = useToastStore((s) => s.show)

  // ── 이스터에그: 마스코트 빠르게 20번 ────────────────────────────
  const [eggOpen, setEggOpen] = useState(false)
  /* 이미 떠 있으면 세지 않는다 — 연출 중에 또 눌러 다시 열리면 폭죽이 겹친다 */
  const tapMascot = useRapidTaps(EGG_CLICKS, () => {
    if (!eggOpen) setEggOpen(true)
  })

  function go(key: TeacherNavKey, label: string) {
    /*
      "내 학급"은 **한 단계 위**로 간다 (routes.ts 규칙 1).

      학급 안쪽 화면(과제 관리·학생 관리·설정 = L3)에서 눌렀으면 보고 있던 **그 학급의 화면**
      (L2)으로 돌아가고, 거기서 한 번 더 누르면 그때 학급 목록(L1)으로 나간다.

      예전에는 어디서 눌러도 곧장 L1 이었다 — 과제 관리를 보다가 학급으로 돌아가려고 누르면
      학급이 여러 개 늘어선 목록으로 튕겨 나가, 방금까지 보던 학급을 매번 다시 골라야 했다.

      L2 인지 L3 인지는 `active` 로 안다. 학급 화면은 자신을 'home' 으로 표시하므로
      (`TeacherClassDetailPage`) 거기서는 목록으로 간다 — 나가는 길이 막히지 않는다.
      학급을 아직 안 골랐으면(classroomId 없음) 어차피 목록뿐이다.
    */
    if (key === 'home') {
      return navigate(
        classroomId && active !== 'home'
          ? teacherRoutes.classDetail(classroomId)
          : teacherRoutes.home,
      )
    }

    const screen = NAV_SCREEN[key]
    if (!screen) return showToast(`${label}${topicParticle(label)} 준비 중이에요!`)
    /*
      보고 있던 학급이 있으면 **그 학급의 화면으로 곧장** 간다 — 학급을 다시 고르게 하면
      옆 화면으로 건너뛸 때마다 관문을 한 번 더 지나야 한다.

      다만 출발지는 **일부러 싣지 않는다.** 사이드바는 흐름을 따라 내려온 길이 아니라 어디서나
      옆으로 건너뛰는 지름길이라, 출발지를 실으면 과제 관리 -> 학생 관리 -> 뒤로 -> 과제 관리 처럼
      같은 깊이에서 제자리를 돈다. 실지 않으면 도착 화면의 fallback(담당 학급 선택)이 걸려
      뒤로가기가 늘 흐름의 한 단계 위로 간다 (routes.ts 규칙 1).
    */
    if (classroomId) return navigate(screen.to(classroomId))
    /*
      학급을 고르지 않았으면 **학급 선택 화면**으로 보낸다 (ref viewPickClass).
      예전엔 모달을 띄웠는데, ref 는 배너 + 검색/정렬 + 학급 카드 그리드를 갖춘 화면이다 —
      이름만 나열된 좁은 모달보다 고르기 쉽고, 뒤로가기·새로고침·딥링크도 그대로 동작한다.
    */
    navigate(teacherRoutes.pickClass(screen.pick))
  }

  return (
    /*
      더 이상 sticky 로 "스크롤 중 붙잡아 두는" 방식이 아니다 (ref .sidebar).
      페이지가 스크롤되지 않고 콘텐츠 칸만 스크롤되므로(TeacherShell), 사이드바는 셸 높이에
      맞춰 늘어난 채로 화면에 고정돼 보인다. 자기 항목이 넘칠 때만 안에서 스크롤한다.
    */
    <nav
      aria-label="주 메뉴"
      className="flex min-h-[420px] w-[118px] flex-none flex-col items-center gap-1.5 self-stretch overflow-y-auto rounded-[32px] bg-sidebar p-[22px_12px] shadow-card-lg max-[640px]:min-h-0 max-[640px]:w-full max-[640px]:flex-row max-[640px]:flex-wrap max-[640px]:justify-around max-[640px]:gap-0 max-[640px]:overflow-visible max-[640px]:rounded-[24px] max-[640px]:p-[8px_6px]"
    >
      {/*
        마스코트 — 이스터에그 발동점.

        일부러 `<button>` 으로 만들지 않았다. 이건 **숨은 장난**이지 기능이 아니라서,
        버튼으로 바꾸면 탭 순서에 끼고 화면 낭독기가 "버튼" 이라고 읽어 준다 — 눌러도
        아무 의미 없는 조작을 안내하는 셈이고, 숨은 것도 아니게 된다.
        커서도 그대로 둔다(모양이 바뀌면 눌러 보라는 신호가 된다).
      */}
      <span
        onClick={tapMascot}
        className="mb-4 grid h-[60px] w-[60px] place-items-center rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,.12)] max-[640px]:hidden"
      >
        <img
          src="/assets/ch2.webp"
          alt=""
          aria-hidden="true"
          decoding="async"
          className="h-11 w-11 object-contain"
        />
      </span>

      {eggOpen && <TeacherEasterEgg onDone={() => setEggOpen(false)} />}

      {NAV.map((item) => {
        const on = active === item.key
        return (
          <button
            key={item.key}
            type="button"
            data-active={on}
            aria-current={on ? 'page' : undefined}
            onClick={() => {
              // 페이지가 아니라 콘텐츠 칸이 스크롤된다 — window.scrollTo 로는 아무 일도 안 일어난다
              if (on) return document.getElementById(TEACHER_CONTENT_ID)?.scrollTo({ top: 0 })
              go(item.key, item.label)
            }}
            className="group flex w-[94px] flex-col items-center gap-1.5 break-keep rounded-[20px] p-[12px_4px] text-center text-[.75rem] font-bold leading-[1.35] text-white/80 transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:text-white data-[active=true]:text-white max-[640px]:w-auto max-[640px]:gap-1 max-[640px]:whitespace-nowrap max-[640px]:p-2 max-[640px]:text-[.64rem]"
          >
            {/*
              640px 이하(하단 고정 바)에서는 활성/비활성 아이콘 칸 높이를 **똑같이 40px** 로 둔다.
              예전엔 활성 40 · 비활성 28 로 서로 달라서, 활성 탭이 없는 화면(학급 상세·학생 상세)에
              들어갈 때마다 하단 바 전체 높이가 줄었다 늘었다 했다. 하이라이트는 높이가 아니라
              배경·둥근 사각형 모양만으로 표시해 바 높이가 항상 같게 만든다 (ref 미디어쿼리).
            */}
            <span className="grid h-[34px] w-16 place-items-center transition-all group-data-[active=true]:h-14 group-data-[active=true]:rounded-[18px] group-data-[active=true]:bg-white group-data-[active=true]:shadow-[0_8px_16px_rgba(0,0,0,.18)] max-[640px]:h-10 max-[640px]:w-12 max-[640px]:group-data-[active=true]:h-10 max-[640px]:group-data-[active=true]:rounded-[14px]">
              <Icon
                name={item.icon}
                className="h-[26px] w-[26px] text-white/80 group-hover:text-white group-data-[active=true]:text-primary"
              />
            </span>
            {item.label}
          </button>
        )
      })}

      {/*
        "문의하기"를 없애면서, 그 버튼이 쓰던 흰 틴트 알약 강조를 로그아웃으로 옮겼다 —
        로그아웃이 이제 사이드바 맨 아래 유일한 보조 버튼이라 눈에 띄어야 한다 (ref .logout).
      */}
      <button
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className="mt-2.5 flex min-h-11 w-[94px] items-center justify-center gap-[7px] whitespace-nowrap rounded-[14px] bg-white/[.16] p-[11px_9px] text-[.75rem] font-black text-white hover:bg-white/[.28] max-[640px]:hidden"
      >
        <Icon name="logout" className="h-[17px] w-[17px]" />
        로그아웃
      </button>
    </nav>
  )
}
