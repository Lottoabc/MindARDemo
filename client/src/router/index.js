/**
 * WebAR 多人协同应用 - 路由配置
 * ============================================================================
 * 两个核心路由：
 *   /              → HomeView（图片采集、编译、创建房间）
 *   /ar/:roomId    → ARView（AR 场景 + DOM Overlay 协同）
 */

import { createRouter, createWebHashHistory } from 'vue-router'

// 使用懒加载优化首屏加载速度
const HomeView = () => import('../views/HomeView.vue')
const ARView = () => import('../views/ARView.vue')

const routes = [
  {
    path: '/',
    name: 'Home',
    component: HomeView,
    meta: { title: '创建 AR 房间' },
  },
  {
    path: '/ar/:roomId',
    name: 'AR',
    component: ARView,
    meta: { title: 'AR 协同空间' },
  },
]

const router = createRouter({
  // 使用 Hash 模式：兼容性更好，不需要服务端配置 URL 重写
  // 且 Hash 模式下部署到任意静态服务器都可以正常工作
  history: createWebHashHistory(),
  routes,
})

// 全局路由守卫：动态更新页面标题
router.beforeEach((to) => {
  document.title = to.meta.title || 'WebAR 多人协同'
})

export default router
