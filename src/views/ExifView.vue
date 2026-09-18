<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import {
  loadImageFromFile,
  canvasToBlob,
  downloadBlob,
  type LoadedImage,
} from '../utils/imageLoader'
import { readExifInfo, type ExifInfo } from '../utils/exif'
import { formatBytes } from '../utils/storageInfo'
import { showToast } from '../utils/toast'
import NextTools from '../components/NextTools.vue'

type ExifNextKey = 'compress' | 'format' | 'grid'

const emit = defineEmits<{ back: []; consumed: []; navigate: [view: ExifNextKey, file: File] }>()
const props = defineProps<{ incomingFile?: File | null }>()

useImageDrop((files) => {
  if (files[0]) processFile(files[0])
})

const fileInput = ref<HTMLInputElement | null>(null)

const source = ref<LoadedImage | null>(null)
const sourceUrl = ref('')
const fileName = ref('')
const fileSize = ref(0)
const sourceType = ref('')
/** 可读拍摄信息；null 表示没有 EXIF 或不是 JPEG */
const info = ref<ExifInfo | null>(null)
const processing = ref(false)

const isJpeg = () => sourceType.value.includes('jpeg')

/** 空状态渐变 SVG 图标（与首页风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><rect x="4" y="3.5" width="16" height="17" rx="2.5"/><circle cx="8.6" cy="8.6" r="1.4"/><path d="M5.5 17.5 10 13l3 3 2.5-2.5 3 2.5"/></svg>`

/* 只展示有值的字段，GPS 单独加亮提示属于敏感位置信息 */
const rows = ref<{ label: string; value: string }[]>([])
const hasLocation = ref(false)

watch(
  info,
  (i) => {
    rows.value = [
      { label: '拍摄设备', value: i?.make ? (i.model ? `${i.make} ${i.model}` : i.make) : (i?.model ?? '') },
      { label: '拍摄时间', value: i?.datetime ?? '' },
      { label: '快门', value: i?.exposure ?? '' },
      { label: '光圈', value: i?.fnumber ?? '' },
      { label: '感光度', value: i?.iso ?? '' },
      { label: '焦距', value: i?.focalLength ?? '' },
      { label: '拍摄位置', value: i?.gps ?? '' },
    ].filter((r) => r.value)
    hasLocation.value = !!i?.gps
  },
  { immediate: true },
)

async function processFile(file: File) {
  try {
    if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
    fileName.value = file.name || '图片'
    fileSize.value = file.size
    sourceType.value = file.type
    source.value = await loadImageFromFile(file)
    sourceUrl.value = URL.createObjectURL(file)
    info.value = await readExifInfo(file)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
  }
}

function pickImage() {
  fileInput.value?.click()
}

async function loadSample() {
  try {
    const { fetchSampleFile } = await import('../utils/sampleImage')
    processFile(await fetchSampleFile('person'))
  } catch (error) {
    showToast(error instanceof Error ? error.message : '示例图加载失败', 'error')
  }
}

