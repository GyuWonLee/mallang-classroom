import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { backLabelFor, backTarget, fromState, teacherRoutes, type ManageTab } from '@/lib/routes'
import { Icon, type IconName } from '@/components/common/Icon'
import { Input } from '@/components/common/Input'
import { Button } from '@/components/common/Button'
import { TeacherShell } from '@/components/classroom/teacher/TeacherShell'
import type { TeacherNavKey } from '@/components/classroom/teacher/TeacherSidebar'
import { ClassHeatmapCard } from '@/components/classroom/teacher/ClassHeatmapCard'
import { SessionHistoryCard } from '@/components/classroom/teacher/SessionHistoryCard'
import { useToastStore } from '@/stores/useToastStore'
import { confirmAction } from '@/stores/useConfirmStore'
import { classroomApi } from '@/services/api/classroomApi'
import { useOpenModal } from '@/stores/useModalStore'
import { apiErrorMessage, errorSlug } from '@/lib/apiError'
import { useClassroomsStore } from '@/stores/useClassroomsStore'
import type { ClassroomDetail, ClassroomMember, ClassroomRole } from '@/types/teacher'
import { MaterialsCard } from '@/components/classroom/teacher/MaterialsCard'
import { useTeacherPresence } from '@/hooks/useTeacherPresence'

type Tab = ManageTab
// 학생·과제는 여기 탭이 아니라 각각 별도 화면이다 (ref 화면 4·5) — "지금 할 일"과
// "관리/설정"을 화면 단위로 나누는 원칙 (ref DESIGN_GUIDELINES 0장)
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '개요' },
  // 수업 전 "오늘 누굴 챙길지" 고르는 화면 — 개요와 성격이 달라 탭을 따로 뒀다 (백엔드 -127)
  { key: 'understanding', label: '이해도' },
  { key: 'materials', label: '학습자료' },
]

/** ref .panel — radius --r-lg(28px) · padding 22px 24px */
const cardCls = 'rounded-card bg-card p-[22px_24px] shadow-card'
const sectionTitle = 'flex items-center gap-2 text-[1.05rem] font-black'
/**
 * 제목 옆 아이콘 — ref `.h2-icon` 은 파랑 28px 이지만 그건 페이지 최상위 섹션 헤더(1.8rem)용이다.
 * 여기 제목들은 ref `.panel h3`(1.05rem) 자리라 글자 크기에 맞춰 22px 로 줄인다. 색은 ref 그대로.
 */
const titleIcon = 'h-[22px] w-[22px] flex-none text-primary'

