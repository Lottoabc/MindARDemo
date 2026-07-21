<!--
  ImageUploader.vue — 图片采集组件
  ============================================================================
  功能：
    1. 提供摄像头拍照（capture="environment" 使用后置摄像头）
    2. 支持从相册选择图片
    3. 图片预览、确认或重新选择
    4. 触发编译流程（emit 给父组件 HomeView）

  移动端优化：
    - accept="image/*" 只显示图片文件
    - capture="environment" 在移动端直接打开后置摄像头
    - 大号触摸友好的按钮和预览区
-->
<template>
  <div class="uploader">
    <!-- 状态 1：未选择图片 — 显示拍照/选图入口 -->
    <div v-if="!imageSrc" class="uploader-empty">
      <div class="uploader-icon">📸</div>
      <p class="uploader-hint">拍摄或选择一张图片作为 AR 触发目标</p>
      <p class="uploader-detail">
        建议选择纹理丰富、特征明显的图片<br />
        例如：海报、Logo、包装盒图案
      </p>

      <div class="uploader-actions">
        <!-- 拍照按钮（移动端直接打开后置摄像头） -->
        <label class="btn btn-primary upload-btn">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            class="file-input"
            @change="onFileChange"
          />
          📷 拍照
        </label>

        <!-- 选图按钮（从相册选择） -->
        <label class="btn btn-ghost upload-btn">
          <input
            type="file"
            accept="image/*"
            class="file-input"
            @change="onFileChange"
          />
          🖼️ 从相册选择
        </label>
      </div>
    </div>

    <!-- 状态 2：已选择图片，预览 + 确认 -->
    <div v-else class="uploader-preview">
      <div class="preview-image-wrapper">
        <img
          ref="previewImgRef"
          :src="imageSrc"
          alt="AR 触发图片预览"
          class="preview-image"
          @load="onImageLoad"
        />
      </div>

      <!-- 编译中：显示 spinner + 进度条 -->
      <div v-if="isCompiling" class="preview-actions">
        <button class="btn btn-primary" disabled>
          <span class="spinner"></span>
          编译中...
        </button>
        <div class="compile-progress-bar">
          <div
            class="compile-progress-fill"
            :style="{ width: (compileProgress * 100) + '%' }"
          ></div>
        </div>
        <p class="compile-progress-text">
          正在分析图片特征... {{ Math.round(compileProgress * 100) }}%
        </p>
      </div>

      <!-- 编译/上传失败：显示错误 + 重试按钮 -->
      <div v-else-if="compileError" class="preview-actions">
        <p class="upload-error-text">❌ {{ compileError }}</p>
        <button class="btn btn-ghost" @click="resetImage">
          ↩ 重新选择图片
        </button>
      </div>

      <!-- 编译完成：显示"进入 AR"按钮 + 倒计时 -->
      <div v-else-if="roomCreated" class="preview-actions">
        <button class="btn btn-primary enter-ar-btn" @click="$emit('enter-ar')">
          🚀 进入 AR 空间
          <span v-if="autoEnterCountdown > 0" class="countdown-badge">
            {{ autoEnterCountdown }}s
          </span>
        </button>
        <p v-if="autoEnterCountdown > 0" class="auto-enter-hint">
          {{ autoEnterCountdown }} 秒后自动进入...
        </p>
        <p class="room-id-display">
          房间号: <strong>{{ roomId }}</strong>
        </p>
      </div>

      <!-- 已选图但未开始编译：显示确认按钮 -->
      <div v-else class="preview-actions">
        <button class="btn btn-ghost" @click="resetImage">
          ↩ 重选图片
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * ImageUploader 组件逻辑：
 *   1. file input 选择图片 → 读取为 data URL 预览
 *   2. 创建 HTMLImageElement 以备 MindAR Compiler 使用
 *   3. 图片加载完成后发射 image-loaded 事件（携带 img 元素）
 */
import { ref } from 'vue'

// ---------------------------------------------------------------------------
// Props & Emits
// ---------------------------------------------------------------------------

