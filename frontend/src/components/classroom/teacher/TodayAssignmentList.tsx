import { useState } from 'react'
import { EmptyState } from '@/components/common/EmptyState'
import { Icon } from '@/components/common/Icon'
import { Paginator } from '@/components/common/Paginator'
import { assignmentTheme } from '@/components/classroom/teacher/assignments/assignmentTheme'
import { assignmentDateChip } from '@/lib/assignmentDate'
import { pageSlice } from '@/lib/paginate'
import { GRADE_PALETTE, gradeLabelOf } from '@/lib/subject'
import { TODAY_LIST_H, TODAY_PAGE_SIZE, TODAY_PAGER_H } from '@/lib/teacherLayout'
import { assignmentApi } from '@/services/api/assignmentApi'
import { useOpenModal } from '@/stores/useModalStore'
import { useToastStore } from '@/stores/useToastStore'
import type { AssignmentSummary } from '@/types/assignment'

interface TodayAssignmentListProps {
  /** 이미 학년 필터가 걸린 목록 */
  assignments: AssignmentSummary[]
  /**
   * 이 과제의 **대상 학년들** — 알약 색과 라벨의 원천. 판정은 페이지가 한다(제출 현황 + 명단).
   * 한 과제가 두 학년 대상일 수 있어 배열이고, 알 수 없으면 빈 배열이다.
   */
  gradesOf: (a: AssignmentSummary) => number[]
}

/**
 * 학급 화면 '활동지' 카드의 목록 — 한 페이지 {@link TODAY_PAGE_SIZE} 개씩.
 *
 * 예전엔 `.slice(0, 5)` 로 앞 5개만 그리고 **나머지를 말없이 버렸다.** 6번째 과제는 이 화면에
 * 존재하지 않는 것과 같았다. 이제 같은 5줄 자리를 유지한 채 페이지로 넘긴다.
 *
 * 줄 목록 칸은 높이가 {@link TODAY_LIST_H} 로 **고정**이다 — 과제가 1개든 5개든 카드가
 * 같은 크기다. 활동 탭도 같은 값을 써서 탭을 오갈 때 카드가 흔들리지 않는다.
 */
