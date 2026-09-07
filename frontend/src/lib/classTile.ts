/**
 * 학급 카드(ref `.pk-card`)의 테마 — **세 화면이 같은 카드를 쓴다**:
 * 내 학급(진행 중·닫혀있는 수업)과 학급 선택(학생 관리·과제 관리 진입).
 * ref 도 같은 틀을 공유한다("카드 틀은 학급 선택 화면의 .pk-card를 그대로 쓴다").
 *
 * `art` 배경색과 `sj_N.webp` 의 배경색이 **같은 색이어야** 그림 사각형의 경계가 사라진다.
 * 그래서 색과 그림을 반드시 짝으로 묶어 둔다 (따로 고르면 어긋난다 — ref 주석의 경고).
 * `ink` 는 알약 글자색과 CTA 배경색으로 함께 쓰인다 (ref `--art-ink`).
 */
export interface ClassTileTheme {
  art: string
  ink: string
  img: string
}

/**
 * ref `.t-green` ~ `.t-pink` + `PC_THUMB` 짝.
 *
 * `art` 는 **그림 파일의 배경색을 그대로 받아 적은 값이다** — 그림이 새로 들어오면 이 값도 같이
 * 갈아야 한다(2026-08-03 sj_1~6 교체분 기준). 짝은 그림의 색으로 정했다:
 * 초록 sj_1 · 진한 노랑 sj_2 · 보라 sj_3 · 노랑 sj_4 · 파랑 sj_5 · 빨강(살몬) sj_6.
 */
const THEMES: readonly ClassTileTheme[] = [
  { art: '#C2E4BB', ink: '#4E9E68', img: '/assets/sj_1.webp' },
  { art: '#FEE99F', ink: '#BF9018', img: '/assets/sj_2.webp' },
  { art: '#E2CEF0', ink: '#7B5BC4', img: '/assets/sj_3.webp' },
  { art: '#FEF2D6', ink: '#D98A31', img: '/assets/sj_4.webp' },
  { art: '#BBE9F0', ink: '#3F92AE', img: '/assets/sj_5.webp' },
  { art: '#FEDCCC', ink: '#D9714A', img: '/assets/sj_6.webp' },
]

/**
 * 닫혀있는 수업 — 색을 뺀다 (ref `.pk-card.pk-card-locked`). 진행 중인 수업과 한눈에 갈라져야 한다.
 *
 * **`art` 는 그림을 `grayscale()` 로 통과시킨 색이어야 한다.** `sj_N.webp` 는 배경이 투명한 게
 * 아니라 테마색으로 꽉 찬 둥근 사각형이라(픽셀의 99%), 카드 색이 다르면 그 사각형의 경계가
 * 그대로 보인다. 여기 그림은 sj_1(#C2E4B9)이고 CSS grayscale 은 0.2126R+0.7152G+0.0722B 라
 * 218 → `#DADADA` 가 된다. 카드도 같은 색이면 사각형이 사라지고, ClassTile 의 `opacity-60`
 * 이 섞여도 같은 색이라 결과가 변하지 않는다.
 * (그림을 다른 것으로 바꾸면 이 값도 다시 계산해야 한다.)
 */
export const LOCKED_TILE_THEME: ClassTileTheme = {
  art: '#DADADA',
  // ref 는 --art-ink 를 --ink-soft 로 덮지만, CTA 배경만은 --primary 로 되돌린다.
  // 여기서는 알약 글자색으로만 쓰고 CTA 색은 카드 쪽에서 따로 준다.
  ink: '#6F7683',
  img: '/assets/sj_1.webp',
}

/**
 * 학급 id 로 테마를 고른다.
 *
 * ref 는 과목으로 고르지만 우리는 국어 전용이라 그러면 6장이 전부 같은 색이 된다.
 * 순서(index)로 돌리면 학급 하나를 지웠을 때 나머지 색이 전부 밀려서
 * "내 3학년 반은 분홍" 이라는 기억이 깨진다 — 그래서 id 해시로 고정한다.
 */
export function classTileTheme(id: string): ClassTileTheme {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return THEMES[h % THEMES.length]
}
