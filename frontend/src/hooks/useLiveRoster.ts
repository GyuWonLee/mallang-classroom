import { useEffect, useMemo, useRef, useState } from 'react'
import type { StudentAccount } from '@/types/teacher'

/** 나간 학생을 회색으로 남겨 두는 시간 — 이 시간이 지나면 목록에서 사라진다 */
const GRACE_MS = 5 * 60 * 1000
/** 유예 만료를 확인하는 주기. 5분 유예에 30초 오차면 충분하고, 렌더는 30초에 한 번뿐이다 */
const TICK_MS = 30 * 1000

interface Mark {
  /** 몇 번째로 들어왔는지 — 클수록 최근이다(정렬 기준) */
  seq: number
  /** 나간 시각. null 이면 지금 들어와 있다 */
  leftAt: number | null
}

export interface RosterEntry {
  acc: StudentAccount
  online: boolean
}

/**
 * 수업 화면에 **실제로 보여줄 학생 목록**을 만든다 — 순서와 생존 기간까지.
 *
 * 예전에는 발급된 학생 전원을 명단 순서대로 늘어놓고, 안 들어온 학생을 흐리게 처리했다.
 * 6명 중 2명만 들어온 교실에서 회색 타일 4개가 자리를 차지했고, 흐림만으로는 **들어온 건지
 * 아닌지 한눈에 갈라지지 않았다.** 그래서 규칙을 셋으로 정리한다:
 *
 *  1) **들어온 학생이 위로.** 최근에 들어온 학생이 맨 위이고, 먼저 있던 학생은 아래로 밀린다
 *     — 새로 들어온 아이에게 시선이 가는 것이 수업 중 실제 관심사와 맞는다.
 *  2) **나간 학생은 5분간 회색으로 남는다.** 와이파이가 끊겼다 돌아오는 일이 흔해서 즉시
 *     지우면 그 학생을 조작하던 손이 허공을 짚는다. 돌아오면 다시 맨 위로 올라간다.
 *  3) **한 번도 안 들어온 학생과 5분이 지난 학생은 목록에 없다.** 아직 안 온 아이는 명단
 *     (학급 관리)에서 확인하는 것이고, 이 화면은 "지금 수업에 누가 있나"를 보는 곳이다.
 *
 * 접속 판정은 호출부가 한다(`onlineIds`) — 이 훅은 **언제 들어오고 나갔는지**만 기억한다.
 */
export function useLiveRoster(
  students: StudentAccount[],
  /** 지금 접속해 있는 학생 userId */
  onlineIds: number[],
): RosterEntry[] {
  const [marks, setMarks] = useState<Map<number, Mark>>(new Map())
  /** 입장 순번 발급기 — 값이 아니라 순서만 쓰므로 단순 증가로 충분하다 */
  const seqRef = useRef(0)
  /** 유예 만료를 다시 계산하게 만드는 시계 */
  const [now, setNow] = useState(() => Date.now())

  /*
    배열은 렌더마다 새로 만들어지므로 **내용으로** 비교한다 — 그러지 않으면 아래 효과가
    매 렌더 돌면서 setState 를 불러 렌더 루프가 된다.
  */
  const onlineKey = useMemo(() => [...onlineIds].sort((a, b) => a - b).join(','), [onlineIds])

  useEffect(() => {
    const online = new Set(onlineKey ? onlineKey.split(',').map(Number) : [])
    setMarks((prev) => {
      const next = new Map(prev)
      let changed = false

      // 새로 들어왔거나 돌아온 학생 → 새 순번을 받아 맨 위로
      for (const id of online) {
        const mark = next.get(id)
        if (!mark || mark.leftAt !== null) {
          seqRef.current += 1
          next.set(id, { seq: seqRef.current, leftAt: null })
          changed = true
        }
      }
      // 방금 나간 학생 → 유예 시작
      const at = Date.now()
      for (const [id, mark] of next) {
        if (!online.has(id) && mark.leftAt === null) {
          next.set(id, { ...mark, leftAt: at })
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [onlineKey])

  /*
    시계는 **회색 타일이 있을 때만** 돌린다. 아무도 나가 있지 않으면 만료를 기다릴 일이 없고,
    수업 내내 30초마다 리렌더를 부르는 것은 낭비다(무대에 영상이 흐르는 화면이다).
  */
  const hasPending = useMemo(
    () => [...marks.values()].some((m) => m.leftAt !== null),
    [marks],
  )
  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [hasPending])

  return useMemo(() => {
    const entries: (RosterEntry & { seq: number; leftAt: number | null })[] = []
    for (const acc of students) {
      const mark = marks.get(acc.userId)
      if (!mark) continue // 이 수업에 한 번도 안 들어온 학생
      if (mark.leftAt !== null && now - mark.leftAt >= GRACE_MS) continue // 유예 끝
      entries.push({ acc, online: mark.leftAt === null, seq: mark.seq, leftAt: mark.leftAt })
    }
    /*
      들어와 있는 학생이 먼저, 그 안에서는 **최근 입장이 위**다(seq 내림차순).
      회색(나간) 학생끼리는 최근에 나간 순서 — 방금 끊긴 아이가 위에 있어야 눈에 띈다.
    */
    entries.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1
      if (a.online) return b.seq - a.seq
      return (b.leftAt ?? 0) - (a.leftAt ?? 0)
    })
    return entries.map(({ acc, online }) => ({ acc, online }))
  }, [students, marks, now])
}
