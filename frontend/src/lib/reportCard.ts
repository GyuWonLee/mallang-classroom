import { SUBJECT_CODES, SUBJECT_LABEL, subjectLabel } from '@/lib/subject'
import type { AttendanceSummary } from '@/types/session'
import type { Subject } from '@/types/assignment'
import type { ReportCardEntry } from '@/types/reportCard'
import type { TagStat } from '@/services/api/reportApi'

/**
 * 생활통지표(성적통지표)를 그리기 위한 **파생 규칙 한 곳**.
 *
 * 여기 있는 것은 **서버가 주는 값에서 계산한 표시 규칙**이고, 규칙이 바뀌면 이 파일만
 * 고치면 된다. React 의존성 없음(services/ 와 같은 규칙).
 *
 * 서버에 통지표 엔티티가 생겼다(S15P11A407-145) — 확정된 통지표는 이제 서버가 갖는다
 * (`services/api/reportCardApi.ts`). 그래서 이 파일의 역할이 둘로 갈린다:
 *  1. **초안 계산** — 저장된 통지표가 없을 때 자동 채점 결과로 표를 만든다(`buildEvalRows`).
 *  2. **모양 옮기기** — 서버 `Entry` 와 화면 `EvalRow` 사이를 오간다(`entriesToRows`·`rowsToEntries`).
 * 성취기준 테이블은 여전히 서버에 없어서 `TAG_META` 고정 사전이 남아 있다.
 *
 * 지어내지 않는 것:
 * - 결석 **사유**(질병/미인정): 서버에 사유 코드가 없다 -> 통지표에서도 비운다.
 * - **지각/조퇴**: `startedAt` 은 선생님이 시작 버튼을 누른 시각이라 지각의 기준점이 못 되고,
 *   `leftAt` 은 LiveKit 웹훅이 안 오면 null 이라 조퇴를 셀 수 없다 -> 비운다.
 * - **태그만 보고는 알 수 없는 교과**: 아래 `UNKNOWN_SUBJECT` 주석 참고.
 */

/* ────────────────────────── 성취수준 ────────────────────────── */

export type Achievement = '매우잘함' | '잘함' | '보통' | '노력요함'

/**
 * 4단계 성취수준 경계(정답률 %). 학교마다 다를 수 있어 한 곳에 모아 둔다.
 * 위에서부터 처음 만족하는 칸을 쓴다.
 */
export const ACHIEVEMENT_CUTS = [
  { min: 90, label: '매우잘함' },
  { min: 75, label: '잘함' },
  { min: 60, label: '보통' },
  { min: 0, label: '노력요함' },
] as const satisfies readonly { min: number; label: Achievement }[]

/**
 * 등급을 매기기 위한 최소 문항 수.
 * 학급 히트맵(`analyticsApi` 의 MIN_SAMPLE)과 같은 기준을 쓴다 — 두 화면이 같은 학생을
 * 두고 "자료 부족"과 "노력요함"으로 엇갈리면 선생님이 어느 쪽을 믿을지 알 수 없다.
 */
export const MIN_SAMPLE = 3

/** 드롭다운에 나오는 순서 — 높은 것부터 */
export const ACHIEVEMENT_OPTIONS: readonly Achievement[] = ACHIEVEMENT_CUTS.map((c) => c.label)

/**
 * 선생님이 손으로 고친 값. 통지표는 자동 채점 결과를 **초안**으로 깔아 주는 것이고,
 * 최종 판단은 선생님이 한다 — 정답률이 곧 성취수준은 아니다(수업 중 관찰, 과제 밖 활동 등).
 *
 * 고친 값은 **[저장] 을 눌렀을 때 서버로 간다**(`reportCardApi.save`). 누르지 않고 창을 닫으면
 * 인쇄물에만 반영되고 사라진다 — 예전에는 저장할 곳이 아예 없어 늘 그랬다.
 */
