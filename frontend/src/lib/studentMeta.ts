/**
 * 학생 표시용 보조 정보 — **서버가 준 값에 화면용 껍데기만 붙인다.**
 *
 * 예전에는 이 파일이 `userId+name` 해시로 진도율·출석·과목별 점수·주간 추이·제출 이력·
 * AI 코멘트를 **만들어 냈다.** 시안을 채우려던 임시 코드였는데 그대로 남아, 선생님이 학생
 * 상세 화면에서 **난수를 보고 판단**하고 있었다(CLAUDE.md 0장 규칙 2 위반).
 *
 * 지금은 그런 파생값이 없다. 학생의 실제 학습 데이터는 서버에서 온다:
 *  - 개인 리포트: `reportApi.getReport` (개념별 정답률·강점·약점·LLM 코멘트)
 *  - 학급 히트맵: `analyticsApi.getClassHeatmap` (학생 × 개념 매트릭스)
 *  - 과제별 제출: `analyticsApi.getAssignmentSubmissions`
 *
 * 여기 남은 것은 **아바타 그림 고르기**와 **학년 → 모둠 탭 키** 뿐이다. 둘 다 표시용이라
 * 해시로 정해도 사용자를 오해시키지 않는다(그림이 학생마다 고정되기만 하면 된다).
 */
import type { StudentAccount } from '@/types/teacher'

/** 목록·상세 아바타로 쓰는 캐릭터 (ref SM_CHARS) */
export const SM_CHARS = [
  '/assets/ch1.webp',
  '/assets/ch1-1.webp',
  '/assets/ch1-2.webp',
  '/assets/ch1-3.webp',
  '/assets/ch2.webp',
  '/assets/image%2020.webp',
] as const

/** 아바타 배경색 6가지 — 캐릭터 index 와 짝을 이룬다 (ref .sm-avatar.c0~c5) */
export const SM_AVATAR_BG = ['#F6FAEE', '#F3F1FC', '#FDF3E7', '#EBF3FD', '#FDEEF3', '#FDF8E3'] as const

export interface StudentWithMeta extends StudentAccount {
  /** `3학년` — 복식학급의 학년 모둠 탭 키 */
  team: string
  /** 아바타 그림 index — 학생마다 늘 같은 그림이 나오게 이름으로 정한다 */
  charIdx: number
}

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 이해도 단계 — **서버의 강점/약점 기준과 같은 경계를 쓴다.**
 * 0~59 낮음(빨강) · 60~79 보통(노랑) · 80~100 높음(초록)
 *
 * 예전엔 71/31 이라는 프론트 고유 경계였다. 그런데 같은 화면(DetailPanes)이 서버가 준
 * `strengths`(80% 이상) / `weaknesses`(60% 미만)를 "잘하는 개념 / 챙겨줄 개념"으로 함께
 * 보여준다 — 경계가 어긋나면 **막대는 초록인데 '챙겨줄 개념'에 들어가 있는** 모순이 생긴다
 * (예: 75점은 옛 기준으로 'high'(초록)지만 서버 기준으로는 강점이 아니다).
 */
export function levelOf(score: number): 'high' | 'mid' | 'low' {
  return score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low'
}

const LEVEL_FILL = {
  // level-high 는 --success / --success-deep 을 섞은 밝은 초록 (index.css @theme)
  high: 'bg-level-high',
  mid: 'bg-task',
  low: 'bg-danger',
} as const

/** 진도/이해도 막대의 채움 색 — 단계에 따라 초록·노랑·빨강 */
export function levelFill(score: number): string {
  return LEVEL_FILL[levelOf(score)]
}

/** 서버 계정 정보에 화면용 껍데기(아바타·모둠 키)만 붙인다 */
export function deriveStudent(acc: StudentAccount): StudentWithMeta {
  return {
    ...acc,
    team: `${acc.grade}학년`,
    charIdx: hash(acc.name) % SM_CHARS.length,
  }
}
