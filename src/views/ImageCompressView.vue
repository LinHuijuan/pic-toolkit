<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, downloadBlob, type LoadedImage } from '../utils/imageLoader'
import { compressBitmap, compressToTargetSize } from '../utils/imageCompress'
import { showToast } from '../utils/toast'
import { fetchSampleFiles } from '../utils/sampleImage'

const emit = defineEmits<{ back: []; consumed: [] }>()

const props = defineProps<{ incomingFile?: File | null }>()

// 全站拖拽上传：把图片拖到页面任意位置导入当前工具
useImageDrop((files) => {
  if (files.length) processFiles(files)
})

const fileInput = ref<HTMLInputElement | null>(null)
const items = ref<CompressItem[]>([])
const mode = ref<'quality' | 'target'>('quality')
const quality = ref(70) // 百分比
const targetSize = ref(500) // 目标体积（KB）
const processing = ref(false)
const doneCount = ref(0)
const limitMaxSide = ref(false)
const maxDimension = ref(1920) // 最长边限制（px）

interface CompressItem {
  id: number
  source: LoadedImage
  originalSize: number
  compressed?: {
    blob: Blob
    type: string
    width: number
    height: number
  }
  compressedSize?: number
  /** 压缩结果预览 URL（objectURL，替换 / 卸载时需释放） */
  previewUrl?: string
  /** 源图预览 dataURL（选图时生成一次，避免 computed 全量重复 toDataURL） */
  fallbackUrl: string
  error?: string
}

let idSeed = 0

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5l-5-5Z"/><path d="M14 2.5v5h5"/><path d="m9 15.5 3-3 3 3M12 12.5v6"/></svg>`

function pickImages() {
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length === 0) return
  try {
    await processFiles(files)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
  } finally {
    input.value = ''
  }
}

/** 加载并压缩一组图片 */
async function processFiles(files: File[]) {
  for (const file of files) {
    const source = await loadImageFromFile(file)
    items.value.push({
      id: idSeed++,
      source,
      originalSize: file.size,
      fallbackUrl: fallbackDataUrl(source),
    })
  }
  await runCompress()
}

/** 一键载入内置示例图体验完整流程 */
async function loadSample() {
  try {
    const files = await fetchSampleFiles('scene', 2)
    await processFiles(files)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '示例图加载失败', 'error')
  }
}

// 接收其他工具流转过来的图片（如图片编辑 → 压缩）
onMounted(() => {
  if (props.incomingFile) {
    processFiles([props.incomingFile]).catch((error) => {
      showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
    })
    emit('consumed')
  }
})

/** 重新压缩全部未压缩/已压缩的图片 */
async function runCompress() {
  if (processing.value || items.value.length === 0) return
  processing.value = true
  doneCount.value = 0
  try {
    const maxDim = resolveMaxDimension()
    for (const item of items.value) {
      try {
        let result
        if (mode.value === 'target') {
          result = await compressToTargetSize(item.source.bitmap, targetSize.value * 1024, maxDim)
          // 透明 PNG 为无损格式，无法按目标体积压缩
          if (result.type === 'image/png' && result.blob.size > targetSize.value * 1024) {
            throw new Error('透明 PNG 无法按目标体积压缩，请改用质量模式')
          }
        } else {
          result = await compressBitmap(item.source.bitmap, {
            quality: quality.value / 100,
            maxDimension: maxDim,
          })
        }
        item.compressed = {
          blob: result.blob,
          type: result.type,
          width: result.width,
          height: result.height,
        }
        item.compressedSize = result.blob.size
        item.error = undefined
        setPreviewUrl(item, URL.createObjectURL(result.blob))
      } catch (error) {
        item.error = error instanceof Error ? error.message : '压缩失败'
      }
      doneCount.value++
    }
  } finally {
    processing.value = false
  }
}

function saveAll() {
  const ready = items.value.filter((item) => item.compressed && !item.error)
  if (ready.length === 0) return
  ready.forEach((item, index) => {
    setTimeout(() => {
      const ext = item.compressed!.type === 'image/jpeg' ? 'jpg' : 'png'
      downloadBlob(item.compressed!.blob, `${item.source.name}_压缩.${ext}`)
    }, index * 300)
  })
  showToast('已开始下载', 'success')
}

