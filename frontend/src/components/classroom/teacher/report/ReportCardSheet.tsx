import { cn } from '@/lib/cn'
import type { Achievement, ReportCardData, RowOverride } from '@/lib/reportCard'
import { ACHIEVEMENT_CUTS, ACHIEVEMENT_OPTIONS, MIN_SAMPLE } from '@/lib/reportCard'

/**
 * 생활통지표 A4 한 장.
 *
 * **순수 표시 컴포넌트다** — 조회도 파생도 하지 않고 완성된 `ReportCardData` 만 그린다.
 * 그래서 한 명이든 반 전체든 같은 컴포넌트를 배열로 반복하면 된다.
 *
 * 치수는 전부 mm/pt 다. 화면에서도 인쇄물과 같은 크기로 보이고, `@page` 여백(10mm)을 뺀
 * 190mm 가 본문 폭이라 미리보기에서 줄이 넘치면 인쇄물에서도 넘친다 — 미리보기가 거짓말을
 * 하지 않는다. (px 로 짜면 화면에선 멀쩡한데 인쇄에서 표가 잘리는 일이 생긴다.)
 */

/* 표 선은 통지표의 뼈대다 - 한 곳에서만 정의해 셀마다 어긋나지 않게 한다 */
const CELL = 'border border-ink px-[1.5mm] py-[1mm] align-middle'
const HEAD = cn(CELL, 'bg-canvas text-center font-bold')
const DATA = cn(CELL, 'text-center')

/**
 * 화면에서 고칠 수 있는 칸의 공통 모양.
 *
 * 인쇄물에서는 `body.report-print .rc-field`(index.css)가 테두리·화살표·배경을 전부 걷어내
 * **그냥 글자로** 찍힌다. 그래서 미리보기에서 고친 그대로가 종이에 나온다 — 화면용과
 * 인쇄용을 따로 그리면(둘 다 렌더하고 하나를 숨기면) 값이 어긋날 자리가 생긴다.
 */
const FIELD =
  'rc-field w-full rounded-md border border-panel-line bg-canvas p-[2px_5px] font-[inherit] text-[inherit] leading-[inherit] text-ink outline-none transition-colors hover:border-ink-mute focus:border-primary focus:bg-white'

export function ReportCardSheet({
  data,
  onEditRow,
}: {
  data: ReportCardData
  /** 넘기면 교과평가의 평가요소·평가를 그 자리에서 고칠 수 있다 (인쇄물에는 글자로 나간다) */
  onEditRow?: (index: number, patch: RowOverride) => void
}) {
  const { name, grade, meta, attendance, rows } = data

  return (
    <article
      aria-label={`${name} 생활통지표`}
      className="report-sheet w-[190mm] shrink-0 bg-white p-0 font-sans text-[9.5pt] leading-[1.45] text-ink"
    >
      {/* ── 표제 ── */}
      <header className="relative mb-[6mm] text-center">
        <h1 className="text-[19pt] font-black tracking-[-0.5px]">생활통지표</h1>
        <p className="absolute bottom-0 right-0 text-[10pt] font-semibold">
          <span className="font-black">{meta.schoolYear}</span> 학년도{' '}
          <span className="font-black">{meta.term}</span> 학기
        </p>
      </header>

      {/* ── 기본학적사항 ── */}
      <SectionTitle>기본학적사항</SectionTitle>
      <table className="mb-[5mm] w-full border-collapse">
        <tbody>
          <tr>
            <th className={cn(HEAD, 'w-[13mm]')}>학년</th>
            <td className={cn(DATA, 'w-[13mm]')}>{grade}</td>
            <th className={cn(HEAD, 'w-[13mm]')}>반</th>
            <td className={cn(DATA, 'w-[13mm]')}>{meta.classNo}</td>
            <th className={cn(HEAD, 'w-[13mm]')}>번호</th>
            <td className={cn(DATA, 'w-[13mm]')}>{meta.seatNo}</td>
            <th className={cn(HEAD, 'w-[15mm]')}>성명</th>
            <td className={DATA}>{name}</td>
            <th className={cn(HEAD, 'w-[18mm]')}>담임명</th>
            <td className={cn(DATA, 'w-[30mm]')}>{meta.homeroomTeacher}</td>
          </tr>
        </tbody>
      </table>

      {/* ── 출결상황 ── */}
      <SectionTitle>출결상황</SectionTitle>
      <AttendanceTable tally={attendance} />

      {/* ── 교과평가 ── */}
      <SectionTitle>교과평가</SectionTitle>
      <EvalTable rows={rows} onEditRow={onEditRow} />

      {/* ── 쪽 바닥 ── */}
      <footer className="mt-[8mm] flex items-end justify-between text-[9pt]">
        <span className="font-semibold">{meta.schoolName}</span>
        <span className="font-semibold">1/1</span>
        <table className="border-collapse text-[9pt]">
          <tbody>
            <tr>
              <th className={cn(HEAD, 'w-[11mm]')}>반</th>
              <td className={cn(DATA, 'w-[11mm]')}>{meta.classNo}</td>
              <th className={cn(HEAD, 'w-[13mm]')}>번호</th>
              <td className={cn(DATA, 'w-[11mm]')}>{meta.seatNo}</td>
              <th className={cn(HEAD, 'w-[13mm]')}>성명</th>
              <td className={cn(DATA, 'w-[22mm]')}>{name}</td>
            </tr>
          </tbody>
        </table>
      </footer>
    </article>
  )
}

