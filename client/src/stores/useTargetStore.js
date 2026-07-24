/**
 * useTargetStore.js — AR 追踪目标注册表
 * ============================================================================
 * 管理所有已编译的参照物信息，包括：
 *   - 目标图片数据（用于合并重编译）
 *   - .mind Blob URL（当前生效的合并编译产物）
 *   - 每个目标关联的 emoji
 *
 * 是热交换流程的单一数据源。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useTargetStore = defineStore('targets', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** 所有已注册的目标图片 { index, imageElement, dataUrl } */
  const targets = ref([])

  /** 当前生效的合并 .mind Blob URL（A-Frame scene 正在使用的） */
  const activeMindUrl = ref(null)

  /** 当前活跃的 mindar-image-target anchor DOM 引用列表（用于投影） */
  const anchorElements = ref([])

  /** 每个 targetIndex 关联的 emoji */
  const targetEmojis = ref({})

  /** 编译是否正在进行中 */
  const isCompiling = ref(false)

  /** 编译进度 0~1 */
  const compileProgress = ref(0)

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  const targetCount = computed(() => targets.value.length)

  /** 所有图片元素（用于合并编译） */
  const allImageElements = computed(() =>
    targets.value.map(t => t.imageElement)
  )

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * 注册一个新目标（拍照后调用）
   * @param {number} index - 分配的目标索引
   * @param {HTMLImageElement} imageElement - 图片
   * @param {string} dataUrl - base64 缩略图（用于持久化）
   * @param {string} emoji - 关联 emoji，默认 📌
   */
  function addTarget(index, imageElement, dataUrl, emoji = '📌') {
    targets.value.push({ index, imageElement, dataUrl })
    targetEmojis.value[index] = emoji
  }

  /**
   * 设置当前活跃的 .mind URL
   */
  function setActiveMindUrl(url) {
    // 释放旧的 Blob URL（避免内存泄漏）
    if (activeMindUrl.value && activeMindUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(activeMindUrl.value)
    }
    activeMindUrl.value = url
  }

  /**
   * 更新目标 emoji
   */
  function setTargetEmoji(index, emoji) {
    targetEmojis.value[index] = emoji
  }

  /**
   * 注册 anchor 元素引用（创建新 anchor 后调用）
   */
  function registerAnchor(index, el) {
    anchorElements.value[index] = el
  }

  /**
   * 重置所有状态（离开 AR 场景时调用）
   */
  function reset() {
    if (activeMindUrl.value && activeMindUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(activeMindUrl.value)
    }
    targets.value = []
    activeMindUrl.value = null
    anchorElements.value = []
    targetEmojis.value = {}
    isCompiling.value = false
    compileProgress.value = 0
  }

  return {
    // state
    targets,
    activeMindUrl,
    anchorElements,
    targetEmojis,
    isCompiling,
    compileProgress,
    // getters
    targetCount,
    allImageElements,
    // actions
    addTarget,
    setActiveMindUrl,
    setTargetEmoji,
    registerAnchor,
    reset,
  }
})
