<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, type CSSProperties } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, bitmapToCanvas, canvasToFile, downloadCanvas, type LoadedImage } from '../utils/imageLoader'
import {
  replaceColorInRegion,
  hexToRgb,
  rgbToHex,
  getPixelRgb,
  type ReplaceRect,
} from '../utils/colorReplace'
import { showToast } from '../utils/toast'
import { fetchSampleFile } from '../utils/sampleImage'
import ShareButton from '../components/ShareButton.vue'

const emit = defineEmits<{ back: []; consumed: [] }>()
const props = defineProps<{ incomingFile?: File | null }>()

useImageDrop((files) => {
  if (files[0]) processFile(files[0])
})

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const stageRef = ref<HTMLDivElement | null>(null)

/** 原图全尺寸画布（取色与替换的基准，加载时一次性生成） */
let baseCanvas: HTMLCanvasElement | null = null
/** 当前结果画布（全尺寸） */
let resultCanvas: HTMLCanvasElement | null = null

/** 区域（比例坐标 0~1） */
const rect = ref<ReplaceRect>({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })

/** 源色 / 目标色（hex） */
const fromHex = ref('#1a1a1a')
const toHex = ref('#f0c8a8')
/** 容差 0~100 */
const tolerance = ref(25)
/** 当前取色模式：null / from / to */
const picker = ref<'from' | 'to' | null>(null)

const MAX_PREVIEW_DIM = 2048

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8 13.5h8M8 16.5h5"/><circle cx="12" cy="8.5" r="2.2"/></svg>`

/** 区域框样式（相对预览画布百分比定位） */
const rectStyle = computed<CSSProperties>(() => ({
  left: `${(rect.value.x * 100).toFixed(2)}%`,
  top: `${(rect.value.y * 100).toFixed(2)}%`,
  width: `${(rect.value.w * 100).toFixed(2)}%`,
  height: `${(rect.value.h * 100).toFixed(2)}%`,
}))

const stageCursor = computed(() => (picker.value ? 'crosshair' : 'default'))

/** 撤销 / 重做历史快照 */
interface Snapshot {
  rect: ReplaceRect
  fromHex: string
  toHex: string
  tolerance: number
}
const history = ref<Snapshot[]>([])
const historyIndex = ref(-1)
const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(() => historyIndex.value < history.value.length - 1)

function snapshot(): Snapshot {
  return { rect: { ...rect.value }, fromHex: fromHex.value, toHex: toHex.value, tolerance: tolerance.value }
}

function pushSnapshot() {
  const snap = snapshot()
  const last = history.value[historyIndex.value]
  if (last && JSON.stringify(last) === JSON.stringify(snap)) return
  history.value = history.value.slice(0, historyIndex.value + 1)
  history.value.push(snap)
  historyIndex.value = history.value.length - 1
}

function applySnapshot(snap: Snapshot) {
  rect.value = { ...snap.rect }
  fromHex.value = snap.fromHex
  toHex.value = snap.toHex
  tolerance.value = snap.tolerance
  rebuild()
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

/** 按当前参数生成结果画布 */
function buildResult(): HTMLCanvasElement | null {
  if (!baseCanvas) return null
  return replaceColorInRegion(baseCanvas, rect.value, {
    from: hexToRgb(fromHex.value),
    to: hexToRgb(toHex.value),
    tolerance: tolerance.value,
  })
}

function rebuild() {
  resultCanvas = buildResult()
  renderPreview()
}

/** 绘制预览（按预览上限等比缩放） */
function renderPreview() {
  const el = previewCanvas.value
  if (!el || !resultCanvas) return
  const scale = Math.min(1, MAX_PREVIEW_DIM / Math.max(resultCanvas.width, resultCanvas.height))
  el.width = Math.max(1, Math.round(resultCanvas.width * scale))
  el.height = Math.max(1, Math.round(resultCanvas.height * scale))
  el.getContext('2d')?.drawImage(resultCanvas, 0, 0, el.width, el.height)
}

function pickImage() {
  fileInput.value?.click()
}

async function processFile(file: File) {
  const loaded = await loadImageFromFile(file)
  source.value = loaded
  baseCanvas = bitmapToCanvas(loaded.bitmap)
  rect.value = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
  // 默认给一个贴近皮肤色/常见替换目标色，便于直接体验
  fromHex.value = '#1a1a1a'
  toHex.value = '#f0c8a8'
  tolerance.value = 25
  picker.value = null
  await nextTick()
  history.value = []
  historyIndex.value = -1
  rebuild()
  pushSnapshot()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    await processFile(file)
  } finally {
    input.value = ''
  }
}

