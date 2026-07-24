<!--
  ARView.vue — AR 场景页面（重构版：直开摄像头，拍照即创建参照物）
  ============================================================================
  页面结构（从底到顶的 z-index 层级）：
    1. ARScene（A-Frame canvas，摄像头画面+3D追踪）          —— z-index: 1
    2. TargetAnchor 群（每个追踪到的参照物显示 emoji+留言）   —— z-index: 15
    3. EditorToolbar（底部工具栏，始终可见）                 —— z-index: 20
    4. TransitionOverlay（热交换蒙版）                        —— z-index: 9999

  两种启动模式：
    【直开模式】/ 路由 — 纯摄像头预览，拍照创建第一个参照物
    【房间模式】/ar/:roomId?mindUrl=... — 加入已有房间，直接开始追踪

  拍照流程：
    首次拍照: 编译→上传获取roomId→startMindAR()激活追踪→注册目标
    后续拍照: 合并编译→hotSwap()热交换→追踪无缝更新
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

    <!-- 纯相机模式的摄像头预览（MindAR 未激活时的视频背景） -->
    <video
      v-show="rawCameraActive"
      ref="rawVideoRef"
      class="raw-camera"
      playsinline
      muted
      autoplay
    ></video>

    <!--
      TargetAnchor 群 — 每个被追踪到的参照物显示一个锚点
    -->
    <TargetAnchor
      v-for="(anchorEl, index) in visibleAnchors"
      :key="index"
      :target-index="index"
      :anchor-el="anchorEl"
      @toast="showToast"
    />

    <!-- 纯相机模式提示：还没有任何参照物 -->
    <div v-if="started && sceneReady && !mindARActive" class="camera-hint">
      <div class="hint-icon">📷</div>
      <p class="hint-text">摄像头已就绪</p>
      <p class="hint-sub">点击底部拍照按钮，创建第一个 AR 参照物</p>
    </div>

    <!-- 底部工具栏 -->
    <EditorToolbar
      v-if="sceneReady"
      :visible="targetDetected"
      :always-visible="true"
      :has-active-target="targetDetected"
      :is-processing="isProcessing"
      @capture="handleCapture"
      @open-board="openMessageBoard"
    />

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

    <!-- 开始界面：点击按钮后启动摄像头 -->
    <div v-if="!started && !sceneError" class="start-overlay">
      <div class="start-card">
        <div class="start-icon">📷</div>
        <h1 class="start-title">WebAR 扫描</h1>
        <p class="start-desc">对准参照物图片，发现隐藏的留言与表情</p>
        <button class="start-btn" @click="handleStart">
          开始扫描
        </button>
        <p v-if="!isSecureContext" class="start-warn">
          ⚠️ 需要 HTTPS 或 localhost 环境才能使用摄像头
        </p>
      </div>
    </div>

    <!-- 场景加载中 -->
    <div v-if="started && !sceneReady && !sceneError" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p class="loading-text">{{ loadingMessage }}</p>
    </div>

    <!-- 场景加载错误 -->
    <div v-if="sceneError" class="error-overlay">
      <p class="error-title">😔 摄像头初始化失败</p>
      <p class="error-detail">{{ sceneError }}</p>
      <div class="error-actions">
        <button class="btn btn-primary" @click="retryInit">重试</button>
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

import EditorToolbar from '../components/EditorToolbar.vue'
import TargetAnchor from '../components/TargetAnchor.vue'
import MessageBoard from '../components/MessageBoard.vue'
import TransitionOverlay from '../components/TransitionOverlay.vue'
import { v4 as uuidv4 } from 'uuid'

const route = useRoute()
const router = useRouter()

// ---------------------------------------------------------------------------
// Composables & Stores
// ---------------------------------------------------------------------------
const {
  createARScene, startMindAR, destroyARScene,
  targetDetected, activeTargetIndex, cameraReady,
  compileImage, targetStates,
  captureCameraFrame,
} = useMindAR()