/** 清除拍摄信息：canvas 重编码后 Exif/ICC/GPS 一并剥离 */
async function exportClean() {
  if (!source.value || processing.value) return
  processing.value = true
  try {
    const s = source.value
    const canvas = document.createElement('canvas')
    canvas.width = s.width
    canvas.height = s.height
    canvas.getContext('2d')?.drawImage(s.bitmap, 0, 0)
    const type = isJpeg() ? 'image/jpeg' : sourceType.value || 'image/png'
    // JPEG 需重编码以彻底移除元数据；其余格式原样再编码即可
    const quality = type === 'image/jpeg' ? 0.92 : 1
    const blob = await canvasToBlob(canvas, type, quality)
    const base = (fileName.value.replace(/\.[^.]+$/, '') || '图片').trim()
    const ext = type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg'
    downloadBlob(blob, `${base}_无拍摄信息${ext}`)
    cleanFile.value = new File([blob], `${base}_无拍摄信息${ext}`, { type })
    showToast('已导出，不含拍摄信息', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导出失败', 'error')
  } finally {
    processing.value = false
  }
}

/** 上一步清理出的成品：可直送压缩 / 转格式 / 切图，不必重新选图 */
const cleanFile = ref<File | null>(null)

const NEXT_TOOLS: { key: ExifNextKey; label: string }[] = [
  { key: 'compress', label: '压体积' },
  { key: 'format', label: '转格式' },
  { key: 'grid', label: '切图' },
]

function onPickNext(key: string) {
  if (!cleanFile.value) {
    showToast('还没有清理好的成品，先导出一份', 'error')
    return
  }
  if (key === 'compress' || key === 'format' || key === 'grid') {
    emit('navigate', key, cleanFile.value)
  }
}

onMounted(() => {
  window.scrollTo(0, 0)
  if (props.incomingFile) {
    processFile(props.incomingFile).finally(() => emit('consumed'))
  }
})
</script>

<template>
  <div class="app-shell">
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">EXIF 信息与隐私清理</div>
    </div>

    <div class="page-content exif-page">
      <!-- 空状态：未选图时展示 -->
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张照片，查看拍摄设备、时间与位置</div>
        <p class="empty-hint">适合发图前检查有没有泄露 GPS 位置，或一键清除拍摄信息</p>
        <div class="empty-actions">
          <button class="btn btn-primary" @click="pickImage">选择图片</button>
          <button class="btn btn-outline" @click="loadSample">用示例图试试</button>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          hidden
          @change="(e) => processFile((e.target as HTMLInputElement).files![0])"
        />
      </div>

      <template v-else>
        <!-- 预览与基础文件信息 -->
        <div class="card">
          <div class="card-title">文件</div>
          <div class="file-row">
            <div class="file-thumb">
              <img v-if="sourceUrl" :src="sourceUrl" alt="预览" />
            </div>
            <div class="file-meta">
              <div class="file-name">{{ fileName }}</div>
              <div class="file-sub">
                {{ formatBytes(fileSize) }} · {{ source ? `${source.width} × ${source.height}px` : '' }}
              </div>
            </div>
          </div>
        </div>

        <!-- 拍摄信息 -->
        <div class="card">
          <div class="card-title">
            拍摄信息
            <span v-if="isJpeg()" class="info-tag">JPEG</span>
          </div>
          <template v-if="rows.length">
            <div class="meta-row">
              <span class="meta-label">{{ rows[0].label }}</span>
              <span class="meta-value">{{ rows[0].value }}</span>
            </div>
            <div v-if="hasLocation" class="meta-row is-warn">
              <span class="meta-label">位置提醒</span>
              <span class="meta-value">这张照片带有 GPS 位置，公开传播前建议清除</span>
            </div>
            <div v-for="r in rows.slice(1)" :key="r.label" class="meta-row">
              <span class="meta-label">{{ r.label }}</span>
              <span class="meta-value">{{ r.value }}</span>
            </div>
          </template>
          <p v-else class="no-info">
            {{ isJpeg() ? '仅此图未写入可读的拍摄信息，画面仍可正常查看。' : '非 JPEG 图片通常不携带 EXIF 拍摄信息。' }}
          </p>
        </div>

        <!-- 清除并导出 -->
        <div class="card">
          <div class="card-title">清除拍摄信息</div>
          <p class="clean-tip">
            {{ isJpeg() ? '将按 92% 质量重新编码以彻底移除 Exif / ICC / GPS 元数据。' : '将按原格式重新编码，确保不带任何元数据。' }}
          </p>
          <button class="btn btn-primary btn-block" :disabled="processing" @click="exportClean">
            {{ processing ? '处理中…' : '清除拍摄信息并导出' }}
          </button>
        </div>

        <!-- 清理完成后的成品下一步：压体积 / 转格式 / 切图，不必重新选图 -->
        <div v-if="cleanFile" class="card">
          <NextTools :options="NEXT_TOOLS" @pick="onPickNext" />
        </div>
      </template>
    </div>

    <!-- 渐变图标定义（供空状态图标引用，缺失会导致描边无法渲染） -->
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <defs>
        <linearGradient id="icon-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#a78bfa" />
          <stop offset="100%" stop-color="#8b5cf6" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.exif-page {
  max-width: 640px;
  margin: 0 auto;
  padding: 20px 20px 96px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.file-thumb {
  width: 68px;
  height: 68px;
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--border);
}

.file-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-meta {
  min-width: 0;
}

.file-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-main);
  word-break: break-all;
}

.file-sub {
  margin-top: 3px;
  font-size: 13px;
  color: var(--text-sub);
}

.info-tag {
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-sub);
  font-size: 12px;
  font-weight: 500;
}

.meta-row {
  display: flex;
  gap: 16px;
  padding: 10px 0;
  font-size: 14px;
}

.meta-row + .meta-row {
  border-top: 1px dashed var(--border);
}

.meta-label {
  flex-shrink: 0;
  width: 76px;
  color: var(--text-sub);
}

.meta-value {
  flex: 1;
  min-width: 0;
  color: var(--text-main);
  word-break: break-word;
}

.meta-row.is-warn .meta-label {
  color: #f59e0b;
}

.meta-row.is-warn .meta-value {
  color: #d97706;
}

.no-info {
  margin: 0;
  font-size: 13px;
  color: var(--text-sub);
  line-height: 1.7;
}

.clean-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-sub);
  line-height: 1.6;
}

.btn-block {
  width: 100%;
}
</style>