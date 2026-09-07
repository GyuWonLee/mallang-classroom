import { useCallback, useEffect, useState } from 'react'
import { ModalShell } from '@/components/common/ModalShell'
import { Icon } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { api } from '@/services/api/client'
import { materialApi } from '@/services/api/materialApi'
import { apiErrorMessage } from '@/lib/apiError'
import { SUBJECT_LABEL } from '@/lib/subject'
import { useToastStore } from '@/stores/useToastStore'
import type { MaterialSummary } from '@/types/material'

/**
 * 수업 중 PDF 공유 — **이미 올려 둔 학습자료에서 고른다.**
 *
 * <p>지금까지는 공유할 때마다 파일 대화상자가 열려 선생님이 디스크에서 파일을 찾아야 했다.
 * 그런데 그 자료는 대개 <b>학급에 이미 올라가 있는 것</b>이다 — 과제를 만들려고 올렸고,
 * 확인까지 마쳐 둔 바로 그 PDF다. 수업 중에 폴더를 뒤지게 하는 것은 그 자체로 수업이 멈추는
 * 시간이고, 잘못된 파일을 고르기도 쉽다.</p>
 *
 * <p>고르면 서버에서 원본을 받아 {@code File} 로 만들어 넘긴다. 발표기(PdfPresenter)는 지금도
 * 파일을 받으므로 그쪽은 손대지 않는다 — 파일을 어디서 얻느냐만 달라진다.</p>
 *
 * <p>확인을 마친 자료(READY)만 보여준다. 추출이 덜 끝났거나 실패한 자료는 과제 만들기에서도
 * 못 쓰는 것이라, 여기서만 쓸 수 있게 하면 "확인" 단계의 뜻이 흐려진다.</p>
 */
export function PickLessonMaterialModal({
  classroomId,
  onPick,
  onClose,
}: {
  classroomId: string
  /** 받아 온 원본 PDF — 호출부가 그대로 발표기에 넘긴다 */
  onPick: (file: File) => void
  onClose: () => void
}) {
  const showToast = useToastStore((s) => s.show)
  const [items, setItems] = useState<MaterialSummary[] | null>(null)
  /** 지금 받아 오는 중인 자료 — 큰 파일은 몇 초 걸린다 */
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void materialApi
      .list(classroomId)
      .then((list) => {
        if (!cancelled) setItems(list.filter((m) => m.status === 'READY'))
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [classroomId])

  const pick = useCallback(
    async (m: MaterialSummary) => {
      if (!m.fileId) {
        showToast('이 자료는 원본 파일을 찾을 수 없어요.')
        return
      }
      setBusyId(m.materialId)
      try {
        /*
          파일 조회에는 인증 헤더가 필요해 주소를 그대로 넘길 수 없다 — 바이트를 받아
          File 로 만든다. 이름을 자료 제목으로 두면 발표 화면에 그 이름이 그대로 뜬다.
        */
        const { data } = await api.get<Blob>(`/files/${m.fileId}/content`, {
          responseType: 'blob',
        })
        onPick(new File([data], m.title, { type: 'application/pdf' }))
      } catch (err) {
        showToast(apiErrorMessage(err, '자료를 불러오지 못했어요.'))
      } finally {
        setBusyId(null)
      }
    },
    [onPick, showToast],
  )

  return (
    <ModalShell open onClose={onClose} label="수업 자료 고르기" width={520}>
      <h2 className="mb-1 text-center text-[1.3rem] font-black">수업 자료 고르기</h2>
      <p className="mb-4 text-center text-[.86rem] font-semibold text-ink-mute">
        학급에 올려 둔 자료를 바로 띄울 수 있어요.
      </p>

      {items === null ? (
        <p className="p-6 text-center text-[.88rem] font-semibold text-ink-mute">
          자료를 불러오는 중…
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon="folder"
          title="쓸 수 있는 자료가 없어요"
          hint="학급 관리 → 학습자료에서 PDF를 올리고 내용을 확인해 주세요."
          className="min-h-[200px]"
        />
      ) : (
        <ul className="flex max-h-[340px] flex-col gap-2 overflow-y-auto pr-0.5">
          {items.map((m) => (
            <li key={m.materialId}>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void pick(m)}
                className="flex w-full items-center gap-3 rounded-2xl border-2 border-canvas bg-canvas p-[12px_14px] text-left transition-colors hover:border-primary hover:bg-sky/50 disabled:opacity-50"
              >
                <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-white text-primary">
                  <Icon name="doc" className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[.98rem] font-black">{m.title}</span>
                  <span className="mt-0.5 block text-[.8rem] font-semibold text-ink-soft">
                    {[
                      m.grade != null ? `${m.grade}학년` : null,
                      m.subject ? SUBJECT_LABEL[m.subject] : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '모든 학년·과목'}
                  </span>
                </span>
                {busyId === m.materialId && (
                  <span className="flex-none text-[.8rem] font-bold text-primary">여는 중…</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  )
}
