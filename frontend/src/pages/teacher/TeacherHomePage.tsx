import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/common/Icon'
import { TeacherShell } from '@/components/classroom/teacher/TeacherShell'
import { ClassProgressCard } from '@/components/classroom/teacher/ClassProgressCard'
import { LockedClassCard } from '@/components/classroom/teacher/LockedClassCard'
import { ClassCreateModal } from '@/components/classroom/teacher/ClassCreateModal'
import { DashSection } from '@/components/classroom/teacher/DashSection'
import { useClassroomTileMeta } from '@/hooks/useClassroomTileMeta'
import { useClassroomsStore } from '@/stores/useClassroomsStore'
import { useToastStore } from '@/stores/useToastStore'
import { confirmAction } from '@/stores/useConfirmStore'
import { useOpenModal } from '@/stores/useModalStore'
import { fromState, teacherRoutes } from '@/lib/routes'
import { apiErrorMessage, errorSlug } from '@/lib/apiError'
import { useTeacherPresence } from '@/hooks/useTeacherPresence'

/**
 * 선생님 홈 — 레퍼런스 teacher.html "내 학급" 뷰 이관.
 * 상단바 + 사이드바 + "진행 중인 학급"(OPEN) / "닫혀있는 학급"(CLOSED) 카드.
 *
 * 화면 문구는 전부 **학급**이다. 예전엔 "진행 중인 수업 / 수업 생성" 이라고 적었는데, 이
 * 카드 하나가 가리키는 것은 `Classroom`(학급)이고 그 안에서 여는 실시간 세션이 '수업'이다 —
 * 같은 말이 두 층을 가리켜, 카드를 지우는 것이 학급을 지우는 것인지 오늘 수업을 닫는 것인지
 * 읽히지 않았다.
 * 진행중/닫힘은 서버 필드가 없는 표시 상태라 로컬 메타에 저장된다.
 */
