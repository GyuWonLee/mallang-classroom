import { api } from './client'
import type { Subject } from '@/types/assignment'
import {
  MATERIAL_ACCEPT,
  MATERIAL_MAX_BYTES,
  isMaterialSettled,
  type MaterialDetail,
  type MaterialSummary,
  type MaterialUploadResult,
} from '@/types/material'

/** 업로드 전 클라이언트 검증 — 서버 왕복 없이 바로 안내한다 */
export function validateMaterialFile(file: File): string | null {
  if (file.type !== MATERIAL_ACCEPT) return 'PDF 파일만 올릴 수 있어요. 한글 파일은 "PDF로 내보내기" 후 올려주세요.'
  if (file.size > MATERIAL_MAX_BYTES) return '파일이 너무 커요. 20MB 이하로 올려주세요.'
  return null
}

/**
 * 학습자료 API — api-spec.md 6.5장 (백엔드 119 구현 완료).
 *
 * 업로드는 202 로 즉시 돌아오고 추출은 백그라운드다. 그래서 `pollUntilSettled` 로
 * PROCESSING 이 끝날 때까지 폴링한 뒤 미리보기를 보여주고, 선생님이 confirm 해야 READY 가 된다.
 */
export const materialApi = {
  /** PDF 업로드 (multipart, PDF만 20MB) — POST /api/classrooms/{id}/materials → 202 */
  async upload(
    classroomId: string,
    file: File,
    /** 학년·과목은 선택이다 — 비우면 공용 자료가 되어 어느 학년·과목에서도 고를 수 있다 */
    tag?: { grade?: number | null; subject?: Subject | null },
  ): Promise<MaterialUploadResult> {
    const form = new FormData()
    form.append('file', file)
    /* 안 고른 값은 아예 싣지 않는다 — 빈 문자열을 보내면 서버가 파싱하려다 400 이 난다 */
    if (tag?.grade != null) form.append('grade', String(tag.grade))
    if (tag?.subject) form.append('subject', tag.subject)
    const { data } = await api.post<MaterialUploadResult>(`/classrooms/${classroomId}/materials`, form)
    return data
  },

  /** 자료 목록 — GET /api/classrooms/{id}/materials */
  async list(classroomId: string): Promise<MaterialSummary[]> {
    const { data } = await api.get<MaterialSummary[]>(`/classrooms/${classroomId}/materials`)
    return data
  },

  /** 상태 + 추출 텍스트 미리보기 (폴링용) — GET /api/materials/{id} */
  async get(materialId: number): Promise<MaterialDetail> {
    const { data } = await api.get<MaterialDetail>(`/materials/${materialId}`)
    return data
  },

  /** 미리보기 확인 → READY — POST /api/materials/{id}/confirm (PREVIEW 아니면 409) */
  async confirm(materialId: number): Promise<MaterialDetail> {
    const { data } = await api.post<MaterialDetail>(`/materials/${materialId}/confirm`)
    return data
  },

  /** 자료 삭제 (soft delete) — DELETE /api/materials/{id} */
  async remove(materialId: number): Promise<void> {
    await api.delete(`/materials/${materialId}`)
  },

  /**
   * PROCESSING 이 끝날 때까지 폴링한다. 추출은 텍스트 레이어면 즉시, 스캔본이면 LLM 을 태워
   * 수십 초가 걸릴 수 있어 기본 상한을 넉넉히 잡는다.
   */
  async pollUntilSettled(
    materialId: number,
    { intervalMs = 1500, timeoutMs = 90_000 }: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<MaterialDetail> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const detail = await materialApi.get(materialId)
      if (isMaterialSettled(detail.status)) return detail
      if (Date.now() >= deadline) {
        throw new Error('자료를 읽는 데 시간이 너무 오래 걸려요. 잠시 후 목록에서 다시 확인해 주세요.')
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  },
}
