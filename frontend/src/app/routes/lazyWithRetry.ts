import { lazy, type ComponentType } from 'react'

/*
  배포가 나가면 열어 둔 탭이 흰 화면이 되던 문제를 막는 래퍼.

  프론트 파일 이름에는 내용 해시가 붙어 배포마다 바뀐다. 배포 전에 탭을 열어 둔 사람이
  그 뒤 처음 여는 화면(페이지·모달)의 청크를 요청하면, 옛 이름이 서버에 없을 때 404 가 나고
  `import()` 가 reject 되면서 Suspense 아래 트리가 통째로 언마운트된다.

  (근본 대책은 배포에서 옛 자산을 지우지 않는 것이다 — Jenkinsfile 의 'Deploy Frontend'
  주석 참고. 여기는 그래도 실패했을 때의 그물이다. 학교망에서는 배포가 없어도 청크 요청
  한 번이 실패하면 같은 일이 난다.)

  두 단계로 막는다.
   1. 300ms 뒤 한 번 더 시도한다. 일시적인 네트워크 실패는 여기서 끝난다.
   2. 그래도 실패하면 배포로 파일이 바뀐 경우다. **한 번만** 새로고침해 새 index.html 을
      받는다. sessionStorage 로 표시해 두어 무한 새로고침에 빠지지 않게 한다.

  마지막까지 실패하면 예외를 그대로 던져 라우트의 errorElement 가 받는다.
*/

const RELOADED_KEY = 'mallang.chunkReloaded'

/**
 * 새로고침 예산을 되돌린다 — **앱이 멀쩡히 떠서 얼마간 살아 있었을 때만.**
 *
 * 표시를 재시도 성공 때만 지웠더니, 한 번 켜진 뒤로는 그 탭에서 영영 안 꺼졌다. 그래서
 * **같은 탭에서 두 번째 배포부터는** 새로고침 없이 곧장 에러 화면으로 갔다. 배포가 잦은 날에
 * 정확히 그 증상이 났다.
 *
 * 그렇다고 부팅하자마자 지우면, 새로고침해도 낫지 않는 상황에서 무한 새로고침이 된다.
 * 그래서 **살아남은 뒤에** 지운다 — 여기까지 왔으면 그 새로고침은 효과가 있었다는 뜻이다.
 */
export function armChunkReloadBudget(): () => void {
  const timer = setTimeout(() => sessionStorage.removeItem(RELOADED_KEY), 10_000)
  return () => clearTimeout(timer)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await loader()
    } catch (first) {
      await sleep(300)
      try {
        const mod = await loader()
        // 두 번째에 성공했다면 새로고침 표시를 지워 다음 사고에서 다시 쓸 수 있게 한다
        sessionStorage.removeItem(RELOADED_KEY)
        return mod
      } catch (second) {
        if (sessionStorage.getItem(RELOADED_KEY) !== '1') {
          sessionStorage.setItem(RELOADED_KEY, '1')
          window.location.reload()
          // reload 는 즉시 돌아오지 않지만, 타입상 무언가는 반환해야 하므로 대기시킨다
          await sleep(10_000)
        }
        throw second ?? first
      }
    }
  })
}
