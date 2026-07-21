<!--
  HomeView.vue — 首页：图片采集 & 房间创建
  ============================================================================
  用户流程：
    1. 拍照或从相册选择一张图片
    2. 前端用 MindAR Compiler 编译为 .mind 特征文件
    3. 上传 .mind 文件到服务端，获得 roomId
    4. 跳转到 /ar/:roomId 进入 AR 协同场景

  移动端适配：
    - 全屏居中卡片式布局
    - 大号触摸友好的按钮
    - 编译进度条可见反馈
-->
<template>
  <div class="home">
    <!-- 顶部标题区 -->
    <header class="home-header">
      <h1 class="home-title">📷 WebAR 协同</h1>
      <p class="home-subtitle">拍照创建 AR 空间，多人实时协作</p>
    </header>

    <!-- 主内容区 -->
    <main class="home-main">
      <!-- 图片上传与编译组件 -->
      <ImageUploader
        :is-compiling="isCompiling"
        :compile-progress="compileProgress"
        :compile-error="compileError"
        :room-created="roomCreated"
        :room-id="roomId"
        :mind-url="mindUrl"
        @image-selected="handleImageSelected"
        @image-loaded="handleImageLoaded"
        @enter-ar="goToAR"
        @reset="resetState"
      />

      <!-- 编译进度条（编译中显示） -->
      <div v-if="isCompiling" class="progress-section">
        <div class="progress-bar">
          <div
            class="progress-fill"
            :style="{ width: (compileProgress * 100) + '%' }"
          ></div>
        </div>
        <p class="progress-text">
          正在分析图片特征... {{ Math.round(compileProgress * 100) }}%
        </p>
        <p class="progress-hint">请保持浏览器在前台，编译约需 2-5 秒</p>
      </div>

      <!-- 编译错误提示 -->
      <div v-if="compileError" class="error-section">
        <p class="error-text">❌ {{ compileError }}</p>
        <button class="btn btn-primary" @click="resetState">重新选择图片</button>
      </div>
    </main>

    <!-- 底部提示 -->
    <footer class="home-footer">
      <p class="footer-text">
        ⚠️ 手机端测试请使用 HTTPS 或 localhost
      </p>
      <p class="footer-text footer-hint">
        WebXR 要求安全上下文才能调用摄像头
      </p>
    </footer>
  </div>
</template>

<script setup>
/**
 * HomeView 逻辑：
 *   1. 接收 ImageUploader 的图片选择事件
 *   2. 调用 useMindAR.compileImage() 编译图片
 *   3. 上传 .mind 文件到服务端
 *   4. 拿到 roomId 后引导用户进入 AR 场景
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMindAR } from '../composables/useMindAR.js'
import { API_BASE } from '../config.js'
import ImageUploader from '../components/ImageUploader.vue'

const router = useRouter()
const { compileImage, compileProgress, isCompiling, compileError } = useMindAR()

// ---------------------------------------------------------------------------
// 本地状态
// ---------------------------------------------------------------------------

/** 上传的原始图片文件（用于后续上传缩略图） */
const selectedImageFile = ref(null)

/** 用户选择的图片的 HTMLImageElement（用于编译器输入） */
const imageElement = ref(null)

/** 编译得到的 .mind 文件 Blob */
const mindBlob = ref(null)

/** 房间是否已创建成功 */
const roomCreated = ref(false)

/** 房间 ID */
const roomId = ref('')

/** .mind 文件在服务端的 URL */
const mindUrl = ref('')

// ---------------------------------------------------------------------------
// 事件处理
// ---------------------------------------------------------------------------

/**
 * 用户选择了图片文件
 * @param {File} file - 图片文件
 */
function handleImageSelected(file) {
  selectedImageFile.value = file
  console.log('[HomeView] 图片已选择:', file.name, `(${(file.size / 1024).toFixed(1)} KB)`)
}

/**
 * 图片加载完成（已创建 HTMLImageElement）
 * 接下来执行编译流程
 * @param {HTMLImageElement} img - 加载好的图片元素
 */
