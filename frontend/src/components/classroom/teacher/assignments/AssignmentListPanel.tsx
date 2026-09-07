import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { SubmitRing } from './SubmitRing'
import { assignmentTheme } from './assignmentTheme'
import { submitRate } from '@/hooks/useAssignmentStats'
import { assignmentDateChip } from '@/lib/assignmentDate'
import type { AssignmentSubmissions } from '@/services/api/analyticsApi'
import type { AssignmentSummary } from '@/types/assignment'

/**
 * 한 페이지에 두는 과제 카드 수.
 *
 * 이 값이 **오른쪽 상세 패널의 높이를 정한다** — 두 열이 같은 높이로 서므로(.ag-body 가
 * stretch), 목록이 길면 상세 아래에 빈 공간이 그만큼 남는다. 4개면 남는 공간이 컸다.
 */
const PAGE_SIZE = 3

/**
 * 카드 영역이 늘 잡아 두는 높이 — 카드 3장(131px) + 사이 간격 2개(12px).
 *
 * 마지막 페이지에 1~2장만 남아도 패널이 쪼그라들지 않게 자리를 비워 둔다. 안 그러면 페이지를
 * 넘길 때마다 왼쪽 패널 높이가 바뀌고, 거기 맞춰 오른쪽 상세까지 같이 출렁인다.
 */
const CARDS_MIN_H = 417

type SortKey = 'recent' | 'rate'

/**
 * 과제 목록 패널 — 레퍼런스 teacher.html `.ag-list-panel`.
 *
 * 세로 flex 기둥이라 카드 영역이 남는 높이를 먹고 **페이저가 항상 바닥에 붙는다** —
 * 오른쪽 상세 패널과 바닥이 나란히 정렬된다.
 *
 * 맨 위 학년 탭은 ref `.sm-tabs` 와 같은 장치다. 다만 과제 자체에는 학년 필드가 없어서
 * (`Assignment` 는 학급 단위다) **대상 학생 명단으로 역산한다** — `assignmentGrades` 참고.
 */
