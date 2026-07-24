<!--
  EditorToolbar.vue — 底部编辑工具栏（重构版）
  ============================================================================
  两种模式：

  【模式 A — 无编辑中元素】
    - 📷 拍照按钮（始终可用，即使目标未检测到也能拍照添加新参照物）
    - 💬 添加文字留言（仅在检测到目标时可用）
    - 😊 添加表情（仅在检测到目标时可用）
    - 目标指示器：显示 "已注册 N 个参照物"

  【模式 B — 有编辑中元素】
    - 颜色选择器、字号调节、删除、完成（与原版一致）

  移动端适配：
    - 固定在屏幕底部，safe-area-inset-bottom
    - 最小触摸目标 44x44px
    - 半透明毛玻璃背景
-->
<template>
  <div
    class="editor-toolbar"
    :class="{ 'toolbar-hidden': !alwaysVisible && !visible }"
  >
    <div class="toolbar-inner">
      <!-- ================================================================ -->
      <!-- 模式 B：编辑中 — 显示编辑工具 -->
      <!-- ================================================================ -->
      <template v-if="editingElementId">
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
          <button class="tool-btn size-btn" @click="changeFontSize(-2)" aria-label="缩小字号">
            A<span class="size-arrow">-</span>
          </button>
          <button class="tool-btn size-btn" @click="changeFontSize(2)" aria-label="放大字号">
            A<span class="size-arrow">+</span>
          </button>
        </div>

        <button class="tool-btn danger" @click="deleteCurrentElement" aria-label="删除元素">
          <span class="tool-icon">🗑️</span>
        </button>

        <button class="tool-btn done" @click="finishEditing" aria-label="完成编辑">
          <span class="tool-label">完成 ✓</span>
        </button>
      </template>

      <!-- ================================================================ -->
      <!-- 模式 A：添加模式 -->
      <!-- ================================================================ -->
      <template v-else>
        <!-- 目标计数指示器 -->
        <div class="target-badge" v-if="targetCount > 0">
          <span class="badge-num">{{ targetCount }}</span>
          <span class="badge-label">参照物</span>
        </div>

        <!-- 添加文字留言（需要检测到目标） -->
        <button
          class="tool-btn"
          :disabled="!hasActiveTarget"
          @click="addTextElement"
          aria-label="添加文字"
        >
          <span class="tool-icon">💬</span>
          <span class="tool-label">文字</span>
        </button>

        <!-- 📷 拍照按钮 — 居中，描边动画，始终可用 -->
        <button
          class="tool-btn capture-btn"
          :class="{ 'capture-processing': isProcessing }"
          :disabled="isProcessing"
          @click="$emit('capture')"
          aria-label="拍摄新参照物"
        >
          <span class="capture-ring"></span>
          <span class="tool-icon capture-icon">📷</span>
        </button>

        <!-- 添加 emoji -->
        <button
          class="tool-btn"
          :disabled="!hasActiveTarget"
          @click="addEmojiElement"
          aria-label="添加表情"
        >
          <span class="tool-icon">😊</span>
          <span class="tool-label">表情</span>
        </button>

        <!-- 留言板按钮（仅在检测到目标时可用） -->
        <button
          class="tool-btn"
          :disabled="!hasActiveTarget"
          @click="$emit('open-board')"
          aria-label="打开留言板"
        >
          <span class="tool-icon">📋</span>
        </button>
      </template>
    </div>

    <!-- 编译进度条（拍照编译时显示） -->
    <div v-if="isProcessing" class="compile-progress-bar">
      <div class="progress-fill" :style="{ width: `${compilePct}%` }"></div>
    </div>
  </div>
</template>

<script setup>
/**
 * EditorToolbar 逻辑：
 *   1. 无编辑中元素时：拍照 + 添加文字/emoji
 *   2. 有编辑中元素时：颜色、字号、删除等编辑工具
 */
import { ref, computed } from 'vue'
import { useCollaboration } from '../composables/useCollaboration.js'
import { useTargetStore } from '../stores/useTargetStore.js'

// ---------------------------------------------------------------------------
// Props & Emits
// ---------------------------------------------------------------------------

const props = defineProps({
  /** 是否有目标被检测到 */
  visible: { type: Boolean, default: false },
  /** 是否始终显示工具栏（拍照按钮始终可见） */
  alwaysVisible: { type: Boolean, default: true },
  /** 是否有活跃目标（控制文字/emoji 按钮是否可用） */
  hasActiveTarget: { type: Boolean, default: false },
  /** 是否正在拍照/编译中 */
  isProcessing: { type: Boolean, default: false },
})

const emit = defineEmits(['capture', 'open-board'])

// ---------------------------------------------------------------------------
// Stores & Composables
// ---------------------------------------------------------------------------

const { elements, editingElementId, addElement, updateElement, deleteElement } = useCollaboration()
const targetStore = useTargetStore()

const targetCount = computed(() => targetStore.targetCount)
const compilePct = computed(() => Math.round(targetStore.compileProgress * 100))

