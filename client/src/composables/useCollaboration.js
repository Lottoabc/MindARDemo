/**
 * useCollaboration.js — 多人协同状态管理
 * ============================================================================
 * 职责：
 *   1. 管理当前房间的所有协作元素 (elements) 和在线用户 (users)
 *   2. 提供元素的 CRUD 操作（自动同步到服务端）
 *   3. 管理本地用户的身份信息和编辑状态
 *   4. 注册/注销 Socket.IO 事件监听器
 *
 * 核心设计原则：
 *   - 服务端权威：所有变更通过服务端广播后更新客户端状态
 *   - userId 持久化：存储在 localStorage，页面刷新后可恢复身份
 *   - 只允许编辑自己的元素（服务端二次校验）
 *
 * 使用方式：
 *   import { useCollaboration } from '../composables/useCollaboration.js'
 *   const { elements, users, localUser, joinRoom, addElement, ... } = useCollaboration()
 */

import { ref, reactive, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { useSocket } from './useSocket.js'

// ---------------------------------------------------------------------------
// 用户预设颜色池（用于随机分配标识色，方便区分不同用户）
// ---------------------------------------------------------------------------
const USER_COLORS = [
  '#6366f1', // 靛蓝
  '#ef4444', // 红色
  '#22c55e', // 绿色
  '#f59e0b', // 琥珀
  '#ec4899', // 粉色
  '#06b6d4', // 青色
  '#8b5cf6', // 紫色
  '#f97316', // 橙色
]

// ---------------------------------------------------------------------------
// 全局响应式状态（模块级单例，多个组件共享）
// ---------------------------------------------------------------------------

/** 当前房间内的所有协作元素 */
const elements = ref([])

/** 当前房间内的所有在线用户 */
const users = ref([])

/** 当前本地用户的信息（昵称、颜色、ID） */
const localUser = reactive({
  id: '',        // 持久化 userId（来自 localStorage）
  name: '',      // 用户昵称
  color: '',     // 用户标识色
})

/** 当前正在编辑的元素 ID（null 表示没有编辑中的元素） */
const editingElementId = ref(null)

/** 用于生成用户昵称的形容词和名词池 */
const ADJECTIVES = ['快乐的', '好奇的', '活力的', '安静的', '探索的', '自由的', '勇敢的', '温柔的']
const NOUNS = ['旅行者', '观察者', '冒险家', '设计师', '梦想家', '创造者', '发现者', '探险家']

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 获取或创建持久化用户 ID
 * 优先从 localStorage 读取，不存在则生成新的并存储
 *
 * 【为什么需要持久化？】
 * 如果用户刷新页面，socket.id 会变化。使用 localStorage 存储的 userId
 * 可以让用户在重连后恢复对自己之前创建的元素的所有权。
 */
function getOrCreateUserId() {
  const STORAGE_KEY = 'webar-user-id'
  let userId = localStorage.getItem(STORAGE_KEY)
  if (!userId) {
    userId = uuidv4()
    localStorage.setItem(STORAGE_KEY, userId)
  }
  return userId
}

/**
 * 获取或创建用户昵称和颜色
 */
function getOrCreateUserInfo() {
  const STORAGE_NAME = 'webar-user-name'
  const STORAGE_COLOR = 'webar-user-color'

  let name = localStorage.getItem(STORAGE_NAME)
  let color = localStorage.getItem(STORAGE_COLOR)

  if (!name) {
    // 随机生成一个有趣的中文昵称
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
    name = `${adj}${noun}`
    localStorage.setItem(STORAGE_NAME, name)
  }

  if (!color) {
    // 随机分配标识色
    color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
    localStorage.setItem(STORAGE_COLOR, color)
  }

  return { name, color }
}

// ---------------------------------------------------------------------------
// 导出的 Composable
// ---------------------------------------------------------------------------

export function useCollaboration() {
  const { socket, connected } = useSocket()

  // 初始化本地用户信息（幂等操作）
  if (!localUser.id) {
    localUser.id = getOrCreateUserId()
    const info = getOrCreateUserInfo()
    localUser.name = info.name
    localUser.color = info.color
  }

  // -----------------------------------------------------------------------
  // 房间操作
  // -----------------------------------------------------------------------

  /**
   * 加入协同房间
   * @param {string} roomId - 房间 ID（即 targetId）
   */
  function joinRoom(roomId) {
    if (!connected.value) {
      console.warn('[协同] Socket 未连接，无法加入房间')
      return
    }

    console.log(`[协同] 加入房间: ${roomId} (用户: ${localUser.name})`)

    socket.emit('join-room', {
      roomId,
      userInfo: {
        id: localUser.id,
        name: localUser.name,
        color: localUser.color,
      },
    })
  }

  /**
   * 离开协同房间
   */
  function leaveRoom() {
    if (!connected.value) return
    socket.emit('leave-room')
    // 清空本地状态
    elements.value = []
    users.value = []
  }

  // -----------------------------------------------------------------------
  // 元素 CRUD 操作
  // -----------------------------------------------------------------------

  /**
   * 添加一个新的协作元素
   * @param {'text' | 'emoji'} type - 元素类型
   * @param {string} content - 元素内容
   * @param {{ x: number, y: number }} position - 视口百分比位置
   * @returns {string} 新元素的 ID
   */
  function addElement(type, content, position = { x: 50, y: 50 }) {
    if (!connected.value) {
      console.warn('[协同] 未连接，无法添加元素')
      return null
    }

    const element = {
      id: uuidv4(),
      userId: localUser.id,
      userName: localUser.name,
      userColor: localUser.color,
      type,
      content,
      style: {
        color: '#ffffff',
        fontSize: type === 'emoji' ? 48 : 16,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      },
      position: { ...position },
    }

    console.log('[协同] 发送元素添加:', element.id)
    socket.emit('element-add', element)

    return element.id
  }

  /**
   * 更新元素（内容、位置或样式）
   * @param {string} id - 元素 ID
   * @param {object} updates - 要更新的字段（content, position, style）
   */
  function updateElement(id, updates) {
    // 本地校验：只能更新自己的元素
    const el = elements.value.find(e => e.id === id)
    if (!el || el.userId !== localUser.id) {
      console.warn('[协同] 无权更新此元素:', id)
      return
    }

    // 乐观更新：先应用到本地，再发送服务端
    // （服务端广播 element-updated 时排除发送者，所以必须本地先更新）
    Object.assign(el, updates)
    socket.emit('element-update', { id, updates })
  }

  /**
   * 删除元素
   * @param {string} id - 元素 ID
   */
  function deleteElement(id) {
    const el = elements.value.find(e => e.id === id)
    if (!el || el.userId !== localUser.id) {
      console.warn('[协同] 无权删除此元素:', id)
      return
    }

    socket.emit('element-delete', { id })

    // 如果正在编辑该元素，退出编辑模式
    if (editingElementId.value === id) {
      editingElementId.value = null
    }
  }

  // -----------------------------------------------------------------------
  // 工具方法
  // -----------------------------------------------------------------------

  /** 判断某个元素是否属于当前用户 */
  function isOwnElement(element) {
    return element.userId === localUser.id
  }

  /** 获取用户在线状态 */
  function isUserOnline(userId) {
    return users.value.some(u => u.id === userId && u.online)
  }

  /** 根据 userId 查找用户信息 */
  function getUserById(userId) {
    return users.value.find(u => u.id === userId) || null
  }

  // -----------------------------------------------------------------------
  // Socket 事件监听器注册
  // （在 ARView.vue 的 onMounted 中调用，onBeforeUnmount 中注销）
  // -----------------------------------------------------------------------

  function registerListeners() {
    if (!socket) return

    // --- 初始状态同步（服务端在 join-room 后发送的全量数据） ---
    socket.on('room-state', (state) => {
      console.log('[协同] 收到房间状态:', state)
      elements.value = state.elements || []
      users.value = state.users || []
    })

    // --- 元素变更事件 ---
    socket.on('element-added', (element) => {
      // 避免重复添加（服务端广播会发给发送者自己）
      const exists = elements.value.some(e => e.id === element.id)
      if (!exists) {
        elements.value.push(element)
      }
    })

    socket.on('element-updated', ({ id, updates }) => {
      const idx = elements.value.findIndex(e => e.id === id)
      if (idx !== -1) {
        // 使用 Object.assign 进行浅合并
        Object.assign(elements.value[idx], updates)
      }
    })

    socket.on('element-deleted', ({ id }) => {
      const idx = elements.value.findIndex(e => e.id === id)
      if (idx !== -1) {
        elements.value.splice(idx, 1)
      }
      // 如果删除的是正在编辑的元素，退出编辑模式
      if (editingElementId.value === id) {
        editingElementId.value = null
      }
    })

    // --- 用户变更事件 ---
    socket.on('user-joined', (user) => {
      const exists = users.value.some(u => u.id === user.id)
      if (!exists) {
        users.value.push(user)
      }
      console.log(`[协同] 用户加入: ${user.name}`)
    })

    socket.on('user-left', ({ userId }) => {
      users.value = users.value.filter(u => u.id !== userId)
      console.log(`[协同] 用户离开: ${userId}`)
    })

    console.log('[协同] 事件监听器已注册')
  }

  function unregisterListeners() {
    if (!socket) return

    socket.off('room-state')
    socket.off('element-added')
    socket.off('element-updated')
    socket.off('element-deleted')
    socket.off('user-joined')
    socket.off('user-left')

    console.log('[协同] 事件监听器已注销')
  }

  // -----------------------------------------------------------------------
  // 返回所有可用的状态与方法
  // -----------------------------------------------------------------------
  return {
    // 响应式状态
    elements,
    users,
    localUser,
    editingElementId,

    // 房间操作
    joinRoom,
    leaveRoom,

    // 元素操作
    addElement,
    updateElement,
    deleteElement,

    // 工具方法
    isOwnElement,
    isUserOnline,
    getUserById,

    // 生命周期
    registerListeners,
    unregisterListeners,
  }
}
