<!--
  ARView.vue — AR 场景页面：A-Frame 摄像头 + DOM Overlay 协同层
  ============================================================================
  页面结构（从底到顶的 z-index 层级）：
    1. ARScene（A-Frame canvas，摄像头画面+3D追踪）—— z-index: 1
    2. DOMOverlay（协同 UI 覆盖层，包含所有用户元素）—— z-index: 10
    3. EditorToolbar（固定底部编辑工具栏）—— z-index: 20
    4. UserPresence（在线用户指示器）—— z-index: 15

  生命周期：
    onMounted   → 创建 AR 场景 → 加入 Socket.IO 房间 → 注册协同监听
    onBeforeUnmount → 注销监听 → 离开房间 → 销毁 AR 场景

  移动端适配：
    - 全屏 fixed 布局
    - 安全区适配（刘海屏/底部横条）
-->
<template>
  <div class="ar-view">
    <!--
      【重要】非 HTTPS / 非 localhost 警告
      WebXR 和 getUserMedia 必须在安全上下文下运行
    -->
    <div v-if="!isSecureContext" class="security-warning">
      <p>⚠️ 当前不是安全上下文（HTTPS / localhost）</p>
      <p class="warning-sub">摄像头和 AR 功能将无法使用</p>
    </div>

    <!-- AR 场景容器 — A-Frame 将命令式挂载到此 div 内部 -->
    <div
      id="ar-container"
      class="ar-container"
      ref="arContainerRef"
    ></div>

    <!--
      DOM Overlay 协同层
      当 targetDetected 为 true 时可见
      transition: opacity 300ms 平滑过渡
    -->
    <DOMOverlay
      v-if="sceneReady"
      :visible="targetDetected"
      @toast="showToast"
    />

    <!-- 隐藏文件选择器（拍照 fallback） -->
    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      capture="environment"
      class="hidden-input"
      @change="handleFileSelected"
    />

    <!-- 底部编辑工具栏（始终可见，方便检测到目标后立即编辑） -->
    <EditorToolbar
      v-if="sceneReady"
      :visible="targetDetected"
      :is-capturing="isCapturing"
      @capture="handleCapture"
    />

    <!-- 在线用户指示器 -->
    <UserPresence
      v-if="sceneReady"
    />

    <!-- 场景加载中的遮罩 -->
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
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast"
      >
        {{ toast.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
/**
 * ARView 核心逻辑：
 *   1. 从路由参数中获取 roomId 和 mindUrl
 *   2. 创建 MindAR AR 场景
 *   3. 加入 Socket.IO 协同房间
 *   4. 管理 AR 全生命周期
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMindAR } from '../composables/useMindAR.js'
import { useSocket } from '../composables/useSocket.js'
import { useCollaboration } from '../composables/useCollaboration.js'
import { API_BASE } from '../config.js'
import DOMOverlay from '../components/DOMOverlay.vue'
import EditorToolbar from '../components/EditorToolbar.vue'
import UserPresence from '../components/UserPresence.vue'

const route = useRoute()
const router = useRouter()
const {
  createARScene, destroyARScene, targetDetected, cameraReady,
  compileImage, compileProgress, isCompiling, compileError,
  captureCameraFrame,
} = useMindAR()
const { connected } = useSocket()
const { joinRoom, leaveRoom, registerListeners, unregisterListeners } = useCollaboration()

// ---------------------------------------------------------------------------
// 路由参数
// ---------------------------------------------------------------------------
const roomId = route.params.roomId
const mindUrl = route.query.mindUrl

// ---------------------------------------------------------------------------
// 本地状态
// ---------------------------------------------------------------------------

/** AR 场景是否已就绪 */
const sceneReady = ref(false)

/** 场景加载错误信息（null 表示无错误） */
const sceneError = ref(null)

/** 加载中的提示文案 */
const loadingMessage = ref('正在初始化 AR 场景...')

/** 是否为安全上下文 */
const isSecureContext = ref(
  window.isSecureContext || window.location.hostname === 'localhost'
)

/** AR 场景容器 DOM 引用 */
const arContainerRef = ref(null)

/** Toast 消息队列 */
const toasts = ref([])
let toastIdCounter = 0

// ---------------------------------------------------------------------------
// 拍照捕获（后台编译 + 上传，不暂停 AR 场景）
// ---------------------------------------------------------------------------

/** 是否正在拍照处理中 */
const isCapturing = ref(false)

/** 隐藏文件选择器引用（fallback 用） */
const fileInputRef = ref(null)

/**
 * 底部拍照按钮被点击
 * 优先从当前摄像头流直接抓帧（毫秒级，无停顿），失败时 fallback 到文件选择器
 */
async function handleCapture() {
  if (isCapturing.value) return

  // 尝试从摄像头实时流抓帧
  const frame = captureCameraFrame()
  if (frame) {
    await processCapturedImage(frame)
    return
  }

  // Fallback：摄像头流不可用，打开文件选择器
  console.log('[ARView] 摄像头帧不可用，使用文件选择器')
  fileInputRef.value?.click()
}

/**
 * 文件选择器选择完毕
 */
async function handleFileSelected(event) {
  const file = event.target.files?.[0]
  if (!file) return

  const img = new Image()
  const reader = new FileReader()
  reader.onload = async (e) => {
    img.src = e.target.result
    await new Promise(r => { img.onload = r })
    await processCapturedImage(img)
  }
  reader.readAsDataURL(file)
  // 重置 input，允许重复选同一个文件
  event.target.value = ''
}

/**
 * 后台处理：编译 + 上传，不阻塞 AR 场景
 * @param {HTMLImageElement|HTMLCanvasElement} source - 图片源
 */
async function processCapturedImage(source) {
  isCapturing.value = true
  showToast('📷 正在分析图片特征...', 0)

  try {
    // 第一步：编译
    const result = await compileImage(source)
    const mindBlob = result.mindBlob

    // 第二步：上传图片 + .mind 文件
    showToast('☁️ 正在上传...', 0)
    const roomId = await uploadCapturedMind(mindBlob, source)

    // 成功
    // 清除之前的持久 toast
    toasts.value = toasts.value.filter(t => t.message.includes('分析') || t.message.includes('上传'))
    showToast(`✅ 新参照物就绪！房间号: ${roomId}`, 3500)
    console.log('[ARView] 新参照物创建成功, roomId:', roomId)

  } catch (err) {
    console.error('[ARView] 拍照处理失败:', err)
    toasts.value = toasts.value.filter(t => t.message.includes('分析') || t.message.includes('上传'))
    showToast(`❌ 处理失败: ${err.message}`, 3000)
  } finally {
    isCapturing.value = false
  }
}

/**
 * 上传编译后的 .mind 和图片到服务器
 */
async function uploadCapturedMind(mindBlob, source) {
  // 将 source 转为 Blob
  let imageBlob
  if (source instanceof HTMLCanvasElement) {
    imageBlob = await new Promise((resolve, reject) => {
      source.toBlob(b => b ? resolve(b) : reject(new Error('canvas toBlob 失败')), 'image/jpeg', 0.92)
    })
  } else {
    imageBlob = await new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      const maxSize = 2048
      let w = source.naturalWidth, h = source.naturalHeight
      if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize }
      if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize }
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(source, 0, 0, w, h)
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas toBlob 失败')), 'image/jpeg', 0.92)
    })
  }

  // 先上传图片获取 roomId
  const imgForm = new FormData()
  imgForm.append('image', imageBlob, 'capture.jpg')
  const imgRes = await fetch(`${API_BASE}/api/targets/image`, { method: 'POST', body: imgForm })
  const imgData = await imgRes.json()
  if (!imgData.success) throw new Error(imgData.error || '图片上传失败')

  // 上传 .mind 关联房间
  const mindForm = new FormData()
  mindForm.append('mind', mindBlob, 'target.mind')
  mindForm.append('image', imageBlob, 'capture.jpg')
  mindForm.append('roomId', imgData.roomId)
  const mindRes = await fetch(`${API_BASE}/api/targets/mind`, { method: 'POST', body: mindForm })
  const mindData = await mindRes.json()
  if (!mindData.success) throw new Error(mindData.error || '.mind 上传失败')

  return imgData.roomId
}

