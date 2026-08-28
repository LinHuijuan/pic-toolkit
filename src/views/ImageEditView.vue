<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, type CSSProperties } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, downloadBlob, type LoadedImage } from '../utils/imageLoader'
import {
  applyTransform,
  cropCanvas,
  applyAdjustments,
  DEFAULT_ADJUSTMENTS,
  FILTERS,
  type EditTransform,
  type FilterKey,
  type ImageAdjustments,
} from '../utils/imageEdit'
import { detectSmartCrop } from '../utils/smartCrop'
import { showToast } from '../utils/toast'
import { fetchSampleFile } from '../utils/sampleImage'
import ShareButton from '../components/ShareButton.vue'

const emit = defineEmits<{ back: []; navigate: [view: NextToolKey, file?: File]; consumed: [] }>()

const props = defineProps<{ incomingFile?: File | null }>()

// 接收其他工具流转过来的图片（如图片编辑）
onMounted(() => {
  const inc = props.incomingFile
  if (inc) {
    processFile(inc).catch((error) => {
      showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
    })
    emit('consumed')
  }
})

// 全站拖拽上传：把图片拖到页面任意位置导入当前工具
useImageDrop((files) => {
  if (files[0]) processFile(files[0])
})

type NextToolKey = 'compress' | 'format' | 'removeBg' | 'watermark' | 'grid' | 'idPhoto'

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><path d="M6.5 3.5h14v14"/><path d="M3.5 6.5h14v14"/></svg>`

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const stageRef = ref<HTMLDivElement | null>(null)

/** 旋转 / 翻转状态 */
const rotation = ref<EditTransform['rotation']>(0)
const flipH = ref(false)
const flipV = ref(false)

/** 裁切框（相对变换后图片的比例坐标 0~1） */
const crop = ref({ x: 0, y: 0, w: 1, h: 1 })

/** 调色 / 滤镜状态 */
const adjustments = ref<ImageAdjustments>({ ...DEFAULT_ADJUSTMENTS })
const activeFilter = ref<FilterKey | 'custom'>('none')

/** 撤销 / 重做历史快照 */
interface EditSnapshot {
  rotation: EditTransform['rotation']
  flipH: boolean
  flipV: boolean
  crop: { x: number; y: number; w: number; h: number }
  adjustments: ImageAdjustments
  activeFilter: FilterKey | 'custom'
}
const history = ref<EditSnapshot[]>([])
const historyIndex = ref(-1)
const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(() => historyIndex.value < history.value.length - 1)

/** 变换后的全尺寸画布（导出时用） */
let transformCanvas: HTMLCanvasElement | null = null

const MIN_CROP = 0.05
const MAX_PREVIEW_DIM = 2048

const RATIOS = [
  { key: 'free', label: '自由', value: null as number | null },
  { key: '1:1', label: '1:1', value: 1 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '3:4', label: '3:4', value: 3 / 4 },
  { key: '9:16', label: '9:16', value: 9 / 16 },
]
const ratioKey = ref('free')
const currentRatio = computed(() => RATIOS.find((r) => r.key === ratioKey.value)?.value ?? null)

/** 继续处理的目标工具（单图工具） */
const NEXT_TOOLS: { key: NextToolKey; label: string }[] = [
  { key: 'compress', label: '压缩' },
  { key: 'format', label: '转换' },
  { key: 'removeBg', label: '抠图' },
  { key: 'watermark', label: '水印' },
  { key: 'grid', label: '切图' },
  { key: 'idPhoto', label: '证件照' },
]
const showNextTools = ref(false)

/** 裁切框样式（相对预览画布百分比定位） */
const cropStyle = computed<CSSProperties>(() => ({
  left: `${(crop.value.x * 100).toFixed(2)}%`,
  top: `${(crop.value.y * 100).toFixed(2)}%`,
  width: `${(crop.value.w * 100).toFixed(2)}%`,
  height: `${(crop.value.h * 100).toFixed(2)}%`,
}))

function pickImage() {
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    processFile(file)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
  } finally {
    input.value = ''
  }
}

async function processFile(file: File) {
  const loaded = await loadImageFromFile(file)
  source.value = loaded
  rotation.value = 0
  flipH.value = false
  flipV.value = false
  adjustments.value = { ...DEFAULT_ADJUSTMENTS }
  activeFilter.value = 'none'
  await nextTick() // 等待编辑预览画布挂载后再绘制
  rebuild(true)
  history.value = []
  historyIndex.value = -1
  pushSnapshot()
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

/** 重建变换画布（含调色/滤镜）→（可选重置裁切框）→ 绘制预览 */
function rebuild(reset = true) {
  if (!source.value) return
  const base = applyTransform(source.value.bitmap, {
    rotation: rotation.value,
    flipH: flipH.value,
    flipV: flipV.value,
  })
  transformCanvas = applyAdjustments(base, adjustments.value)
  if (reset) resetCrop()
  renderPreview()
}

/** 生成当前编辑状态快照 */
function snapshot(): EditSnapshot {
  return {
    rotation: rotation.value,
    flipH: flipH.value,
    flipV: flipV.value,
    crop: { ...crop.value },
    adjustments: { ...adjustments.value },
    activeFilter: activeFilter.value,
  }
}

/** 将快照写入历史（自动去重并截断重做分支） */
function pushSnapshot() {
  const snap = snapshot()
  const last = history.value[historyIndex.value]
  if (last && JSON.stringify(last) === JSON.stringify(snap)) return
  history.value = history.value.slice(0, historyIndex.value + 1)
  history.value.push(snap)
  historyIndex.value = history.value.length - 1
}

/** 恢复到指定历史快照 */
function applySnapshot(snap: EditSnapshot) {
  rotation.value = snap.rotation
  flipH.value = snap.flipH
  flipV.value = snap.flipV
  crop.value = { ...snap.crop }
  adjustments.value = { ...snap.adjustments }
  activeFilter.value = snap.activeFilter
  rebuild(false)
}

function undo() {
  if (!canUndo.value) return
  historyIndex.value--
  applySnapshot(history.value[historyIndex.value])
}

function redo() {
  if (!canRedo.value) return
  historyIndex.value++
  applySnapshot(history.value[historyIndex.value])
}

/** 应用一键滤镜 */
function setFilter(key: FilterKey) {
  pushSnapshot()
  activeFilter.value = key
  const preset = FILTERS.find((f) => f.key === key)
  adjustments.value = { ...DEFAULT_ADJUSTMENTS, ...(preset?.adj ?? {}) }
  rebuild(false)
}

/** 滑块输入实时更新（仅重绘预览，不记历史） */
function onRange(key: keyof ImageAdjustments, event: Event) {
  adjustments.value[key] = Number((event.target as HTMLInputElement).value)
  rebuild(false)
}

/** 滑块变更时提交一个历史点 */
function onCommit(key: keyof ImageAdjustments, event?: Event) {
  if (event) adjustments.value[key] = Number((event.target as HTMLInputElement).value)
  pushSnapshot()
  activeFilter.value = 'custom'
  rebuild(false)
}

/** 重置裁切框：自由模式铺满，比例模式按比例居中最大框 */
function resetCrop() {
  const ratio = currentRatio.value
  if (!ratio) {
    crop.value = { x: 0, y: 0, w: 1, h: 1 }
    return
  }
  const full = transformCanvas
  if (!full) {
    crop.value = { x: 0, y: 0, w: 1, h: 1 }
    return
  }
  const imgRatio = full.width / full.height
  if (imgRatio > ratio) {
    // 图更宽：高度铺满，宽度按比例
    crop.value = { x: (1 - ratio / imgRatio) / 2, y: 0, w: ratio / imgRatio, h: 1 }
  } else {
    // 图更高：宽度铺满，高度按比例
    crop.value = { x: 0, y: (1 - imgRatio / ratio) / 2, w: 1, h: imgRatio / ratio }
  }
}

/** 绘制预览（按预览上限等比缩放） */
function renderPreview() {
  const el = previewCanvas.value
  if (!el || !transformCanvas) return
  const scale = Math.min(1, MAX_PREVIEW_DIM / Math.max(transformCanvas.width, transformCanvas.height))
  el.width = Math.max(1, Math.round(transformCanvas.width * scale))
  el.height = Math.max(1, Math.round(transformCanvas.height * scale))
  el.getContext('2d')?.drawImage(transformCanvas, 0, 0, el.width, el.height)
}

function rotateRight() {
  pushSnapshot()
  rotation.value = ((rotation.value + 90) % 360) as EditTransform['rotation']
  rebuild(true)
}

function toggleFlip(dir: 'h' | 'v') {
  pushSnapshot()
  if (dir === 'h') flipH.value = !flipH.value
  else flipV.value = !flipV.value
  rebuild(true)
}

function switchRatio(key: string) {
  if (ratioKey.value === key) return
  pushSnapshot()
  ratioKey.value = key
  resetCrop()
}

/** AI 智能裁剪：分析画面主体，自动定位最佳裁剪框（自由比例时默认推荐 4:3） */
function applySmartCrop() {
  if (!transformCanvas) return
  pushSnapshot()
  let ratio = currentRatio.value
  if (!ratio) {
    ratioKey.value = '4:3'
    ratio = 4 / 3
  }
  crop.value = detectSmartCrop(transformCanvas, ratio)
  showToast('已智能识别主体，自动定位裁剪框', 'success')
}

/** 拖拽状态：null 表示未拖拽 */
let dragState:
  | {
      mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'
      startCrop: { x: number; y: number; w: number; h: number }
      startX: number
      startY: number
    }
  | null = null

function onStagePointerDown(event: PointerEvent) {
  if (!source.value) return
  const target = event.target as HTMLElement
  const handle = target.closest('.crop-handle')?.getAttribute('data-handle') as 'nw' | 'ne' | 'sw' | 'se' | null
  const mode = handle ?? (target.closest('.crop-box') ? 'move' : null)
  if (!mode) return
  event.preventDefault()
  dragState = {
    mode,
    startCrop: { ...crop.value },
    startX: event.clientX,
    startY: event.clientY,
  }
  stageRef.value?.setPointerCapture(event.pointerId)
}

function onStagePointerMove(event: PointerEvent) {
  if (!dragState || !source.value) return
  const stage = stageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const dx = (event.clientX - dragState.startX) / rect.width
  const dy = (event.clientY - dragState.startY) / rect.height
  const { mode, startCrop } = dragState

  if (mode === 'move') {
    crop.value = {
      ...startCrop,
      x: Math.min(1 - startCrop.w, Math.max(0, startCrop.x + dx)),
      y: Math.min(1 - startCrop.h, Math.max(0, startCrop.y + dy)),
    }
    return
  }

  // 手柄缩放
  const ratio = currentRatio.value
  if (ratio) {
    resizeWithRatio(mode, startCrop, dx, ratio)
  } else {
    resizeFree(mode, startCrop, dx, dy)
  }
}

/** 自由比例手柄缩放 */
function resizeFree(
  mode: 'nw' | 'ne' | 'sw' | 'se',
  start: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
) {
  const c = { ...start }
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
  if (mode === 'se') {
    c.w = clamp(start.w + dx, MIN_CROP, 1 - start.x)
    c.h = clamp(start.h + dy, MIN_CROP, 1 - start.y)
  } else if (mode === 'nw') {
    c.w = clamp(start.w - dx, MIN_CROP, start.x + start.w)
    c.h = clamp(start.h - dy, MIN_CROP, start.y + start.h)
    c.x = start.x + start.w - c.w
    c.y = start.y + start.h - c.h
  } else if (mode === 'ne') {
    c.w = clamp(start.w + dx, MIN_CROP, 1 - start.x)
    c.h = clamp(start.h - dy, MIN_CROP, start.y + start.h)
    c.y = start.y + start.h - c.h
  } else {
    c.w = clamp(start.w - dx, MIN_CROP, start.x + start.w)
    c.h = clamp(start.h + dy, MIN_CROP, 1 - start.y)
    c.x = start.x + start.w - c.w
  }
  crop.value = c
}

/** 固定比例手柄缩放（以对角为锚点，保持宽高比） */
function resizeWithRatio(
  mode: 'nw' | 'ne' | 'sw' | 'se',
  start: { x: number; y: number; w: number; h: number },
  dx: number,
  ratio: number,
) {
  const c = { ...start }
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
  if (mode === 'se') {
    let w = clamp(start.w + dx, MIN_CROP, 1 - start.x)
    let h = w / ratio
    if (start.y + h > 1) {
      h = 1 - start.y
      w = h * ratio
    }
    c.w = w
    c.h = h
  } else if (mode === 'nw') {
    const anchorX = start.x + start.w
    const anchorY = start.y + start.h
    let w = clamp(anchorX - (start.x + dx), MIN_CROP, anchorX)
    let h = w / ratio
    if (anchorY - h < 0) {
      h = anchorY
      w = h * ratio
    }
    c.w = w
    c.h = h
    c.x = anchorX - w
    c.y = anchorY - h
  } else if (mode === 'ne') {
    const anchorY = start.y + start.h
    let w = clamp(start.w + dx, MIN_CROP, 1 - start.x)
    let h = w / ratio
    if (anchorY - h < 0) {
      h = anchorY
      w = h * ratio
    }
    c.w = w
    c.h = h
    c.y = anchorY - h
  } else {
    const anchorX = start.x + start.w
    let w = clamp(anchorX - (start.x + dx), MIN_CROP, anchorX)
    let h = w / ratio
    if (start.y + h > 1) {
      h = 1 - start.y
      w = h * ratio
    }
    c.w = w
    c.h = h
    c.x = anchorX - w
  }
  crop.value = c
}

function onStagePointerUp() {
  dragState = null
  pushSnapshot()
}

/** 按当前变换 + 裁切框导出画布 */
function buildOutput(): HTMLCanvasElement {
  if (!source.value || !transformCanvas) {
    throw new Error('请先选择图片')
  }
  const full = transformCanvas
  const rect = {
    x: crop.value.x * full.width,
    y: crop.value.y * full.height,
    w: crop.value.w * full.width,
    h: crop.value.h * full.height,
  }
  return cropCanvas(full, rect)
}

/** 保存格式：PNG（默认）或 JPG（白色背景填充，quality 0.92） */
const saveFormat = ref<'png' | 'jpg'>('png')

/** 按当前格式导出画布为 Blob（JPG 需白色背景填充） */
function exportCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (saveFormat.value === 'jpg') {
      const jpgCanvas = document.createElement('canvas')
      jpgCanvas.width = canvas.width
      jpgCanvas.height = canvas.height
      const ctx = jpgCanvas.getContext('2d')
      if (!ctx) {
        reject(new Error('导出失败'))
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, jpgCanvas.width, jpgCanvas.height)
      ctx.drawImage(canvas, 0, 0)
      jpgCanvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片导出失败'))), 'image/jpeg', 0.92)
    } else {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片导出失败'))), 'image/png')
    }
  })
}

/** 按当前格式导出为 File（下载与分享共用同一份编码结果与命名） */
async function buildResultFile(): Promise<File | null> {
  if (!source.value) return null
  const canvas = buildOutput()
  const ext = saveFormat.value === 'jpg' ? 'jpg' : 'png'
  const type = saveFormat.value === 'jpg' ? 'image/jpeg' : 'image/png'
  const blob = await exportCanvasToBlob(canvas)
  return new File([blob], `${source.value.name}_编辑.${ext}`, { type })
}

async function resultFiles(): Promise<File[]> {
  // 变换画布尚未生成时无结果可分享，返回空列表而不是抛错
  if (!transformCanvas) return []
  const file = await buildResultFile()
  return file ? [file] : []
}

async function saveResult() {
  if (!source.value) return
  try {
    const file = await buildResultFile()
    if (!file) return
    downloadBlob(file, file.name)
    showToast('已开始下载', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

/** 导出并跳转到目标工具继续处理（格式与文件名后缀随当前格式变化） */
function continueTo(key: NextToolKey) {
  if (!source.value) return
  try {
    const canvas = buildOutput()
    const ext = saveFormat.value === 'jpg' ? 'jpg' : 'png'
    const type = saveFormat.value === 'jpg' ? 'image/jpeg' : 'image/png'
    exportCanvasToBlob(canvas)
      .then((blob) => {
        const file = new File([blob], `${source.value?.name ?? 'image'}_编辑.${ext}`, { type })
        showNextTools.value = false
        emit('navigate', key, file)
      })
      .catch(() => showToast('导出图片失败', 'error'))
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导出失败', 'error')
  }
}

// 组件卸载时释放源图 bitmap
onUnmounted(() => {
  try {
    source.value?.bitmap.close()
  } catch {
    /* bitmap 已关闭，忽略 */
  }
  dragState = null
})
</script>

<template>
  <div class="app-shell">
    <!-- 顶部导航 -->
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">图片编辑</div>
    </div>

    <div class="page-content">
      <!-- 未选图状态 -->
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张图片，自由裁剪、旋转翻转</div>
        <div class="empty-actions">
          <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择图片</button>
          <button class="btn btn-sample" @click="loadSample">体验示例图</button>
        </div>
      </div>

      <template v-else>
        <!-- 编辑预览 -->
        <div class="card">
          <div class="card-title">编辑预览</div>
          <div class="preview-wrap">
            <div
              ref="stageRef"
              class="edit-stage"
              @pointerdown="onStagePointerDown"
              @pointermove="onStagePointerMove"
              @pointerup="onStagePointerUp"
              @pointercancel="onStagePointerUp"
            >
              <canvas ref="previewCanvas" class="edit-canvas"></canvas>
              <div class="crop-box" :style="cropStyle">
                <div class="crop-handle nw" data-handle="nw"></div>
                <div class="crop-handle ne" data-handle="ne"></div>
                <div class="crop-handle sw" data-handle="sw"></div>
                <div class="crop-handle se" data-handle="se"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 编辑操作 -->
        <div class="card">
          <div class="card-title">编辑操作</div>
          <div class="form-row">
            <span class="label">历史</span>
            <div style="display: flex; gap: 8px; flex: 1; justify-content: flex-end">
              <button class="btn btn-outline btn-sm" :disabled="!canUndo" @click="undo">撤销</button>
              <button class="btn btn-outline btn-sm" :disabled="!canRedo" @click="redo">重做</button>
            </div>
          </div>
          <div class="form-row">
            <span class="label">滤镜</span>
            <div class="filter-chips">
              <button
                v-for="f in FILTERS"
                :key="f.key"
                class="btn btn-outline btn-sm"
                :class="{ active: activeFilter === f.key }"
                @click="setFilter(f.key)"
              >
                {{ f.label }}
              </button>
            </div>
          </div>
          <div class="form-row">
            <span class="label">亮度</span>
            <input
              class="slider"
              type="range"
              min="0.5"
              max="1.5"
              step="0.01"
              :value="adjustments.brightness"
              @input="onRange('brightness', $event)"
              @change="onCommit('brightness', $event)"
            />
            <span class="range-value">{{ Math.round(adjustments.brightness * 100) }}%</span>
          </div>
          <div class="form-row">
            <span class="label">对比度</span>
            <input
              class="slider"
              type="range"
              min="0.5"
              max="1.8"
              step="0.01"
              :value="adjustments.contrast"
              @input="onRange('contrast', $event)"
              @change="onCommit('contrast', $event)"
            />
            <span class="range-value">{{ Math.round(adjustments.contrast * 100) }}%</span>
          </div>
          <div class="form-row">
            <span class="label">饱和度</span>
            <input
              class="slider"
              type="range"
              min="0"
              max="2"
              step="0.01"
              :value="adjustments.saturate"
              @input="onRange('saturate', $event)"
              @change="onCommit('saturate', $event)"
            />
            <span class="range-value">{{ Math.round(adjustments.saturate * 100) }}%</span>
          </div>
          <div class="form-row">
            <span class="label">色相</span>
            <input
              class="slider"
              type="range"
              min="-180"
              max="180"
              step="1"
              :value="adjustments.hueRotate"
              @input="onRange('hueRotate', $event)"
              @change="onCommit('hueRotate', $event)"
            />
            <span class="range-value">{{ adjustments.hueRotate }}°</span>
          </div>
          <div class="form-row">
            <span class="label">清晰度</span>
            <input
              class="slider"
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="adjustments.sharpen"
              @change="onCommit('sharpen', $event)"
            />
          </div>
          <div class="form-row">
            <span class="label">方向</span>
            <div style="display: flex; gap: 8px; flex: 1; justify-content: flex-end; flex-wrap: wrap">
              <button class="btn btn-outline btn-sm" @click="rotateRight">旋转 90°</button>
              <button class="btn btn-outline btn-sm" @click="toggleFlip('h')">水平翻转</button>
              <button class="btn btn-outline btn-sm" @click="toggleFlip('v')">垂直翻转</button>
            </div>
          </div>
          <div class="form-row">
            <span class="label">比例</span>
            <div class="seg-control" style="flex: 1">
              <div
                v-for="r in RATIOS"
                :key="r.key"
                class="seg-item"
                :class="{ active: ratioKey === r.key }"
                @click="switchRatio(r.key)"
              >
                {{ r.label }}
              </div>
            </div>
          </div>
          <div class="form-row">
            <span class="label">智能</span>
            <button class="btn btn-primary btn-sm" style="flex: 1" @click="applySmartCrop">
              ✨ AI 智能裁剪
            </button>
          </div>
          <p class="tip-text">
            拖动裁切框移动位置，拖四角手柄调整大小{{ currentRatio ? '（保持当前比例）' : '' }}。裁剪后可直接保存或继续使用其他工具。
          </p>
        </div>

        <!-- 继续处理 -->
        <div v-if="showNextTools" class="card">
          <div class="card-title">继续处理</div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px">
            <button
              v-for="tool in NEXT_TOOLS"
              :key="tool.key"
              class="btn btn-outline"
              style="flex: 1; min-width: 80px"
              @click="continueTo(tool.key)"
            >
              {{ tool.label }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="source" class="bottom-bar">
      <div class="format-switch">
        <div class="fmt-item" :class="{ active: saveFormat === 'png' }" @click="saveFormat = 'png'">PNG</div>
        <div class="fmt-item" :class="{ active: saveFormat === 'jpg' }" @click="saveFormat = 'jpg'">JPG</div>
      </div>
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <button class="btn btn-outline" @click="showNextTools = !showNextTools">继续处理</button>
      <ShareButton :get-files="resultFiles" variant="outline" />
      <button class="btn btn-primary" @click="saveResult">保存图片</button>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*,.heic,.heif"
      style="display: none"
      @change="handleFileChange"
    />
    <!-- 渐变图标定义（供空状态图标引用） -->
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <defs>
        <linearGradient id="icon-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#22d3ee" />
          <stop offset="100%" stop-color="#0ea5e9" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.app-shell {
  isolation: isolate;
  --primary: #22d3ee;
  --gradient: linear-gradient(135deg, #22d3ee, #0ea5e9);
  --gradient-soft: linear-gradient(135deg, color-mix(in srgb, #22d3ee 12%, transparent), color-mix(in srgb, #0ea5e9 14%, transparent));
  --primary-light: color-mix(in srgb, #22d3ee 8%, #fff);
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
.edit-stage {
  position: relative;
  display: inline-block;
  max-width: 100%;
  line-height: 0;
  touch-action: none;
}

.edit-canvas {
  display: block;
  max-width: 100%;
  height: auto;
}

/* 裁切框：虚线边框 + 半透明遮罩由外侧负边距实现 */
.crop-box {
  position: absolute;
  border: 1.5px solid #fff;
  outline: 1px dashed rgba(79, 110, 247, 0.9);
  box-shadow: 0 0 0 9999px rgba(31, 41, 55, 0.35);
  cursor: move;
  box-sizing: border-box;
}

.crop-handle {
  position: absolute;
  width: 16px;
  height: 16px;
  background: #fff;
  border: 2px solid var(--primary);
  border-radius: 50%;
  box-sizing: border-box;
  touch-action: none;
}

.crop-handle.nw {
  left: -8px;
  top: -8px;
  cursor: nwse-resize;
}

.crop-handle.ne {
  right: -8px;
  top: -8px;
  cursor: nesw-resize;
}

.crop-handle.sw {
  left: -8px;
  bottom: -8px;
  cursor: nesw-resize;
}

.crop-handle.se {
  right: -8px;
  bottom: -8px;
  cursor: nwse-resize;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 13px;
}

/* 底部格式切换（PNG / JPG） */
.format-switch {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 12px;
  background: var(--bg-page);
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.format-switch .fmt-item {
  padding: 8px 11px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-sub);
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.format-switch .fmt-item.active {
  background: var(--gradient-soft);
  color: var(--primary);
  font-weight: 600;
}

/* PC 宽屏：编辑预览与设置并排双栏 */
@media (min-width: 768px) {
  .page-content {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }

  .page-content .card:nth-child(1) {
    grid-column: 1;
    grid-row: 1 / span 2;
  }

  .page-content .card:nth-child(2) {
    grid-column: 2;
    grid-row: 1;
  }

  .page-content .card:nth-child(3) {
    grid-column: 2;
    grid-row: 2;
  }

  .edit-stage {
    max-width: 100%;
  }

  .format-switch .fmt-item {
    padding: 9px 14px;
    font-size: 14px;
  }
}

/* 滤镜 chips */
.filter-chips {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}
.filter-chips .btn {
  width: auto;
  padding: 6px 12px;
}
.filter-chips .btn.active {
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-color: transparent;
}

/* 调色滑块 */
.slider {
  flex: 1;
  min-width: 120px;
  accent-color: #6366f1;
}
.range-value {
  min-width: 44px;
  font-size: 12px;
  color: var(--text-sub);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 禁用按钮 */
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