export interface RowOverride {
  /** 영역 — 서버 초안은 이 칸을 비워 주므로(`Entry.area` null) 선생님이 채운다 */
  area?: string
  criterion?: string
  /** null 이면 '—'(매기지 않음) */
  achievement?: Achievement | null
}

export function achievementOf(accuracy: number): Achievement {
  for (const cut of ACHIEVEMENT_CUTS) {
    if (accuracy >= cut.min) return cut.label
  }
  return '노력요함'
}

/* ────────────────────────── 학기 ────────────────────────── */

export type Term = 1 | 2

export interface TermRange {
  /** 포함 */
  from: string
  /** 미포함 */
  to: string
}

/**
 * 학기의 날짜 범위. 'YYYY-MM-DD' 문자열끼리 비교한다 — 이 형식은 **사전순 == 시간순**이라
 * `new Date()` 로 파싱할 필요가 없다(파싱하면 브라우저 표준시에 따라 하루씩 밀린다).
 */
export function termRange(schoolYear: number, term: Term): TermRange {
  return term === 1
    ? { from: `${schoolYear}-03-01`, to: `${schoolYear}-09-01` }
    : { from: `${schoolYear}-09-01`, to: `${schoolYear + 1}-03-01` }
}

/** 오늘 날짜가 속한 학년도/학기 (3월 시작 기준) */
export function currentTerm(today = new Date()): { schoolYear: number; term: Term } {
  const year = today.getFullYear()
  const month = today.getMonth() + 1
  if (month <= 2) return { schoolYear: year - 1, term: 2 }
  if (month <= 8) return { schoolYear: year, term: 1 }
  return { schoolYear: year, term: 2 }
}

/* ────────────────────────── 출결 ────────────────────────── */

export interface AttendanceTally {
  /** 수업일수 — 화상수업이 **있었던 날짜**의 수 (하루에 여러 번 해도 1일) */
  schoolDays: number
  /** 결석일수 — 그날 한 세션에도 참여하지 않은 날의 수 */
  absentDays: number
  /** 집계에 들어간 세션 수. 수업일수와 다르면 하루에 여러 번 한 날이 있다는 뜻 */
  sessions: number
  /** 학기 밖이라 제외한 세션 수 — 0 이 아니면 화면에 알려 준다 */
  excluded: number
}

/**
 * 세션 단위 출석 기록을 **날짜 단위**로 접는다.
 *
 * 서버의 `AttendanceSummary` 는 화상수업 세션 하나를 한 칸으로 센다. 통지표의 "수업일수"는
 * 달력의 날이므로 그대로 쓸 수 없다 — 하루에 수업을 세 번 하면 3일이 돼 버린다.
 * 그래서 `startedAt` 의 날짜로 묶고, **그날 한 번이라도 참여했으면 출석**으로 본다.
 */
export function tallyAttendance(summary: AttendanceSummary, range: TermRange): AttendanceTally {
  const attendedByDate = new Map<string, boolean>()
  let sessions = 0
  let excluded = 0

  for (const entry of summary.sessions) {
    const date = entry.startedAt.slice(0, 10)
    if (date < range.from || date >= range.to) {
      excluded += 1
      continue
    }
    sessions += 1
    attendedByDate.set(date, (attendedByDate.get(date) ?? false) || entry.attended)
  }

  let absentDays = 0
  for (const attended of attendedByDate.values()) {
    if (!attended) absentDays += 1
  }

  return { schoolDays: attendedByDate.size, absentDays, sessions, excluded }
}

/* ────────────────────────── 교과평가 ────────────────────────── */

