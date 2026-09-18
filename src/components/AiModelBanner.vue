<script setup lang="ts">
/**
 * AI 模型就绪状态横幅：挂在抠图 / 证件照 / 超分 / 美颜等需要模型的工具顶部。
 *
 * 与首页 hero 的"预下载"不同，这里是进入工具后贴身可见的进度反馈，核心传达一件事：
 * 模型在后台共享下载 / 预热，切去其他工具不会中断，回来即可用——把"等模型"变成
 * "可离开"的闭环，而不是把用户钉在一次等待上。
 */
import { computed } from 'vue'
import { prepareAiModel, aiModel } from '../utils/aiModel'

const stage = computed(() => aiModel.stage)

const percent = computed(() => aiModel.percent)

const statusText = computed(() => {
  if (stage.value === 'downloading' || stage.value === 'warming') {
    return aiModel.message
  }
  return aiModel.message || 'AI 模型未就绪'
})

/** 进度阶段：下载中 / 预热中 */
const inProgress = computed(
  () => stage.value === 'downloading' || stage.value === 'warming',
)

function start() {
  prepareAiModel().catch(() => {})
}
</script>

<template>
  <div class="ai-banner" :class="'ai-banner--' + stage">
    <template v-if="inProgress">
      <div class="ai-banner-row">
        <span class="ai-banner-dot" aria-hidden="true"></span>
        <span class="ai-banner-text">
          <b>正在后台就绪 AI 模型</b> {{
            Math.round(percent)
          }}% · 可先去其他工具，完成回来即可用
        </span>
      </div>
      <div class="progress-bar is-mini ai-banner-bar">
        <div class="progress-inner" :style="{ width: percent + '%' }"></div>
      </div>
    </template>

    <template v-else-if="stage === 'error'">
      <div class="ai-banner-row">
        <span class="ai-banner-text">{{ statusText }}</span>
        <button class="ai-banner-action" @click="start">重试</button>
      </div>
    </template>

    <template v-else-if="stage === 'idle'">
      <div class="ai-banner-row">
        <span class="ai-banner-dot" aria-hidden="true"></span>
        <span class="ai-banner-text">
          首次使用需就绪 AI 模型，<b>下载期间可先去其他工具</b>，完成回来即可用
        </span>
        <button class="ai-banner-action" @click="start">预下载</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ai-banner {
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(79, 110, 247, 0.06);
  border: 1px solid rgba(79, 110, 247, 0.2);
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-main);
}

.ai-banner--error {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.25);
}

.ai-banner-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ai-banner-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
}

.ai-banner-text {
  flex: 1;
  min-width: 0;
}

.ai-banner-action {
  flex-shrink: 0;
  padding: 4px 12px;
  border: 0;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.ai-banner--error .ai-banner-action {
  background: #ef4444;
}

.ai-banner-action:active {
  transform: scale(0.96);
}

.ai-banner-bar {
  height: 4px;
}
</style>