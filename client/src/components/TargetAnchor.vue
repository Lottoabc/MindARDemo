<!--
  TargetAnchor.vue — 单个追踪目标的 DOM 锚点
  ============================================================================
  每个被 MindAR 追踪到的 targetIndex 对应一个 TargetAnchor 实例。

  它通过 useCoordinateProjector.bindTracking() 将 MindAR 的 3D 追踪位置
  实时转换为 2D 屏幕坐标，驱动 DOM 元素"贴"在参照物上方。

  显示内容：
    - 关联的 emoji（大号，居中显示在参照物上方）
    - 该目标的所有留言（从 MessageStore 读取）
    - 快捷留言输入框

  Props:
    - targetIndex: 目标索引
    - anchorEl: mindar-image-target 的 DOM 元素

  层级：
    固定在整个屏幕之上 (position: fixed)，通过 left/top 跟随追踪位置。
-->
<template>
  <div
    class="target-anchor"
    :class="{ 'anchor-visible': isTracked && screenPos.visible }"
    :style="anchorStyle"
  >
    <!-- Emoji 展示（大号，居中） -->
    <div class="anchor-emoji" @click="cycleEmoji">
      {{ currentEmoji }}
    </div>

    <!-- 留言列表 -->
    <div v-if="messages.length > 0" class="anchor-messages">
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="anchor-message"
        :style="{ borderLeftColor: msg.userColor }"
      >
        <span class="msg-text">{{ msg.content }}</span>
        <span class="msg-meta">{{ msg.userName }}</span>
      </div>
    </div>

    <!-- 快捷留言输入 -->
    <div v-if="isTracked" class="anchor-input-row">
      <input
        ref="inputRef"
        v-model="newMessage"
        class="anchor-input"
        placeholder="留言..."
        maxlength="60"
        @keyup.enter="submitMessage"
        @focus="onInputFocus"
      />
      <button
        class="anchor-send-btn"
        @click="submitMessage"
        :disabled="!newMessage.trim()"
      >
        发送
      </button>
    </div>
  </div>
</template>

