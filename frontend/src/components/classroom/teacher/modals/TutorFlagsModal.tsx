import { useEffect, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { ModalShell, MODAL_SUB } from '@/components/common/ModalShell'
import { tutorApi } from '@/services/api/tutorApi'
import type { TutorMessage } from '@/types/tutor'

/** `8월 3일 오후 3:44` — 언제 한 말인지가 판단의 절반이라 날짜까지 적는다 */
function when(iso: string): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  return new Date(at).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * 살펴볼 대화 (선생님) — GET /classrooms/{id}/tutor-messages?studentId=... 에서 `flagged` 만 추린다.
 *
 * **이 화면이 없으면 안전 신호 기능 자체가 성립하지 않는다.** 목록의 "살펴보기 3" 배지는
 * 건수만 말한다 — 사유는 일부러 빼 놓았다(이름 옆에 "자해 신호"가 뜨면 옆자리 아이도 읽는다).
 * 그래서 무엇이 잡혔는지 확인할 곳이 어디에도 없었고, 선생님은 숫자만 보고 아무것도 할 수
 * 없었다. 어른에게 알리는 경로의 **마지막 한 칸**이 여기다.
 *
 * 표시된 대화만 보여준다. 평소 대화까지 전부 펼치면 선생님이 아이의 모든 질문을 읽는
 * 화면이 되어 버린다 — 그건 이 기능이 하려던 일이 아니다.
 *
 * 사유(`flagReason`)는 선생님 조회에만 실려 온다. 서버가 학생 본인 조회에서는 지운다
 * (`TutorMessageResponse.from(message, forTeacher)`), 화면이 안 그린다는 사실에 기대지 않는다.
 */
export function TutorFlagsModal({
  classroomId,
  studentId,
  studentName,
  onClose,
}: {
  classroomId: string
  studentId: number
  studentName: string
  onClose: () => void
}) {
  const [rows, setRows] = useState<TutorMessage[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    void tutorApi
      .history(classroomId, studentId)
      .then((list) => {
        if (cancelled) return
        setRows(list.filter((m) => m.flagged))
        setState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [classroomId, studentId])

  return (
    <ModalShell
      open
      onClose={onClose}
      label={`${studentName} 살펴볼 대화`}
      width={520}
      title={<h2 className="text-[1.25rem] font-black">살펴볼 대화</h2>}
    >
      <p className={MODAL_SUB}>{studentName} 학생이 말랑이와 나눈 이야기예요</p>

      {state === 'loading' && <EmptyState title="불러오는 중..." className="min-h-[180px]" />}

      {state === 'error' && (
        <EmptyState
          icon="alert"
          title="대화를 불러오지 못했어요"
          hint="잠시 뒤에 다시 열어 주세요."
          className="min-h-[180px]"
        />
      )}

      {/*
        건수는 있는데 목록이 비는 경우가 있다 — 배지 숫자는 학급 단위로 5분간 캐시된다
        (`staleTime`). 그동안 학생이 학급을 옮겼거나 기록이 지워졌을 수 있다.
        "표시가 지워졌다"고 말해 주는 편이 빈 화면보다 낫다.
      */}
      {state === 'ready' && rows.length === 0 && (
        <EmptyState
          icon="check"
          title="지금은 살펴볼 대화가 없어요"
          hint="목록의 표시는 잠시 뒤에 사라져요."
          className="min-h-[180px]"
        />
      )}

      {state === 'ready' && rows.length > 0 && (
        <>
          {/*
            먼저 읽어야 할 것을 먼저 말한다. 이건 신고가 아니라 '눈으로 한 번 봐 달라'는
            표시다 — 키워드로 잡은 것이라 빗나갈 수 있고, 아이는 자기 말이 표시된 줄 모른다.
            그 사실을 적어 두지 않으면 선생님이 아이에게 곧장 캐묻게 된다.
          */}
          <p className="mb-3 break-keep rounded-2xl bg-danger-soft p-[12px_14px] text-[.82rem] font-bold leading-[1.7] text-danger">
            낱말로 걸러낸 표시라 그냥 지나가는 말일 수도 있어요. 아이에게는 표시된 사실을
            알리지 않았으니, 확인은 선생님이 편한 방식으로 해 주세요.
          </p>

          <ul className="no-scrollbar flex max-h-[48vh] flex-col gap-3 overflow-y-auto">
            {rows.map((m) => (
              <li key={m.id} className="rounded-2xl bg-canvas p-[14px_16px]">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {m.flagReason && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft p-[2px_8px] text-[.72rem] font-black text-danger">
                      <Icon name="alert" className="h-3 w-3" />
                      {m.flagReason}
                    </span>
                  )}
                  <span className="text-[.75rem] font-bold text-ink-mute">{when(m.createdAt)}</span>
                </div>

                <p className="break-keep text-[.9rem] font-black leading-[1.7]">{m.question}</p>

                {/*
                  말랑이가 뭐라고 답했는지도 보여준다 — 아이가 이미 어떤 말을 들었는지 모르면
                  선생님이 같은 말을 되풀이하거나 어긋난 말을 하게 된다.
                */}
                <p className="mt-2 break-keep border-l-[3px] border-mint pl-3 text-[.85rem] font-semibold leading-[1.7] text-ink-soft">
                  {m.answer}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </ModalShell>
  )
}