/**
 * 개념 태그 -> (교과, 영역, 평가요소).
 *
 * 태그 어휘는 백엔드 `assignment/ai/GenerationPrompt.java` 의 KOREAN_TAGS 가 원본이다.
 * 거기 주석대로 **정식 교육과정 성취기준 사전은 아직 없어서**, 통지표의 '영역'과 '평가요소'
 * 문장은 여기 고정 사전이 채운다. 학생마다 달라지는 값이 아니라 태그마다 정해진 문장이다
 * (지어낸 데이터가 아니라 태그의 한국어 이름표에 가깝다).
 *
 * **국어 태그만 있다.** 과목이 5개로 늘었지만(S15P11A407-145) 고정 태그 사전을 가진 것은
 * 국어뿐이고, 영어·수학·사회·과학은 서버가 학습자료에서 태그를 뽑아 쓴다 — 무슨 말이 나올지
 * 미리 알 수 없어 사전을 만들 수 없다. 그 태그들은 `UNKNOWN_SUBJECT` 로 떨어진다.
 * (`HANJA_TAGS` 는 과목 재정의와 함께 백엔드에서 사라졌으므로 음훈·부수·획순·한자어도 지웠다.)
 */
const TAG_META: Record<string, { subject: string; area: string; criterion: string }> = {
  // 국어 - 문법(소리와 표기)
  겹받침: { subject: '국어', area: '문법', criterion: '겹받침이 있는 낱말을 바르게 읽고 쓰기' },
  ㅆ받침: { subject: '국어', area: '문법', criterion: 'ㅆ 받침이 있는 낱말을 바르게 읽고 쓰기' },
  쌍받침: { subject: '국어', area: '문법', criterion: '쌍받침이 있는 낱말을 바르게 읽고 쓰기' },
  된소리: { subject: '국어', area: '문법', criterion: '된소리가 나는 낱말을 바르게 읽고 쓰기' },
  구개음화: {
    subject: '국어',
    area: '문법',
    criterion: '구개음화가 일어나는 낱말을 바르게 읽고 쓰기',
  },
  연음: {
    subject: '국어',
    area: '문법',
    criterion: '앞말의 받침이 뒷말로 이어져 소리 나는 낱말을 바르게 읽기',
  },
  받침규칙: {
    subject: '국어',
    area: '문법',
    criterion: '받침이 소리 나는 규칙을 알고 낱말을 바르게 쓰기',
  },
  // 국어 - 문법(조사)
  '조사 은/는': { subject: '국어', area: '문법', criterion: "'은/는'을 문장에 알맞게 넣어 쓰기" },
  '조사 이/가': { subject: '국어', area: '문법', criterion: "'이/가'를 문장에 알맞게 넣어 쓰기" },
  '조사 을/를': { subject: '국어', area: '문법', criterion: "'을/를'을 문장에 알맞게 넣어 쓰기" },
  '조사 에/에게': {
    subject: '국어',
    area: '문법',
    criterion: "'에/에게'를 문장에 알맞게 넣어 쓰기",
  },
  '조사 에서': { subject: '국어', area: '문법', criterion: "'에서'를 문장에 알맞게 넣어 쓰기" },
  '조사 와/과': { subject: '국어', area: '문법', criterion: "'와/과'를 문장에 알맞게 넣어 쓰기" },
  // 국어 - 쓰기
  띄어쓰기: { subject: '국어', area: '쓰기', criterion: '문장을 바르게 띄어 쓰기' },
  맞춤법: { subject: '국어', area: '쓰기', criterion: '맞춤법에 맞게 낱말과 문장 쓰기' },
  문장부호: { subject: '국어', area: '쓰기', criterion: '문장 부호를 알맞게 사용하기' },
  // 국어 - 듣기 말하기
  표준발음: {
    subject: '국어',
    area: '듣기·말하기',
    criterion: '낱말을 표준 발음으로 또렷하게 소리 내어 읽기',
  },
}

/** 사전에 없는 태그의 자리 — 태그 이름을 그대로 평가요소로 쓴다(숨기지 않는다) */
const UNKNOWN_AREA = '기타'

