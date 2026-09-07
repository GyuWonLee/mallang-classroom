/**
 * 채팅 시간 표기 — 메신저 화면 4곳(학생 쪽지 · 학급 메시지 패널 · 라이브 채팅 · 채팅 인박스)이
 * **묶음 규칙(`endsMinuteRun`)을 공유한다.**
 *
 * 시간 **문구를 만드는 방식은 일부러 통일하지 않았다.** 라이브 채팅과 채팅 인박스는 어제 것에
 * 날짜를 보여주는 자기 포맷터를 갖고 있어서, 여기로 끌어오면 그 기능이 사라진다.
 * 아래 `hhmm` 은 그런 사정이 없는 학생 쪽지함이 쓴다.
 */

/**
 * 'HH:MM' (24시간). **초는 넣지 않는다.**
 *
 * 예전엔 학생 쪽지함만 `toLocaleTimeString('ko-KR')` 기본값을 써서 "오후 2:05:33" 처럼
 * 초까지 나왔다. 대화에서 초는 읽는 데 방해만 되고, 무엇보다 **아래 분 단위 묶음을 깨뜨린다**
 * (초가 다르면 같은 분에 보낸 것도 매번 다른 문구가 되어 하나도 묶이지 않는다).
 */
export function hhmm(at: string | Date): string {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * 카톡식 시간 묶음 — 연달아 온 같은 묶음에서 **마지막 것에만** 시간을 보인다.
 * 나머지는 시간 칸 자체를 그리지 않아 말풍선이 촘촘하게 붙는다.
 *
 * `keyOf` 는 "묶음이 같은가"를 정하는 열쇠다. 두 가지를 반드시 함께 넣는다:
 *  - **화면에 보일 시간 문구** — 분 단위여야 한다(초가 섞이면 묶이지 않는다).
 *  - **보낸 사람** — 사람이 바뀌면 묶음이 끊긴다. 이게 없으면 내가 2시 05분에 보낸 것의
 *    시각이, 같은 분에 도착한 상대 말풍선에 흡수돼 **내 쪽 시간이 아예 사라진다.**
 *
 * 목록은 **오래된 것이 위**라고 가정한다(4곳 모두 그렇게 정렬한다) — 그래서 "묶음의 마지막"은
 * 다음 항목과 열쇠가 달라지는 지점이다.
 */
export function endsMinuteRun<T>(
  list: readonly T[],
  i: number,
  keyOf: (m: T) => string,
): boolean {
  const next = list[i + 1]
  return next === undefined || keyOf(next) !== keyOf(list[i])
}
