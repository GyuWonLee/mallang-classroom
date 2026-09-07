/**
 * 과제 날짜 표기 — "언제 학생에게 나갔는지"를 말한다.
 *
 * 마감(`dueAt`)은 **이 표기에 넣지 않는다.** 과제를 만드는 경로에는 마감 입력이 없고
 * (AssignmentWizardModal 에 필드가 없다), 서버도 AI 생성 초안에 `dueAt: null` 을 넣는다
 * (GenerationJobRunner). 그래서 마감 칩은 실제로는 늘 '마감일 없음'만 렌더하는
 * 빈 자리였다. 대신 선생님이 정말 알고 싶은 것 — 이 과제가 언제 나갔는지 — 를 보여준다.
 *
 * 마감을 정하는 곳은 **과제 상세 패널 머리글 하나뿐**이다(DueDatePopover → PATCH dueAt).
 * 거기서 정한 값은 그 머리글이 직접 보여주므로, 목록 칩까지 마감으로 바꾸지는 않는다.
 *
 * `publishedAt` 은 **처음 공개한 순간**에 서버가 채우고(Assignment.java), 발행을 취소하면
 * 다시 null 이 된다. 즉 null = 아직 학생에게 안 보이는 초안이다.
 * 그 경우는 만든 날(`createdAt`)로 대신 말해 준다 — 옆에 이미 '공개 전' 배지가 있으므로
 * 공개 여부를 여기서 또 말하지 않고, 배지가 못 주는 정보(언제 만들었나)를 준다.
 */

/** `2026. 7. 31.` 형태. 잘못된 값이면 null (호출부가 문구를 감출 수 있게) */
function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ko-KR')
}

/** `7월 31일` 형태 — 좁은 칩에 넣을 때 */
function fmtMonthDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
}

/**
 * 목록·상세의 한 줄 표기 — `공개 2026. 7. 31.` / `만든 날 2026. 7. 30.`
 * 날짜를 둘 다 읽을 수 없으면 null 을 준다 (지어내지 않고 문구를 감춘다).
 */
export function assignmentDateLabel(a: {
  publishedAt?: string | null
  createdAt?: string | null
}): string | null {
  const published = fmtDate(a.publishedAt)
  if (published) return `공개 ${published}`
  const created = fmtDate(a.createdAt)
  return created ? `만든 날 ${created}` : null
}

/** 좁은 칩용 짧은 표기 — `공개 7월 31일` / `초안 7월 30일` */
export function assignmentDateChip(a: {
  publishedAt?: string | null
  createdAt?: string | null
}): string | null {
  const published = fmtMonthDay(a.publishedAt)
  if (published) return `공개 ${published}`
  const created = fmtMonthDay(a.createdAt)
  return created ? `초안 ${created}` : null
}
