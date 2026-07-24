/**
 * useMessageStore.js — 留言数据持久化存储
 * ============================================================================
 * 每个 targetIndex 维护独立的留言列表。
 * 数据通过 LocalStorage 持久化，刷新/重连不丢失。
 *
 * 数据结构：
 *   messages[targetIndex] = [
 *     { id: string, content: string, userName: string, userColor: string, createdAt: number }
 *   ]
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'webar-target-messages'

// ---------------------------------------------------------------------------
// 从 LocalStorage 恢复
// ---------------------------------------------------------------------------
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export const useMessageStore = defineStore('messages', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** { [targetIndex]: Message[] } */
  const messages = ref(loadFromStorage())

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * 添加留言
   */
  function addMessage(targetIndex, msg) {
    if (!messages.value[targetIndex]) {
      messages.value[targetIndex] = []
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    messages.value[targetIndex].push({
      id,
      content: msg.content,
      userName: msg.userName || '匿名',
      userColor: msg.userColor || '#6366f1',
      createdAt: Date.now(),
    })
    persist()
    return id
  }

  /**
   * 删除留言
   */
  function removeMessage(targetIndex, msgId) {
    if (!messages.value[targetIndex]) return
    messages.value[targetIndex] = messages.value[targetIndex].filter(
      m => m.id !== msgId
    )
    persist()
  }

  /**
   * 获取指定目标的留言列表
   */
  function getMessages(targetIndex) {
    return messages.value[targetIndex] || []
  }

  /**
   * 获取指定目标的留言数量
   */
  function getMessageCount(targetIndex) {
    return (messages.value[targetIndex] || []).length
  }

  /**
   * 清空指定目标的留言
   */
  function clearMessages(targetIndex) {
    delete messages.value[targetIndex]
    persist()
  }

  // ---------------------------------------------------------------------------
  // 内部：持久化到 LocalStorage
  // ---------------------------------------------------------------------------
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.value))
    } catch (e) {
      console.warn('[MessageStore] 持久化失败:', e.message)
    }
  }

  return {
    messages,
    addMessage,
    removeMessage,
    getMessages,
    getMessageCount,
    clearMessages,
  }
})
