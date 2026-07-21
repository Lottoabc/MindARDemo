<!--
  UserPresence.vue — 在线用户指示器
  ============================================================================
  显示在当前 AR 房间内的所有在线用户。

  表现形式：
    - 移动端：顶部水平滚动的用户头像/圆点列表
    - 显示用户颜色标识和昵称首字
    - 自己的头像有特殊标记
-->
<template>
  <div v-if="users.length > 0" class="user-presence">
    <div class="presence-list">
      <!-- 在线用户 -->
      <div
        v-for="user in users"
        :key="user.id"
        class="presence-item"
        :class="{ 'is-self': user.id === localUser.id }"
        :title="user.name + (user.id === localUser.id ? '（你）' : '')"
      >
        <div
          class="presence-avatar"
          :style="{ backgroundColor: user.color }"
        >
          {{ user.name.charAt(0) }}
        </div>
        <span class="presence-name">{{ user.id === localUser.id ? '你' : user.name }}</span>
        <span class="presence-dot online"></span>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * UserPresence 从 useCollaboration 中获取当前用户列表并渲染
 */
import { useCollaboration } from '../composables/useCollaboration.js'

const { users, localUser } = useCollaboration()
</script>

<style scoped>
/* =========================================================================
   UserPresence 样式 — 顶部水平用户列表
   ========================================================================= */

.user-presence {
  position: fixed;
  top: calc(var(--safe-area-top) + 8px);
  right: 8px;
  z-index: 15;
  pointer-events: auto;
}

.presence-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ---- 单个用户 ---- */
.presence-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px 6px;
  background: rgba(15, 23, 42, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: var(--radius-full);
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: transform 0.2s ease;
}

.presence-item.is-self {
  border-color: rgba(99, 102, 241, 0.4);
}

/* ---- 用户头像（颜色圆 + 昵称首字） ---- */
.presence-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.presence-name {
  font-size: 11px;
  color: var(--text-secondary);
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 在线状态点 ---- */
.presence-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.presence-dot.online {
  background: var(--color-success);
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
}
</style>
