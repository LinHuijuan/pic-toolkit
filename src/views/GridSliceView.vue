<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, downloadCanvas, canvasToFile, type LoadedImage } from '../utils/imageLoader'
import { saveMany } from '../utils/zip'
import ShareButton from '../components/ShareButton.vue'
import { sliceGrid, buildSlicePreview, buildSliceFilename, type SliceResult } from '../utils/gridSlice'
import { showToast } from '../utils/toast'
import { fetchSampleFile } from '../utils/sampleImage'

const emit = defineEmits<{ back: []; consumed: [] }>()

const props = defineProps<{ incomingFile?: File | null }>()

// 全站拖拽上传：把图片拖到页面任意位置导入当前工具
useImageDrop((files) => {
  if (files[0]) processFile(files[0])
})

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const sourceCanvas = ref<HTMLCanvasElement | null>(null)
const rows = ref(3)
const cols = ref(3)
const gap = ref(0)
const transparent = ref(false)
const slices = ref<SliceResult[]>([])
const sliceUrls = ref<string[]>([])
const slicePreviewCanvas = ref<HTMLCanvasElement | null>(null)
const gridMode = ref<'3x3' | '2x2' | '3x1' | '1x3' | 'custom'>('3x3')

/** 大图预览弹层：当前查看的切块索引，null 表示关闭 */
const lightboxIndex = ref<number | null>(null)

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9.5h17M3.5 15.5h17M9.5 3.5v17M15.5 3.5v17"/></svg>`

/** 原图预览最长边上限：预览仅为展示，等比缩放到该尺寸内，避免超大图超出 canvas 上限导致空白 */
const MAX_PREVIEW_DIM = 2048

const GRID_PRESETS = [
  { key: '3x3', label: '3×3', rows: 3, cols: 3 },
  { key: '2x2', label: '2×2', rows: 2, cols: 2 },
  { key: '3x1', label: '3×1', rows: 3, cols: 1 },
  { key: '1x3', label: '1×3', rows: 1, cols: 3 },
] as const

function pickImage() {
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    await processFile(file)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
  } finally {
    input.value = ''
  }
}

/** 加载图片并切分 */
async function processFile(file: File) {
  source.value = await loadImageFromFile(file)
  await nextTick() // 等待原图预览画布挂载后再绘制
  drawSource()
  slices.value = []
  sliceUrls.value = []
  gridMode.value = '3x3'
  doSlice()
}

/** 一键载入内置示例图体验完整流程 */
async function loadSample() {
  try {
    const file = await fetchSampleFile('scene')
    await processFile(file)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '示例图加载失败', 'error')
  }
}

// 接收其他工具流转过来的图片（如图片编辑 → 切图）
onMounted(() => {
  if (props.incomingFile) {
    processFile(props.incomingFile).catch((error) => {
      showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
    })
    emit('consumed')
  }
})

/** 将源图绘制到原图预览画布（等比缩放到预览上限内，避免超限空白） */
function drawSource() {
  const canvas = sourceCanvas.value
  if (!canvas || !source.value) return
  const { width, height } = source.value
  const scale = Math.min(1, MAX_PREVIEW_DIM / Math.max(width, height))
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  canvas.getContext('2d')?.drawImage(source.value.bitmap, 0, 0, canvas.width, canvas.height)
}

function applyPreset(preset: { key: string; rows: number; cols: number }) {
  gridMode.value = preset.key as typeof gridMode.value
  rows.value = preset.rows
  cols.value = preset.cols
  doSlice()
}

function switchToCustom() {
  gridMode.value = 'custom'
}

function doSlice() {
  if (!source.value) return
  try {
    const result = sliceGrid(source.value.bitmap, {
      rows: rows.value,
      cols: cols.value,
      gap: gap.value,
      transparent: transparent.value,
    })
    slices.value = result
    // 每次切分只生成一次预览 URL，避免 computed 全量重复 toDataURL
    sliceUrls.value = result.map((s) => s.canvas.toDataURL('image/png'))
  } catch (error) {
    showToast(error instanceof Error ? error.message : '切图失败', 'error')
  }
}

/** 点击单块单独下载 */
function downloadOne(index: number) {
  const slice = slices.value[index]
  if (!slice || !source.value) return
  downloadCanvas(
    slice.canvas,
    buildSliceFilename(source.value.name, slice.row, slice.col, rows.value, cols.value),
  )
  showToast('已开始下载', 'success')
}

/** 打开大图预览弹层 */
function openLightbox(index: number) {
  lightboxIndex.value = index
}

