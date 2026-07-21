<!--
  WebAR 多人协同应用 - 根组件
  ============================================================================
  提供全局布局和 CSS 变量。所有页面内容通过 <router-view> 渲染。
-->
<template>
  <router-view />
</template>

<script setup>
// 根组件无需额外逻辑，路由负责页面切换
// 全局样式在 <style> 块中以非 scoped 方式定义
</script>

<style>
/* =========================================================================
   全局 CSS 变量与基础样式
   使用 clamp() 实现流体排版，移动端优先设计
   ========================================================================= */
:root {
  /* 主色调 */
  --color-primary: #6366f1;
  --color-primary-dark: #4f46e5;
  --color-danger: #ef4444;
  --color-success: #22c55e;
  --color-warning: #f59e0b;

  /* 背景色 */
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-card: rgba(30, 41, 59, 0.9);
  --bg-overlay: rgba(15, 23, 42, 0.6);

  /* 文字色 */
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;

  /* 间距与圆角 */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-full: 9999px;

  /* 流体尺寸（clamp 自适应手机/平板/桌面） */
  --font-sm: clamp(12px, 3vw, 14px);
  --font-base: clamp(14px, 4vw, 16px);
  --font-lg: clamp(16px, 5vw, 20px);
  --font-xl: clamp(20px, 6vw, 28px);
  --font-2xl: clamp(24px, 8vw, 36px);

  /* 工具栏高度 */
  --toolbar-height: clamp(48px, 10vh, 64px);

  /* 安全区（iPhone X+ 底部横条适配） */
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-top: env(safe-area-inset-top, 0px);
}

/* 全局重置 */
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* 在移动端固定 body，防止 iOS 橡皮筋效果 */
  position: fixed;
  top: 0;
  left: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial,
    sans-serif;
  font-size: var(--font-base);
  color: var(--text-primary);
  background-color: var(--bg-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  /* 防止双击缩放和长按菜单 */
  touch-action: manipulation;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

#app {
  width: 100%;
  height: 100%;
}

/* 允许文本在编辑模式下被选中 */
.allow-select {
  -webkit-user-select: text;
  user-select: text;
}

/* 通用按钮样式 */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 20px;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-base);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  /* 最小触摸目标 44x44px (Apple HIG) */
  min-width: 44px;
  min-height: 44px;
  touch-action: manipulation;
}
.btn:active {
  transform: scale(0.96);
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}
.btn-primary:active {
  background: var(--color-primary-dark);
}

.btn-danger {
  background: var(--color-danger);
  color: white;
}

.btn-ghost {
  background: transparent;
  color: var(--text-primary);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

/* Toast 提示样式 */
.toast {
  position: fixed;
  bottom: calc(var(--toolbar-height) + var(--safe-area-bottom) + 16px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-card);
  color: var(--text-primary);
  padding: 10px 20px;
  border-radius: var(--radius-full);
  font-size: var(--font-sm);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  z-index: 9999;
  white-space: nowrap;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  animation: toast-in 0.3s ease, toast-out 0.3s ease 2s forwards;
}

@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(20px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
@keyframes toast-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}

/* 滚动条美化（仅桌面端有效） */
@media (min-width: 768px) {
  ::-webkit-scrollbar {
    width: 4px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 2px;
  }
}
</style>
