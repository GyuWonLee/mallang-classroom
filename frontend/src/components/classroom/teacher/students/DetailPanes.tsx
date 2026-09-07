import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { EmptyState } from '@/components/common/EmptyState'
import { assignmentApi, draftToCreateRequest } from '@/services/api/assignmentApi'
import { assignmentTheme } from '@/components/classroom/teacher/assignments/assignmentTheme'
import { assignmentTargetsStudent } from '@/lib/assignmentTarget'
import { SUBJECT_CODES } from '@/lib/subject'
import type { Subject } from '@/types/assignment'
import { inviteApi } from '@/services/api/inviteApi'
import { sessionApi } from '@/services/api/sessionApi'
import { reportApi, type StudentReport } from '@/services/api/reportApi'
import { apiErrorMessage } from '@/lib/apiError'
import type { StudentWithMeta } from '@/lib/studentMeta'
import type { PasswordResetResponse } from '@/types/invite'
import { confirmAction } from '@/stores/useConfirmStore'
import { useOpenModal } from '@/stores/useModalStore'
import { useToastStore } from '@/stores/useToastStore'
import { BarRow, LevelBar, ProgressDonut, WeeklyLineChart } from './charts'

/* ref .sm-dcard / .sm-dgrid / .sm-note 를 옮긴 조각들 */

const CARD = 'rounded-tile border-2 border-track bg-card p-3.5'
const CARD_TITLE = 'mb-2.5 text-[1.08rem] font-black'
/** ref `.sm-dgrid` — 작은 카드(.85fr)와 넓은 카드(1.15fr)를 나란히 (좁으면 한 단) */
const GRID = 'mb-2.5 grid grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] gap-3 max-[720px]:grid-cols-1'
/** ref `.sm-sub-item` — 과제 제출/추천 활동의 한 줄 */
const SUB_ITEM =
  'flex items-center gap-2.5 border-b border-track py-[11px] text-[.86rem] font-bold last:border-b-0'
/** ref `.sm-sub-tag` — 줄 오른쪽 끝 상태 알약 */
const SUB_TAG = 'ml-auto whitespace-nowrap rounded-full px-[11px] py-1 text-[.72rem] font-black'
/** 값이 아직 없을 때의 한 줄 안내 — 카드 안에서 반복돼 상수로 뺀다 */
const HINT = 'text-[.85rem] font-bold text-ink-mute'
/**
 * 값이 없을 때도 **카드 높이를 지켜 주는** 안내 상자.
 *
 * 안내가 한 줄짜리 `<p>` 라 값이 있을 때(막대 여러 줄·세로 탭)보다 카드가 훨씬 납작해져서,
 * 옆·아래 카드와 끝선이 어긋나고 패널 안에 빈 자리가 생겼다. 높이를 채워진 상태에 맞춰
 * 고정하고 그 안에서 가운데 정렬한다 — 높이는 호출부에서 `h-[…]` 로 덧붙인다(뒤가 이긴다).
 */
const HINT_BOX = `${HINT} grid place-items-center break-keep px-2 text-center leading-[1.7]`

/* ── 요약 ─────────────────────────────────────────────────────── */

/**
 * 학생 요약 — `GET /classrooms/{id}/students/{studentId}/report` 하나로 그린다.
 *
 * 서버가 주는 것만 보여준다: 전체 정답률 · 개념별 정답률(약한 것부터) · 강점 · 약점 ·
 * 격려 코멘트 · 채점된 과제 수. **그 밖의 숫자는 만들지 않는다** — 예전엔 출석·주간 추이·
 * 과목별 점수를 해시로 지어내 보여줬다.
 *
 * 국어 전용 서비스라 "과목별" 축도 없앴다(예전 5과목 탭은 시안 잔재다).
 */