const { connected } = useSocket()
const { joinRoom, registerListeners, unregisterListeners } = useCollaboration()
const { install: installStreamInterceptor, captureAsImage, destroy: destroyStream } = useCameraStream()
const { init: initProjector } = useCoordinateProjector()
const { registerTarget, hotSwap } = useTargetRegistry()
const targetStore = useTargetStore()

// ---------------------------------------------------------------------------
// 路由参数（全部可选 — 直开模式下不需要任何参数）
// ---------------------------------------------------------------------------
const roomId = ref(route.params.roomId || '')
const mindUrl = ref(route.query.mindUrl || null)

// ---------------------------------------------------------------------------
// 本地状态
// ---------------------------------------------------------------------------
const sceneReady = ref(false)
const sceneError = ref(null)
const loadingMessage = ref('正在启动摄像头...')
const isSecureContext = ref(window.isSecureContext || window.location.hostname === 'localhost')
const arContainerRef = ref(null)

/** MindAR 追踪是否已激活（false = 纯相机模式） */
const mindARActive = computed(() => targetStore.targetCount > 0)

/** 是否已点击开始 */
const started = ref(false)

/** 纯相机模式的 raw video 是否活跃 */
const rawCameraActive = ref(false)
const rawVideoRef = ref(null)

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

/** Toast */
const toasts = ref([])
let toastIdCounter = 0

/** 可见 anchor 列表 */
const visibleAnchors = computed(() => targetStore.anchorElements)

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function showToast(message, duration = 2500) {
  const id = ++toastIdCounter
  toasts.value.push({ id, message })
  if (duration > 0) {
    setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, duration)
  }
}

function clearPersistentToasts() {
  toasts.value = toasts.value.filter(
    t => !t.message.includes('截取') && !t.message.includes('特征') && !t.message.includes('上传')
  )
}

// ---------------------------------------------------------------------------
// 拍照流程
// ---------------------------------------------------------------------------

async function handleCapture() {
  if (isProcessing.value) return
  isProcessing.value = true
  showToast('📷 正在截取画面...', 0)

  try {
    let img = null

    // 优先：独立流截帧（Worker 管线）
    try {
      img = await captureAsImage()
    } catch (e) {
      console.warn('[ARView] 独立流截帧失败，回退:', e.message)
    }

    // 回退：直接从 A-Frame 场景 video 截帧
    if (!img) {
      const frame = captureCameraFrame()
      if (!frame) {
        showToast('❌ 无法获取摄像头画面，请确认已授权摄像头权限', 3000)
        return
      }
      img = await canvasToImage(frame)
      if (!img) {
        showToast('❌ 图片处理失败，请重试', 3000)
        return
      }
    }

    // 编译 + 上传/热交换
    showToast('🧠 正在提取图片特征...', 0)
    const { mindBlob } = await compileImage(img)
    clearPersistentToasts()

    if (!mindARActive.value) {
      await handleFirstCapture(img, mindBlob)
    } else {
      await handleSubsequentCapture(img)
    }

  } catch (err) {
    console.error('[ARView] 拍照失败:', err)
    showToast(`❌ ${err.message || '处理失败，请重试'}`, 3000)
  } finally {
    isProcessing.value = false
  }
}

/** canvas → Image 工具 */
function canvasToImage(canvas) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = canvas.toDataURL('image/jpeg', 0.9)
  })
}

async function processCapture(img) {
  // Step 2: 编译单图特征
  showToast('🧠 正在提取图片特征...', 0)
  const { mindBlob } = await compileImage(img)

  clearPersistentToasts()

  // Step 3: 判断是首次还是后续拍照
  if (!mindARActive.value) {
    // ================================================================
    // 首次拍照：上传→创建房间→激活 MindAR→注册目标
    // ================================================================
    await handleFirstCapture(img, mindBlob)
  } else {
    // ================================================================
    // 后续拍照：合并编译→热交换
    // ================================================================
    await handleSubsequentCapture(img)
  }
}

