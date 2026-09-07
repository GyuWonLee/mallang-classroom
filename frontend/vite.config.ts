import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    /**
     * 라이브러리를 앱 코드에서 떼어낸다.
     *
     * 이유는 **캐시**다. 한 덩어리로 두면 화면 코드를 한 줄만 고쳐도 해시가 바뀌어 사용자가
     * React 까지 다시 받는다. 수업 중에 배포가 나가는 프로젝트라 이 차이가 크다.
     *
     * 셋으로만 나눈다 — 더 잘게 쪼개면 요청 수만 늘고 이득이 없다.
     * LiveKit(가장 큰 덩어리)은 여기 없다: 교실에 들어갈 때만 동적 import 되므로
     * 이미 별도 청크(`ClassroomSignaling`)이고, 첫 화면에서는 아예 받지 않는다.
     */
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'react-vendor'
          }
          if (/[\\/]node_modules[\\/](@tanstack|axios)[\\/]/.test(id)) return 'data-vendor'
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) {
            return 'motion-vendor'
          }
        },
      },
    },
  },
  server: {
    // 5173 이 이미 쓰이는 환경(ref 목업 서버를 같이 띄워 둘 때)에서도 그대로 뜨게, 넘겨준 포트를 따른다
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:8080', changeOrigin: true },
      '/ws':  { target: process.env.WS_PROXY_TARGET || 'ws://localhost:8080', ws: true, changeOrigin: true },
    },
  }
})
