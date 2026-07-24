/**
 * useMindAR.js — MindAR 编译器封装 + A-Frame 场景生命周期管理
 * ============================================================================
 * 三大职责：
 *
 * 【一、客户端图片编译】
 *   使用 MindAR 官方浏览器端 Compiler API，将图片编译为特征数据。
 *   支持单图编译和合并多图编译。
 *
 * 【二、A-Frame AR 场景管理（Multi-Target）】
 *   命令式创建 A-Frame 场景，支持多个 targetIndex 的 anchor 实体。
 *   场景和摄像机在热交换期间保持存活——只有 MindAR 追踪系统被替换。
 *
 * 【三、摄像头帧捕获】
 *   从场景 video 元素抓帧（作为 useCameraStream 的回退方案）。
 *
 * 使用方式：
 *   import { useMindAR } from '../composables/useMindAR.js'
 *   const { compileImage, createARScene, destroyARScene,
 *           targetDetected, activeTargetIndex, sceneEl } = useMindAR()
 */

import { ref, shallowRef } from 'vue'

// ---------------------------------------------------------------------------
// 共享响应式状态（模块级单例）
// ---------------------------------------------------------------------------

/** 编译进度 (0 ~ 1) */
const compileProgress = ref(0)
/** 是否正在编译中 */
const isCompiling = ref(false)
/** 编译错误信息 */
const compileError = ref(null)

/** AR 场景：是否有任意目标被检测到 */
const targetDetected = ref(false)
/** AR 场景：当前活跃的目标索引（-1 = 无） */
const activeTargetIndex = ref(-1)
/** AR 场景：每个 targetIndex 是否被检测到 */
const targetStates = ref({})
/** AR 场景：摄像头是否就绪 */
const cameraReady = ref(false)
/** AR 场景：场景是否正在运行 */
const isSceneRunning = ref(false)

// ---------------------------------------------------------------------------
// 内部变量（非响应式）
// ---------------------------------------------------------------------------

/** <a-scene> DOM 元素引用 */
let sceneEl = null
/** targetIndex → anchor HTMLElement 映射 */
let anchorMap = new Map()
/** 编译完成回调注册表（供外部注入，在 targetFound 时触发） */
let targetFoundCallbacks = {}
let targetLostCallbacks = {}

// ---------------------------------------------------------------------------
// 一、客户端图片编译
// ---------------------------------------------------------------------------

/**
 * 在浏览器中编译图片为 .mind 特征文件
 *
 * @param {HTMLImageElement|HTMLCanvasElement} source - 图片源
 * @returns {Promise<{ mindBlob: Blob, dataList: Array }>}
 */
