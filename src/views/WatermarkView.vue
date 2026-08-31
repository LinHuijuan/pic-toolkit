<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, type CSSProperties } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import {
  loadImageFromFile,
  downloadCanvas,
  canvasToBlob,
  canvasToFile,
  type LoadedImage,
} from '../utils/imageLoader'
import { saveMany } from '../utils/zip'
import { withJpegMetadata } from '../utils/exif'
import ShareButton from '../components/ShareButton.vue'
import { drawWatermark, drawImageWatermark, type WatermarkMode, type WatermarkPosition } from '../utils/watermark'
import { showToast } from '../utils/toast'
import { fetchSampleFile } from '../utils/sampleImage'

const emit = defineEmits<{ back: []; consumed: [] }>()

const props = defineProps<{ incomingFile?: File | null }>()

// 全站拖拽上传：拖一张进编辑器，拖多张直接批量套用当前参数
useImageDrop((files) => {
  if (files.length > 1) {
    runBatch(files)
    return
  }
  if (files[0]) processFile(files[0])
})

const fileInput = ref<HTMLInputElement | null>(null)
const logoInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)

const wmType = ref<'text' | 'image'>('text')
const text = ref('© 图片工具箱')
const mode = ref<WatermarkMode>('tile')
const fontSizeRatio = ref(4) // 百分比，4 = 4%
const logoSizeRatio = ref(20) // 百分比，20 = 20%
const opacity = ref(40) // 百分比
const color = ref('#ffffff')
const position = ref<WatermarkPosition>('bottom-right')
const angle = ref(-30)
const fontFamily = ref('sans-serif')

const FONTS = [
  { label: '默认', value: 'sans-serif' },
  { label: '宋体', value: 'serif' },
  { label: '楷体', value: "'KaiTi', 'STKaiti', serif" },
  { label: '黑体', value: "'Microsoft YaHei', 'Heiti SC', sans-serif" },
  { label: '等宽', value: 'monospace' },
]

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
/** 文字水印常用模板（一键套用） */
const WATERMARK_TEMPLATES = ['仅供学习交流', '盗图必究', '© 版权所有', '示例水印']

/** 套用常用模板（text 变化由 watch 自动触发预览重建） */
function applyTemplate(t: string) {
  text.value = t
}

