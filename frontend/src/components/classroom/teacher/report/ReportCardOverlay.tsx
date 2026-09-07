import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { Input } from '@/components/common/Input'
import { reportApi } from '@/services/api/reportApi'
import { reportCardApi } from '@/services/api/reportCardApi'
import { sessionApi } from '@/services/api/sessionApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToastStore } from '@/stores/useToastStore'
import { apiErrorMessage } from '@/lib/apiError'
import { reportCardToPdfBase64 } from '@/lib/reportCardPdf'
import type { StudentWithMeta } from '@/lib/studentMeta'
import {
  buildEvalRows,
  currentTerm,
  entriesToRows,
  rowsToEntries,
  tallyAttendance,
  termRange,
  unsavableRowCount,
  withSpans,
  type ReportCardData,
  type ReportCardMeta,
  type RowOverride,
  type Term,
} from '@/lib/reportCard'
import type { ReportCardEntry } from '@/types/reportCard'
import { ReportCardSheet } from './ReportCardSheet'

/**
 * 생활통지표 미리보기 + 인쇄.
 *
 * **모달이 아니라 `document.body` 직속 포털**이다. 인쇄할 때 앱 전체(`#root`)를 규칙 한 줄로
 * 감추고 이 포털만 남기기 위해서다 — 모달처럼 `#root` 안에 있으면 앱을 감추는 순간 통지표도
 * 같이 사라진다. 화면 전용 요소(도구 막대·안내문)는 `print:hidden` 으로 뺀다.
 *
 * **PDF 를 만드는 길이 둘이고, 목적이 다르다.**
 *  - [인쇄] — 브라우저 인쇄 대화상자의 '대상 > PDF로 저장'. 글자가 **벡터**로 남아 확대해도
 *    선명하다. 통지표는 가는 표선과 작은 한글이 빽빽해서 뽑아 둘 것은 이쪽이 낫다.
 *  - [메일] — 화면을 찍어 PDF 로 만든다(`lib/reportCardPdf`). 인쇄 대화상자는 파일을
 *    돌려주지 않아 첨부할 바이트를 얻을 수 없기 때문이다. 이미지라 확대하면 부드러워진다.
 *
 * ## 서버 통지표 (S15P11A407-145)
 *
 * 통지표가 서버에 저장된다. 표의 바탕은 **초안 > 저장된 것 > 자동 채점 파생** 순으로 고르고
 * (`rowSource`), 확정·메일은 **한 명을 뽑을 때만** 내놓는다(`soleCard` 주석).
 *
 * 메일에는 통지표를 PDF 로 떠서 첨부한다(`lib/reportCardPdf` — 인쇄 경로와 다른 이유가 거기 있다).
 * 첨부를 못 만들어도 서버가 저장된 내용을 글로 풀어 보내므로 **저장이 먼저**다.
 *
 * 학적 항목(학년도·학기·반·번호·담임·학교명)은 **아직 서버에 없다** — 여전히 도구 막대에서
 * 받아 인쇄물에만 쓴다. 통지표 저장 대상은 교과평가 줄(`entries`)뿐이다.
 */