async function compileImage(source) {
  const MINDAR = window.MINDAR
  if (!MINDAR || !(MINDAR.Compiler || MINDAR.IMAGE?.Compiler)) {
    throw new Error(
      'MindAR 编译器未加载。请确保在 index.html 中引入了 mindar-image.prod.js。'
    )
  }

  isCompiling.value = true
  compileProgress.value = 0
  compileError.value = null

  try {
    const CompilerClass = MINDAR.Compiler || MINDAR.IMAGE.Compiler
    const compiler = new CompilerClass()

    const dataList = await compiler.compileImageTargets(
      [source],
      (progress) => { compileProgress.value = progress }
    )

    const exportedBuffer = await compiler.exportData()
    const mindBlob = new Blob([exportedBuffer], {
      type: 'application/octet-stream',
    })

    compileProgress.value = 1
    console.log(
      `[MindAR] 编译完成。dataList: ${dataList.length}, .mind: ${(mindBlob.size / 1024).toFixed(1)} KB`
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
// 二、A-Frame AR 场景管理（Multi-Target）
// ---------------------------------------------------------------------------

/**
 * 命令式创建 A-Frame 场景（支持纯相机模式 + MindAR 延迟初始化）
 *
 * 两种模式：
 *   mindFileUrl 提供 → 直接初始化 MindAR 追踪器
 *   mindFileUrl 为空   → 仅创建相机（纯预览），之后通过 startMindAR() 激活追踪
 *
 * @param {string} containerId - 容器 div 的 ID
 * @param {string} [mindFileUrl] - .mind 特征文件 URL（可选，为空时纯相机模式）
 * @param {number} [targetCount=0] - 目标数量
 * @returns {Promise<HTMLElement>} sceneEl 引用
 */
async function createARScene(containerId, mindFileUrl, targetCount = 0) {
  // 防止重复创建
  if (sceneEl) {
    console.warn('[MindAR] 场景已存在，先销毁旧场景')
    destroyARScene()
  }

  const container = document.getElementById(containerId)
  if (!container) {
    throw new Error(`找不到 AR 场景容器元素: #${containerId}`)
  }

  const hasMindAR = !!(mindFileUrl && targetCount > 0)

  // -------------------------------------------------------------------
  // 1. 创建 <a-scene> 根元素
  // -------------------------------------------------------------------
  const scene = document.createElement('a-scene')

  if (hasMindAR) {
    scene.setAttribute(
      'mindar-image',
      `imageTargetSrc: ${mindFileUrl}; maxTrack: ${Math.min(targetCount, 5)}; filterMinCFO: 0.05`
    )
  }
  // 没有 mindFileUrl → 不设置 mindar-image，纯相机模式

  scene.setAttribute('vr-mode-ui', 'enabled: false')
  scene.setAttribute('device-orientation-permission-ui', 'enabled: false')

  // -------------------------------------------------------------------
  // 2. 创建相机
  // -------------------------------------------------------------------
  const camera = document.createElement('a-camera')
  camera.setAttribute('position', '0 0 0')
  camera.setAttribute('look-controls', 'enabled: false')
  camera.setAttribute('playsinline', '')
  camera.setAttribute('webkit-playsinline', '')
  scene.appendChild(camera)

  // -------------------------------------------------------------------
  // 3. 创建 targetIndex anchor 实体（仅当有 MindAR 时）
  // -------------------------------------------------------------------
  if (hasMindAR) {
    for (let i = 0; i < targetCount; i++) {
      createAnchorForTarget(scene, i)
    }
  }

  // -------------------------------------------------------------------
  // 4. 注入 DOM
  // -------------------------------------------------------------------
  container.appendChild(scene)
  sceneEl = scene

  // -------------------------------------------------------------------
  // 5. 等待加载完成
  // -------------------------------------------------------------------
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('AR 场景加载超时，请检查摄像头权限和网络连接'))
    }, 15000)

    scene.addEventListener('loaded', () => {
      clearTimeout(timeoutId)
      console.log(`[MindAR] 场景加载完成 (MindAR: ${hasMindAR ? '已激活' : '纯相机模式'})`)
      isSceneRunning.value = true
      cameraReady.value = true
      resolve(sceneEl)
    })

    scene.addEventListener('rendererror', (err) => {
      clearTimeout(timeoutId)
      console.error('[MindAR] 渲染错误:', err)
      reject(new Error('AR 渲染初始化失败'))
    })
  })
}

/**
 * 在已有场景上激活 MindAR 追踪（纯相机模式 → AR 追踪模式）
 *
 * 用于首次拍照后：场景已运行，摄像头已就绪，只需注入 MindAR。
 * A-Frame 会在属性变化时自动初始化 mindar-image-system。
 *
 * @param {HTMLElement} scene - <a-scene> 元素
 * @param {string} mindUrl - .mind 文件 URL
 * @param {number} targetCount - 目标数量
 * @returns {Promise<void>}
 */
