<!--
  ImageUploader.vue — 图片采集 + 裁剪组件
  ============================================================================
  流程：
    1. 拍照或从相册选择图片
    2. Cropper.js 裁剪感兴趣区域（AR 触发目标）
    3. 确认后触发 MindAR 编译流程
-->
<template>
  <div class="uploader">
    <!-- ================================================================= -->
    <!-- 状态 1：未选择图片 -->
    <!-- ================================================================= -->
    <div v-if="!imageSrc" class="uploader-empty">
      <div class="uploader-icon">📸</div>
      <p class="uploader-hint">拍摄或选择一张图片作为 AR 触发目标</p>
      <p class="uploader-detail">
        建议选择纹理丰富、特征明显的图片<br />
        例如：海报、Logo、包装盒图案
      </p>

      <div class="uploader-actions">
        <label class="btn btn-primary upload-btn">
          <input type="file" accept="image/*" capture="environment"
            class="file-input" @change="onFileChange" />
          📷 拍照
        </label>

        <label class="btn btn-ghost upload-btn">
          <input type="file" accept="image/*"
            class="file-input" @change="onFileChange" />
          🖼️ 从相册选择
        </label>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- 状态 2：裁剪模式 — 用户调整裁剪区域 -->
    <!-- ================================================================= -->
    <div v-else-if="cropMode" class="uploader-preview">
      <div class="crop-wrapper">
        <img ref="cropImgRef" :src="imageSrc" alt="裁剪图片" class="crop-image" />
      </div>
      <div class="preview-actions">
        <p class="crop-hint">👆 拖动调整裁剪区域，框选出 AR 触发目标</p>
        <button class="btn btn-primary" style="width:100%" @click="confirmCrop">
          ✂️ 确认裁剪
        </button>
        <button class="btn btn-ghost" @click="resetImage">
          ↩ 重选图片
        </button>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- 状态 3：裁剪完成 / 处理中 / 结果 -->
    <!-- ================================================================= -->
    <div v-else class="uploader-preview">
      <!-- 裁剪后的预览图 -->
      <div class="preview-image-wrapper">
        <img :src="croppedSrc || imageSrc" alt="AR 触发图片预览" class="preview-image" />
      </div>

      <!-- 处理中 -->
      <div v-if="isCompiling || isUploading" class="preview-actions">
        <div class="processing-status">
          <span class="spinner"></span>
          <span class="processing-label">{{ statusMessage || '处理中...' }}</span>
        </div>
        <div v-if="isCompiling" class="compile-progress-bar">
          <div class="compile-progress-fill" :style="{ width: (compileProgress * 100) + '%' }"></div>
        </div>
        <p v-if="isCompiling" class="compile-progress-text">
          分析图片特征 {{ Math.round(compileProgress * 100) }}%
        </p>
        <p v-else class="compile-progress-text">☁️ 上传编译结果到服务器...</p>
      </div>

      <!-- 失败 -->
      <div v-else-if="compileError" class="preview-actions">
        <p class="upload-error-text">❌ {{ compileError }}</p>
        <button class="btn btn-ghost" @click="resetImage">↩ 重新选择图片</button>
      </div>

      <!-- 成功 -->
      <div v-else-if="roomCreated" class="preview-actions">
        <button class="btn btn-primary enter-ar-btn" @click="$emit('enter-ar')">
          🚀 进入 AR 空间
          <span v-if="autoEnterCountdown > 0" class="countdown-badge">{{ autoEnterCountdown }}s</span>
        </button>
        <p v-if="autoEnterCountdown > 0" class="auto-enter-hint">{{ autoEnterCountdown }} 秒后自动进入...</p>
        <p class="room-id-display">房间号: <strong>{{ roomId }}</strong></p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import Cropper from 'cropperjs'

// ---------------------------------------------------------------------------
// Props & Emits
// ---------------------------------------------------------------------------
const props = defineProps({
  isCompiling: { type: Boolean, default: false },
  isUploading: { type: Boolean, default: false },
  compileProgress: { type: Number, default: 0 },
  compileError: { type: String, default: null },
  roomCreated: { type: Boolean, default: false },
  roomId: { type: String, default: '' },
  mindUrl: { type: String, default: '' },
  autoEnterCountdown: { type: Number, default: 0 },
  statusMessage: { type: String, default: '' },
})

