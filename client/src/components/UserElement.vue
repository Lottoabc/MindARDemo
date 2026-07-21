<!--
  UserElement.vue — 单个协同 UI 元素
  ============================================================================
  根据 ownership 分为两种模式：

  【自己的元素（isOwn = true）】
    - 可点击进入编辑模式
    - 可长按拖拽移动位置
    - 显示彩色边框标识所有权
    - pointer-events: auto

  【他人的元素（isOwn = false）】
    - 只读展示
    - 点击弹出 Toast 提示归属
    - pointer-events: auto（仅在元素区域响应，触发 Toast）
    - 显示用户昵称和颜色标识

  元素类型支持：
    - text: 文字留言（带背景卡片）
    - emoji: 大号 emoji 展示
-->
<template>
  <div
    class="user-element"
    :class="{
      'is-own': isOwn,
      'is-other': !isOwn,
      'is-editing': isEditing,
      'is-dragging': isDragging,
    }"
    :style="elementStyle"
    @pointerdown="onPointerDown"
    @click.stop="onClick"
  >
    <!-- 他人的元素：显示用户标识头 -->
    <div v-if="!isOwn" class="element-owner">
      <span
        class="owner-dot"
        :style="{ backgroundColor: element.userColor }"
      ></span>
      <span class="owner-name">{{ element.userName }}</span>
    </div>

    <!--
      元素内容区
      自己的元素在编辑模式下 contenteditable
    -->
    <div
      v-if="element.type === 'text'"
      class="element-content"
      :class="{ 'allow-select': isEditing }"
      :contenteditable="isEditing"
      :style="contentStyle"
      @blur="onBlur"
      @input="onInput"
      ref="contentRef"
    >
      {{ element.content }}
    </div>

    <div
      v-else-if="element.type === 'emoji'"
      class="element-content element-emoji"
    >
      {{ element.content }}
    </div>

    <!-- 自己的元素在编辑状态下显示删除按钮 -->
    <button
      v-if="isOwn && isEditing"
      class="element-delete-btn"
      @click.stop="$emit('delete', element.id)"
    >
      ✕
    </button>
  </div>
</template>

<script setup>
/**
 * UserElement 负责：
 *   1. 根据类型渲染元素内容（text / emoji）
 *   2. 处理点击（区分自己/他人）
 *   3. 处理长按拖拽（仅自己的元素）
 *   4. 内容编辑（contenteditable 方案）
 */
import { ref, computed } from 'vue'

// ---------------------------------------------------------------------------
// Props & Emits
// ---------------------------------------------------------------------------

const props = defineProps({
  /** 协作元素数据 */
  element: { type: Object, required: true },
  /** 是否属于当前用户 */
  isOwn: { type: Boolean, default: false },
  /** 是否处于编辑模式 */
  isEditing: { type: Boolean, default: false },
})

const emit = defineEmits([
  'edit',    // 请求进入编辑模式
  'delete',  // 删除元素
  'update',  // 更新元素（内容、位置）
  'toast',   // 显示 Toast
])

// ---------------------------------------------------------------------------
// 本地引用
// ---------------------------------------------------------------------------

const contentRef = ref(null)

// ---------------------------------------------------------------------------
// 元素样式（位置、颜色等）
// ---------------------------------------------------------------------------

const elementStyle = computed(() => {
  const el = props.element
  return {
    left: `${el.position.x}%`,
    top: `${el.position.y}%`,
    '--user-color': el.userColor,
  }
})

const contentStyle = computed(() => {
  const el = props.element
  return {
    color: el.style?.color || '#ffffff',
    fontSize: `${el.style?.fontSize || 16}px`,
    backgroundColor: el.style?.backgroundColor || 'rgba(0, 0, 0, 0.5)',
  }
})

// ---------------------------------------------------------------------------
// 交互：点击
// ---------------------------------------------------------------------------

function onClick(event) {
  if (props.isOwn && !props.isEditing) {
    // 点击自己的元素 → 进入编辑模式
    emit('edit', props.element.id)
  } else if (!props.isOwn) {
    // 点击他人的元素 → Toast 提示
    emit('toast', `这是 ${props.element.userName} 的留言`)
  }
}

// ---------------------------------------------------------------------------
// 交互：长按拖拽（自己的元素专属）
// ---------------------------------------------------------------------------

const isDragging = ref(false)
let dragStartTime = 0
let dragStartPos = { x: 0, y: 0 }
let elementStartPos = { x: 0, y: 0 }
const LONG_PRESS_DURATION = 500 // 长按阈值 500ms
let longPressTimer = null
let hasMoved = false

