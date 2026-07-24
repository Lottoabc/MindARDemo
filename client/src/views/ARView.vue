<!--
  ARView.vue — AR 场景页面（重构版：多目标 + 动态添加 + 非阻塞截图）
  ============================================================================
  页面结构（从底到顶的 z-index 层级）：
    1. ARScene（A-Frame canvas，摄像头画面+3D追踪）          —— z-index: 1
    2. TargetAnchor 群（每个追踪到的参照物显示 emoji+留言）   —— z-index: 15
    3. DOMOverlay（协同 UI 覆盖层，与旧版兼容）              —— z-index: 10
    4. EditorToolbar（固定底部工具栏，拍照/添加留言）         —— z-index: 20
    5. UserPresence（在线用户指示器）                         —— z-index: 15
    6. TransitionOverlay（热交换蒙版）                        —— z-index: 9999

  核心流程：
    onMounted
      → installStreamInterceptor()  （拦截 getUserMedia，克隆视频轨）
      → createARScene()             （创建 A-Frame 场景，初始 1 个 target）
      → coordinator.init()          （初始化 3D→2D 投影器）
      → joinRoom + registerListeners
      → sceneReady = true

    用户点击拍照
      → captureAsImage()            （从克隆流抓帧，零干扰）
      → compileImage()              （单图编译）
      → registerTarget()            （合并全量编译 → combined .mind）
      → hotSwap()                   （蒙版遮罩 → 替换追踪数据 → 蒙版消失）
      → Toast 提示

    targetFound(targetIndex)
      → TargetAnchor 显示，3D 投影驱动位置，跟随参照物
-->

