/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** REST API 베이스 (예: /api, vite 프록시로 백엔드 전달) */
  readonly VITE_API_BASE_URL: string
  /** STOMP `/ws` 소켓 URL 오버라이드 (미지정 시 location 기반 자동 유도) */
  readonly VITE_WS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
