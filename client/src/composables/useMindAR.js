/**
 * useMindAR.js — MindAR 编译器封装 + A-Frame 场景生命周期管理
 * ============================================================================
 * 两大职责：
 *
 * 【一、客户端图片编译】
 *   使用 MindAR 官方浏览器端 Compiler API，将用户上传的图片编译为 .mind 特征文件。
 *   流程：HTMLImageElement → compileImageTargets() → exportData() → .mind Blob → 上传到服务端
 *
 * 【二、A-Frame AR 场景管理】
 *   命令式创建/销毁 <a-scene> 及 MindAR 图像追踪组件。
 *   提供 targetDetected 响应式状态供 DOM Overlay 组件驱动 UI 显隐。
 *
 * 使用方式：
 *   import { useMindAR } from '../composables/useMindAR.js'
 *   const { compileImage, targetDetected, createARScene, destroyARScene } = useMindAR()
 */

import { ref } from 'vue'

// ---------------------------------------------------------------------------
// 共享响应式状态
// ---------------------------------------------------------------------------

/** 编译进度 (0 ~ 1)，用于进度条展示 */
const compileProgress = ref(0)
/** 是否正在编译中 */
const isCompiling = ref(false)
/** 编译错误信息 */
const compileError = ref(null)

/** AR 场景：当前是否检测到图片目标 */
const targetDetected = ref(false)
/** AR 场景：摄像头是否就绪 */
const cameraReady = ref(false)
/** AR 场景：场景是否正在运行 */
const isSceneRunning = ref(false)

// ---------------------------------------------------------------------------
// 内部变量（非响应式，用于管理 A-Frame 实例引用）
// ---------------------------------------------------------------------------
let sceneEl = null        // <a-scene> DOM 元素引用
let anchorEl = null       // mindar-image-target 实体引用
let aframeTickHandler = null  // requestAnimationFrame 回调引用

// ---------------------------------------------------------------------------
// 一、客户端图片编译
// ---------------------------------------------------------------------------

/**
 * 在浏览器中编译图片为 .mind 特征文件
 *
 * @param {HTMLImageElement} imageElement - 用户选择的图片（已加载的 img 元素）
 * @returns {Promise<{ mindBlob: Blob, dataList: Array }>}
 *   mindBlob - 编译后的 .mind 文件二进制数据
 *   dataList - 编译中间结果（调试用）
 */
async function compileImage(imageElement) {
  // 检查 MindAR Compiler 是否可用
  if (!window.MINDAR || !window.MINDAR.Compiler) {
    throw new Error(
      'MindAR 编译器未加载。请确保在 index.html 中引入了 mindar.prod.js（完整版，非 image-aframe 版）。'
    )
  }

  isCompiling.value = true
  compileProgress.value = 0
  compileError.value = null

  try {
    const compiler = new window.MINDAR.Compiler()

    // compileImageTargets 接受图片数组，支持批量编译（本项目每次编译一张）
    // 第二个参数是进度回调：(progress: number) => void，progress 范围 0.0 ~ 1.0
    const dataList = await compiler.compileImageTargets(
      [imageElement],
      (progress) => {
        compileProgress.value = progress
      }
    )

    // 将编译结果导出为 .mind 格式的 ArrayBuffer
    const exportedBuffer = await compiler.exportData()

    // 包装为 Blob，方便后续作为 FormData 上传
    const mindBlob = new Blob([exportedBuffer], {
      type: 'application/octet-stream',
    })

    compileProgress.value = 1
    console.log(
      `[MindAR] 编译完成。dataList 长度: ${dataList.length}, .mind 大小: ${(mindBlob.size / 1024).toFixed(1)} KB`
    )

    return { mindBlob, dataList }
  } catch (err) {
    compileError.value = err.message || '编译失败'
    console.error('[MindAR] 编译失败:', err)
    throw err
  } finally {
    isCompiling.value = false
  }
}

// ---------------------------------------------------------------------------
// 二、A-Frame AR 场景管理
// ---------------------------------------------------------------------------

/**
 * 命令式创建 A-Frame + MindAR 图像追踪场景
 *
 * 【为什么命令式创建而不是写 Vue 模板？】
 * A-Frame 通过 Custom Elements 注册 <a-scene>、<a-entity> 等标签。
 * Vue 的模板编译器不认识这些自定义元素，会报警告且可能产生渲染冲突。
 * 因此采用"在 onMounted 中创建 DOM、在 onBeforeUnmount 中销毁"的策略。
 *
 * @param {string} containerId - 用于承载 <a-scene> 的 div 容器 ID
 * @param {string} mindFileUrl - .mind 特征文件的 URL（服务端返回的）
 * @returns {Promise<void>}
 */