const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><path d="M12 3.5c3.2 4.2 5.5 7.1 5.5 10a5.5 5.5 0 1 1-11 0c0-2.9 2.3-5.8 5.5-10Z"/><path d="M8.5 14.5h7M9.5 17h5"/></svg>`

/** Logo 图片（水印类型为图片时使用） */
const logo = ref<LoadedImage | null>(null)
const logoUrl = ref('')

/** 单点模式下拖拽自定义的文字中心位置（相对图片 0~1 比例），null 表示使用预设位置 */
const customPosition = ref<{ x: number; y: number } | null>(null)
const dragging = ref(false)
/** 图片显示宽度 / 原始宽度，用于拖拽层文字随图片等比缩放 */
const displayScale = ref(1)
const stageRef = ref<HTMLDivElement | null>(null)
/** 与 watermark.ts 中 marginRatio 默认值保持一致 */
const MARGIN_RATIO = 0.05

/** 快照式撤销/重做：记录每次生成的水印结果，可回退/前进（与编辑页一致） */
const MAX_HISTORY = 20
const resultStack = ref<{ canvas: HTMLCanvasElement; url: string }[]>([])
const resultIndex = ref(-1)

function commitResult(canvas: HTMLCanvasElement) {
  const url = canvas.toDataURL('image/png')
  const top = resultStack.value[resultIndex.value]
  if (top && top.url === url) return
  // 首次生成前，先压入纯原图作为栈底（便于撤销水印时回到原图）
  if (resultStack.value.length === 0 && source.value) {
    const srcCanvas = document.createElement('canvas')
    srcCanvas.width = source.value.width
    srcCanvas.height = source.value.height
    srcCanvas.getContext('2d')?.drawImage(source.value.bitmap, 0, 0)
    resultStack.value.push({ canvas: srcCanvas, url: srcCanvas.toDataURL('image/png') })
  }
  resultStack.value = resultStack.value.slice(0, resultIndex.value + 1)
  resultStack.value.push({ canvas, url })
  if (resultStack.value.length > MAX_HISTORY) resultStack.value.shift()
  resultIndex.value = resultStack.value.length - 1
  resultCanvas.value = canvas
  resultUrl.value = url
}

function undo() {
  if (resultIndex.value <= 0) return
  resultIndex.value--
  const item = resultStack.value[resultIndex.value]
  resultCanvas.value = item.canvas
  resultUrl.value = item.url
}

function redo() {
  if (resultIndex.value >= resultStack.value.length - 1) return
  resultIndex.value++
  const item = resultStack.value[resultIndex.value]
  resultCanvas.value = item.canvas
  resultUrl.value = item.url
}

let resizeObserver: ResizeObserver | null = null

/** 单点预设位置 → 文字中心比例（边距基于短边，与绘制逻辑一致） */
function positionToRatio(pos: WatermarkPosition, imgW: number, imgH: number): { x: number; y: number } {
  const margin = Math.round(Math.min(imgW, imgH) * MARGIN_RATIO)
  const mx = margin / imgW
  const my = margin / imgH
  switch (pos) {
    case 'center':
      return { x: 0.5, y: 0.5 }
    case 'top-left':
      return { x: mx, y: my }
    case 'top-right':
      return { x: 1 - mx, y: my }
    case 'bottom-left':
      return { x: mx, y: 1 - my }
    case 'bottom-right':
    default:
      return { x: 1 - mx, y: 1 - my }
  }
}

/** 拖拽层样式：位置与字号按图片原始像素计算，整体随图片显示比例缩放 */
const wmStyle = computed<CSSProperties>(() => {
  const src = source.value
  if (!src) return {}
  const pos = customPosition.value ?? positionToRatio(position.value, src.width, src.height)
  const base = {
    left: `${(pos.x * src.width).toFixed(1)}px`,
    top: `${(pos.y * src.height).toFixed(1)}px`,
    opacity: opacity.value / 100,
    transform: `translate(-50%, -50%) scale(${displayScale.value})`,
  }
  if (wmType.value === 'image') {
    if (!logo.value) return {}
    const logoW = Math.max(8, Math.round(src.width * (logoSizeRatio.value / 100)))
    return {
      ...base,
      width: `${logoW}px`,
    }
  }
  const shortSide = Math.min(src.width, src.height)
  const fontSize = Math.max(12, Math.round(shortSide * (fontSizeRatio.value / 100)))
  return {
    ...base,
    fontSize: `${fontSize}px`,
    color: color.value,
    fontFamily: fontFamily.value,
  }
})

/** 测量图片显示缩放比（显示宽度 / 原始宽度） */
function measureScale() {
  const stage = stageRef.value
  if (!stage || !source.value) return
  const w = stage.clientWidth
  if (w > 0) {
    displayScale.value = w / source.value.width
  }
}

function startDrag(event: PointerEvent) {
  if (mode.value !== 'single' || !source.value) return
  event.preventDefault()
  dragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onDragMove(event: PointerEvent) {
  if (!dragging.value || !source.value) return
  const stage = stageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  customPosition.value = {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  }
}

function endDrag() {
  if (!dragging.value) return
  dragging.value = false
  // 松手后按最终位置重新生成水印
  applyWatermark()
}

/** 选择预设位置（清除拖拽自定义位置） */
function selectPosition(pos: WatermarkPosition) {
  if (position.value === pos) return
  position.value = pos
  customPosition.value = null
}

const COLORS = [
  { label: '白色', value: '#ffffff' },
  { label: '黑色', value: '#000000' },
  { label: '红色', value: '#ef4444' },
  { label: '蓝色', value: '#3b82f6' },
]

const resultCanvas = ref<HTMLCanvasElement | null>(null)
const resultUrl = ref('')

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

/** 加载图片并生成水印预览 */
async function processFile(file: File) {
  source.value = await loadImageFromFile(file)
  // 根据图片亮度自动推荐水印颜色：亮图用深色，暗图用白色
  color.value = (await isImageBright(source.value.bitmap)) ? '#000000' : '#ffffff'
  applyWatermark()
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

// 接收其他工具流转过来的图片（如图片编辑 → 水印）
onMounted(() => {
  if (props.incomingFile) {
    processFile(props.incomingFile).catch((error) => {
      showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
    })
    emit('consumed')
  }
})

/** 选择 Logo 图片（水印类型为图片时使用） */
async function handleLogoChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    logo.value = await loadImageFromFile(file)
    if (logoUrl.value) {
      URL.revokeObjectURL(logoUrl.value)
    }
    logoUrl.value = URL.createObjectURL(file)
    applyWatermark()
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Logo 加载失败', 'error')
  } finally {
    input.value = ''
  }
}

/** 采样图片像素亮度，判断是否为亮图（平均亮度 > 150 视为亮，推荐深色水印） */
async function isImageBright(bitmap: ImageBitmap): Promise<boolean> {
  const canvas = document.createElement('canvas')
  // 缩小到 32px 边长采样，控制性能开销
  const scale = Math.min(1, 32 / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let sum = 0
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    count++
  }
  return count > 0 && sum / count > 150
}

/** 用当前参数渲染一张水印图（单图预览与批量套用共用同一套参数） */
function renderWatermark(bitmap: ImageBitmap, imgW: number, imgH: number): HTMLCanvasElement {
  // 单点模式：用拖拽自定义位置（无则用预设位置换算的比例）
  const ratio =
    mode.value === 'single'
      ? (customPosition.value ?? positionToRatio(position.value, imgW, imgH))
      : undefined
  if (wmType.value === 'image') {
    if (!logo.value) throw new Error('请先选择 Logo 图片')
    return drawImageWatermark(bitmap, logo.value.bitmap, {
      opacity: opacity.value / 100,
      mode: mode.value,
      position: position.value,
      sizeRatio: logoSizeRatio.value / 100,
      xRatio: ratio?.x,
      yRatio: ratio?.y,
    })
  }
  return drawWatermark(bitmap, {
    text: text.value,
    fontSizeRatio: fontSizeRatio.value / 100,
    color: color.value,
    opacity: opacity.value / 100,
    mode: mode.value,
    position: position.value,
    angle: angle.value,
    fontFamily: fontFamily.value,
    xRatio: ratio?.x,
    yRatio: ratio?.y,
  })
}

function applyWatermark() {
  if (!source.value) return
  try {
    commitResult(renderWatermark(source.value.bitmap, source.value.width, source.value.height))
  } catch (error) {
    showToast(error instanceof Error ? error.message : '水印生成失败', 'error')
  }
}

async function resultFiles(): Promise<File[]> {
  if (!source.value || !resultCanvas.value) return []
  return [await canvasToFile(resultCanvas.value, `${source.value.name}_水印.png`)]
}

function saveResult() {
  if (!source.value || !resultCanvas.value) return
  downloadCanvas(resultCanvas.value, `${source.value.name}_水印.png`)
  showToast('已开始下载', 'success')
}

/** 批量队列：只保留已编码的 Blob 与预览 URL，画布用完即弃，避免多张大图同时驻留内存 */
interface BatchItem {
  name: string
  url: string
  blob: Blob
}

/** 一次上限：再多移动端浏览器就会因为内存吃不消而静默失败 */
const MAX_BATCH = 30

const batchInput = ref<HTMLInputElement | null>(null)
const batchItems = ref<BatchItem[]>([])
const batchProcessing = ref(false)
const batchProgress = ref({ done: 0, total: 0 })
/** 保留源 JPEG 的拍摄信息：默认关，EXIF 可能含 GPS，由用户显式开启 */
const keepMeta = ref(false)

function clearBatch() {
  batchItems.value.forEach((item) => URL.revokeObjectURL(item.url))
  batchItems.value = []
  batchProgress.value = { done: 0, total: 0 }
}

function pickBatch() {
  batchInput.value?.click()
}

/** 照片类源图用 JPEG 输出：批量几十张时 PNG 的体积会把内存先吃光 */
function pickOutputType(file: File): { type: string; ext: string } {
  return file.type === 'image/jpeg' || file.type === 'image/jpg'
    ? { type: 'image/jpeg', ext: 'jpg' }
    : { type: 'image/png', ext: 'png' }
}

async function runBatch(files: File[]) {
  if (batchProcessing.value || files.length === 0) return
  if (!source.value) {
    showToast('先调好水印参数，再批量套用到其他图片', 'error')
    return
  }
  const list = files.slice(0, MAX_BATCH)
  if (files.length > list.length) {
    showToast(`一次最多 ${MAX_BATCH} 张，已取前 ${MAX_BATCH} 张`, 'error')
  }
  clearBatch()
  batchProcessing.value = true
  batchProgress.value = { done: 0, total: list.length }
  try {
    for (const file of list) {
      try {
        const image = await loadImageFromFile(file)
        const { type, ext } = pickOutputType(file)
        const canvas = renderWatermark(image.bitmap, image.width, image.height)
        const encoded = await canvasToBlob(canvas, type, 0.92)
        // PNG 输出会在 withJpegMetadata 里原样返回
        const blob = await withJpegMetadata(encoded, keepMeta.value ? file : undefined)
        image.bitmap.close()
        batchItems.value.push({
          name: `${file.name.replace(/\.[^.]+$/, '')}_水印.${ext}`,
          url: URL.createObjectURL(blob),
          blob,
        })
      } catch {
        showToast(`${file.name} 处理失败，已跳过`, 'error')
      }
      batchProgress.value = { done: batchProgress.value.done + 1, total: list.length }
      // 逐张让出主线程：批量几十张时不能把页面锁死
      await new Promise((r) => setTimeout(r, 0))
    }
  } finally {
    batchProcessing.value = false
  }
}

async function handleBatchChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await runBatch(files)
}

async function batchFiles(): Promise<File[]> {
  return batchItems.value.map((item) => new File([item.blob], item.name, { type: item.blob.type }))
}

async function saveBatch() {
  const files = await batchFiles()
  if (files.length === 0) return
  await saveMany(files, '批量水印.zip')
  showToast(files.length > 1 ? '已打包下载' : '已开始下载', 'success')
}

// 组件卸载时释放批量结果的 object URL
onUnmounted(clearBatch)

function handleReplace() {
  if (!source.value || !resultCanvas.value) return
  // 用带水印的结果替换当前源图，继续叠加
  const canvas = resultCanvas.value
  createImageBitmap(canvas).then((newBitmap) => {
    // 新位图创建成功后关闭旧 bitmap，避免内存泄漏
    try {
      source.value?.bitmap.close()
    } catch {
      /* bitmap 已关闭，忽略 */
    }
    source.value = {
      bitmap: newBitmap,
      width: canvas.width,
      height: canvas.height,
      name: source.value?.name ?? 'image',
    }
    applyWatermark()
  })
}

// 参数变化时自动重新生成
watch(
  [text, mode, wmType, fontSizeRatio, logoSizeRatio, opacity, color, position, angle, fontFamily],
  applyWatermark,
)

// Logo 变化时重新生成
watch(logo, applyWatermark)

// 切换样式时重置拖拽状态（避免拖拽中切换模式残留）
watch(mode, () => {
  dragging.value = false
})

// 源图变化后测量显示缩放比，并监听拖拽层尺寸变化（窗口缩放 / 容器变化时更新）
watch(
  source,
  () => {
    resizeObserver?.disconnect()
    const stage = stageRef.value
    if (!stage) return
    resizeObserver = new ResizeObserver(measureScale)
    resizeObserver.observe(stage)
    measureScale()
  },
  { flush: 'post' },
)

// 组件卸载时释放源图 / Logo 的 bitmap、预览 URL 与观察器
onUnmounted(() => {
  resizeObserver?.disconnect()
  try {
    source.value?.bitmap.close()
  } catch {
    /* bitmap 已关闭，忽略 */
  }
  try {
    logo.value?.bitmap.close()
  } catch {
    /* bitmap 已关闭，忽略 */
  }
  if (logoUrl.value) {
    URL.revokeObjectURL(logoUrl.value)
  }
})
</script>

<template>
  <div class="app-shell">
    <!-- 顶部导航 -->
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">添加水印</div>
    </div>

    <div class="page-content tool-page">
      <!-- 未选图状态 -->
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张图片添加水印</div>
        <div class="empty-actions">
                  <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择图片</button>
                  <button class="btn btn-sample" @click="loadSample">体验示例图</button>
                </div>
      </div>

      <template v-else>
        <!-- 结果预览 -->
        <div class="card">
          <div class="card-title">预览</div>
          <div class="preview-wrap">
            <div ref="stageRef" class="wm-stage">
              <img :src="resultUrl" alt="水印预览" />
              <img
                v-if="mode === 'single' && wmType === 'image' && logoUrl"
                :src="logoUrl"
                alt="Logo 水印"
                class="wm-text"
                :style="wmStyle"
                @pointerdown="startDrag"
                @pointermove="onDragMove"
                @pointerup="endDrag"
                @pointercancel="endDrag"
              />
              <div
                v-else-if="mode === 'single'"
                class="wm-text"
                :style="wmStyle"
                @pointerdown="startDrag"
                @pointermove="onDragMove"
                @pointerup="endDrag"
                @pointercancel="endDrag"
              >{{ text }}</div>
            </div>
          </div>
          <!-- 撤销/重做作用在预览结果上，摆在预览下面而不是底栏：底栏窄屏装不下 6 项 -->
          <div class="form-row">
            <span class="label">叠加历史</span>
            <div style="display: flex; gap: 8px; flex: 1; justify-content: flex-end">
              <button class="btn btn-outline btn-sm" :disabled="resultIndex <= 0" @click="undo">撤销</button>
              <button class="btn btn-outline btn-sm" :disabled="resultIndex >= resultStack.length - 1" @click="redo">
                重做
              </button>
            </div>
          </div>
        </div>

        <!-- 水印设置 -->
        <div class="card">
          <div class="card-title">水印设置</div>

          <div class="form-row">
            <span class="label">水印类型</span>
            <div class="seg-control" style="flex: 1">
              <div class="seg-item" :class="{ active: wmType === 'text' }" @click="wmType = 'text'">
                文字
              </div>
              <div class="seg-item" :class="{ active: wmType === 'image' }" @click="wmType = 'image'">
                图片
              </div>
            </div>
          </div>

          <div v-if="wmType === 'text'" class="form-row">
            <span class="label">水印文字</span>
            <input v-model="text" type="text" maxlength="30" placeholder="请输入水印文字" />
          </div>

          <div v-if="wmType === 'text'" class="form-row">
            <span class="label">模板</span>
            <div class="tmpl-chips">
              <span v-for="t in WATERMARK_TEMPLATES" :key="t" class="tmpl-chip" @click="applyTemplate(t)">{{ t }}</span>
            </div>
          </div>

          <div v-else class="form-row">
            <span class="label">Logo 图片</span>
            <button class="btn btn-outline" style="flex: 1; padding: 8px" @click="logoInput?.click()">
              {{ logo ? '更换 Logo' : '选择 Logo' }}
            </button>
          </div>
          <p v-if="wmType === 'image'" class="tip-text" style="margin-top: 2px">
            建议使用透明背景 PNG，小尺寸 Logo 效果更佳。
          </p>

          <div class="form-row">
            <span class="label">样式</span>
            <div class="seg-control" style="flex: 1">
              <div class="seg-item" :class="{ active: mode === 'tile' }" @click="mode = 'tile'">
                平铺
              </div>
              <div class="seg-item" :class="{ active: mode === 'single' }" @click="mode = 'single'">
                单点
              </div>
            </div>
          </div>

          <div v-if="mode === 'tile' && wmType === 'text'" class="range-row">
            <span class="label">旋转角度</span>
            <input v-model.number="angle" type="range" min="-90" max="90" step="5" />
            <span class="range-val">{{ angle }}°</span>
          </div>

          <div v-else class="form-row">
            <span class="label">位置</span>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end">
              <div
                v-for="pos in (['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as WatermarkPosition[])"
                :key="pos"
                class="pos-chip"
                :class="{ active: position === pos }"
                @click="selectPosition(pos)"
              >
                {{ ({ center: '居中', 'top-left': '左上', 'top-right': '右上', 'bottom-left': '左下', 'bottom-right': '右下' } as Record<string, string>)[pos] }}
              </div>
            </div>
          </div>
          <p v-if="mode === 'single'" class="tip-text" style="margin-top: 2px">
            也可以直接在预览图中拖动文字调整位置。
          </p>

          <div v-if="wmType === 'image'" class="range-row">
            <span class="label">Logo 尺寸</span>
            <input v-model.number="logoSizeRatio" type="range" min="5" max="50" />
            <span class="range-val">{{ logoSizeRatio }}%</span>
          </div>

          <div v-else class="range-row">
            <span class="label">字号</span>
            <input v-model.number="fontSizeRatio" type="range" min="1" max="15" />
            <span class="range-val">{{ fontSizeRatio }}%</span>
          </div>

          <div v-if="wmType === 'text'" class="form-row">
            <span class="label">字体</span>
            <select v-model="fontFamily" class="select-input" style="flex: 1">
              <option v-for="f in FONTS" :key="f.value" :value="f.value">{{ f.label }}</option>
            </select>
          </div>

          <div class="range-row">
            <span class="label">透明度</span>
            <input v-model.number="opacity" type="range" min="5" max="100" step="5" />
            <span class="range-val">{{ opacity }}%</span>
          </div>

          <div v-if="wmType === 'text'" class="form-row">
            <span class="label">颜色</span>
            <div class="color-dots">
              <div
                v-for="c in COLORS"
                :key="c.value"
                class="color-dot"
                :class="{ active: color === c.value }"
                :style="{ background: c.value }"
                @click="color = c.value"
              ></div>
            </div>
          </div>
        </div>

        <p class="tip-text">
          参数调整后自动生成预览。水印支持叠加使用：点击「继续叠加」可在已加水印的图上再加一层。
        </p>

        <!-- 批量：把上面这套参数一次套到多张图 -->
        <div class="card-title batch-title">批量套用</div>
        <p class="tip-text">调好一套参数后，可以一次给几十张图加同样的水印；保存全部时多张会打成一个 ZIP。</p>
        <div class="form-row">
          <span class="label">保留拍摄信息</span>
          <input
            v-model="keepMeta"
            type="checkbox"
            style="width: 22px; height: 22px; accent-color: var(--primary); flex: 0 0 auto; margin-left: auto"
          />
        </div>
        <p class="tip-text">仅对照片类源图（JPEG 输出）有效，会把拍摄时间与机型搬过去；EXIF 可能含 GPS。</p>
        <button
          class="btn btn-outline"
          style="width: 100%"
          :disabled="batchProcessing"
          @click="pickBatch"
        >
          {{ batchProcessing ? `处理中 ${batchProgress.done} / ${batchProgress.total}` : '选择多张图片' }}
        </button>
        <div v-if="batchItems.length > 0" class="batch-grid">
          <img
            v-for="item in batchItems"
            :key="item.url"
            class="batch-thumb"
            :src="item.url"
            :alt="item.name"
          />
        </div>
        <div v-if="batchItems.length > 0 && !batchProcessing" class="batch-actions">
          <ShareButton :get-files="batchFiles" variant="outline" :label="`分享 ${batchItems.length} 张`" />
          <button class="btn btn-ghost" @click="clearBatch">清空</button>
          <button class="btn btn-primary" @click="saveBatch">保存全部</button>
        </div>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <button class="btn btn-outline" @click="handleReplace">继续叠加</button>
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
    <input
      ref="logoInput"
      type="file"
      accept="image/*,.heic,.heif"
      style="display: none"
      @change="handleLogoChange"
    />
    <input
      ref="batchInput"
      type="file"
      accept="image/*,.heic,.heif"
      multiple
      style="display: none"
      @change="handleBatchChange"
    />
    <!-- 渐变图标定义（供空状态图标引用） -->
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <defs>
        <linearGradient id="icon-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#f472b6" />
          <stop offset="100%" stop-color="#db2777" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.app-shell {
  isolation: isolate;
  --primary: #f472b6;
  --gradient: linear-gradient(135deg, #f472b6, #db2777);
  --gradient-soft: linear-gradient(135deg, color-mix(in srgb, #f472b6 12%, transparent), color-mix(in srgb, #db2777 14%, transparent));
  --primary-light: color-mix(in srgb, #f472b6 8%, #fff);
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
/* 常用水印模板 */
.tmpl-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  flex: 1;
}
.tmpl-chip {
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  font-size: 12px;
  color: var(--text-sub);
  cursor: pointer;
  transition: all 0.15s;
}
.tmpl-chip:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--gradient-soft);
}

.pos-chip {
  padding: 7px 12px;
  border-radius: 10px;
  border: 1.5px solid var(--border);
  background: #fff;
  font-size: 13px;
  color: var(--text-sub);
  cursor: pointer;
  transition: all 0.15s;
}

.pos-chip.active {
  border-color: transparent;
  background: var(--gradient-soft);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(79, 110, 247, 0.12);
}

/* 水印拖拽层：与预览图片同尺寸包裹，文字绝对定位并随图片缩放 */
.wm-stage {
  position: relative;
  display: inline-block;
  line-height: 0;
}

/* PC 宽屏：双栏落位走 style.css 的 .tool-page 默认规则，这里只调左右比例 */
@media (min-width: 768px) {
  .page-content.tool-page {
    --pane-left: 1.05fr;
  }
}

.wm-stage img {
  display: block;
}

.wm-text {
  position: absolute;
  left: 0;
  top: 0;
  white-space: nowrap;
  touch-action: none;
  cursor: move;
  user-select: none;
  -webkit-user-select: none;
  font-family: sans-serif;
  line-height: 1;
}

.batch-title {
  margin-top: 18px;
}

.batch-grid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 8px;
}

.batch-thumb {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 8px rgba(31, 41, 55, 0.08);
  background: #f1f3f9;
}

.batch-actions {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
</style>