const props = defineProps({
  /** 是否正在编译中 */
  isCompiling: { type: Boolean, default: false },
  /** 编译进度 0~1 */
  compileProgress: { type: Number, default: 0 },
  /** 编译错误信息 */
  compileError: { type: String, default: null },
  /** 房间是否已创建 */
  roomCreated: { type: Boolean, default: false },
  /** 房间 ID */
  roomId: { type: String, default: '' },
  /** .mind 文件 URL */
  mindUrl: { type: String, default: '' },
  /** 自动进入 AR 倒计时（秒），0 表示不自动跳转 */
  autoEnterCountdown: { type: Number, default: 0 },
})

const emit = defineEmits([
  'image-selected',   // 用户选择了图片文件（携带 File 对象）
  'image-loaded',     // 图片 HTMLImageElement 已就绪（携带 img 元素）
  'enter-ar',         // 用户点击"进入 AR"
  'reset',            // 重置选择
])

// ---------------------------------------------------------------------------
// 本地状态
// ---------------------------------------------------------------------------

/** 图片 data URL（用于预览） */
const imageSrc = ref(null)

/** 预览图片的 DOM 引用 */
const previewImgRef = ref(null)

// ---------------------------------------------------------------------------
// 方法
// ---------------------------------------------------------------------------

/**
 * 文件选择回调
 * 读取文件为 data URL 用于预览，同时发射 image-selected 事件
 */
function onFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return

  // 验证文件类型
  if (!file.type.startsWith('image/')) {
    alert('请选择图片文件')
    return
  }

  // 通知父组件：图片已选择
  emit('image-selected', file)

  // 读取为 data URL 用于本地预览
  const reader = new FileReader()
  reader.onload = (e) => {
    imageSrc.value = e.target.result
  }
  reader.readAsDataURL(file)
}

/**
 * 预览图片加载完成回调
 * 此时可以安全地将 HTMLImageElement 传给 MindAR Compiler
 */
function onImageLoad() {
  if (previewImgRef.value) {
    console.log('[ImageUploader] 预览图片加载完成')
    emit('image-loaded', previewImgRef.value)
  }
}

/**
 * 重置图片选择
 */
function resetImage() {
  imageSrc.value = null
  emit('reset')
}
</script>

<style scoped>
/* =========================================================================
   ImageUploader 样式
   ========================================================================= */

.uploader {
  width: 100%;
}

/* ---- 空状态：未选择图片 ---- */
.uploader-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: clamp(24px, 6vh, 48px) 16px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  border: 2px dashed rgba(255, 255, 255, 0.1);
}

.uploader-icon {
  font-size: clamp(48px, 12vw, 64px);
  margin-bottom: 16px;
}

.uploader-hint {
  font-size: var(--font-base);
  color: var(--text-primary);
  font-weight: 600;
  margin-bottom: 8px;
}

.uploader-detail {
  font-size: var(--font-sm);
  color: var(--text-muted);
  line-height: 1.6;
  margin-bottom: 24px;
}

.uploader-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 280px;
}

.upload-btn {
  position: relative;
  width: 100%;
  cursor: pointer;
}

.file-input {
  /* 隐藏原生 file input，通过 label 触发 */
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

/* ---- 预览状态 ---- */
.uploader-preview {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.preview-image-wrapper {
  width: 100%;
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  overflow: hidden;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.preview-actions {
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.enter-ar-btn {
  width: 100%;
  font-size: var(--font-lg);
  padding: 14px 24px;
  position: relative;
}

.countdown-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 8px;
  width: 28px;
  height: 28px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  font-size: 13px;
  font-weight: 700;
  animation: pulse-badge 1s ease-in-out infinite;
}

@keyframes pulse-badge {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.auto-enter-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: -4px;
}

.room-id-display {
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.room-id-display strong {
  color: var(--color-primary);
  font-family: monospace;
  letter-spacing: 1px;
}

/* ---- 编译进度条 ---- */
.compile-progress-bar {
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
  margin-top: 4px;
}

.compile-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), #818cf8);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.compile-progress-text {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

/* ---- 上传错误提示 ---- */
.upload-error-text {
  color: var(--color-danger);
  font-size: var(--font-sm);
  text-align: center;
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: var(--radius-md);
  max-width: 100%;
  word-break: break-word;
}

/* ---- Loading spinner ---- */
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
