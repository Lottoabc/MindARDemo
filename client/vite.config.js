import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import mkcert from 'vite-plugin-mkcert'

/**
 * Vite 配置文件
 * ============================================================================
 *
 * 【开发环境】(npm run dev)
 *   - host: 0.0.0.0 让同网段手机可访问
 *   - HTTPS 自动证书（vite-plugin-mkcert），手机可调摄像头
 *   - proxy 将 /api、/uploads、/socket.io 转发到 localhost:3000
 *
 * 【生产环境】(npm run build → GitHub Pages)
 *   - base 设为仓库名（GitHub Pages 部署在 /<repo>/ 子路径下）
 *   - 环境变量加载自 .env.production（VITE_API_BASE = 远程后端 URL）
 */
export default defineConfig({
  plugins: [
    vue(),
    mkcert(),
  ],

  // -----------------------------------------------------------------------
  // GitHub Pages 部署路径
  // -----------------------------------------------------------------------
  base: '/MindARDemo/',

  // -----------------------------------------------------------------------
  // 开发服务器配置
  // -----------------------------------------------------------------------
  server: {
    host: '0.0.0.0',   // 允许局域网设备访问（手机测试必需）
    port: 5173,
    https: true,        // 启用 HTTPS（vite-plugin-mkcert 自动签发证书）
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,        // WebSocket 代理
      },
    },
  },
})
