import type { ChatMessageDto } from '@/types/chat'

/**
 * 채팅 한 줄을 화면이 읽는 두 가지 — **누가 보냈나(mine)** 와 **누구와의 대화인가(peer)**.
 *
 * 이 둘을 여기 한 곳에서만 정한다. 예전에는 `chatApi` 가 응답을 매핑하며 둘을 섞어 버렸고
 * (`studentId: m.senderId`, `senderRole: replyToId != null ? 'TEACHER' : 'STUDENT'`),
 * 그 결과 **선생님이 보낸 메시지가 '선생님 id' 라는 없는 대화방으로 분류돼 화면에서 사라졌다.**
 * 낙관적 말풍선(pushMine) 때문에 보낼 때는 보이고 이력을 다시 받으면 없어졌다.
 *
 * 지금 규칙:
 *  - `mine`  : 보낸 사람이 나인가 — **내 userId 와 비교한다.** 추정이 아니다.
 *  - `peer`  : 남이 보낸 줄이면 보낸 사람 자신. 내가 보낸 줄이면 **서버가 준 `recipientId`**,
 *              없으면(옛 데이터) 답장 원본의 주인.
 *
 * 백엔드가 수업 채팅에도 recipient 를 저장하게 되면서 `recipientId` 가 1순위가 됐다.
 * 규칙을 이 파일에 모아 둔 덕에 **화면 코드는 한 줄도 손대지 않았다** — 여기 두 함수만 바뀐다.
 */

/**
 * 교사 단톡방을 대화 목록에 끼우기 위한 **가짜 상대 id**.
 *
 * 목록은 상대 userId 로 묶이는데 단톡방은 상대가 없다 — 학급의 선생님 전원이 한 방을 쓴다.
 * 그래서 실제 userId 와 겹치지 않는 음수를 쓴다. 채팅 관리 화면과 학급 화면의 메시지 패널이
 * 같은 값을 써야 해서 여기 둔다 (예전에는 화면마다 따로 적혀 있었다).
 */
export const TEACHER_ROOM_ID = -1

/** 내가 보낸 줄인가 — 내 userId 를 모르면(비로그인·로딩 중) 판단하지 않는다 */
export function isMine(m: ChatMessageDto, myUserId: number | null | undefined): boolean {
  return myUserId != null && m.senderId === myUserId
}

/**
 * 내가 아닌 **다른 선생님**이 보낸 줄인가 (백엔드 `senderRole`, 04a2c64).
 *
 * 학급에는 선생님이 여럿일 수 있다(OWNER + MAINTAINER). 그런 학급에서 동료 선생님이 학생에게
 * 보낸 줄은 나에게 "내가 보낸 것도 아니고 학생이 보낸 것도 아닌" 줄이다. 역할을 안 보면
 * `chatPeerId` 가 보낸 사람(=동료 선생님)을 대화 상대로 잡아, **학생 인박스에 선생님 이름으로
 * 된 학생 칸이 하나 생긴다.** 눌러도 학생 정보가 없어 이름만 뜨는 빈 대화가 된다.
 *
 * `senderRole` 이 없는 옛 데이터는 `false`(= 학생 줄로 본다) 로 떨어진다 — 그때는 학급에
 * 선생님이 한 명뿐인 것이 사실상 전부였고, 모른다고 멀쩡한 학생 대화를 숨기는 편이 더 나쁘다.
 */
export function isOtherTeacher(m: ChatMessageDto, myUserId: number | null | undefined): boolean {
  return !isMine(m, myUserId) && m.senderRole === 'TEACHER'
}

/**
 * 이 메시지가 속한 대화의 **상대** id.
 *
 * 백엔드가 수업 채팅에도 recipient 를 저장하기 시작해서, 내가 보낸 줄의 상대는 이제
 * **서버가 알려준다**(`recipientId`). 예전에는 답장 사슬로 역산할 수밖에 없어서
 * **내가 먼저 건 메시지는 새로고침하면 사라졌다** — 상대를 가리키는 값이 없었기 때문이다.
 *
 * `replyToSenderId` 폴백은 **recipient 저장 이전에 쌓인 옛 메시지**를 위해 남겨 둔다.
 * 그 줄들에는 상대가 없어서 답장 사슬 말고는 단서가 없다.
 *
 * `null` = 그래도 알 수 없다 (옛 데이터 + 답장도 아닌 줄). 지어내지 않고 뺀다 —
 * 엉뚱한 학생의 대화에 남의 말이 섞이는 것이 더 나쁘다.
 */
export function chatPeerId(m: ChatMessageDto, myUserId: number | null | undefined): number | null {
  if (!isMine(m, myUserId)) return m.senderId
  return m.recipientId ?? m.replyToSenderId
}
