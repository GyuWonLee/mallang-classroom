import { create } from 'zustand'
/*
  기본 아바타는 **`ch2` 말랑이**다.

  `ch1-2`(노란 별) → `ch1` → `ch2` 로 옮겨 왔다. 별을 버린 이유: 같은 그림을 퀴즈 진행도 별과
  축하 모달이 쓴다 — 화면 왼쪽 위 아바타와 오른쪽 내 메뉴에 같은 별이 앉아 있으니 "내 얼굴"이
  아니라 점수 표시처럼 보였다.
*/
import defaultAvatar from '@/assets/characters/ch2.webp'

/**
 * 사용자 — 원시 상태만 보관 (Rule 2). 지금은 아바타 하나다.
 *
 * XP(`xp`/`xpMax`/`addXp`)가 여기 있었다. 퀴즈를 다 풀면 30씩 쌓였지만 **읽는 화면이 하나도
 * 없었다** — 서버에 저장소가 없어 XP 막대를 걷어낸 뒤로 쓰기만 남은 상태였다. 게이미피케이션이
 * 스코프에 들어오면 서버 필드부터 만들고 되살린다(그전까지는 새로고침에 사라지는 값이다).
 */
interface UserState {
  avatarUrl: string
}

export const useUserStore = create<UserState>(() => ({
  avatarUrl: defaultAvatar,
}))