/**
 * 사전에 없는 태그의 **교과** 자리.
 *
 * 예전엔 여기가 `'국어'` 였다. 과목이 국어·한자 둘뿐이고 태그 사전이 그 둘을 다 덮고
 * 있었으니 사실상 맞는 값이었다. 지금은 아니다 — 영어·수학·사회·과학 태그는 서버가
 * 학습자료에서 뽑아 오므로 사전에 없고, 그대로 두면 **수학 태그가 국어 교과 칸에 들어간다.**
 * 통지표는 학부모가 보는 문서라 틀린 교과명이 붙는 것이 빈칸보다 나쁘다.
 *
 * 교과를 제대로 알아내는 길은 서버가 새로 준 통지표 초안(`report-card/draft`)이다 —
 * 그쪽은 과목별로 행을 만들어 준다.
 */
const UNKNOWN_SUBJECT = '기타'

/** 백엔드 `Subject` 선언 순서 + 교과를 못 정한 행은 맨 뒤 */
const SUBJECT_ORDER = ['국어', '영어', '수학', '사회', '과학', UNKNOWN_SUBJECT]
const AREA_ORDER = ['듣기·말하기', '읽기', '쓰기', '문법', '문학', UNKNOWN_AREA]

/** 목록에 없으면 맨 뒤로 (사전이 늘어나도 조용히 사라지지 않게) */
function orderOf(list: string[], value: string): number {
  const index = list.indexOf(value)
  return index === -1 ? list.length : index
}

export interface EvalRow {
  subject: string
  area: string
  criterion: string
  /** 정답률 % */
  accuracy: number
  /** 채점된 문항 수 */
  total: number
  /** 문항이 MIN_SAMPLE 미만이면 null — 등급을 매기지 않고 칸을 비운다 */
  achievement: Achievement | null
}

/** rowspan 을 미리 계산해 둔 행. 0 이면 위 행의 셀에 병합돼 **그리지 않는다** */
export interface SpannedEvalRow extends EvalRow {
  subjectSpan: number
  areaSpan: number
}

/** 개념별 정답률(리포트)을 교과평가 표의 행으로 바꾼다 */
export function buildEvalRows(tagStats: TagStat[]): EvalRow[] {
  return tagStats
    .map((stat): EvalRow => {
      const meta = TAG_META[stat.tag] ?? {
        subject: UNKNOWN_SUBJECT,
        area: UNKNOWN_AREA,
        criterion: stat.tag,
      }
      return {
        ...meta,
        accuracy: stat.accuracy,
        total: stat.total,
        achievement: stat.total >= MIN_SAMPLE ? achievementOf(stat.accuracy) : null,
      }
    })
    .sort(
      (a, b) =>
        orderOf(SUBJECT_ORDER, a.subject) - orderOf(SUBJECT_ORDER, b.subject) ||
        orderOf(AREA_ORDER, a.area) - orderOf(AREA_ORDER, b.area) ||
        a.criterion.localeCompare(b.criterion, 'ko'),
    )
}

/**
 * 정렬된 행에 교과/영역 rowspan 을 붙인다.
 * `buildEvalRows` 가 이미 교과 -> 영역 순으로 묶어 두었으므로 **연속 구간의 길이**만 세면 된다.
 */
export function withSpans(rows: EvalRow[]): SpannedEvalRow[] {
  const runLength = (start: number, same: (a: EvalRow, b: EvalRow) => boolean) => {
    let end = start + 1
    while (end < rows.length && same(rows[start], rows[end])) end += 1
    return end - start
  }

  const sameSubject = (a: EvalRow, b: EvalRow) => a.subject === b.subject
  const sameArea = (a: EvalRow, b: EvalRow) => a.subject === b.subject && a.area === b.area

  return rows.map((row, i) => ({
    ...row,
    subjectSpan: i > 0 && sameSubject(rows[i - 1], row) ? 0 : runLength(i, sameSubject),
    areaSpan: i > 0 && sameArea(rows[i - 1], row) ? 0 : runLength(i, sameArea),
  }))
}

/* ──────────────────── 서버 통지표 <-> 화면 표 ──────────────────── */

