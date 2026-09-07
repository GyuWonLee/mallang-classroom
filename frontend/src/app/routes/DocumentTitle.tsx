import { useEffect } from 'react'
import { useMatches } from 'react-router-dom'

/** 서비스 이름 — 탭에 항상 남는다. 어느 탭이 우리 서비스인지 알아보는 단서다. */
export const APP_NAME = '말랑교실'

/** 라우트가 `handle: { title }` 로 알려 준 제목 */
interface TitleHandle {
  title?: string
}

/**
 * 탭 제목을 지금 화면에 맞춘다.
 *
 * <p>예전에는 `index.html` 의 `<title>우리반 국어교실 — 라이브 수업</title>` 하나가 끝이었다.
 * 레퍼런스 목업에서 온 문구가 그대로 남은 것이라, 로그인 화면이든 학급 관리든 탭에는 늘
 * "라이브 수업"이라고 적혀 있었다 — 서비스 이름도 아니고 지금 보는 화면도 아니다.
 * 선생님이 탭을 여러 개 띄우면 어느 것이 무엇인지 구분할 수 없었다.
 *
 * <p>제목은 라우트가 정한다(`handle.title`). 화면 컴포넌트가 저마다 `document.title` 을
 * 만지면 뒤로 가기·중첩 라우트에서 누가 마지막으로 썼는지에 따라 결과가 달라진다.
 * 여기 한 곳에서 **가장 안쪽 라우트의 title** 을 골라 쓰면 그 경합이 없다.
 *
 * <p>학급 이름처럼 데이터에서 오는 제목은 다루지 않는다 — 로딩 중에 제목이 두 번 바뀌고,
 * 실패하면 무엇을 적을지도 애매하다. 탭 제목은 "여기가 어디인가"만 말하면 충분하다.
 */
export function DocumentTitle() {
  const matches = useMatches()

  useEffect(() => {
    const title = matches
      .map((m) => (m.handle as TitleHandle | undefined)?.title)
      .filter(Boolean)
      .at(-1)
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
  }, [matches])

  return null
}