export function SummaryPane({
  student: s,
  classroomId,
  report,
  state,
  error,
  section,
  progress,
  publishedCount,
  onReportCard,
}: {
  student: StudentWithMeta
  classroomId: string
  report: StudentReport | null
  state: 'loading' | 'ready' | 'error'
  error?: unknown
  /**
   * 리포트 하나(`GET .../report`)를 세 탭이 나눠 쓴다 — 탭마다 다시 부르지 않으려고
   * 조회는 패널이 한 번만 하고, 여기서 어느 카드를 그릴지만 고른다. 카드 구성은
   * ref `SM_DTABS` 의 세 탭(smPaneSummary/smPaneStudy/smPaneAi)을 그대로 따른다:
   *  - `overview` 학습 진도 도넛 · 4주 진도 꺾은선 · 과목별 이해도 · AI 한줄 분석
   *  - `progress` 과제 제출 현황 · 세부 역량
   *  - `ai`       AI가 본 학생 · 잘하고 있어요 · 도와주면 좋아요 · 추천 활동
   */
  section: 'overview' | 'progress' | 'ai'
  /** 학습 진도(도넛) = 과제 제출률 — 목록·배너와 같은 값(useStudentRoster). 아직 없으면 null */
  progress: number | null
  /** 공개된 과제 수. `null` 은 **아직 모름**(조회 중·실패) — 0 과 갈라 써야 한다 */
  publishedCount: number | null
  /** 이 학생의 생활통지표 미리보기를 연다 (요약 탭에만 나온다) */
  onReportCard?: () => void
}) {
  const showToast = useToastStore((st) => st.show)
  const openModal = useOpenModal()
  const [clinicBusy, setClinicBusy] = useState(false)

  /**
   * 오답 클리닉 — 약점 개념으로 **새 문제를 만들어 주는 생성기**다(오답을 다시 보여주는 게 아니다).
   * 비동기라 202 + jobId 를 받아 폴링한다.
   *
   * **초안은 Redis 에만 24시간 살아 있다** (백엔드 GenerationJobStore). `ClinicService` 는
   * 과제를 저장하지 않으므로, 프론트가 `job.draft` 를 받아 `createAssignment` 로 확정하지
   * 않으면 결과물은 그대로 사라진다. 예전에는 정확히 그랬다 — draft 를 읽지도 않고 버린 뒤
   * "과제 관리에서 확인해 주세요"라는 **사실이 아닌 안내**를 띄웠고, 선생님은 목록에
   * 없는 과제를 찾아 헤맸다.
   *
   * 그래서 여기서 바로 저장한다. 단 **공개는 하지 않는다**(`publish: false` 가 기본) —
   * AI 가 만든 문제라 사람이 한 번 보고 공개하는 것이 이 프로젝트의 규칙이다
   * (AssignmentWizardModal 도 같다). 저장한 과제는 곧바로 상세 모달로 띄워
   * 선생님이 지금 화면에서 문항을 확인하고 공개까지 할 수 있게 한다.
   */
  async function startClinic() {
    setClinicBusy(true)
    try {
      const { jobId } = await reportApi.startClinic(classroomId, s.userId)
      showToast(`${s.name} 학생 맞춤 문제를 만들고 있어요...`)
      const job = await assignmentApi.pollJob(jobId)
      if (job.status !== 'DONE' || !job.draft) {
        showToast('맞춤 문제를 만들지 못했어요. 잠시 뒤에 다시 시도해 주세요.')
        return
      }
      /*
        **이 학생에게만 나가야 한다.** 서버는 대상이 비어 있으면 학급 전체 공개로 읽으므로,
        `targetStudentIds` 를 안 실으면 "OO 맞춤 문제"가 반 전체 활동지에 뜬다. 마이그레이션
        V22(assignment_target)가 만들어진 이유가 정확히 이 사고인데, 프론트가 그 필드를 보내지
        않아 되살아나 있었다.

        학년은 이제 `grade` 필드로 싣는다 — 제목에 "3학년 "을 끼워 넣던 우회는 백엔드에 학년
        컬럼이 없던 시절의 것이고(V21 에서 생겼다), 제목이 지저분해지는 대가였다.
      */
      const saved = await assignmentApi.createAssignment(
        classroomId,
        draftToCreateRequest(job.draft, {
          title: `${s.name} 맞춤 문제`,
          grade: s.grade,
          targetStudentIds: [s.userId],
        }),
      )
      showToast('맞춤 문제를 과제로 저장했어요. 확인한 뒤 공개해 주세요.')
      openModal({ type: 'assignmentDetail', assignment: saved })
    } catch (err) {
      showToast(apiErrorMessage(err, '맞춤 문제를 만들지 못했어요.'))
    } finally {
      setClinicBusy(false)
    }
  }

  if (state === 'loading') return <EmptyState title="학습 기록을 불러오는 중..." />
  if (state === 'error') {
    return (
      <EmptyState
        icon="alert"
        title="학습 기록을 불러오지 못했어요"
        hint={apiErrorMessage(error, '잠시 뒤에 다시 열어 주세요.')}
      />
    )
  }
  if (!report) return null

  // 제출 이력이 없으면 서버가 0·빈 목록·템플릿 코멘트를 준다 (에러가 아니다)
  const noData = report.gradedAssignments === 0

  const empty = (
    <EmptyState
      icon="checklist"
      title="아직 채점된 과제가 없어요"
      hint="과제를 내고 학생이 풀면 개념별 정답률이 여기에 쌓여요."
      className="min-h-[240px]"
    />
  )

  /*
    요약 — ref `smPaneSummary` 그대로: [학습 진도 도넛 | 최근 4주간 진도 변화] 2단,
    아래에 이해도 패널, 맨 아래 노란 'AI 한줄 분석'.

    숫자는 전부 실데이터다: 진도 = 과제 제출률(목록·배너와 같은 값), 4주 변화 = 제출 시각을
    주 단위로 누적한 것. 이해도 패널의 축은 ref 처럼 **과목**이다 — 과제마다 과목(국영수사과)이
    있어서 제출 점수를 과목으로 묶을 수 있다(SubjectPanel). 개념(tagStats) 축은 '학습 현황'의
    세부 역량과 'AI 분석' 이 쓴다.
  */
  if (section === 'overview') {
    return (
      <>
        <div className={GRID}>
          <div className={`${CARD} flex flex-col`}>
            <h4 className={CARD_TITLE}>학습 진도</h4>
            <ProgressDonut pct={progress ?? 0} label="전체 진도" />
            {/* 공개한 과제가 없을 때는 아무 말도 붙이지 않는다 — 도넛의 0% 가 이미 그 상태다.
                아직 **불러오는 중**인 것만 구분해 말한다 (그때 0% 는 사실이 아니다) */}
            {progress == null && publishedCount == null && (
              <p className="mt-2 text-center text-[.78rem] font-bold text-ink-mute">
                과제를 불러오는 중이에요
              </p>
            )}
          </div>
          <div className={CARD}>
            <h4 className={CARD_TITLE}>최근 4주간 진도 변화</h4>
            <WeeklyProgressBlock student={s} classroomId={classroomId} />
          </div>
        </div>

        {/*
          이해도 패널은 **채점 기록이 없어도 자리를 지킨다** — 예전엔 통째로 EmptyState 로
          갈아치웠는데, 그러면 선생님이 이 패널의 존재 자체를 모른 채 "요약 탭엔 도넛뿐" 으로
          읽는다. 값이 없을 때는 패널 안에서 '아직 기록이 없다'고만 말한다(SubjectPanel).
        */}
        <div className={`${CARD} mb-2.5`}>
          <h4 className={CARD_TITLE}>과목별 이해도</h4>
          <SubjectPanel
            student={s}
            classroomId={classroomId}
            report={report}
            clinicBusy={clinicBusy}
            onClinic={startClinic}
          />
        </div>

        {/*
          LLM 코멘트 — 서버가 의도적으로 숫자를 넣지 않는다(격려 문장). ref .sm-note.ai
          채점된 과제가 없으면 **서버 코멘트를 쓰지 않는다** — 그때 오는 건 학생을 보고 쓴 말이
          아니라 템플릿 문장이라, 'AI 분석' 딱지를 붙이면 없는 분석을 있는 것처럼 만든다.
          대신 카드는 남겨 두고 "아직 분석할 기록이 없다"고 그대로 밝힌다.
        */}
        <AiComment
          text={
            noData || !report.comment
              ? '아직 채점된 과제가 없어 AI가 분석할 학습 기록이 없어요. 과제를 내고 학생이 풀면 여기에 한줄 분석이 올라와요.'
              : report.comment
          }
        />

        {/*
          생활통지표 — 이 학생 한 명의 출결·교과평가를 A4 한 장으로 뽑는다.
          요약 탭 맨 아래에 두는 이유: 위 카드들이 통지표에 들어갈 내용 그 자체라, 선생님이
          한 번 훑어보고 나서 인쇄하는 순서가 된다. 미리보기가 먼저 열리므로 확인 단계는 없다.
        */}
        {onReportCard && (
          <div className="mt-2.5 flex justify-end">
            <Button variant="ghost" size="sm" onClick={onReportCard}>
              <Icon name="doc" />
              생활통지표 만들기
            </Button>
          </div>
        )}
      </>
    )
  }

  /*
    AI 분석 — ref `smPaneAi` 그대로: 'AI가 본 OO 학생' 문단 · [잘하고 있어요 | 도와주면
    좋아요] 2단 막대 · '추천 활동'(약한 개념 복습 + 맞춤 과제 버튼).
    ref 는 전부 지어낸 문장·숫자였지만 우리는 리포트(comment·tagStats)와 오답 클리닉으로 채운다.
  */
  if (section === 'ai') {
    /*
      **가져올 정보가 없으면 안내 카드 하나만 남긴다.** 강점·약점·추천 활동 틀을 빈 채로
      늘어놓으면 "없음" 이 세 번 반복돼 화면만 길어진다 — 값이 생기면 그때 채워진 채로 나온다.
    */
    /*
      **분석할 값이 없으면 이 묶음은 아예 그리지 않는다.** 안내 카드 한 장이라도 남기면 그
      자리는 '정보 없음' 을 말하기 위한 빈 카드가 되고, 바로 아래 말랑이 대화 기록이 이미
      같은 이야기를 한다. 값이 생기면 그때 네 카드가 채워진 채로 나타난다.
    */
    if (noData) return null
    /*
      두 카드는 **서버가 분류해 준 목록**(strengths ≥80% / weaknesses <60%)을 쓴다.
      한때 `tagStats.slice(0,2)` 와 `slice(-2)` 로 잘랐는데, 개념이 3개 이하면 두 슬라이스가
      겹쳐 **같은 개념이 양쪽 카드에 동시에** 떴다 — 개념이 하나뿐이면 정답률 20% 짜리가
      '잘하고 있어요' 에 강점으로 올라갔다. 위치가 아니라 기준으로 갈라야 맞다.
    */
    const byTag = new Map(report.tagStats.map((t) => [t.tag, t.accuracy]))
    const rows = (tags: string[]) =>
      tags.slice(0, 2).map((tag) => ({ tag, accuracy: byTag.get(tag) ?? 0 }))
    const best = rows(report.strengths)
    const worst = rows(report.weaknesses)
    // 추천은 '도와주면 좋아요' 와 같은 재료여야 한다 — 클리닉이 실제로 쓰는 것도 weaknesses 다
    const recs = report.weaknesses.slice(0, 3)
    return (
      <>
        <div className={`${CARD} mb-3`}>
          {/*
            학생 이름은 색과 크기를 달리 준다 — 이름이 '안녕하세요!' 처럼 문장처럼 읽히는
            경우가 있어서, 같은 굵기로 이어 쓰면 어디까지가 이름인지 알 수 없다.
          */}
          <h4 className={CARD_TITLE}>
            AI가 본 <span className="text-[1.16rem] text-primary">{s.name}</span> 학생
          </h4>
          <p className="break-keep text-[.86rem] font-semibold leading-[1.75] text-ink-soft">
            {report.comment ? `${report.comment} ` : ''}지금까지 채점된 과제{' '}
            {report.gradedAssignments}개에서 전체 정답률은 {report.overall}%예요.
          </p>
        </div>

        <div className={GRID}>
          <div className={CARD}>
            <h4 className={CARD_TITLE}>잘하고 있어요</h4>
            {/* 높이는 막대 두 줄(BarRow 32px × 2)에 맞춘다 — 옆 카드와 끝선이 맞는다 */}
            {best.length === 0 && (
              <p className={`${HINT_BOX} h-[64px]`}>아직 정답률 80% 이상인 개념이 없어요.</p>
            )}
            {best.map((t) => (
              <BarRow key={t.tag} name={t.tag} score={t.accuracy} />
            ))}
          </div>
          <div className={CARD}>
            <h4 className={CARD_TITLE}>도와주면 좋아요</h4>
            {worst.length === 0 && (
              <p className={`${HINT_BOX} h-[64px]`}>정답률 60% 미만인 개념이 없어요.</p>
            )}
            {worst.map((t) => (
              <BarRow key={t.tag} name={t.tag} score={t.accuracy} />
            ))}
          </div>
        </div>

        <div className={`${CARD} mt-3`}>
          <h4 className={CARD_TITLE}>
            추천 활동
            {recs[0] && (
              <span className="ml-1.5 break-keep text-[.74rem] font-bold text-ink-mute">
                가장 약한 개념 · {recs[0]}
              </span>
            )}
          </h4>
          {recs.length === 0 ? (
            /* 채워졌을 때(추천 3줄 + 버튼)와 비슷한 높이를 지킨다 */
            <p className={`${HINT_BOX} h-[182px]`}>
              정답률 60% 미만 개념이 없어 지금은 추천할 복습이 없어요.
            </p>
          ) : (
            <>
              {/* 클리닉이 실제로 만드는 것과 같은 말이다 — 기본이 객관식 5문항(ClinicOptions) */}
              {recs.map((tag) => (
                <div key={tag} className={SUB_ITEM}>
                  {tag} 복습 문제 5개
                  <span className={`${SUB_TAG} bg-sidebar-soft text-primary`}>추천</span>
                </div>
              ))}
              <Button
                variant="soft"
                size="sm"
                className="mt-3.5 w-full"
                disabled={clinicBusy}
                onClick={() => void startClinic()}
              >
                <Icon name="bulb" className="h-4 w-4" />
                {clinicBusy ? '만들고 있어요…' : '맞춤 과제로 만들기'}
              </Button>
            </>
          )}
        </div>
      </>
    )
  }

  /*
    학습 현황 — ref `smPaneStudy` 그대로: 과제 제출 현황 + 세부 역량.

    **'아직 채점된 과제가 없어요' 는 정말 아무것도 없을 때만** 띄운다(공개 과제 0개).
    과제는 있고 채점만 아직인 상태에서 그 안내를 붙이면, 바로 위 제출 현황 카드가 과제
    목록을 보여주는데 아래에서는 "없어요" 라고 말하는 셈이었다 — 그때는 제출 현황만 남기고
    세부 역량 카드는 값이 생길 때 나타난다.
  */
  if (publishedCount === 0) return empty
  return (
    <>
      <SubmissionStatusCard student={s} classroomId={classroomId} />
      {!noData && (
        <div className={CARD}>
          <h4 className={CARD_TITLE}>세부 역량</h4>
          {/* 서버가 약한 것부터 정렬해 준다 — 순서를 다시 만지지 않는다 */}
          {report.tagStats.map((t) => (
            <BarRow key={t.tag} name={t.tag} score={t.accuracy} />
          ))}
        </div>
      )}
    </>
  )
}

