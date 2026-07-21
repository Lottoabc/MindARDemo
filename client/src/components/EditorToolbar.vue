<!--
  EditorToolbar.vue — 底部编辑工具栏
  ============================================================================
  始终固定在屏幕底部，提供以下功能：
    1. 添加文字留言按钮
    2. 添加 emoji 按钮
    3. 编辑中元素的操作：修改颜色、字号、删除

  移动端适配：
    - 固定在屏幕底部
    - 适配 iPhone X+ 安全区 (safe-area-inset-bottom)
    - 最小触摸目标 44x44px
    - 半透明毛玻璃背景
-->
<template>
  <div
    class="editor-toolbar"
    :class="{ 'toolbar-hidden': !visible }"
  >
    <div class="toolbar-inner">
      <!-- 模式 A：无编辑中元素 — 显示添加按钮 -->
      <template v-if="!editingElementId">
        <button
          class="tool-btn"
          @click="addTextElement"
          aria-label="添加文字"
        >
          <span class="tool-icon">💬</span>
          <span class="tool-label">添加文字</span>
        </button>

        <button
          class="tool-btn"
          @click="addEmojiElement"
          aria-label="添加表情"
        >
          <span class="tool-icon">😊</span>
          <span class="tool-label">添加表情</span>
        </button>
      </template>

      <!-- 模式 B：有编辑中元素 — 显示编辑工具 -->
      <template v-else>
        <!-- 颜色选择器 -->
        <div class="color-picker">
          <button
            v-for="c in presetColors"
            :key="c"
            class="color-swatch"
            :class="{ active: selectedColor === c }"
            :style="{ backgroundColor: c }"
            @click="changeColor(c)"
            aria-label="颜色"
          ></button>
        </div>

        <!-- 字号调节 -->
        <div class="font-size-controls">
          <button
            class="tool-btn size-btn"
            @click="changeFontSize(-2)"
            aria-label="缩小字号"
          >
            A<span class="size-arrow">-</span>
          </button>
          <button
            class="tool-btn size-btn"
            @click="changeFontSize(2)"
            aria-label="放大字号"
          >
            A<span class="size-arrow">+</span>
          </button>
        </div>

        <!-- 删除按钮 -->
        <button
          class="tool-btn danger"
          @click="deleteCurrentElement"
          aria-label="删除元素"
        >
          <span class="tool-icon">🗑️</span>
        </button>

        <!-- 完成编辑 -->
        <button
          class="tool-btn done"
          @click="finishEditing"
          aria-label="完成编辑"
        >
          <span class="tool-label">完成 ✓</span>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup>
/**
 * EditorToolbar 逻辑：
 *   1. 无编辑中元素时：提供添加文字/emoji 按钮
 *   2. 有编辑中元素时：提供颜色、字号、删除等编辑工具
 *   3. 通过 useCollaboration 创建和修改元素
 */
import { ref, computed } from 'vue'
import { useCollaboration } from '../composables/useCollaboration.js'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const props = defineProps({
  /** 是否可见（绑定 targetDetected） */
  visible: {
    type: Boolean,
    default: false,
  },
})

// ---------------------------------------------------------------------------
// 协同状态
// ---------------------------------------------------------------------------

const {
  elements,
  editingElementId,
  addElement,
  updateElement,
  deleteElement,
} = useCollaboration()

// ---------------------------------------------------------------------------
// 预设颜色
// ---------------------------------------------------------------------------

const presetColors = [
  '#ffffff', '#f87171', '#fb923c', '#fbbf24',
  '#a3e635', '#34d399', '#22d3ee', '#60a5fa',
  '#818cf8', '#c084fc', '#f472b6',
]

// ---------------------------------------------------------------------------
// 当前编辑元素的颜色（用于颜色选择器高亮）
// ---------------------------------------------------------------------------

const selectedColor = computed(() => {
  const el = elements.value.find(e => e.id === editingElementId.value)
  return el?.style?.color || '#ffffff'
})

