<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, downloadBlob, type LoadedImage } from '../utils/imageLoader'
import { saveMany } from '../utils/zip'
import {
  compressBitmap,
  compressToTargetSize,
  canEncodeWebp,
  type CompressFormat,
  type EncodedFormat,
} from '../utils/imageCompress'
import { showToast } from '../utils/toast'
import { usePref } from '../utils/prefs'
import { runConcurrent } from '../utils/concurrency'
import { fetchSampleFiles } from '../utils/sampleImage'
import ShareButton from '../components/ShareButton.vue'
import NextTools from '../components/NextTools.vue'

const emit = defineEmits<{
  back: []
  consumed: []
  navigate: [view: 'format' | 'grid', file: File]
}>()

const props = defineProps<{ incomingFile?: File | null }>()

// 全站拖拽上传：把图片拖到页面任意位置导入当前工具
useImageDrop((files) => {
  if (files.length) processFiles(files)
})

const fileInput = ref<HTMLInputElement | null>(null)
const items = ref<CompressItem[]>([])
const mode = usePref('compress.mode', 'quality' as 'quality' | 'target')
/** 输出格式：auto 沿用「透明出 PNG、其余出 JPEG」，WebP 用于同画质再省一档 */
const format = usePref<CompressFormat>('compress.format', 'auto')
const quality = usePref('compress.quality', 70) // 百分比
const targetSize = usePref('compress.targetSize', 500) // 目标体积（KB）
const processing = ref(false)
const doneCount = ref(0)
/** 用户点「取消」后置位，runConcurrent 不再开新的压缩槽 */
const cancelled = ref(false)
const limitMaxSide = usePref('compress.limitMaxSide', false)
const maxDimension = usePref('compress.maxDimension', 1920) // 最长边限制（px）

