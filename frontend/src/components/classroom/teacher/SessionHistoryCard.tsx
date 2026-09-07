import { useEffect, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { sessionApi } from '@/services/api/sessionApi'
import type { SessionHistoryItem } from '@/types/session'

/** "7월 30일 (수) 오전 9:00" */
function formatStart(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** 수업 길이 — 진행중이면 아직 셀 수 없다 */
function formatDuration(startedAt: string, endedAt: string | null): string | null {
  if (!endedAt) return null
  const minutes = Math.round(
    (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000,
  )
  if (minutes < 1) return '1분 미만'
  if (minutes < 60) return `${minutes}분`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

/**
 * 수업 이력 — GET /classrooms/{id}/sessions (백엔드 S15P11A407-127, 명세 v1.1).
 *
 * 최근 수업이 먼저 오고 **진행중 수업도 포함**된다(오늘 수업이 목록에서 사라지면 안 되므로).
 * 그래서 첫 항목이 진행중일 수 있고, 그때는 LIVE 배지를 달고 종료 시각 자리를 비운다.
 *
 * `participantCount` 는 **실제 입장한 사람 수**다(재입장 중복 제거). 학급 정원이 아니라서
 * "24명 중 21명" 처럼 쓰면 틀린다 — 그냥 들어온 인원으로만 표시한다.
 */
export function SessionHistoryCard({ classroomId }: { classroomId: string }) {
  const [items, setItems] = useState<SessionHistoryItem[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!classroomId) return
    let cancelled = false
    setError(false)
    void sessionApi
      .listSessions(classroomId)
      .then((res) => {
        if (!cancelled) setItems(res)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [classroomId])

  return (
    <div className="rounded-card bg-card p-[22px_24px] shadow-card">
      <h2 className="flex items-center gap-2 text-[1.05rem] font-black">
        <Icon name="clock" className="h-[22px] w-[22px] flex-none text-primary" />
        지난 수업
      </h2>
      <p className="mt-1 text-[.85rem] font-medium text-ink-soft">
        언제 수업했고 몇 명이 들어왔는지 볼 수 있어요.
      </p>

      {error && <EmptyState icon="alert" title="수업 이력을 불러오지 못했어요" />}

      {!error && items?.length === 0 && (
        <EmptyState icon="clock" title="아직 진행한 수업이 없어요" />
      )}

      {!error && items && items.length > 0 && (
        /* 이력은 계속 쌓이므로 상한을 두고 스크롤한다 (컨테이너가 무한히 늘어나지 않게) */
        <ul className="mt-3.5 flex max-h-[46vh] flex-col gap-2 overflow-y-auto">
          {items.map((s) => {
            const duration = formatDuration(s.startedAt, s.endedAt)
            return (
              <li
                key={s.sessionId}
                data-live={s.live}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-canvas p-[14px_16px] data-[live=true]:bg-sky"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[.95rem] font-bold">
                    {formatStart(s.startedAt)}
                    {s.live && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-[2px] text-[.7rem] font-black text-white">
                        <span className="h-1.5 w-1.5 rounded-full bg-white animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
                        진행 중
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[.8rem] font-medium text-ink-soft">
                    {s.startedByName} 선생님
                    {duration && ` · ${duration} 수업`}
                  </p>
                </div>
                {/* 학급 정원이 아니라 '들어온 인원' 이라는 뜻이 드러나게 라벨을 붙인다 */}
                <span className="flex flex-none items-center gap-1.5 text-[.85rem] font-black text-primary">
                  <Icon name="students" className="h-[17px] w-[17px]" />
                  {s.participantCount}명 입장
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