export function ReportCardOverlay({
  classroomId,
  students,
  onClose,
}: {
  classroomId: string
  /** 한 명이면 한 장, 여러 명이면 학생당 한 장씩 이어서 인쇄한다 */
  students: StudentWithMeta[]
  onClose: () => void
}) {
  const teacherName = useAuthStore((s) => s.user?.name)
  const single = students.length === 1

  const [meta, setMeta] = useState<ReportCardMeta>(() => ({
    ...currentTerm(),
    classNo: '',
    seatNo: '',
    homeroomTeacher: teacherName ?? '',
    schoolName: students[0]?.school ?? '',
  }))

  /*
    번호는 학생마다 다르므로 meta 가 아니라 여기 따로 둔다. 서버에 출석번호 컬럼이 없어서
    기본값은 **명단 순서**다(username 끝의 숫자는 삭제 계정까지 포함해 전역으로 증가하는
    값이라 반의 출석번호가 아니다). 한 명만 뽑을 땐 도구 막대에서 고칠 수 있다.
  */
  const [seatNos, setSeatNos] = useState<Record<number, string>>({})
  const seatNoOf = (student: StudentWithMeta, index: number) =>
    seatNos[student.userId] ?? String(index + 1)

  /*
    선생님이 손으로 고친 평가요소·평가. `학생 -> 행 번호 -> 고친 값` 으로 쌓는다.
    자동 채점 결과는 **초안**일 뿐이라 최종 판단은 선생님이 한다(정답률이 곧 성취수준은 아니다).

    이제 **저장할 수 있다**(S15P11A407-145) — [저장] 을 누르면 서버로 가고 다음에 열 때 그대로
    돌아온다. 누르지 않고 닫으면 여전히 사라진다.
  */
  const [edits, setEdits] = useState<Record<number, Record<number, RowOverride>>>({})
  const editRow = (studentId: number, index: number, patch: RowOverride) =>
    setEdits((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        [index]: { ...prev[studentId]?.[index], ...patch },
      },
    }))

  /**
   * 이 창에서 새로 받은 AI 초안 — 받은 학생은 이것이 표의 바탕이 된다.
   *
   * 서버에 저장된 것보다 **앞선다**: 방금 "초안 받기"를 누른 선생님은 새 문장을 보고 싶어
   * 누른 것이다. 저장하지 않고 닫으면 서버 것이 그대로 남는다.
   */
  const [drafts, setDrafts] = useState<Record<number, ReportCardEntry[]>>({})
  /**
   * 이 창에서 **저장에 성공한** 통지표 — 서버가 돌려준 그대로.
   *
   * `drafts` 와 갈라 두는 이유: 저장 결과를 `drafts` 에 넣으면 화면이 그것을 "아직 저장 안 된
   * 초안" 으로 읽어(`rowSource`) 방금 저장한 선생님에게 저장하라고 말한다. 서버에 있는 것과
   * 같은 값이므로 **저장된 것과 같은 급**으로 다뤄야 한다.
   *
   * 일괄 조회(`savedByStudent`) 를 다시 부르긴 하지만 그건 왕복이 있어서, 그 사이 표가
   * 자동 채점 파생값으로 잠깐 되돌아가는 것을 막는 역할도 한다.
   */
  const [savedLocal, setSavedLocal] = useState<Record<number, ReportCardEntry[]>>({})
  const [busy, setBusy] = useState<'draft' | 'save' | 'email' | null>(null)
  /** 통지표를 보낼 주소. 서버가 학부모 이메일을 응답에 싣지 않아 선생님이 직접 적는다 */
  const [recipient, setRecipient] = useState('')
  /**
   * 학생 id → 통지표 한 장의 DOM. **메일 첨부 PDF 를 이 엘리먼트에서 뜬다.**
   *
   * state 가 아니라 ref 인 이유: 값이 바뀌어도 다시 그릴 필요가 없고, 오히려 ref 콜백에서
   * setState 를 하면 렌더 → ref → 렌더 로 무한 루프가 된다(무대 화면에서 실제로 겪었다).
   */
  const sheetRefs = useRef(new Map<number, HTMLElement>())
  const showToast = useToastStore((s) => s.show)

  /* 인쇄 시 앱을 감추는 스위치. 포털이 살아 있는 동안에만 켠다 */
  useEffect(() => {
    document.body.classList.add('report-print')
    return () => document.body.classList.remove('report-print')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /*
    출석과 리포트를 학생마다 하나씩. 키는 학생 상세 패널이 쓰는 것과 **같은 키**라, 이미 열어
    본 학생은 캐시가 그대로 쓰인다(반 전체를 뽑아도 다시 부르는 건 안 본 학생뿐).
  */
  const attendanceQueries = useQueries({
    queries: students.map((s) => ({
      queryKey: ['attendance', classroomId, s.userId],
      queryFn: () => sessionApi.getAttendance(classroomId, s.userId),
      staleTime: 60_000,
      retry: false,
    })),
  })
  const reportQueries = useQueries({
    queries: students.map((s) => ({
      queryKey: ['report', classroomId, s.userId],
      queryFn: () => reportApi.getReport(classroomId, s.userId),
      staleTime: 60_000,
      retry: false,
    })),
  })

  /*
    이미 저장해 둔 통지표 — **학급 것을 한 번에 받는다.**

    학생마다 부르지 않는 이유: 한 학년을 통째로 뽑는 길이 있어서(학생 30명이면 조회가 30번)
    서버가 학급 단위 일괄 조회를 따로 준다. 복식학급은 학년이 둘이라 `grade` 를 비워 학급
    전체를 받고 학생 id 로 골라 쓴다.

    실패해도 화면을 막지 않는다 — 저장된 것을 못 읽었을 뿐이고, 그때는 자동 채점 초안으로
    그리면 된다(아래 `rowSource`). 다만 조용히 넘기면 선생님이 **저장해 둔 것이 사라진 줄 알고
    다시 적게 되므로** 안내는 띄운다.
  */
  const savedQuery = useQuery({
    queryKey: ['report-cards', classroomId],
    queryFn: () => reportCardApi.listByClassroom(classroomId),
    staleTime: 60_000,
    retry: false,
  })
  const savedByStudent = useMemo(
    () =>
      new Map(
        (savedQuery.data ?? [])
          .filter((row) => row.saved && row.entries.length > 0)
          .map((row) => [row.studentId, row.entries]),
      ),
    [savedQuery.data],
  )

  const loading =
    attendanceQueries.some((q) => q.isPending) ||
    reportQueries.some((q) => q.isPending) ||
    savedQuery.isPending
  const range = termRange(meta.schoolYear, meta.term)

  /**
   * 이 학생 표의 바탕이 어디서 왔는가 — **초안 > 저장된 것 > 자동 채점 파생** 순.
   *
   * 화면이 "지금 보는 것이 무엇인지" 말해야 하기 때문에 출처를 값으로 남긴다. 저장된 통지표와
   * 자동 채점 초안은 생김새가 같아서, 알려주지 않으면 선생님이 이미 확정한 문장인지 방금
   * 계산된 값인지 구별할 수 없다.
   */
  function rowSource(studentId: number): 'draft' | 'saved' | 'derived' {
    if (drafts[studentId]) return 'draft'
    if (savedLocal[studentId] || savedByStudent.has(studentId)) return 'saved'
    return 'derived'
  }

  /** 표의 바탕이 될 서버 값 — 없으면 undefined 라 호출부가 자동 채점 파생으로 떨어진다 */
  function serverEntriesOf(studentId: number): ReportCardEntry[] | undefined {
    return drafts[studentId] ?? savedLocal[studentId] ?? savedByStudent.get(studentId)
  }

  /*
    조회에 실패한 학생은 **장을 만들지 않는다.** 빈 값으로 그리면 결석 0 일짜리 통지표가
    가정으로 나가는데, 그건 "확인했고 없음"이라는 거짓말이다 (CLAUDE.md 0장 규칙 2).
  */
  const failures = students.flatMap((s, i) => {
    const error = attendanceQueries[i].error ?? reportQueries[i].error
    return error ? [{ name: s.name, message: apiErrorMessage(error, '불러오지 못했습니다') }] : []
  })

  const cards = students.flatMap((student, i): ReportCardData[] => {
    const attendance = attendanceQueries[i].data
    const report = reportQueries[i].data
    if (!attendance || !report) return []
    const rowEdits = edits[student.userId]
    /*
      표의 바탕. 서버에 통지표가 있으면 **그것이 진실이다** — 선생님이 이미 확정한 문장과
      평가라, 자동 채점 파생값으로 덮으면 손으로 한 일이 사라진다.
    */
    const serverEntries = serverEntriesOf(student.userId)
    const baseRows = serverEntries ? entriesToRows(serverEntries) : buildEvalRows(report.tagStats)
    return [
      {
        studentId: student.userId,
        name: student.name,
        grade: student.grade,
        meta: { ...meta, seatNo: seatNoOf(student, i) },
        attendance: tallyAttendance(attendance, range),
        /*
          병합(span)은 **고치기 전 값**으로 계산한다 — 평가요소 글자를 바꾼다고 교과·영역이
          달라지지는 않으므로, 타이핑 도중에 표가 재정렬돼 커서가 튀는 일이 없다.
        */
        rows: withSpans(baseRows).map((row, index) => ({
          ...row,
          ...rowEdits?.[index],
        })),
      },
    ]
  })

  const set = <K extends keyof ReportCardMeta>(key: K, value: ReportCardMeta[K]) =>
    setMeta((m) => ({ ...m, [key]: value }))

  /*
    저장·초안·메일은 **한 명을 뽑을 때만** 내놓는다.

    한 반을 통째로 뽑는 길은 인쇄가 목적이고(학년 통지표 N명), 거기서 [저장] 을 한 번 누르면
    서른 명의 통지표가 한꺼번에 확정된다 — 되돌릴 방법이 없는 일을 한 번의 클릭에 묶는 셈이다.
    확정은 학생 상세에서 한 명씩, 눈으로 보고 하게 한다. 일괄 인쇄에서도 **이미 저장해 둔
    통지표는 그대로 실려 나온다**(위 `savedByStudent`) — 확정한 내용으로 인쇄된다.
  */
  const soleStudent = single ? students[0] : null
  const soleCard = soleStudent ? cards.find((c) => c.studentId === soleStudent.userId) : undefined

  /** AI 초안 받기 — 과목마다 한 줄씩 5줄이 오고, 이 학생 표의 바탕이 그것으로 바뀐다 */
  /**
   * 저장 한 번 — API 호출과 그에 따른 화면 상태 정리를 한곳에 둔다.
   *
   * `save`(버튼)와 `loadDraft`(초안 받기 직후 자동 저장)가 같이 쓴다. 상태 정리가 세 군데라
   * 각자 하면 한 곳을 빠뜨렸을 때 "방금 저장했는데 저장 안 됐다고 나오는" 상태가 된다.
   */
  async function persist(studentId: number, entries: ReportCardEntry[]) {
    const saved = await reportCardApi.save(classroomId, studentId, { entries })
    /*
      초안 자리에서 **빼서** 저장된 자리로 옮긴다. 초안으로 남겨 두면 화면이 "아직 저장되지
      않았어요" 라고 말한다 — 방금 저장한 선생님에게. 수정분(`edits`)도 서버에 반영됐으니
      비운다(안 비우면 다음 렌더에서 저장된 값 위에 또 덮인다).
    */
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[studentId]
      return next
    })
    setSavedLocal((prev) => ({ ...prev, [studentId]: saved.entries }))
    setEdits((prev) => ({ ...prev, [studentId]: {} }))
    void savedQuery.refetch()
    return saved
  }

  /**
   * AI 초안 받기 — **받자마자 한 번 저장한다.**
   *
   * 예전에는 초안을 화면에만 올려 두고 저장은 선생님이 따로 눌러야 했다. 그런데 초안을 받고
   * 바로 메일을 보내는 흐름이 자연스러워서, 저장을 잊은 채 보내면 **화면에 보이는 문장과 다른
   * 내용이 나갔다**(본문은 서버에 저장된 것으로 채워지므로 비어 있거나 옛것이었다).
   *
   * 그래서 받은 초안을 곧바로 저장한다. 선생님이 이어서 고치면 그건 다시 '저장 안 됨' 이 되지만,
   * 적어도 **아무것도 저장되지 않은 상태로 메일이 나가는 일은 없어진다.**
   *
   * 문장이 하나도 안 만들어졌으면(제출한 과제가 없는 학생) 저장하지 않는다 — 빈 통지표를
   * 저장해 두면 화면이 "저장됨" 이라고 말해 버린다.
   */
  async function loadDraft(studentId: number) {
    setBusy('draft')
    try {
      const { entries } = await reportCardApi.draft(classroomId, studentId)
      setDrafts((prev) => ({ ...prev, [studentId]: entries }))
      /*
        고친 값은 **행 번호로** 붙어 있다. 바탕이 갈리면 3번 행의 뜻이 달라지므로 같이 버린다 —
        안 버리면 국어 칸에 적어 둔 문장이 수학 줄에 옮겨 붙는다.
      */
      setEdits((prev) => ({ ...prev, [studentId]: {} }))
      const written = entries.filter((e) => (e.evalElement ?? '').trim()).length
      if (written === 0) {
        showToast('아직 제출한 과제가 없어 초안 문장을 만들지 못했어요. 직접 적어 주세요')
        return
      }
      try {
        await persist(studentId, entries)
        showToast(`AI 초안을 받아 저장했어요 (${written}과목). 문장을 다듬으면 다시 저장해 주세요`)
      } catch (err) {
        // 초안은 화면에 떠 있다 — 저장만 실패한 것이므로 그렇게 말한다
        showToast(apiErrorMessage(err, '초안은 받았지만 저장하지 못했어요. [저장]을 눌러 주세요.'))
      }
    } catch (err) {
      showToast(apiErrorMessage(err, '초안을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'))
    } finally {
      setBusy(null)
    }
  }

  /** 저장 — 지금 표에 보이는 그대로 서버에 올린다(전체 교체) */
  async function save(card: ReportCardData) {
    const entries = rowsToEntries(card.rows)
    if (entries.length === 0) {
      showToast('저장할 교과 줄이 없어요. AI 초안을 받거나 평가요소를 적어 주세요')
      return
    }
    setBusy('save')
    try {
      // 서버가 돌려준 것을 바탕으로 되돌린다 — 저장된 값과 화면이 어긋나지 않게 (persist)
      await persist(card.studentId, entries)
      const dropped = unsavableRowCount(card.rows)
      showToast(
        dropped > 0
          ? `통지표를 저장했어요. 교과를 알 수 없는 ${dropped}줄은 빠졌어요`
          : '통지표를 저장했어요',
      )
    } catch (err) {
      showToast(apiErrorMessage(err, '통지표를 저장하지 못했어요.'))
    } finally {
      setBusy(null)
    }
  }

  /**
   * 메일 보내기 — **통지표를 PDF 로 떠서 첨부한다.**
   *
   * 예전에는 첨부 없이 보내서 서버가 저장된 내용을 글로 풀어 본문에 담았다. 학부모가 받는
   * 것이 표가 아니라 줄글이라 통지표로 보이지 않았다.
   *
   * 인쇄 대화상자는 파일을 돌려주지 않으므로(그래서 [인쇄] 버튼과 경로가 다르다) 화면을
   * 직접 찍어 PDF 로 만든다 — `reportCardPdf` 주석에 화질 이야기를 적어 뒀다.
   *
   * PDF 를 못 만들어도 **메일은 보낸다.** 서버가 저장된 내용으로 본문을 채워 주므로,
   * 첨부가 없다고 발송 자체를 막으면 학부모가 아무것도 못 받는다(저장이 먼저인 이유).
   */
  async function sendMail(card: ReportCardData) {
    const email = recipient.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('받는 분 이메일 주소를 다시 확인해 주세요.')
      return
    }
    setBusy('email')
    try {
      /*
        **보내기 전에 저장한다.** 메일은 두 갈래로 만들어진다 — 첨부 PDF 는 지금 화면을 찍고,
        본문 글은 서버에 저장된 것으로 채워진다. 고쳐 놓고 저장을 안 했으면 그 둘이 어긋나서,
        학부모가 받은 메일의 본문과 첨부가 다른 말을 한다.

        초안을 받으면 자동으로 저장되지만(loadDraft) 그 뒤에 손으로 고친 것은 다시 미저장이다.
      */
      const unsaved =
        rowSource(card.studentId) === 'draft' ||
        Object.keys(edits[card.studentId] ?? {}).length > 0
      if (unsaved) {
        const entries = rowsToEntries(card.rows)
        if (entries.length > 0) {
          await persist(card.studentId, entries)
        }
      }

      let pdfBase64: string | undefined
      const sheet = sheetRefs.current.get(card.studentId)
      if (sheet) {
        try {
          pdfBase64 = await reportCardToPdfBase64([sheet])
        } catch (err) {
          // 첨부만 실패한 것 — 본문은 나간다. 조용히 넘기지 않고 알린다
          console.warn('[report-card] PDF 생성 실패 — 본문만 보낸다', err)
          showToast('PDF 를 만들지 못해 내용을 글로 보냅니다.')
        }
      }
      const result = await reportCardApi.email(classroomId, card.studentId, {
        recipientEmail: email,
        pdfBase64,
        filename: `${card.name}_생활통지표.pdf`,
        message: `${card.name} 학생의 ${card.meta.schoolYear}학년도 ${card.meta.term}학기 생활통지표입니다.`,
      })
      /*
        **첨부가 붙었는지 함께 말한다.** 서버는 PDF 가 있으면 본문을 인사말만 보내고, 없으면
        저장된 내용을 글로 풀어 담는다 — 받는 쪽 모양이 꽤 다른데 보낸 사람은 알 길이 없었다.
        "보냈어요" 만 뜨면 첨부가 빠진 것을 학부모가 받고 나서야 안다.
      */
      showToast(
        !result.sent
          ? '메일을 보내지 못했어요.'
          : pdfBase64
            ? `${result.recipientEmail} 으로 보냈어요 (PDF 첨부)`
            : `${result.recipientEmail} 으로 보냈어요 (PDF 없이 글로)`,
      )
    } catch (err) {
      showToast(apiErrorMessage(err, '메일을 보내지 못했어요.'))
    } finally {
      setBusy(null)
    }
  }

  return createPortal(
    <div
      id="print-portal"
      className="fixed inset-0 z-[90] overflow-y-auto bg-frame p-6 print:static print:overflow-visible print:bg-white print:p-0"
    >
      {/* ── 도구 막대 (화면 전용) ── */}
      <div className="mx-auto mb-6 flex max-w-[210mm] flex-col gap-4 rounded-card bg-card p-5 shadow-card print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-widget-title font-black">
            생활통지표 {single ? students[0].name : `${students.length}명`}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              닫기
            </Button>
            {/* 확정(저장)은 한 명씩만 — 위 `soleCard` 주석 참고 */}
            {soleStudent && (
              <>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => void loadDraft(soleStudent.userId)}
                  disabled={loading || busy !== null}
                >
                  <Icon name="star" />
                  {busy === 'draft' ? '초안 만드는 중…' : 'AI 초안 받기'}
                </Button>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => soleCard && void save(soleCard)}
                  disabled={loading || busy !== null || !soleCard}
                >
                  <Icon name="check" />
                  {busy === 'save' ? '저장 중…' : '저장'}
                </Button>
              </>
            )}
            <Button
              size="sm"
              onClick={() => window.print()}
              disabled={loading || cards.length === 0}
            >
              <Icon name="doc" />
              인쇄 · PDF로 저장
            </Button>
          </div>
        </div>

        {/*
          지금 보는 표가 어디서 왔는지 알린다. 저장된 통지표와 자동 채점 초안은 생김새가 같아서,
          말해 주지 않으면 이미 확정한 문장인지 방금 계산된 값인지 구별할 수 없다.
        */}
        {soleStudent && !loading && (
          <p className="text-[.84rem] font-bold text-ink-soft">
            {rowSource(soleStudent.userId) === 'saved'
              ? '저장해 둔 통지표를 불러왔어요. 고친 뒤 [저장]을 눌러야 남아요.'
              : rowSource(soleStudent.userId) === 'draft'
                ? 'AI 초안이에요. 아직 저장되지 않았어요 — [저장]을 눌러 주세요.'
                : '저장된 통지표가 없어 자동 채점 결과로 표를 만들었어요. [AI 초안 받기]로 과목별 문장을 받을 수 있어요.'}
          </p>
        )}

        {/*
          서버에 없는 학적 항목은 여기서 받는다. 저장하지 않는다 — 인쇄물에만 쓴다.
          (백엔드에 학년도·학기·반·출석번호·담임 필드가 생기면 이 줄이 통째로 사라진다.)
        */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
          <Field label="학년도">
            <Input
              type="number"
              className="p-[9px_14px] text-[.9rem]"
              value={meta.schoolYear}
              onChange={(e) => set('schoolYear', Number(e.target.value))}
            />
          </Field>
          <Field label="학기">
            <select
              className="w-full rounded-2xl border-2 border-canvas bg-canvas p-[9px_14px] text-[.9rem] font-semibold text-ink outline-none focus:border-primary"
              value={meta.term}
              onChange={(e) => set('term', Number(e.target.value) as Term)}
            >
              <option value={1}>1학기</option>
              <option value={2}>2학기</option>
            </select>
          </Field>
          <Field label="반">
            <Input
              className="p-[9px_14px] text-[.9rem]"
              value={meta.classNo}
              placeholder="2"
              onChange={(e) => set('classNo', e.target.value)}
            />
          </Field>
          {single && (
            <Field label="번호">
              <Input
                className="p-[9px_14px] text-[.9rem]"
                value={seatNoOf(students[0], 0)}
                onChange={(e) =>
                  setSeatNos((prev) => ({ ...prev, [students[0].userId]: e.target.value }))
                }
              />
            </Field>
          )}
          <Field label="담임명">
            <Input
              className="p-[9px_14px] text-[.9rem]"
              value={meta.homeroomTeacher}
              onChange={(e) => set('homeroomTeacher', e.target.value)}
            />
          </Field>
          <Field label="학교명">
            <Input
              className="p-[9px_14px] text-[.9rem]"
              value={meta.schoolName}
              onChange={(e) => set('schoolName', e.target.value)}
            />
          </Field>
        </div>

        {/*
          통지표 메일 — 첨부 없이 **저장된 내용을 글로** 보낸다(`sendMail` 주석). 그래서 저장
          버튼 아래에 둔다: 순서가 저장 → 보내기다.

          받는 주소를 선생님이 적는다. 학부모 이메일은 학생 계정에 저장돼 있지만 서버가 어떤
          응답에도 싣지 않아(User.parentEmail 은 비공개) 화면이 알 길이 없다 — 미리 채워 주는
          척하지 않고 비워 둔다.
        */}
        {soleStudent && (
          <div className="flex flex-wrap items-end gap-2 border-t-[1.5px] border-track pt-4">
            <Field label="통지표를 받을 이메일">
              <Input
                type="email"
                autoComplete="off"
                className="p-[9px_14px] text-[.9rem]"
                placeholder="예: parent@example.com"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </Field>
            <Button
              variant="soft"
              size="sm"
              onClick={() => soleCard && void sendMail(soleCard)}
              disabled={loading || busy !== null || !soleCard || !recipient.trim()}
            >
              <Icon name="mail" />
              {busy === 'email' ? '보내는 중…' : '메일로 보내기'}
            </Button>
            <p className="w-full text-[.8rem] font-semibold text-ink-mute">
              저장한 내용이 메일 본문으로 나가요. PDF는 [인쇄 · PDF로 저장]으로 따로 받으세요.
            </p>
          </div>
        )}

        {savedQuery.isError && (
          <div className="rounded-2xl bg-task-soft p-[12px_16px] text-[.85rem] font-bold text-task-deep">
            저장해 둔 통지표를 불러오지 못했어요 — 자동 채점 결과로 표를 만들었습니다.
            여기서 [저장]을 누르면 이전 내용을 덮어씁니다.
          </div>
        )}

        {failures.length > 0 && (
          <div className="rounded-2xl bg-danger-soft p-[12px_16px] text-[.85rem] font-bold text-danger">
            {failures.length}명은 자료를 불러오지 못해 통지표를 만들지 않았습니다 —{' '}
            {failures.map((f) => `${f.name}(${f.message})`).join(', ')}
          </div>
        )}
      </div>

      {/* ── 미리보기 = 인쇄물 ── */}
      {loading ? (
        <p className="py-20 text-center font-bold text-ink-soft print:hidden">
          자료를 불러오는 중입니다…
        </p>
      ) : (
        <div className="mx-auto flex w-fit flex-col items-center gap-6 print:block print:w-auto print:gap-0">
          {cards.map((card) => (
            <div
              key={card.studentId}
              /* 메일 첨부 PDF 를 뜰 때 이 엘리먼트를 그대로 찍는다 (sendMail) */
              ref={(el) => {
                if (el) sheetRefs.current.set(card.studentId, el)
                else sheetRefs.current.delete(card.studentId)
              }}
              className="report-page bg-white p-[10mm] shadow-card print:p-0 print:shadow-none"
            >
              <ReportCardSheet
                data={card}
                onEditRow={(index, patch) => editRow(card.studentId, index, patch)}
              />
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-[.78rem] font-black text-ink-soft">{label}</span>
      {children}
    </label>
  )
}
