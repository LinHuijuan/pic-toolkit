<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, downloadBlob, type LoadedImage } from '../utils/imageLoader'
import { saveMany } from '../utils/zip'
import { convertImageFormat, type OutputFormat } from '../utils/imageFormat'
import { showToast } from '../utils/toast'
import { fetchSampleFiles } from '../utils/sampleImage'
import ShareButton from '../components/ShareButton.vue'

const emit = defineEmits<{ back: []; consumed: [] }>()

const props = defineProps<{ incomingFile?: File | null }>()

// 全站拖拽上传：把图片拖到页面任意位置导入当前工具
useImageDrop((files) => {
  if (files.length) processFiles(files)
})

const fileInput = ref<HTMLInputElement | null>(null)
const items = ref<ConvertItem[]>([])
const targetFormat = ref<OutputFormat>('jpeg')
/** 保留源 JPEG 的 Exif/ICC：默认关，EXIF 可能含 GPS，导出前由用户显式选择 */
const keepMeta = ref(false)
const processing = ref(false)
const doneCount = ref(0)

interface ConvertItem {
  id: number
  source: LoadedImage
  /** 源文件本体：搬元数据时要按原始字节读一次 */
  file: File
  originalType: string
  result?: {
    blob: Blob
    type: string
  }
  /** 转换结果预览 URL（objectURL，替换 / 卸载时需释放） */
  previewUrl?: string
  /** 源图预览 dataURL（选图时生成一次，避免 computed 全量重复 toDataURL） */
  fallbackUrl: string
  error?: string
}