interface CompressItem {
  id: number
  source: LoadedImage
  /** 源文件本体：搬元数据时要按原始字节读一次 */
  file: File
  originalSize: number
  compressed?: {
    blob: Blob
    format: EncodedFormat
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

/** 保留源 JPEG 的拍摄信息：默认关，EXIF 可能含 GPS，由用户显式开启 */
const keepMeta = ref(false)

/** 加载并压缩一组图片 */
async function processFiles(files: File[]) {
  for (const file of files) {
    const source = await loadImageFromFile(file)
    items.value.push({
      id: idSeed++,
      source,
      file,
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

/** 压缩单张：批量并发与「重试」共用同一条逻辑，结果与错误都落到 item 上 */
async function compressOne(item: CompressItem): Promise<void> {
  const maxDim = resolveMaxDimension()
  try {
    let result
    if (mode.value === 'target') {
      result = await compressToTargetSize(item.source.bitmap, {
        targetBytes: targetSize.value * 1024,
        maxDimension: maxDim,
        format: format.value,
        metadataFrom: keepMeta.value ? item.file : undefined,
      })
      // 命中 PNG 说明是无损输出，体积不可控
      if (result.format === 'png' && result.blob.size > targetSize.value * 1024) {
        throw new Error('透明图按体积压缩请选 WebP，或改用按质量模式')
      }
    } else {
      result = await compressBitmap(item.source.bitmap, {
        quality: quality.value / 100,
        maxDimension: maxDim,
        format: format.value,
        metadataFrom: keepMeta.value ? item.file : undefined,
      })
    }
    item.compressed = {
      blob: result.blob,
      format: result.format,
      width: result.width,
      height: result.height,
    }
    item.compressedSize = result.blob.size
    item.error = undefined
    setPreviewUrl(item, URL.createObjectURL(result.blob))
  } catch (error) {
    item.error = error instanceof Error ? error.message : '压缩失败'
  }
}

/** 重新压缩全部未压缩/已压缩的图片 */
async function runCompress() {
  if (processing.value || items.value.length === 0) return
  processing.value = true
  cancelled.value = false
  doneCount.value = 0
  try {
    // 限并发处理：编码线程彼此重叠，大批量时进度更快、界面也更跟手
    await runConcurrent(
      items.value.length,
      3,
      async (index) => {
        await compressOne(items.value[index])
        doneCount.value++
      },
      () => cancelled.value,
    )
  } finally {
    processing.value = false
  }
}

/** 终止批量压缩：正在跑的那一张会跑完，但其后的不再启动 */
function cancelCompress() {
  cancelled.value = true
  showToast('已停止后续压缩', 'info')
}

/** 只重某一张失败的结果，不必重新压缩整批 */
async function retryOne(item: CompressItem) {
  if (processing.value) return
  await compressOne(item)
  if (item.error) showToast('重试仍未成功', 'error')
}

/** 实际编码器 → 文件名后缀与 MIME，回退成 PNG 时文件名也不会撒谎 */
const FORMAT_EXT: Record<EncodedFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' }
const FORMAT_MIME: Record<EncodedFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}
const FORMAT_LABEL: Record<EncodedFormat, string> = { png: 'PNG', jpeg: 'JPG', webp: 'WebP' }

/** 结果行上显示的格式名 */
function formatLabel(item: CompressItem): string {
  return item.compressed ? FORMAT_LABEL[item.compressed.format] : ''
}

/** 切到 WebP 前先确认浏览器真能编码，否则选了也是白选 */
async function chooseFormat(next: CompressFormat) {
  if (next === format.value) return
  if (next === 'webp' && !(await canEncodeWebp())) {
    showToast('当前浏览器不支持 WebP 编码，已保持原格式', 'error')
    return
  }
  format.value = next
  runCompress()
}

/** 单张压缩结果 → File（下载与分享共用同一份产物与命名） */
function resultFile(item: CompressItem): File | null {
  if (!item.compressed || item.error) return null
  const { blob, format: encoded } = item.compressed
  const type = FORMAT_MIME[encoded]
  return new File([blob], `${item.source.name}_压缩.${FORMAT_EXT[encoded]}`, { type })
}

/** 全部可导出的压缩结果 */
function readyFiles(): File[] {
  return items.value.map((item) => resultFile(item)).flatMap((file) => (file ? [file] : []))
}

async function resultFiles(): Promise<File[]> {
  return readyFiles()
}

/** 压缩完的下一步：把第一张成品送到下一个工具继续处理，不再重新选图 */
const NEXT_CHAIN: { key: 'format' | 'grid'; label: string }[] = [
  { key: 'format', label: '转格式' },
  { key: 'grid', label: '切九宫格' },
]

function onPickNext(key: string) {
  const first = readyFiles()[0]
  if (!first || (key !== 'format' && key !== 'grid')) {
    if (!first) showToast('还没有可发送的压缩结果', 'error')
    return
  }
  emit('navigate', key, first)
}

async function saveAll() {
  const files = readyFiles()
  if (files.length === 0) return
  await saveMany(files, '图片压缩.zip')
  showToast(files.length > 1 ? '已打包下载' : '已开始下载', 'success')
}

/** 单张保存压缩结果 */
function saveOne(item: CompressItem) {
  const file = resultFile(item)
  if (!file) return
  downloadBlob(file, file.name)
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

/** 已压缩项的原始总量（汇总） */
const totalOriginal = computed(() =>
  items.value.reduce((s, it) => (it.compressed ? s + it.originalSize : s), 0),
)

/** 已压缩项的新总量（汇总） */
const totalNew = computed(() =>
  items.value.reduce((s, it) => s + (it.compressedSize ?? 0), 0),
)

/** 已压缩图片张数 */
const compressedCount = computed(() => items.value.filter((i) => i.compressed).length)

/** 整体节省百分比 */
const savePercent = computed(() => {
  if (totalOriginal.value <= 0) return 0
  return Math.round((totalSaved.value / totalOriginal.value) * 100)
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

    <div class="page-content tool-page">
      <!-- 未选图状态 -->
      <div v-if="items.length === 0" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张或多张图片，本地压缩体积</div>
        <p class="empty-hint">适合聊天发图前压体积，或大批量缩小再上传</p>
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
          <div class="form-row">
            <span class="label">输出格式</span>
            <div class="seg-control" style="flex: 1">
              <div class="seg-item" :class="{ active: format === 'auto' }" @click="chooseFormat('auto')">
                智能
              </div>
              <div class="seg-item" :class="{ active: format === 'jpeg' }" @click="chooseFormat('jpeg')">
                JPG
              </div>
              <div class="seg-item" :class="{ active: format === 'webp' }" @click="chooseFormat('webp')">
                WebP
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
          <div class="form-row">
            <span class="label">保留拍摄信息</span>
            <input
              v-model="keepMeta"
              type="checkbox"
              style="width: 22px; height: 22px; accent-color: var(--primary); flex: 0 0 auto; margin-left: auto"
              @change="runCompress"
            />
          </div>
          <p class="tip-text">
            {{ mode === 'target' ? '自动搜索质量使每张图接近目标体积；透明图要压体积请选 WebP（PNG 无损，只能靠限制最长边）。' : '开启最长边后按等比缩放（如 1920 / 2560 / 4096），可进一步减小体积。' }}
            WebP 同画质通常比 JPG 再省 25~35%，且支持透明；选 JPG 而图含透明时会自动回退为 PNG，
            浏览器不支持 WebP 编码时也会自动回退。保留拍摄信息只对 JPEG 输出有效，
            会把源图的拍摄时间、机型等一起带过去，注意 EXIF 里可能含 GPS 位置。调整后自动重新压缩。
          </p>
        </div>

        <!-- 压缩结果列表 -->
        <div class="card">
          <div class="card-title">压缩结果（{{ items.length }} 张）</div>
          <div v-if="processing" class="progress-wrap">
            <div class="progress-bar">
              <div class="progress-inner" :style="{ width: progressPercent + '%' }"></div>
            </div>
            <div class="progress-text">
              压缩处理中…（{{ doneCount }}/{{ items.length }}）
              <button class="retry-mini" @click="cancelCompress">取消</button>
            </div>
          </div>

          <div class="item-list">
            <div v-for="(item, index) in items" :key="item.id" class="item-row">
              <img :src="previewUrls[index]" :alt="item.source.name" class="item-thumb" />
              <div class="item-info">
                <div class="item-name">{{ item.source.name }}</div>
                <div v-if="item.error" class="item-error">{{ item.error }}</div>
                <div v-else-if="item.compressed && item.compressedSize !== undefined">
                  <div class="item-sizes">
                    <span>{{ formatSize(item.originalSize) }}</span>
                    <span class="item-arrow">→</span>
                    <span class="item-new">{{ formatSize(item.compressedSize) }}</span>
                    <span class="item-percent" :class="{ negative: percentOf(item) < 0 }">
                      {{ percentOf(item) > 0 ? `-${percentOf(item)}%` : percentOf(item) < 0 ? `+${-percentOf(item)}%` : '0%' }}
                    </span>
                  </div>
                  <div class="item-meta">
                    <span class="item-dim">{{ item.source.width }}×{{ item.source.height }}</span>
                    <span class="item-dim">→ {{ item.compressed.width }}×{{ item.compressed.height }}</span>
                    <span class="item-dim">· {{ formatLabel(item) }}</span>
                  </div>
                </div>
                <div v-else class="item-sizes">
                  等待压缩… <span class="item-dim">{{ formatSize(item.originalSize) }} · {{ item.source.width }}×{{ item.source.height }}</span>
                </div>
              </div>
              <div class="item-actions">
                <button
                  v-if="item.compressed && !item.error"
                  class="item-save-btn"
                  @click="saveOne(item)"
                >
                  单张保存
                </button>
                <button
                  v-if="item.error"
                  class="item-save-btn retry-item"
                  @click="retryOne(item)"
                >
                  重试
                </button>
              </div>
            </div>
          </div>

          <div v-if="compressedCount > 0" class="summary-bar">
            <span class="summary-label">总大小</span>
            <span>{{ formatSize(totalOriginal) }}</span>
            <span class="summary-arrow">→</span>
            <span class="summary-new">{{ formatSize(totalNew) }}</span>
            <span class="summary-save">
              节省 {{ formatSize(totalSaved) }}<template v-if="savePercent > 0"> · {{ savePercent }}%</template>
            </span>
          </div>

          <p v-if="totalSaved > 0 && compressedCount > 0" class="tip-text">透明 PNG 为无损格式，压缩幅度有限。</p>
        </div>

        <!-- 压缩完可以把成品直送下一个工具，省一次选图 -->
        <div v-if="items.some((i) => i.compressed && !i.error)" class="next-row">
          <NextTools :options="NEXT_CHAIN" @pick="onPickNext" />
        </div>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="items.length > 0" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImages">继续加图</button>
      <ShareButton :get-files="resultFiles" variant="outline" :disabled="processing" label="分享全部" />
      <button class="btn btn-primary" :disabled="processing" @click="saveAll">保存全部</button>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*,.heic,.heif"
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
  flex-wrap: wrap;
  min-width: 0;
}

.item-sizes > * {
  white-space: nowrap;
}

.item-arrow {
  color: #c4c9d4;
}

/* 压缩结果里的次要信息行：尺寸、格式等，比主信息更淡 */
.item-meta {
  margin-top: 3px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.item-meta .item-dim {
  font-size: 12px;
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

/* 总量汇总栏：压缩后一屏看清压了多少、省了多少 */
.summary-bar {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--gradient-soft);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.summary-label {
  color: var(--text-sub);
  margin-right: 2px;
}
.summary-arrow {
  color: #c4c9d4;
}
.summary-new {
  color: var(--success);
  font-weight: 700;
}
.summary-save {
  margin-left: auto;
  color: var(--success);
  font-weight: 600;
  background: rgba(16, 185, 129, 0.12);
  padding: 2px 10px;
  border-radius: 999px;
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

/* 行内操作按钮排：压缩成功显示「单张保存」，失败显示「重试」，多张时也能并列收下 */
.item-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.item-save-btn.retry-item {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
  color: var(--danger);
}

/* 进度行与错误行的内联小按钮（取消 / 重试） */
.retry-mini {
  margin-left: 8px;
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text-sub);
  font-size: 12px;
  cursor: pointer;
  transition: transform 0.15s, background 0.15s, color 0.15s;
}
.retry-mini:hover {
  background: var(--primary-light);
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 45%, transparent);
}
.retry-mini:active {
  transform: scale(0.94);
}

/* PC 宽屏：双栏落位走 .tool-page 默认规则；这一页结果列更宽，所以左窄右宽。结果项 hover 抬升 */
@media (min-width: 768px) {
  .page-content.tool-page {
    --pane-left: 2fr;
    --pane-right: 3fr;
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

/* 压缩结果 -> 下一个工具 的一行入口，与卡片拉开一点距离 */
.next-row {
  margin-top: 14px;
  padding: 0 2px;
}
</style>