export function TeacherHomePage() {
  // 이 화면에 있는 동안에도 학생 질문을 받는다 (백엔드는 STOMP 접속을 온라인으로 본다)
  useTeacherPresence()
  const navigate = useNavigate()
  const location = useLocation()
  /*
    카드에서 학급 관리로 들어가는 길은 **이 화면에서 이어지는 흐름**이라 출발지를 남긴다.
    안 남기면 학급 관리의 fallback(담당 학급 선택)이 걸려, 내 학급에서 눌렀는데 뒤로가기가
    한 단계를 건너뛴 학급 선택 화면으로 간다 (routes.ts 규칙 2).
  */
  const here = fromState(location)
  const { classrooms, load, create, remove, setStatus } = useClassroomsStore()
  const showToast = useToastStore((s) => s.show)
  const openModal = useOpenModal()
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const open = useMemo(() => classrooms.filter((c) => c.status !== 'CLOSED'), [classrooms])
  const closed = useMemo(() => classrooms.filter((c) => c.status === 'CLOSED'), [classrooms])

  // 카드의 "학생 N명 · 과제 진행률" — 목록 API 에 없어 학급별로 따로 채운다
  const meta = useClassroomTileMeta(classrooms)

  // 닫힌 학급 열기 → 학급 화면으로 (실제 수업 세션 시작은 그 안 학년 선택에서)
  async function startClosed(id: string) {
    await setStatus(id, 'OPEN')
    navigate(teacherRoutes.classDetail(id))
  }

  /**
   * 학급 삭제 — `DELETE /classrooms/{id}` (soft delete, OWNER 전용).
   *
   * 학생 계정은 **사라지지 않는다** (학급만 soft delete 되고 계정·학습이력은 보존).
   * 예전 확인 문구가 "학생 계정도 함께 사라져요" 라고 겁을 줘서 문구를 사실에 맞게 고쳤다.
   * 실패 시 raw axios 메시지 대신 서버 problem-details 를 사람 말로 바꿔 보여준다.
   */
  async function tryDelete(id: string, name: string) {
    const ok = await confirmAction({
      title: `'${name}' 학급을 삭제할까요?`,
      message: '학생 계정과 지난 기록은 그대로 남아요.\n다시 되돌릴 수는 없어요.',
      confirmLabel: '학급 삭제',
      danger: true,
    })
    if (!ok) return
    try {
      await remove(id)
    } catch (err) {
      // 이미 지워진 학급이면 목록에서 빠지는 게 맞다 — 서버와 다시 맞춘다
      if (errorSlug(err) === 'classroom-not-found') {
        await load()
        showToast('이미 삭제된 학급이에요')
        return
      }
      showToast(apiErrorMessage(err, '학급을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.'))
      await load() // 낙관적으로 지워졌을 수 있으니 서버 상태로 되돌린다
      return
    }

    /**
     * 삭제는 성공(204)했지만 목록에 그대로 남아 있는지 확인한다.
     *
     * 서버는 soft delete 인데(`deleted_at` 마킹) 목록 쿼리가
     * `select cm from ClassroomMember cm join fetch cm.classroom` 이라, Classroom 의
     * `@SQLRestriction("deleted_at is null")` 이 **to-one 조인에는 적용되지 않을 수 있다.**
     * 그러면 새로고침 때 지운 학급이 되살아난다 — "삭제가 안 된다"로 보이는 그 증상.
     *
     * 프론트에서 고칠 수 있는 문제가 아니라서, 조용히 감추는 대신 사실을 알린다.
     */
    await load()
    const stillThere = useClassroomsStore.getState().classrooms.some((c) => c.id === id)
    showToast(
      stillThere
        ? '서버에서 삭제됐지만 목록에 남아 있어요. 백엔드 확인이 필요해요.'
        : '학급을 삭제했어요',
    )
  }

  return (
    <TeacherShell active="home" topBar>
      {/* 헤더(셸이 얹는다) + 히어로 + 패널 셋이 이어 붙어 한 덩어리로 읽힌다 */}
      <>
        {/*
          히어로 — class_bg(학교·언덕·구름 위 마스코트). ref `.pk-hero.pk-hero-class`.

          **네 모서리 다 각지게 두고 테두리는 좌·우만 그린다** — 위 둥근 모서리와 위 테두리는
          헤더(.topbar) 몫이고, 아래는 패널이 맡아 셋이 이어진 한 덩어리로 읽힌다.
          여기에 `rounded-t` 를 주면 헤더 바로 아래에서 모서리가 한 번 더 깎여 흰 헤더와
          배너 사이에 턱이 생기고, 좌·우 테두리를 빼면 덩어리 가운데에서 윤곽선이 끊긴다.
          여백을 주면 덩어리가 갈라져 보이니 margin 도 두지 않는다.

          높이 330px 은 ref `.pk-hero` 값이다 (학급 선택 화면의 히어로와 같은 값이라
          두 화면을 오갈 때 배너 높이가 흔들리지 않는다).
          배경은 아래쪽 68px 을 잘라 낸다(ref `--hero-push:68px`) — 더 내리면 지평선이
          밀려 학교가 허공에 뜬다.
        */}
        <div className="relative min-h-[330px] overflow-hidden border-x-[1.5px] border-frame bg-[#A9DCF5] bg-[url('/assets/class_bg.webp')] bg-cover bg-[position:center_bottom_-68px] bg-no-repeat max-[900px]:min-h-[210px] max-[900px]:bg-[position:right_bottom]">
          {/* 왼쪽 스크림 — 부제 끝이 학교 왼쪽 변에 닿아서 옅게만 덮는다 */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,rgba(255,255,255,.62)_0%,rgba(255,255,255,.34)_20%,rgba(255,255,255,0)_40%)]"
          />
          <div className="relative z-[1] p-[66px_46px_32px_60px] max-[900px]:p-[30px_26px]">
            <h1 className="text-[2.9rem] font-black leading-[1.15] tracking-[-1.2px] max-[900px]:text-[2.1rem]">
              내 학급
            </h1>
            <p className="mt-3.5 text-[1.05rem] font-bold leading-[1.65] text-ink-soft">
              담당하고 있는 학급이에요
              <br />
              학급을 열고 학생들을 만나보세요!
            </p>
          </div>
        </div>

        {/*
            학급 패널 — 진행 중/닫혀있는 학급을 **한 패널 안에** 담고 얇은 구분선으로만 나눈다.
            섹션마다 배너나 테두리를 두면 화면이 여러 덩어리로 갈려 보인다 (ref .pk-panel/.pk-sec).

            테두리는 좌·우·아래만 그린다 — 헤더가 위·좌·우, 히어로가 좌·우를 맡아 셋이 이어진
            한 줄이 된다. `overflow-hidden` 은 아래 패딩(22px)이 모서리 반지름(34px)보다 작아서
            맨 아래 줄 카드의 각진 모서리가 둥근 경계 밖으로 삐져나오는 걸 잘라 낸다.
          */}
        <div className="overflow-hidden rounded-b-page border-x-[1.5px] border-b-[1.5px] border-frame bg-card p-[26px_28px_22px] shadow-card [&>section+section]:mt-7 [&>section+section]:border-t-[1.5px] [&>section+section]:border-track [&>section+section]:pt-[26px] max-[640px]:p-[20px_16px_18px]">
          <DashSection
            title="진행 중인 학급"
            subtitle={open.length > 0 ? `학급 ${open.length}개` : '학급을 만들면 여기에 모여요'}
            action={
              /*
                두 버튼은 ref `.section-create-btn` 의 치수를 그대로 나눠 쓴다
                (12px 22px · .95rem · 800 · 알약 · 아이콘 18px). 색만 갈라 둔다 —
                파랑은 **내 학급을 새로 만드는** 주 동작, 하늘색은 **남의 학급에 합류하는**
                보조 동작이다. 둘 다 파랑이면 어느 쪽이 기본인지 안 읽힌다.
              */
              <div className="flex flex-none flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => openModal({ type: 'joinClass' })}
                  className="inline-flex items-center gap-2 rounded-full bg-sky p-[12px_22px] text-[.95rem] font-extrabold text-primary transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:bg-sky-deep"
                >
                  <Icon name="mail" className="h-[18px] w-[18px]" />
                  학급 참여
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-primary p-[12px_22px] text-[.95rem] font-extrabold text-white transition-transform duration-200 ease-bounce hover:-translate-y-0.5 hover:bg-primary-hover"
                >
                  <Icon name="plus" className="h-[18px] w-[18px]" />
                  학급 생성
                </button>
              </div>
            }
          >
            {/*
                고정 3열 — ref .class-grid.progress-grid/.locked-grid 는 기본 auto-fill 을 덮어쓴다.
                auto-fill 로 두면 넓은 화면에서 4열로 갈라져 카드 비율이 ref 와 달라진다.
                좁은 폭은 ref 의 카드 그리드 브레이크포인트(1120 -> 2열, 760 -> 1열)를 따른다.
              */}
            <div className="grid grid-cols-3 gap-[26px] max-[1120px]:grid-cols-2 max-[760px]:grid-cols-1">
              {open.length === 0 && (
                <div className="col-span-full grid min-h-[222px] place-items-center rounded-card border-[1.5px] border-dashed border-track bg-[#FAFAFB] text-center text-[1.05rem] font-bold text-ink-mute">
                  아직 진행 중인 학급이 없어요
                </div>
              )}
              {open.map((c) => (
                <ClassProgressCard
                  key={c.id}
                  classroom={c}
                  studentCount={meta[c.id]?.students}
                  progress={meta[c.id]?.progress}
                  onEnter={() => navigate(teacherRoutes.classDetail(c.id))}
                  onManage={() => navigate(teacherRoutes.classManage(c.id), here)}
                  onClose={() => void setStatus(c.id, 'CLOSED')}
                  onDelete={() => void tryDelete(c.id, c.name)}
                />
              ))}
            </div>
          </DashSection>

          <DashSection
            title="닫혀있는 학급"
            /* 비어 있을 때는 개수 줄을 아예 두지 않는다 — 바로 아래 빈 자리 안내가 같은 말을 한다 */
            subtitle={closed.length > 0 ? `학급 ${closed.length}개` : undefined}
          >
            <div className="grid grid-cols-3 gap-[26px] max-[1120px]:grid-cols-2 max-[760px]:grid-cols-1">
              {closed.length === 0 && (
                <div className="col-span-full grid min-h-[222px] place-items-center rounded-card border-[1.5px] border-dashed border-track bg-[#FAFAFB] text-center text-[1.05rem] font-bold text-ink-mute">
                  닫혀있는 학급이 없어요
                </div>
              )}
              {closed.map((c) => (
                <LockedClassCard
                  key={c.id}
                  classroom={c}
                  studentCount={meta[c.id]?.students}
                  progress={meta[c.id]?.progress}
                  onStart={() => void startClosed(c.id)}
                  onDelete={() => void tryDelete(c.id, c.name)}
                />
              ))}
            </div>
          </DashSection>
        </div>

        <ClassCreateModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreate={async (input) => {
            await create(input)
          }}
        />
      </>
    </TeacherShell>
  )
}
