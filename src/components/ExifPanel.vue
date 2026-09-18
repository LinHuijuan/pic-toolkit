<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ExifInfo } from '../utils/exif'
import { showToast } from '../utils/toast'

/** 拍摄信息 → 可展示的键值对；没有可读字段时返回空数组，渲染端据此隐藏整块面板 */
const entries = computed<[string, string][]>(() => {
  const info = props.info
  if (!info) return []
  const map: [string, string][] = []
  if (info.datetime) map.push(['拍摄时间', info.datetime])
  if (info.make && info.model) map.push(['设备', `${info.make} ${info.model}`])
  else if (info.model) map.push(['设备', info.model])
  else if (info.make) map.push(['品牌', info.make])
  if (info.exposure) map.push(['快门', info.exposure])
  if (info.fnumber) map.push(['光圈', info.fnumber])
  if (info.iso) map.push(['感光度', info.iso])
  if (info.focalLength) map.push(['焦距', info.focalLength])
  if (info.gps) map.push(['位置', info.gps])
  return map
})

const props = withDefaults(defineProps<{ info: ExifInfo | null }>(), {})

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

/** 把全部拍摄信息拼成多行文本并复制到剪贴板 */
async function copyEntries() {
  const text = entries.value.map(([label, value]) => `${label}：${value}`).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    showToast('已复制拍摄信息', 'success')
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1600)
  } catch {
    showToast('复制失败', 'error')
  }
}
</script>

<template>
  <div v-if="entries.length" class="card">
    <div class="card-head">
      <div class="card-title">拍摄信息</div>
      <button class="copy-btn" :class="{ copied }" @click="copyEntries">
        {{ copied ? '已复制' : '复制' }}
      </button>
    </div>
    <div class="exif-list">
      <div v-for="[label, value] in entries" :key="label" class="exif-row">
        <span class="exif-label">{{ label }}</span>
        <span class="exif-value">{{ value }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}

/* 复制按钮：小巧的朴素样式，避免抢视觉焦点 */
.copy-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-page);
  color: var(--text-sub);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.copy-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-light);
}

.copy-btn.copied {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-light);
}

.exif-list {
  display: flex;
  flex-direction: column;
}

.exif-row {
  display: flex;
  gap: 16px;
  padding: 5px 0;
  font-size: 13px;
}

.exif-row + .exif-row {
  border-top: 1px dashed var(--border);
}

.exif-label {
  flex: 0 0 72px;
  color: var(--text-sub);
}

.exif-value {
  color: var(--text-main);
  word-break: break-all;
}
</style>