<template>
  <div class="ar-view">
    <!-- ⚠️ 安全上下文警告 -->
    <div v-if="!isSecureContext" class="security-warning">
      <p>⚠️ 当前不是安全上下文（HTTPS / localhost）</p>
      <p class="warning-sub">摄像头和 AR 功能将无法使用</p>
    </div>

    <!-- AR 场景容器 -->
    <div id="ar-container" class="ar-container" ref="arContainerRef"></div>

    <!--
      TargetAnchor 群 — 每个被追踪到的参照物显示一个锚点
      热交换后 anchorElements 会更新，Vue 自动重新渲染
    -->
    <TargetAnchor
      v-for="(anchorEl, index) in visibleAnchors"
      :key="index"
      :target-index="index"
      :anchor-el="anchorEl"
      @toast="showToast"
    />

    <!--
      DOM Overlay 协同层 — 保持与旧版兼容
      （当 targetDetected 时可见，显示协同用户的手动放置元素）
    -->
    <DOMOverlay
      v-if="sceneReady"
      :visible="targetDetected"
      @toast="showToast"
    />

    <!-- 底部工具栏（始终可见） -->
    <EditorToolbar
      v-if="sceneReady"
      :visible="targetDetected"
      :always-visible="true"
      :has-active-target="targetDetected"
      :is-processing="isProcessing"
      @capture="handleCapture"
      @open-board="openMessageBoard"
    />

    <!-- 在线用户指示器 -->
    <UserPresence v-if="sceneReady" />

    <!-- 留言板弹窗 -->
    <MessageBoard
      :visible="boardVisible"
      :target-index="activeTargetIndex >= 0 ? activeTargetIndex : 0"
      :emoji="boardEmoji"
      @close="boardVisible = false"
      @toast="showToast"
    />

    <!-- 热交换过渡蒙版 -->
    <TransitionOverlay ref="transitionRef" />

    <!-- 场景加载中 -->
    <div v-if="!sceneReady && !sceneError" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p class="loading-text">{{ loadingMessage }}</p>
    </div>

    <!-- 场景加载错误 -->
    <div v-if="sceneError" class="error-overlay">
      <p class="error-title">😔 AR 场景初始化失败</p>
      <p class="error-detail">{{ sceneError }}</p>
      <div class="error-actions">
        <button class="btn btn-primary" @click="retryInit">重试</button>
        <button class="btn btn-ghost" @click="goBack">返回首页</button>
      </div>
    </div>

    <!-- Toast 提示层 -->
    <TransitionGroup name="toast">
      <div v-for="toast in toasts" :key="toast.id" class="toast">
        {{ toast.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
/**
 * ARView 核心编排：
 *   1. 初始化独立摄像头流（拦截 getUserMedia）
 *   2. 创建多目标 AR 场景
 *   3. 拍照 → 编译 → 合并 → 热交换
 *   4. 3D 坐标投影驱动 DOM Overlay
 *   5. 移动端生命周期保护
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMindAR } from '../composables/useMindAR.js'
import { useSocket } from '../composables/useSocket.js'
import { useCollaboration } from '../composables/useCollaboration.js'
import { useCameraStream } from '../composables/useCameraStream.js'
import { useCoordinateProjector } from '../composables/useCoordinateProjector.js'
import { useTargetRegistry } from '../composables/useTargetRegistry.js'
import { useTargetStore } from '../stores/useTargetStore.js'
import { useMessageStore } from '../stores/useMessageStore.js'
import { API_BASE } from '../config.js'

import DOMOverlay from '../components/DOMOverlay.vue'
import EditorToolbar from '../components/EditorToolbar.vue'
import UserPresence from '../components/UserPresence.vue'
import TargetAnchor from '../components/TargetAnchor.vue'
import MessageBoard from '../components/MessageBoard.vue'
import TransitionOverlay from '../components/TransitionOverlay.vue'

const route = useRoute()
const router = useRouter()

// ---------------------------------------------------------------------------
// Composables & Stores
// ---------------------------------------------------------------------------
const {
  createARScene, destroyARScene, targetDetected, activeTargetIndex,
  cameraReady,
  compileImage, compileProgress, isCompiling,
  targetStates, captureCameraFrame,
  onTargetFound, onTargetLost,
} = useMindAR()

const { connected } = useSocket()
const { joinRoom, leaveRoom, registerListeners, unregisterListeners } = useCollaboration()
const { install: installStreamInterceptor, captureAsImage, destroy: destroyStream } = useCameraStream()
const { init: initProjector } = useCoordinateProjector()
const { registerTarget, hotSwap } = useTargetRegistry()
const targetStore = useTargetStore()
const messageStore = useMessageStore()

// ---------------------------------------------------------------------------
// 路由参数
// ---------------------------------------------------------------------------
const roomId = route.params.roomId
const mindUrl = route.query.mindUrl

// ---------------------------------------------------------------------------
// 本地状态
// ---------------------------------------------------------------------------
const sceneReady = ref(false)
const sceneError = ref(null)
const loadingMessage = ref('正在初始化 AR 场景...')
const isSecureContext = ref(
  window.isSecureContext || window.location.hostname === 'localhost'
)
const arContainerRef = ref(null)

/** 拍照/编译处理中 */
const isProcessing = ref(false)

/** 留言板弹窗 */
const boardVisible = ref(false)
const boardEmoji = computed(() => {
  const idx = activeTargetIndex.value
  return idx >= 0 ? (targetStore.targetEmojis[idx] || '📌') : '📌'
})

/** 过渡蒙版引用 */
const transitionRef = ref(null)

/** Toast 消息队列 */
const toasts = ref([])
let toastIdCounter = 0

// ---------------------------------------------------------------------------
// 可见的 anchor 列表（响应式，TargetAnchor 组件绑定追踪位置）
// ---------------------------------------------------------------------------
const visibleAnchors = computed(() => {
  return targetStore.anchorElements
})

// ---------------------------------------------------------------------------
// 拍照流程：截帧 → 编译 → 合并 → 热交换
// ---------------------------------------------------------------------------

async function handleCapture() {
  if (isProcessing.value) return

  isProcessing.value = true
  showToast('📷 正在截取画面...', 0)

  try {
    // Step 1: 从独立流截帧（零干扰 AR 渲染）
    const img = await captureAsImage()
    if (!img) {
      // Fallback: 从 A-Frame 场景 video 截帧
      const frame = captureCameraFrame()
      if (!frame) {
        showToast('❌ 无法获取摄像头画面，请确保已授权摄像头权限', 3000)
        return
      }
      // Canvas → Image
      const fallbackImg = new Image()
      fallbackImg.src = frame.toDataURL('image/jpeg', 0.9)
      await new Promise((resolve) => {
        fallbackImg.onload = resolve
        fallbackImg.onerror = () => {
          showToast('❌ 图片处理失败', 3000)
          resolve()
        }
      })
      if (!fallbackImg.complete) return
      await processNewTarget(fallbackImg)
      return
    }

    await processNewTarget(img)

  } catch (err) {
    console.error('[ARView] 拍照处理失败:', err)
    showToast(`❌ 处理失败: ${err.message}`, 3000)
  } finally {
    isProcessing.value = false
  }
}

async function processNewTarget(img) {
  // Step 2: 获取已有图片列表
  const existingImages = targetStore.allImageElements

  // Step 3: 合并编译（新图片 + 所有已有图片 → 单个 combined .mind）
  showToast('🧠 正在提取图片特征...', 0)
  const { blobUrl, newIndex } = await registerTarget(img, existingImages)

  // 清除编译相关 toast
  clearPersistentToasts()

  // Step 4: 热交换 AR 追踪数据
  const scene = document.querySelector('a-scene')
  if (!scene) {
    showToast('❌ AR 场景未就绪', 3000)
    return
  }

  transitionRef.value?.show(`正在添加第 ${newIndex + 1} 个参照物...`)

  try {
    await hotSwap(scene, blobUrl, newIndex + 1, {
      onTargetFound: (idx) => {
        // 更新 MindAR 共享状态（供 EditorToolbar 等组件响应）
        targetStates.value = { ...targetStates.value, [idx]: true }
        targetDetected.value = true
        activeTargetIndex.value = idx
      },
      onTargetLost: (idx) => {
        targetStates.value = { ...targetStates.value, [idx]: false }
        const anyDetected = Object.values(targetStates.value).some(v => v)
        if (!anyDetected) {
          targetDetected.value = false
          activeTargetIndex.value = -1
        }
      },
    })

    // 成功
    showToast(`✅ 新参照物就绪！共 ${newIndex + 1} 个目标`, 3000)

  } catch (err) {
    console.error('[ARView] 热交换失败:', err)
    showToast('❌ 热交换失败，请刷新页面重试', 4000)
  } finally {
    transitionRef.value?.hide()
  }
}

// ---------------------------------------------------------------------------
// 留言板
// ---------------------------------------------------------------------------
function openMessageBoard() {
  boardVisible.value = true
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function showToast(message, duration = 2500) {
  const id = ++toastIdCounter
  toasts.value.push({ id, message })
  if (duration > 0) {
    setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id)
    }, duration)
  }
}

