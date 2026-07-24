/**
 * WebAR 多人协同应用 - 路由配置
 * ============================================================================
 * 两个路由：
 *   /              → ARView（默认，直接开始摄像头扫描，拍照即可创建参照物）
 *   /ar/:roomId    → ARView（带房间号，加入已有协同房间）
 */

import { createRouter, createWebHashHistory } from 'vue-router'

const ARView = () => import('../views/ARView.vue')

const routes = [
  {
    path: '/',
    name: 'AR',
    component: ARView,
    meta: { title: 'WebAR 扫描' },
  },
  {
    path: '/ar/:roomId',
    name: 'ARRoom',
    component: ARView,
    meta: { title: 'AR 协同空间' },
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach((to) => {
  document.title = to.meta.title || 'WebAR 多人协同'
})

export default router
