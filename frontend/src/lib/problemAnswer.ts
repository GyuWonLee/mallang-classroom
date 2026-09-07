/**
 * 학생이 낸 답 한 개를 **사람이 읽는 말**로 바꾼다.
 *
 * 서버의 오답 분포(`ProblemStat.choiceDistribution[].answer`)는 학생이 보낸 값을 그대로 담는다.
 * 그 값은 문항 종류마다 다르다 (백엔드 AssignmentSubmissionsService: "선택형이면 인덱스,
 * 받아쓰기면 입력한 문자열"):
 *  - 선택형·OX : **0부터 세는 보기 번호** ("0" = 첫 번째 보기) — 학생 화면이 그렇게 보낸다(useQuiz)
 *  - 받아쓰기  : 학생이 쓴 문장 그대로
 *
 * 그래서 아무 손도 대지 않고 화면에 적으면 선생님은 `2 · 5명` 같은 **맨 숫자**를 보게 된다 —
 * 2번이 무슨 보기였는지는 알 수 없다. 보기 목록을 알면 글까지 붙이고, 모르면 최소한
 * "보기 3번"으로 사람이 세는 번호로 옮긴다.
 */

/** 선택형 답이면 0부터 세는 보기 index, 아니면 null (받아쓰기처럼 문장이 온 경우) */
export function choiceIndexOf(answer: string): number | null {
  if (!/^\d+$/.test(answer.trim())) return null
  return Number(answer.trim())
}

/**
 * 보기 목록을 알면 `3. 천천히`, 모르면 `보기 3번`, 선택형이 아니면 쓴 문장 그대로.
 * 번호는 **1부터** 붙인다 — 학생 화면과 문항 목록이 그렇게 센다.
 */
export function answerLabel(answer: string, choices?: string[] | null): string {
  const i = choiceIndexOf(answer)
  if (i === null) return answer
  const text = choices?.[i]
  return text === undefined ? `보기 ${i + 1}번` : `${i + 1}. ${text}`
}