function clearPersistentToasts() {
  toasts.value = toasts.value.filter(
    t => !t.message.includes('截取') && !t.message.includes('特征') && !t.message.includes('上传')
  )
}

// ---------------------------------------------------------------------------
// 初始化 & 销毁
// ---------------------------------------------------------------------------

onMounted(async () => {
  // --- 校验 ---
  if (!roomId || !mindUrl) {
    sceneError.value = '缺少房间 ID 或目标文件 URL。请返回首页重新创建。'
    return
  }

  if (!isSecureContext.value) {
    sceneError.value = '当前环境不是安全上下文。请使用 HTTPS 或 localhost 访问。'
    return
  }

  try {
    // ===================================================================
    // Step 1: 安装摄像头流拦截器（必须在 createARScene 之前！）
    // ===================================================================
    loadingMessage.value = '正在准备摄像头...'
    installStreamInterceptor()

    // ===================================================================
    // Step 2: 初始化初始目标到 Store（首个目标在 HomeView 中编译，这里注册）
    // ===================================================================
    // 首个目标不需要重新编译——它已经通过 mindUrl 参数传入。
    // 记录到 targetStore 以便后续合并编译时使用。
    targetStore.setActiveMindUrl(mindUrl)

    // 将初始图片缓存到 Store（从服务器返回的缩略图 URL 加载）
    // 注意：HomeView 上传时也会返回 imageUrl，通过 query 参数传递
    const initialImgUrl = route.query.imageUrl
    if (initialImgUrl) {
      try {
        const initialImg = await loadImageFromUrl(initialImgUrl)
        targetStore.addTarget(0, initialImg, initialImgUrl, '📌')
      } catch {
        console.warn('[ARView] 无法加载初始图片到缓存')
        // 用占位 canvas 代替（后续拍照合并时会用到已有图片，但首图的 pixel data 可能不可用）
        // 这是已知限制：第一次拍照时如果初始图片不在缓存中，合并编译只用新图
      }
    }

    // ===================================================================
    // Step 3: 创建 AR 场景（初始 1 个 target）
    // ===================================================================
    loadingMessage.value = '正在启动摄像头...'
    await createARScene('ar-container', mindUrl, 1)

    // ===================================================================
    // Step 4: 初始化 3D→2D 坐标投影器
    // ===================================================================
    const sceneEl = document.querySelector('a-scene')
    if (sceneEl) {
      initProjector(sceneEl)
      // 注册初始 anchor 到 Store
      const initialAnchor = sceneEl.querySelector('[mindar-image-target]')
      if (initialAnchor) {
        targetStore.registerAnchor(0, initialAnchor)
      }
    }

    // ===================================================================
    // Step 5: 注册协同监听、加入房间
    // ===================================================================
    loadingMessage.value = '正在建立连接...'
    registerListeners()

    if (connected.value) {
      joinRoom(roomId)
    }

    let wasConnected = connected.value
    watch(connected, (isConnected) => {
      if (isConnected && !wasConnected) {
        console.log('[ARView] Socket 已重连，重新加入房间')
        registerListeners()
        joinRoom(roomId)
      }
      wasConnected = isConnected
    })

    // ===================================================================
    // Step 6: 注册移动端保护
    // ===================================================================
    registerMobileProtections()

    // ===================================================================
    // 就绪
    // ===================================================================
    sceneReady.value = true
    console.log('[ARView] ✅ AR 场景初始化完成')

  } catch (err) {
    console.error('[ARView] AR 场景初始化失败:', err)
    sceneError.value = err.message || '未知错误'
  }
})

