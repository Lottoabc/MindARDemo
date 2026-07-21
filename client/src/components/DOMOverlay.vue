<!--
  DOMOverlay.vue — 协同 UI 覆盖层容器
  ============================================================================
  这是整个协同 AR 体验的核心 UI 层。它位于 A-Frame canvas（摄像头画面）
  之上，通过 z-index 叠加，渲染所有用户的协作元素。

  层级关系：
    A-Frame canvas (z-index: 1, 摄像头流 + 3D 追踪)
    └── DOMOverlay (z-index: 10, 本组件，所有协作元素)
        ├── UserElement (每个协作元素，position: absolute)
        └── 空状态提示 (无元素时显示引导文案)

  交互策略：
    - 自己的元素：可点击编辑、可拖拽移动、pointer-events: auto
    - 他人的元素：只读、pointer-events: none，点击时 Toast 提示归属
    - 容器本身：pointer-events: none（让触摸事件穿透到 A-Frame 场景）
-->
<template>
  <div
    class="dom-overlay"
    :class="{ 'overlay-hidden': !visible }"
  >
    <!--
      元素容器：pointer-events: auto（覆盖父级的 none）
      每个 UserElement 自己处理交互
    -->
    <div class="elements-container">
      <!-- 空状态：还没有任何人添加元素 -->
      <div
        v-if="elements.length === 0"
        class="empty-state"
      >
        <div class="empty-icon">✨</div>
        <p class="empty-text">图片已识别！</p>
        <p class="empty-hint">使用底部工具栏添加第一条留言吧</p>
      </div>

      <!-- 渲染所有协作元素 -->
      <UserElement
        v-for="element in elements"
        :key="element.id"
        :element="element"
        :is-own="isOwnElement(element)"
        :is-editing="editingElementId === element.id"
        @edit="onEditElement"
        @delete="onDeleteElement"
        @update="onUpdateElement"
        @toast="showToast"
      />
    </div>
  </div>
</template>

<script setup>
/**
 * DOMOverlay 负责：
 *   1. 渲染所有协作元素的列表
 *   2. 区分自己/他人的元素，传递 isOwn 给 UserElement
 *   3. 管理编辑模式：同一时间只能编辑一个元素
 *   4. 将用户操作转发给 useCollaboration
 */
import { useCollaboration } from '../composables/useCollaboration.js'
import UserElement from './UserElement.vue'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
const props = defineProps({
  /** 是否可见（绑定 MindAR 的 targetDetected 状态） */
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
  isOwnElement,
  updateElement,
  deleteElement,
} = useCollaboration()

// ---------------------------------------------------------------------------
// Toast（通过 inject/provide 或简单 emit 冒泡到 ARView）
// 这里用 emit 的方式，由 ARView 统一管理 Toast
// ---------------------------------------------------------------------------
const emit = defineEmits(['toast'])

function showToast(message) {
  emit('toast', message)
}

// ---------------------------------------------------------------------------
// 事件处理 — 转发给 useCollaboration
// ---------------------------------------------------------------------------

/**
 * 用户点击了自己的元素 → 进入编辑模式
 */
function onEditElement(elementId) {
  editingElementId.value = elementId
  // 编辑逻辑由 EditorToolbar 处理
}

/**
 * 用户删除了自己的元素
 */
function onDeleteElement(elementId) {
  if (confirm('确定删除这条留言吗？')) {
    deleteElement(elementId)
  }
}

/**
 * 用户更新了元素（拖拽位置、文本内容变更等）
 */
function onUpdateElement(elementId, updates) {
  updateElement(elementId, updates)
}
</script>

<style scoped>
/* =========================================================================
   DOM Overlay 样式
   ========================================================================= */

.dom-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 10;
  /* 容器自身不拦截触摸事件（让穿透给 AR 场景），但子元素可设置 pointer-events: auto */
  pointer-events: none;
  /* 平滑过渡显示/隐藏 */
  opacity: 1;
  transition: opacity 300ms ease;
}

/* 目标丢失时淡出 */
.overlay-hidden {
  opacity: 0;
}

/* ---- 元素容器 ---- */
.elements-container {
  position: relative;
  width: 100%;
  height: 100%;
  /* 子元素通过 position: absolute 自由定位 */
}

/* ---- 空状态 ---- */
.empty-state {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: auto; /* 允许用户交互 */
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-text {
  font-size: var(--font-lg);
  font-weight: 700;
  color: var(--text-primary);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}

.empty-hint {
  margin-top: 8px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
</style>