export function TodayAssignmentList({ assignments, gradesOf }: TodayAssignmentListProps) {
  const [page, setPage] = useState(0)
  const { pageCount, current, items } = pageSlice(assignments, page, TODAY_PAGE_SIZE)
  const openModal = useOpenModal()
  const showToast = useToastStore((s) => s.show)

  /*
    줄을 누르면 문항을 본다 — 예전엔 줄이 그냥 `div` 라 **눌러도 아무 일도 없었다.**
    목록 응답(`AssignmentSummary`)에는 `content` 가 없어서 문항을 그릴 수 없으므로,
    누른 순간 전체 과제를 받아 온다 (과제 관리의 '문항 열기'와 같은 길이다).
    목록 새로고침은 화면(TeacherClassDetailPage)이 모달 스택이 비는 것을 보고 이미 한다.
  */
  async function openDetail(assignmentId: number) {
    try {
      const assignment = await assignmentApi.getAssignment(assignmentId)
      openModal({ type: 'assignmentDetail', assignment })
    } catch {
      showToast('과제를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <>
      {/* 고정 높이 + 페이지 넘김만 — 목록이 길어져도 카드가 늘어나지 않게 한다 */}
      <div style={{ height: TODAY_LIST_H }}>
        {items.length === 0 ? (
          /*
            빈 상태는 옆 메시지 패널과 같은 공통 컴포넌트(EmptyState)로 — 목록 칸(290px) 한가운데에
            아이콘·제목·다음 할 일이 온다. 예전엔 작은 글씨 한 줄이 좌상단에 붙어 있어서,
            바로 옆 패널의 빈 상태와 같은 화면인데 서로 다르게 생겼었다.
          */
          <EmptyState
            icon="book"
            title="아직 만든 과제가 없어요"
            hint="위 ‘새 과제 만들기’를 누르면 여기에 바로 나와요."
            className="min-h-0"
          />
        ) : (
          items.map((a) => {
            const grades = gradesOf(a)
            /* 색은 **한 학년일 때만** 그 학년 팔레트다 — 두 학년 대상이면 색이 한쪽을 가리켜
               오해를 만든다(중립색). 학년을 모를 때도 중립. */
            const pal = grades.length === 1 ? GRADE_PALETTE[grades[0]] : null
            /*
              배지는 **학년과 과목을 함께** 적는다 — `6학년 · 국어`, 두 학년이면 `5·6학년 · 국어`.

              예전엔 둘 중 하나만 나왔다(학년을 알면 학년, 모르면 과목). 그래서 한 목록 안에서
              어떤 줄은 `6학년`, 어떤 줄은 `국어` 로 **서로 다른 것을 말하는 배지**가 섞여
              보였다 — 같은 자리의 값은 같은 종류여야 읽힌다.
              알약을 둘로 쪼개지 않은 이유: 줄 왼쪽이 넓어져 제목이 밀리고, 색(학년 팔레트)이
              어느 알약에 걸린 것인지 모호해진다.

              모르는 값은 지어내지 않는다: 학년만 알면 `6학년`, 과목만 알면 `국어`,
              둘 다 모르면 `전체`(사전 기본값 국어로 메우면 수학 과제가 국어로 보인다).
            */
            const subject = a.subject ? assignmentTheme(a.subject).label : null
            const tag =
              [grades.length > 0 ? gradeLabelOf(grades) : null, subject]
                .filter(Boolean)
                .join(' · ') || '전체'
            // 마감이 아니라 **언제 나갔는지**를 말한다 (lib/assignmentDate)
            const when = assignmentDateChip(a)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => void openDetail(a.id)}
                aria-label={`${a.title} 문항 보기`}
                /* 줄 전체가 과녁이다. 안쪽 여백을 음수 마진으로 되돌려 눌리는 폭만 넓히고
                   글자 위치는 예전 div 와 같게 둔다 (ref 의 줄 간격이 흐트러지지 않게). */
                className="-mx-2 flex w-[calc(100%+1rem)] flex-wrap items-center gap-3 rounded-2xl border-b border-[#F1EDE0] px-2 py-3.5 text-left transition-colors last:border-b-0 hover:bg-canvas"
              >
                <span
                  style={
                    pal
                      ? { background: pal.pill, color: pal.pillText }
                      : { background: '#EBEBED', color: '#6B6B72' }
                  }
                  className="flex-none whitespace-nowrap rounded-full px-[11px] py-[5px] text-[.72rem] font-black"
                >
                  {/* 과목 이름은 `assignmentTheme` 이 갖고 있다 — 서버는 enum(`KOREAN`)을 준다 */}
                  {tag}
                </span>
                <span className="min-w-[100px] flex-1 text-[.9rem] font-extrabold">{a.title}</span>
                {when && (
                  <span className="flex flex-none items-center gap-[5px] whitespace-nowrap rounded-full bg-canvas px-3 py-[5px] text-[.78rem] font-semibold text-ink-soft">
                    <Icon name="calendar" className="h-[13px] w-[13px] flex-none" />
                    {when}
                  </span>
                )}
                <span
                  data-published={a.published}
                  className="w-[96px] flex-none whitespace-nowrap rounded-full px-3 py-[5px] text-center text-[.78rem] font-black data-[published=false]:bg-[#EBEBED] data-[published=false]:text-[#6B6B72] data-[published=true]:bg-success data-[published=true]:text-success-deep"
                >
                  {a.published ? '공개' : '비공개'}
                </span>
              </button>
            )
          })
        )}
      </div>

      {/* 버튼이 없을 때도 자리를 비워 둔다 — 5개일 때와 6개일 때 카드 높이가 같아야 한다 */}
      <div style={{ height: TODAY_PAGER_H }} className="flex-none">
        <Paginator page={current} pageCount={pageCount} onChange={setPage} label="과제 목록" />
      </div>
    </>
  )
}