/** 单张保存压缩结果 */
function saveOne(item: CompressItem) {
  if (!item.compressed || item.error) return
  const ext = item.compressed.type === 'image/jpeg' ? 'jpg' : 'png'
  downloadBlob(item.compressed.blob, `${item.source.name}_压缩.${ext}`)
  showToast('已开始下载', 'success')
}

/** 替换预览 URL，释放旧的 objectURL */
function setPreviewUrl(item: CompressItem, url: string) {
  if (item.previewUrl) {
    URL.revokeObjectURL(item.previewUrl)
  }
  item.previewUrl = url
}

/** 解析最长边限制：开关关闭或输入非法时不限制 */
function resolveMaxDimension(): number | undefined {
  if (!limitMaxSide.value) return undefined
  const value = Number(maxDimension.value)
  if (!Number.isFinite(value) || value < 1) return undefined
  return Math.round(value)
}

// 组件卸载时释放全部预览 objectURL 与源图 bitmap
onUnmounted(() => {
  items.value.forEach((item) => {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl)
    }
    try {
      item.source.bitmap.close()
    } catch {
      /* bitmap 已关闭，忽略 */
    }
  })
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`
}

function percentOf(item: CompressItem): number {
  if (!item.compressedSize || item.originalSize === 0) return 0
  return Math.round((1 - item.compressedSize / item.originalSize) * 100)
}

/** 采样检测图片是否含透明像素（缩小后采样，兼顾性能） */
function hasAlpha(bitmap: ImageBitmap): boolean {
  const w = 48
  const h = 48
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(bitmap, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true
  }
  return false
}

/** 生成智能压缩建议（基于图像尺寸、透明通道与整体体积的启发式分析） */
function analyzeSuggestions() {
  const list = items.value
  const maxDim = list.reduce((m, it) => Math.max(m, it.source.width, it.source.height), 0)
  const totalOriginal = list.reduce((s, it) => s + it.originalSize, 0)
  const avgSize = list.length ? totalOriginal / list.length : 0
  const hasTransparent = list.some((it) => hasAlpha(it.source.bitmap))

  const parts: string[] = []
  let quality = 70
  let limitMaxSide = false
  let maxDimension = 1920
  let targetSize = 500

  if (maxDim > 4096) {
    limitMaxSide = true
    maxDimension = maxDim > 8192 ? 2560 : 1920
    parts.push(`长边 ${maxDim}px 过大，限制到 ${maxDimension}px`)
  } else if (maxDim > 2560) {
    limitMaxSide = true
    maxDimension = 2560
    parts.push(`长边 ${maxDim}px 偏高，限制到 2560px`)
  }

  if (avgSize > 3 * 1024 * 1024) {
    quality = 60
    parts.push('图片较大，采用 60% 质量')
  } else if (avgSize > 1024 * 1024) {
    quality = 70
    parts.push('图片较大，采用 70% 质量')
  } else {
    quality = 85
    parts.push('图片不大，采用 85% 质量')
  }

  if (hasTransparent) {
    parts.push('含透明 PNG，用质量模式保留透明')
  }

  return { quality, limitMaxSide, maxDimension, targetSize, reason: parts.join('，') }
}

/** 一键应用 AI 智能压缩建议 */
function applySuggest() {
  if (items.value.length === 0) return
  const s = analyzeSuggestions()
  mode.value = 'quality'
  quality.value = s.quality
  limitMaxSide.value = s.limitMaxSide
  maxDimension.value = s.maxDimension
  targetSize.value = s.targetSize
  runCompress()
  showToast(`已应用智能建议：${s.reason}`, 'success')
}

const progressPercent = computed(() => {
  if (items.value.length === 0) return 0
  return Math.round((doneCount.value / items.value.length) * 100)
})

const totalSaved = computed(() => {
  let original = 0
  let compressed = 0
  for (const item of items.value) {
    if (!item.compressed) continue
    original += item.originalSize
    compressed += item.compressedSize ?? 0
  }
  return original - compressed
})

const previewUrls = computed<string[]>(() =>
  items.value.map((item) => item.previewUrl ?? item.fallbackUrl),
)

/** 未处理时的源图预览（一次性 dataURL，选图时生成并缓存） */
function fallbackDataUrl(source: LoadedImage): string {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  canvas.getContext('2d')?.drawImage(source.bitmap, 0, 0)
  return canvas.toDataURL('image/png')
}
</script>

<template>
  <div class="app-shell">
    <!-- 顶部导航 -->
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">图片压缩</div>
    </div>

    <div class="page-content">
      <!-- 未选图状态 -->
      <div v-if="items.length === 0" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张或多张图片，本地压缩体积</div>
        <div class="empty-actions">
                  <button class="btn btn-primary" style="width: 180px" @click="pickImages">选择图片</button>
                  <button class="btn btn-sample" @click="loadSample">体验示例图</button>
                </div>
      </div>

      <template v-else>
        <!-- 压缩设置 -->
        <div class="card">
          <div class="card-title">压缩设置</div>
          <div class="form-row">
            <span class="label">智能</span>
            <button class="btn btn-primary btn-sm" style="flex: 1" @click="applySuggest">✨ AI 智能压缩建议</button>
          </div>
          <div class="form-row">
            <span class="label">压缩方式</span>
            <div class="seg-control" style="flex: 1">
              <div
                class="seg-item"
                :class="{ active: mode === 'quality' }"
                @click="mode = 'quality'; runCompress()"
              >
                按质量
              </div>
              <div
                class="seg-item"
                :class="{ active: mode === 'target' }"
                @click="mode = 'target'; runCompress()"
              >
                按目标体积
              </div>
            </div>
          </div>
          <div v-if="mode === 'quality'" class="range-row">
            <span class="label">压缩质量</span>
            <input v-model.number="quality" type="range" min="10" max="100" step="5" @change="runCompress" />
            <span class="range-val">{{ quality }}%</span>
          </div>
          <div v-else class="form-row">
            <span class="label">目标体积</span>
            <input
              v-model.number="targetSize"
              type="number"
              min="1"
              max="10240"
              placeholder="如 500"
              style="width: 110px"
              @change="runCompress"
            />
            <span class="range-value" style="flex-shrink: 0">KB</span>
          </div>
          <div class="form-row">
            <span class="label">限制最长边</span>
            <div style="display: flex; align-items: center; gap: 10px; flex: 1; justify-content: flex-end">
              <input
                v-if="limitMaxSide"
                v-model.number="maxDimension"
                type="number"
                min="1"
                max="16384"
                placeholder="如 1920"
                style="width: 110px"
                @change="runCompress"
              />
              <input
                v-model="limitMaxSide"
                type="checkbox"
                style="width: 22px; height: 22px; accent-color: var(--primary); flex-shrink: 0"
                @change="runCompress"
              />
            </div>
          </div>
          <p class="tip-text">
            {{ mode === 'target' ? '自动搜索质量使每张图接近目标体积，透明 PNG 无法按体积压缩。' : '开启最长边后按等比缩放（如 1920 / 2560 / 4096），可进一步减小体积。' }}
            调整后自动重新压缩。
          </p>
        </div>

        <!-- 压缩结果列表 -->
        <div class="card">
          <div class="card-title">压缩结果（{{ items.length }} 张）</div>
          <div v-if="processing" class="progress-wrap">
            <div class="progress-bar">
              <div class="progress-inner" :style="{ width: progressPercent + '%' }"></div>
            </div>
            <div class="progress-text">压缩处理中…（{{ doneCount }}/{{ items.length }}）</div>
          </div>

          <div class="item-list">
            <div v-for="(item, index) in items" :key="item.id" class="item-row">
              <img :src="previewUrls[index]" :alt="item.source.name" class="item-thumb" />
              <div class="item-info">
                <div class="item-name">{{ item.source.name }}</div>
                <div v-if="item.error" class="item-error">{{ item.error }}</div>
                <div v-else-if="item.compressed && item.compressedSize !== undefined" class="item-sizes">
                  <span>{{ formatSize(item.originalSize) }}</span>
                  <span class="item-arrow">→</span>
                  <span class="item-new">{{ formatSize(item.compressedSize) }}</span>
                  <span class="item-percent" :class="{ negative: percentOf(item) < 0 }">
                    {{ percentOf(item) > 0 ? `-${percentOf(item)}%` : percentOf(item) < 0 ? `+${-percentOf(item)}%` : '0%' }}
                  </span>
                  <span class="item-dim">{{ item.compressed.width }}×{{ item.compressed.height }}</span>
                </div>
                <div v-else class="item-sizes">等待压缩…</div>
              </div>
              <button
                v-if="item.compressed && !item.error"
                class="item-save-btn"
                @click="saveOne(item)"
              >
                单张保存
              </button>
            </div>
          </div>

          <p v-if="totalSaved > 0" class="tip-text">共节省 {{ formatSize(totalSaved) }}。透明 PNG 为无损格式，压缩幅度有限。</p>
        </div>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="items.length > 0" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImages">继续加图</button>
      <button class="btn btn-primary" :disabled="processing" @click="saveAll">保存全部</button>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      style="display: none"
      @change="handleFileChange"
    />
    <!-- 渐变图标定义（供空状态图标引用） -->
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <defs>
        <linearGradient id="icon-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#38bdf8" />
          <stop offset="100%" stop-color="#2563eb" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.app-shell {
  isolation: isolate;
  --primary: #38bdf8;
  --gradient: linear-gradient(135deg, #38bdf8, #2563eb);
  --gradient-soft: linear-gradient(135deg, color-mix(in srgb, #38bdf8 12%, transparent), color-mix(in srgb, #2563eb 14%, transparent));
  --primary-light: color-mix(in srgb, #38bdf8 8%, #fff);
}

/* 背景氛围光斑：柔和多色 radial 光晕（全站统一） */
.app-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(520px circle at 12% 6%, rgba(34, 211, 238, 0.2), transparent 55%),
    radial-gradient(480px circle at 88% 10%, rgba(250, 204, 21, 0.16), transparent 55%),
    radial-gradient(640px circle at 42% 88%, rgba(168, 85, 247, 0.18), transparent 60%),
    radial-gradient(430px circle at 96% 62%, rgba(16, 185, 129, 0.14), transparent 55%),
    radial-gradient(360px circle at 70% 30%, rgba(244, 114, 182, 0.1), transparent 55%);
}
.item-list {
  display: flex;
  flex-direction: column;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.item-row + .item-row {
  border-top: 1px dashed var(--border);
}

.item-thumb {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--bg-page);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 8px rgba(31, 41, 55, 0.08);
}

.item-info {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-sizes {
  margin-top: 2px;
  font-size: 13px;
  color: var(--text-sub);
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  gap: 6px;
}

.item-arrow {
  color: #c4c9d4;
}

.item-new {
  color: var(--success);
  font-weight: 600;
}

.item-percent {
  color: var(--success);
  font-weight: 600;
}

.item-percent.negative {
  color: var(--danger);
}

.item-error {
  margin-top: 2px;
  font-size: 13px;
  color: var(--danger);
}

.item-dim {
  color: #c4c9d4;
  font-size: 12px;
}

/* 单张保存小按钮 */
.item-save-btn {
  flex-shrink: 0;
  padding: 6px 12px;
  border: none;
  border-radius: 9px;
  background: var(--gradient-soft);
  border: 1px solid rgba(79, 110, 247, 0.25);
  color: var(--primary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.item-save-btn:active {
  transform: scale(0.94);
}

/* PC 宽屏：设置左栏 + 结果右栏双栏布局；结果项 hover 抬升 */
@media (min-width: 768px) {
  .page-content {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    gap: 20px;
    align-items: start;
  }

  .page-content .card:nth-child(1) {
    grid-column: 1;
    grid-row: 1;
  }

  .page-content .card:nth-child(2) {
    grid-column: 2;
    grid-row: 1;
  }

  .item-row {
    padding: 10px 12px;
    border-radius: 12px;
    transition: background 0.2s, transform 0.2s;
  }

  .item-row + .item-row {
    margin-top: 4px;
  }

  .item-row:hover {
    background: rgba(244, 246, 252, 0.8);
    transform: translateY(-2px);
  }
}
</style>