<script setup>
/**
 * TargetAnchor 负责：
 *   1. 通过 useCoordinateProjector 将 3D 追踪位置实时转为屏幕坐标
 *   2. 渲染当前目标的 emoji + 留言列表
 *   3. 提供快捷留言输入
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useCoordinateProjector } from '../composables/useCoordinateProjector.js'
import { useMessageStore } from '../stores/useMessageStore.js'
import { useTargetStore } from '../stores/useTargetStore.js'
import { useCollaboration } from '../composables/useCollaboration.js'

const props = defineProps({
  targetIndex: { type: Number, required: true },
  anchorEl: { type: Object, default: null },
})

const emit = defineEmits(['toast'])

const { bindTracking } = useCoordinateProjector()
const messageStore = useMessageStore()
const targetStore = useTargetStore()
const { localUser } = useCollaboration()

// ---------------------------------------------------------------------------
// 屏幕坐标（每帧更新）
// ---------------------------------------------------------------------------
const screenPos = ref({ x: 0, y: 0, visible: false })

// ---------------------------------------------------------------------------
// 追踪状态
// ---------------------------------------------------------------------------
const isTracked = ref(false)

// ---------------------------------------------------------------------------
// 留言输入
// ---------------------------------------------------------------------------
const newMessage = ref('')
const inputRef = ref(null)

// ---------------------------------------------------------------------------
// Emoji 选择器
// ---------------------------------------------------------------------------
const EMOJI_POOL = ['📌', '😊', '❤️', '🔥', '⭐', '💡', '🎉', '💬', '👍', '🌸']

const currentEmoji = computed(() => {
  return targetStore.targetEmojis[props.targetIndex] || '📌'
})

function cycleEmoji() {
  const current = currentEmoji.value
  const idx = EMOJI_POOL.indexOf(current)
  const next = EMOJI_POOL[(idx + 1) % EMOJI_POOL.length]
  targetStore.setTargetEmoji(props.targetIndex, next)
}

// ---------------------------------------------------------------------------
// 留言列表
// ---------------------------------------------------------------------------
const messages = computed(() => messageStore.getMessages(props.targetIndex))

// ---------------------------------------------------------------------------
// 3D → 2D 追踪绑定
// ---------------------------------------------------------------------------
const anchorStyle = computed(() => ({
  left: `${screenPos.value.x}px`,
  top: `${screenPos.value.y}px`,
}))

let unbindTracking = null

onMounted(() => {
  if (props.anchorEl) {
    // 监听 A-Frame 实体上的 targetFound/targetLost
    props.anchorEl.addEventListener('targetFound', onTargetFound)
    props.anchorEl.addEventListener('targetLost', onTargetLost)

    // 启动每帧坐标更新
    unbindTracking = bindTracking(props.anchorEl, screenPos)
  }
})

onBeforeUnmount(() => {
  unbindTracking?.()
  if (props.anchorEl) {
    props.anchorEl.removeEventListener('targetFound', onTargetFound)
    props.anchorEl.removeEventListener('targetLost', onTargetLost)
  }
})

// 监听 anchorEl 变化（热交换后 anchor 会被替换）
watch(() => props.anchorEl, (newEl, oldEl) => {
  // 解绑旧元素
  unbindTracking?.()
  if (oldEl) {
    oldEl.removeEventListener('targetFound', onTargetFound)
    oldEl.removeEventListener('targetLost', onTargetLost)
  }

  // 绑定新元素
  if (newEl) {
    newEl.addEventListener('targetFound', onTargetFound)
    newEl.addEventListener('targetLost', onTargetLost)
    unbindTracking = bindTracking(newEl, screenPos)
  }
})

function onTargetFound() {
  isTracked.value = true
  targetStore.targetStates?.[props.targetIndex] && (targetStore.targetStates[props.targetIndex] = true)
}

function onTargetLost() {
  isTracked.value = false
}

// ---------------------------------------------------------------------------
// 留言提交
// ---------------------------------------------------------------------------
function submitMessage() {
  const text = newMessage.value.trim()
  if (!text) return

  messageStore.addMessage(props.targetIndex, {
    content: text,
    userName: localUser.name,
    userColor: localUser.color,
  })

  // 也通过 Socket.IO 广播给其他协同用户
  const { addElement } = useCollaboration()
  addElement('text', text, {
    x: (screenPos.value.x / window.innerWidth) * 100,
    y: (screenPos.value.y / window.innerHeight) * 100,
  })

  newMessage.value = ''
  emit('toast', '留言已发送 ✨')
}

function onInputFocus() {
  // iOS Safari: 输入框聚焦时页面可能上移，不做特殊处理
}
</script>

<style scoped>
.target-anchor {
  position: fixed;
  transform: translate(-50%, -120%);
  pointer-events: auto;
  opacity: 0;
  transition: opacity 200ms ease;
  z-index: 15;
  max-width: 260px;
}

.anchor-visible {
  opacity: 1;
}

/* ---- Emoji ---- */
.anchor-emoji {
  font-size: 48px;
  text-align: center;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5));
  transition: transform 0.15s ease;
}
.anchor-emoji:active {
  transform: scale(1.2);
}

/* ---- 留言列表 ---- */
.anchor-messages {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.anchor-message {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: 8px;
  padding: 6px 10px;
  border-left: 3px solid #6366f1;
}

.msg-text {
  font-size: 13px;
  color: #fff;
  word-break: break-word;
  display: block;
}

.msg-meta {
  font-size: 10px;
  color: rgba(255,255,255,0.5);
  margin-top: 2px;
  display: block;
}

/* ---- 输入行 ---- */
.anchor-input-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.anchor-input {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #fff;
  font-size: 14px;
  outline: none;
  min-width: 0;
}
.anchor-input::placeholder {
  color: rgba(255,255,255,0.4);
}

.anchor-send-btn {
  padding: 8px 14px;
  border-radius: 8px;
  border: none;
  background: #6366f1;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.anchor-send-btn:active {
  background: #4f46e5;
}
.anchor-send-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