// ---------------------------------------------------------------------------
// Toast 工具函数
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

// ---------------------------------------------------------------------------
// 初始化 & 销毁
// ---------------------------------------------------------------------------

onMounted(async () => {
  // 校验必需参数
  if (!roomId || !mindUrl) {
    sceneError.value = '缺少房间 ID 或目标文件 URL。请返回首页重新创建。'
    return
  }

  // 校验安全上下文
  if (!isSecureContext.value) {
    sceneError.value = '当前环境不是安全上下文。请使用 HTTPS 或 localhost 访问。'
    return
  }

  try {
    loadingMessage.value = '正在启动摄像头...'

    // 第一步：创建 AR 场景（A-Frame + MindAR）
    // 这会激活摄像头并开始图像追踪
    await createARScene('ar-container', mindUrl)

    loadingMessage.value = '正在建立连接...'

    // 第二步：注册协同事件监听器（必须在 join-room 之前注册，
    // 否则可能错过 room-state 事件）
    registerListeners()

    // 第三步：等待 Socket 连接成功后加入房间
    if (connected.value) {
      joinRoom(roomId)
    }

    // 持续监听连接状态：断线重连后自动重新加入房间
    let wasConnected = connected.value
    watch(connected, (isConnected) => {
      if (isConnected && !wasConnected) {
        console.log('[ARView] Socket 已重连，重新加入房间')
        registerListeners()
        joinRoom(roomId)
      }
      wasConnected = isConnected
    })

    sceneReady.value = true
    console.log('[ARView] AR 场景初始化完成')

  } catch (err) {
    console.error('[ARView] AR 场景初始化失败:', err)
    sceneError.value = err.message || '未知错误'
  }
})

onBeforeUnmount(() => {
  // 按相反顺序清理资源
  unregisterListeners()  // 先注销 Socket 监听
  leaveRoom()            // 通知服务端离开房间
  destroyARScene()       // 销毁 A-Frame 场景（释放摄像头和 WebGL 资源）
  sceneReady.value = false
})

// ---------------------------------------------------------------------------
// 方法
// ---------------------------------------------------------------------------

/** 重试初始化 */
function retryInit() {
  sceneError.value = null
  sceneReady.value = false
  // 重新触发 onMounted 逻辑（通过 key 强制重建）
  // 简化处理：重新加载页面
  window.location.reload()
}

/** 返回首页 */
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

/* ---- AR 场景容器（A-Frame canvas 渲染在此） ---- */
.ar-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

/* A-Frame 的 <a-scene> 需要撑满容器 */
.ar-container :deep(a-scene) {
  width: 100% !important;
  height: 100% !important;
}

/* ---- 隐藏文件选择器 ---- */
.hidden-input {
  position: fixed;
  top: -9999px;
  left: -9999px;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
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
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  gap: 20px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.15);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: var(--font-base);
  color: var(--text-secondary);
}

/* ---- 错误 ---- */
.error-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
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

.error-title {
  font-size: var(--font-xl);
  color: var(--text-primary);
}

.error-detail {
  font-size: var(--font-sm);
  color: var(--text-muted);
  margin-bottom: 16px;
}

.error-actions {
  display: flex;
  gap: 12px;
}
</style>