const emit = defineEmits([
  'image-selected',
  'image-loaded',
  'image-blob-ready',
  'enter-ar',
  'reset',
])

// ---------------------------------------------------------------------------
// 本地状态
// ---------------------------------------------------------------------------
const imageSrc = ref(null)
const croppedSrc = ref(null)
const cropMode = ref(false)
const cropImgRef = ref(null)
let cropperInstance = null

// ---------------------------------------------------------------------------
// 方法
// ---------------------------------------------------------------------------

function onFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    alert('请选择图片文件')
    return
  }

  emit('image-selected', file)

  const reader = new FileReader()
  reader.onload = (e) => {
    imageSrc.value = e.target.result
    cropMode.value = true
    // 等 Vue 渲染完 + 图片加载完再初始化 Cropper
    nextTick(() => {
      if (cropImgRef.value) {
        // 图片可能已加载，也可能还没 —— Cropper 2 会自动处理
        initCropper()
      }
    })
  }
  reader.readAsDataURL(file)
}

function initCropper() {
  if (!cropImgRef.value) return
  if (cropperInstance) {
    cropperInstance.destroy()
    cropperInstance = null
  }
  try {
    cropperInstance = new Cropper(cropImgRef.value, {
      aspectRatio: 1,
      viewMode: 1,
      autoCropArea: 0.8,
      movable: true,
      zoomable: true,
      responsive: true,
      guides: true,
      background: false,
      ready() {
        console.log('[Cropper] 裁剪器已就绪')
      },
    })
  } catch (err) {
    console.error('[Cropper] 初始化失败:', err)
    // 裁剪失败，跳过裁剪直接编译原图
    skipCrop()
  }
}

function skipCrop() {
  // 清理 cropper
  if (cropperInstance) {
    cropperInstance.destroy()
    cropperInstance = null
  }
  // 不裁剪，直接用原图编译
  cropMode.value = false
  const img = new Image()
  img.onload = () => {
    emit('image-loaded', img)
    // 从原图生成 Blob，保持合理分辨率用于上传
    canvasToBlob(img, img.naturalWidth, img.naturalHeight).then(blob => {
      emit('image-blob-ready', blob)
    })
  }
  img.src = imageSrc.value
}

function confirmCrop() {
  if (!cropperInstance) {
    skipCrop()
    return
  }

  try {
    // 获取裁剪区域在原始图片上的实际尺寸
    const cropData = cropperInstance.getData()
    const cropW = Math.round(cropData.width)
    const cropH = Math.round(cropData.height)

    // 计算合理的输出分辨率：最大 2048px，不放大，保持清晰度
    const MAX_SIZE = 2048
    let outW = Math.min(cropW, MAX_SIZE)
    let outH = Math.min(cropH, MAX_SIZE)

    const canvas = cropperInstance.getCroppedCanvas({
      width: outW,
      height: outH,
    })

    if (!canvas) {
      console.warn('[Cropper] getCroppedCanvas 返回空，使用原图')
      skipCrop()
      return
    }

    console.log(`[ImageUploader] 裁剪输出: ${outW}x${outH} (原始区域: ${cropW}x${cropH})`)

    croppedSrc.value = canvas.toDataURL('image/jpeg', 0.92)
    cropMode.value = false

    cropperInstance.destroy()
    cropperInstance = null

    const img = new Image()
    img.onload = () => {
      console.log('[ImageUploader] 裁剪后图片已就绪:', img.width, 'x', img.height)
      emit('image-loaded', img)
    }
    img.onerror = () => {
      console.warn('[ImageUploader] 裁剪图片加载失败，使用原图')
      skipCrop()
    }
    img.src = croppedSrc.value

    // 生成 Blob 用于上传（替换原始文件）
    canvasToBlob(canvas).then(blob => {
      emit('image-blob-ready', blob)
    })
  } catch (err) {
    console.error('[Cropper] 裁剪失败:', err)
    skipCrop()
  }
}

/**
 * 将 img/canvas 转为 JPEG Blob，保证输出分辨率可控
 * @param {HTMLImageElement|HTMLCanvasElement} source
 * @param {number} [maxWidth] - 输出最大宽度
 * @param {number} [maxHeight] - 输出最大高度
 * @param {number} [quality=0.92] - JPEG 质量
 * @returns {Promise<Blob>}
 */
