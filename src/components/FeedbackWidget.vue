<script setup lang="ts">
import { ref } from 'vue'
import { showToast } from '../utils/toast'

/**
 * 全局意见反馈入口：右下角一枚低调的「反馈」胶囊，点开是一个小弹窗。
 * 纯前端工具没有后端，反馈以「复制到剪贴板」落地——用户可黏贴到任意渠道。
 * 首屏不抢占注意力：只有用户点开后才有内容，不弹引导条。
 */
const open = ref(false)
const text = ref('')
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

function clear() {
  text.value = ''
}

async function copyFeedback() {
  const content = text.value.trim()
  if (!content) {
    showToast('先写点内容再复制呀', 'error')
    return
  }
  try {
    await navigator.clipboard.writeText(content)
    showToast('已复制，可在任意地方粘贴提交', 'success')
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1600)
  } catch {
    showToast('复制失败', 'error')
  }
}
</script>

<template>
  <div class="fb-root">
    <!-- 触发胶囊：朴素小巧，不打扰 -->
    <button class="fb-trigger" @click="toggle">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-9 8.35 8.8 8.8 0 0 1-3.4-.7L3 21l1.85-5.6a8.38 8.38 0 1 1 16.15-3.9Z" />
      </svg>
      <span>反馈</span>
    </button>

    <!-- 反馈弹窗 -->
    <Transition name="fb-pop">
      <div v-if="open" class="fb-mask" @click.self="close">
        <div class="fb-panel" role="dialog" aria-label="意见反馈">
          <div class="fb-head">
            <span class="fb-title">意见反馈</span>
            <button class="fb-close" @click="close" aria-label="关闭">×</button>
          </div>
          <p class="fb-desc">告诉我们哪里好用、哪里卡手、还想要什么功能。</p>

          <div class="fb-note">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 8h.01" />
            </svg>
            <span>本工具纯本地运行、没有服务器。写下内容后点「复制反馈」，粘贴到微信、邮件等任意渠道发给我们即可。</span>
          </div>

          <textarea
            v-model="text"
            class="fb-input"
            rows="4"
            maxlength="1000"
            placeholder="例如：希望拼图能自由调整每格比例…"
          ></textarea>

          <div class="fb-foot">
            <button class="fb-clear" @click="clear">清空</button>
            <button class="btn btn-primary fb-submit" :class="{ copied }" @click="copyFeedback">
              <span v-if="copied">
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                已复制，去粘贴
              </span>
              <template v-else>复制反馈</template>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fb-root {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
}

/* 触发胶囊：小、素、不抢视线 */
.fb-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 13px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--text-sub);
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(31, 41, 55, 0.08);
  transition: transform 0.15s, box-shadow 0.15s, color 0.15s;
}

.fb-trigger:hover {
  color: var(--primary);
  transform: translateY(-2px);
}

.fb-trigger:active {
  transform: scale(0.95);
}

/* 弹窗 */
.fb-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(31, 41, 55, 0.32);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.fb-panel {
  width: min(440px, 100%);
  background: #fff;
  border-radius: 18px;
  padding: 18px 20px;
  box-shadow: 0 24px 70px rgba(31, 41, 55, 0.28);
}

.fb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.fb-title {
  font-size: 16px;
  font-weight: 650;
  color: var(--text-main);
}

.fb-close {
  border: none;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  color: var(--text-sub);
  cursor: pointer;
  padding: 2px 6px;
}

.fb-desc {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-sub);
}

/* 说明条：把「复制去粘贴」的机制讲在前面，避免按钮点完才明白为什么不是提交 */
.fb-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--gradient-soft);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-main);
}

.fb-note svg {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--primary);
}

.fb-input {
  width: 100%;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-main);
  resize: none;
  box-sizing: border-box;
  font-family: inherit;
}

.fb-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent);
}

.fb-foot {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 「清空」降级为文字链，弱化误触风险 */
.fb-clear {
  border: none;
  background: transparent;
  padding: 6px 2px;
  color: var(--text-sub);
  font-size: 13px;
  cursor: pointer;
}
.fb-clear:hover {
  color: var(--text-main);
}

.fb-submit {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.btn.copied {
  color: var(--primary);
  background: var(--gradient-soft);
}

.fb-pop-enter-active,
.fb-pop-leave-active {
  transition: opacity 0.2s ease;
}

.fb-pop-enter-from,
.fb-pop-leave-to {
  opacity: 0;
}
</style>