import { api } from './client'

/**
 * 업로드/생성된 파일 바이트 받기 — GET /api/files/{fileId}/content.
 *
 * ⚠ **Authorization 헤더가 필수**라서 `<audio src="/api/files/...">` 처럼 직접 연결하면 401 이다.
 * 브라우저는 미디어 태그 요청에 우리 JWT 를 붙여주지 않는다. 그래서 axios 로 받아
 * `URL.createObjectURL` 로 바꿔 붙인다.
 *
 * 서버 응답의 `url`("/api/files/{id}/content")은 이미 `/api` 를 포함하는데 axios baseURL 도
 * `/api` 라서 그대로 쓰면 `/api/api/...` 가 된다 — 그래서 여기서는 **fileId 로만** 조립한다.
 */
export const fileApi = {
  /** 파일 바이트 (인증 헤더 포함) */
  async getContent(fileId: string): Promise<Blob> {
    const { data } = await api.get<Blob>(`/files/${fileId}/content`, { responseType: 'blob' })
    return data
  },

  /**
   * 바로 재생/표시할 수 있는 objectURL.
   * **호출부가 다 쓴 뒤 `URL.revokeObjectURL` 로 반드시 해제해야 한다** (안 하면 탭이 살아 있는 동안 누수).
   */
  async getObjectUrl(fileId: string): Promise<string> {
    return URL.createObjectURL(await fileApi.getContent(fileId))
  },
}