onBeforeUnmount(() => {
  unregisterListeners()
  leaveRoom()
  destroyARScene()
  destroyStream()          // 释放克隆视频流
  targetStore.reset()      // 清理 Store（释放 Blob URL 等）
  sceneReady.value = false
})

// ---------------------------------------------------------------------------
// 移动端保护
// ---------------------------------------------------------------------------

function registerMobileProtections() {
  // 1. iOS Safari 视频自动播放恢复
  const resumeVideo = () => {
    const video = document.querySelector('a-scene video')
    if (video?.paused) {
      video.play().catch(() => {})
    }
  }
  document.addEventListener('click', resumeVideo, { once: true })
  document.addEventListener('touchend', resumeVideo, { once: true })

  // 2. WebGL 上下文丢失保护
  const canvas = document.querySelector('a-scene canvas')
  if (canvas) {
    canvas.addEventListener('webglcontextlost', (e) => {
      console.warn('[ARView] WebGL context lost, 请求恢复...')
      e.preventDefault()
    })
    canvas.addEventListener('webglcontextrestored', () => {
      console.log('[ARView] WebGL context restored')
    })
  }

  // 3. visibilitychange — 切后台回来恢复摄像头
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      resumeVideo()
    }
  })

  // 4. iOS 安全区 CSS 变量
  if (CSS.supports('padding-bottom', 'env(safe-area-inset-bottom)')) {
    document.documentElement.style.setProperty(
      '--safe-area-bottom',
      'env(safe-area-inset-bottom, 0px)'
    )
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

async function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`图片加载失败: ${url}`))
    img.src = url
  })
}

function retryInit() {
  window.location.reload()
}

function goBack() {
  router.push({ name: 'Home' })
}
</script>

<style scoped>
/* =========================================================================
   ARView 样式 — 全屏 AR 画面
   ========================================================================= */

.ar-view {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #000;
}

/* ---- AR 场景容器 ---- */
.ar-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.ar-container :deep(a-scene) {
  width: 100% !important;
  height: 100% !important;
}

/* ---- 安全警告 ---- */
.security-warning {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 100;
  text-align: center;
  background: rgba(239, 68, 68, 0.95);
  color: #fff;
  padding: 24px;
  border-radius: var(--radius-lg);
  max-width: 90vw;
}

.warning-sub {
  font-size: var(--font-sm);
  margin-top: 8px;
  opacity: 0.85;
}

/* ---- 加载中 ---- */
.loading-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  gap: 20px;
}

.loading-spinner {
  width: 40px; height: 40px;
  border: 3px solid rgba(255,255,255,0.15);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.loading-text {
  font-size: var(--font-base);
  color: var(--text-secondary);
}

/* ---- 错误 ---- */
.error-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  padding: 24px;
  text-align: center;
  gap: 12px;
}

.error-title { font-size: var(--font-xl); color: var(--text-primary); }
.error-detail { font-size: var(--font-sm); color: var(--text-muted); margin-bottom: 16px; }
.error-actions { display: flex; gap: 12px; }
</style>
