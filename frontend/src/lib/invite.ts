/**
 * 초대 코드 공통 규칙 — 발급하는 쪽(선생님 모달)과 넣는 쪽(로그인 화면)이 같은 값을 써야 한다.
 *
 * 여기 있는 것은 **형식 규칙**뿐이다. 코드가 어느 학급 것이고 지금 쓸 수 있는지는
 * `inviteApi.previewInvite` (GET /invites/{code}, 백엔드 S15P11A407-137)가 알려준다 —
 * 예전엔 그 조회가 없어 수락해 봐야만 알 수 있었다. 최종 판정은 여전히 수락 시점의 서버다.
 */

/**
 * 발급 코드 길이 — 백엔드 `InviteService` 가 6자로 만든다.
 * 알파벳은 `ABCDEFGHJKMNPQRSTUVWXYZ23456789` 로, 헷갈리는 I·L·O·0·1 이 빠져 있다.
 * 덕분에 입력을 대문자로 올리는 것 말고 O→0 같은 치환은 할 필요가 없다.
 */
export const INVITE_CODE_LENGTH = 6

/** 사용자가 손으로 적은 코드를 발급 형식(대문자+숫자, 6자)으로 맞춘다 */
export function normalizeInviteCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, INVITE_CODE_LENGTH)
}

/** 형식만 본다 — 실제 유효성은 수락할 때 서버가 판정한다 */
export function isInviteCodeComplete(code: string): boolean {
  return code.length === INVITE_CODE_LENGTH
}

/**
 * 붙여넣기까지 받아 주는 입력 정규화.
 *
 * 선생님이 받는 건 대개 **코드가 아니라 링크**다(`inviteLink` 가 보내는 값). 그걸 그대로
 * `normalizeInviteCode` 에 넣으면 주소의 글자까지 긁어모아 `HTTPLO` 같은 엉뚱한 6자가 된다.
 * 그래서 `/invite/` 뒤 조각이 있으면 **거기서만** 코드를 뽑고, 없을 때만 손으로 적은 값으로 본다.
 */
export function inviteCodeFrom(raw: string): string {
  /*
    `*` 이지 `+` 가 아니다 — 코드가 잘려 나간 링크(`.../invite/`)까지 링크로 친다.
    `+` 로 두면 그런 입력은 매치에 실패해 주소 전체를 긁어 `HTTPLO` 같은 그럴듯한 6자가
    만들어지고, 사용자는 멀쩡한 코드를 넣은 줄 알고 "없는 코드" 오류만 보게 된다.
  */
  const fromLink = raw.match(/\/invite\/([^/?#\s]*)/)
  return normalizeInviteCode(fromLink ? fromLink[1] : raw)
}

/** 수락 화면 경로 — 라우터의 `/invite/:code` */
export function invitePath(code: string): string {
  return `/invite/${code}`
}

/** 코드를 그대로 여는 절대 링크 (비로그인도 열린다) — 선생님이 학생에게 보낼 값 */
export function inviteLink(code: string): string {
  return `${window.location.origin}${invitePath(code)}`
}
