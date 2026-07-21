import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * Vite 配置文件
 * ============================================================================
 *
 * 【开发环境】(npm run dev)
 *   - host: 0.0.0.0 让同网段手机可访问
 *   - proxy 将 /api、/uploads、/socket.io 转发到 localhost:3000
 *   - 环境变量加载自 .env.development（VITE_API_BASE = ''，使用代理）
 *
 * 【生产环境】(npm run build → GitHub Pages)
 *   - base 设为仓库名（GitHub Pages 部署在 /<repo>/ 子路径下）
 *   - 环境变量加载自 .env.production（VITE_API_BASE = 远程后端 URL）
 *   - 构建产物在 dist/ 目录
 */
export default defineConfig({
  plugins: [vue()],

  // -----------------------------------------------------------------------
  // GitHub Pages 部署路径
  // 【重要】如果你的仓库名不是 "mydemo"，请修改以下 base 为你的仓库名。
  // 例如仓库名为 "webar-demo"，则 base: '/webar-demo/'
  // -----------------------------------------------------------------------
  base: '/MindARDemo/',

  // -----------------------------------------------------------------------
  // 开发服务器配置
  // -----------------------------------------------------------------------
  server: {
    host: '0.0.0.0',   // 允许局域网设备访问（手机测试必需）
    port: 5173,
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