// ---------------------------------------------------------------------------
// 方法：添加元素
// ---------------------------------------------------------------------------

/**
 * 添加文字留言
 * 在视口中央创建，内容为占位文字
 */
function addTextElement() {
  const id = addElement('text', '双击编辑文字', { x: 50, y: 45 })
  if (id) {
    editingElementId.value = id
  }
}

/**
 * 添加 emoji
 */
function addEmojiElement() {
  const id = addElement('emoji', '😊', { x: 50, y: 45 })
  if (id) {
    editingElementId.value = id
  }
}

// ---------------------------------------------------------------------------
// 方法：编辑工具
// ---------------------------------------------------------------------------

/** 修改编辑中元素的文字颜色 */
function changeColor(color) {
  if (!editingElementId.value) return
  updateElement(editingElementId.value, {
    style: {
      ...getCurrentStyle(),
      color,
    },
  })
}

/** 修改编辑中元素的字号 */
function changeFontSize(delta) {
  if (!editingElementId.value) return
  const currentStyle = getCurrentStyle()
  const newSize = Math.max(12, Math.min(72, (currentStyle.fontSize || 16) + delta))
  updateElement(editingElementId.value, {
    style: {
      ...currentStyle,
      fontSize: newSize,
    },
  })
}

/** 获取当前编辑元素的样式（用于合并更新） */
function getCurrentStyle() {
  const el = elements.value.find(e => e.id === editingElementId.value)
  return el?.style || { color: '#ffffff', fontSize: 16, backgroundColor: 'rgba(0,0,0,0.5)' }
}

/** 删除当前编辑中的元素 */
function deleteCurrentElement() {
  if (!editingElementId.value) return
  if (confirm('确定删除这个元素吗？')) {
    deleteElement(editingElementId.value)
    editingElementId.value = null
  }
}

/** 退出编辑模式 */
function finishEditing() {
  editingElementId.value = null
}
</script>

<style scoped>
/* =========================================================================
   EditorToolbar 样式 — 底部浮动工具栏
   ========================================================================= */

.editor-toolbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 20;
  padding: 12px 16px;
  /* 适配 iPhone X+ 底部安全区 */
  padding-bottom: calc(12px + var(--safe-area-bottom));
  /* 毛玻璃效果 */
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  transition: transform 300ms ease, opacity 300ms ease;
}

/* 目标丢失时隐藏工具栏 */
.toolbar-hidden {
  transform: translateY(100%);
  opacity: 0;
}

.toolbar-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  max-width: 480px;
  margin: 0 auto;
  flex-wrap: wrap;
}

/* ---- 工具按钮 ---- */
.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 16px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  font-size: var(--font-sm);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;
  /* 最小触摸目标 */
  min-width: 44px;
  min-height: 44px;
  white-space: nowrap;
}

.tool-btn:active {
  background: rgba(255, 255, 255, 0.15);
  transform: scale(0.95);
}

.tool-icon {
  font-size: 18px;
}

.tool-label {
  font-size: var(--font-sm);
}

.tool-btn.danger {
  border-color: rgba(239, 68, 68, 0.3);
}

.tool-btn.danger:active {
  background: rgba(239, 68, 68, 0.2);
}

.tool-btn.done {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

/* ---- 颜色选择器 ---- */
.color-picker {
  display: flex;
  gap: 6px;
  align-items: center;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.2);
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
  flex-shrink: 0;
}

.color-swatch:active {
  transform: scale(1.2);
}

.color-swatch.active {
  border-color: #fff;
  border-width: 3px;
  transform: scale(1.15);
}

/* ---- 字号控制 ---- */
.font-size-controls {
  display: flex;
  gap: 4px;
}

.size-btn {
  padding: 8px 12px;
  font-weight: 700;
}

.size-arrow {
  font-size: 10px;
  vertical-align: super;
}
</style>