/**
 * 首次拍照：纯相机模式 → AR 追踪模式
 */
async function handleFirstCapture(img, mindBlob) {
  showToast('☁️ 正在创建房间...', 0)

  // 上传获取 roomId + mindUrl
  const { newRoomId, newMindUrl, imageUrl } = await uploadFirstTarget(img, mindBlob)

  roomId.value = newRoomId

  // 缓存图片到 Store
  const cacheImg = await loadImageFromUrl(imageUrl)
  targetStore.addTarget(0, img, imageUrl, '📌')

  // 在已有场景上激活 MindAR
  const scene = document.querySelector('a-scene')
  if (!scene) throw new Error('场景未就绪')

  showToast('🎯 正在激活 AR 追踪...', 0)

  // 关闭 raw 摄像头预览（MindAR 会接管背景渲染）
  if (rawCameraActive.value && rawVideoRef.value) {
    const tracks = rawVideoRef.value.srcObject?.getVideoTracks() || []
    tracks.forEach(t => t.stop())
    rawVideoRef.value.srcObject = null
    rawCameraActive.value = false
  }

  await startMindAR(scene, newMindUrl, 1)

  // 注册 anchor 到 Store
  const anchor = scene.querySelector('[mindar-image-target]')
  if (anchor) {
    targetStore.registerAnchor(0, anchor)
    // 初始化投影器
    initProjector(scene)
  }

  targetStore.setActiveMindUrl(newMindUrl)

  // 加入 Socket 房间
  if (connected.value) joinRoom(newRoomId)

  clearPersistentToasts()
  showToast('✅ 第一个参照物就绪！对准它试试', 3000)

  // 更新 URL（方便分享）
  router.replace({ name: 'ARRoom', params: { roomId: newRoomId }, query: { mindUrl: newMindUrl, imageUrl } })
}

/**
 * 后续拍照：合并编译→热交换
 */
async function handleSubsequentCapture(img) {
  const existingImages = targetStore.allImageElements

  showToast('🧠 正在合并编译...', 0)
  const { blobUrl, newIndex } = await registerTarget(img, existingImages)

  clearPersistentToasts()

  const scene = document.querySelector('a-scene')
  if (!scene) throw new Error('场景未就绪')

  transitionRef.value?.show(`正在添加第 ${newIndex + 1} 个参照物...`)

  try {
    await hotSwap(scene, blobUrl, newIndex + 1, {
      onTargetFound: (idx) => {
        targetStates.value = { ...targetStates.value, [idx]: true }
        targetDetected.value = true
        activeTargetIndex.value = idx
      },
      onTargetLost: (idx) => {
        targetStates.value = { ...targetStates.value, [idx]: false }
        if (!Object.values(targetStates.value).some(v => v)) {
          targetDetected.value = false
          activeTargetIndex.value = -1
        }
      },
    })
    showToast(`✅ 新参照物就绪！共 ${newIndex + 1} 个目标`, 3000)
  } catch (err) {
    console.error('[ARView] 热交换失败:', err)
    showToast('❌ 热交换失败，请刷新重试', 4000)
  } finally {
    transitionRef.value?.hide()
  }
}

// ---------------------------------------------------------------------------
// 上传
// ---------------------------------------------------------------------------

async function uploadFirstTarget(img, mindBlob) {
  // 上传图片获取 roomId
  const imgCanvas = document.createElement('canvas')
  const maxSize = 2048
  let w = img.naturalWidth, h = img.naturalHeight
  if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize }
  if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize }
  imgCanvas.width = w; imgCanvas.height = h
  imgCanvas.getContext('2d').drawImage(img, 0, 0, w, h)

  const imageBlob = await new Promise((resolve, reject) => {
    imgCanvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob 失败')), 'image/jpeg', 0.9)
  })

  const imgForm = new FormData()
  imgForm.append('image', imageBlob, 'capture.jpg')
  const imgRes = await fetch(`${API_BASE}/api/targets/image`, { method: 'POST', body: imgForm })
  const imgData = await imgRes.json()
  if (!imgData.success) throw new Error(imgData.error || '上传失败')

  // 上传 .mind
  const mindForm = new FormData()
  mindForm.append('mind', mindBlob, 'target.mind')
  mindForm.append('image', imageBlob, 'capture.jpg')
  mindForm.append('roomId', imgData.roomId)
  const mindRes = await fetch(`${API_BASE}/api/targets/mind`, { method: 'POST', body: mindForm })
  const mindData = await mindRes.json()
  if (!mindData.success) throw new Error(mindData.error || '.mind 上传失败')

  return { newRoomId: imgData.roomId, newMindUrl: mindData.mindUrl, imageUrl: imgData.imageUrl }
}

