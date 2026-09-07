import { useCallback, useEffect, useMemo, useState } from 'react'
import { ModalShell } from '@/components/common/ModalShell'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { Icon, type IconName } from '@/components/common/Icon'
import { assignmentApi, draftToCreateRequest } from '@/services/api/assignmentApi'
import { materialApi, validateMaterialFile } from '@/services/api/materialApi'
import { classroomApi } from '@/services/api/classroomApi'
import { useToastStore } from '@/stores/useToastStore'
import type { AssignmentDraft, AssignmentProblem, AssignmentType, Subject } from '@/types/assignment'
import { SUBJECT_CODES, SUBJECT_LABEL } from '@/lib/subject'
import { cn } from '@/lib/cn'
import { ProblemReviewList } from '@/components/classroom/teacher/assignments/ProblemReviewList'
import { AiGeneratingView } from './AiGeneratingView'
import { MaterialPdfView } from '@/components/classroom/teacher/MaterialPdfView'
import type { MaterialDetail, MaterialSummary } from '@/types/material'
import { SELECTABLE_GRADES, type StudentAccount } from '@/types/teacher'

const TYPES: { value: AssignmentType; label: string; hint: string; icon: IconName }[] = [
  { value: 'DICTATION', label: '받아쓰기', hint: '소리를 듣고 낱말 쓰기', icon: 'edit' },
  { value: 'MULTIPLE_CHOICE', label: '객관식', hint: '보기 중 하나 고르기', icon: 'checklist' },
  /*
    PARTICLE_CHOICE('조사 고르기')는 **새로 만드는 목록에서 뺐다.**
    타입(`types/assignment.ts`)과 라벨/아이콘 맵들에는 그대로 남겨 둔다 — 백엔드 enum·DB 에
    값이 살아 있어 **이미 만들어진 조사 고르기 과제가 계속 응답에 실려 오기 때문**이다.
    유니온에서 지우면 `Record<AssignmentType, ...>` 맵들이 깨지고, 키를 지우면 학생
    '활동지' 부제와 선생님 상세 모달의 유형 라벨이 빈칸이 된다.
  */
  { value: 'OX', label: 'OX 퀴즈', hint: '맞는지 틀린지 고르기', icon: 'check' },
  /*
    QUIZ_GAME 은 백엔드가 생성까지 지원한다(GenerationPrompt: "OX 또는 객관식 문항으로 출제").
    별도 문항 스키마가 없는 **표시 모드**라 학생 화면은 문항 보기에 따라 OX/객관식으로 그린다.
    예전엔 이 유형이 목록에 없어서 **과제 목록 필터에는 이름이 있는데 만들 수는 없었다.**
  */
  { value: 'QUIZ_GAME', label: '퀴즈 게임', hint: '놀이처럼 풀기 (OX·객관식 섞어서)', icon: 'star' },
]

/**
 * 받아쓰기를 만들 수 있는 과목 — **서버가 정한 목록이다.**
 *
 * `AssignmentGenerationService` 가 이 둘이 아닌 과목으로 DICTATION 을 받으면 400
 * (`dictation-subject-not-allowed`)으로 거절한다. 읽을 문장이 있어야 받아쓰기가 되는데
 * 수학·사회·과학 자료에는 그럴 만한 본문이 없어서다.
 *
 * 화면에서 미리 막는다 — 서버 거절에 맡기면 선생님이 학년·자료·문항 수를 다 고르고
 * [만들기] 를 누른 뒤에야 "안 된다"를 듣는다.
 */
const DICTATION_SUBJECTS: readonly Subject[] = ['KOREAN', 'ENGLISH']

/**
 * 한 번에 고를 수 있는 학습자료 수 — 서버 `GenerateRequest.materialIds @Size(max = 5)`.
 *
 * 자료를 많이 실을수록 프롬프트가 길어져 생성이 느려지고 잘려 나가는 부분이 생긴다
 * (`MaterialSource` 가 자료당 8,000자·합계 20,000자에서 조용히 자른다).
 */
const MATERIAL_MAX = 5
/**
 * 문항 수 **빠른 선택**. 수업 한 차시에 현실적인 분량 3개다 —
 * 이 셋에 없는 수는 옆 직접 입력 칸으로 넣는다.
 */
const COUNTS = [3, 5, 10]
/** 서버 허용 범위 — `GenerateRequest @Min(1) @Max(30)`. 직접 입력 칸이 이 안에서만 받는다 */
const COUNT_MIN = 1
const COUNT_MAX = 30
const STEPS = ['유형 고르기', '내용 정하기', '검수하고 발행하기']