/** 선생님 학급 관리 대시보드 — 톱니바퀴 진입. 초대·구성원·학습자료 모두 실서버다 */
export function TeacherClassManagePage() {
  // 이 화면에 있는 동안에도 학생 질문을 받는다 (백엔드는 STOMP 접속을 온라인으로 본다)
  useTeacherPresence()
  const navigate = useNavigate()
  const location = useLocation()
  const { classroomId } = useParams()
  const id = classroomId ?? ''

  /**
   * 같은 흐름 안에서 들어왔으면 그 출발지로 — 라이브 수업에서 왔으면 **그 수업으로** 복귀하고,
   * 내 학급 카드의 "관리"로 왔으면 내 학급으로 간다.
   *
   * 출발지가 없으면(사이드바 설정·딥링크) 정식 관문인 **담당 학급 선택**으로 간다
   * (routes.ts 규칙 1). 예전 fallback 은 학급 화면(L2)이라, 학급에 들어간 적도 없는데
   * 뒤로가기가 학급 안으로 들여보냈다.
   */
  const back = backTarget(location.state, teacherRoutes.pickClass('overview'))
  const [detail, setDetail] = useState<ClassroomDetail | null>(null)

  // 탭은 URL(?tab=)이 진실의 원천 — 사이드바의 과제/학생 메뉴가 바로 그 탭으로 들어온다
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : 'overview'
  // replace 로 바꿔서 탭 전환이 뒤로가기 기록을 더럽히지 않게 한다.
  // state 를 그대로 넘겨야 출발지(from)가 살아남는다 — 안 넘기면 탭만 바꿔도 수업으로 못 돌아간다.
  const setTab = (next: Tab) =>
    setSearchParams({ tab: next }, { replace: true, state: location.state })

  const loadDetail = useCallback(() => {
    if (id) void classroomApi.getClassroom(id).then(setDetail)
  }, [id])
  useEffect(loadDetail, [loadDetail])

  /*
    이 화면은 사이드바 "설정"의 도착지다. active 를 'home' 으로 박아 두면 설정을 눌러도
    "내 학급"에 불이 들어와 지금 어디 있는지 알 수 없었다 (내 학급은 /teacher 한 곳뿐이다).
  */
  const navActive: TeacherNavKey = 'settings'

  return (
    <TeacherShell active={navActive} classroomId={id}>
      <>
        {/*
          헤더는 나가는 문 하나만 둔다.
          예전에는 "학급 화면으로"(뒤로)와 "수업 입장"(파란 버튼)이 **똑같이 `back` 으로** 갔다 —
          라벨이 달라서 서로 다른 곳으로 가는 것처럼 보이는 게 더 헷갈렸다.
        */}
        <div className="mb-5">
          <Button variant="back" onClick={() => navigate(back)}>
            <Icon name="back" className="h-[15px] w-[15px]" />
            {backLabelFor(back, detail?.name)}
          </Button>
        </div>

        <div className={`${cardCls} mb-5 flex flex-wrap items-center gap-4`}>
          <span
            className="grid h-16 w-16 flex-none place-items-center rounded-[20px] bg-sky text-primary"
            aria-hidden="true"
          >
            <Icon name="book" className="h-8 w-8" />
          </span>
          <div className="min-w-0 flex-1">
            <ClassNameHeading
              id={id}
              name={detail?.name ?? ''}
              canManage={detail?.myRole === 'OWNER' || detail?.myRole === 'MAINTAINER'}
              // 삭제는 담당(OWNER)만 — 공동 관리자가 누르면 서버가 403 을 준다
              canDelete={detail?.myRole === 'OWNER'}
              onChanged={loadDetail}
            />
            <p className="mt-1 text-[.9rem] font-semibold text-ink-soft">
              {detail?.school ?? '—'} · 선생님 {detail?.memberCounts.teachers ?? 0}명 · 학생{' '}
              {detail?.memberCounts.students ?? 0}명
              {(detail?.activeSessions.length ?? 0) > 0 && (
                // ref .live-dot - 색만이 아니라 펄스 도트 + 텍스트를 함께 쓴다
                <span className="ml-1.5 inline-flex items-center gap-1.5 rounded-full bg-danger px-2.5 py-0.5 align-middle text-[.72rem] font-black text-white">
                  <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white" />
                  수업 진행 중
                </span>
              )}
            </p>
          </div>
        </div>

        {/* 탭 — ref 는 모든 탭이 밑줄형이다 (.sm-tabs / .sm-dtabs). 트랙 위 pill 탭은 ref 에 없다 */}
        <div className="mb-5 flex items-stretch gap-3 border-b-2 border-track" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              data-active={tab === t.key}
              className="relative p-[16px_8px_14px] text-[1rem] font-black text-ink-mute transition-colors hover:text-ink-soft data-[active=true]:text-primary data-[active=true]:after:absolute data-[active=true]:after:inset-x-0 data-[active=true]:after:-bottom-0.5 data-[active=true]:after:h-[3px] data-[active=true]:after:rounded-full data-[active=true]:after:bg-primary"
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && <OverviewTab id={id} detail={detail} onChanged={loadDetail} />}
        {tab === 'understanding' && <ClassHeatmapCard classroomId={id} />}
        {/* 라이브 수업의 빠른 도구도 같은 카드를 쓴다 (components/.../MaterialsCard) */}
        {tab === 'materials' && <MaterialsCard id={id} />}
      </>
    </TeacherShell>
  )
}

