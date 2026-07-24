<!--
  ImageUploader.vue — 图片采集组件
  ============================================================================
  流程：
    1. 拍照或从相册选择图片
    2. 自动加载并触发 MindAR 编译流程
    3. 显示编译进度 / 结果
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
    <!-- 状态 2：已选图 — 预览 + 处理中 / 错误 / 成功 -->
    <!-- ================================================================= -->
    <div v-else class="uploader-preview">
      <div class="preview-image-wrapper">
        <img :src="imageSrc" alt="AR 触发图片预览" class="preview-image" />
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

      <!-- 已选图但还没开始处理时的重选按钮 -->
      <div v-else class="preview-actions">
        <button class="btn btn-ghost" @click="resetImage">↩ 重新选择图片</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

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
const imageSrc = ref(null)   // dataURL，用于预览

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

    // 加载图片，控制分辨率后发射
    const img = new Image()
    img.onload = () => {
      emit('image-loaded', img)
      // 生成分辨率受控的 Blob（最大 2048px，用于上传）
      canvasToBlob(img, 2048, 2048).then(blob => {
        emit('image-blob-ready', blob)
      })
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

/**
 * 将 img 转为 JPEG Blob，输出分辨率可控
 */
function canvasToBlob(source, maxWidth, maxHeight, quality = 0.92) {
  return new Promise((resolve, reject) => {
    let w = source.naturalWidth || source.width
    let h = source.naturalHeight || source.height

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
  imageSrc.value = null
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

/* ---- 预览 ---- */
.uploader-preview { background: var(--bg-card); border-radius: var(--radius-lg); overflow: hidden; }
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