let idSeed = 0

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><path d="M20.5 12a8.5 8.5 0 0 1-14.8 5.7M3.5 12a8.5 8.5 0 0 1 14.8-5.7"/><path d="M20.5 3.5v5h-5M3.5 20.5v-5h5"/></svg>`

const FORMATS: { key: OutputFormat; label: string }[] = [
  { key: 'png', label: 'PNG' },
  { key: 'jpeg', label: 'JPG' },
  { key: 'webp', label: 'WebP' },
]

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

/** 加载并转换一组图片 */
async function processFiles(files: File[]) {
  for (const file of files) {
    const source = await loadImageFromFile(file)
    items.value.push({
      id: idSeed++,
      source,
      file,
      originalType: file.type,
      fallbackUrl: fallbackDataUrl(source),
    })
  }
  await runConvert()
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

// 接收其他工具流转过来的图片（如图片编辑 → 转换）
onMounted(() => {
  if (props.incomingFile) {
    processFiles([props.incomingFile]).catch((error) => {
      showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
    })
    emit('consumed')
  }
})

async function runConvert() {
  if (processing.value || items.value.length === 0) return
  processing.value = true
  doneCount.value = 0
  try {
    for (const item of items.value) {
      try {
        const result = await convertImageFormat(
          item.source.bitmap,
          targetFormat.value,
          keepMeta.value ? item.file : undefined,
        )
        item.result = { blob: result.blob, type: result.type }
        item.error = undefined
        setPreviewUrl(item, URL.createObjectURL(result.blob))
      } catch (error) {
        item.error = error instanceof Error ? error.message : '转换失败'
      }
      doneCount.value++
    }
  } finally {
    processing.value = false
  }
}

function switchFormat(format: OutputFormat) {
  if (targetFormat.value === format) return
  targetFormat.value = format
  runConvert()
}

/** 单张转换结果 → File（下载与分享共用同一份产物与命名） */
function resultFile(item: ConvertItem): File | null {
  if (!item.result || item.error) return null
  const ext = item.result.type === 'image/jpeg' ? 'jpg' : item.result.type === 'image/webp' ? 'webp' : 'png'
  return new File([item.result.blob], `${item.source.name}.${ext}`, { type: item.result.type })
}

/** 全部可导出的转换结果 */
function readyFiles(): File[] {
  return items.value.map((item) => resultFile(item)).flatMap((file) => (file ? [file] : []))
}

async function resultFiles(): Promise<File[]> {
  return readyFiles()
}

async function saveAll() {
  const files = readyFiles()
  if (files.length === 0) return
  await saveMany(files, '格式转换.zip')
  showToast(files.length > 1 ? '已打包下载' : '已开始下载', 'success')
}

/** 单张保存转换结果 */
function saveOne(item: ConvertItem) {
  const file = resultFile(item)
  if (!file) return
  downloadBlob(file, file.name)
  showToast('已开始下载', 'success')
}

/** 替换预览 URL，释放旧的 objectURL */
function setPreviewUrl(item: ConvertItem, url: string) {
  if (item.previewUrl) {
    URL.revokeObjectURL(item.previewUrl)
  }
  item.previewUrl = url
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

function formatLabel(type: string): string {
  if (type === 'image/jpeg') return 'JPG'
  if (type === 'image/webp') return 'WebP'
  if (type === 'image/png') return 'PNG'
  return type
}

const progressPercent = computed(() => {
  if (items.value.length === 0) return 0
  return Math.round((doneCount.value / items.value.length) * 100)
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
      <div class="page-title">图片格式转换</div>
    </div>

    <div class="page-content">
      <!-- 未选图状态 -->
      <div v-if="items.length === 0" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张或多张图片，转换格式</div>
        <div class="empty-actions">
                  <button class="btn btn-primary" style="width: 180px" @click="pickImages">选择图片</button>
                  <button class="btn btn-sample" @click="loadSample">体验示例图</button>
                </div>
      </div>

      <template v-else>
        <!-- 格式设置 -->
        <div class="card">
          <div class="card-title">目标格式</div>
          <div class="seg-control">
            <div
              v-for="f in FORMATS"
              :key="f.key"
              class="seg-item"
              :class="{ active: targetFormat === f.key }"
              @click="switchFormat(f.key)"
            >
              {{ f.label }}
            </div>
          </div>
          <div v-if="targetFormat === 'jpeg'" class="form-row">
            <span class="label">保留拍摄信息</span>
            <input
              v-model="keepMeta"
              type="checkbox"
              style="width: 22px; height: 22px; accent-color: var(--primary); flex: 0 0 auto; margin-left: auto"
              @change="runConvert"
            />
          </div>
          <p class="tip-text">
            JPG 不支持透明背景，透明图片自动填充白色；PNG / WebP 保留透明通道。切换后自动重新转换。
            <template v-if="targetFormat === 'jpeg'">
              保留拍摄信息会把源图的拍摄时间、机型等一起带过去；源图不是 JPEG 时无效果。注意 EXIF
              里可能含 GPS 位置，分享前请自行斟酌。
            </template>
          </p>
        </div>

        <!-- 转换结果列表 -->
        <div class="card">
          <div class="card-title">转换结果（{{ items.length }} 张）</div>
          <div v-if="processing" class="progress-wrap">
            <div class="progress-bar">
              <div class="progress-inner" :style="{ width: progressPercent + '%' }"></div>
            </div>
            <div class="progress-text">转换处理中…（{{ doneCount }}/{{ items.length }}）</div>
          </div>

          <div class="item-list">
            <div v-for="(item, index) in items" :key="item.id" class="item-row">
              <img :src="previewUrls[index]" :alt="item.source.name" class="item-thumb" />
              <div class="item-info">
                <div class="item-name">{{ item.source.name }}</div>
                <div v-if="item.error" class="item-error">{{ item.error }}</div>
                <div v-else class="item-types">
                  <span class="type-chip">{{ formatLabel(item.originalType) }}</span>
                  <span class="item-arrow">→</span>
                  <span class="type-chip type-new">{{ formatLabel(item.result?.type ?? '') }}</span>
                </div>
              </div>
              <button
                v-if="item.result && !item.error"
                class="item-save-btn"
                @click="saveOne(item)"
              >
                单张保存
              </button>
            </div>
          </div>
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
          <stop offset="0%" stop-color="#2dd4bf" />
          <stop offset="100%" stop-color="#14b8a6" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.app-shell {
  isolation: isolate;
  --primary: #2dd4bf;
  --gradient: linear-gradient(135deg, #2dd4bf, #14b8a6);
  --gradient-soft: linear-gradient(135deg, color-mix(in srgb, #2dd4bf 12%, transparent), color-mix(in srgb, #14b8a6 14%, transparent));
  --primary-light: color-mix(in srgb, #2dd4bf 8%, #fff);
}

/* 背景氛围光斑：柔和多色 radial 光晕（全站统一） */
.app-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(520px circle at 12% 6%, rgba(45, 212, 191, 0.2), transparent 55%),
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

.item-types {
  margin-top: 2px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.type-chip {
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--bg-page);
  border: 1px solid var(--border);
  color: var(--text-sub);
  font-size: 12px;
  font-weight: 600;
}

.type-new {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-light);
}

.item-arrow {
  color: #c4c9d4;
}

.item-error {
  margin-top: 2px;
  font-size: 13px;
  color: var(--danger);
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
