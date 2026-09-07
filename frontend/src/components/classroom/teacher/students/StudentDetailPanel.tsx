import { useQuery } from '@tanstack/react-query'
import { Icon, type IconName } from '@/components/common/Icon'
import { reportApi } from '@/services/api/reportApi'
import { SM_AVATAR_BG, SM_CHARS, type StudentWithMeta } from '@/lib/studentMeta'
import { RecordPane, SettingsPane, SummaryPane } from './DetailPanes'

export type DetailTab = 'overview' | 'progress' | 'ai' | 'record' | 'settings'

/** ref `.sm-dtabs` 와 같은 5개 */
const TABS: { key: DetailTab; label: string; icon: IconName }[] = [
  { key: 'overview', label: '요약', icon: 'chart' },
  { key: 'progress', label: '학습 현황', icon: 'checklist' },
  { key: 'ai', label: 'AI 분석', icon: 'aichat' },
  // 출석·점수 추이는 서버가 실제로 주게 된 뒤에야 되살아난 탭이다 (백엔드 S15P11A407-137)
  { key: 'record', label: '기록', icon: 'calendar' },
  // 계정(아이디·비밀번호 초기화)을 다루는 자리라 '메모' 가 아니라 '설정' 이다
  { key: 'settings', label: '설정', icon: 'gear' },
]

/**
 * 선택한 학생의 상세 — 모달이 아니라 목록 오른쪽의 **붙박이 패널**이다 (ref .sm-detail).
 * 그래서 "목록 -> 상세"가 클릭 1번이고, 다른 학생으로 바꿔도 화면이 통째로 안 바뀐다.
 *
 * **탭은 서버가 실제로 주는 것만 있다.** 예전 '요약·학습 현황·AI 분석·기록' 4탭은 전부
 * `deriveStudent()` 가 해시로 지어낸 값(진도·출석·과목별 점수·주간 추이·타임라인)이라 통째로
 * 지웠고, 남은 것은 리포트 하나뿐이었다. 그 뒤 S15P11A407-137 로 출석·점수 추이·말랑이
 * 기록이 진짜 API 가 되면서 '기록'·'말랑이 대화' 탭이 **실데이터로** 돌아왔다.
 *
 * 데이터는 TanStack Query 로 받는다 — 목록에서 학생을 왔다 갔다 하면 같은 리포트를 계속
 * 다시 부르게 되는데, 캐시가 있으면 두 번째부터는 즉시 뜬다.
 */
