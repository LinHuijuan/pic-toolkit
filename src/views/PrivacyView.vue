<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  getStorageStats,
  clearAppCache,
  formatBytes,
  cacheBucketLabel,
  type StorageStat,
} from '../utils/storageInfo'
import { showToast } from '../utils/toast'

const emit = defineEmits<{ back: [] }>()

const stat = ref<StorageStat | null>(null)
const loading = ref(true)
const cleaning = ref(false)
/** 二次确认：先点「清空」变确认态，再点一次才执行 */
const confirmClear = ref(false)

/** 是否以「已安装 PWA / 生产构建」运行：这决定模型资源会不会进 CacheStorage 被统计 */
const swActive = ref(false)

async function loadStats() {
  loading.value = true
  try {
    stat.value = await getStorageStats()
  } catch {
    stat.value = null
  } finally {
    loading.value = false
  }
}

async function doClear() {
  if (cleaning.value) return
  cleaning.value = true
  try {
    await clearAppCache()
    showToast('已清空本地缓存', 'success')
    confirmClear.value = false
    await loadStats()
  } catch {
    showToast('清理失败，请重试', 'error')
  } finally {
    cleaning.value = false
  }
}

onMounted(() => {
  // 生产构建会注册 Service Worker，模型资源随之进 CacheStorage、可被统计；
  // dev/preview 没有 SW，只能据实区分展示，避免给出「假」的个位数
  try {
    navigator.serviceWorker?.getRegistration().then((reg) => (swActive.value = !!reg))
  } catch {
    swActive.value = false
  }
  window.scrollTo(0, 0)
  loadStats()
})

/** 配额占用比例（封顶 100，避免少数字节让进度条溢出） */
const storePercent = computed(() => {
  const s = stat.value
  if (!s || !s.quota) return 0
  return Math.min(100, Math.round((s.totalUsage / s.quota) * 100))
})
</script>

