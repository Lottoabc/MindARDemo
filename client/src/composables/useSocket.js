/**
 * useSocket.js — Socket.IO 客户端单例封装
 * ============================================================================
 * 负责：
 *   1. 创建与管理唯一的 Socket.IO 连接
 *   2. 提供响应式的连接状态 (connected ref)
 *   3. 确保整个应用只有一个 socket 实例（单例模式）
 *
 * 使用方式：
 *   import { useSocket } from '../composables/useSocket.js'
 *   const { socket, connected } = useSocket()
 *
 * 【注意】生产环境部署到 HTTPS 时，这里自动适配 wss:// 协议。
 */

import { ref, shallowRef } from 'vue'
import { io } from 'socket.io-client'
import { SOCKET_URL } from '../config.js'

// ---------------------------------------------------------------------------
// 单例状态（模块级别的闭包变量，整个应用共享）
// ---------------------------------------------------------------------------
let socketInstance = null      // Socket.IO 实例
const connected = ref(false)   // 响应式连接状态
const connectionError = ref(null) // 连接错误信息

/**
 * 获取或创建 Socket.IO 单例连接
 * @returns {{ socket, connected, connectionError }}
 */
export function useSocket() {
  // 如果已有连接（包括正在连接的），直接返回
  if (socketInstance) {
    return { socket: socketInstance, connected, connectionError }
  }

  // -----------------------------------------------------------------------
  // 确定 WebSocket 连接地址
  // 开发环境：SOCKET_URL 为空 → 同源连接（Vite proxy 转发到 localhost:3000）
  // 生产环境：SOCKET_URL 为远程后端地址（如 https://xxx.onrender.com）
  // -----------------------------------------------------------------------
  const socketUrl = SOCKET_URL || window.location.origin

  // 创建 Socket.IO 连接
  socketInstance = io(socketUrl, {
    // 自动选择 transport：先尝试 WebSocket，失败则降级到 HTTP 长轮询
    transports: ['websocket', 'polling'],

    // 自动重连配置（适用于移动端网络切换、WiFi 断开等场景）
    reconnection: true,
    reconnectionAttempts: Infinity,   // 无限重试
    reconnectionDelay: 1000,          // 初始重连延迟 1 秒
    reconnectionDelayMax: 5000,       // 最大重连延迟 5 秒
    timeout: 20000,                   // 连接超时 20 秒
  })

  // -----------------------------------------------------------------------
  // 连接事件监听
  // -----------------------------------------------------------------------

  socketInstance.on('connect', () => {
    console.log('[Socket] 已连接到服务器:', socketInstance.id)
    connected.value = true
    connectionError.value = null
  })

  socketInstance.on('disconnect', (reason) => {
    console.log('[Socket] 连接断开:', reason)
    connected.value = false

    // 如果是服务端主动断开，给出提示
    if (reason === 'io server disconnect') {
      connectionError.value = '服务端断开了连接，尝试重新连接...'
      // 服务端断开后需要手动重连
      socketInstance.connect()
    }
  })

  socketInstance.on('connect_error', (error) => {
    console.error('[Socket] 连接错误:', error.message)
    connected.value = false
    connectionError.value = `连接失败: ${error.message}`
  })

  socketInstance.on('reconnect', (attemptNumber) => {
    console.log(`[Socket] 第 ${attemptNumber} 次重连成功`)
    connected.value = true
    connectionError.value = null
  })

  socketInstance.on('reconnect_attempt', (attemptNumber) => {
    console.log(`[Socket] 第 ${attemptNumber} 次重连尝试...`)
  })

  socketInstance.on('reconnect_error', (error) => {
    console.error('[Socket] 重连失败:', error.message)
    connectionError.value = `重连失败: ${error.message}`
  })

  // 服务端发来的错误事件
  socketInstance.on('error', ({ message }) => {
    console.warn('[Socket] 服务端错误:', message)
    // 这里不设置 connectionError 因为这是业务错误，不是连接错误
  })

  return { socket: socketInstance, connected, connectionError }
}

/**
 * 手动断开连接（应用退出或主动离开时调用）
 */
export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect()
    socketInstance = null
    connected.value = false
    connectionError.value = null
  }
}