async function loadSample() {
  try {
    const file = await fetchSampleFile('scene')
    await processFile(file)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '示例图加载失败', 'error')
  }
}

function startPick(mode: 'from' | 'to') {
  picker.value = picker.value === mode ? null : mode
  if (!picker.value) hideMag()
}

function onColorChange(mode: 'from' | 'to', event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (mode === 'from') fromHex.value = value
  else toHex.value = value
  rebuild()
  pushSnapshot()
}

function onToleranceInput(event: Event) {
  tolerance.value = Number((event.target as HTMLInputElement).value)
  rebuild()
}

function onToleranceCommit() {
  pushSnapshot()
}

/** 取色：点击预览图，读原图基准画布该点颜色 */
function pickColorAt(event: PointerEvent) {
  if (!picker.value || !baseCanvas || !stageRef.value) return
  const rectEl = stageRef.value.getBoundingClientRect()
  if (rectEl.width <= 0 || rectEl.height <= 0) return
  const rx = (event.clientX - rectEl.left) / rectEl.width
  const ry = (event.clientY - rectEl.top) / rectEl.height
  const px = Math.round(rx * baseCanvas.width)
  const py = Math.round(ry * baseCanvas.height)
  const [r, g, b] = getPixelRgb(baseCanvas, px, py)
  const hex = rgbToHex(r, g, b)
  if (picker.value === 'from') {
    fromHex.value = hex
    showToast(`源色已设为 ${hex}`, 'success')
  } else {
    toHex.value = hex
    showToast(`目标色已设为 ${hex}`, 'success')
  }
  picker.value = null
  hideMag()
  rebuild()
  pushSnapshot()
}

// ---- 取色放大镜：进入取色模式时，鼠标跟随一个放大预览，方便精准取色 ----
const MAG_SIZE = 160
const MAG_ZOOM = 8
const mag = reactive({ show: false, x: 0, y: 0, px: 0, py: 0, hex: '' })
const magCanvas = ref<HTMLCanvasElement | null>(null)

const magStyle = computed<CSSProperties>(() => ({
  left: `${mag.x}px`,
  top: `${mag.y}px`,
}))

let magFrame = 0
function scheduleMagRender() {
  if (magFrame) return
  magFrame = requestAnimationFrame(() => {
    magFrame = 0
    renderMag()
  })
}

function renderMag() {
  const cv = magCanvas.value
  if (!cv || !baseCanvas) return
  const ctx = cv.getContext('2d')
  if (!ctx) return
  const size = MAG_SIZE
  const view = Math.max(2, Math.floor(size / MAG_ZOOM))
  const half = view / 2
  const px = mag.px
  const py = mag.py
  const sx = Math.max(0, Math.min(px - half, baseCanvas.width - view))
  const sy = Math.max(0, Math.min(py - half, baseCanvas.height - view))
  ctx.clearRect(0, 0, size, size)
  ctx.save()
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.clip()
  // 关闭平滑，直观看清原始像素边缘
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(baseCanvas, sx, sy, view, view, 0, 0, size, size)
  ctx.restore()
  // 中心十字准心（黑+白双层，任意底色均可见）
  const c = size / 2
  const L = 14
  const cross = (color: string, width: number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(c - L, c)
    ctx.lineTo(c + L, c)
    ctx.moveTo(c, c - L)
    ctx.lineTo(c, c + L)
    ctx.stroke()
  }
  cross('rgba(0,0,0,0.65)', 3)
  cross('#fff', 1)
}

function updateMag(event: PointerEvent) {
  if (!picker.value || !baseCanvas || !stageRef.value) return
  const r = stageRef.value.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return
  const sx = event.clientX - r.left
  const sy = event.clientY - r.top
  mag.x = sx
  mag.y = sy
  mag.px = Math.round((sx / r.width) * baseCanvas.width)
  mag.py = Math.round((sy / r.height) * baseCanvas.height)
  const [r2, g2, b2] = getPixelRgb(baseCanvas, mag.px, mag.py)
  mag.hex = rgbToHex(r2, g2, b2)
  mag.show = true
  scheduleMagRender()
}

function hideMag() {
  mag.show = false
}

// ---- 框选手势（移动 + 四角缩放），复用图片编辑页的交互 ----
const MIN_CROP = 0.03
let dragState:
  | {
      mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'
      startRect: ReplaceRect
      startX: number
      startY: number
    }
  | null = null