/* ── 개요 ─────────────────────────────────────────────────── */
function OverviewTab({
  id,
  detail,
  onChanged,
}: {
  id: string
  detail: ClassroomDetail | null
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  /** 여기서 옆으로 새는 이동은 돌아올 길을 남긴다 (routes.ts 규칙 2) */
  const here = fromState(location)
  const canManage = detail?.myRole === 'OWNER' || detail?.myRole === 'MAINTAINER'

  // 학생 수는 누르면 학생 관리 화면으로 — 명단·진도를 다루는 곳이 거기 하나뿐이게 한다
  const stats: { label: string; value: number; icon: IconName; to?: string }[] = [
    {
      label: '학생 수',
      value: detail?.memberCounts.students ?? 0,
      icon: 'students',
      to: teacherRoutes.students(id),
    },
    { label: '선생님', value: detail?.memberCounts.teachers ?? 0, icon: 'friends' },
    // 학년별로 따로 열리므로 개수를 센다(V31) — 예전엔 학급당 하나라 0/1 이었다
    { label: '진행 중 수업', value: detail?.activeSessions.length ?? 0, icon: 'playTri' },
  ]


  return (
    <div className="flex flex-col gap-5">
      {/* ref .stat-grid / .stat-card — 아이콘 칩 → 라벨 → 값을 세로로 쌓는다 */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
        {stats.map((s) => {
          const body = (
            <>
              <span
                className="mb-1.5 grid h-[38px] w-[38px] place-items-center rounded-xl bg-sky text-primary"
                aria-hidden="true"
              >
                <Icon name={s.icon} className="h-[19px] w-[19px]" />
              </span>
              <span className="text-[.8rem] font-bold text-ink-soft">
                {s.label}
                {s.to && <span className="ml-1.5 text-primary">관리하기 →</span>}
              </span>
              <span className="text-[1.5rem] font-black">{s.value}</span>
            </>
          )
          const cls =
            'flex flex-col gap-1.5 rounded-card-md bg-card p-[18px_20px] text-left shadow-card'
          return s.to ? (
            <button
              key={s.label}
              type="button"
              onClick={() => navigate(s.to as string, here)}
              className={`${cls} transition-transform duration-200 ease-bounce hover:-translate-y-1 hover:shadow-card-lg`}
            >
              {body}
            </button>
          ) : (
            <div key={s.label} className={cls}>
              {body}
            </div>
          )
        })}
      </div>

      <InviteEntryCard id={id} />

      <SessionHistoryCard classroomId={id} />

      <MembersCard id={id} canManage={canManage} myRole={detail?.myRole} onChanged={onChanged} />

      {/* 학급 이름 바꾸기·삭제는 최상단 제목 옆으로 옮겼다 (ClassNameHeading) */}
    </div>
  )
}

/** 구성원(선생님·학생) 목록 — GET /classrooms/{id}/members (백엔드 106) */
function MembersCard({
  id,
  canManage,
  myRole,
  onChanged,
}: {
  id: string
  canManage: boolean
  /** 담당자 이양·학급 나가기는 내 역할에 따라 되고 안 되고가 갈린다 */
  myRole?: ClassroomRole
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [members, setMembers] = useState<ClassroomMember[]>([])
  const showToast = useToastStore((s) => s.show)
  const isOwner = myRole === 'OWNER'

  /**
   * 담당자 이양 — PATCH /classrooms/{id}/owner (백엔드 S15P11A407-137 §11.4).
   * **넘긴 나는 공동 관리자가 된다** (학급에서 빠지는 게 아니다). 되돌리려면 새 담당자가
   * 다시 넘겨줘야 하므로 문구에 그 사실을 적는다.
   */
  async function transferOwner(userId: number, name: string) {
    const ok = await confirmAction({
      title: `${name} 선생님에게 담당을 넘길까요?`,
      message:
        '이 학급의 담당 선생님이 바뀌고, 나는 공동 관리자가 돼요.\n되돌리려면 그 선생님이 다시 넘겨줘야 해요.',
      confirmLabel: '담당 넘기기',
      danger: true,
    })
    if (!ok) return
    try {
      await classroomApi.transferOwner(id, userId)
      load()
      onChanged()
      showToast(`${name} 선생님이 담당이 됐어요`)
    } catch (err) {
      showToast(apiErrorMessage(err, '담당을 넘기지 못했어요.'))
    }
  }

  /**
   * 학급 나가기 — DELETE /classrooms/{id}/members/me (백엔드 S15P11A407-137 §11.4).
   * **담당(OWNER)은 이양 후에만** 나갈 수 있다 — 주인 없는 학급이 생기지 않게 서버가 막는다.
   * 그래서 담당인 동안에는 버튼 대신 안내를 보여준다(눌러도 안 되는 버튼을 두지 않는다).
   */
  async function leave() {
    const ok = await confirmAction({
      title: '이 학급에서 나갈까요?',
      message: '더 이상 이 학급을 관리할 수 없어요.\n다시 들어오려면 초대를 받아야 해요.',
      confirmLabel: '학급 나가기',
      danger: true,
    })
    if (!ok) return
    try {
      await classroomApi.leaveClassroom(id)
      showToast('학급에서 나왔어요')
      navigate(teacherRoutes.home, { replace: true })
    } catch (err) {
      showToast(apiErrorMessage(err, '학급에서 나가지 못했어요.'))
    }
  }

  const load = useCallback(
    () =>
      void classroomApi
        .listMembers(id)
        .then(setMembers)
        .catch(() => setMembers([])),
    [id],
  )
  useEffect(load, [load])

  // role 은 멤버십 역할(OWNER/MAINTAINER/STUDENT)이다 — 학생은 '학생·초대' 탭에서 다룬다
  const teachers = members.filter((m) => m.role !== 'STUDENT')

  return (
    <div className={cardCls}>
      <h2 className={sectionTitle}>
        <Icon name="friends" className={titleIcon} />
        선생님 ({teachers.length})
      </h2>
      <ul className="mt-4 flex flex-col gap-2">
        {teachers.length === 0 && (
          <li className="text-[.9rem] font-medium text-ink-mute">아직 함께하는 선생님이 없어요.</li>
        )}
        {/* ref .teacher-row — gap 14px · avatar-lg 44px/1rem · t-name .95rem/900 */}
        {teachers.map((m) => (
          <li key={m.userId} className="flex items-center gap-3.5 rounded-2xl bg-canvas px-4 py-3">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-sky text-[1rem] font-black text-primary">
              {m.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[.95rem] font-black">{m.name}</span>
            {/* ref .role-badge — .72rem/900 · padding 5px 12px */}
            <span
              data-owner={m.role === 'OWNER'}
              className="flex-none whitespace-nowrap rounded-full p-[5px_12px] text-[.72rem] font-black data-[owner=false]:bg-sky data-[owner=false]:text-primary data-[owner=true]:bg-primary data-[owner=true]:text-white"
            >
              {m.role === 'OWNER' ? '담당' : '공동'}
            </span>
            {/* 담당 넘기기는 **담당인 내가** 공동 관리자에게만 할 수 있다 */}
            {isOwner && m.role === 'MAINTAINER' && (
              <button
                type="button"
                onClick={() => void transferOwner(m.userId, m.name)}
                className="min-h-9 flex-none rounded-full px-3 py-1.5 text-[.82rem] font-bold text-primary hover:bg-sky"
              >
                담당 넘기기
              </button>
            )}
            {/* OWNER 는 서버가 제외를 거부한다 — 누를 수 없게 하는 편이 정직하다 */}
            {canManage && m.role !== 'OWNER' && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirmAction({
                    title: `${m.name} 선생님의 공동 관리자 권한을 해제할까요?`,
                    message:
                      '이 학급을 더 이상 함께 관리할 수 없게 돼요.\n다시 초대할 수는 있어요.',
                    confirmLabel: '권한 해제',
                    danger: true,
                  })
                  if (!ok) return
                  void classroomApi
                    .removeMember(id, m.userId)
                    .then(() => {
                      load()
                      onChanged()
                      showToast(`${m.name} 선생님의 권한을 해제했어요`)
                    })
                    .catch(() => showToast('해제하지 못했어요. 잠시 후 다시 시도해 주세요.'))
                }}
                className="min-h-9 flex-none rounded-full px-3 py-1.5 text-[.82rem] font-bold text-danger hover:bg-danger-soft"
              >
                해제
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t-2 border-track pt-3.5">
        {isOwner ? (
          <p className="text-[.82rem] font-bold text-ink-mute">
            담당 선생님은 학급을 나갈 수 없어요.
            <br />
            먼저 다른 선생님에게 담당을 넘겨주세요.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => void leave()}
            className="min-h-9 rounded-full px-3 py-1.5 text-[.82rem] font-bold text-danger hover:bg-danger-soft"
          >
            이 학급에서 나가기
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * 학급 이름 — PATCH /classrooms/{id} (백엔드 111). 서버는 name 만 반영한다.
 * 삭제(DELETE /classrooms/{id}, soft delete, OWNER 전용)도 여기 같이 둔다.
 *
 * 예전엔 개요 탭 **맨 아래** "학급 설정" 카드에 있었다. 바꿀 대상(제목)과 바꾸는 곳이
 * 화면 양 끝으로 떨어져 있어, 이름을 고치려면 스크롤을 끝까지 내려야 했다.
 * 지금은 제목 옆 연필을 눌러 **그 자리에서** 고친다 (DESIGN_GUIDELINES 10장 — 2번 이내 클릭).
 */
function ClassNameHeading({
  id,
  name,
  canManage,
  canDelete,
  onChanged,
}: {
  id: string
  name: string
  canManage: boolean
  canDelete: boolean
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const showToast = useToastStore((s) => s.show)

  // 상세를 다시 읽어오면 입력값도 맞춰준다 (다른 곳에서 이름이 바뀐 경우)
  useEffect(() => setValue(name), [name])

  const trimmed = value.trim()
  const dirty = trimmed !== name && trimmed.length > 0

  async function save() {
    // 안 고치고 저장을 누르면 서버를 부르지 않고 그냥 닫는다
    if (!dirty) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await classroomApi.updateClassroom(id, { name: trimmed })
      onChanged()
      setEditing(false)
      showToast('학급 이름을 바꿨어요')
    } catch {
      // 실패하면 입력창을 열어 둔다 — 방금 쓴 이름을 다시 치게 하지 않는다
      showToast('이름을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setValue(name)
    setEditing(false)
  }

  /**
   * 학급 삭제 — 내 학급 화면(TeacherHomePage.tryDelete)과 **같은 문구·같은 뒤처리**를 쓴다.
   * 학생 계정은 사라지지 않는다(학급만 soft delete). 지운 뒤에는 이 화면이 가리킬 학급이
   * 없으므로 내 학급으로 돌아가고, 뒤로가기로 죽은 화면에 다시 오지 않게 replace 한다.
   */
  async function remove() {
    const ok = await confirmAction({
      title: `'${name}' 학급을 삭제할까요?`,
      message: '학생 계정과 지난 기록은 그대로 남아요.\n다시 되돌릴 수는 없어요.',
      confirmLabel: '학급 삭제',
      danger: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      await useClassroomsStore.getState().remove(id)
    } catch (err) {
      // 이미 지워진 학급이면 여기 남아 있을 이유가 없다 — 목록으로 돌려보낸다
      if (errorSlug(err) === 'classroom-not-found') {
        showToast('이미 삭제된 학급이에요')
        navigate(teacherRoutes.home, { replace: true })
        return
      }
      showToast(apiErrorMessage(err, '학급을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.'))
      setDeleting(false)
      return
    }
    /*
      삭제(204)는 됐는데 목록에 그대로 남는 백엔드 이슈가 있다 (TeacherHomePage 주석 참고 —
      soft delete 가 to-one 조인에 안 먹는 경우). 조용히 넘기지 않고 사실대로 알린다.
    */
    await useClassroomsStore.getState().load()
    const stillThere = useClassroomsStore.getState().classrooms.some((c) => c.id === id)
    showToast(
      stillThere
        ? '서버에서 삭제됐지만 목록에 남아 있어요. 백엔드 확인이 필요해요.'
        : '학급을 삭제했어요',
    )
    navigate(teacherRoutes.home, { replace: true })
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        <h1 className="truncate text-[1.5rem] font-black tracking-[-.3px]">
          {name || '학급 관리'}
        </h1>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setValue(name)
              setEditing(true)
            }}
            aria-label="학급 이름 바꾸기"
            title="학급 이름 바꾸기"
            className="grid h-10 w-10 flex-none place-items-center rounded-full text-ink-mute transition-colors hover:bg-sky hover:text-primary"
          >
            <Icon name="edit" className="h-5 w-5" />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={deleting}
            aria-label="학급 삭제하기"
            title="학급 삭제하기"
            className="grid h-10 w-10 flex-none place-items-center rounded-full text-ink-mute transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
          >
            <Icon name="trash" className="h-5 w-5" />
          </button>
        )}
      </div>
    )
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && cancel()}
        maxLength={50}
        aria-label="학급 이름"
        className="min-w-[180px] flex-1 p-[8px_14px] text-[1.25rem] font-black focus:bg-white"
      />
      <Button type="submit" size="sm" className="flex-none" disabled={saving}>
        {saving ? '저장 중…' : '저장'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="flex-none"
        disabled={saving}
        onClick={cancel}
      >
        취소
      </Button>
    </form>
  )
}

/* ── 초대/발급 진입 카드 (개요·학생 탭 공용) ─────────────────
   실제 목록·발급 UI 는 모달이 맡는다 (ref 의 inviteModal / inviteStudentModal). */
function InviteEntryCard({ id }: { id: string }) {
  const openModal = useOpenModal()
  return (
    <div className={cardCls}>
      <h2 className={sectionTitle}>
        <Icon name="mail" className={titleIcon} />
        사람 초대하기
      </h2>
      
      <div className="mt-3 flex flex-wrap gap-2.5">
        <Button
          variant="soft"
          onClick={() => openModal({ type: 'inviteTeacher', classroomId: id })}
        >
          초대 링크 만들기
        </Button>
        <Button onClick={() => openModal({ type: 'inviteStudent', classroomId: id })}>
          학생 계정 발급
        </Button>
      </div>
    </div>
  )
}