function onPointerDown(event) {
  if (!props.isOwn) return

  dragStartTime = Date.now()
  dragStartPos = { x: event.clientX, y: event.clientY }
  elementStartPos = { ...props.element.position }
  hasMoved = false

  // 长按检测：500ms 后启用拖拽
  longPressTimer = setTimeout(() => {
    isDragging.value = true
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
  }, LONG_PRESS_DURATION)

  // 如果快速松开（短按），取消长按定时器
  document.addEventListener('pointerup', onEarlyUp)
}

function onEarlyUp() {
  clearTimeout(longPressTimer)
  document.removeEventListener('pointerup', onEarlyUp)
}

function onPointerMove(event) {
  if (!isDragging.value) return

  hasMoved = true
  const dx = event.clientX - dragStartPos.x
  const dy = event.clientY - dragStartPos.y

  // 将像素位移转换为视口百分比
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const newX = elementStartPos.x + (dx / viewportW) * 100
  const newY = elementStartPos.y + (dy / viewportH) * 100

  // 限制在视口范围内（保留 5% 边距）
  const clampedX = Math.max(5, Math.min(95, newX))
  const clampedY = Math.max(5, Math.min(95, newY))

  // 本地更新位置（不通过 socket，只有松手时才发送）
  props.element.position.x = clampedX
  props.element.position.y = clampedY
}

function onPointerUp() {
  clearTimeout(longPressTimer)
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerUp)
  document.removeEventListener('pointerup', onEarlyUp)

  if (isDragging.value && hasMoved) {
    // 发送最终位置到服务端
    emit('update', props.element.id, {
      position: { x: props.element.position.x, y: props.element.position.y },
    })
  }

  isDragging.value = false
}

// ---------------------------------------------------------------------------
// 内容编辑（contenteditable）
// ---------------------------------------------------------------------------

function onInput(event) {
  // 实时更新本地内容（不通过 socket）
  const text = event.target.innerText || event.target.textContent
  props.element.content = text
}

function onBlur(event) {
  // 失焦时发送最终内容到服务端
  const text = event.target.innerText || event.target.textContent || ''
  if (text !== props.element.content) {
    emit('update', props.element.id, { content: text })
  }
}
</script>

<style scoped>
/* =========================================================================
   UserElement 样式
   ========================================================================= */

.user-element {
  position: absolute;
  /* 以中心点为锚点，方便拖拽计算 */
  transform: translate(-50%, -50%);
  max-width: 80vw;
  pointer-events: auto; /* 覆盖父级 overlay 的 pointer-events: none */
  transition: box-shadow 0.2s ease, transform 0.1s ease;
  cursor: default;
  z-index: 1;
}

/* ---- 自己的元素 ---- */
.is-own {
  cursor: pointer;
}

.is-own .element-content {
  border: 2px solid var(--user-color, #6366f1);
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.3);
}

/* 编辑状态：高亮边框 */
.is-own.is-editing .element-content {
  border-color: #fff;
  box-shadow: 0 0 20px rgba(255, 255, 255, 0.4);
}

/* 拖拽中：放大 + 更深阴影 */
.is-dragging {
  z-index: 100;
}

.is-dragging .element-content {
  transform: scale(1.08);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
}

/* ---- 他人的元素 ---- */
.is-other .element-content {
  border: 2px solid rgba(255, 255, 255, 0.15);
  opacity: 0.85;
}

/* ---- 元素内容 ---- */
.element-content {
  display: inline-block;
  padding: 10px 16px;
  border-radius: var(--radius-md);
  font-size: var(--font-base);
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  word-break: break-word;
  white-space: pre-wrap;
  max-width: 70vw;
  min-width: 44px;
  min-height: 44px;
  outline: none;
}

/* emoji 类型：更大字号 */
.element-emoji {
  font-size: clamp(32px, 10vw, 64px) !important;
  padding: 8px;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: none !important;
}

/* ---- 用户标识头（他人元素显示） ---- */
.element-owner {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  padding-left: 4px;
}

.owner-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.owner-name {
  font-size: 10px;
  color: var(--text-muted);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

/* ---- 删除按钮 ---- */
.element-delete-btn {
  position: absolute;
  top: -10px;
  right: -10px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #fff;
  background: var(--color-danger);
  color: #fff;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.element-delete-btn:active {
  transform: scale(0.9);
}
</style>
