import type { Subject } from '@/types/assignment'

/**
 * 학습자료 도메인 타입 — 백엔드 `material/dto/MaterialDtos.java` 실계약 기준 (2026-07-28).
 *
 * 업로드(PDF, 20MB) → 비동기 추출 → 미리보기 확인(confirm) → READY 의 4단계.
 *
 * ⚠ 현재 백엔드는 **업로드한 자료를 AI 과제 생성에 쓸 수 없다.**
 * `assignment/material/MaterialSource.java` 가 `builtin-korean-g1`~`g6` 만 해석하고
 * 그 외 id 는 409 material-not-ready 로 거절한다 ("업로드 PDF 파이프라인은 후속 브랜치").
 * 그래서 여기 materialId 는 number, 생성 요청의 materialIds 는 string[] 으로 타입이 갈린다.
 */

/** 추출 상태 머신: PROCESSING -> PREVIEW -> READY / FAILED */
export type MaterialStatus = 'PROCESSING' | 'PREVIEW' | 'READY' | 'FAILED'

/** 어느 단계로 추출했는지 — PREVIEW 화면에서 품질 판단 근거로 보여준다 */
export type ExtractionSource = 'TEXT_LAYER' | 'LLM'

/** POST /classrooms/{id}/materials -> 202 */
export interface MaterialUploadResult {
  materialId: number
  status: MaterialStatus
}

/** GET /classrooms/{id}/materials */
export interface MaterialSummary {
  materialId: number
  title: string
  status: MaterialStatus
  extractionSource: ExtractionSource | null
  failureReason: string | null
  /**
   * 원본 PDF 의 파일 id — `GET /files/{fileId}/content` 로 받아 화면에 그대로 띄운다.
   *
   * 확인 화면이 추출 텍스트만 보여 주던 때는 선생님이 "이게 내가 올린 그 자료가 맞나"를
   * 판단할 근거가 약했다. 올린 것은 PDF 인데 화면에는 뜯어낸 글자만 있었다.
   */
  fileId: string | null
  /**
   * 몇 학년 자료인가 — **null 이면 공용**이다(어느 학년에서도 고를 수 있다).
   *
   * 과제 만들기에서 목록을 좁히는 근거다. 없던 때는 학년을 골라도 학급의 자료가 전부 떠서,
   * 비슷한 이름들 사이에서 무엇으로 문제를 만드는지 선생님이 일일이 기억해야 했다.
   * V33 이전에 올라간 자료는 값이 없어 공용으로 남는다 — 목록에서 사라지는 편이 더 나쁘다.
   */
  grade: number | null
  /** 어느 과목인가 — null 이면 공용. 학년과 같은 규칙이다 */
  subject: Subject | null
  createdAt: string
}

/** GET /materials/{id} — 업로드 후 폴링 대상 */
export interface MaterialDetail extends MaterialSummary {
  /** 추출 텍스트 미리보기 */
  preview: string
  extractedLength: number
}

/** 업로드 제한 (백엔드 FilePurpose.LEARNING_MATERIAL) */
export const MATERIAL_MAX_BYTES = 20 * 1024 * 1024
export const MATERIAL_ACCEPT = 'application/pdf'

/** 추출이 끝나 폴링을 멈춰도 되는 상태인지 */
export function isMaterialSettled(status: MaterialStatus): boolean {
  return status !== 'PROCESSING'
}
