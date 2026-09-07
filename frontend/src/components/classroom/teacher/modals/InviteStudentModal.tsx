import { useEffect, useState } from 'react'
import { ModalShell, MODAL_SUB } from '@/components/common/ModalShell'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { classroomApi } from '@/services/api/classroomApi'
import { useStudentsStore } from '@/stores/useStudentsStore'
import { useToastStore } from '@/stores/useToastStore'
import { downloadCredentialsCsv, printCredentialSlips } from '@/lib/studentCredentials'
import { apiErrorMessage } from '@/lib/apiError'
import { SELECTABLE_GRADES, type StudentAccount, type StudentCsvRow } from '@/types/teacher'

/**
 * 학생 초대 — 레퍼런스 teacher.html `inviteStudentModal` 이관.
 *
 * 길은 **직접 발급 하나**다: 이름/학교/학년을 넣으면 서버가 아이디·임시 비밀번호를 만들어 준다.
 * 임시 비밀번호는 발급 응답에서 **딱 한 번만** 내려오므로, 발급 목록에 남겨 두고
 * 눌러서 복사할 수 있게 한다 (모달을 닫으면 다시 볼 수 없다).
 *
 * 학부모 이메일은 선택이고, 넣으면 서버가 그 주소로도 안내 메일을 보낸다. CSV 일괄 등록은
 * 4번째 열로 이 값을 처음부터 받고 있었는데 **단건 발급 폼에만 칸이 없어서**, 한 명씩 추가하면
 * 메일이 나가지 않았다 — 백엔드는 손댈 게 없었고 보낼 값이 없었을 뿐이다.
 *
 * 예전에는 위에 **초대 코드 상자**(STUDENT 초대 발급/링크 복사/즉시 만료)가 한 갈래로 더 있었다.
 * 쓰지 않기로 해서 지웠다 — 선생님이 계정을 직접 발급하는 길만 남는다.
 * (선생님끼리의 초대 코드는 그대로다 — "선생님 초대" 모달이 맡는다.)
 */