function onStagePointerDown(event: PointerEvent) {
  if (!source.value) return
  // 取色模式优先：点击即取色，不进入框选
  if (picker.value) {
    updateMag(event)
    pickColorAt(event)
    return
  }
  const target = event.target as HTMLElement
  const handle = (target.closest('.crop-handle')?.getAttribute('data-handle') as 'nw' | 'ne' | 'sw' | 'se' | null) ?? null
  const mode = handle ?? (target.closest('.crop-box') ? 'move' : null)
  if (!mode) return
  event.preventDefault()
  dragState = {
    mode,
    startRect: { ...rect.value },
    startX: event.clientX,
    startY: event.clientY,
  }
  stageRef.value?.setPointerCapture(event.pointerId)
}

function onStagePointerMove(event: PointerEvent) {
  if (picker.value) {
    updateMag(event)
    return
  }
  if (!dragState || !source.value) return
  const stage = stageRef.value
  if (!stage) return
  const r = stage.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return
  const dx = (event.clientX - dragState.startX) / r.width
  const dy = (event.clientY - dragState.startY) / r.height
  const { mode, startRect } = dragState

  if (mode === 'move') {
    rect.value = {
      ...startRect,
      x: Math.min(1 - startRect.w, Math.max(0, startRect.x + dx)),
      y: Math.min(1 - startRect.h, Math.max(0, startRect.y + dy)),
    }
    rebuild()
    return
  }
  // 四角自由缩放
  const c = { ...startRect }
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
  if (mode === 'se') {
    c.w = clamp(startRect.w + dx, MIN_CROP, 1 - startRect.x)
    c.h = clamp(startRect.h + dy, MIN_CROP, 1 - startRect.y)
  } else if (mode === 'nw') {
    c.w = clamp(startRect.w - dx, MIN_CROP, startRect.x + startRect.w)
    c.h = clamp(startRect.h - dy, MIN_CROP, startRect.y + startRect.h)
    c.x = startRect.x + startRect.w - c.w
    c.y = startRect.y + startRect.h - c.h
  } else if (mode === 'ne') {
    c.w = clamp(startRect.w + dx, MIN_CROP, 1 - startRect.x)
    c.h = clamp(startRect.h - dy, MIN_CROP, startRect.y + startRect.h)
    c.y = startRect.y + startRect.h - c.h
  } else {
    c.w = clamp(startRect.w - dx, MIN_CROP, startRect.x + startRect.w)
    c.h = clamp(startRect.h + dy, MIN_CROP, 1 - startRect.y)
    c.x = startRect.x + startRect.w - c.w
  }
  rect.value = c
  rebuild()
}

function onStagePointerUp() {
  if (!dragState) return
  dragState = null
  pushSnapshot()
}

async function resultFiles(): Promise<File[]> {
  // resultCanvas 是普通变量，尚未生成结果画布时返回空列表而不是抛错
  if (!source.value || !resultCanvas) return []
  return [await canvasToFile(resultCanvas, `${source.value.name}_改色.png`)]
}

function saveResult() {
  if (!source.value || !resultCanvas) return
  downloadCanvas(resultCanvas, `${source.value.name}_改色.png`)
  showToast('已开始下载', 'success')
}