/**
 * 서버가 준 `rating` 문자열을 화면의 4단계로 좁힌다.
 *
 * 서버 `Entry.rating` 은 제약 없는 문자열이라 4단계가 아닌 값이 들어 있을 수 있다(다른
 * 클라이언트나 손수 넣은 데이터). **모르는 값은 `null`** 로 둔다 — 억지로 '보통' 같은 데
 * 끼워 맞추면 선생님이 정하지 않은 평가가 통지표에 찍힌다.
 */
export function toAchievement(rating: string | null | undefined): Achievement | null {
  if (!rating) return null
  return ACHIEVEMENT_OPTIONS.find((option) => option === rating) ?? null
}

/**
 * 서버에 저장된 통지표를 화면 표의 행으로.
 *
 * **정답률·문항 수는 서버에 없다.** 통지표는 선생님이 확정한 문장과 평가를 담는 문서이고,
 * 자동 채점 수치는 초안을 만들 때만 쓰이기 때문이다. 그래서 `accuracy`·`total` 을 0 으로 두는데,
 * 이 값들은 표에 그려지지 않으므로(ReportCardSheet 는 교과·영역·평가요소·평가만 쓴다) 화면에
 * 0 이 보이는 일은 없다. **`achievement` 를 `accuracy` 에서 다시 계산하지 않는 것이 핵심이다** —
 * 그러면 선생님이 저장한 평가가 0% 기준의 '노력요함' 으로 덮인다.
 */
export function entriesToRows(entries: ReportCardEntry[]): EvalRow[] {
  return entries.map((entry) => ({
    subject: subjectLabel(entry.subject as Subject) ?? entry.subject,
    area: entry.area ?? '',
    criterion: entry.evalElement ?? '',
    accuracy: 0,
    total: 0,
    achievement: toAchievement(entry.rating),
  }))
}

/**
 * 화면 표의 행을 서버에 저장할 형태로.
 *
 * 교과 한글을 **코드로 되돌린다** — 서버는 `Subject` enum 이름만 받는다. 되돌릴 수 없는 교과
 * (태그로는 과목을 알 수 없어 '기타' 로 떨어진 행)는 **보내지 않는다.** 서버가 enum 파싱에
 * 실패하면 그 학생 통지표 저장이 통째로 실패하는데, 한 줄 때문에 나머지를 잃는 것이 더 나쁘다.
 */
export function rowsToEntries(rows: EvalRow[]): ReportCardEntry[] {
  const codeOf = new Map<string, Subject>(
    SUBJECT_CODES.map((code) => [SUBJECT_LABEL[code] as string, code]),
  )
  return rows.flatMap((row): ReportCardEntry[] => {
    const subject = codeOf.get(row.subject)
    if (!subject) return []
    return [
      {
        subject,
        area: row.area || null,
        evalElement: row.criterion || null,
        rating: row.achievement,
      },
    ]
  })
}

/** 저장할 수 없어 빠지는 행의 수 — 화면이 "몇 줄은 안 저장된다"를 미리 말할 때 쓴다 */
export function unsavableRowCount(rows: EvalRow[]): number {
  return rows.length - rowsToEntries(rows).length
}

/* ────────────────────────── 통지표 한 장 ────────────────────────── */

/** 선생님이 인쇄할 때 직접 채우는 값 — 서버에 없는 학적 항목들 */
export interface ReportCardMeta {
  schoolYear: number
  term: Term
  /** 반 — 학급에 대응 필드가 없다 */
  classNo: string
  /** 번호 — 출석번호 컬럼이 없다 (username 의 끝 숫자는 전역 증가라 못 쓴다) */
  seatNo: string
  homeroomTeacher: string
  schoolName: string
}

/** 통지표 한 장을 그리는 데 필요한 전부 */
export interface ReportCardData {
  studentId: number
  name: string
  grade: number
  meta: ReportCardMeta
  attendance: AttendanceTally
  rows: SpannedEvalRow[]
}
