import { useEffect, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import {
  analyticsApi,
  BAND_LABEL,
  type Band,
  type ClassHeatmap,
  type HeatmapCell,
} from '@/services/api/analyticsApi'

/**
 * 밴드별 셀 스타일 — 색 + **글자**로 함께 알린다(색만으로 상태를 구분하지 않는다).
 * 정답률 숫자가 이미 셀에 있으므로 색은 스캔을 돕는 보조 신호다.
 */
const BAND_CLS: Record<Band, string> = {
  GOOD: 'bg-success text-success-deep',
  WARN: 'bg-task-soft text-task-deep',
  RISK: 'bg-danger-soft text-danger',
  // 표본 부족은 "나쁨"이 아니라 "모름" — 회색으로 중립을 지킨다
  INSUFFICIENT: 'bg-locked text-ink-mute',
}

/** 셀 하나 — 미응시(accuracy null)와 0% 를 반드시 다르게 그린다 */
function Cell({ cell }: { cell: HeatmapCell }) {
  const unseen = cell.accuracy === null
  return (
    <td className="p-1">
      <div
        className={`flex min-h-[46px] flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 ${BAND_CLS[cell.band]}`}
        /* 마우스 없이도 읽히도록 셀 안에 표본 수를 함께 적는다 */
        title={`${cell.tag} · ${unseen ? '아직 안 풀었어요' : `${cell.accuracy}%`} · 문항 ${cell.n}개 · ${BAND_LABEL[cell.band]}`}
      >
        {/* 안 푼 칸은 숫자를 쓰지 않는다 — 0% 로 오해하면 판단이 거꾸로 간다 */}
        <span className="text-[.92rem] font-black leading-none">
          {unseen ? '–' : `${cell.accuracy}%`}
        </span>
        <span className="text-[.68rem] font-bold leading-none opacity-80">
          {unseen ? '미응시' : `${cell.n}문항`}
        </span>
      </div>
    </td>
  )
}

/**
 * 학급 이해도 히트맵 — GET /classrooms/{id}/understanding (백엔드 S15P11A407-127).
 *
 * "수업 전 30초 만에 오늘 누굴 챙길지" 고르는 화면이다. 그래서 **한 명당 한 점수를 만들지 않는다** —
 * 태그별로 흩어진 값을 그대로 보여주고 판단은 선생님이 한다(명세 §8 팀 확정, 서열화 방지).
 *
 * 태그별 반평균을 맨 윗줄에 함께 둔다. 25% 라는 숫자만으로는 그 아이가 약한 건지
 * 반 전체가 아직 안 배운 건지 알 수 없다 — 반평균이 그 둘을 가른다.
 */
export function ClassHeatmapCard({ classroomId }: { classroomId: string }) {
  const [data, setData] = useState<ClassHeatmap | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!classroomId) return
    let cancelled = false
    setLoading(true)
    setError(false)
    void analyticsApi
      .getClassHeatmap(classroomId)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        // 실패를 빈 표로 위장하지 않는다 — 자료가 없는 것과 못 불러온 것은 다르다
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [classroomId])

  const empty = !!data && (data.tags.length === 0 || data.students.length === 0)

  return (
    <div className="rounded-card bg-card p-[22px_24px] shadow-card">
      <h2 className="flex items-center gap-2 text-[1.05rem] font-black">
        <Icon name="chart" className="h-[22px] w-[22px] flex-none text-primary" />
        개념별 이해도
      </h2>
      {/* <p className="mt-1 text-[.85rem] font-medium text-ink-soft">
        학생마다 어떤 개념이 약한지 한눈에 봐요.
        <br />
        반평균과 비교하면 우리 반이 함께 어려워하는 개념도 찾을 수 있어요.
      </p> */}

      {loading && <EmptyState title="불러오는 중..." />}

      {error && (
        <EmptyState
          icon="alert"
          title="이해도를 불러오지 못했어요"
          hint="잠시 후 다시 열어주세요."
        />
      )}

      {!loading && !error && empty && (
        <EmptyState
          icon="checklist"
          title="아직 채점된 과제가 없어요"
          hint="과제를 내고 학생이 풀면 여기에 쌓여요."
        />
      )}

      {!loading && !error && data && !empty && (
        <>
          {/* 표가 넓어지면 표만 좌우로 스크롤한다 — 페이지가 흔들리지 않게 */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-center">
              <thead>
                <tr>
                  <th className="sticky left-0 z-[1] bg-card p-[6px_10px] text-left text-[.82rem] font-black text-ink-soft">
                    학생
                  </th>
                  {data.tags.map((tag) => (
                    <th
                      key={tag}
                      className="min-w-[86px] p-[6px_4px] text-[.82rem] font-black text-ink-soft"
                    >
                      {tag}
                    </th>
                  ))}
                </tr>
                {/* 반평균 줄 — 개인 값을 읽을 기준선이라 학생들 위에 고정해 둔다 */}
                <tr>
                  <th className="sticky left-0 z-[1] bg-card p-[6px_10px] text-left text-[.8rem] font-black text-primary">
                    반평균
                  </th>
                  {data.classAverages.map((avg) => (
                    <td key={avg.tag} className="p-1">
                      <div className="flex min-h-[38px] flex-col items-center justify-center rounded-xl bg-band px-2 py-1">
                        <span className="text-[.85rem] font-black leading-none text-primary">
                          {avg.accuracy === null ? '–' : `${avg.accuracy}%`}
                        </span>
                        <span className="text-[.66rem] font-bold leading-none text-ink-soft">
                          {avg.n}문항
                        </span>
                      </div>
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.students.map((row) => (
                  <tr key={row.studentId}>
                    <th
                      scope="row"
                      className="sticky left-0 z-[1] whitespace-nowrap bg-card p-[6px_10px] text-left text-[.9rem] font-bold"
                    >
                      {row.name}
                      {row.grade !== null && (
                        <span className="ml-1.5 text-[.76rem] font-bold text-ink-mute">
                          {row.grade}학년
                        </span>
                      )}
                    </th>
                    {row.cells.map((cell) => (
                      <Cell key={`${row.studentId}-${cell.tag}`} cell={cell} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 범례 — 색의 뜻을 글자로 남긴다 */}
          <ul className="mt-3.5 flex flex-wrap gap-2">
            {(Object.keys(BAND_LABEL) as Band[]).map((band) => (
              <li
                key={band}
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-[.76rem] font-extrabold ${BAND_CLS[band]}`}
              >
                {BAND_LABEL[band]}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[.78rem] font-medium text-ink-mute">
            문항이 3개 미만이면 &lsquo;자료 부족&rsquo;으로 둬요.
            
            &lsquo;미응시&rsquo;는 그 개념 문제를 아직 안 풀었다는 뜻이에요.
          </p>
        </>
      )}
    </div>
  )
}