// ---------------------------------------------------------------------------
// 留言板
// ---------------------------------------------------------------------------
function openMessageBoard() {
  boardVisible.value = true
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

/**
 * 点击"开始扫描"按钮 → 初始化摄像头和 AR 场景
 */
async function handleStart() {
  started.value = true

  if (!isSecureContext.value) {
    sceneError.value = '当前环境不是安全上下文。请使用 HTTPS 或 localhost 访问。'
    return
  }

  try {
    // Step 0: 同步触发摄像头权限 + 获取用于背景预览的流
    loadingMessage.value = '正在请求摄像头权限...'
    const cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
    })
    console.log('[ARView] 摄像头权限已授予')

    // 纯相机模式：在 raw video 上直接显示摄像头画面
    // （因为 A-Frame 没有 MindAR 时不会渲染摄像头作为背景）
    if (!mindUrl.value && rawVideoRef.value) {
      rawVideoRef.value.srcObject = cameraStream
      rawCameraActive.value = true
    }

    // Step 1: 安装摄像头流拦截器（必须在 A-Frame 调用 getUserMedia 之前）
    loadingMessage.value = '正在启动摄像头...'
    installStreamInterceptor()

    // 生成临时 roomId
    if (!roomId.value) {
      roomId.value = uuidv4().slice(0, 8)
    }

    // Step 2: 创建场景
    if (mindUrl.value) {
      loadingMessage.value = '正在启动 AR 追踪...'
      await createARScene('ar-container', mindUrl.value, 1)
      targetStore.setActiveMindUrl(mindUrl.value)

      const initialImgUrl = route.query.imageUrl
      if (initialImgUrl) {
        try {
          const initialImg = await loadImageFromUrl(initialImgUrl)
          targetStore.addTarget(0, initialImg, initialImgUrl, '📌')
        } catch { /* ignore */ }
      }
    } else {
      await createARScene('ar-container', null, 0)
    }

    // Step 3: 初始化投影器 & 注册 anchor
    const sceneEl = document.querySelector('a-scene')
    if (sceneEl && mindUrl.value) {
      initProjector(sceneEl)
      const anchor = sceneEl.querySelector('[mindar-image-target]')
      if (anchor) targetStore.registerAnchor(0, anchor)
    }

    // Step 4: 注册 Socket 监听 + 加入房间
    loadingMessage.value = '正在建立连接...'
    registerListeners()

    if (connected.value && mindUrl.value) {
      joinRoom(roomId.value)
    }

    let wasConnected = connected.value
    watch(connected, (isConnected) => {
      if (isConnected && !wasConnected && mindARActive.value) {
        registerListeners()
        joinRoom(roomId.value)
      }
      wasConnected = isConnected
    })

    // Step 5: 移动端保护
    registerMobileProtections()

    sceneReady.value = true
    console.log(`[ARView] ✅ 就绪 (模式: ${mindUrl.value ? '房间' : '直开'})`)

  } catch (err) {
    console.error('[ARView] 初始化失败:', err)
    sceneError.value = err.message || '未知错误'
  }
}

onMounted(() => {
  // 页面挂载后不做任何事，等待用户点击"开始扫描"
})

onBeforeUnmount(() => {
  unregisterListeners()
  destroyARScene()
  destroyStream()
  targetStore.reset()
  sceneReady.value = false
})

