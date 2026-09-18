<script setup lang="ts">
import { ref } from 'vue'
import { recentBatches, clearRecent } from '../utils/recent'
import { saveMany } from '../utils/zip'

const open = ref(false)

function toggle() {
  open.value = !open.value
}

function redownload(files: File[], zipName: string) {
  void saveMany(files, zipName)
}

/** 时间显示：几分钟内给「刚刚」，否则给「x 分钟/小时前」 */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="recent-wrap" :class="{ open }">
    <!-- 面板 -->
    <Transition name="recent-pop">
      <div v-if="open" class="recent-mask" @click.self="open = false">
        <div class="recent-panel" role="dialog" aria-label="最近处理">
        <div class="recent-head">
          <span class="recent-head-title">最近处理</span>
          <div class="recent-head-actions">
            <button v-if="recentBatches.length" class="recent-clear" @click="clearRecent">清空</button>
            <button class="recent-close" aria-label="关闭" @click="open = false">×</button>
          </div>
        </div>

        <div v-if="!recentBatches.length" class="recent-empty">
          还没导出记录——处理完图片会自动收在这里，可随时重新下载。
        </div>

        <ul v-else class="recent-list">
          <li v-for="item in recentBatches" :key="item.id" class="recent-item">
            <img class="recent-cover" :src="item.coverUrl" alt="" loading="lazy" />
            <div class="recent-meta">
              <div class="recent-name" :title="item.zipName">
                {{ item.count > 1 ? `${item.zipName.replace(/\.zip$/, '')}（${item.count} 张）` : item.files[0]?.name }}
              </div>
              <div class="recent-sub">{{ timeAgo(item.ts) }} · {{ fmtSize(item.files.reduce((s, f) => s + f.size, 0)) }}</div>
            </div>
            <button class="recent-dl" title="重新下载" @click="redownload(item.files, item.zipName)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 4v12M7 11l5 5 5-5M5 19h14" />
              </svg>
            </button>
          </li>
        </ul>
        </div>
      </div>
    </Transition>

    <!-- 触发入口：放置在页面流内（首页底部功能链接），不再悬浮遮挡内容 -->
    <button class="recent-trigger" :aria-expanded="open" @click="toggle" title="最近处理">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </svg>
      <span>最近</span>
      <span v-if="recentBatches.length" class="recent-badge">{{ recentBatches.length }}</span>
    </button>
  </div>
</template>

<style scoped>
.recent-wrap {
  display: inline-flex;
  /* 跟随布局流，不再悬浮遮挡内容 */
}

.recent-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 13px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.85);
  color: var(--text-sub);
  font-size: 12px;
  cursor: pointer;
  transition: transform 0.15s, color 0.15s, border-color 0.15s;
}

.recent-trigger:hover {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 30%, transparent);
  transform: translateY(-1px);
}

.recent-trigger svg {
  width: 15px;
  height: 15px;
}

.recent-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
}

/* 全屏遮罩：承载面板定位与点击关闭 */
.recent-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(31, 41, 55, 0.32);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 22vh 20px 20px;
}

.recent-panel {
  width: 300px;
  max-width: calc(100vw - 32px);
  max-height: 70vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-radius: 18px;
  background: #fff;
  border: 1px solid var(--border);
  box-shadow: 0 18px 48px rgba(31, 41, 55, 0.2);
  margin: 0;
}

.recent-pop-enter-active,
.recent-pop-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.recent-pop-enter-from,
.recent-pop-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

.recent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
}

.recent-head-title {
  font-size: 14px;
  font-weight: 700;
}

.recent-head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.recent-clear {
  border: none;
  background: transparent;
  color: var(--text-sub);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}

.recent-clear:hover {
  background: rgba(0, 0, 0, 0.05);
}

.recent-close {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-sub);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  border-radius: 8px;
}

.recent-close:hover {
  background: rgba(0, 0, 0, 0.05);
}

.recent-empty {
  padding: 22px 20px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-sub);
  text-align: center;
}

.recent-list {
  list-style: none;
  margin: 0;
  padding: 0 12px 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 12px;
  transition: background 0.15s;
}

.recent-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.recent-cover {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border);
  background: #f3f4f6;
}

.recent-meta {
  min-width: 0;
  flex: 1;
}

.recent-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-sub {
  font-size: 11px;
  color: var(--text-sub);
  margin-top: 2px;
}

.recent-dl {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-sub);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.recent-dl:hover {
  color: var(--primary);
  background: rgba(79, 110, 247, 0.1);
}

.recent-dl svg {
  width: 17px;
  height: 17px;
}
</style>