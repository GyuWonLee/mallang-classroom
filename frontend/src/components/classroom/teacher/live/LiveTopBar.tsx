import { Icon } from '@/components/common/Icon'
import { GRADE_PALETTE, gradePlantImage } from '@/lib/subject'

/**
 * 수업 화면 상단 바 — **여기가 어디인가**와 나가는 길만 갖는다.
 *
 * 한때 이 바를 지우고 무대 위 오버레이 칩으로 대신했다(무대 높이를 아끼려고). 다시 세운
 * 이유: 오버레이는 방송·판서 위에 겹쳐 글자가 배경에 따라 읽히거나 안 읽혔다.
 *
 * 여기 두지 않는 것 두 가지:
 *  - **학생·채팅 탭** — 오른쪽 패널 맨 위로 내려갔다. 바꾸는 대상 바로 위에 있어야
 *    스위치와 내용의 관계가 자리로 읽힌다.
 *  - **수업 종료·전체 화면** — 종료는 되돌릴 수 없어 컨트롤 바의 빨간 자리에,
 *    전체 화면은 커지는 대상 위(무대 안 우상단)에 둔다.
 */
export function LiveTopBar({
  grade,
  gradeLabel,
  topic,
  lessonTopic,
  onBack,
}: {
  /** 지금 들어와 있는 학년 — 색을 고르는 데 쓴다(학년 팔레트) */
  grade: number | null
  /** `6학년` — 학년을 모르면 '우리 반' 같은 대체 문구가 온다 */
  gradeLabel: string
  /** 학급 이름 */
  topic: string
  /**
   * 수업을 시작하며 적은 **오늘의 수업 주제**(없으면 null).
   *
   * 학급 이름 뒤에 붙는다 — `6학년 │ 3반 · 받아쓰기 연습`. 이름과 주제는 다른 층이라
   * 색·굵기를 다르게 둔다: 이름은 "어디"고 주제는 "무엇"이다.
   */
  lessonTopic?: string | null
  onBack: () => void
}) {
  /*
    학년 색은 **학급 화면의 학년 카드와 같은 팔레트**를 쓴다(`GRADE_PALETTE`). 6학년 카드가
    남색이면 그 학년 수업 화면의 칩도 남색이어야, 카드를 눌러 들어온 사람이 "같은 방에
    왔다"고 안다. 예전엔 회색 하나(`bg-canvas`)여서 어느 학년인지 색으로는 알 수 없었다.
  */
  const palette = grade !== null ? GRADE_PALETTE[grade] : undefined

  return (
    <header className="flex flex-none items-center justify-between gap-3 bg-card p-[10px_18px] shadow-[0_1px_0_rgba(0,0,0,.05)]">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex flex-none items-center gap-1.5 rounded-full border-[1.5px] border-track bg-card p-[9px_16px] text-[.9rem] font-extrabold text-ink transition-colors hover:bg-canvas"
        >
          <Icon name="back" className="h-[15px] w-[15px] flex-none" />
          돌아가기
        </button>

        {/*
          ── 학년 + 학급 이름을 **한 알약**으로 묶는다 ────────────────────
          예전엔 회색 칩 · 큰 제목 · 캐릭터 그림이 각자 떠 있어서, 셋이 한 가지를 가리키는데도
          흩어져 보였다("6학년"과 "3반"이 서로 다른 정보처럼 읽혔다). 학년 색 배경 하나로
          감싸면 **"6학년의 3반"** 이 한 덩어리가 되고, 바에서 눈이 갈 곳도 하나로 줄어든다.

          안쪽은 학년 색의 진한 값(`cta`)으로 학년을, 학급 이름은 잉크색으로 적어 층을 만든다 —
          같은 굵기·같은 색이면 묶어도 다시 평평해진다.
        */}
        <div
          style={
            palette
              ? { background: palette.bg, borderColor: palette.border }
              : { background: 'var(--color-canvas)', borderColor: 'var(--color-track)' }
          }
          className="flex min-w-0 items-center gap-2.5 rounded-full border-[1.5px] p-[6px_16px_6px_8px]"
        >
          {/* 학년 식물 그림 — 학급 화면 학년 카드와 같은 그림이라 눈에 익다 */}
          {grade !== null && (
            <img
              src={gradePlantImage(grade)}
              alt=""
              aria-hidden="true"
              decoding="async"
              className="h-8 w-8 flex-none object-contain"
            />
          )}
          <span
            style={palette ? { color: palette.cta } : undefined}
            className="flex-none text-[.9rem] font-black text-ink-soft"
          >
            {gradeLabel}
          </span>
          <span aria-hidden="true" className="h-3.5 w-px flex-none bg-black/15" />
          {/* 학급 이름 — 길면 자른다. 여기서 줄바꿈하면 바 높이가 들쭉날쭉해진다 */}
          <h1 className="min-w-0 truncate text-[1.05rem] font-black tracking-[-.3px]">{topic}</h1>
          {/*
            오늘의 수업 주제 — 적었을 때만 나온다. 이름보다 한 단계 옅게(font-bold · ink-soft)
            둔다: 알약 안에서 같은 무게로 두면 무엇이 학급이고 무엇이 오늘 내용인지 갈리지 않는다.
          */}
          {lessonTopic && (
            <>
              <span aria-hidden="true" className="flex-none text-[.9rem] font-black text-black/25">
                ·
              </span>
              <span className="min-w-0 truncate text-[.95rem] font-bold text-ink-soft">
                {lessonTopic}
              </span>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