<template>
  <div class="app-shell">
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">隐私说明</div>
    </div>

    <div class="page-content privacy-page">
      <section class="privacy-hero">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="url(#icon-grad)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3.5 5 6v5c0 4.4 2.9 8.2 7 9.5 4.1-1.3 7-5.1 7-9.5V6l-7-2.5Z" />
          <path d="m9 11.5 2.2 2.2L15.5 9.5" />
        </svg>
        <h1>你的图片，全程只在你自己的设备上处理</h1>
        <p class="privacy-lead">开发者不知道、也不会知道你的图片里有什么。</p>
      </section>

      <div class="card">
        <div class="card-title">为什么我可以放心用</div>
        <div class="privacy-item">
          <h3>1. 图片不离开你的设备</h3>
          <p>所有的解码、裁剪、抠图、放大、压缩、水印、拼接、改色，全部在你浏览器的本地完成。你的原图和处理结果都不会被上传到任何服务器。</p>
        </div>
        <div class="privacy-item">
          <h3>2. 这是一个纯前端应用</h3>
          <p>整个工具箱是静态网页，没有后端接口、不需要登录、不采集账号信息。打开网页就能用，关掉即结束，不留下你的图片。</p>
        </div>
        <div class="privacy-item">
          <h3>3. 只有模型是现成的，图片不是</h3>
          <p>AI 抠图用到一个开源的背景分割模型，需要从网络下载一次（16 位高精度档约 84MB），但模型是公开通用代码，不包含你的任何图片。可离线使用，下载只在首次用到时发生一次，之后无需联网。</p>
        </div>
        <div class="privacy-item">
          <h3>4. 断网也能用</h3>
          <p>作为 PWA 安装后，常用资源和不含图片的处理逻辑都可以离线运行。你的隐私不需要躲在云端，本地就是最安全的地方。</p>
        </div>
      </div>

      <div class="card">
        <div class="card-title">数据与本地存储</div>
        <div class="privacy-item">
          <h3>浏览器本地保存</h3>
          <p>为记住设置与“最近使用”，页面会在你的浏览器本地（localStorage）保存一些非图片信息（例如 AI 模型是否已就绪、上次的偏好）。这些只存你自己的设备，可随时通过清除浏览器站点数据抹除。</p>
        </div>
        <div class="privacy-item">
          <h3>结果依然在你手里</h3>
          <p>导出的成品通过浏览器的“另存为 / 下载”落到你的磁盘，或者通过系统分享面板发给好友——同样不经过服务端。</p>
        </div>
      </div>

      <div class="card">
        <div class="card-title">本地缓存用量</div>

        <div v-if="loading" class="store-loading">正在统计…</div>

        <template v-else>
          <!-- 各缓存分桶 -->
          <div v-if="stat && stat.caches.length" class="store-bucket">
            <div v-for="b in stat.caches" :key="b.name" class="store-row">
              <span class="store-name">{{ cacheBucketLabel(b.name) }}</span>
              <span class="store-size">{{ formatBytes(b.size) }}</span>
            </div>
          </div>
          <p v-else class="store-empty">
            {{ swActive
              ? '暂无缓存分桶，AI 模型将在首次使用时自动缓存并计入统计。'
              : '当前为网页预览模式，AI 模型等大资源存于浏览器网络缓存，不计入上方配额。「安装到桌面」后会纳入统计。' }}
          </p>

          <!-- 站点总计与配额占用 -->
          <template v-if="stat && stat.quota > 0">
            <div class="store-total">
              <span>站点总计占用</span>
              <span>{{ formatBytes(stat.totalUsage) }} / {{ formatBytes(stat.quota) }}</span>
            </div>
            <div class="store-bar">
              <div class="store-bar-fill" :style="{ width: storePercent + '%' }"></div>
            </div>
          </template>
          <div v-else class="store-total">
            <span>站点总计占用</span>
            <span>{{ stat ? formatBytes(stat.totalUsage) : '—' }}</span>
          </div>

          <div class="store-actions">
            <button
              v-if="!confirmClear"
              class="btn btn-outline btn-sm"
              :disabled="cleaning"
              @click="confirmClear = true"
            >
              清空本地缓存
            </button>
            <template v-else>
              <button class="btn btn-danger btn-sm" :disabled="cleaning" @click="doClear">
                {{ cleaning ? '清理中…' : '确认清空' }}
              </button>
              <button class="btn btn-outline btn-sm" :disabled="cleaning" @click="confirmClear = false">
                取消
              </button>
            </template>
          </div>
          <p class="store-note">清空后 AI 模型下次用到会重新下载，应用壳与临时任务一并清除，不影响你的偏好设置。</p>
        </template>
      </div>

      <p class="privacy-foot">如果你关心任何一项，也可以随时通过页面右下角的「反馈」告诉我们。</p>
    </div>
  </div>
</template>

<style scoped>
.privacy-page {
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 20px 96px;
  box-sizing: border-box;
}

.privacy-hero {
  text-align: center;
  padding: 12px 0 24px;
}

.privacy-hero svg {
  margin: 0 auto 12px;
  display: block;
  color: #4f6ef7;
}

.privacy-hero h1 {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.4;
  color: var(--text-main);
  margin: 0;
}

.privacy-lead {
  margin-top: 8px;
  font-size: 14px;
  color: var(--text-sub);
}

.card-title {
  margin-bottom: 6px;
}

.privacy-item {
  padding: 10px 0;
}

.privacy-item + .privacy-item {
  border-top: 1px dashed var(--border);
}

.privacy-item h3 {
  font-size: 15px;
  font-weight: 650;
  color: var(--text-main);
  margin: 0 0 4px;
}

.privacy-item p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-sub);
}

.privacy-foot {
  margin-top: 24px;
  font-size: 13px;
  color: #9aa3b5;
  text-align: center;
}

/* ---- 本地缓存用量 ---- */
.store-loading {
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-sub);
}

.store-empty {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--text-sub);
}

.store-bucket {
  border-top: 1px dashed var(--border);
  margin-top: 4px;
}

.store-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  font-size: 14px;
}

.store-row + .store-row {
  border-top: 1px dashed var(--border);
}

.store-name {
  color: var(--text-main);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.store-size {
  color: var(--text-sub);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.store-total {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
}

.store-total span:last-child {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.store-bar {
  margin-top: 10px;
  height: 6px;
  border-radius: 999px;
  background: var(--bg-page);
  overflow: hidden;
}

.store-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #4f6ef7, #22d3ee);
  transition: width 0.4s ease;
}

.store-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.store-note {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-sub);
}
</style>