onMounted(() => {
  if (props.incomingFile) {
    processFile(props.incomingFile).catch((error) => {
      showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
    })
    emit('consumed')
  }
})

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
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">局部改色</div>
    </div>

    <div class="page-content">
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>框选一块区域，把区域里的颜色替换成你取到的颜色</div>
        <div class="empty-actions">
          <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择图片</button>
          <button class="btn btn-sample" @click="loadSample">体验示例</button>
        </div>
      </div>

      <template v-else>
        <div class="card">
          <div class="card-title">编辑预览</div>
          <div class="preview-wrap">
            <div
              ref="stageRef"
              class="edit-stage"
              :style="{ cursor: stageCursor }"
              @pointerdown="onStagePointerDown"
              @pointermove="onStagePointerMove"
              @pointerup="onStagePointerUp"
              @pointercancel="onStagePointerUp"
              @pointerleave="hideMag"
            >
              <canvas ref="previewCanvas" class="edit-canvas"></canvas>
              <div class="crop-box" :style="rectStyle">
                <div class="crop-handle nw" data-handle="nw"></div>
                <div class="crop-handle ne" data-handle="ne"></div>
                <div class="crop-handle sw" data-handle="sw"></div>
                <div class="crop-handle se" data-handle="se"></div>
              </div>
              <div v-if="mag.show" class="mag-loupe" :style="magStyle">
                <canvas ref="magCanvas" class="mag-canvas" width="160" height="160"></canvas>
                <div class="mag-color">
                  <span class="mag-swatch" :style="{ background: mag.hex }"></span>
                  <span class="mag-hex">{{ mag.hex }}</span>
                </div>
              </div>
            </div>
            <p class="tip-text">
              {{ picker
                ? '在图中点击要取色的位置'
                : '拖动框选区域移动位置，拖四角调整大小；框内接近「源色」的颜色会被替换成「目标色」' }}
            </p>
          </div>
        </div>

        <div class="card">
          <div class="card-title">改色参数</div>
          <div class="form-row">
            <span class="label">历史</span>
            <div class="row-ctrl">
              <button class="btn btn-outline btn-sm" :disabled="!canUndo" @click="undo">撤销</button>
              <button class="btn btn-outline btn-sm" :disabled="!canRedo" @click="redo">重做</button>
            </div>
          </div>
          <div class="form-row">
            <span class="label">替换的颜色</span>
            <div class="row-ctrl">
              <label class="swatch" :style="{ background: fromHex }" title="点击选择颜色">
                <input type="color" class="color-input-hidden" :value="fromHex" @input="onColorChange('from', $event)" />
              </label>
              <span class="color-hex">{{ fromHex }}</span>
              <button class="btn btn-outline btn-sm" @click="startPick('from')">
                {{ picker === 'from' ? '取消取色' : '取色器' }}
              </button>
            </div>
          </div>
          <div class="form-row">
            <span class="label">替换为</span>
            <div class="row-ctrl">
              <label class="swatch" :style="{ background: toHex }" title="点击选择颜色">
                <input type="color" class="color-input-hidden" :value="toHex" @input="onColorChange('to', $event)" />
              </label>
              <span class="color-hex">{{ toHex }}</span>
              <button class="btn btn-outline btn-sm" @click="startPick('to')">
                {{ picker === 'to' ? '取消取色' : '取色器' }}
              </button>
            </div>
          </div>
          <div class="form-row">
            <span class="label">容差</span>
            <div class="row-ctrl">
              <input
                class="slider"
                type="range"
                min="1"
                max="60"
                step="1"
                :value="tolerance"
                @input="onToleranceInput"
                @change="onToleranceCommit"
              />
              <span class="range-value">{{ tolerance }}</span>
            </div>
          </div>
          <p class="tip-text">
            容差越大覆盖的颜色范围越宽。用取色器在图片上点两下：先点要替换的「源色」，再点想要的「目标色」。
          </p>
        </div>
      </template>
    </div>

    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <ShareButton :get-files="resultFiles" variant="outline" />
      <button class="btn btn-primary" @click="saveResult">保存图片</button>
    </div>

    <input ref="fileInput" type="file" accept="image/*,.heic,.heif" style="display: none" @change="handleFileChange" />
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

.crop-box {
  position: absolute;
  border: 1.5px solid #fff;
  outline: 1px dashed rgba(14, 165, 233, 0.9);
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

.crop-handle.nw { left: -8px; top: -8px; cursor: nwse-resize; }
.crop-handle.ne { right: -8px; top: -8px; cursor: nesw-resize; }
.crop-handle.sw { left: -8px; bottom: -8px; cursor: nesw-resize; }
.crop-handle.se { right: -8px; bottom: -8px; cursor: nwse-resize; }

.btn-sm {
  padding: 6px 12px;
  font-size: 13px;
}

.form-row .swatch {
  position: relative;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
}

.form-row .swatch .color-input-hidden {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  opacity: 0;
  cursor: pointer;
}

.color-hex {
  min-width: 68px;
  font-size: 12px;
  color: var(--text-sub);
  font-variant-numeric: tabular-nums;
}

.slider {
  flex: 1;
  min-width: 120px;
  accent-color: #0ea5e9;
}

.range-value {
  min-width: 44px;
  font-size: 12px;
  color: var(--text-sub);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* form-row 内控件组：紧贴 label 靠左紧凑排列，避免被 space-between 撑出大片空白 */
.form-row .row-ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  justify-content: flex-start;
  min-width: 0;
}

.form-row .row-ctrl .slider {
  flex: 1;
  min-width: 80px;
}

.form-row .btn-sm {
  flex-shrink: 0;
  width: auto;
  padding: 6px 14px;
}

/* 取色放大镜：圆形放大预览，跟随鼠标，中心十字 + 颜色值 */
.mag-loupe {
  position: absolute;
  width: 160px;
  height: 160px;
  pointer-events: none;
  transform: translate(-50%, -112%);
  z-index: 5;
}

.mag-canvas {
  display: block;
  width: 160px;
  height: 160px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3);
  background: #fff;
}

.mag-color {
  position: absolute;
  left: 50%;
  bottom: -30px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  font-size: 12px;
  color: #333;
  white-space: nowrap;
}

.mag-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
}

/* PC 宽屏：预览与参数并排双栏 */
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

  .edit-stage {
    max-width: 100%;
  }
}
</style>