async function startMindAR(scene, mindUrl, targetCount) {
  if (!scene) throw new Error('scene 为空')

  console.log(`[MindAR] 激活追踪: ${targetCount} 个目标`)

  // 设置 mindar-image 属性 → A-Frame 自动初始化 WASM 追踪器
  scene.setAttribute(
    'mindar-image',
    `imageTargetSrc: ${mindUrl}; maxTrack: ${Math.min(targetCount, 5)}; filterMinCFO: 0.05`
  )

  // 创建 target anchor 实体
  for (let i = 0; i < targetCount; i++) {
    createAnchorForTarget(scene, i)
  }

  // 等待 MindAR 系统就绪
  await new Promise((resolve, reject) => {
    let attempts = 0
    function check() {
      attempts++
      const system = scene.systems?.['mindar-image-system']
      if (system?.ready) {
        console.log(`[MindAR] 追踪器就绪 (${attempts} 次检查)`)
        resolve()
        return
      }
      if (attempts >= 50) {
        reject(new Error('MindAR 启动超时'))
        return
      }
      requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  })

  console.log('[MindAR] ✅ AR 追踪已激活')
}

/**
 * 为指定 targetIndex 创建 mindar-image-target 实体
 */
function createAnchorForTarget(scene, index) {
  const anchor = document.createElement('a-entity')
  anchor.setAttribute('mindar-image-target', `targetIndex: ${index}`)
  anchor.setAttribute('data-target-index', index)

  // 透明调试平面（生产环境可移除，但保留方便调试）
  const debugPlane = document.createElement('a-plane')
  debugPlane.setAttribute('position', '0 0 0')
  debugPlane.setAttribute('width', '1')
  debugPlane.setAttribute('height', '1')
  debugPlane.setAttribute('material', 'opacity: 0; transparent: true')
  anchor.appendChild(debugPlane)

  // 注册检测/丢失事件
  anchor.addEventListener('targetFound', () => {
    console.log(`[MindAR] 🎯 targetIndex ${index} 已检测！`)
    targetStates.value = { ...targetStates.value, [index]: true }
    targetDetected.value = true
    activeTargetIndex.value = index

    // 触发外部注入的回调
    targetFoundCallbacks[index]?.()
  })

  anchor.addEventListener('targetLost', () => {
    console.log(`[MindAR] ❌ targetIndex ${index} 丢失`)
    targetStates.value = { ...targetStates.value, [index]: false }
    activeTargetIndex.value = -1

    // 检查是否还有其他目标被检测到
    const anyDetected = Object.values(targetStates.value).some(v => v)
    if (!anyDetected) {
      targetDetected.value = false
    }

    targetLostCallbacks[index]?.()
  })

  scene.appendChild(anchor)
  anchorMap.set(index, anchor)

  return anchor
}

// ---------------------------------------------------------------------------
// 热交换支持：清除 / 重建 anchor
// ---------------------------------------------------------------------------

/**
 * 清除所有 anchor 实体（热交换前调用）
 */
function clearAllAnchors() {
  anchorMap.forEach((anchor) => {
    anchor.remove()
  })
  anchorMap.clear()
  targetStates.value = {}
  targetDetected.value = false
  activeTargetIndex.value = -1
}

/**
 * 为所有 targetIndex 重新创建 anchor（热交换后调用）
 */
function rebuildAnchors(count) {
  if (!sceneEl) return []
  const anchors = []
  for (let i = 0; i < count; i++) {
    anchors.push(createAnchorForTarget(sceneEl, i))
  }
  return anchors
}

/**
 * 注册 targetFound/targetLost 回调（供 ARView 注入业务逻辑）
 */
function onTargetFound(index, callback) {
  targetFoundCallbacks[index] = callback
}

function onTargetLost(index, callback) {
  targetLostCallbacks[index] = callback
}

// ---------------------------------------------------------------------------
// 销毁
// ---------------------------------------------------------------------------

/**
 * 销毁 AR 场景，释放摄像头和 WebGL 资源
 */
function destroyARScene() {
  if (sceneEl) {
    sceneEl.remove()
    sceneEl = null
  }
  anchorMap.clear()
  targetFoundCallbacks = {}
  targetLostCallbacks = {}

  targetDetected.value = false
  activeTargetIndex.value = -1
  targetStates.value = {}
  cameraReady.value = false
  isSceneRunning.value = false

  console.log('[MindAR] AR 场景已销毁')
}

// ---------------------------------------------------------------------------
// 三、摄像头帧捕获（回退方案）
// ---------------------------------------------------------------------------

/**
 * 从 A-Frame 场景内的 <video> 抓帧
 * （当 useCameraStream 的克隆流不可用时回退到此方案）
 * @returns {HTMLCanvasElement|null}
 */
function captureCameraFrame() {
  const video = document.querySelector('a-scene video') ||
                document.querySelector('#ar-container video')
  if (!video || video.readyState < 2) {
    console.warn('[MindAR] 无法获取摄像头视频流')
    return null
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    console.log(`[MindAR] 抓取摄像头帧: ${canvas.width}x${canvas.height}`)
    return canvas
  } catch (err) {
    console.error('[MindAR] 抓取摄像头帧失败:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------
export function useMindAR() {
  return {
    // 编译
    compileImage,
    compileProgress,
    isCompiling,
    compileError,

    // 场景
    createARScene,
    startMindAR,
    destroyARScene,
    clearAllAnchors,
    rebuildAnchors,
    sceneEl: () => sceneEl,
    anchorMap: () => anchorMap,

    // 状态
    targetDetected,
    activeTargetIndex,
    targetStates,
    cameraReady,
    isSceneRunning,

    // 回调注入
    onTargetFound,
    onTargetLost,

    // 帧捕获
    captureCameraFrame,
  }
}