function closeLightbox() {
  lightboxIndex.value = null
}

/** 弹层内下载当前大图 */
function downloadLightbox() {
  if (lightboxIndex.value === null) return
  downloadOne(lightboxIndex.value)
}

/** 将全部切块按留白拼回一张完整图下载（朋友圈可直接发一张） */
function saveFull() {
  if (!source.value || slices.value.length === 0) return
  try {
    const preview = buildSlicePreview(slices.value, rows.value, cols.value, gap.value)
    downloadCanvas(preview, `${source.value.name}_完整图.png`)
    showToast('已开始下载', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '完整图生成失败', 'error')
  }
}

/** 全部切块物料化成 File：分享面板一次拿走，省掉「逐张下载再逐张选图」 */
async function sliceFiles(): Promise<File[]> {
  const src = source.value
  if (!src || slices.value.length === 0) return []
  const files: File[] = []
  for (const slice of slices.value) {
    files.push(
      await canvasToFile(
        slice.canvas,
        buildSliceFilename(src.name, slice.row, slice.col, rows.value, cols.value),
      ),
    )
  }
  return files
}

async function saveAll() {
  if (!source.value || slices.value.length === 0) return
  const files = await sliceFiles()
  // 一次打包代替连点下载：九宫格就是 9 个文件，逐张下载必然被浏览器拦截
  await saveMany(files, `${source.value.name}_九宫格切图.zip`)
  showToast(files.length > 1 ? '已打包下载' : '已开始下载', 'success')
}

// 切片变化后绘制整体拼回预览（flush: post 确保画布已挂载）
watch(
  slices,
  () => {
    const el = slicePreviewCanvas.value
    if (!el || slices.value.length === 0) return
    try {
      const preview = buildSlicePreview(slices.value, rows.value, cols.value, gap.value)
      el.width = preview.width
      el.height = preview.height
      el.getContext('2d')?.drawImage(preview, 0, 0)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '拼回预览生成失败', 'error')
    }
  },
  { flush: 'post' },
)

// 组件卸载时释放源图 bitmap
onUnmounted(() => {
  try {
    source.value?.bitmap.close()
  } catch {
    /* bitmap 已关闭，忽略 */
  }
})
</script>

