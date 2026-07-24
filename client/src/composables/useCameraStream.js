/**
 * useCameraStream.js — 独立摄像头流管理（与 MindAR WebGL 管线解耦）
 * ============================================================================
 * 核心原理：
 *   1. 在 MindAR/A-Frame 调用 getUserMedia 之前，拦截该 API
 *   2. 拿到摄像头流后，通过 MediaStreamTrack.clone() 克隆一份视频轨
 *   3. 原轨 → 返回给 A-Frame（用于 MindAR WebGL AR 追踪）
 *   4. 克隆轨 → 绑定到隐藏 <video> 元素（专用于 Canvas 截图）
 *
 * 两条轨道共享同一物理摄像头，但浏览器层面的解码 buffer 各自独立，
 * Canvas.drawImage() 不会与 WebGL texImage2D() 产生管线竞争。
 *
 * 使用方式：
 *   import { useCameraStream } from '../composables/useCameraStream.js'
 *   const { install, captureAsImage, captureFrame, destroy } = useCameraStream()
 *
 *   // 在 createARScene 之前调用：
 *   install()
 *   await createARScene(...)
 *   // 此后拍照不会干扰 AR 渲染
 */

export function useCameraStream() {
  // ---------------------------------------------------------------------------
  // 内部状态
  // ---------------------------------------------------------------------------

  /** 隐藏的 <video> 元素，绑定克隆流 */
  let captureVideoEl = null

  /** 原始 getUserMedia 引用（用于恢复） */
  let nativeGetUserMedia = null

  /** 是否已安装拦截器 */
  let installed = false

  // ---------------------------------------------------------------------------
  // 安装拦截器
  // ---------------------------------------------------------------------------

  /**
   * 拦截 navigator.mediaDevices.getUserMedia
   *
   * ⚠️ 必须在 createARScene() 之前调用！
   * A-Frame/MindAR 初始化时会调用 getUM 获取摄像头，
   * 拦截器在此期间克隆视频轨。
   */
  function install() {
    if (installed) {
      console.warn('[CameraStream] 拦截器已安装，跳过重复安装')
      return
    }

    // 检查浏览器是否支持 MediaStreamTrack.clone()
    if (typeof MediaStreamTrack?.prototype?.clone !== 'function') {
      console.warn(
        '[CameraStream] 当前浏览器不支持 MediaStreamTrack.clone()，' +
        '将回退到同流截图模式（可能影响 AR 渲染性能）'
      )
      installed = true // 标记已处理，避免重复警告
      return
    }

    nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)

    navigator.mediaDevices.getUserMedia = async function (constraints) {
      // 只拦截视频约束的调用（摄像头），音频或屏幕共享不处理
      if (!constraints?.video) {
        return nativeGetUserMedia(constraints)
      }

      console.log('[CameraStream] 拦截 getUserMedia，准备克隆视频轨...')

      // 调用原生 API 获取摄像头流
      const originalStream = await nativeGetUserMedia(constraints)

      try {
        // 克隆视频轨 → 创建独立的 MediaStream
        const videoTrack = originalStream.getVideoTracks()[0]
        if (!videoTrack) {
          console.warn('[CameraStream] 未找到视频轨，跳过克隆')
          return originalStream
        }

        const clonedTrack = videoTrack.clone()
        const captureStream = new MediaStream([clonedTrack])

        // 创建隐藏 video 元素，绑定克隆流
        captureVideoEl = document.createElement('video')
        captureVideoEl.setAttribute('playsinline', '')
        captureVideoEl.setAttribute('muted', '')
        captureVideoEl.style.display = 'none'
        captureVideoEl.srcObject = captureStream

        // 异步播放（不阻塞 A-Frame 初始化）
        captureVideoEl.play().then(() => {
          console.log(
            `[CameraStream] 克隆流就绪: ${captureVideoEl.videoWidth}x${captureVideoEl.videoHeight}`
          )
        }).catch(err => {
          console.warn('[CameraStream] 克隆流播放失败:', err.message)
        })

        // 将隐藏 video 添加到 DOM（iOS Safari 需要元素在 DOM 中才能稳定播放）
        document.body.appendChild(captureVideoEl)

        console.log('[CameraStream] ✅ 双通道已建立：原轨→AR / 克隆轨→截图')

        // 返回原轨给 A-Frame（MindAR 完全不知情）
        return originalStream

      } catch (err) {
        // 克隆失败时回退：返回原轨，截图时回退到同流模式
        console.warn('[CameraStream] 克隆失败，回退到同流模式:', err.message)
        return originalStream
      }
    }

    installed = true
    console.log('[CameraStream] getUserMedia 拦截器已安装')
  }

  // ---------------------------------------------------------------------------
  // 截图 API
  // ---------------------------------------------------------------------------

  /**
   * 从独立视频流抓取当前帧（返回 canvas）
   * 与 WebGL 渲染管线零冲突
   *
   * @returns {HTMLCanvasElement|null}
   */
  function captureFrame() {
    if (!captureVideoEl || captureVideoEl.readyState < 2) {
      // 克隆流不可用 → 回退到 A-Frame 场景内的 video
      return fallbackCapture()
    }

    const canvas = document.createElement('canvas')
    canvas.width = captureVideoEl.videoWidth
    canvas.height = captureVideoEl.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(captureVideoEl, 0, 0)
    return canvas
  }

  /**
   * 抓取帧并转换为 MindAR Compiler 可用的 HTMLImageElement
   * 异步（需要等图片加载）
   *
   * @returns {Promise<HTMLImageElement|null>}
   */
  async function captureAsImage() {
    const canvas = captureFrame()
    if (!canvas) return null

    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => {
        console.warn('[CameraStream] 图片加载失败，尝试回退')
        resolve(fallbackCaptureAsImage())
      }
      img.src = canvas.toDataURL('image/jpeg', 0.9)
    })
  }

  // ---------------------------------------------------------------------------
  // 回退方案：从 A-Frame 场景内的 <video> 截帧
  // ---------------------------------------------------------------------------

  function fallbackCapture() {
    const video = document.querySelector('a-scene video') ||
                  document.querySelector('#ar-container video')
    if (!video || video.readyState < 2) {
      console.warn('[CameraStream] 回退截帧也失败了：无可用视频流')
      return null
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    return canvas
  }

  function fallbackCaptureAsImage() {
    const canvas = fallbackCapture()
    if (!canvas) return null

    const img = new Image()
    img.src = canvas.toDataURL('image/jpeg', 0.9)
    return new Promise((resolve) => {
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
    })
  }

  /**
   * 检查克隆流是否可用
   */
  function isCloneAvailable() {
    return !!(captureVideoEl && captureVideoEl.readyState >= 2)
  }

  // ---------------------------------------------------------------------------
  // 清理
  // ---------------------------------------------------------------------------

  /**
   * 恢复原生 getUserMedia，释放克隆流资源
   * 在 ARView onBeforeUnmount 中调用
   */
  function destroy() {
    if (captureVideoEl) {
      const tracks = captureVideoEl.srcObject?.getVideoTracks() || []
      tracks.forEach(t => t.stop())
      captureVideoEl.remove()
      captureVideoEl = null
    }

    // 恢复原生 API（如果之前成功拦截过）
    if (nativeGetUserMedia) {
      navigator.mediaDevices.getUserMedia = nativeGetUserMedia
      nativeGetUserMedia = null
    }

    installed = false
    console.log('[CameraStream] 资源已释放')
  }

  return { install, captureFrame, captureAsImage, isCloneAvailable, destroy }
}
