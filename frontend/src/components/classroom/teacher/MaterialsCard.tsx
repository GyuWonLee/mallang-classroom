import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { MaterialPdfView } from '@/components/classroom/teacher/MaterialPdfView'
import { useToastStore } from '@/stores/useToastStore'
import { confirmAction } from '@/stores/useConfirmStore'
import { materialApi, validateMaterialFile } from '@/services/api/materialApi'
import { classroomApi } from '@/services/api/classroomApi'
import { SUBJECT_CODES, SUBJECT_LABEL } from '@/lib/subject'
import type { Subject } from '@/types/assignment'
import { cn } from '@/lib/cn'
import type { MaterialDetail, MaterialStatus, MaterialSummary } from '@/types/material'

/**
 * 학습자료 카드 — PDF 업로드 → 비동기 추출 → 미리보기 확인 → READY (백엔드 119).
 *
 * 업로드는 202 로 끝나고 추출이 백그라운드라, 올린 자료는 상태가 굳을 때까지 폴링한다.
 * PREVIEW 단계를 건너뛸 수 없게 한 건 스캔본·손글씨가 깨져 들어오는 걸 막기 위한 명세 요구사항이다.
 *
 * **학급 관리의 학습자료 탭과 라이브 수업의 빠른 도구가 함께 쓴다.** 예전에는
 * TeacherClassManagePage 안의 로컬 컴포넌트였는데, 라이브에서 그대로 쓰려면 페이지 파일을
 * import 해야 해서 **라이브 청크가 학급 관리 페이지를 통째로 끌고 왔다**(router.tsx 의
 * 코드 스플리팅 의도가 깨진다). 그래서 파일로 분리했다.
 */

const M_STATUS: Record<MaterialStatus, { label: string; cls: string }> = {
  PROCESSING: { label: '읽는 중…', cls: 'bg-track text-ink-soft' },
  PREVIEW: { label: '확인 필요', cls: 'bg-task text-task-deep' },
  READY: { label: '사용 가능', cls: 'bg-success text-success-deep' },
  FAILED: { label: '실패', cls: 'bg-danger-soft text-danger' },
}

/** ref .panel — radius --r-lg(28px) · padding 22px 24px */
const CARD_CLS = 'rounded-card bg-card p-[22px_24px] shadow-card'
const SECTION_TITLE = 'flex items-center gap-2 text-[1.05rem] font-black'
const TITLE_ICON = 'h-[22px] w-[22px] flex-none text-primary'

