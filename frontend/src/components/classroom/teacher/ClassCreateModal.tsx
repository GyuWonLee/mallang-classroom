import { useState } from 'react'
import { Input } from '@/components/common/Input'
import { ModalShell } from '@/components/common/ModalShell'
import { GRADE_PALETTE } from '@/lib/subject'
import { MAX_CLASS_GRADES, SELECTABLE_GRADES, type CreateClassroomInput } from '@/types/teacher'

/** 선생님 화면 입력창 사이즈 프리셋 (공용 Input 골격 위에 얹는다) */
const FIELD_CLS = 'p-[14px_16px] text-base focus:bg-white'

interface ClassCreateModalProps {
  open: boolean
  onClose: () => void
  onCreate: (input: CreateClassroomInput) => Promise<void>
}

/**
 * 새 학급 만들기 모달 — 이름 + 담당 학년 (ref teacher.html `#createModal`).
 *
 * 문구는 **학급**으로 통일했다(예전 "새 수업 만들기"). 여기서 만드는 것은 `Classroom` 이고,
 * '수업'은 그 안에서 학년을 골라 여는 실시간 세션이다.
 *
 * 국어 전용 서비스라 과목 선택은 없고, 단원도 받지 않는다(과제 쪽에서 다룬다).
 * 복식학급이므로 학년을 **1개 또는 2개** 고른다 — 여기서 고른 학년이 학급 화면의
 * "학년별 수업 시작" 카드로 그대로 이어진다.
 *
 * ref 의 "한 줄 소개"는 저장할 곳이 없다 — `POST /classrooms` 는 name·grades 만 받고
 * 학급 응답에도 소개 필드가 없다(docs/api-spec.md 2장). 입력을 받아 조용히 버리면
 * 선생님은 저장됐다고 믿게 되므로, 자리는 두되 **비활성 + 안내**로 사실을 밝힌다.
 */
export function ClassCreateModal({ open, onClose, onCreate }: ClassCreateModalProps) {
  const [name, setName] = useState('')
  const [grades, setGrades] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  if (!open) return null

  /** 2개까지만 — 꽉 찬 상태에서 새 학년을 누르면 가장 먼저 고른 것을 밀어낸다 */
  function toggleGrade(grade: number) {
    setGrades((prev) => {
      if (prev.includes(grade)) return prev.filter((g) => g !== grade)
      if (prev.length < MAX_CLASS_GRADES) return [...prev, grade].sort((a, b) => a - b)
      return [...prev.slice(1), grade].sort((a, b) => a - b)
    })
  }

  const canSubmit = name.trim().length > 0 && grades.length > 0 && !saving

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    try {
      await onCreate({ name: name.trim(), grades })
      setName('')
      setGrades([])
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      label="새 학급 만들기"
      width={460}
      title={<h2 className="text-[1.3rem] font-black">새 학급 만들기</h2>}
    >
      <div>
        <p className="mb-5 text-[.88rem] font-medium text-ink-soft">
          학급을 만들면 자동으로 담당 선생님이 돼요.
        </p>

        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-2 block text-base font-black">학급 이름</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 3·4학년 복식반 국어"
              className={FIELD_CLS}
            />
          </label>

          <div>
            <span className="mb-2 block text-base font-black">
              학년 구성
              <span className="ml-2 text-base font-medium text-ink-mute">
                (최대 {MAX_CLASS_GRADES}개 선택)
              </span>
            </span>
            {/*
              1~3학년 / 4~6학년 두 줄로 **고정 3열** 그리드에 담는다.
              예전엔 `flex flex-wrap` 이라 버튼 폭에 따라 줄바꿈이 정해져 윗줄 4개·아랫줄 2개로
              어긋났다. 저학년/고학년이 한 줄씩이면 찾기도 쉽다.

              체크 아이콘은 넣지 않는다 — 선택하는 순간 버튼 폭이 늘어나 옆 버튼들이 밀렸다.
              선택 여부는 색(테두리·배경)과 `aria-pressed` 로 알린다.
            */}
            <div className="grid grid-cols-3 gap-2">
              {SELECTABLE_GRADES.map((g) => {
                const on = grades.includes(g)
                const pal = GRADE_PALETTE[g]
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGrade(g)}
                    aria-pressed={on}
                    data-on={on}
                    className="inline-flex min-h-11 items-center justify-center rounded-full border-2 p-[11px_10px] text-[.95rem] font-extrabold transition-transform duration-200 ease-bounce hover:-translate-y-0.5 data-[on=false]:border-track data-[on=false]:bg-white data-[on=false]:text-ink-soft"
                    style={on ? { borderColor: pal.pillText, background: pal.pill, color: pal.pillText } : undefined}
                  >
                    {g}학년
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="mt-[22px] flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-canvas p-[13px_22px] text-[.92rem] font-black text-ink-soft hover:bg-track"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary p-[13px_22px] text-[.92rem] font-black text-white transition-transform duration-200 ease-bounce hover:-translate-y-0.5 disabled:opacity-50"
          >
            {saving ? '만드는 중…' : '학급 만들기'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
