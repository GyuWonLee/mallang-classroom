/**
 * 과제의 **대상 학년** — 옛 과제를 위한 읽기 폴백.
 *
 * 백엔드 `Assignment` 에 학년 컬럼이 없던 시절에는 학년을 제목 앞에 문자열로 끼워 넣었다
 * (`3학년 받아쓰기 1회`). V21 에서 `grade` 필드가 생겨 **쓰는 쪽 우회는 없앴다** —
 * 과제 마법사는 제목을 손대지 않고 `grade` 를 그대로 보낸다.
 *
 * 남은 건 읽는 쪽뿐이다. V21 이전에 만든 과제는 `grade` 가 null 이라 제목에서 캐내야 한다:
 * `a.grade ?? gradeFromTitle(a.title)`. 그 옛 과제가 다 사라지면 이 파일도 지운다.
 */

/** 제목에서 학년 캐내기 — `5학년 받아쓰기 1회` → 5. 없으면 null */
export function gradeFromTitle(title: string): number | null {
  const m = title.match(/(\d)\s*학년/)
  return m ? Number(m[1]) : null
}
