/**
 * 전체 공지 표시 규약 — **프론트 사이드 약속이다** (서버 계약이 아니다).
 *
 * 백엔드에는 "공지"라는 개념이 없다. 선생님이 전체 공지를 보내도 `LiveChatPanel` 이 학급 명단을
 * 돌며 1:1 쪽지를 반복 발행할 뿐이고(`/pub/sessions/{id}/messages/reply`), 학생이 받는 payload 는
 * `{ from, content }` 둘뿐이라 **개인 쪽지와 바이트가 완전히 같다.** 즉 학생 클라이언트는
 * 원리적으로 둘을 구별할 수 없다.
 *
 * 그래서 보내는 쪽이 본문 앞에 표식을 붙이고, 받는 쪽이 그걸 벗겨서 종류를 정한다.
 * 학생 화면에는 표식이 보이지 않는다.
 *
 * **한계 (알고 쓰는 것):**
 *  - 선생님이 1:1 쪽지 본문을 우연히 `[공지]` 로 시작하면 공지로 표시된다.
 *  - 다른 클라이언트(향후 앱 등)가 이 규약을 모르면 표식이 그대로 노출된다.
 *
 * 정공법은 서버가 공지 타입이나 전체 발행구를 주는 것이다. 그때 이 파일을 지우고
 * payload 필드로 갈아타면 된다 — 규약을 한 곳에 모아 둔 이유다.
 */

const NOTICE_PREFIX = '[공지] '

/** 보내는 쪽: 전체 공지에 표식을 붙인다 */
export function markNotice(text: string): string {
  return `${NOTICE_PREFIX}${text}`
}

/** 받는 쪽: 표식을 벗기고 공지 여부를 알려준다 */
export function parseNotice(text: string): { isNotice: boolean; text: string } {
  if (text.startsWith(NOTICE_PREFIX)) {
    return { isNotice: true, text: text.slice(NOTICE_PREFIX.length) }
  }
  return { isNotice: false, text }
}
