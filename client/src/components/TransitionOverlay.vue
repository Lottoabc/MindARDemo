<!--
  TransitionOverlay.vue — 目标热交换过渡蒙版
  ============================================================================
  当 MindAR 追踪数据被热替换时，显示毛玻璃遮罩 + 加载动画，
  遮挡追踪中断的短暂黑帧（通常 300~500ms）。

  使用方式：
    <TransitionOverlay ref="overlayRef" />
    overlayRef.value.show()
    // ... 执行热交换 ...
    overlayRef.value.hide()
-->
<template>
  <Teleport to="body">
    <div
      class="transition-overlay"
      :class="{ active: visible }"
    >
      <div class="transition-card">
        <div class="transition-spinner"></div>
        <p class="transition-text">{{ message }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue'

const visible = ref(false)
const message = ref('正在更新追踪目标...')

function show(msg = '正在更新追踪目标...') {
  message.value = msg
  visible.value = true
}

function hide() {
  visible.value = false
}

defineExpose({ show, hide, visible })
</script>

<style scoped>
.transition-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}

.transition-overlay.active {
  opacity: 1;
  pointer-events: auto;
}

.transition-card {
  text-align: center;
  padding: 32px;
}

.transition-spinner {
  width: 40px;
  height: 40px;
  margin: 0 auto 16px;
  border: 3px solid rgba(255, 255, 255, 0.15);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.transition-text {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
</style>
