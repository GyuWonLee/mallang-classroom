/** 한글 조사 도우미 — "삭제은(는)" 같은 어색한 표기를 만들지 않기 위해 받침을 보고 고른다. */

function hasFinalConsonant(word: string): boolean {
  const code = word.trim().slice(-1).charCodeAt(0)
  const isHangulSyllable = code >= 0xac00 && code <= 0xd7a3
  return isHangulSyllable && (code - 0xac00) % 28 !== 0
}

/** 은 / 는 */
export function topicParticle(word: string): '은' | '는' {
  return hasFinalConsonant(word) ? '은' : '는'
}

/**
 * 두 글자 성 — 여기 없으면 성은 한 글자로 본다.
 *
 * **`황보`·`선우` 는 일부러 넣지 않았다.** 두 글자 성으로도 읽히지만 흔한 이름과 겹친다:
 * `황보라` 는 황보+라 보다 **황+보라** 일 가능성이 높고, `선우진` 도 선+우진 이 많다.
 * 목록에 넣으면 그 흔한 쪽을 매번 틀리게 자른다 — 드문 성을 맞히려고 흔한 이름을 망치지 않는다.
 *
 * 남은 것들은 겹치는 이름이 사실상 없다(`남궁민수` 를 남+궁민수 로 읽지는 않는다).
 * 빠진 성이 나오면 한 줄 더하면 된다.
 */
const TWO_CHAR_SURNAMES = ['남궁', '독고', '제갈', '사공', '서문', '동방', '망절'] as const

/**
 * 이름에서 **성을 뗀** 이름만 — `최재성` → `재성`.
 *
 * 아이를 부를 때는 성을 붙이지 않는다("최재성아" 는 야단치는 말투다). 인사말처럼 아이를
 * 직접 부르는 자리에서만 쓰고, 계정을 가리키는 자리(사용자 메뉴 등)에는 전체 이름을 둔다.
 *
 * **한글 이름에만 적용한다.** 영문 이름은 성이 뒤에 오거나 띄어쓰기로 갈리므로 앞 글자를
 * 떼면 이름이 망가진다(`Emily` → `mily`). 한 글자 이름도 그대로 둔다 — 뗄 성이 없다.
 */
export function givenName(fullName: string): string {
  const name = fullName.trim()
  if (name.length < 2) return name
  // 한글 음절로만 이루어진 이름인지 (공백·영문·숫자가 섞이면 손대지 않는다)
  if (!/^[가-힣]+$/.test(name)) return name

  const two = TWO_CHAR_SURNAMES.find((s) => name.startsWith(s))
  // 성만 남는 경우(두 글자 성 그대로 = 이름이 없음)에는 자르지 않는다
  if (two && name.length > two.length) return name.slice(two.length)
  return name.slice(1)
}