function canvasToBlob(source, maxWidth, maxHeight, quality = 0.92) {
  return new Promise((resolve, reject) => {
    let w = source.naturalWidth || source.width
    let h = source.naturalHeight || source.height

    // 如果指定了最大尺寸且源图更大，等比缩放
    if (maxWidth && w > maxWidth) {
      const ratio = maxWidth / w
      w = maxWidth
      h = Math.round(h * ratio)
    }
    if (maxHeight && h > maxHeight) {
      const ratio = maxHeight / h
      h = maxHeight
      w = Math.round(w * ratio)
    }

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(source, 0, 0, w, h)
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('canvas.toBlob 失败'))
      },
      'image/jpeg',
      quality
    )
  })
}

function resetImage() {
  if (cropperInstance) {
    cropperInstance.destroy()
    cropperInstance = null
  }
  imageSrc.value = null
  croppedSrc.value = null
  cropMode.value = false
  emit('reset')
}
</script>

<style scoped>
.uploader { width: 100%; }

/* ---- 空状态 ---- */
.uploader-empty {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: clamp(24px, 6vh, 48px) 16px;
  background: var(--bg-card); border-radius: var(--radius-lg);
  border: 2px dashed rgba(255, 255, 255, 0.1);
}
.uploader-icon { font-size: clamp(48px, 12vw, 64px); margin-bottom: 16px; }
.uploader-hint { font-size: var(--font-base); color: var(--text-primary); font-weight: 600; margin-bottom: 8px; }
.uploader-detail { font-size: var(--font-sm); color: var(--text-muted); line-height: 1.6; margin-bottom: 24px; }
.uploader-actions { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 280px; }
.upload-btn { position: relative; width: 100%; cursor: pointer; }
.file-input { position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }

/* ---- 裁剪模式 ---- */
.uploader-preview { background: var(--bg-card); border-radius: var(--radius-lg); overflow: hidden; }
.crop-wrapper { width: 100%; max-height: 60vh; background: #000; }
.crop-image { max-width: 100%; display: block; }
.crop-hint { font-size: var(--font-sm); color: var(--text-secondary); text-align: center; margin-bottom: 4px; }

/* ---- 预览 ---- */
.preview-image-wrapper {
  width: 100%; aspect-ratio: 1 / 1;
  display: flex; align-items: center; justify-content: center;
  background: #000; overflow: hidden;
}
.preview-image { max-width: 100%; max-height: 100%; object-fit: contain; }

.preview-actions { padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 10px; }

.enter-ar-btn { width: 100%; font-size: var(--font-lg); padding: 14px 24px; position: relative; }
.countdown-badge {
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: 8px; width: 28px; height: 28px;
  background: rgba(255,255,255,0.2); border-radius: 50%;
  font-size: 13px; font-weight: 700; animation: pulse-badge 1s ease-in-out infinite;
}
@keyframes pulse-badge { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }
.auto-enter-hint { font-size: 12px; color: var(--text-muted); margin-top: -4px; }
.room-id-display { font-size: var(--font-sm); color: var(--text-secondary); }
.room-id-display strong { color: var(--color-primary); font-family: monospace; letter-spacing: 1px; }

/* ---- 进度条 ---- */
.compile-progress-bar {
  width: 100%; height: 6px; background: rgba(255,255,255,0.1);
  border-radius: 3px; overflow: hidden; margin-top: 4px;
}
.compile-progress-fill {
  height: 100%; background: linear-gradient(90deg, var(--color-primary), #818cf8);
  border-radius: 3px; transition: width 0.3s ease;
}
.compile-progress-text { font-size: 12px; color: var(--text-muted); text-align: center; }
.upload-error-text {
  color: var(--color-danger); font-size: var(--font-sm); text-align: center;
  padding: 8px 12px; background: rgba(239,68,68,0.1); border-radius: var(--radius-md);
  max-width: 100%; word-break: break-word;
}
.processing-status { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
.processing-label { font-size: var(--font-base); color: var(--text-primary); font-weight: 600; }

.spinner {
  display: inline-block; width: 16px; height: 16px;
  border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
  border-radius: 50%; animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