// ---------------------------------------------------------------------------
// 预设颜色
// ---------------------------------------------------------------------------
const presetColors = [
  '#ffffff', '#f87171', '#fb923c', '#fbbf24',
  '#a3e635', '#34d399', '#22d3ee', '#60a5fa',
  '#818cf8', '#c084fc', '#f472b6',
]

// ---------------------------------------------------------------------------
// 当前编辑元素的颜色
// ---------------------------------------------------------------------------
const selectedColor = computed(() => {
  const el = elements.value.find(e => e.id === editingElementId.value)
  return el?.style?.color || '#ffffff'
})

// ---------------------------------------------------------------------------
// 添加元素
// ---------------------------------------------------------------------------
function addTextElement() {
  const id = addElement('text', '双击编辑文字', { x: 50, y: 40 })
  if (id) editingElementId.value = id
}

function addEmojiElement() {
  const id = addElement('emoji', '😊', { x: 50, y: 40 })
  if (id) editingElementId.value = id
}

// ---------------------------------------------------------------------------
// 编辑工具
// ---------------------------------------------------------------------------
function changeColor(color) {
  if (!editingElementId.value) return
  updateElement(editingElementId.value, {
    style: { ...getCurrentStyle(), color },
  })
}

function changeFontSize(delta) {
  if (!editingElementId.value) return
  const currentStyle = getCurrentStyle()
  const newSize = Math.max(12, Math.min(72, (currentStyle.fontSize || 16) + delta))
  updateElement(editingElementId.value, {
    style: { ...currentStyle, fontSize: newSize },
  })
}

function getCurrentStyle() {
  const el = elements.value.find(e => e.id === editingElementId.value)
  return el?.style || { color: '#ffffff', fontSize: 16, backgroundColor: 'rgba(0,0,0,0.5)' }
}

function deleteCurrentElement() {
  if (!editingElementId.value) return
  if (confirm('确定删除这个元素吗？')) {
    deleteElement(editingElementId.value)
    editingElementId.value = null
  }
}

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
  padding-bottom: calc(12px + var(--safe-area-bottom));
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  transition: transform 300ms ease, opacity 300ms ease;
}

/* 目标丢失时隐藏工具栏（alwayVisible=false 时生效） */
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

/* ---- 目标计数徽章 ---- */
.target-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: var(--radius-md);
  color: #818cf8;
  font-size: 12px;
}

.badge-num {
  font-weight: 700;
  font-size: 16px;
}

/* ---- 工具按钮 ---- */
.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 14px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  font-size: var(--font-sm);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease, opacity 0.15s ease;
  min-width: 44px;
  min-height: 44px;
  white-space: nowrap;
}

.tool-btn:active:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  transform: scale(0.95);
}

.tool-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.tool-icon { font-size: 18px; }
.tool-label { font-size: var(--font-sm); }

.tool-btn.danger { border-color: rgba(239, 68, 68, 0.3); }
.tool-btn.danger:active { background: rgba(239, 68, 68, 0.2); }
.tool-btn.done {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

/* ---- 颜色选择器 ---- */
.color-picker { display: flex; gap: 6px; align-items: center; }
.color-swatch {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.2);
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
  flex-shrink: 0;
}
.color-swatch:active { transform: scale(1.2); }
.color-swatch.active { border-color: #fff; border-width: 3px; transform: scale(1.15); }

/* ---- 字号控制 ---- */
.font-size-controls { display: flex; gap: 4px; }
.size-btn { padding: 8px 12px; font-weight: 700; }
.size-arrow { font-size: 10px; vertical-align: super; }

/* ---- 拍照按钮 + 描边动画 ---- */
.capture-btn {
  position: relative;
  padding: 10px 18px;
  border: 2px solid var(--color-primary);
  background: rgba(99, 102, 241, 0.12);
  overflow: visible;
}

.capture-ring {
  position: absolute;
  inset: -4px;
  border-radius: var(--radius-md);
  border: 2px solid var(--color-primary);
  animation: capture-pulse 2.2s ease-in-out infinite;
  pointer-events: none;
}

@keyframes capture-pulse {
  0%, 100% { opacity: 0.3; transform: scale(1); box-shadow: 0 0 6px rgba(99,102,241,0.3); }
  50% { opacity: 1; transform: scale(1.06); box-shadow: 0 0 18px rgba(99,102,241,0.7), 0 0 36px rgba(129,140,248,0.35); }
}

.capture-processing .capture-ring {
  animation: capture-spin 0.8s linear infinite;
  border-style: dashed;
}

@keyframes capture-spin {
  to { transform: rotate(360deg) scale(1.08); opacity: 1; box-shadow: 0 0 22px rgba(99,102,241,0.8); }
}

.capture-processing { pointer-events: none; }
.capture-icon { position: relative; z-index: 1; font-size: 22px; }

/* ---- 编译进度条 ---- */
.compile-progress-bar {
  height: 3px;
  background: rgba(255,255,255,0.1);
  margin-top: 8px;
  border-radius: 2px;
  overflow: hidden;
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #818cf8);
  border-radius: 2px;
  transition: width 0.3s ease;
}
</style>
