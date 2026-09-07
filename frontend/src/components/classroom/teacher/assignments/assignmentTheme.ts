import { SUBJECT_CODES, SUBJECT_LABEL, subjectImage } from '@/lib/subject'
import type { Subject } from '@/types/assignment'
import type { ClassSubject } from '@/types/teacher'

/**
 * 과제 과목 테마 — ref `.t-*` 가 실어 오던 `--art-ink` 자리.
 * 과목 알약 배경, 제출률 링, 고른 카드의 테두리가 **같은 색**을 쓴다 — 목록에서 고른 색이
 * 오른쪽 상세까지 이어져 읽히게 하는 장치다(ref `.ag-card.selected` 주석).
 *
 * 과목이 국영수사과 5개가 되면서(S15P11A407-145) ref 의 `.t-*` 6색 중 5개를 나눠 쓴다.
 * 예전엔 과목이 국어·한자 둘뿐이라 "둘을 확실히 가른다"는 이유로 임의 색을 썼는데, 이제
 * 색이 부족하지 않으니 ref 값으로 되돌린다. **국어는 예전 그대로**(`.t-green`)라 이미
 * 만들어 둔 화면의 색이 바뀌지 않는다.
 */
const SUBJECT_INK: Record<Subject, string> = {
  KOREAN: '#4E9E68', // ref .t-green
  ENGLISH: '#7B5BC4', // ref .t-purple
  MATH: '#3F92AE', // ref .t-blue
  SOCIAL: '#D98A31', // ref .t-orange
  SCIENCE: '#BF9018', // ref .t-yellow
}

export interface AssignmentSubjectTheme {
  ink: string
  label: ClassSubject
  art: string
}

/*
  한글 라벨과 마스코트는 `lib/subject.ts` 에서 가져온다 — 과목 이름이 두 벌로 갈라지면
  같은 과제가 화면마다 다른 이름으로 보인다. (예전 `HANJA` 는 자기 마스코트가 없어 사회
  그림을 빌려 쓰고 있었는데, 그런 임시 조치도 함께 사라진다.)

  호출마다 새 객체를 만들지 않으려고 모듈 로드 때 한 번만 조립한다 — 이 값이 렌더마다
  달라지면 나중에 누가 `useMemo` 의존성에 넣었을 때 조용히 매번 다시 계산된다.
*/
const SUBJECT_THEME = Object.fromEntries(
  SUBJECT_CODES.map((code) => [
    code,
    { ink: SUBJECT_INK[code], label: SUBJECT_LABEL[code], art: subjectImage(SUBJECT_LABEL[code]) },
  ]),
) as Record<Subject, AssignmentSubjectTheme>

export function assignmentTheme(subject: Subject): AssignmentSubjectTheme {
  return SUBJECT_THEME[subject] ?? SUBJECT_THEME.KOREAN
}
