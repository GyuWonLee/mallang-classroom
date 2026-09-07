import { create } from 'zustand'
import type { StudentAccount } from '@/types/teacher'
import type { Assignment } from '@/types/assignment'
import type { ProblemStat } from '@/services/api/analyticsApi'

/**
 * 열 수 있는 모달의 전체 목록 = 이 유니온 하나.
 *
 * 각 모달이 필요로 하는 값을 타입에 같이 적어두면, 열 때 빠뜨리면 컴파일이 깨진다.
 * (페이지마다 `const [showX, setShowX] = useState(false)` 를 늘어놓지 않기 위한 계약)
 */
export type ModalRequest =
  | { type: 'inviteTeacher'; classroomId: string }
  | { type: 'inviteStudent'; classroomId: string }
  // 학생의 학습 현황은 학생 관리 화면의 오른쪽 상세 패널이 맡는다 — 모달은 계정 작업만
  | { type: 'studentPassword'; student: StudentAccount }
  | { type: 'assignmentWizard'; classroomId: string }
  /*
    수업 중 '학습자료 · 과제' 작업판. 예전에는 오른쪽 패널의 아래 줄을 통째로 갈아 끼웠는데,
    그러면 학생 얼굴이 사라지고 되돌아오는 길이 '학생 관리로' 버튼 하나뿐이었다.
    모달이면 무대·학생은 그대로 있고, 닫으면 원래 자리로 정확히 돌아온다.
  */
  | { type: 'liveWorkspace'; classroomId: string }
  // 초대 코드로 남의 학급에 합류 — 학급이 정해지기 **전**이라 classroomId 가 없다
  | { type: 'joinClass' }
  | { type: 'assignmentDetail'; assignment: Assignment }
  /*
    문항 하나만 크게 — 문항 분석 탭의 '다시 짚어줄 문항' 카드를 누르면 열린다.
    본문은 목록 응답에 없어서(AssignmentSummary 에 content 가 없다) 여는 쪽이 전체 과제를
    받아 넘긴다. `no` 는 처음 열 문항이고, 창 안에서 이전·다음으로 옮겨 다닌다 —
    그래서 집계도 문항 하나가 아니라 **전부**(`stats`) 넘긴다.
  */
  | { type: 'problemDetail'; assignment: Assignment; no: number; stats?: ProblemStat[] }
  // 학급 선택은 모달이 아니라 화면이다 — ref viewPickClass (teacherRoutes.pickClass)
  // 문의하기(help)는 없앴다 — ref 가 사이드바 버튼과 모달을 함께 지웠다
  // 비밀번호 변경은 학생·선생님 공용이라 common 에 둔다 (POST /auth/password)
  | { type: 'changePassword' }
  // 학생이 자기 답안을 되돌아보는 화면 (GET /assignments/{id}/submissions/me)
  | { type: 'myAnswers'; assignmentId: number; title: string }
  /*
    말랑이 대화에서 살펴볼 신호가 잡힌 것들 (선생님 전용). 명단의 "살펴보기 N" 배지에서 연다.
    이름을 함께 받는 이유: 대화 목록만 띄우면 누구 이야기인지 창 안에서 알 수 없다.
  */
  | { type: 'tutorFlags'; classroomId: string; studentId: number; studentName: string }

interface ModalState {
  /**
   * 스택인 이유: 모달 위에 모달이 열린다 (학생 명단 -> 학생 상세, 학급 선택 -> 과제 마법사).
   * 뒤로 닫으면 이전 모달이 그대로 살아 있어야 맥락을 잃지 않는다.
   */
  stack: ModalRequest[]
  open: (request: ModalRequest) => void
  /** 맨 위 모달만 닫는다 */
  close: () => void
  closeAll: () => void
}

export const useModalStore = create<ModalState>((set) => ({
  stack: [],
  open: (request) => set((s) => ({ stack: [...s.stack, request] })),
  close: () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  closeAll: () => set({ stack: [] }),
}))

/** 컴포넌트에서 쓰기 편한 열기 함수 (셀렉터 한 줄) */
export function useOpenModal() {
  return useModalStore((s) => s.open)
}