// ---------------------------------------------------------------------------
// 移动端保护
// ---------------------------------------------------------------------------

function registerMobileProtections() {
  const resumeVideo = () => {
    const video = document.querySelector('a-scene video')
    if (video?.paused) video.play().catch(() => {})
  }
  document.addEventListener('click', resumeVideo, { once: true })
  document.addEventListener('touchend', resumeVideo, { once: true })

  const canvas = document.querySelector('a-scene canvas')
  if (canvas) {
    canvas.addEventListener('webglcontextlost', (e) => {
      console.warn('[ARView] WebGL context lost')
      e.preventDefault()
    })
    canvas.addEventListener('webglcontextrestored', () => {
      console.log('[ARView] WebGL context restored')
    })
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resumeVideo()
  })

  if (CSS.supports('padding-bottom', 'env(safe-area-inset-bottom)')) {
    document.documentElement.style.setProperty('--safe-area-bottom', 'env(safe-area-inset-bottom, 0px)')
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
</script>

<style scoped>
.ar-view {
  position: fixed; top: 0; left: 0;
  width: 100vw; height: 100vh;
  overflow: hidden; background: #000;
}

.ar-container {
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%; z-index: 1;
}
.ar-container :deep(a-scene) { width: 100% !important; height: 100% !important; }

/* 纯相机模式：raw video 覆盖在 A-Frame 上层 */
.raw-camera {
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 2;
  object-fit: cover;
  pointer-events: none;
}

/* ---- 纯相机模式提示 ---- */
.camera-hint {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10;
  text-align: center;
  pointer-events: none;
}
.hint-icon { font-size: 56px; margin-bottom: 12px; }
.hint-text { font-size: 20px; font-weight: 700; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }
.hint-sub { margin-top: 8px; font-size: 14px; color: rgba(255,255,255,0.7); text-shadow: 0 1px 4px rgba(0,0,0,0.7); }

/* ---- 开始界面 ---- */
.start-overlay {
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%; z-index: 100;
  display: flex; align-items: center; justify-content: center;
  background: #0f172a;
  padding: 24px;
}
.start-card {
  text-align: center;
  max-width: 360px;
}
.start-icon { font-size: 64px; margin-bottom: 16px; }
.start-title { font-size: 28px; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
.start-desc { margin-top: 12px; font-size: 15px; color: #94a3b8; line-height: 1.5; }
.start-btn {
  margin-top: 32px;
  padding: 16px 48px;
  font-size: 18px; font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  border: none; border-radius: 16px;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  box-shadow: 0 4px 20px rgba(99,102,241,0.4);
  -webkit-tap-highlight-color: transparent;
}
.start-btn:active { transform: scale(0.96); box-shadow: 0 2px 10px rgba(99,102,241,0.3); }
.start-warn { margin-top: 20px; font-size: 12px; color: #f59e0b; }

/* ---- 安全警告 ---- */
.security-warning {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 100; text-align: center;
  background: rgba(239,68,68,0.95); color: #fff;
  padding: 24px; border-radius: var(--radius-lg);
  max-width: 90vw;
}
.warning-sub { font-size: var(--font-sm); margin-top: 8px; opacity: 0.85; }

/* ---- 加载中 ---- */
.loading-overlay {
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%; z-index: 100;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  background: var(--bg-primary); gap: 20px;
}
.loading-spinner {
  width: 40px; height: 40px;
  border: 3px solid rgba(255,255,255,0.15);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: var(--font-base); color: var(--text-secondary); }

/* ---- 错误 ---- */
.error-overlay {
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%; z-index: 100;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  background: var(--bg-primary);
  padding: 24px; text-align: center; gap: 12px;
}
.error-title { font-size: var(--font-xl); color: var(--text-primary); }
.error-detail { font-size: var(--font-sm); color: var(--text-muted); margin-bottom: 16px; }
.error-actions { display: flex; gap: 12px; }
</style>