export function InviteStudentModal({
  classroomId,
  onClose,
}: {
  classroomId: string
  onClose: () => void
}) {
  const create = useStudentsStore((s) => s.create)
  const createBulk = useStudentsStore((s) => s.createBulk)
  const showToast = useToastStore((s) => s.show)

  const [name, setName] = useState('')
  /**
   * 학교명 — 서버 `CreateStudentRequest.school` 은 `@NotBlank` 필수이고 학생 계정에 그대로
   * 저장된다. 예전엔 `'말랑초등학교'` 를 코드에 박아 보내서 **어느 학교 선생님이 쓰든 모든
   * 학생 계정의 소속이 그 값으로 저장됐다.** 바로 아래 CSV 일괄 등록은 학교를 열로 받는데
   * 단건 발급만 못 넣고 있었다.
   *
   * 기본값은 학급 상세의 `school`(= OWNER 선생님 소속)에서 가져오고, 필요하면 고칠 수 있게 둔다.
   */
  const [school, setSchool] = useState('')
  /**
   * 담당 학년 — 학급 상세의 `grades` 에서 온다(복식학급이라 보통 2개).
   *
   * 예전엔 `useState(3)` 이었고 칩도 1~6 전체를 나열해서, **1·2학년 복식반 선생님이 칩을
   * 건드리지 않으면 3학년 학생이 만들어졌다.** 바로 위 `school` 이 이미 겪은 문제와 같다.
   * 학급에 없는 학년은 고를 수 없어야 하므로 목록 자체를 학급 것으로 좁힌다.
   */
  const [grades, setGrades] = useState<number[]>([])
  const [grade, setGrade] = useState<number | null>(null)
  /**
   * 학부모 이메일 — 선택. 넣으면 서버가 아이디·임시 비밀번호 안내 메일을 그 주소로 보낸다.
   *
   * CSV 일괄 등록은 4번째 열로 이걸 이미 받고 있었는데 **단건 발급만 보낼 길이 없어서**,
   * 한 명씩 추가하면 메일이 나가지 않았다. 백엔드는 세 경로(학급 생성 동시 등록·CSV·단건)가
   * 모두 같은 발급 함수를 지나므로 값만 실어 보내면 된다.
   *
   * 학생마다 다른 값이라 학교·학년과 달리 **추가할 때마다 비운다**.
   */
  const [parentEmail, setParentEmail] = useState('')
  const [saving, setSaving] = useState(false)
  /** 이번에 발급한 계정들 (ref .added-student-item) */
  const [added, setAdded] = useState<StudentAccount[]>([])
  /** 내려받는 파일과 배부표 제목에만 쓴다 — 어느 학급 것인지 나중에 구분하려고 */
  const [classroomName, setClassroomName] = useState('')

  /**
   * CSV 확인 절차 — 고른 파일과 서버가 읽어 준 행들. 둘 다 있으면 확인 화면이 뜬다.
   *
   * 예전에는 파일을 고르는 **순간** 계정이 만들어졌다. 열이 밀린 파일이나 남의 반 명단을
   * 잘못 올려도 되돌릴 방법이 없었다(학생 삭제는 한 명씩이다). 이제 한 번 확인하고 등록한다.
   *
   * 읽는 일은 서버에 맡긴다(`previewStudentsBulk`). 여기서 CSV 를 직접 파싱하면 인코딩
   * 판정(UTF-8/CP949)·헤더 인식·따옴표가 서버와 조금씩 어긋나, 확인 화면에서 본 것과 실제로
   * 등록되는 것이 달라진다 — 그러면 확인 절차가 오히려 거짓말이 된다.
   *
   * 파일은 등록할 때 한 번 더 올라간다. 서버가 미리보기를 들고 있지 않는 편이 단순하다.
   */
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvRows, setCsvRows] = useState<StudentCsvRow[] | null>(null)
  const [csvBusy, setCsvBusy] = useState(false)

  /** 파일을 서버에 읽혀 보고 확인 화면을 연다. 이 단계에서는 아무것도 만들어지지 않는다. */
  async function openPreview(file: File) {
    setCsvBusy(true)
    try {
      const rows = await classroomApi.previewStudentsBulk(classroomId, file)
      setCsvFile(file)
      setCsvRows(rows)
    } catch (err) {
      // 서버 메시지에 몇 행이 왜 틀렸는지가 들어 있다 — 통째로 덮어쓰지 않는다
      showToast(
        apiErrorMessage(err, 'CSV를 읽지 못했어요. 형식(이름,학교,학년[,학부모이메일])을 확인해 주세요.'),
      )
    } finally {
      setCsvBusy(false)
    }
  }

  function cancelPreview() {
    setCsvFile(null)
    setCsvRows(null)
  }

  /**
   * 확인 뒤 실제 등록. 여기서 처음으로 계정이 만들어지고 안내 메일이 나간다.
   *
   * **등록하고 창을 닫지 않는다.** 임시 비밀번호는 이 응답에만 담겨 오고 서버가 다시 주지
   * 않는다 — 닫아 버리면 방금 만든 계정의 비밀번호를 아무도 못 보고, 아래 [CSV 내려받기]·
   * [배부표 인쇄]도 이 목록(`added`)에만 붙어 있어 함께 사라진다. 확인 화면을 접고 발급
   * 목록을 보여주는 것이 이 창의 원래 흐름이다(한 명씩 추가할 때와 같은 자리).
   */
  async function confirmCsv() {
    if (!csvFile || csvBusy) return
    setCsvBusy(true)
    try {
      const accounts = await createBulk(classroomId, csvFile)
      // 발급 목록에 남긴다 — `createBulk` 는 개수가 아니라 계정 배열을 돌려준다
      setAdded((prev) => [...accounts, ...prev])
      setCsvFile(null)
      setCsvRows(null)
      showToast(`CSV로 학생 ${accounts.length}명을 등록했어요`)
    } catch (err) {
      showToast(apiErrorMessage(err, '학생을 등록하지 못했어요. 잠시 후 다시 시도해 주세요.'))
    } finally {
      setCsvBusy(false)
    }
  }

  // 학교명·담당 학년 기본값 — 학급 상세에서 온다 (school 은 OWNER 선생님 소속)
  useEffect(() => {
    void classroomApi
      .getClassroom(classroomId)
      .then((c) => {
        setSchool((prev) => prev || c.school || '')
        setClassroomName(c.name ?? '')
        const list = [...(c.grades ?? [])].sort((a, b) => a - b)
        setGrades(list)
        // 복식학급이라 보통 2개다 — 하나뿐이면 고민할 게 없으니 미리 골라 둔다
        setGrade((prev) => prev ?? (list.length === 1 ? list[0] : null))
      })
      .catch(() => {
        /* 못 받아도 입력칸에 직접 적을 수 있다 — 가짜 기본값을 넣지는 않는다 */
      })
  }, [classroomId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // 학년은 서버가 `@NotNull` 로 받는다 — 버튼도 막지만 여기서 한 번 더 확인한다
    if (!name.trim() || !school.trim() || grade === null || saving) return

    /*
      형식이 틀린 주소는 서버 `@Email` 에 걸려 **계정 생성까지 400 으로 함께 실패한다** —
      메일만 못 가는 게 아니라 학생이 아예 안 만들어진다. 여기서 먼저 막고 무엇이 문제인지
      말해 준다. 판정은 서버(Hibernate Validator)보다 느슨하게 "@ 앞뒤가 있고 공백이 없다"
      정도만 본다 — 화면이 서버보다 엄격하면 멀쩡한 주소를 거절하게 된다.
    */
    const email = parentEmail.trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('학부모 이메일 주소를 다시 확인해 주세요.')
      return
    }

    setSaving(true)
    try {
      const account = await create(classroomId, {
        name: name.trim(),
        school: school.trim(),
        grade,
        // 안 적었으면 키 자체를 뺀다 — 서버는 null 일 때만 "메일 없음"으로 본다
        ...(email ? { parentEmail: email } : {}),
      })
      setAdded((prev) => [account, ...prev])
      setName('')
      setParentEmail('')
      // 발송은 커밋 뒤 비동기라 응답에 결과가 없다 — "보냈어요"로 단정하지 않는다
      showToast(
        email
          ? `${account.name} 학생을 등록했어요. 안내 메일을 보내는 중이에요`
          : `${account.name} 학생을 등록했어요`,
      )
    } catch {
      showToast('학생 계정을 만들지 못했어요. 이름을 확인하고 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      label={csvRows ? 'CSV 등록 확인' : '학생 초대'}
      width={480}
      title={
        <h2 className="text-[1.3rem] font-black">{csvRows ? 'CSV 등록 확인' : '학생 초대'}</h2>
      }
    >
      {/*
        확인 화면은 한 명씩 추가하는 폼을 **덮는다**. 나란히 두면 "추가" 버튼과 "등록하기"
        버튼이 한 화면에 같이 있어, 확인하려던 사람이 엉뚱한 쪽을 누른다.
      */}
      {csvRows ? (
        <>
          <p className={MODAL_SUB}>
            {csvFile?.name} — 아래 {csvRows.length}명이 등록돼요. 아직 만들어지지 않았어요.
          </p>

          <div className="mt-3 flex max-h-[280px] flex-col gap-2 overflow-y-auto">
            {csvRows.map((r, i) => (
              // CSV 에는 고유 키가 없다 — 같은 이름이 둘일 수 있어 순서를 키로 쓴다.
              // 확인 화면은 다시 정렬되거나 지워지지 않으므로 순서가 안정적이다.
              <div
                key={i}
                className="flex items-center gap-2.5 rounded-[14px] bg-canvas p-[10px_14px]"
              >
                <span className="text-[.86rem] font-extrabold">{r.name}</span>
                <span className="text-[.8rem] font-semibold text-ink-soft">
                  {r.school} · {r.grade}학년
                </span>
                {/* 메일이 갈 행과 안 갈 행을 구분해 준다 — 확인해야 할 것이 바로 이것이다 */}
                <span className="ml-auto truncate text-[.78rem] font-semibold text-ink-mute">
                  {r.parentEmail ?? '메일 없음'}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-2.5 text-[.82rem] font-medium text-ink-soft">
            등록하면 되돌릴 수 없어요. 잘못 올렸다면 취소하고 파일을 다시 고르세요.
            <br />
            학부모 이메일이 적힌 학생은 그 주소로 안내 메일이 가요.
          </p>

          <div className="mt-3.5 flex gap-2.5">
            <Button
              type="button"
              variant="soft"
              className="flex-1"
              disabled={csvBusy}
              onClick={cancelPreview}
            >
              취소
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={csvBusy}
              onClick={() => void confirmCsv()}
            >
              {csvBusy ? '등록 중…' : `${csvRows.length}명 등록하기`}
            </Button>
          </div>
        </>
      ) : (
        <>
      {/* 갈래가 하나뿐이라 "코드를 공유하거나" 를 뺐다 — 없는 길을 안내문에 남겨 두지 않는다 */}
      <p className={MODAL_SUB}>이름과 학년을 넣으면 아이디·비밀번호를 만들어 등록해요.</p>

      <form onSubmit={(e) => void submit(e)}>
        <div className="mb-4">
          <span className="mb-2 block text-[1rem] font-black">학년 모둠</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="학년 모둠">
            {/* 학급의 담당 학년만 — 없는 학년으로 계정을 만들면 팀 배정이 어긋난다 */}
            {(grades.length ? grades : SELECTABLE_GRADES).map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={grade === g}
                onClick={() => setGrade(g)}
                data-active={grade === g}
                className="min-h-11 rounded-full border-2 border-canvas bg-canvas p-[11px_18px] text-[.95rem] font-extrabold text-ink-soft transition-transform duration-200 ease-bounce hover:-translate-y-0.5 data-[active=true]:border-primary data-[active=true]:bg-primary data-[active=true]:text-white"
              >
                {g}학년
              </button>
            ))}
          </div>
        </div>

        {/* 학교는 학생 계정에 저장되는 값이라 화면에서 확인·수정할 수 있어야 한다 */}
        <label className="mb-4 block">
          <span className="mb-2 block text-[1rem] font-black">학교</span>
          <Input
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            placeholder="예: 은솔초등학교"
            className="p-[14px_16px] text-[1rem] focus:bg-white"
          />
        </label>

        {/*
          학부모 이메일 — 선택. 이름 바로 위에 둔다: 아래 [추가] 버튼과 한 줄로 묶인 이름 칸
          사이에 끼우면 그 줄이 깨진다.
        */}
        <label className="mb-4 block">
          <span className="mb-2 block text-[1rem] font-black">
            학부모 이메일 <span className="font-extrabold text-ink-soft">(선택)</span>
          </span>
          <Input
            type="email"
            autoComplete="off"
            value={parentEmail}
            onChange={(e) => setParentEmail(e.target.value)}
            placeholder="예: parent@example.com"
            className="p-[14px_16px] text-[1rem] focus:bg-white"
          />
        </label>

        {/* ref .manual-add-row — 이름 입력과 [추가] 버튼이 한 줄 */}
        <div className="flex items-end gap-2.5">
          <label className="min-w-0 flex-1">
            <span className="mb-2 block text-[1rem] font-black">학생 이름</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 박지민"
              className="p-[14px_16px] text-[1rem] focus:bg-white"
            />
          </label>
          <Button
            type="submit"
            size="sm"
            variant="soft"
            className="flex-none"
            disabled={!name.trim() || !school.trim() || grade === null || saving}
          >
            {saving ? '추가 중…' : '추가'}
          </Button>
        </div>
        <p className="mt-1.5 text-[.82rem] font-medium text-ink-soft">
          아이디/임시 비밀번호가 자동 생성돼요.
          <br />
          승인 절차 없이 바로 학급에 등록돼요.
          <br />
          학부모 이메일을 넣으면 그 주소로도 안내 메일이 가요.
        </p>
      </form>

      {/* 발급분을 통째로 내보내는 길. 한 명씩 복사하는 것으로는 한 반을 감당할 수 없다. */}
      {added.length > 0 && (
        <div className="mt-3.5 rounded-[18px] border-2 border-task bg-task-soft p-3.5">
          <p className="text-[.9rem] font-black text-task-deep">
            이번에 발급한 {added.length}명 — 지금만 볼 수 있어요
          </p>
          <p className="mt-1 text-[.82rem] font-semibold leading-[1.6] text-task-deep">
            창을 닫으면 임시 비밀번호를 다시 볼 수 없어요. 내려받거나 인쇄해 두세요.
          </p>
          <div className="mt-2.5 flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => {
                downloadCredentialsCsv(added, classroomName)
                showToast('CSV로 내려받았어요')
              }}
            >
              CSV 내려받기
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={() => {
                if (!printCredentialSlips(added, classroomName)) {
                  showToast('팝업이 차단됐어요. 이 사이트의 팝업을 허용해 주세요.')
                }
              }}
            >
              배부표 인쇄
            </Button>
          </div>
        </div>
      )}

      {/* ref .added-student-item — 임시 비밀번호는 지금만 보이므로 눌러서 복사하게 한다 */}
      {added.length > 0 && (
        <div className="mt-2 flex max-h-[180px] flex-col overflow-y-auto">
          {added.map((s) => (
            <button
              key={s.userId}
              type="button"
              aria-label={`${s.name} 학생 아이디와 임시 비밀번호 복사`}
              onClick={() => {
                void navigator.clipboard?.writeText(`${s.username} / ${s.temporaryPassword ?? ''}`)
                showToast('아이디·비밀번호를 복사했어요')
              }}
              className="mt-2 flex items-center gap-2.5 rounded-[14px] bg-canvas p-[10px_14px] text-left transition-colors hover:bg-sky"
            >
              <span className="text-[.86rem] font-extrabold">{s.name}</span>
              <span className="ml-auto truncate font-mono text-[.78rem] text-ink-soft">
                {s.username} / {s.temporaryPassword ?? '-'}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* CSV 일괄 발급은 실제로 동작하는 기능이라 남긴다 (ref 구조 아래) */}
      {/* label 이라 Button 프리미티브를 못 쓴다 — ref .btn 수치(13px 22px / .92rem / min 44)를 그대로 */}
      <label
        aria-disabled={csvBusy || undefined}
        className="mt-3.5 flex min-h-11 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full bg-canvas p-[13px_22px] text-[.92rem] font-black text-ink-soft transition-colors hover:bg-track aria-disabled:cursor-progress aria-disabled:opacity-60"
      >
        {/* 4번째 열(학부모 이메일)은 파서가 이미 받는다 — 안 알려 주면 아무도 안 쓴다 */}
        {csvBusy ? '파일을 읽는 중…' : '여러 명이면 CSV로 한 번에 (이름,학교,학년[,학부모이메일])'}
        <input
          type="file"
          accept=".csv"
          className="hidden"
          disabled={csvBusy}
          /*
            고르는 즉시 등록하지 않는다 — 먼저 서버에 읽혀 보고 확인 화면을 연다(openPreview).
            실제 발급은 거기서 [N명 등록하기] 를 누른 뒤 confirmCsv 가 한다.
          */
          onChange={(e) => {
            const file = e.target.files?.[0]
            // 같은 파일을 다시 고를 수 있게 즉시 비운다 (취소하고 재시도하는 흐름이 있다)
            e.target.value = ''
            if (!file) return
            /*
              파일을 고르는 것으로 계정이 만들어지지 않는다 — 서버에 읽혀 보고 **확인 화면**을
              띄운다(`openPreview`). 실제 등록은 그 화면의 [등록하기]가 한다(`confirmCsv`).
            */
            void openPreview(file)
          }}
        />
      </label>
        </>
      )}
    </ModalShell>
  )
}
