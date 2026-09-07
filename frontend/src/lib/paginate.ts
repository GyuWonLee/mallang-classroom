/**
 * 페이지 나누기 계산 — 목록을 자르는 쪽이 늘 반복하는 세 줄.
 *
 * `page` 를 그대로 쓰지 않고 **범위 안으로 접어서** 돌려준다. 목록이 줄어들면(학년 필터를
 * 걸거나 과제를 지우면) 3페이지에 서 있던 사람이 빈 페이지를 보게 되는데, 그때 effect 로
 * 되돌리면 빈 화면이 한 번 깜빡인 뒤에 고쳐진다. 파생값으로 접으면 처음 그릴 때 이미 맞다.
 *
 * 컴포넌트가 아니라 계산이라 `Paginator.tsx` 가 아닌 여기 둔다 — 한 파일이 컴포넌트와
 * 함수를 같이 내보내면 Fast Refresh 가 그 파일 전체를 다시 마운트한다.
 */
export function pageSlice<T>(
  items: readonly T[],
  page: number,
  size: number,
): { pageCount: number; current: number; items: T[] } {
  const pageCount = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(Math.max(page, 0), pageCount - 1)
  return { pageCount, current, items: items.slice(current * size, current * size + size) }
}
