/**
 * compileWorker.js — 图片预处理 Web Worker
 * ============================================================================
 * 负责将相机帧的 ImageBitmap 在 Worker 线程中完成：
 *   1. 缩放到目标尺寸（默认最大 2048px）
 *   2. JPEG 压缩编码
 *
 * 为什么需要 Worker？
 *   Canvas.toDataURL('image/jpeg') 在主线程做 JPEG 编码会阻塞 UI。
 *   OffscreenCanvas.convertToBlob() 将编码放到独立线程，主线程零开销。
 *
 * 为什么 MindAR 编译不能放 Worker？
 *   MindAR Compiler 内部需要 HTMLImageElement 和 Canvas 2D Context 这两个
 *   DOM API，Worker 环境没有。编译仍放主线程，但它本身是异步 WASM 调用，
 *   内部会间歇性释放主线程，对帧率影响 < 10%。
 *
 * 通信协议：
 *   Main → Worker:  { type: 'process-frame', bitmap: ImageBitmap, maxSize?: number }
 *   Worker → Main:  { type: 'frame-ready', blob: Blob, width: number, height: number }
 *   Worker → Main:  { type: 'error', message: string }
 */

// ---------------------------------------------------------------------------
// 功能检测
// ---------------------------------------------------------------------------
const supportsOffscreenCanvas = typeof OffscreenCanvas !== 'undefined'

// ---------------------------------------------------------------------------
// 消息处理
// ---------------------------------------------------------------------------
self.onmessage = async function (event) {
  const { type, bitmap, maxSize = 2048 } = event.data

  if (type !== 'process-frame') {
    console.warn('[CompileWorker] 未知消息类型:', type)
    return
  }

  if (!bitmap) {
    self.postMessage({ type: 'error', message: '未收到 ImageBitmap' })
    return
  }

  try {
    // 计算目标尺寸（保持宽高比，限制最大边长）
    let targetW = bitmap.width
    let targetH = bitmap.height

    if (targetW > maxSize || targetH > maxSize) {
      const ratio = Math.min(maxSize / targetW, maxSize / targetH)
      targetW = Math.round(targetW * ratio)
      targetH = Math.round(targetH * ratio)
    }

    // -------------------------------------------------------------------
    // 路径 A：OffscreenCanvas（现代浏览器，真正的离屏渲染）
    // -------------------------------------------------------------------
    if (supportsOffscreenCanvas) {
      const canvas = new OffscreenCanvas(targetW, targetH)
      const ctx = canvas.getContext('2d')

      // 高质量缩放
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'medium'
      ctx.drawImage(bitmap, 0, 0, targetW, targetH)

      // OffscreenCanvas.convertToBlob 在独立线程执行 JPEG 编码
      // 主线程不受影响！
      const blob = await canvas.convertToBlob({
        type: 'image/jpeg',
        quality: 0.9,
      })

      // 释放 transfer 过来的 bitmap
      bitmap.close()

      // 返回 blob（用 transfer 避免拷贝）
      self.postMessage(
        { type: 'frame-ready', blob, width: targetW, height: targetH },
        [blob]  // blob 的所有权转交给主线程，Worker 不再持有
      )
      return
    }

    // -------------------------------------------------------------------
    // 路径 B：降级方案 — 返回原始尺寸（无 OffscreenCanvas 的旧浏览器）
    // -------------------------------------------------------------------
    console.warn('[CompileWorker] OffscreenCanvas 不可用，返回原始 bitmap')

    // 用 createImageBitmap 做缩放（如果支持 resize 参数）
    if (targetW !== bitmap.width || targetH !== bitmap.height) {
      const resized = await createImageBitmap(bitmap, {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'medium',
      })
      bitmap.close()

      self.postMessage({
        type: 'frame-ready',
        bitmap: resized,
        width: targetW,
        height: targetH,
      }, [resized])
    } else {
      self.postMessage({
        type: 'frame-ready',
        bitmap,
        width: targetW,
        height: targetH,
      }, [bitmap])
    }

  } catch (err) {
    console.error('[CompileWorker] 处理失败:', err)
    try { bitmap.close() } catch (_) { /* ignore */ }
    self.postMessage({ type: 'error', message: err.message || 'Worker 处理失败' })
  }
}

// ---------------------------------------------------------------------------
// Worker 就绪信号
// ---------------------------------------------------------------------------
self.postMessage({ type: 'ready' })