export function AssignmentListPanel({
  items,
  stats,
  grades,
  grade,
  onGradeChange,
  gradesOf,
  selectedId,
  onSelect,
}: {
  items: AssignmentSummary[]
  stats: Record<number, AssignmentSubmissions>
  /** 학급의 학년 구성 (오름차순). 하나뿐이면 탭 하나가 폭을 꽉 채운다 */
  grades: number[]
  grade: number | null
  onGradeChange: (grade: number) => void
  /** 과제가 대상으로 삼는 학년들. 알 수 없으면 빈 배열 — 그때는 어느 탭에서도 숨기지 않는다 */
  gradesOf: (assignmentId: number) => number[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const [sortBy, setSortBy] = useState<SortKey>('recent')
  const [page, setPage] = useState(1)

  const sorted = useMemo(() => {
    /*
      고른 학년의 과제만 남긴다. 대상 학년을 알 수 없는 과제(아직 미공개라 제출 현황이 없는 것)는
      **거르지 않는다** — 방금 만든 과제가 목록에서 사라지면 만든 사람이 잃어버린다.
    */
    const out = items.filter((a) => {
      if (grade === null) return true
      const gs = gradesOf(a.id)
      return gs.length === 0 || gs.includes(grade)
    })
    if (sortBy === 'rate') {
      // 제출률을 아직 못 받은 과제는 -1 로 취급해 뒤로 보낸다
      out.sort((a, b) => (submitRate(stats[b.id]) ?? -1) - (submitRate(stats[a.id]) ?? -1))
    } else {
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }
    return out
  }, [items, sortBy, stats, grade, gradesOf])

  /*
    고른 과제가 지금 탭에 없으면 첫 과제로 옮긴다 — 안 그러면 왼쪽 목록엔 없는 과제가
    오른쪽 상세에 떠 있어 둘이 어긋난다. 학년 필터·정렬을 아는 쪽은 이 패널뿐이라
    여기서 고른다 (학생 관리 목록 패널과 같은 방식).
  */
  const top = sorted[0]
  useEffect(() => {
    if (!top) return
    if (selectedId === null || !sorted.some((a) => a.id === selectedId)) onSelect(top.id)
  }, [sorted, selectedId, top, onSelect])

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const shown = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  return (
    <aside
      aria-label="과제 목록"
      className="flex flex-col rounded-card border-[1.5px] border-frame bg-card p-[20px_18px] shadow-card"
    >
      {/*
        학년 탭 — ref `.ag-list-panel .sm-tabs`. `flex-1` 이라 학년 수만큼 균등 분할된다.
        **학년이 하나면 그 탭 하나가 폭을 꽉 채우고 글자가 가운데 온다** (flex-1 + text-center).
        학급에 학년 정보가 아예 없으면 줄 자체를 그리지 않는다 — 빈 테두리만 남기지 않는다.
      */}
      {grades.length > 0 && (
        <div
          role="tablist"
          aria-label="학년 선택"
          className="-mt-1 mb-3.5 flex items-stretch border-b-2 border-track"
        >
          {grades.map((g) => {
            const on = g === grade
            return (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  onGradeChange(g)
                  setPage(1)
                }}
                data-on={on}
                className="relative flex-1 p-[12px_6px_11px] text-center text-[.94rem] font-black text-ink-mute transition-colors hover:text-ink-soft data-[on=true]:text-primary data-[on=true]:after:absolute data-[on=true]:after:inset-x-0 data-[on=true]:after:-bottom-0.5 data-[on=true]:after:h-[3px] data-[on=true]:after:rounded-full data-[on=true]:after:bg-primary"
              >
                {g}학년
              </button>
            )
          })}
        </div>
      )}

      {/* ref .ag-list-head — 제목 + 개수 배지 + 오른쪽 끝 정렬 버튼 */}
      <div className="mb-3.5 flex items-center gap-2">
        <h2 className="text-[1.06rem] font-black">내가 만든 과제</h2>
        <span className="rounded-full bg-sky p-[3px_10px] text-[.76rem] font-black text-primary">
          {/* 지금 탭에 보이는 개수 — 목록과 숫자가 어긋나면 어느 쪽이 맞는지 알 수 없다 */}
          {sorted.length}개
        </span>
        {/*
          정렬은 셀렉트 대신 아이콘 하나 — 340px 패널에서 셀렉트가 한 줄을 다 먹었다.
          누를 때마다 최신순 ⇄ 제출률순으로 넘어가고, 지금 기준은 title 로 알려 준다.
        */}
        <button
          type="button"
          onClick={() => {
            setSortBy((v) => (v === 'recent' ? 'rate' : 'recent'))
            setPage(1)
          }}
          title={sortBy === 'recent' ? '최신순 (눌러서 제출률순)' : '제출률순 (눌러서 최신순)'}
          aria-label="정렬 순서 바꾸기"
          data-on={sortBy === 'rate'}
          className="ml-auto grid h-8 w-8 place-items-center rounded-[10px] text-ink-mute transition-colors hover:bg-sky hover:text-primary data-[on=true]:bg-sky data-[on=true]:text-primary"
        >
          <Icon name="filter" className="h-[17px] w-[17px]" />
        </button>
      </div>

      {/*
        ref .ag-cards — flex:1 로 남는 높이를 먹어 페이저를 바닥에 붙인다.
        `min-h` 로 카드 3장 자리를 늘 잡아 둬서 페이지를 넘겨도 패널 높이가 그대로다.
      */}
      <div className="flex max-w-[520px] flex-1 flex-col gap-3" style={{ minHeight: CARDS_MIN_H }}>
        {shown.length === 0 ? (
          /*
            학년 탭은 **과제가 0개여도 남아 있다**(담당 학년이 학급의 성질이므로). 그래서
            "만든 과제가 하나도 없다"와 "이 학년 것만 없다"를 구분해 적는다 — 다른 학년에
            과제가 5개 있는데 '아직 만든 과제가 없어요'가 뜨면 목록이 고장 난 것처럼 보인다.
          */
          <EmptyState
            icon="doc"
            title={
              items.length > 0 && grade !== null
                ? `${grade}학년에 준 과제가 없어요`
                : '아직 만든 과제가 없어요'
            }
            hint="위 “새 과제 만들기”로 첫 과제를 만들어 보세요."
            className="min-h-[220px]"
          />
        ) : (
          shown.map((a) => {
            const th = assignmentTheme(a.subject)
            const on = a.id === selectedId
            const rate = submitRate(stats[a.id])
            const chip = assignmentDateChip(a)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(a.id)}
                aria-current={on ? 'true' : undefined}
                data-on={on}
                style={
                  on
                    ? {
                        borderColor: th.ink,
                        boxShadow: `0 0 0 3px color-mix(in srgb, ${th.ink} 16%, transparent)`,
                      }
                    : undefined
                }
                className="flex items-center gap-3 rounded-tile border-[1.5px] border-track bg-card p-[14px_16px] text-left transition-[border-color,box-shadow,transform] duration-200 ease-bounce hover:-translate-y-0.5 hover:shadow-card"
              >
                {/* ref .ag-card-art — 제목 왼쪽 아바타 자리, 크기 고정 */}
                <img
                  src={th.art}
                  alt=""
                  aria-hidden="true"
                  /* th.art 는 subjectImage() — 5장 모두 424x386 (assignmentTheme.ts) */
                  width={424}
                  height={386}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-[54px] flex-none object-contain"
                />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                  {/* ref .subj-pill — 테마색으로 채운다 */}
                  <span
                    style={{ background: th.ink }}
                    className="inline-flex items-center rounded-full p-[4px_11px] text-[.74rem] font-black text-white"
                  >
                    {th.label}
                  </span>
                  {/*
                    제목 칸을 **두 줄분으로 못박는다**(2.7em = 1.35 × 2).

                    과제 이름은 "1학년 국어 듣기·말하기 학습자료 기반 문항"처럼 길어서 세 줄까지
                    번지는데, 카드 높이가 이름 길이에 따라 달라지면 목록이 들쭉날쭉해진다.
                    한 줄짜리 이름도 두 줄 자리를 잡아 두면 모든 카드가 같은 높이가 된다 —
                    이 칸이 카드 높이를 정하는 유일한 변수라 여기만 고정하면 카드가 더 커지지 않는다.

                    두 줄을 넘으면 `line-clamp` 가 끝을 `…` 로 잘라 낸다. 잘린 전체 이름은
                    카드를 눌러 들어가면 오른쪽 상세 제목에 그대로 다 나오고, 마우스를 올리면
                    `title` 툴팁으로도 읽을 수 있다.
                  */}
                  {/*
                    바깥 칸이 두 줄 높이를 잡고, 안쪽 글이 그 안에서 **세로 가운데**에 온다.
                    높이를 글 자체에 주면(`line-clamp` 은 `-webkit-box` 레이아웃이라) 한 줄짜리
                    이름이 칸 위쪽에 붙어 두 줄짜리와 나란히 놨을 때 글줄이 어긋나 보였다.
                  */}
                  <span className="flex h-[2.7em] w-full items-center">
                    <span
                      title={a.title}
                      className="line-clamp-2 w-full break-keep text-[1rem] font-black leading-[1.35]"
                    >
                      {a.title}
                    </span>
                  </span>
                  <span className="text-[.78rem] font-semibold text-ink-mute">
                    {a.published ? (chip ?? '공개') : '비공개'}
                  </span>
                </span>
                <SubmitRing pct={rate} />
              </button>
            )
          })
        )}
      </div>

      {/* ref #agPager — 카드가 위를 채우므로 이 바는 항상 패널 바닥에 붙는다 */}
      {pages > 1 && (
        <div className="mt-auto flex max-w-[520px] items-center justify-center gap-1.5 pt-4">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              aria-current={p === current ? 'page' : undefined}
              data-on={p === current}
              className="grid h-8 min-w-8 place-items-center rounded-[10px] px-2 text-[.85rem] font-black text-ink-soft transition-colors hover:bg-sky hover:text-primary data-[on=true]:bg-primary data-[on=true]:text-white"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
