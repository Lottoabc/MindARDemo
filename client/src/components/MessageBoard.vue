<!--
  MessageBoard.vue — 留言板弹窗组件
  ============================================================================
  当用户点击 TargetAnchor 或通过工具栏触发时，弹出完整的留言板界面：
    - 留言列表（可滚动）
    - 输入框 + 发送按钮
    - 显示每条留言的作者和颜色标识

  用于替代快捷输入行，适合需要浏览全部留言的场景。
-->
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="messageboard-backdrop" @click.self="close">
        <div class="messageboard-panel">
          <!-- 标题栏 -->
          <div class="mb-header">
            <span class="mb-emoji">{{ emoji }}</span>
            <span class="mb-title">留言板</span>
            <span class="mb-count">{{ messages.length }} 条留言</span>
            <button class="mb-close" @click="close">✕</button>
          </div>

          <!-- 留言列表 -->
          <div class="mb-list" ref="listRef">
            <div v-if="messages.length === 0" class="mb-empty">
              <p>还没有留言</p>
              <p class="mb-empty-hint">在下方输入第一条留言吧 ✨</p>
            </div>

            <div
              v-for="msg in messages"
              :key="msg.id"
              class="mb-message"
            >
              <div class="mb-msg-header">
                <span
                  class="mb-msg-dot"
                  :style="{ backgroundColor: msg.userColor }"
                ></span>
                <span class="mb-msg-author">{{ msg.userName }}</span>
                <span class="mb-msg-time">{{ formatTime(msg.createdAt) }}</span>
              </div>
              <p class="mb-msg-content">{{ msg.content }}</p>
            </div>
          </div>

          <!-- 输入区 -->
          <div class="mb-input-row">
            <input
              ref="inputRef"
              v-model="text"
              class="mb-input"
              placeholder="输入留言..."
              maxlength="200"
              @keyup.enter="submit"
            />
            <button
              class="mb-send"
              :disabled="!text.trim()"
              @click="submit"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useMessageStore } from '../stores/useMessageStore.js'
import { useCollaboration } from '../composables/useCollaboration.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  targetIndex: { type: Number, default: 0 },
  emoji: { type: String, default: '📌' },
})

const emit = defineEmits(['close', 'toast'])

const messageStore = useMessageStore()
const { localUser } = useCollaboration()

const text = ref('')
const inputRef = ref(null)
const listRef = ref(null)

const messages = computed(() => messageStore.getMessages(props.targetIndex))

// ---------------------------------------------------------------------------
// 自动聚焦
// ---------------------------------------------------------------------------
watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    inputRef.value?.focus()
  }
})

// ---------------------------------------------------------------------------
// 提交留言
// ---------------------------------------------------------------------------
function submit() {
  const content = text.value.trim()
  if (!content) return

  messageStore.addMessage(props.targetIndex, {
    content,
    userName: localUser.name,
    userColor: localUser.color,
  })

  text.value = ''
  emit('toast', '留言已发送 ✨')

  // 滚动到底部
  nextTick(() => {
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight
    }
  })
}

function close() {
  emit('close')
}

function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<style scoped>
/* ---- 背景遮罩 ---- */
.messageboard-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

/* ---- 面板 ---- */
.messageboard-panel {
  width: 100%;
  max-width: 480px;
  max-height: 70vh;
  background: #1e293b;
  border-radius: 20px 20px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: var(--safe-area-bottom, 0px);
}

/* ---- 标题栏 ---- */
.mb-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.mb-emoji { font-size: 24px; }
.mb-title { font-size: 18px; font-weight: 700; color: #fff; }
.mb-count { font-size: 13px; color: #94a3b8; }
.mb-close {
  margin-left: auto;
  width: 32px; height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.08);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ---- 留言列表 ---- */
.mb-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 20px;
  -webkit-overflow-scrolling: touch;
}

.mb-empty { text-align: center; padding: 32px 0; color: #94a3b8; }
.mb-empty-hint { font-size: 13px; margin-top: 4px; }

.mb-message {
  padding: 10px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.mb-message:last-child { border-bottom: none; }

.mb-msg-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.mb-msg-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.mb-msg-author { font-size: 13px; color: #fff; font-weight: 600; }
.mb-msg-time { font-size: 11px; color: #64748b; }
.mb-msg-content {
  font-size: 15px; color: #e2e8f0; margin: 0; word-break: break-word;
}

/* ---- 输入行 ---- */
.mb-input-row {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid rgba(255,255,255,0.06);
}

.mb-input {
  flex: 1;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.06);
  color: #fff;
  font-size: 15px;
  outline: none;
}
.mb-input::placeholder { color: rgba(255,255,255,0.3); }

.mb-send {
  padding: 10px 20px;
  border-radius: 12px;
  border: none;
  background: #6366f1;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
.mb-send:active { background: #4f46e5; }
.mb-send:disabled { opacity: 0.4; }

/* ---- Transition ---- */
.modal-enter-active, .modal-leave-active {
  transition: opacity 0.25s ease;
}
.modal-enter-active .messageboard-panel,
.modal-leave-active .messageboard-panel {
  transition: transform 0.25s ease;
}
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .messageboard-panel,
.modal-leave-to .messageboard-panel {
  transform: translateY(100%);
}
</style>