/** ref 원본의 파란 삼각 말머리 — 블록 제목 */
function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mb-[1.5mm] flex items-center gap-[1.5mm] text-[11pt] font-black">
      <span aria-hidden="true" className="text-[8pt] text-primary">
        ▶
      </span>
      {children}
    </h2>
  )
}

/**
 * 출결상황.
 *
 * **채워지는 칸은 수업일수와 결석일수의 '기타' 뿐이다.** 서버 출석 데이터에는 사유 코드가
 * 없어서 질병/미인정을 가를 수 없고, 지각·조퇴는 기준점(`startedAt` = 선생님이 시작 버튼을
 * 누른 시각)과 `leftAt` 의 신뢰도 때문에 셀 수 없다. 모르는 칸은 0 을 찍지 않고 **비워서**
 * 선생님이 직접 적게 한다 — 0 을 찍으면 "확인했고 없음"이라는 뜻이 돼 버린다.
 */
function AttendanceTable({ tally }: { tally: ReportCardData['attendance'] }) {
  const REASONS = ['질병', '미인정', '기타']

  return (
    <table className="mb-[5mm] w-full border-collapse">
      <thead>
        <tr>
          <th className={cn(HEAD, 'w-[18mm]')} rowSpan={2}>
            수업일수
          </th>
          {['결석일수', '지각', '조퇴', '결과'].map((label) => (
            <th key={label} className={HEAD} colSpan={3}>
              {label}
            </th>
          ))}
          <th className={cn(HEAD, 'w-[30mm]')} rowSpan={2}>
            특기사항
          </th>
        </tr>
        <tr>
          {['결석일수', '지각', '조퇴', '결과'].map((group) =>
            REASONS.map((reason) => (
              <th key={`${group}-${reason}`} className={cn(HEAD, 'w-[11mm] font-semibold')}>
                {reason}
              </th>
            )),
          )}
        </tr>
      </thead>
      <tbody>
        <tr className="h-[9mm]">
          <td className={DATA}>{tally.schoolDays}</td>
          {/* 결석: 사유를 모르므로 '기타' 한 칸에만 */}
          <td className={DATA} />
          <td className={DATA} />
          <td className={DATA}>{tally.absentDays || ''}</td>
          {/* 지각 · 조퇴 · 결과 — 판정 근거가 없어 비워 둔다 */}
          {Array.from({ length: 9 }, (_, i) => (
            <td key={i} className={DATA} />
          ))}
          <td className={DATA} />
        </tr>
      </tbody>
    </table>
  )
}

/**
 * 교과평가 — 교과(rowspan) > 영역(rowspan) > 평가요소 > 평가.
 * `withSpans()` 가 미리 계산한 span 이 0 이면 위 행에 병합된 것이므로 셀을 그리지 않는다.
 */
