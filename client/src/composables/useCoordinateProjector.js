/**
 * useCoordinateProjector.js — MindAR 3D 世界坐标 → 2D 屏幕坐标投影
 * ============================================================================
 * 从 A-Frame 场景中提取 THREE.js 相机引用，将 mindar-image-target
 * 实体在 3D 世界中的位置投影到 2D 屏幕像素坐标。
 *
 * DOM Overlay 中的 TargetAnchor 使用这些坐标实时"贴"在扫描到的参照物上方。
 *
 * 使用方式：
 *   import { useCoordinateProjector } from '../composables/useCoordinateProjector.js'
 *   const { init, project, bindTracking } = useCoordinateProjector()
 */

import { ref, shallowRef } from 'vue'

export function useCoordinateProjector() {
  // ---------------------------------------------------------------------------
  // 内部状态
  // ---------------------------------------------------------------------------

  /** THREE.PerspectiveCamera（从 A-Frame sceneEl.camera 获取） */
  let camera = null

  /** 是否已初始化 */
  let initialized = false

  // ---------------------------------------------------------------------------
  // 初始化
  // ---------------------------------------------------------------------------

  /**
   * 从 A-Frame 场景提取 THREE.js 相机引用
   *
   * @param {HTMLElement} sceneEl - <a-scene> DOM 元素
   */
  function init(sceneEl) {
    if (!sceneEl) {
      console.warn('[Projector] sceneEl 为空，无法初始化')
      return false
    }

    // A-Frame 在 loaded 事件后，sceneEl.camera 就是 THREE.PerspectiveCamera
    camera = sceneEl.camera

    if (!camera) {
      console.warn('[Projector] 未能获取 THREE.js camera 引用')
      return false
    }

    initialized = true
    console.log('[Projector] 坐标投影器已初始化')
    return true
  }

  // ---------------------------------------------------------------------------
  // 单次投影
  // ---------------------------------------------------------------------------

  /**
   * 将一个 3D 世界坐标投影到 2D 屏幕坐标
   *
   * @param {{ x: number, y: number, z: number }} worldPos - 世界空间位置
   * @returns {{ x: number, y: number, visible: boolean }}
   *   - x, y: 屏幕像素坐标（相对于视口左上角）
   *   - visible: 该点是否在相机视锥体内（false = 在屏幕外/后方）
   */
  function project(worldPos) {
    if (!initialized || !camera) {
      return { x: 0, y: 0, visible: false }
    }

    // THREE.Vector3.project() 将世界坐标 → 归一化设备坐标 (NDC: -1 ~ 1)
    const vector = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z)
    vector.project(camera)

    // NDC → 屏幕像素
    const x = (vector.x * 0.5 + 0.5) * window.innerWidth
    const y = (-vector.y * 0.5 + 0.5) * window.innerHeight // Y 轴翻转

    // z < 1 表示该点在相机前方（NDC 的 z 范围是 -1 到 1，但 project 后可能是其他值）
    // visible 还需要判断是否在屏幕范围内
    const visible =
      vector.z < 1 &&
      x > -200 && x < window.innerWidth + 200 &&
      y > -200 && y < window.innerHeight + 200

    return { x: Math.round(x), y: Math.round(y), visible }
  }

  // ---------------------------------------------------------------------------
  // 持续追踪绑定
  // ---------------------------------------------------------------------------

  /**
   * 绑定一个 mindar-image-target 实体，在每一帧将其 3D 位置投影到 2D，
   * 更新 reactive 引用（驱动 DOM 跟随）。
   *
   * @param {HTMLElement} anchorEl - mindar-image-target 的 DOM 元素
   * @param {import('vue').Ref} screenPosRef - Vue ref，每帧更新为 {x, y, visible}
   * @returns {Function} 解绑函数（在 onBeforeUnmount 中调用）
   */
  function bindTracking(anchorEl, screenPosRef) {
    if (!anchorEl) {
      console.warn('[Projector] anchorEl 为空，无法绑定追踪')
      return () => {}
    }

    const sceneEl = anchorEl.closest('a-scene')
    if (!sceneEl) {
      console.warn('[Projector] 找不到 a-scene，无法绑定追踪')
      return () => {}
    }

    // -----------------------------------------------------------------------
    // 移动平均平滑（减少追踪抖动）
    // -----------------------------------------------------------------------
    const SMOOTH_WINDOW = 5
    const historyX = []
    const historyY = []

    function smoothValue(history, newVal) {
      history.push(newVal)
      if (history.length > SMOOTH_WINDOW) history.shift()
      return Math.round(history.reduce((a, b) => a + b, 0) / history.length)
    }

    function onTick() {
      // 获取 A-Frame 实体在 3D 世界中的当前位置
      const obj3D = anchorEl.object3D
      if (!obj3D) return

      const worldPos = obj3D.position
      const projected = project(worldPos)

      // 如果不可见就不做平滑（避免积累错误值）
      if (!projected.visible) {
        historyX.length = 0
        historyY.length = 0
        screenPosRef.value = projected
        return
      }

      // 平滑处理
      screenPosRef.value = {
        x: smoothValue(historyX, projected.x),
        y: smoothValue(historyY, projected.y),
        visible: true,
      }
    }

    // 挂载到 A-Frame 的每帧渲染循环
    sceneEl.addEventListener('tick', onTick)

    // 返回解绑函数
    return () => {
      sceneEl.removeEventListener('tick', onTick)
    }
  }

  // ---------------------------------------------------------------------------
  // 重置
  // ---------------------------------------------------------------------------
  function reset() {
    camera = null
    initialized = false
  }

  return { init, project, bindTracking, reset }
}