/** ref .review-box / .review-row — 만들기 전에 정한 값을 한 표로 다시 확인시킨다 */
function ReviewBox({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="mb-4 rounded-[18px] bg-canvas p-[18px_20px]">
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex justify-between gap-3 border-b border-b-[#EFEFEF] py-[7px] text-[.88rem] last:border-b-0"
        >
          <span className="flex-none font-bold text-ink-soft">{r.label}</span>
          <span className="min-w-0 truncate font-black">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * AI 과제 만들기 마법사 — 레퍼런스 teacher.html `wizardModal` 이관.
 *
 * 입력이 3단계 이상이면 한 화면에 몰지 않고 단계로 쪼갠다(DESIGN_GUIDELINES 6장).
 *
 * 백엔드 계약(108) 반영:
 *  - 생성 요청에 `topic` 같은 자유 입력은 없다. 근거 자료 `materialIds` 가 필수라
 *    지금은 학년별 내장 어휘 자료(`builtin-korean-g{학년}`)를 자동으로 붙인다.
 *    (업로드 PDF 는 백엔드가 아직 생성에 못 쓴다 — MaterialSource.java)
 *  - 생성은 비동기다. 202 로 jobId 만 받고 DONE/FAILED 까지 폴링한다.
 *  - **초안을 바로 저장하지 않는다.** 명세 §7 의 "AI 초안 → 선생님 검수 → 저장" 2단계를 지킨다.
 */
export function AssignmentWizardModal({
  classroomId,
  onClose,
}: {
  classroomId: string
  onClose: () => void
}) {
  const showToast = useToastStore((s) => s.show)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [type, setType] = useState<AssignmentType>('MULTIPLE_CHOICE')
  /**
   * 과목 — 백엔드가 국영수사과 5과목을 실제로 지원한다(S15P11A407-145).
   *
   * 예전엔 `subject: 'KOREAN'` 을 생성 호출에 박아 보냈다. 과목이 국어·한자뿐이고 한자는
   * 만들 길이 없던 시절엔 맞는 값이었지만, 지금은 **선생님이 만든 수학 과제가 국어로
   * 저장되는** 셈이 된다(목록의 과목 알약·학생 이해도 집계가 다 어긋난다).
   *
   * 기본값은 국어로 둔다 — 국어만 고정 태그 사전이 있어(`GenerationPrompt.KOREAN_TAGS`)
   * 개념별 집계가 가장 잘 나오는 과목이고, 이 앱의 주된 쓰임새이기도 하다.
   */
  const [subject, setSubject] = useState<Subject>('KOREAN')
  /**
   * 출제 학년 — 학급의 담당 학년에서 온다(아래 effect 가 채운다).
   *
   * 예전엔 `useState(3)` + 칩 1~6 전체였다. AI 문제 난이도가 이 값으로 정해지는데,
   * 1·2학년 복식반 선생님이 칩을 건드리지 않으면 **3학년 난이도 문제가 생성됐다.**
   */
  const [grades, setGrades] = useState<number[]>([])
  const [grade, setGrade] = useState<number | null>(null)
  const [count, setCount] = useState(5)
  /**
   * 직접 입력 칸의 **글자 그대로**. `count` 를 그대로 쓰지 않는 이유 — 지우는 중(빈 칸)이나
   * `0` 처럼 아직 범위를 벗어난 중간 상태를 숫자 상태에 담으면 그 값으로 생성이 시작된다.
   * 유효한 값일 때만 `count` 로 옮기고, 빠른 선택 칩을 누르면 이 칸은 비운다.
   */
  const [customCount, setCustomCount] = useState('')

  /*
    근거 학습자료 — 서버가 `materialIds` 를 `@NotEmpty` 로 받으므로 **최소 하나는 있어야** 한다.
    예전에는 화면에 선택 UI 없이 `builtinMaterialId(grade)` 로 학년별 내장 자료를 자동으로
    넣었다(백엔드가 업로드 자료를 아직 못 읽던 시절의 우회). 지금은 서버가 MATERIAL 테이블을
    읽으므로 선생님이 올린 자료를 직접 고른다.
  */
  const [materials, setMaterials] = useState<MaterialSummary[]>([])
  const [materialsLoading, setMaterialsLoading] = useState(true)
  const [materialIds, setMaterialIds] = useState<string[]>([])

  /*
    공개 대상 — **둘 중 하나**다: 앞에서 고른 학년 전체(`grade`) 또는 학생 골라내기(`students`).

    예전엔 '학급 전체' 가 따로 있었고 그게 기본이었다. 없앴다: 이 마법사는 앞 단계에서 학년을
    **필수로** 고르게 하는데(6학년 자료로 6학년 문항을 만든다), 대상이 학급 전체면 그렇게 만든
    과제가 5학년에게도 나갔다 — 만든 사람의 의도와 어긋난다. '6학년만' 이 사실상 기본 동작이라
    같은 뜻의 선택지가 둘이었던 셈이기도 하다.

    서버는 `targetGrades`·`targetStudentIds` 를 **합집합**으로 판정하고 둘 다 비면 학급 전체로
    읽는다(`Assignment.isVisibleTo`). 그래서 화면에서 하나만 고르게 하고, 아래 저장부에서
    **둘 중 하나는 반드시 채운다** — 비워 두면 서버가 학급 전체로 읽어 버린다.
  */
  const [target, setTarget] = useState<'grade' | 'students'>('grade')
  const [pickedStudents, setPickedStudents] = useState<Set<number>>(new Set())
  const [roster, setRoster] = useState<StudentAccount[]>([])
  const [rosterError, setRosterError] = useState(false)

  // 대상 학생을 고를 때만 명단이 필요하다 — 마법사를 열 때마다 부르지 않는다
  useEffect(() => {
    if (target !== 'students' || roster.length > 0) return
    let cancelled = false
    void classroomApi
      .listStudents(classroomId)
      .then((list) => {
        if (!cancelled) setRoster(list)
      })
      .catch(() => {
        if (!cancelled) setRosterError(true)
      })
    return () => {
      cancelled = true
    }
  }, [target, classroomId, roster.length])

  // 담당 학년 — 학급에 없는 학년으로 출제하지 않도록 목록을 좁힌다
  useEffect(() => {
    let cancelled = false
    void classroomApi
      .getClassroom(classroomId)
      .then((c) => {
        if (cancelled) return
        const list = [...(c.grades ?? [])].sort((a, b) => a - b)
        setGrades(list)
        // 하나뿐이면 고를 게 없다 — 복식학급이면 선생님이 직접 고른다
        setGrade((prev) => prev ?? (list.length === 1 ? list[0] : null))
      })
      .catch(() => {
        /* 못 받으면 아래 폴백(1~6)이 뜬다 — 선생님이 직접 고른다 */
      })
    return () => {
      cancelled = true
    }
  }, [classroomId])

  /**
   * 자료 목록 다시 읽기 — 마운트할 때와 **여기서 PDF 를 새로 올린 뒤**에 쓴다.
   * 올린 자료가 목록에 안 들어오면 다음 단계에서 고를 수 없어 방금 한 일이 헛일이 된다.
   */
  const loadMaterials = useCallback(
    () =>
      materialApi
        .list(classroomId)
        .then(setMaterials)
        .catch(() => setMaterials([]))
        .finally(() => setMaterialsLoading(false)),
    [classroomId],
  )
  useEffect(() => {
    void loadMaterials()
  }, [loadMaterials])

  /* 업로드 상태 — 추출이 끝나면 미리보기를 띄우고, 선생님이 확인해야 READY 가 된다 */
  const [uploading, setUploading] = useState(false)
  const [uploadPreview, setUploadPreview] = useState<MaterialDetail | null>(null)

  async function uploadMaterial(file: File) {
    const invalid = validateMaterialFile(file)
    if (invalid) return showToast(invalid)

    setUploading(true)
    try {
      const { materialId } = await materialApi.upload(classroomId, file)
      const settled = await materialApi.pollUntilSettled(materialId)
      await loadMaterials()
      if (settled.status === 'FAILED') {
        showToast(settled.failureReason ?? '자료를 읽지 못했어요. 다른 파일로 다시 시도해 주세요.')
      } else {
        setUploadPreview(settled)
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : '자료를 올리지 못했어요.')
    } finally {
      setUploading(false)
    }
  }

  /**
   * 미리보기 확인 → READY. 확인한 자료는 **바로 골라 둔다** — 방금 올린 자료로 문제를
   * 만들려던 것이 뻔한데 다음 단계에서 또 찾아 누르게 하지 않는다.
   */
  async function confirmUploaded(materialId: number) {
    try {
      await materialApi.confirm(materialId)
      setUploadPreview(null)
      await loadMaterials()
      /*
        방금 올린 자료를 골라 두는 편의 동작이지만 **상한(5개)을 넘겨서까지 하지는 않는다** —
        여기서 몰래 6번째를 채우면 [만들기] 에서 서버가 400 으로 거절한다.
      */
      const id = String(materialId)
      const atCap = !materialIds.includes(id) && materialIds.length >= MATERIAL_MAX
      if (!atCap) setMaterialIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      showToast(
        atCap
          ? `자료를 사용할 수 있게 됐어요. 이미 ${MATERIAL_MAX}개를 골라 뒀으니 바꿔서 골라 주세요`
          : '자료를 사용할 수 있게 됐어요',
      )
    } catch {
      showToast('확인 처리에 실패했어요. 잠시 후 다시 시도해 주세요.')
    }
  }

  /**
   * 고를 수 있는 자료 — READY 이면서 **지금 고른 학년·과목에 맞는 것**만.
   *
   * <p>예전에는 학급의 자료가 전부 떴다. 1학년 과제를 만들려고 학년을 골라도 6학년 자료가
   * 목록에 그대로 남아, 비슷한 이름들 사이에서 무엇으로 문제를 만드는지 선생님이 일일이
   * 기억해야 했다 — 무엇을 근거로 삼느냐가 결과를 좌우하는 자리인데도.</p>
   *
   * <p>학년·과목이 <b>비어 있는 자료는 언제나 남긴다.</b> 그건 "공용"이라는 뜻이고, V33 이전에
   * 올라간 자료가 전부 여기 해당한다 — 걸러 버리면 쓰던 자료가 하루아침에 사라진다.</p>
   *
   * <p>학년을 아직 안 골랐으면(복식학급 첫 진입) 학년으로는 거르지 않는다. 고르기 전부터
   * 목록이 비어 있으면 자료가 없는 줄 안다.</p>
   */
  const readyMaterials = useMemo(
    () =>
      materials.filter(
        (m) =>
          m.status === 'READY' &&
          (m.grade == null || grade == null || m.grade === grade) &&
          (m.subject == null || m.subject === subject),
      ),
    [materials, grade, subject],
  )

  /**
   * 지금 옆에 펼쳐 둔 자료 — 목록에서 누른 것.
   *
   * 고른 자료(`materialIds`)와 따로 둔다. 여러 개를 고를 수 있는데 화면에 띄울 수 있는 것은
   * 하나이고, 고르기를 취소했다고 보던 문서가 사라지면 "왜 닫혔지" 하게 된다.
   */
  const [previewMaterialId, setPreviewMaterialId] = useState<number | null>(null)
  const previewMaterial = useMemo(
    () => readyMaterials.find((m) => m.materialId === previewMaterialId) ?? null,
    [readyMaterials, previewMaterialId],
  )

  /**
   * 자료 고르기/빼기. **상한에 닿으면 조용히 무시하지 않고 이유를 말한다** —
   * 눌렀는데 아무 일도 안 일어나면 목록이 고장 난 것처럼 보인다.
   *
   * 상태 갱신 함수 안에서 토스트를 띄우지 않는다(개발 모드에서 두 번 실행돼 토스트가
   * 겹친다) — 이벤트 핸들러라 지금 상태를 그대로 읽어도 된다.
   */
  const toggleMaterial = (id: string) => {
    if (materialIds.includes(id)) {
      setMaterialIds((prev) => prev.filter((x) => x !== id))
      return
    }
    if (materialIds.length >= MATERIAL_MAX) {
      showToast(`학습자료는 한 번에 ${MATERIAL_MAX}개까지 고를 수 있어요.`)
      return
    }
    setMaterialIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  /** 받아쓰기를 만들 수 있는 과목인가 — 유형 카드를 잠글지, 고른 유형을 되돌릴지의 기준 */
  const dictationAllowed = DICTATION_SUBJECTS.includes(subject)

  /**
   * 과목을 바꾼다. 받아쓰기를 골라 둔 채 수학·사회·과학으로 옮기면 **서버가 거절하는 조합**이
   * 되므로 유형을 객관식으로 되돌린다. 조용히 되돌리면 선생님이 받아쓰기를 만든 줄 알기 때문에
   * 무엇이 바뀌었는지 말해 준다.
   */
  const pickSubject = (next: Subject) => {
    setSubject(next)
    if (type === 'DICTATION' && !DICTATION_SUBJECTS.includes(next)) {
      setType('MULTIPLE_CHOICE')
      showToast(`받아쓰기는 국어·영어만 만들 수 있어요. ${SUBJECT_LABEL[next]}는 객관식으로 바꿨어요.`)
    }
  }

  const materialSummary =
    materialIds.length === 0
      ? '고르지 않음'
      : materialIds.length === 1
        ? (readyMaterials.find((m) => String(m.materialId) === materialIds[0])?.title ?? '자료 1개')
        : `${materialIds.length}개 선택`

  /** 생성 결과 초안 — 있으면 검수 화면을 보여준다 */
  const [draft, setDraft] = useState<AssignmentDraft | null>(null)
  const [title, setTitle] = useState('')

  const typeLabel = TYPES.find((t) => t.value === type)?.label ?? ''

  /**
   * 검수에서 고친 문항을 초안에 반영한다. **저장은 기존 경로 그대로다** —
   * `draft` 를 고쳐 두면 `draftToCreateRequest(draft, ...)` 가 고쳐진 문항을 그대로 보낸다
   * (초안은 저장 전까지 순수 클라이언트 상태라 백엔드 변경이 필요 없다).
   */
  const setProblems = (problems: AssignmentProblem[]) =>
    setDraft((prev) => (prev === null ? prev : { ...prev, content: { ...prev.content, problems } }))


  async function generate() {
    // 학년은 서버가 `@NotNull` 로 받는다 — 아래 버튼이 이미 막지만 여기서도 확실히 한다
    if (grade === null) {
      showToast('학년을 골라 주세요.')
      return
    }
    setBusy(true)
    try {
      const { jobId } = await assignmentApi.generate(classroomId, {
        subject,
        type,
        grade,
        count,
        // 선생님이 고른 자료 — 서버가 이 자료의 추출 텍스트를 근거로 문제를 만든다
        materialIds,
      })
      const job = await assignmentApi.pollJob(jobId)
      if (job.status === 'DONE' && job.draft) {
        setDraft(job.draft)
        setTitle(job.draft.title)
        setStep(2)
      } else {
        showToast(job.error ?? '생성에 실패했어요. 잠시 후 다시 시도해 주세요.')
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : '생성에 실패했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /** 검수 완료 → 확정 저장. publish 는 목록에서 따로 켠다 (실수 발행 방지) */
  async function save() {
    if (!draft) return
    setBusy(true)
    try {
      /*
        **학년은 이제 필드로 저장한다.** 예전에는 제목 앞에 "3학년 "을 끼워 넣었는데, 그건
        백엔드 `Assignment` 에 학년 컬럼이 없던 시절의 우회다 — V21 에서 `grade` 가, V22/V23 에서
        `targetStudentIds`/`targetGrades` 가 생겨 우회가 필요 없어졌다. 제목은 선생님이 적은
        그대로 둔다.

        대상(누가 보는가)과 학년(무엇으로 표시하는가)은 **다른 값**이다:
         - `grade`            표시용. 목록 카드가 "3학년 국어" 로 묶어 보여줄 때 쓴다.
         - `targetGrades`     접근 제어. 이 학년 학생에게만 보인다.
         - `targetStudentIds` 접근 제어. 이 학생들에게만 보인다.
        서버는 뒤의 둘을 **합집합**으로 판정하고, **둘 다 비면 학급 전체**로 읽는다.

        그래서 여기서 **한쪽은 반드시 채운다.** '학생 선택' 인데 한 명도 안 골랐으면
        학급 전체가 아니라 **고른 학년**으로 떨어뜨린다 — 5학년 아이에게 6학년 과제가 나가는
        것이 "아무도 안 골랐다"의 결과여서는 안 된다.
      */
      const pickedIds = [...pickedStudents]
      const byStudents = target === 'students' && pickedIds.length > 0
      await assignmentApi.createAssignment(
        classroomId,
        draftToCreateRequest(draft, {
          title,
          grade,
          targetGrades: byStudents ? null : grade !== null ? [grade] : null,
          targetStudentIds: byStudents ? pickedIds : null,
        }),
      )
      showToast('과제를 저장했어요. 목록에서 공개하면 학생이 볼 수 있어요.')
      onClose()
    } catch {
      showToast('저장에 실패했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * ref .pick-chip — .95rem/800 · padding 11px 18px · min-height 44 · 2px 테두리.
   *
   * 가운데 정렬이다: 아래 묶음들이 칩을 **한 줄에 꽉 차게** 늘려 놓기 때문에(auto-cols-fr)
   * 왼쪽 정렬이면 넓어진 칸 안에서 글자만 왼쪽에 몰려 빈 오른쪽이 눈에 걸린다.
   */
  const chip =
    'min-h-11 rounded-full border-2 border-canvas bg-canvas p-[11px_18px] text-center text-[.95rem] font-extrabold text-ink-soft transition-transform duration-200 ease-bounce hover:-translate-y-0.5 data-[active=true]:border-primary data-[active=true]:bg-primary data-[active=true]:text-white'
  /**
   * 묶음 제목 — 창 제목(1.6rem) 다음 단계의 크기다. 이 창의 글자 크기는 세 단계뿐이다:
   * **창 제목 1.6rem → 묶음 제목 1.15rem → 고르는 값 .95rem → 거드는 말 .8rem.**
   * 예전엔 1.3 / 1 / .95 로 붙어 있어서 무엇이 더 중요한지 크기로는 읽히지 않았다.
   */
  const sectionLabel = 'mb-3 block text-[1.15rem] font-black tracking-[-.2px]'
  /**
   * 칩 한 줄 — `auto-cols-fr` 라 개수가 몇이든 **줄 너비를 균등하게 나눠 다 채운다.**
   * 예전엔 `flex flex-wrap` 이라 칩이 내용 너비만큼만 작게 들어가 줄 오른쪽이 비었다.
   */
  const chipRow = 'grid auto-cols-fr grid-flow-col gap-2'

  /**
   * **AI 가 문제를 만드는 중인가.**
   *
   * `busy` 만으로는 안 된다 — 그 값은 3단계의 저장(`save()`)에서도 켜진다. 저장은 한두 번의
   * 왕복이라 단추 글자(`저장 중…`)로 충분하고, 그때 로딩 화면이 뜨면 검수하던 문제 목록이
   * 사라져 무엇을 저장하는지 알 수 없게 된다. 생성(2단계에서 누르는 것)만 이 화면을 쓴다.
   */
  const generating = busy && step === 1

  return (
    <ModalShell
      open
      onClose={onClose}
      label="AI 과제 만들기"
      /*
        미리보기가 열리면 창을 넓힌다 — 목록 옆에 PDF 를 나란히 두려면 640px 로는 두 칸 다
        못 읽는 폭이 된다. ModalShell 이 min(width, 100%) 로 잡으므로 좁은 화면에서는
        그대로 화면 폭을 따른다.
      */
      width={previewMaterial ? 1040 : 640}
      /*
        제목은 **카드 가운데**다. 제목 칸은 오른쪽 닫기 버튼(38px)과 그 사이 간격(12px)만큼
        좁아진 상태로 오는데, 그 안에서만 가운데 정렬하면 글자가 카드 중심보다 25px 왼쪽에
        놓인다. 같은 50px 을 왼쪽 패딩으로 되돌려 두 여백을 맞춘다.

        크기는 이 창에서 **가장 큰 글씨**여야 한다 — 아래 묶음 제목(1.05rem)과 1.3rem 은
        차이가 거의 없어서 "무엇을 하는 창인지"와 "이 칸이 무엇인지"가 같은 무게로 읽혔다.
      */
      title={
        <h2 className="pl-[50px] text-center text-[1.6rem] font-black leading-[1.25] tracking-[-.5px] max-[640px]:pl-0 max-[640px]:text-[1.35rem]">
          새 과제 만들기
        </h2>
      }
    >
      {/*
        AI 가 문제를 만드는 동안은 **카드 전체를 이 화면이 쓴다** — 단계 점·설정 칸·아래 단추를
        모두 감춘다. 예전에는 설정 화면이 그대로 남고 단추 글자만 `AI가 만드는 중…` 으로
        바뀌었다. 10~20초 걸리는 일인데(202 + 폴링) 화면이 그대로여서 멈춘 것처럼 보였고,
        고른 값을 그 사이에 다시 만질 수 있는 것처럼 보이는 것도 거짓이었다(이미 보냈다).

        닫기(X)는 그대로 열어 둔다 — 생성을 중단시키는 API 는 없지만, 기다리다 그만두려는
        사람의 유일한 출구를 막을 이유는 없다.
      */}
      {generating && <AiGeneratingView />}

      {/*
        ref .wizard-dots — modal-head 바로 아래, 가운데 정렬.
        `hidden` 속성으로 감추지 않는다: UA 의 `display:none` 은 클래스의 `display:flex` 에
        밀려 아무 일도 하지 않는다. 아예 그리지 않는 편이 확실하다.
      */}
      {!generating && (
        <div className="mb-[22px] flex justify-center gap-2" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s}
              data-state={i < step ? 'done' : i === step ? 'now' : 'idle'}
              className="h-2 w-8 rounded-full bg-track transition-transform data-[state=done]:bg-success-deep data-[state=now]:scale-y-125 data-[state=now]:bg-primary"
            />
          ))}
        </div>
      )}

      {/*
        단계 이름('유형 고르기' 등)은 적지 않는다 — 위 점 표시가 이미 몇 단계 중 어디인지를
        말하고, 각 묶음에 '학년'·'학습자료'·'문항 수' 라는 제목이 따로 붙어 있어서
        한 줄 더 쓰면 제목이 두 겹이 된다.
      */}

      {step === 0 && (
        <div className="flex flex-col">
          {/*
            과목을 **유형보다 먼저** 고르게 한다. 받아쓰기는 국어·영어에서만 만들 수 있어서
            (서버가 그 밖의 조합을 400 으로 거절한다) 과목이 정해져야 아래 유형 카드가
            고를 수 있는 것만 보여줄 수 있다. 반대 순서면 받아쓰기를 고른 뒤 과목을 옮기는
            길이 생겨, 무엇 때문에 유형이 되돌아갔는지 알기 어렵다.
          */}
          <div className="pb-5">
            <span className={sectionLabel}>과목</span>
            <div className={chipRow}>
              {SUBJECT_CODES.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => pickSubject(code)}
                  data-active={subject === code}
                  className={chip}
                >
                  {SUBJECT_LABEL[code]}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t-[1.5px] border-track pt-5">
            <span className={sectionLabel}>유형</span>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5">
              {TYPES.map((t) => {
                /*
                  잠긴 카드는 **지우지 않고 잠근 채 이유를 적는다.** 목록에서 빼 버리면
                  국어에서 보이던 받아쓰기가 수학에서 사라져, 선생님은 기능이 없어진 줄 안다.
                */
                const locked = t.value === 'DICTATION' && !dictationAllowed
                return (
                  <button
                    key={t.value}
                    type="button"
                    disabled={locked}
                    aria-disabled={locked}
                    onClick={() => setType(t.value)}
                    data-active={type === t.value}
                    className="group flex flex-col gap-2 rounded-[20px] border-[2.5px] border-canvas bg-white p-[18px_16px] text-left transition-transform duration-200 ease-bounce hover:-translate-y-[3px] data-[active=true]:border-primary data-[active=true]:bg-sky disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
                  >
                    <span
                      className="grid h-10 w-10 place-items-center rounded-[14px] bg-mint-bg text-mint-deep group-data-[active=true]:bg-primary group-data-[active=true]:text-white"
                      aria-hidden="true"
                    >
                      <Icon name={locked ? 'lock' : t.icon} className="h-[19px] w-[19px]" />
                    </span>
                    <span className="text-[.94rem] font-black">{t.label}</span>
                    <span className="text-[.78rem] font-medium leading-[1.4] text-ink-soft">
                      {locked ? '국어·영어에서만 만들 수 있어요' : t.hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* 생성 중에는 이 설정 칸을 감춘다 — 위 `AiGeneratingView` 가 카드를 차지한다 */}
      {step === 1 && !generating && (
        /*
          선은 **묶음 하나하나의 시작을 알리는 표시**다(각 칸의 border-top). 그래서 첫 칸
          '학년' 위에도 선이 있고, 맨 아래 요약 표 위에는 없다 — 요약은 새로 고르는 칸이
          아니라 위에서 고른 것을 되짚는 자리라 선으로 또 끊으면 네 번째 질문처럼 보인다.
          (`divide-y` 로는 이 배치가 안 된다 — 선이 항상 칸 사이에만 생겨서 첫 칸 위는 비고
          마지막 요약 위에는 붙는다. 정확히 반대였다.)
        */
        <div className="flex flex-col">
          <div className="border-t-[1.5px] border-track py-5">
            {/*
              학년은 **필수다.** 이 값으로 AI 문제 난이도가 정해지므로 서버도 `@NotNull` 로
              받는다. 복식학급(담당 학년이 둘 이상)이면 기본값을 지어내지 않고 비워 두기 때문에
              (위 effect 참고) 고르지 않은 상태가 실제로 생긴다 — 그래서 표시가 필요하다.
            */}
            <span className={sectionLabel}>
              학년
              <span className="ml-2 text-[.82rem] font-bold text-danger">필수</span>
            </span>
            <div className={chipRow}>
              {/* 학급의 담당 학년만 — 못 받았을 때만 1~6 으로 폴백한다 */}
              {(grades.length ? grades : SELECTABLE_GRADES).map((g) => (
                <button key={g} type="button" onClick={() => setGrade(g)} data-active={grade === g} className={chip}>
                  {g}학년
                </button>
              ))}
            </div>
            {/* 안 고른 이유를 아래 버튼이 회색인 것으로만 알게 하지 않는다 */}
            {grade === null && (
              <p className="mt-2 text-[.8rem] font-bold text-danger">
                학년을 골라야 문제를 만들 수 있어요.
              </p>
            )}
          </div>

          {/*
            근거 학습자료 — **반드시 하나 이상 골라야 한다.** 서버가 `materialIds` 를
            `@NotEmpty` 로 받고, 고른 자료의 추출 텍스트를 프롬프트에 넣어 문제를 만든다
            (MaterialSource). 그래서 "무엇을 근거로 만들지"를 화면에서 정하게 한다.

            **READY 자료만 보여준다.** 서버가 `usableForGeneration()` 으로 READY 아닌 자료를
            409 로 막으므로, 목록에 두면 눌러도 실패하는 항목이 된다.
          */}
          <div className="border-t-[1.5px] border-track py-5">
            <span className={sectionLabel}>
              학습자료
              {/*
                개수를 적는다 — 목록이 스크롤이라 눈에 보이는 줄이 전부인지 알 수 없다.
                괄호로 묶는 이유: 숫자만 붙이면 '학습자료 5' 가 제목의 일부처럼 읽힌다.
              */}
              {readyMaterials.length > 0 && (
                <span className="ml-1.5 font-black text-primary">({readyMaterials.length})</span>
              )}
              <span className="ml-2 text-[.82rem] font-bold text-danger">필수</span>
              {/*
                상한을 미리 적는다 — 5개를 고른 뒤에야 알게 되면 그때까지 고른 것을
                되돌려야 한다. 서버 `@Size(max = 5)` 와 같은 수다.
              */}
              <span className="ml-2 text-[.82rem] font-bold text-ink-mute">
                {materialIds.length > 0
                  ? `${materialIds.length}/${MATERIAL_MAX}개 골랐어요`
                  : `최대 ${MATERIAL_MAX}개`}
              </span>
            </span>

            {materialsLoading ? (
              <p className="text-[.8rem] font-semibold text-ink-mute">자료를 불러오는 중…</p>
            ) : readyMaterials.length === 0 ? (
              /* 만들 수 없는 상태를 정직하게 알린다 — 빈 목록만 두면 왜 안 되는지 모른다 */
              <p className="rounded-2xl bg-task-soft p-3.5 text-[.85rem] font-bold text-task-deep">
                쓸 수 있는 학습자료가 없어요.
                <br />
                아래 ‘자료 올리기’로 PDF를 올리고 내용을 확인해 주세요.
              </p>
            ) : (
              /*
                자료를 고르면 **오른쪽에 원본이 열린다.** 목록만 있을 때는 한 단으로 두고,
                열렸을 때만 두 단이 된다 — 늘 두 단이면 미리보기를 안 쓰는 동안에도 창이
                넓어 목록이 허전하다. 좁은 화면(1024px 미만)에서는 두 단을 만들지 않는다:
                두 칸 다 못 읽는 폭이 되느니 위아래로 쌓는 편이 낫다.
              */
              <div
                className={cn(
                  previewMaterial ? 'grid gap-3 max-[1024px]:grid-cols-1 min-[1025px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]' : '',
                )}
              >
              <div className="flex max-h-[168px] flex-col gap-2 overflow-y-auto pr-0.5">
                {readyMaterials.map((m) => {
                  const id = String(m.materialId)
                  const on = materialIds.includes(id)
                  return (
                    <button
                      key={m.materialId}
                      type="button"
                      onClick={() => {
                        toggleMaterial(id)
                        /*
                          누른 자료를 **옆에 띄운다.** 제목만 보고 고르면 비슷한 이름의 자료를
                          잘못 고르기 쉽다 — 무엇으로 문제를 만드는지가 결과를 좌우하는데
                          정작 그 내용을 볼 길이 없었다. 고르기를 취소해도 그대로 두는 이유는,
                          방금 본 것을 확인하려고 다시 누르는 경우가 있어서다.
                        */
                        setPreviewMaterialId(m.materialId)
                      }}
                      data-active={on}
                      aria-pressed={on}
                      /*
                        마우스를 올렸을 때 **띄우지 않는다**(hover:-translate-y). 이 목록은
                        `overflow-y-auto` 로 스크롤하는 칸 안이라, 위로 올라간 만큼이 칸
                        경계에서 잘려 나갔다 — 첫 줄에서 특히 눈에 띄었다.
                        움직임 대신 테두리·배경 색으로 반응한다 (잘릴 것이 없다).
                      */
                      className="flex items-center gap-2.5 rounded-2xl border-2 border-canvas bg-canvas p-[11px_14px] text-left transition-colors hover:border-primary hover:bg-sky/50 data-[active=true]:border-primary data-[active=true]:bg-sky"
                    >
                      {/* 체크는 아이콘으로도 표시 — 색만으로 선택 여부를 구분하지 않는다 */}
                      <span
                        data-on={on}
                        className="grid h-5 w-5 flex-none place-items-center rounded-md border-2 border-track bg-white data-[on=true]:border-primary data-[on=true]:bg-primary"
                      >
                        {on && <Icon name="check" className="h-3 w-3 text-white" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[.9rem] font-bold">{m.title}</span>
                    </button>
                  )
                })}
              </div>

              {/* 고른 자료의 원본 — 누르기 전에는 자리를 차지하지 않는다 */}
              {previewMaterial && (
                <div className="flex min-w-0 flex-col max-[1024px]:mt-1">
                  <p className="mb-1.5 truncate text-[.82rem] font-bold text-ink-soft">
                    “{previewMaterial.title}” 내용
                  </p>
                  <MaterialPdfView
                    fileId={previewMaterial.fileId}
                    title={previewMaterial.title}
                    /* 목록(168px)보다 크게 잡아야 내용이 읽힌다. 화면이 낮으면 화면을 따른다 */
                    className="h-[360px] max-h-[46vh] min-[1025px]:h-full min-[1025px]:max-h-[52vh]"
                  />
                </div>
              )}
              </div>
            )}
            {/*
              자료 올리기 — 지운 민트 안내문 자리다. 목록 **바로 아래**에 두는 이유:
              고를 자료가 없다는 걸 아는 순간이 여기라서, 창을 닫고 학급 관리로 갔다가
              다시 오는 길이 없어진다. `label` 이라 Button 프리미티브를 못 쓴다
              (MaterialsCard 와 같은 사정).
            */}
            <label
              data-busy={uploading}
              className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-sky p-[12px_16px] text-[.86rem] font-black text-primary transition-colors hover:bg-sidebar-soft data-[busy=true]:cursor-wait data-[busy=true]:opacity-60"
            >
              <Icon name="plus" className="h-4 w-4 flex-none" />
              {uploading ? '자료를 읽는 중…' : '자료 올리기 (PDF · 20MB 이하)'}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  // 같은 파일을 다시 고를 수 있게 값을 비운다
                  e.target.value = ''
                  if (file) void uploadMaterial(file)
                }}
              />
            </label>

            {/*
              추출 결과 확인 — PREVIEW 를 건너뛸 수 없다(스캔본·손글씨가 깨져 들어오는 걸 막는
              명세 요구사항). 확인해야 READY 가 되고 위 목록에 나타난다.
            */}
            {uploadPreview && (
              <div className="mt-3 rounded-2xl border-2 border-task bg-task-soft p-4">
                <p className="text-[.9rem] font-black text-task-deep">
                  “{uploadPreview.title}” 에서 이렇게 읽었어요
                  {uploadPreview.extractionSource === 'LLM' && ' (스캔본이라 AI가 읽었어요)'}
                </p>
                <pre className="mt-2.5 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-[.82rem] font-medium text-ink-soft">
                  {uploadPreview.preview || '(추출된 텍스트가 없어요)'}
                </pre>
                <div className="mt-2.5 flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => void confirmUploaded(uploadPreview.materialId)}
                  >
                    맞아요, 사용할게요
                  </Button>
                  <button
                    type="button"
                    onClick={() => setUploadPreview(null)}
                    className="inline-flex min-h-11 flex-none items-center justify-center rounded-full bg-white p-[13px_22px] text-[.92rem] font-black text-ink-soft hover:bg-canvas"
                  >
                    나중에
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t-[1.5px] border-track py-5">
            <span className={sectionLabel}>문항 수</span>
            <div className={chipRow}>
              {COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  /* 칩을 누르면 직접 입력 칸을 비운다 — 둘 다 차 있으면 어느 값이 쓰이는지 모른다 */
                  onClick={() => {
                    setCount(n)
                    setCustomCount('')
                  }}
                  data-active={count === n && customCount === ''}
                  className={chip}
                >
                  {n}문항
                </button>
              ))}
              {/*
                직접 입력 — 칩과 **같은 줄, 같은 폭**이다(부모 auto-cols-fr).
                `type="text"` + `inputMode="numeric"` 인 이유: number 입력은 브라우저마다
                스피너가 붙어 칩과 생김새가 어긋나고, 휠·화살표로 값이 조용히 바뀐다.
              */}
              <label
                data-active={customCount !== ''}
                /* 좌우 패딩만 좁힌다(!) — 칩 글자 하나가 아니라 '입력칸 + 문항' 두 덩어리가 들어간다 */
                className={`${chip} flex items-center justify-center gap-1 !px-2.5 focus-within:border-primary`}
              >
                <input
                  type="text"
                  inputMode="numeric"
                  value={customCount}
                  placeholder="직접 입력"
                  aria-label={`문항 수 직접 입력 (${COUNT_MIN}~${COUNT_MAX})`}
                  onChange={(e) => {
                    // 숫자만 — 앞의 0 은 값으로도 표시로도 의미가 없다
                    const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '')
                    if (digits === '') {
                      setCustomCount('')
                      /*
                        칸을 비우면 **고른 값이 없는 상태**가 된다 — 방금 적은 수(예: 7)를
                        그대로 두면 칩도 안 켜져 있고 칸도 비었는데 7문항으로 만들어진다.
                        처음 기본값으로 되돌려 화면과 실제 값을 맞춘다.
                      */
                      setCount(5)
                      return
                    }
                    // 상한을 넘겨 적으면 30 으로 붙잡는다 (넘긴 채 두면 서버가 400 을 준다)
                    const n = Math.min(Number(digits), COUNT_MAX)
                    setCustomCount(String(n))
                    setCount(n)
                  }}
                  /* 칩 배경·글자색을 그대로 물려받는다 — 고른 상태면 흰 글씨가 된다 */
                  className="w-full min-w-0 border-0 bg-transparent p-0 text-center font-extrabold text-inherit outline-none placeholder:font-bold placeholder:text-ink-mute"
                />
                {/* '문항'은 **숫자가 있을 때만** 붙는다 — 빈 칸에 붙으면 '직접 입력 문항'이 된다 */}
                {customCount !== '' && <span className="flex-none">문항</span>}
              </label>
            </div>
          </div>

          {/* 요약 표도 한 묶음이다 — 위 칸들과 같은 pt 로 선 아래 여백을 맞춘다 */}
          <div className="pt-5">
            <ReviewBox
              rows={[
                { label: '과목', value: SUBJECT_LABEL[subject] },
                { label: '유형', value: typeLabel },
                /* 안 고른 상태를 `null학년` 으로 적지 않는다 */
                { label: '학년', value: grade === null ? '고르지 않음' : `${grade}학년` },
                { label: '학습자료', value: materialSummary },
                { label: '문항 수', value: `${count}문항` },
              ]}
            />
          </div>
        </div>
      )}

      {step === 2 && draft && (
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className={sectionLabel}>과제 이름</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="p-[14px_16px] text-[1rem] focus:bg-white"
            />
          </label>

          {/*
            공개 대상 — 학년 전체 / 학생 선택. 둘 중 하나만 고른다.
            여기(마지막 단계)에 두는 이유: 앞 단계는 "무엇을 낼까"(유형·학년·자료·문항)이고,
            대상은 "누구에게 낼까"라 저장 직전에 정하는 것이 순서에 맞는다.
          */}
          <div>
            <span className={sectionLabel}>누구에게 낼까요?</span>
            <div className="grid auto-cols-fr grid-flow-col gap-2">
              {(
                [
                  ['grade', '학년 전체'],
                  ['students', '학생 선택'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTarget(key)}
                  data-active={target === key}
                  className={chip}
                >
                  {label}
                </button>
              ))}
            </div>

            {/*
              '학년 전체' 가 **어느 학년인지** 적어 준다. 버튼 글자만 보면 학급 전체로 읽히는데
              실제로는 앞에서 고른 학년에게만 나간다 — 대상은 되돌리기 번거로운 값이라
              저장 전에 한 번 더 눈에 보여야 한다.
            */}
            {target === 'grade' && grade !== null && (
              <p className="mt-2 text-[.85rem] font-bold text-ink-soft">
                <b className="font-black text-primary">{grade}학년</b> 학생 전체에게 나가요. 다른
                학년에게는 보이지 않아요.
              </p>
            )}

            {target === 'students' && (
              <div className="mt-2.5">
                {rosterError ? (
                  <p className="text-[.85rem] font-bold text-danger">
                    학생 명단을 불러오지 못했어요. 대상을 고를 수 없으니 ‘학년 전체’로 두거나 잠시
                    뒤 다시 열어 주세요.
                  </p>
                ) : roster.length === 0 ? (
                  <p className="text-[.85rem] font-semibold text-ink-soft">명단을 불러오는 중…</p>
                ) : (
                  /* 부상 hover 는 안 쓴다 — 스크롤 상자 안이라 첫 줄 윗변이 잘린다(TaskPanel 주석) */
                  <div className="flex max-h-[168px] flex-col gap-1.5 overflow-y-auto pr-0.5">
                    {roster.map((st) => {
                      const on = pickedStudents.has(st.userId)
                      return (
                        <label
                          key={st.userId}
                          data-active={on}
                          className="flex cursor-pointer items-center gap-2.5 rounded-2xl border-2 border-canvas bg-canvas p-[10px_14px] transition-colors hover:border-primary data-[active=true]:border-primary data-[active=true]:bg-sky"
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setPickedStudents((prev) => {
                                const next = new Set(prev)
                                if (next.has(st.userId)) next.delete(st.userId)
                                else next.add(st.userId)
                                return next
                              })
                            }
                            className="h-4 w-4 flex-none accent-primary"
                          />
                          <span className="min-w-0 flex-1 truncate text-[.9rem] font-extrabold">
                            {st.name}
                          </span>
                          <span className="flex-none text-[.78rem] font-bold text-ink-soft">
                            {st.grade}학년
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
                {/* 한 명도 안 고르면 학년 전체로 떨어진다(학급 전체가 아니다) — 미리 말해 준다 */}
                {roster.length > 0 && pickedStudents.size === 0 && (
                  <p className="mt-1.5 text-[.82rem] font-bold text-ink-mute">
                    한 명도 고르지 않으면 {grade !== null ? `${grade}학년` : '고른 학년'} 전체에게
                    나가요.
                  </p>
                )}
              </div>
            )}
          </div>

          <ReviewBox
            rows={[
              { label: '유형', value: typeLabel },
              { label: '제목', value: title || '(제목 없음)' },
              { label: '문항 수', value: `${draft.content.problems.length}문항` },
              { label: '학년', value: `${grade}학년` },
              {
                label: '대상',
                value:
                  target === 'students' && pickedStudents.size > 0
                    ? `학생 ${pickedStudents.size}명`
                    : grade !== null
                      ? `${grade}학년 전체`
                      : '고른 학년 전체',
              },
            ]}
          />

          {/*
            자료를 그대로 인용하지 못한 경우 — 인용문이 자료 원문이 아니라는 것을 먼저 알린다.
            이 말이 없으면 선생님은 아래 인용문을 자료에서 찾으려다 못 찾고 오류로 읽는다.
          */}
          {draft.scopeExpanded && (
            <p className="flex items-start gap-1.5 rounded-xl bg-sky p-[9px_12px] text-[.82rem] font-black text-primary">
              <Icon name="bulb" className="mt-px h-4 w-4 flex-none" />
              <span>
                고른 자료가 빈칸이 많은 학습지라 문장을 그대로 낼 수 없었어요. 자료의{' '}
                <b>주제·범위</b>에 맞춰 새 문제를 만들었으니, 아래 예문이 자료와 잘 맞는지 봐
                주세요.
              </span>
            </p>
          )}

          {/*
            검수 = "읽고 판단"이 아니라 "근거 대조"다 — 문항 옆에 자료 원문을 같이 보여준다.
            목록·편집·삭제·검증 경고는 과제 상세 모달과 **같은 컴포넌트**를 쓴다.
          */}
          <ProblemReviewList
            problems={draft.content.problems}
            type={type}
            onChange={setProblems}
          />
        </div>
      )}

      {/* ref .wizard-actions — 이전(ghost) 왼쪽 / 다음(primary) 오른쪽 */}
      {/* 생성 중에는 누를 것이 없다(둘 다 잠긴 상태였다) — 감추고 카드를 로딩 화면에 넘긴다 */}
      <div className="mt-[22px] flex justify-between gap-2.5" style={generating ? { display: 'none' } : undefined}>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
        >
          {step === 0 ? '취소' : '이전'}
        </Button>
        {step === 0 && <Button onClick={() => setStep(1)}>다음</Button>}
        {/*
          자료를 고르지 않으면 누를 수 없다 — 서버가 `@NotEmpty` 로 400 을 돌려주므로
          보내 놓고 실패하게 두지 않는다.
        */}
        {step === 1 && (
          <Button disabled={busy || grade === null || materialIds.length === 0} onClick={() => void generate()}>
            {/* 이 버튼이 실제로 AI 생성을 돌린다 — ref 라벨("다음")로는 대기 시간이 예고되지 않는다 */}
            {busy ? 'AI가 만드는 중…' : 'AI로 문제 만들기'}
          </Button>
        )}
        {step === 2 && (
          <Button disabled={busy || !title.trim()} onClick={() => void save()}>
            <Icon name="check" className="h-[17px] w-[17px]" />
            {busy ? '저장 중…' : '과제 만들기'}
          </Button>
        )}
      </div>
    </ModalShell>
  )
}
