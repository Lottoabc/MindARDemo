/**
 * WebAR 多人协同应用 - 前端入口
 * ============================================================================
 * 初始化 Vue 应用、Pinia、Vue Router，并挂载到 #app
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router/index.js'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