async function createARScene(containerId, mindFileUrl) {
  // 防止重复创建场景
  if (sceneEl) {
    console.warn('[MindAR] 场景已存在，先销毁旧场景')
    destroyARScene()
  }

  const container = document.getElementById(containerId)
  if (!container) {
    throw new Error(`找不到 AR 场景容器元素: #${containerId}`)
  }

  // -----------------------------------------------------------------------
  // 1. 创建 <a-scene> 根元素
  //    mindar-image 组件负责初始化 MindAR 图像追踪引擎
  //    imageTargetSrc 指向编译好的 .mind 文件
  // -----------------------------------------------------------------------
  const scene = document.createElement('a-scene')

  // MindAR 图像追踪配置
  // - imageTargetSrc: .mind 特征文件路径
  // - maxTrack: 同时追踪的最大目标数（本项目每次只追踪 1 个目标）
  // - filterMinCFO: 过滤低置信度检测，值越高越严格
  scene.setAttribute(
    'mindar-image',
    `imageTargetSrc: ${mindFileUrl}; maxTrack: 1; filterMinCFO: 0.05`
  )

  // 关闭 VR 模式 UI（我们是 AR 应用，不需要 VR 头显按钮）
  scene.setAttribute('vr-mode-ui', 'enabled: false')

  // 关闭设备方向权限弹窗（图像追踪 AR 不需要陀螺仪权限）
  scene.setAttribute('device-orientation-permission-ui', 'enabled: false')

  // -----------------------------------------------------------------------
  // 2. 创建相机
  //    A-Frame 的 <a-camera> 自动处理 WebRTC 摄像头流
  //    look-controls 禁用（AR 中不需要鼠标/手指旋转视角）
  // -----------------------------------------------------------------------
  const camera = document.createElement('a-camera')
  camera.setAttribute('position', '0 0 0')
  camera.setAttribute('look-controls', 'enabled: false')
  // iOS 必需：防止全屏接管
  camera.setAttribute('playsinline', '')
  camera.setAttribute('webkit-playsinline', '')
  scene.appendChild(camera)

  // -----------------------------------------------------------------------
  // 3. 创建图像目标锚点实体
  //    mindar-image-target 组件会在摄像头识别到图片后自动定位
  //    targetIndex: 0 表示追踪 .mind 文件中的第 1 个目标
  //
  //    子实体 a-plane 用于在 AR 中可视化追踪锚点（调试用，可设为透明）
  // -----------------------------------------------------------------------
  const anchor = document.createElement('a-entity')
  anchor.setAttribute('mindar-image-target', 'targetIndex: 0')

  // 添加一个半透明的调试平面（可帮你看到追踪效果，生产可去掉）
  // 这个平面会精确覆盖在被追踪的图片上
  const debugPlane = document.createElement('a-plane')
  debugPlane.setAttribute('position', '0 0 0')
  debugPlane.setAttribute('width', '1')
  debugPlane.setAttribute('height', '1')
  debugPlane.setAttribute('material', 'opacity: 0; transparent: true')
  anchor.appendChild(debugPlane)

  scene.appendChild(anchor)

  // -----------------------------------------------------------------------
  // 4. 将场景注入到 DOM 容器中
  // -----------------------------------------------------------------------
  container.appendChild(scene)

  // 保存引用
  sceneEl = scene
  anchorEl = anchor

  // -----------------------------------------------------------------------
  // 5. 注册目标检测事件
  //    MindAR 在检测到/丢失图片时会触发 targetFound 和 targetLost 事件
  // -----------------------------------------------------------------------
  anchor.addEventListener('targetFound', () => {
    console.log('[MindAR] 🎯 目标已检测！')
    targetDetected.value = true
  })

  anchor.addEventListener('targetLost', () => {
    console.log('[MindAR] ❌ 目标丢失')
    targetDetected.value = false
    // 注意：targetLost 后 DOM Overlay 会淡出，但用户的编辑状态保留在内存中
  })

  // -----------------------------------------------------------------------
  // 6. 等待场景加载完成
  //    A-Frame 场景需要异步初始化，loaded 事件在所有组件初始化后触发
  // -----------------------------------------------------------------------
  return new Promise((resolve, reject) => {
    // 超时处理：如果 15 秒还没加载完，视为失败
    const timeoutId = setTimeout(() => {
      reject(new Error('AR 场景加载超时，请检查摄像头权限和网络连接'))
    }, 15000)

    scene.addEventListener('loaded', () => {
      clearTimeout(timeoutId)
      console.log('[MindAR] AR 场景加载完成')
      isSceneRunning.value = true
      cameraReady.value = true
      resolve()
    })

    // 渲染错误处理
    scene.addEventListener('rendererror', (err) => {
      clearTimeout(timeoutId)
      console.error('[MindAR] 渲染错误:', err)
      reject(new Error('AR 渲染初始化失败'))
    })
  })
}

/**
 * 销毁 AR 场景，释放摄像头和 WebGL 资源
 * 【重要】必须在 Vue 组件 onBeforeUnmount 中调用，防止内存泄漏
 */
function destroyARScene() {
  if (sceneEl) {
    // 移除 A-Frame 场景 DOM 元素
    sceneEl.remove()
    sceneEl = null
    anchorEl = null
  }

  // 重置状态
  targetDetected.value = false
  cameraReady.value = false
  isSceneRunning.value = false

  console.log('[MindAR] AR 场景已销毁')
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------
export function useMindAR() {
  return {
    // 编译相关
    compileImage,
    compileProgress,
    isCompiling,
    compileError,

    // 场景相关
    createARScene,
    destroyARScene,
    targetDetected,
    cameraReady,
    isSceneRunning,
  }
}