<template>
  <div class="app-shell">
    <!-- 顶部导航 -->
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">九宫格切图</div>
    </div>

    <div class="page-content tool-page">
      <!-- 未选图状态 -->
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张图片开始切图</div>
        <div class="empty-actions">
          <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择图片</button>
          <button class="btn btn-sample" @click="loadSample">体验示例图</button>
        </div>
      </div>

      <template v-else>
        <!-- 原图预览 -->
        <div class="card">
          <div class="card-title">原图</div>
          <div class="preview-wrap">
            <canvas
              ref="sourceCanvas"
              style="max-width: 100%; max-height: 220px"
            ></canvas>
          </div>
        </div>

        <!-- 切分设置 -->
        <div class="card">
          <div class="card-title">切分设置</div>
          <div class="seg-control" style="margin-bottom: 12px">
            <div
              v-for="preset in GRID_PRESETS"
              :key="preset.key"
              class="seg-item"
              :class="{ active: gridMode === preset.key }"
              @click="applyPreset(preset)"
            >
              {{ preset.label }}
            </div>
            <div
              class="seg-item"
              :class="{ active: gridMode === 'custom' }"
              @click="switchToCustom"
            >
              自定义
            </div>
          </div>

          <div v-if="gridMode === 'custom'" class="form-row">
            <span class="label">行列数</span>
            <div style="display: flex; align-items: center; gap: 8px">
              <input
                v-model.number="rows"
                type="number"
                min="1"
                max="10"
                style="width: 64px"
                @change="doSlice"
              />
              <span style="color: var(--text-sub)">×</span>
              <input
                v-model.number="cols"
                type="number"
                min="1"
                max="10"
                style="width: 64px"
                @change="doSlice"
              />
            </div>
          </div>

          <div class="form-row">
            <span class="label">块间留白</span>
            <div style="display: flex; align-items: center; gap: 8px">
              <span class="range-val">{{ gap }}px</span>
              <input v-model.number="gap" type="range" min="0" max="30" @change="doSlice" />
            </div>
          </div>

          <div class="form-row">
            <span class="label">透明背景</span>
            <input
              v-model="transparent"
              type="checkbox"
              style="width: 22px; height: 22px; accent-color: var(--primary)"
              @change="doSlice"
            />
          </div>
        </div>

        <!-- 切分结果 -->
        <div class="card">
          <div class="card-title">切分结果（{{ slices.length }} 块）</div>
          <div v-if="slices.length > 0" class="slice-preview-block">
            <div class="slice-preview-label">整体效果预览</div>
            <div class="preview-wrap">
              <canvas ref="slicePreviewCanvas" class="slice-preview"></canvas>
            </div>
            <button class="btn btn-outline btn-full" @click="saveFull">保存完整图</button>
          </div>
          <div class="slice-grid" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: `${gap > 0 ? Math.min(gap, 12) : 4}px` }">
            <img
              v-for="(url, index) in sliceUrls"
              :key="index"
              :src="url"
              :alt="`第${index + 1}块`"
              class="slice-item"
              @click="openLightbox(index)"
            />
          </div>
          <p class="tip-text">
            点击单块可查看大图，弹层内可单独下载。「保存全部」只触发一次下载：多张会打成一个 ZIP，手机上不再需要逐张允许。
          </p>
        </div>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <ShareButton :get-files="sliceFiles" variant="outline" label="分享全部" title="九宫格切图" />
      <button class="btn btn-primary" @click="saveAll">保存全部</button>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*,.heic,.heif"
      style="display: none"
      @change="handleFileChange"
    />
    <!-- 大图预览弹层 -->
    <Teleport to="body">
      <div v-if="lightboxIndex !== null" class="lightbox-mask" @click.self="closeLightbox">
        <div class="lightbox-body" @click.stop>
          <button class="lightbox-close" aria-label="关闭" @click="closeLightbox">✕</button>
          <img :src="sliceUrls[lightboxIndex]" :alt="`第${lightboxIndex + 1}块大图`" class="lightbox-img" />
          <button class="btn btn-primary lightbox-download" @click="downloadLightbox">
            下载此块
          </button>
        </div>
      </div>
    </Teleport>

    <!-- 渐变图标定义（供空状态图标引用） -->
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <defs>
        <linearGradient id="icon-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ff8a5c" />
          <stop offset="100%" stop-color="#f4593a" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.app-shell {
  isolation: isolate;
  --primary: #ff8a5c;
  --gradient: linear-gradient(135deg, #ff8a5c, #f4593a);
  --gradient-soft: linear-gradient(135deg, color-mix(in srgb, #ff8a5c 12%, transparent), color-mix(in srgb, #f4593a 14%, transparent));
  --primary-light: color-mix(in srgb, #ff8a5c 8%, #fff);
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
.slice-grid {
  display: grid;
  padding: 10px;
  border-radius: 14px;
  background: rgba(244, 246, 252, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.9);
}

.slice-item {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(31, 41, 55, 0.1);
  cursor: pointer;
}

/* PC：切块 hover 高亮 */
@media (min-width: 768px) {
  .slice-item {
    transition: transform 0.18s, box-shadow 0.18s;
  }

  .slice-item:hover {
    transform: scale(1.05);
    box-shadow: 0 0 0 2.5px var(--primary), 0 6px 16px rgba(79, 110, 247, 0.25);
    z-index: 1;
  }
}

.slice-preview-block {
  margin-bottom: 12px;
}

.slice-preview-label {
  font-size: 13px;
  color: var(--text-sub);
  margin-bottom: 8px;
}

.slice-preview {
  width: 100%;
  height: auto;
}

.btn-full {
  margin-top: 10px;
  width: 100%;
}

/* 大图预览弹层 */
.lightbox-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(17, 24, 39, 0.78);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.lightbox-body {
  position: relative;
  max-width: min(92vw, 720px);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.lightbox-close {
  position: absolute;
  right: 0;
  top: -8px;
  transform: translateY(-100%);
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: var(--text-main);
  font-size: 15px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(31, 41, 55, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-img {
  max-width: 100%;
  max-height: 68vh;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

.lightbox-download {
  width: 200px;
  flex-shrink: 0;
}

/* PC 宽屏：双栏尺寸走 .tool-page 默认规则，这里覆盖比例并重排落位——
   切分设置独占左栏，原图与切分结果在右栏上下叠放 */
@media (min-width: 768px) {
  .page-content.tool-page {
    --pane-left: 1fr;
    --pane-right: 1.3fr;
  }

  .page-content .card:nth-child(1) {
    grid-column: 2;
    grid-row: 1;
  }

  .page-content .card:nth-child(2) {
    grid-column: 1;
    grid-row: 1;
  }

  .page-content .card:nth-child(3) {
    grid-column: 2;
    grid-row: 2;
  }
}
</style>
