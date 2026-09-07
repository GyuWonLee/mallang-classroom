import type { Transition, Variants } from 'framer-motion'

/**
 * 중앙화된 Framer Motion 프리셋.
 * 컴포넌트는 여기 정의된 variants/transition만 참조해 일관된 모션을 사용한다.
 * (CSS 키프레임은 pulse/wiggle/floaty 등 단순 루프 전용, 진입/이탈 전환은 여기서)
 */

/** 통통 튀는 공용 스프링 — 이 파일의 프리셋들이 공유한다 (밖에서 직접 쓰지 않는다) */
const bounce: Transition = { type: 'spring', stiffness: 500, damping: 28, mass: 0.8 }

/** 아래에서 위로 페이드 인 (뷰/패널 진입) */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: bounce },
  exit: { opacity: 0, y: 12, transition: { duration: 0.15 } },
}

/** 모달 배경(딤) */
export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
}

/** 모달 카드 (등장 시 살짝 회전하며 팝) */
export const modalCard: Variants = {
  hidden: { opacity: 0, scale: 0.4, rotate: -6 },
  visible: { opacity: 1, scale: 1, rotate: 0, transition: bounce },
  exit: { opacity: 0, scale: 0.85, transition: { duration: 0.15 } },
}