export function MaterialsCard({
  id,
  /**
   * 카드 껍데기(배경·그림자·패딩)를 그릴지. 라이브 화면은 이미 카드 안에 넣으므로
   * `false` 로 껍데기를 벗겨 카드가 이중으로 겹치지 않게 한다.
   */
  bare = false,
  /** 목록 최대 높이 — 라이브 화면은 아래로 길어지면 안 되므로 호출부가 줄일 수 있다 */
  listMaxHeight = 'max-h-[420px]',
}: {
  id: string
  bare?: boolean
  listMaxHeight?: string
}) {
  /**
   * 올릴 자료의 학년·과목 — **둘 다 선택**이다. 안 고르면 공용 자료가 되어 어느
   * 학년·과목에서도 고를 수 있다.
   *
   * 파일을 고르는 순간 함께 실어 보내므로, 고르기 전에 정해 두는 자리가 필요하다.
   * 필수로 만들지 않은 이유는 자료를 올리는 일 자체를 막지 않기 위해서다 — 정하지 않아도
   * 지금까지처럼 쓸 수 있고, 정하면 과제 만들기에서 목록이 좁혀진다.
   */
  const [upGrade, setUpGrade] = useState<number | null>(null)
  const [upSubject, setUpSubject] = useState<Subject | null>(null)
  /** 학급이 맡는 학년만 고르게 한다 — 서버도 그 밖의 학년은 400 으로 막는다 */
  const [classGrades, setClassGrades] = useState<number[]>([])
  const [items, setItems] = useState<MaterialSummary[]>([])
  const [preview, setPreview] = useState<MaterialDetail | null>(null)
  const [uploading, setUploading] = useState(false)
  const showToast = useToastStore((s) => s.show)

  const load = useCallback(
    () => void materialApi.list(id).then(setItems).catch(() => setItems([])),
    [id],
  )
  useEffect(load, [load])

  useEffect(() => {
    void classroomApi
      .getClassroom(id)
      .then((c) => setClassGrades([...(c.grades ?? [])].sort((a, b) => a - b)))
      .catch(() => setClassGrades([]))
  }, [id])

  async function upload(file: File) {
    const invalid = validateMaterialFile(file)
    if (invalid) return showToast(invalid)

    setUploading(true)
    try {
      const { materialId } = await materialApi.upload(id, file, { grade: upGrade, subject: upSubject })
      load()
      const settled = await materialApi.pollUntilSettled(materialId)
      load()
      if (settled.status === 'FAILED') {
        showToast(settled.failureReason ?? '자료를 읽지 못했어요. 다른 파일로 다시 시도해 주세요.')
      } else {
        setPreview(settled)
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : '자료를 올리지 못했어요.')
    } finally {
      setUploading(false)
    }
  }

  // 이름을 confirm 으로 두면 window.confirm 을 가려버린다 (아래 삭제 확인이 깨짐)
  async function confirmMaterial(materialId: number) {
    try {
      await materialApi.confirm(materialId)
      setPreview(null)
      load()
      showToast('자료를 사용할 수 있게 됐어요')
    } catch {
      showToast('확인 처리에 실패했어요. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <div className={bare ? undefined : CARD_CLS}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={SECTION_TITLE}>
          <Icon name="doc" className={TITLE_ICON} />
          학습자료 ({items.length})
        </h2>
        {/* label 이라 Button 프리미티브를 못 쓴다 — ref .btn/.btn-primary 수치를 그대로 적는다 */}
        <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary p-[13px_22px] text-[.92rem] font-black text-white shadow-[0_10px_22px_rgba(98,118,217,.3)] transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:bg-primary-hover">
          {uploading ? '올리는 중…' : 'PDF 올리기'}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void upload(file)
            }}
          />
        </label>
      </div>
      <p className="mt-1 text-[.85rem] font-medium text-ink-mute">
        PDF만 올릴 수 있어요 (20MB 이하).
      </p>

      {/*
        올릴 자료의 학년·과목 — **파일을 고르기 전에** 정한다. 고르는 순간 함께 실려 가기 때문이다.

        둘 다 선택이다. 정하면 과제 만들기에서 그 학년·과목을 골랐을 때만 목록에 떠서,
        비슷한 이름의 자료들 사이에서 헤매지 않는다. 안 정하면 지금까지처럼 어디서나 보인다 —
        필수로 만들면 자료를 올리는 일 자체가 무거워진다.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[.82rem] font-bold text-ink-soft">이 자료는</span>
        <select
          value={upGrade ?? ''}
          onChange={(e) => setUpGrade(e.target.value === '' ? null : Number(e.target.value))}
          aria-label="자료 학년"
          className="min-h-9 rounded-full border-[1.5px] border-track bg-canvas px-3 text-[.85rem] font-bold outline-none focus:border-primary"
        >
          <option value="">모든 학년</option>
          {classGrades.map((g) => (
            <option key={g} value={g}>
              {g}학년
            </option>
          ))}
        </select>
        <select
          value={upSubject ?? ''}
          onChange={(e) => setUpSubject((e.target.value || null) as Subject | null)}
          aria-label="자료 과목"
          className="min-h-9 rounded-full border-[1.5px] border-track bg-canvas px-3 text-[.85rem] font-bold outline-none focus:border-primary"
        >
          <option value="">모든 과목</option>
          {SUBJECT_CODES.map((c) => (
            <option key={c} value={c}>
              {SUBJECT_LABEL[c]}
            </option>
          ))}
        </select>
        <span className="text-[.82rem] font-bold text-ink-soft">자료예요</span>
      </div>


      {preview && (
        <div className="mt-4 rounded-[20px] border-2 border-task bg-task-soft p-5">
          <p className="text-[.95rem] font-black text-task-deep">
            “{preview.title}” 이 자료가 맞나요?
          </p>
          {/*
            **원본 PDF 를 먼저 보여준다.**

            예전에는 뜯어낸 텍스트만 있었다. 선생님이 올린 것은 PDF 인데 화면에는 글자 뭉치만
            있으니 "이게 내 자료가 맞나"를 판단하기 어려웠다 — 표·그림이 있는 자료일수록 심했다.

            그렇다고 텍스트를 없애지는 않는다. 이 단계가 있는 이유가 **추출이 제대로 됐는지**
            보는 것이라(스캔본·손글씨가 깨져 들어오는 걸 막는 명세 요구사항), 그 근거를 지우면
            확인 버튼이 형식만 남는다. 사람이 알아보는 것을 먼저 두고, 뜯어낸 글자는 펼쳐 본다.
          */}
          <MaterialPdfView
            fileId={preview.fileId}
            title={preview.title}
            className="mt-3 h-[420px] max-h-[52vh]"
          />
          <details className="mt-3 rounded-2xl bg-white p-3.5">
            <summary className="cursor-pointer text-[.85rem] font-bold text-task-deep">
              AI가 읽어 낸 내용 보기 (글자 {preview.extractedLength.toLocaleString()}자
              {preview.extractionSource === 'LLM' ? ' · 스캔본이라 AI가 읽었어요' : ''})
            </summary>
            <pre className="mt-2.5 max-h-48 overflow-y-auto whitespace-pre-wrap text-[.85rem] font-medium text-ink-soft">
              {preview.preview || '(추출된 텍스트가 없어요)'}
            </pre>
          </details>
          <p className="mt-2 text-[.82rem] font-bold text-task-deep">
            맞으면 확인해 주세요. 확인해야 과제 만들기에 쓸 수 있어요.
          </p>
          <div className="mt-3 flex gap-2.5">
            <Button className="flex-1" onClick={() => void confirmMaterial(preview.materialId)}>
              맞아요, 사용할게요
            </Button>
            {/* ref .btn 수치 + 흰 배경 (task-soft 위라 .btn-ghost 그림자는 얹지 않는다) */}
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="inline-flex min-h-11 flex-none items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white p-[13px_22px] text-[.92rem] font-black text-ink-soft transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:bg-canvas"
            >
              나중에
            </button>
          </div>
        </div>
      )}

      {/* 자료가 쌓여도 카드가 벽처럼 길어지지 않게 — 위쪽 "PDF 올리기"가 화면 밖으로 밀리면 안 된다 */}
      <ul className={cn('mt-4 flex flex-col gap-2 overflow-y-auto pr-0.5', listMaxHeight)}>
        {items.length === 0 && (
          <li>
            <EmptyState
              icon="folder"
              title="아직 올린 자료가 없어요"
              hint="위 “PDF 올리기” 버튼으로 첫 자료를 올려보세요."
              className="min-h-[240px]"
            />
          </li>
        )}
        {items.map((m) => {
          const badge = M_STATUS[m.status]
          return (
            /*
              줄마다 **흰 배경 + 그림자**로 띄운다. 예전엔 `bg-canvas` 였는데, 라이브 수업의
              '학습자료 · 과제' 작업판이 같은 canvas 색이라 **줄이 배경에 묻혀 서로 구분되지
              않았다**(자료가 몇 개인지 세려면 글자를 읽어야 했다). 옆 칸의 과제 목록은 이미
              `bg-card + shadow-card` 로 떠 있어서 두 칸의 생김새도 어긋나 있었다 —
              같은 처리로 맞춘다. 흰 카드 안(학급 관리 탭)에서도 그림자가 경계를 만든다.
            */
            <li
              key={m.materialId}
              className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-card"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[.98rem] font-black">{m.title}</span>
                <span className="mt-0.5 block text-[.82rem] font-semibold text-ink-soft">
                  {/* 무엇에 쓰이는 자료인지 — 과제 만들기에서 이 값으로 목록이 좁혀진다 */}
                  {[m.grade != null ? `${m.grade}학년` : null,
                    m.subject ? SUBJECT_LABEL[m.subject] : null]
                    .filter(Boolean)
                    .join(' · ') || '모든 학년·과목'}
                  {' · '}
                  {new Date(m.createdAt).toLocaleDateString('ko-KR')}
                  {m.failureReason ? ` · ${m.failureReason}` : ''}
                </span>
              </span>
              <span className={`flex-none whitespace-nowrap rounded-full px-3 py-1 text-[.8rem] font-black ${badge.cls}`}>
                {badge.label}
              </span>
              {m.status === 'PREVIEW' && (
                <button
                  type="button"
                  onClick={() =>
                    void materialApi
                      .get(m.materialId)
                      .then(setPreview)
                      .catch(() => showToast('미리보기를 불러오지 못했어요.'))
                  }
                  className="min-h-9 flex-none rounded-full px-3 py-1.5 text-[.82rem] font-bold text-primary hover:bg-sky"
                >
                  확인
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirmAction({
                    title: `'${m.title}' 자료를 삭제할까요?`,
                    message: '올린 파일과 읽어둔 내용이 함께 사라져요.',
                    confirmLabel: '자료 삭제',
                    danger: true,
                  })
                  if (!ok) return
                  void materialApi
                    .remove(m.materialId)
                    .then(load)
                    .catch(() => showToast('삭제하지 못했어요.'))
                }}
                className="min-h-9 flex-none rounded-full px-3 py-1.5 text-[.82rem] font-bold text-danger hover:bg-danger-soft"
              >
                삭제
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