function EvalTable({
  rows,
  onEditRow,
}: {
  rows: ReportCardData['rows']
  onEditRow?: (index: number, patch: RowOverride) => void
}) {
  const graded = rows.filter((r) => r.achievement !== null).length
  const short = rows.length - graded

  if (rows.length === 0) {
    return (
      <table className="w-full border-collapse">
        <thead>
          <EvalHead />
        </thead>
        <tbody>
          <tr className="h-[16mm]">
            <td className={cn(DATA, 'text-ink-soft')} colSpan={4}>
              채점된 과제가 없어 표시할 교과평가가 없습니다.
            </td>
          </tr>
        </tbody>
      </table>
    )
  }

  return (
    <>
      <table className="w-full border-collapse">
        <thead>
          <EvalHead />
        </thead>
        <tbody>
          {rows.map((row, i) => (
            /*
              key 는 **순서**다. 예전엔 `${row.criterion}-${i}` 였는데, 평가요소를 고치는 순간
              key 가 바뀌어 React 가 이 줄을 통째로 새로 만들었다 — 한 글자 칠 때마다 입력칸이
              교체되면서 **포커스가 풀렸다.** 이 표는 편집 중에 재정렬·추가·삭제가 없으므로
              순서가 안정된 식별자다.
            */
            <tr key={i} className="h-[8mm]">
              {row.subjectSpan > 0 && (
                <td className={cn(DATA, 'font-bold')} rowSpan={row.subjectSpan}>
                  {row.subject}
                </td>
              )}
              {row.areaSpan > 0 && (
                <td className={DATA} rowSpan={row.areaSpan}>
                  {/*
                    영역도 고칠 수 있어야 한다. 서버 통지표 초안은 **영역을 비워서 준다**
                    (`Entry.area` 가 null — 교과별 문장만 LLM 이 쓰고 영역은 선생님 몫이다).
                    읽기 전용으로 두면 초안으로 만든 통지표의 영역 칸을 채울 길이 아예 없다.

                    병합된 칸이라 첫 줄에만 입력칸이 뜨고, 고친 값은 그 줄에만 붙는다 —
                    병합은 고치기 전 값으로 이미 계산돼 있어(`withSpans`) 타이핑 중에 표가
                    다시 묶이지는 않는다.
                  */}
                  {onEditRow ? (
                    <input
                      value={row.area}
                      onChange={(e) => onEditRow(i, { area: e.target.value })}
                      aria-label={`${row.subject} 영역`}
                      className={FIELD}
                    />
                  ) : (
                    row.area
                  )}
                </td>
              )}
              <td className={cn(CELL, 'text-left')}>
                {onEditRow ? (
                  <input
                    value={row.criterion}
                    onChange={(e) => onEditRow(i, { criterion: e.target.value })}
                    aria-label={`${row.area} 평가요소`}
                    className={FIELD}
                  />
                ) : (
                  row.criterion
                )}
              </td>
              <td className={DATA}>
                {onEditRow ? (
                  /*
                    빈 값('')이 '—'(매기지 않음)이다. 문항이 적어 자동으로 등급을 못 매긴 줄도
                    선생님이 직접 고를 수 있어야 한다 — 자료가 부족하다고 판단까지 못 하는 건 아니다.
                  */
                  <select
                    value={row.achievement ?? ''}
                    onChange={(e) =>
                      onEditRow(i, {
                        achievement: e.target.value === '' ? null : (e.target.value as Achievement),
                      })
                    }
                    aria-label={`${row.criterion} 평가`}
                    /* 화면에서는 **진짜 드롭다운**으로 둔다(화살표 포함) — 고를 수 있는 칸임이
                       한눈에 보인다. 인쇄에서는 print CSS 가 appearance 를 없애 글자만 남긴다. */
                    className={cn(FIELD, 'cursor-pointer text-center')}
                  >
                    <option value="">—</option>
                    {ACHIEVEMENT_OPTIONS.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  (row.achievement ?? '—')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        범례를 통지표에 남긴다. 이 표의 '평가'는 선생님의 종합 판단이 아니라 **온라인 과제의
        자동 채점 정답률**에서 나온 값이라, 근거를 안 밝히면 가정에서 성취도로 오해한다.
      */}
      <p className="mt-[2mm] text-[7.5pt] leading-[1.5] text-ink-soft">
        평가 기준(온라인 과제 자동 채점 정답률):{' '}
        {ACHIEVEMENT_CUTS.map((cut) => `${cut.label} ${cut.min}% 이상`).join(' · ')}
        {short > 0 && ` / 문항이 ${MIN_SAMPLE}개 미만인 ${short}개 항목은 '—' 로 두었습니다.`}
      </p>
    </>
  )
}

function EvalHead() {
  return (
    <tr>
      <th className={cn(HEAD, 'w-[20mm]')}>교과(목)</th>
      <th className={cn(HEAD, 'w-[24mm]')}>영역</th>
      <th className={HEAD}>평가요소</th>
      <th className={cn(HEAD, 'w-[22mm]')}>평가</th>
    </tr>
  )
}