/** 학생별 제출 목록 — 세 카드(4주 진도·제출 현황·기록)가 같은 키로 나눠 쓰는 조회 */
function useScoreTrend(classroomId: string, userId: number) {
  return useQuery({
    queryKey: ['scoreTrend', classroomId, userId],
    queryFn: () => reportApi.getScoreTrend(classroomId, userId),
    staleTime: 60_000,
    retry: false,
  })
}

/** 공개 과제 목록 — 제출 현황·4주 꺾은선이 같은 키로 나눠 쓴다 */
function usePublishedAssignments(classroomId: string) {
  return useQuery({
    queryKey: ['assignments', classroomId],
    queryFn: () => assignmentApi.listAssignments(classroomId),
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * 최근 4주간 진도 변화 — ref `smLineChart` 자리.
 *
 * ref 는 해시로 지어낸 주간 배열(s.weeks)을 그렸지만, 우리는 **제출 시각**으로 같은 모양을
 * 만든다: 각 주 경계 시점까지 낸 공개 과제 수 / 공개 과제 수.
 *
 * **분자와 분모가 같은 모집합이어야 한다.** 예전엔 분자로 `scoreTrend.submissions` 전체를
 * 썼는데, 거기에는 나중에 비공개로 돌린 과제의 제출도 남아 있어 분자가 분모를 넘겼다
 * (`Math.min(100, …)` 이 그걸 100% 로 덮어 옆 카드의 "2/2개 제출" 과 어긋났다).
 * 지금은 공개 과제 id 집합으로 교차한 뒤, 같은 과제의 재제출은 한 번만 센다.
 */
function WeeklyProgressBlock({
  student: s,
  classroomId,
}: {
  student: StudentWithMeta
  classroomId: string
}) {
  const trend = useScoreTrend(classroomId, s.userId)
  const assignments = usePublishedAssignments(classroomId)

  if (trend.isPending || assignments.isPending) {
    return <p className={HINT}>제출 기록을 불러오는 중...</p>
  }
  if (trend.isError || assignments.isError) {
    return (
      <p className="text-[.85rem] font-bold text-danger">
        {apiErrorMessage(trend.error ?? assignments.error, '제출 기록을 불러오지 못했어요.')}
      </p>
    )
  }

  /*
    **그 아이에게 나간 과제만** 센다. 예전에는 학급의 공개 과제를 그대로 썼다 — 1학년 아이
    화면에 3학년 과제가 섞여 "안 낸 과제"로 잡혔고, 아이에게 보이지도 않는 과제가 진도를 깎았다.
  */
  const publishedIds = new Set(
    (assignments.data ?? [])
      .filter((a) => a.published && assignmentTargetsStudent(a, s))
      .map((a) => a.id),
  )
  /*
    공개한 과제가 없으면 **0% 다섯 점**을 그린다 — 바닥에 붙은 선이다.
    예전엔 한 줄 안내로 갈아쳤는데, 그러면 카드가 납작해지고 옆 도넛과 끝선이 어긋났다.
    0% 는 "아직 낸 것이 없다"는 사실과 어긋나지 않는다(분모가 없으니 진도도 없다).
  */
  if (publishedIds.size === 0) return <WeeklyLineChart vals={[0, 0, 0, 0, 0]} />

  const WEEK = 7 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const subs = (trend.data?.submissions ?? []).filter((x) => publishedIds.has(x.assignmentId))
  // [4주 전, 3주 전, 2주 전, 1주 전, 이번 주] — 그 시점까지 낸 과제의 비율 (누적이라 우상향)
  const vals = [4, 3, 2, 1, 0].map((k) => {
    const cutoff = now - k * WEEK
    // 같은 과제를 여러 번 냈어도 "낸 과제 1개" 다 — 과제 id 로 접는다
    const done = new Set(
      subs.filter((x) => new Date(x.submittedAt).getTime() <= cutoff).map((x) => x.assignmentId),
    ).size
    return Math.round((done / publishedIds.size) * 100)
  })
  return <WeeklyLineChart vals={vals} />
}

/**
 * 과제 제출 현황 — ref `smPaneStudy` 첫 카드 그대로 (제목 옆 "n/m개 제출" + 줄마다
 * 제출 완료/미제출 알약).
 *
 * ref 와 달리 미제출까지 그릴 수 있다: 공개 과제 목록(제목)과 이 학생의 제출 목록을
 * 맞춰 보면 **안 낸 과제**가 나온다. 낸 것만 나열하던 예전 카드보다 선생님이 실제로
 * 궁금한 것("뭘 안 냈나")에 답한다.
 */
function SubmissionStatusCard({
  student: s,
  classroomId,
}: {
  student: StudentWithMeta
  classroomId: string
}) {
  const assignments = usePublishedAssignments(classroomId)
  const trend = useScoreTrend(classroomId, s.userId)

  /* 위와 같은 이유 — 분모는 그 아이가 받은 과제여야 한다 */
  const published = (assignments.data ?? []).filter(
    (a) => a.published && assignmentTargetsStudent(a, s),
  )
  const doneIds = new Set((trend.data?.submissions ?? []).map((x) => x.assignmentId))
  const done = published.filter((a) => doneIds.has(a.id)).length
  const loading = assignments.isPending || trend.isPending
  const failed = assignments.isError || trend.isError

  return (
    <div className={`${CARD} mb-3`}>
      <h4 className={CARD_TITLE}>
        과제 제출 현황
        {!loading && !failed && published.length > 0 && (
          <span className="ml-1.5 text-[.8rem] font-bold text-ink-soft">
            {done}/{published.length}개 제출
          </span>
        )}
      </h4>
      {loading && <p className={HINT}>제출 기록을 불러오는 중...</p>}
      {!loading && failed && (
        <p className="text-[.85rem] font-bold text-danger">
          {apiErrorMessage(assignments.error ?? trend.error, '제출 기록을 불러오지 못했어요.')}
        </p>
      )}
      {/* 공개한 과제가 0개일 때의 안내는 두지 않는다 — 목록이 비어 있는 것으로 충분하다 */}
      {!loading &&
        !failed &&
        published.map((a) => {
          const ok = doneIds.has(a.id)
          return (
            <div key={a.id} className={SUB_ITEM}>
              <span className="min-w-0 truncate">{a.title}</span>
              <span
                className={`${SUB_TAG} ${ok ? 'bg-success text-success-deep' : 'bg-task-soft text-task-deep'}`}
              >
                {ok ? '제출 완료' : '미제출'}
              </span>
            </div>
          )
        })}
    </div>
  )
}

/**
 * 과목별 이해도 — ref '과목별 이해도'(`.sm-subj-panel`) 그대로, 축도 **과목**이다.
 * 왼쪽 세로 탭(과목 + %)에서 고르면 오른쪽 본문이 그 과목의 막대·과제 수로 바뀌고,
 * 맨 아래 '맞춤 학습 추천 받기'(= 오답 클리닉)가 붙는다.
 *
 * 숫자는 **점수 추이**(`GET .../submissions`)에서 나온다 — 리포트(`tagStats`)는 개념 축이라
 * 과목 이름을 만들 수 없다. 제출 한 줄마다 과제의 과목(`subject`)이 함께 오므로, 채점된
 * 제출을 과목으로 묶어 평균을 낸다. 과목 이름은 과제 화면과 같은 표(`assignmentTheme`)를 쓴다.
 *
 * 채점 안 된 제출(수동 채점 유형은 `score` 가 null)은 분모에서도 뺀다 — 0점으로 세면
 * 제출한 학생의 이해도가 실제보다 낮게 나온다.
 */
function SubjectPanel({
  student: s,
  classroomId,
  report,
  clinicBusy,
  onClinic,
}: {
  student: StudentWithMeta
  classroomId: string
  report: StudentReport
  clinicBusy: boolean
  onClinic: () => Promise<void>
}) {
  const trend = useScoreTrend(classroomId, s.userId)
  const [sel, setSel] = useState(0)

  /**
   * 과목마다 [평균 점수, 과제 수] — **항상 국영수사과 순서**로 늘어놓는다.
   *
   * 예전엔 제출이 나온 순서를 그대로 썼다. 과목이 국어·한자 둘뿐일 때는 티가 안 났지만
   * 5과목이 되면 탭 순서가 제출 이력에 따라 학생마다 다르게 뒤섞인다 — 선생님이 학생을
   * 넘겨 볼 때 같은 자리에 다른 과목이 온다. `sel` 은 **인덱스**라 더 나쁘다: 순서가 바뀌면
   * 고른 과목이 조용히 다른 과목으로 옮겨 간다.
   */
  const subjects = (() => {
    const acc = new Map<Subject, { sum: number; n: number }>()
    for (const x of trend.data?.submissions ?? []) {
      if (x.score == null) continue
      const cur = acc.get(x.subject) ?? { sum: 0, n: 0 }
      acc.set(x.subject, { sum: cur.sum + x.score, n: cur.n + 1 })
    }
    return SUBJECT_CODES.filter((code) => acc.has(code)).map((subject) => {
      const v = acc.get(subject)!
      return {
        subject,
        label: assignmentTheme(subject).label,
        accuracy: Math.round(v.sum / v.n),
        count: v.n,
      }
    })
  })()

  if (trend.isPending) return <p className={`${HINT_BOX} h-[242px]`}>점수를 불러오는 중...</p>
  if (trend.isError) {
    return (
      <p className="text-[.85rem] font-bold text-danger">
        {apiErrorMessage(trend.error, '점수를 불러오지 못했어요.')}
      </p>
    )
  }

  /*
    **하이라이트도 같은 클램프 값을 쓴다.** 본문만 클램프하고 탭은 원본 `sel` 로 비교하면,
    보고 있는 동안 과목 수가 줄었을 때 `sel` 이 범위를 벗어나 **어느 탭에도 불이 안 들어온 채**
    본문만 마지막 과목을 보여준다 (aria-selected 인 탭이 0개가 된다).
  */
  const idx = Math.min(sel, Math.max(0, subjects.length - 1))
  const cur = subjects[idx]
  /* 채점된 과제가 없으면 판을 그릴 재료가 없다 — 높이는 채워진 판에 맞춰 둔다 */
  if (!cur)
    return (
      <p className={`${HINT_BOX} mx-auto h-[242px] max-w-[420px]`}>
        아직 채점된 과제가 없어 과목별 이해도 정보가 없어요. 과제를 내고 학생이 풀면 과목마다
        이해도가 쌓여요.
      </p>
    )

  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-5 max-[720px]:grid-cols-1">
      <div className="flex flex-col gap-2" role="tablist" aria-label="과목 선택">
        {subjects.map((t, i) => (
          <button
            key={t.subject}
            type="button"
            role="tab"
            aria-selected={i === idx}
            data-active={i === idx}
            onClick={() => setSel(i)}
            className="group flex w-full items-center justify-between gap-2 rounded-[14px] border-2 border-track bg-card p-[8px_11px] text-left transition-colors hover:border-sidebar-soft data-[active=true]:border-primary data-[active=true]:bg-primary"
          >
            <span className="min-w-0 truncate text-[1.02rem] font-black text-ink group-data-[active=true]:text-white">
              {t.label}
            </span>
            <span className="flex-none text-right text-[.98rem] font-extrabold text-ink-soft group-data-[active=true]:text-white">
              {t.accuracy}%
            </span>
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-col border-l-2 border-track pl-6 max-[720px]:border-l-0 max-[720px]:pl-0">
        <h5 className="mb-[18px] text-[1.02rem] font-black text-ink-soft">
          <span className="text-ink">{cur.label}</span> 이해도
        </h5>
        <div className="flex items-center gap-3.5">
          <div className="min-w-0 flex-1">
            <LevelBar score={cur.accuracy} />
          </div>
          <span className="flex-none whitespace-nowrap text-[.94rem] font-bold text-ink-soft">
            이해도 <b className="ml-[5px] font-black text-primary">{cur.accuracy}%</b>
          </span>
        </div>
        <p className="mt-2.5 text-[.8rem] font-semibold text-ink-mute">
          채점된 {cur.label} 과제 {cur.count}개의 평균이에요. 과제 수가 적으면 아직 판단하기 일러요.
        </p>
        {/* ref .sm-rec-btn — width:100% / margin-top:14px */}
        <Button
          variant="soft"
          size="sm"
          className="mt-3.5 w-full"
          disabled={clinicBusy || report.weaknesses.length === 0}
          onClick={() => void onClinic()}
        >
          <Icon name="bulb" className="h-4 w-4" />
          {clinicBusy ? '만들고 있어요…' : '맞춤 학습 추천 받기'}
        </Button>
      </div>
    </div>
  )
}

/** 서버가 준 한 줄 평 — ref `.sm-note.ai` (요약 탭 맨 아래 노란 카드) */
function AiComment({ text }: { text: string }) {
  return (
    <div className="rounded-tile border-2 border-task bg-task-soft p-[14px_16px]">
      <h4 className="mb-[9px] flex items-center justify-start gap-2 text-[.88rem] font-black text-task-deep">
        <Icon name="aichat" className="h-[17px] w-[17px] flex-none" />
        AI 한줄 분석
      </h4>
      <p className="break-keep text-[.86rem] font-semibold leading-[1.7]">{text}</p>
    </div>
  )
}

/* ── 로그인 정보 ──────────────────────────────────────────────── */

/**
 * 아이디와 비밀번호를 **한자리에** 보여준다 (설정 탭).
 *
 * 단, 비밀번호는 **초기화한 뒤에만** 값이 있다. 서버는 해시만 갖고 있어 "지금 비밀번호"를
 * 돌려주는 엔드포인트가 없고(학생 명단도 임시비번을 빼고 준다), 유일하게 값을 주는
 * `POST /students/{id}/password-reset` 은 **새로 만들면서** 한 번만 알려준다.
 * 그래서 초기화 전에는 자리만 잡아 두고, 왜 못 보여주는지 그 자리에 적는다.
 *
 * 초기화는 지금 쓰던 비밀번호를 못 쓰게 만드는 일이라 **먼저 확인을 받는다** —
 * 로그인이 잘 되고 있는 학생의 비밀번호를 무심코 갈아버리면 수업 중에 못 들어온다.
 *
 * 받은 값은 사라지는 토스트가 아니라 이 카드에 남긴다 (가이드라인 10장 ④).
 */
function LoginCard({ student: s }: { student: StudentWithMeta }) {
  const showToast = useToastStore((st) => st.show)
  const [reset, setReset] = useState<PasswordResetResponse | null>(null)
  const [busy, setBusy] = useState(false)
  /** 눈 아이콘 상태. 초기화 직후에는 켜 둔다 — 받자마자 적어야 하는 값이다 */
  const [revealed, setRevealed] = useState(true)

  async function resetPassword() {
    const ok = await confirmAction({
      title: `${s.name} 학생의 비밀번호를 초기화할까요?`,
      message:
        '지금 쓰던 비밀번호는 바로 쓸 수 없게 돼요.\n새 임시 비밀번호를 학생에게 알려주세요.',
      confirmLabel: '초기화하기',
    })
    if (!ok) return
    setBusy(true)
    try {
      setReset(await inviteApi.resetStudentPassword(s.userId))
    } catch (err) {
      showToast(apiErrorMessage(err, '비밀번호를 초기화하지 못했어요.'))
    } finally {
      setBusy(false)
    }
  }

  const Row = ({
    label,
    value,
    mono,
    trailing,
  }: {
    label: string
    value: string
    mono?: boolean
    /** 값 오른쪽에 붙는 버튼 자리 (비밀번호의 눈 아이콘) */
    trailing?: ReactNode
  }) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="flex-none text-[.78rem] font-bold text-ink-mute">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={`min-w-0 truncate text-[1.05rem] font-black text-ink ${mono ? 'font-mono tracking-wide' : ''}`}
        >
          {value}
        </span>
        {trailing}
      </span>
    </div>
  )

  /**
   * 지금 화면이 **평문으로 들고 있는** 비밀번호. 방금 초기화해서 받은 값뿐이다.
   * 서버는 BCrypt 해시만 갖고 있어 이미 쓰고 있는 비밀번호는 어떤 API 로도 가져올 수 없다
   * (docs/backend-request-student-initial-password.md — 조회 API 를 요청해 둔 상태).
   */
  const plain = reset?.temporaryPassword ?? null

  return (
    <div className={`${CARD} mb-2.5`}>
      <h4 className={CARD_TITLE}>로그인 정보</h4>
      <Row label="아이디" value={s.username} mono />
      <Row
        label="비밀번호"
        value={plain && revealed ? plain : '● ● ● ● ● ●'}
        mono={!!(plain && revealed)}
        trailing={
          /*
            눈 아이콘 — **가릴 값이 있을 때만** 누를 수 있다. 값이 없을 때도 누르게 두면
            눌러도 아무 일이 없어 고장으로 읽힌다. 그래서 비활성으로 두고 `title` 로
            "왜 못 보는지"를 말한다 (아래 안내문과 같은 내용).
          */
          <button
            type="button"
            disabled={!plain}
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? '비밀번호 가리기' : '비밀번호 보기'}
            title={
              plain
                ? revealed
                  ? '가리기'
                  : '보기'
                : '서버에 비밀번호 원문이 남지 않아 볼 수 없어요. 아래 ‘비밀번호 초기화’로 새 비밀번호를 받으세요.'
            }
            className="grid h-7 w-7 flex-none place-items-center rounded-lg text-ink-mute transition-colors hover:bg-canvas hover:text-ink-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Icon name={revealed ? 'eyeOff' : 'eye'} className="h-4 w-4" />
          </button>
        }
      />

      {reset ? (
        <>
          <Button
            size="sm"
            className="mt-3 w-full"
            /*
              복사가 **되고 나서** 성공을 말한다. 예전엔 결과를 안 보고 바로 토스트를 띄웠는데,
              http 로 열었거나 권한이 막히면 clipboard 가 없거나 거부돼 아무것도 복사되지
              않은 채 "복사했어요" 만 떴다 — 임시 비밀번호는 지금 못 받으면 영영 못 받는 값이라
              이 거짓말의 대가가 크다.
            */
            onClick={() => {
              const text = `${reset.username} / ${reset.temporaryPassword}`
              const done = navigator.clipboard?.writeText(text)
              if (!done) return showToast('이 브라우저에서는 복사할 수 없어요. 직접 적어 주세요.')
              void done
                .then(() => showToast('아이디와 비밀번호를 복사했어요'))
                .catch(() => showToast('복사하지 못했어요. 위 값을 직접 적어 주세요.'))
            }}
          >
            <Icon name="checklist" className="h-4 w-4" />
            아이디·비밀번호 복사
          </Button>
          <p className="mt-2.5 text-[.78rem] font-bold text-task-deep">
            지금만 보여요. 화면을 벗어나면 다시 볼 수 없으니 꼭 적어두거나 복사해 주세요.
          </p>
        </>
      ) : (
        <>
          <Button
            variant="soft"
            size="sm"
            className="mt-3 w-full"
            disabled={busy}
            onClick={() => void resetPassword()}
          >
            <Icon name="key" className="h-4 w-4" />
            {busy ? '초기화하는 중…' : '비밀번호 초기화'}
          </Button>
          {/*
            작은 회색 글씨로 두면 눈 아이콘이 왜 안 눌리는지 모른 채 "비밀번호가 안 뜬다"로
            읽힌다. 지금 화면이 못 하는 일이라, 배경을 넣어 읽고 지나가게 만든다.
          */}
          <p className="mt-2.5 flex items-start gap-2 rounded-2xl bg-task-soft p-[10px_12px] text-[.78rem] font-bold leading-[1.5] text-task-deep">
            <Icon name="lock" className="mt-px h-4 w-4 flex-none" />
            <span>
              쓰고 있는 비밀번호는 서버에도 원문이 남지 않아 <b className="font-black">볼 수 없어요.</b>
              <br />
              초기화하면 새 임시 비밀번호가 아이디와 함께 여기 나와요.
            </span>
          </p>
        </>
      )}
    </div>
  )
}

/* ── 설정 (계정) ──────────────────────────────────────────────── */

/**
 * 학생 설정 — 지금 다루는 것은 **계정 하나**다(아이디 · 비밀번호 초기화).
 *
 * 예전엔 '메모' 탭이었고 서버에 저장되는 메모 목록(notes API)이 함께 있었다. 선생님이 이
 * 탭에서 실제로 하는 일은 "로그인이 안 된다"는 학생의 계정을 손보는 것이라, 이름을 '설정'
 * 으로 바꾸고 메모 칸은 걷어냈다 — 메모 엔드포인트 자체는 서버에 그대로 남아 있어서
 * 다시 필요해지면 되살릴 수 있다(classroomApi.listNotes 등).
 */
export function SettingsPane({ student: s }: { student: StudentWithMeta }) {
  /*
    아이디는 프로필 줄에 있던 것을 여기로 옮겨 온 것이다 — 아이디를 찾는 때는 대개 로그인
    문제이고, 그때 필요한 건 아이디 **와** 비밀번호 초기화라 둘이 한자리에 있어야 한다.
  */
  return <LoginCard student={s} />
}


/* ── 기록 (최근 기록 타임라인) ─────────────────────────────────── */

/**
 * 최근 기록 — ref `smPaneLog`(`.sm-timeline`) 그대로: 세로 선 + 점 + [언제 / 무엇] 줄.
 *
 * ref 는 지어낸 이벤트("2일 전 · OO 제출")를 나열했지만 우리는 실제 두 이력을 섞는다:
 *  - 출석(`GET .../attendance`) — 수업마다 출석/결석, 참여 시간
 *  - 제출(`GET .../submissions`) — 과제 제출 시각, 점수
 * 최근 것이 위로 오게 합쳐 정렬한다. 두 API 의 원래 정렬이 서로 반대(출석은 최근 먼저,
 * 제출은 오래된 먼저)라 합칠 때 시각으로 다시 세운다.
 */
export function RecordPane({
  student: s,
  classroomId,
}: {
  student: StudentWithMeta
  classroomId: string
}) {
  const attendance = useQuery({
    queryKey: ['attendance', classroomId, s.userId],
    queryFn: () => sessionApi.getAttendance(classroomId, s.userId),
    staleTime: 60_000,
    retry: false,
  })
  const trend = useScoreTrend(classroomId, s.userId)
  const loading = attendance.isPending || trend.isPending
  const bothFailed = attendance.isError && trend.isError
  /*
    한쪽만 실패한 경우를 **말해 준다.** 예전엔 `isError && isError` 로만 실패를 판정해서,
    제출 조회가 죽고 출석이 빈 배열로 성공하면 items 가 비어 "아직 기록이 없어요" 를 띄웠다 —
    제출 기록이 여럿 있는 학생인데도 아무 경고 없이 '없음' 으로 읽혔다.
  */
  const partialFail = !bothFailed && (attendance.isError || trend.isError)

  const items: { at: number; what: string }[] = [
    ...(attendance.data?.sessions ?? []).map((e) => ({
      at: new Date(e.startedAt).getTime(),
      what: e.attended ? `수업 출석 · ${e.minutes}분 참여` : '수업 결석',
    })),
    ...(trend.data?.submissions ?? []).map((x) => ({
      at: new Date(x.submittedAt).getTime(),
      what: `${x.assignmentTitle} 제출${x.score != null ? ` · ${x.score}점` : ''}`,
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 12)

  return (
    <div className={CARD}>
      <h4 className={CARD_TITLE}>최근 기록</h4>
      {loading && <p className={HINT}>기록을 불러오는 중...</p>}
      {!loading && bothFailed && (
        <p className="text-[.85rem] font-bold text-danger">
          {apiErrorMessage(attendance.error, '기록을 불러오지 못했어요.')}
        </p>
      )}
      {!loading && partialFail && (
        <p className="mb-2.5 text-[.82rem] font-bold text-danger">
          {attendance.isError ? '출석' : '과제 제출'} 기록을 불러오지 못했어요. 아래는 나머지만 모은
          것이에요.
        </p>
      )}
      {!loading && !bothFailed && !partialFail && items.length === 0 && (
        <p className={HINT}>아직 기록이 없어요. 수업을 열거나 과제를 내면 여기에 쌓여요.</p>
      )}
      {/* 로딩 중에는 그리지 않는다 — 한쪽만 캐시로 먼저 오면 반쪽 목록이 떴다가 재정렬돼 튄다 */}
      {!loading && items.length > 0 && (
        <div className="relative pl-5 before:absolute before:bottom-1.5 before:left-[5px] before:top-1.5 before:w-[2px] before:bg-track">
          {items.map((it, i) => (
            <div
              key={`${it.at}-${i}`}
              className="relative pb-4 last:pb-0 before:absolute before:-left-[19px] before:top-[5px] before:h-2.5 before:w-2.5 before:rounded-full before:bg-primary before:shadow-[0_0_0_3px_var(--color-card)]"
            >
              <div className="text-[.72rem] font-extrabold text-ink-mute">{tlWhen(it.at)}</div>
              <div className="mt-[3px] break-keep text-[.85rem] font-bold">{it.what}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 타임라인의 "언제" — 오늘이면 시각, 아니면 날짜 */
function tlWhen(at: number): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
}

