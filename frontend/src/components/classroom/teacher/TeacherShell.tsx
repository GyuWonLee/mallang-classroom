import type { ReactNode } from 'react'
import { TeacherTopBar } from '@/components/classroom/teacher/TeacherTopBar'
import { TeacherSidebar, type TeacherNavKey } from '@/components/classroom/teacher/TeacherSidebar'
import { TEACHER_CONTENT_ID } from '@/lib/teacherLayout'

interface TeacherShellProps {
  /** 지금 화면에 해당하는 사이드바 메뉴. 생략하면 아무 곳에도 불이 들어오지 않는다 */
  active?: TeacherNavKey
  /** 현재 보고 있는 학급 — 있으면 사이드바가 학급 안 화면으로 바로 보낸다 */
  classroomId?: string
  /**
   * 상단 헤더(로고·내 프로필)를 얹을지. **내 학급·학급 선택 두 화면만 켠다** (ref `TOPBAR_VIEWS`).
   * 나머지 화면은 자기 배너(학생 관리 `.sm-hero`, 과제 관리 `.ag-frame` 등)를 이미 갖고 있어
   * 여기서 또 얹으면 헤더가 두 번 나온 것처럼 보인다.
   */
  topBar?: boolean
  children: ReactNode
}

/**
 * 선생님 화면 공용 셸 — 딥블루 사이드바 + 콘텐츠 영역 (ref `.app` / `.sidebar` / `.content`).
 *
 * **스크롤은 콘텐츠만 한다.** ref 는 `html`/`body` 를 뷰포트 높이에 고정하고 `.content` 에만
 * `overflow-y:auto` 를 줘서, 사이드바가 스크롤과 무관하게 화면 안에 늘 그대로 있게 바꿨다.
 * 우리는 같은 `index.css` 를 학생 수업 화면·로그인 화면과 공유하므로 전역 `body{overflow:hidden}`
 * 대신 이 셸에서 잡는다 — 셸이 뷰포트 높이를 전부 쓰고 넘치는 부분은 콘텐츠 안에서만 스크롤되니
 * 페이지 자체는 애초에 넘칠 게 없어, 보이는 결과는 ref 와 같다.
 *
 * 640px 이하에서는 세로로 쌓고 페이지 스크롤로 되돌린다 — 이 폭에서 사이드바는 화면 아래
 * 가로 바로 바뀌기 때문에(ref 미디어쿼리) 높이를 뷰포트에 묶어 둘 이유가 없다.
 *
 * 이 셸이 레이아웃 줄(`.app`)의 **단일 주인**이다. 예전엔 같은 클래스 문자열이 페이지 6곳에
 * 복제돼 있어서, 스크롤 규칙 하나를 고치려면 6곳을 똑같이 고쳐야 했고 한 곳만 빠지면 그
 * 화면만 스크롤이 다르게 동작했다.
 */
export function TeacherShell({ active, classroomId, topBar, children }: TeacherShellProps) {
  return (
    /*
      `teacher-shell` 은 스타일이 아니라 **표식**이다 — index.css 가 `body:has(.teacher-shell)`
      로 창 스크롤을 잠근다. 셸이 화면 높이를 다 쓰므로 문서가 1px 이라도 넘치면 창에 두 번째
      스크롤바가 생기는데(안쪽 콘텐츠 칸과 겹쳐 보인다), 그걸 구조로 막는다.
    */
    <div className="teacher-shell mx-auto flex h-[100dvh] max-w-[1720px] items-stretch gap-7 overflow-hidden p-[24px_28px] max-[1120px]:max-w-[900px] max-[640px]:h-auto max-[640px]:flex-col max-[640px]:overflow-visible max-[640px]:p-[24px_16px]">
      <TeacherSidebar active={active} classroomId={classroomId} />

      <div
        id={TEACHER_CONTENT_ID}
        /* scrollbar-gutter 는 **실제로 스크롤하는 이 칸**에만 준다 — 예전엔 <html> 에 있어서
           페이지가 스크롤될 수 없는 화면에도 빈 스크롤바 자리가 늘 보였다 */
        className="h-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] max-[640px]:h-auto max-[640px]:overflow-visible"
      >
        {topBar && <TeacherTopBar />}
        {children}
      </div>
    </div>
  )
}