export function StudentDetailPanel({
  student: s,
  classroomId,
  tab,
  onTabChange,
  progress = null,
  publishedCount = null,
  onReportCard,
}: {
  student: StudentWithMeta
  classroomId: string
  tab: DetailTab
  onTabChange: (tab: DetailTab) => void
  /** 학습 진도(= 과제 제출률) — 목록·배너와 같은 값(useStudentRoster). 아직 없으면 null */
  progress?: number | null
  /** 공개된 과제 수. `null` 은 **아직 모름**(조회 중·실패) — 0 과 갈라 써야 한다 */
  publishedCount?: number | null
  /** 이 학생의 생활통지표 미리보기를 연다 — 요약 탭 맨 아래 버튼 */
  onReportCard?: () => void
}) {
  const {
    data: report,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ['report', classroomId, s.userId],
    queryFn: () => reportApi.getReport(classroomId, s.userId),
    // 수업 중에 계속 바뀌는 값이 아니다 — 학생을 오갈 때 매번 다시 부르지 않게 잠시 신선하다고 본다
    staleTime: 60_000,
    retry: false,
  })

  /*
    헤더 칩도 리포트에서 나온다. 예전 '전체 진도 / 최근 학습 / AI 주의사항 N건' 은 모두
    지어낸 값이었다 — 특히 '최근 학습'(오늘 09:32 같은)은 서버에 대응 데이터가 아예 없다.
  */
  const chips: { icon: IconName; label: string; value: string }[] = report
    ? [
        { icon: 'chart', label: '전체 정답률', value: `${report.overall}%` },
        { icon: 'checklist', label: '채점된 과제', value: `${report.gradedAssignments}개` },
        { icon: 'alert', label: '챙겨줄 개념', value: `${report.weaknesses.length}개` },
      ]
    : []

  /*
    부모 그리드(items-stretch)를 그대로 받아 **왼쪽 목록 패널과 위·아래 끝이 맞는다.**

    예전에는 `sticky top-6 + self-start` 였다. 목록을 스크롤하는 동안 상세를 붙박이로 두려던
    것인데, 둘은 동시에 성립하지 않는다 — sticky 는 자기 컨테이닝 블록보다 작아야 움직일 여지가
    생기므로, 높이를 왼쪽에 맞추면(stretch) 붙박이가 붙지 않는다. 두 패널의 끝선이 어긋나
    보이는 쪽이 더 눈에 걸려서 끝 맞춤을 택했다.

    **패널은 스크롤하지 않는다.** 내용만큼 늘어나고 스크롤은 페이지(콘텐츠 영역) 하나로만
    한다 — 패널 안에도 스크롤바를 두면 휠을 굴리는 위치에 따라 다른 것이 움직인다.

    `overflow-hidden` 은 둥근 모서리를 지키기 위한 것이다 — 바로 아래 프로필 밴드가 깔는
    배경 사진(header_bg)은 네모라서, 잘라 주지 않으면 각진 모서리가 이 패널의 둥근 모서리와
    보더 밖으로 삐져나온다. 예전에는 `overflow-y-auto` 가 그 일을 겸하고 있었다.
  */
  return (
    <aside
      aria-label="선택한 학생 상세"
      className="min-w-0 overflow-hidden rounded-card border-2 border-track bg-card shadow-card"
    >
      {/*
        프로필 밴드 — header_bg.png(2103x748)는 위쪽이 연보라, 아래쪽이 투명이고 그 경계가
        완만한 물결이다. 세로를 밴드 높이의 155%로 늘려 깔면 물결선이 밴드 아래변에 걸쳐
        아래가 직선이 아닌 물결 모양이 된다.

        `flex-wrap` 은 아주 좁을 때(모바일 1단)만 쓰는 안전장치다 — 칩 줄이 들어갈 자리가
        아예 없으면 그때는 아래 줄로 내려간다.
      */}
      <div className="@container flex flex-wrap items-center gap-4 bg-card bg-[url('/assets/header_bg.webp')] bg-[length:100%_155%] bg-[position:center_top] bg-no-repeat p-[16px_24px]">
        <span
          className="grid h-[74px] w-[74px] flex-none place-items-center overflow-hidden rounded-full"
          style={{ background: SM_AVATAR_BG[s.charIdx] }}
          aria-hidden="true"
        >
          <img
            src={SM_CHARS[s.charIdx]}
            alt=""
            decoding="async"
            className="h-[58px] w-[58px] object-contain"
          />
        </span>

        {/*
          `min-w-0` — 이름 칸이 먼저 줄어들어야 오른쪽 칩 세 개가 같은 줄에 남는다.
          예전엔 `min-w-[180px]` 이라 이 칸이 180px 아래로 안 줄어들어서, 칩이 들어갈 자리가
          모자라면 칩이 통째로 아래 줄로 내려갔다.
        */}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[1.45rem] font-black tracking-[-.3px]">{s.name}</h3>
          {/*
            학교와 학년을 이름 **아래 한 줄**에 둔다. 학년 알약을 이름 옆에 두면 긴 이름일수록
            알약이 밀려 오른쪽 칩과 뒤엉켰고, 학교·학년은 같은 성격(소속)이라 한 줄에 있는 게 읽기 쉽다.
            아이디는 뺐다 — 로그인 안내에 쓸 값이라 '설정' 탭의 계정 칸으로 옮겼다.
          */}
          <div className="mt-[7px] flex flex-wrap items-center gap-2 text-[.88rem] font-semibold text-ink-soft">
            <span className="min-w-0 truncate">{s.school}</span>
            {/* 학년은 알약으로 — 이름 옆에 있던 그 캡슐을 이 줄로 옮겨 온 것이다 */}
            <span className="flex-none whitespace-nowrap rounded-full bg-sky p-[4px_11px] text-[.72rem] font-black text-primary">
              {s.team}
            </span>
          </div>
        </div>

        {/*
          칩 세 개는 **항상 프로필 오른쪽 같은 줄**에 둔다 (ref .sm-d-chips).
          예전엔 패널 폭 700px 미만에서 `basis-full` 로 아래 줄로 내렸는데, 2단 배치의 패널 폭이
          그 경계 바로 아래(약 687px)라 늘 줄바꿈이 일어났다. 이제 왼쪽 이름 칸이 줄어들어
          자리를 내준다.
        */}
        <div className="ml-auto flex flex-none flex-wrap justify-end gap-2.5">
          {chips.map((c) => (
            <div
              key={c.label}
              className="flex items-center gap-[9px] rounded-2xl bg-card p-[10px_14px]"
            >
              <span
                className="grid h-7 w-7 flex-none place-items-center text-primary"
                aria-hidden="true"
              >
                <Icon name={c.icon} className="h-[22px] w-[22px]" />
              </span>
              <div>
                <div className="whitespace-nowrap text-[.72rem] font-bold text-ink-soft">
                  {c.label}
                </div>
                <div className="mt-px whitespace-nowrap text-[1rem] font-black text-primary">
                  {c.value}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        /* 5개가 폭을 균등하게 나눠 갖는다 — 밑줄도 각 칸 전체 폭이라 지금 어디인지가 또렷하다
           (과제 상세 탭바와 같은 규칙이다) */
        className="flex items-stretch border-b-2 border-track px-6"
        role="tablist"
        aria-label="학생 상세 보기 전환"
      >
        {TABS.map((t) => {
          const on = t.key === tab
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onTabChange(t.key)}
              data-active={on}
              className="relative flex min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap p-[16px_2px_14px] text-[.95rem] font-extrabold text-ink-mute transition-colors hover:text-ink-soft data-[active=true]:text-primary data-[active=true]:after:absolute data-[active=true]:after:inset-x-0 data-[active=true]:after:-bottom-0.5 data-[active=true]:after:h-[3px] data-[active=true]:after:rounded-full data-[active=true]:after:bg-primary max-[560px]:text-[.8rem] max-[560px]:[&_svg]:hidden"
            >
              <span className="grid place-items-center" aria-hidden="true">
                <Icon name={t.icon} className="h-[19px] w-[19px]" />
              </span>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* key 를 주어 학생·탭이 바뀔 때마다 등장 애니메이션이 다시 돈다 */}
      <div
        key={`${s.userId}-${tab}`}
        role="tabpanel"
        className="animate-fade-up p-[16px_24px_18px]"
      >
        {/*
          요약·학습 현황·AI 분석은 **리포트 한 번**을 나눠 쓴다 (조회는 위에서 한 번뿐이고
          `section` 으로 어느 카드를 그릴지만 고른다). 탭을 오갈 때 다시 부르지 않는다.
        */}
        {(tab === 'overview' || tab === 'progress' || tab === 'ai') && (
          <SummaryPane
            student={s}
            classroomId={classroomId}
            report={report ?? null}
            state={isPending ? 'loading' : isError ? 'error' : 'ready'}
            error={error}
            section={tab}
            progress={progress}
            publishedCount={publishedCount}
            onReportCard={onReportCard}
          />
        )}
        {/*
          말랑이 대화 기록(`TutorPane`)은 여기서 뺐다 — 선생님 요청.

          "이 학생에게 AI 가 무엇을 했는지 한 자리에서" 보여주려고 AI 분석 탭에 함께 뒀는데,
          이 탭에서 볼 것은 **개념별 정답률·강점·약점** 이고 대화 기록은 그와 다른 이야기다.
          아이가 말랑이에게 뭘 물었는지까지 선생님이 들여다보는 것은 필요 이상이기도 하다.
          그래서 탭을 열 때 `GET .../tutor-messages` 도 더 이상 부르지 않는다.
        */}
        {tab === 'record' && <RecordPane student={s} classroomId={classroomId} />}
        {tab === 'settings' && <SettingsPane student={s} />}
      </div>
    </aside>
  )
}
