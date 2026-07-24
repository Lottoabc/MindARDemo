/**
 * useTargetRegistry.js — 动态目标注册与热交换
 * ============================================================================
 * 核心能力：
 *   1. 接收新拍照图片 → 与已有图片合并编译为单个 .mind 文件
 *   2. 通过 Blob URL 提供给 MindAR，实现运行时"添加新目标"
 *   3. hotSwap() 在不销毁 A-Frame 场景的前提下替换追踪数据
 *
 * 热交换流程：
 *   1. 显示过渡蒙版
 *   2. 移除旧 mindar-image-target 实体
 *   3. 更新 mindar-image 系统的 imageTargetSrc
 *   4. 创建新的 targetIndex 0..N 实体
 *   5. 等待 MindAR 追踪器重新就绪
 *   6. 隐藏过渡蒙版
 *
 * 整个过程中 A-Frame scene、camera、WebGL context 保持存活。
 *
 * 使用方式：
 *   import { useTargetRegistry } from '../composables/useTargetRegistry.js'
 *   const { registerTarget, compileSingle, hotSwap } = useTargetRegistry()
 */

import { useTargetStore } from '../stores/useTargetStore.js'

export function useTargetRegistry() {
  const targetStore = useTargetStore()

  /**
   * 编译单张图片（不合并，仅用于预检查或单独使用）
   *
   * @param {HTMLImageElement} imageElement
   * @returns {Promise<ArrayBuffer>} 编译后的 ArrayBuffer
   */
  async function compileSingle(imageElement) {
    const CompilerClass = getCompiler()
    const compiler = new CompilerClass()

    await compiler.compileImageTargets([imageElement], (progress) => {
      targetStore.compileProgress = progress
    })

    return compiler.exportData()
  }

  /**
   * 注册新目标：将新图片与所有已有图片合并编译，生成合并的 .mind
   *
   * @param {HTMLImageElement} newImageElement - 新拍照的图片
   * @param {HTMLImageElement[]} existingImages - 已注册的图片元素列表
   * @returns {Promise<{ blobUrl: string, newIndex: number, combinedBuffer: ArrayBuffer }>}
   */
  async function registerTarget(newImageElement, existingImages) {
    targetStore.isCompiling = true
    targetStore.compileProgress = 0

    try {
      const allImages = [...existingImages, newImageElement]
      const newIndex = allImages.length - 1

      console.log(`[TargetRegistry] 合并编译 ${allImages.length} 张图片 (新目标 index=${newIndex})...`)

      const CompilerClass = getCompiler()
      const compiler = new CompilerClass()

      const dataList = await compiler.compileImageTargets(allImages, (progress) => {
        targetStore.compileProgress = progress
      })

      const combinedBuffer = await compiler.exportData()
      const blob = new Blob([combinedBuffer], { type: 'application/octet-stream' })
      const blobUrl = URL.createObjectURL(blob)

      // 缓存新图片的 dataUrl
      const canvas = document.createElement('canvas')
      canvas.width = newImageElement.naturalWidth
      canvas.height = newImageElement.naturalHeight
      canvas.getContext('2d').drawImage(newImageElement, 0, 0)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7)

      // 写入 Store
      targetStore.addTarget(newIndex, newImageElement, dataUrl)
      targetStore.setActiveMindUrl(blobUrl)

      console.log(
        `[TargetRegistry] ✅ 合并编译完成: ` +
        `dataList=${dataList.length}, ` +
        `.mind=${(combinedBuffer.byteLength / 1024).toFixed(1)}KB, ` +
        `新 index=${newIndex}`
      )

      return { blobUrl, newIndex, combinedBuffer }
    } finally {
      targetStore.isCompiling = false
    }
  }

  /**
   * 热交换：动态替换 MindAR 追踪数据，不销毁 A-Frame 场景
   *
   * @param {HTMLElement} sceneEl - <a-scene> DOM 元素
   * @param {string} mindUrl - 新的 .mind Blob URL
   * @param {number} targetCount - 目标总数
   * @param {object} callbacks - { onTargetFound(index), onTargetLost(index) }
   * @returns {Promise<HTMLElement[]>} 新创建的 anchor 元素列表
   */
  async function hotSwap(sceneEl, mindUrl, targetCount, callbacks = {}) {
    if (!sceneEl) throw new Error('sceneEl 为空')

    console.log(`[TargetRegistry] 开始热交换: ${targetCount} 个目标`)

    // ---- Step 1: 移除旧 anchor 实体 ----
    const oldAnchors = sceneEl.querySelectorAll('[mindar-image-target]')
    oldAnchors.forEach(el => el.remove())
    console.log(`[TargetRegistry] 移除了 ${oldAnchors.length} 个旧 anchor`)

    // ---- Step 2: 更新 mindar-image 属性 ----
    // 移除旧属性 → 等一帧 → 设置新属性（触发 MindAR 重新初始化 WASM 追踪器）
    sceneEl.removeAttribute('mindar-image')

    await new Promise(r => requestAnimationFrame(r))

    sceneEl.setAttribute(
      'mindar-image',
      `imageTargetSrc: ${mindUrl}; maxTrack: ${Math.min(targetCount, 5)}; filterMinCFO: 0.05`
    )

    // ---- Step 3: 等待 MindAR 重新初始化 ----
    // A-Frame 的 update 是同步的，但 MindAR 内部 WASM 初始化是异步的
    await new Promise((resolve, reject) => {
      let attempts = 0
      const maxAttempts = 50 // ~5 秒

      function check() {
        attempts++
        const system = sceneEl.systems?.['mindar-image-system']
        if (system?.ready) {
          console.log(`[TargetRegistry] MindAR 重新就绪 (${attempts} 次检查)`)
          resolve()
          return
        }
        if (attempts >= maxAttempts) {
          reject(new Error('MindAR 热交换超时'))
          return
        }
        requestAnimationFrame(check)
      }
      // 延迟一帧开始检查，给 A-Frame 时间处理属性变更
      requestAnimationFrame(check)
    })

    // ---- Step 4: 创建新的 targetIndex anchor 实体 ----
    const newAnchors = []
    for (let i = 0; i < targetCount; i++) {
      const anchor = document.createElement('a-entity')
      anchor.setAttribute('mindar-image-target', `targetIndex: ${i}`)
      anchor.setAttribute('data-target-index', i)

      // 注册检测/丢失事件
      anchor.addEventListener('targetFound', () => {
        console.log(`[TargetRegistry] 🎯 targetIndex ${i} 被检测到`)
        callbacks.onTargetFound?.(i, anchor)
      })
      anchor.addEventListener('targetLost', () => {
        console.log(`[TargetRegistry] ❌ targetIndex ${i} 丢失`)
        callbacks.onTargetLost?.(i, anchor)
      })

      sceneEl.appendChild(anchor)
      newAnchors.push(anchor)

      // 注册到 Store（供 TargetAnchor 组件查找）
      targetStore.registerAnchor(i, anchor)
    }

    console.log(`[TargetRegistry] ✅ 热交换完成，创建了 ${newAnchors.length} 个 anchor`)
    return newAnchors
  }

  // ---------------------------------------------------------------------------
  // 内部工具
  // ---------------------------------------------------------------------------

  /**
   * 获取 MindAR Compiler 类（兼容新旧版本路径）
   */
  function getCompiler() {
    const MINDAR = window.MINDAR
    if (!MINDAR) {
      throw new Error('MindAR 未加载。请确保 index.html 引入了 mindar-image.prod.js。')
    }
    const CompilerClass = MINDAR.Compiler || MINDAR.IMAGE?.Compiler
    if (!CompilerClass) {
      throw new Error('MindAR Compiler 不可用')
    }
    return CompilerClass
  }

  return { compileSingle, registerTarget, hotSwap }
}
