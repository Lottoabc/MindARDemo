/**
 * config.js — 全局配置
 * ============================================================================
 * 通过 Vite 环境变量管理不同环境下的后端地址：
 *
 *   开发环境 (npm run dev):
 *     VITE_API_BASE = ''（空字符串，Vite proxy 自动转发到 localhost:3000）
 *
 *   生产环境 (GitHub Pages):
 *     VITE_API_BASE = 'https://your-backend.onrender.com'（远程后端地址）
 *
 * 使用方式：
 *   import { API_BASE } from '../config.js'
 *   fetch(`${API_BASE}/api/targets/image`, { ... })
 */

/** 后端 API 基础地址（末尾不带斜杠） */
export const API_BASE = import.meta.env.VITE_API_BASE || ''

/** Socket.IO 服务端地址 */
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_BASE || ''

/** 是否为生产环境 */
export const isProduction = import.meta.env.PROD

/** 是否为开发环境 */
export const isDevelopment = import.meta.env.DEV

// 调试输出（仅在开发环境打印）
if (isDevelopment) {
  console.log('[Config] API_BASE:', API_BASE || '(使用 Vite Proxy → localhost:3000)')
  console.log('[Config] SOCKET_URL:', SOCKET_URL || '(使用 Vite Proxy → localhost:3000)')
}
