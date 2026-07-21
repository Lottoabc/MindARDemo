<!--
  ARScene.vue — A-Frame 场景包装组件（轻量版）
  ============================================================================
  【说明】
  由于 MindAR + A-Frame 的核心场景生命周期已封装在 useMindAR.js 中，
  本组件作为 ARView 的辅助，提供一个简洁的 <div> 占位容器即可。

  实际上，ARView.vue 直接调用 useMindAR().createARScene('ar-container', mindUrl)
  将场景挂载到 #ar-container div。这个组件文件保留供未来扩展（如添加调试面板、
  场景状态指示器等）。

  当前状态：ARScene 的功能已内联到 ARView 中，这个文件是架构占位符。
  如果你需要自定义场景内的 A-Frame 实体（如添加 3D 模型），可以在这里扩展。
-->
<template>
  <!-- AR 场景占位容器 — A-Frame 将命令式创建并挂载到此 div 内部 -->
  <div
    :id="containerId"
    class="ar-scene-container"
    ref="containerRef"
  ></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useMindAR } from '../composables/useMindAR.js'

const props = defineProps({
  /** 容器 DOM ID（与 useMindAR.createARScene 使用的 ID 一致） */
  containerId: {
    type: String,
    default: 'ar-container',
  },
  /** .mind 文件 URL */
  mindUrl: {
    type: String,
    required: true,
  },
  /** 是否自动开始 AR（默认 true） */
  autoStart: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits([
  'scene-ready',     // 场景初始化完成
  'scene-error',     // 场景初始化失败
  'target-found',    // 检测到图片目标
  'target-lost',     // 丢失图片目标
])

const { createARScene, destroyARScene, targetDetected, cameraReady } = useMindAR()
const containerRef = ref(null)

// ---------------------------------------------------------------------------
// 自动初始化（当 mindUrl 变化时重建场景）
// ---------------------------------------------------------------------------

let isInitialized = false

async function initScene() {
  if (isInitialized) {
    await destroyARScene()
    isInitialized = false
  }

  if (!props.mindUrl) return

  try {
    await createARScene(props.containerId, props.mindUrl)
    isInitialized = true
    emit('scene-ready')
  } catch (err) {
    console.error('[ARScene] 初始化失败:', err)
    emit('scene-error', err.message || '场景初始化失败')
  }
}

// 当 mindUrl 变化时重新初始化
watch(() => props.mindUrl, (newUrl) => {
  if (newUrl) initScene()
})

// 自动启动
onMounted(() => {
  if (props.autoStart && props.mindUrl) {
    initScene()
  }
})

// ---------------------------------------------------------------------------
// 监听目标检测状态变化
// ---------------------------------------------------------------------------

watch(targetDetected, (val) => {
  if (val) {
    emit('target-found')
  } else {
    emit('target-lost')
  }
})

// ---------------------------------------------------------------------------
// 清理
// ---------------------------------------------------------------------------

onBeforeUnmount(() => {
  if (isInitialized) {
    destroyARScene()
    isInitialized = false
  }
})

// ---------------------------------------------------------------------------
// 暴露给父组件的方法
// ---------------------------------------------------------------------------

defineExpose({
  /** 手动启动 AR 场景 */
  start: initScene,
  /** 手动停止 AR 场景 */
  stop: () => {
    destroyARScene()
    isInitialized = false
  },
  /** 摄像头是否就绪 */
  cameraReady,
  /** 是否检测到目标 */
  targetDetected,
})
</script>

<style scoped>
/* AR 场景容器：全屏 canvas，作为 AR 画面层 */
.ar-scene-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 1;
  background: #000; /* AR 未就绪时显示黑色背景 */
}

/* 确保 A-Frame 的 <a-scene> 自定义元素撑满容器 */
.ar-scene-container :deep(a-scene) {
  width: 100% !important;
  height: 100% !important;
}
</style>