async function handleImageLoaded(img) {
  imageElement.value = img

  try {
    // 第一步：客户端编译
    const result = await compileImage(img)
    mindBlob.value = result.mindBlob

    // 第二步：上传 .mind 文件到服务端
    await uploadMindFile(result.mindBlob)
  } catch (err) {
    console.error('[HomeView] 处理失败:', err)
    // compileError 已被 useMindAR 设置，这里不需要额外处理
  }
}

/**
 * 上传 .mind 编译文件到服务端
 * @param {Blob} blob - .mind 文件 Blob
 */
async function uploadMindFile(blob) {
  const formData = new FormData()
  formData.append('mind', blob, 'target.mind')

  // 先请求创建房间（获得 roomId），再上传 .mind 文件
  // 简化流程：先上传图片获取 roomId，然后上传 .mind 关联
  if (selectedImageFile.value) {
    formData.append('image', selectedImageFile.value)
  }

  // 如果没有 roomId，先上传图片获取
  if (!roomId.value) {
    const imgFormData = new FormData()
    imgFormData.append('image', selectedImageFile.value)
    const imgRes = await fetch(`${API_BASE}/api/targets/image`, {
      method: 'POST',
      body: imgFormData,
    })
    const imgData = await imgRes.json()
    if (!imgData.success) {
      throw new Error(imgData.error || '图片上传失败')
    }
    roomId.value = imgData.roomId
  }

  // 关联 roomId 上传 .mind 文件
  formData.append('roomId', roomId.value)

  const res = await fetch(`${API_BASE}/api/targets/mind`, {
    method: 'POST',
    body: formData,
  })

  const data = await res.json()
  if (!data.success) {
    throw new Error(data.error || '.mind 文件上传失败')
  }

  mindUrl.value = data.mindUrl
  roomId.value = data.roomId
  roomCreated.value = true

  console.log('[HomeView] 房间创建成功:', {
    roomId: roomId.value,
    mindUrl: mindUrl.value,
  })
}

/**
 * 跳转到 AR 场景页面
 */
function goToAR() {
  if (!roomId.value || !mindUrl.value) {
    console.warn('[HomeView] 房间未就绪，无法进入 AR')
    return
  }

  // 通过 query 参数传递 mindUrl，避免 ARView 再次请求
  router.push({
    name: 'AR',
    params: { roomId: roomId.value },
    query: { mindUrl: mindUrl.value },
  })
}

/**
 * 重置所有状态（重新选择图片）
 */
function resetState() {
  selectedImageFile.value = null
  imageElement.value = null
  mindBlob.value = null
  roomCreated.value = false
  roomId.value = ''
  mindUrl.value = ''
  // compileProgress 和 compileError 由 useMindAR 内部管理，
  // 这里需要显式重置
  isCompiling.value = false
  compileError.value = null
}
</script>

<style scoped>
/* =========================================================================
   HomeView 样式 — 移动端优先的居中式卡片布局
   ========================================================================= */

.home {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* ---- 标题区 ---- */
.home-header {
  text-align: center;
  padding: clamp(24px, 6vh, 48px) 16px 16px;
}

.home-title {
  font-size: var(--font-2xl);
  font-weight: 800;
  letter-spacing: -0.5px;
}

.home-subtitle {
  margin-top: 8px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

/* ---- 主内容区 ---- */
.home-main {
  flex: 1;
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ---- 进度条 ---- */
.progress-section {
  padding: 0 4px;
}

.progress-bar {
  width: 100%;
  height: 6px;
  background: var(--bg-secondary);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), #818cf8);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-text {
  margin-top: 8px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.progress-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

/* ---- 错误提示 ---- */
.error-section {
  text-align: center;
  padding: 16px;
}

.error-text {
  color: var(--color-danger);
  font-size: var(--font-sm);
  margin-bottom: 12px;
}

/* ---- 底部 ---- */
.home-footer {
  text-align: center;
  padding: 16px;
}

.footer-text {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

.footer-hint {
  color: var(--text-muted);
  opacity: 0.6;
}
</style>
