import { api } from './client'
import { fileApi } from './fileApi'

/** POST /api/tts 응답 — 파일 도메인과 같은 shape (fileId + 다운로드 경로) */
export interface TtsResult {
  fileId: string
  /** "/api/files/{id}/content" — 그대로 `<audio src>` 에 넣으면 401 이다 (fileApi 주석 참고) */
  url: string
}

/** 백엔드 `TtsController.TtsRequest` 의 @Size(max = 1000) */
export const TTS_MAX_CHARS = 1000

/**
 * 텍스트 -> 음성 (온디맨드) — POST /api/tts.
 *
 * 과제 초안에는 오디오 필드가 **없다**. 백엔드 조립기가 넣지 않는 온디맨드 모델이라,
 * 읽을 문장은 프론트가 정해서 이 API 로 그때그때 만든다
 * (받아쓰기면 정답 문장 `answerText`, 그 외에는 발문 `prompt`).
 */
export const ttsApi = {
  async synthesize(text: string, voice?: string): Promise<TtsResult> {
    const { data } = await api.post<TtsResult>('/tts', { text: text.slice(0, TTS_MAX_CHARS), voice })
    return data
  },

  /**
   * 재생용 objectURL 까지 한 번에.
   * **호출부가 `URL.revokeObjectURL` 로 해제할 책임을 진다.**
   */
  async speak(text: string, voice?: string): Promise<string> {
    const { fileId } = await ttsApi.synthesize(text, voice)
    return fileApi.getObjectUrl(fileId)
  },
}
