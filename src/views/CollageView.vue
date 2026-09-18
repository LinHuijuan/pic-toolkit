<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, canvasToFile, downloadCanvas, type LoadedImage } from '../utils/imageLoader'
import { createCollage } from '../utils/imageCollage'
import { mergeImages, fitCanvasRatio, type MergeDirection, type CanvasFitMode } from '../utils/imageMerge'
import { applyRotFlip } from '../utils/rotflip'
import { showToast } from '../utils/toast'
import { fetchSampleFiles } from '../utils/sampleImage'
import ShareButton from '../components/ShareButton.vue'
import NextTools from '../components/NextTools.vue'

const emit = defineEmits<{
  back: []
  navigate: [view: 'compress' | 'format', file: File]
}>()
const props = defineProps<{ mode?: 'grid' | 'merge' }>()

const NEXT_CHAIN: { key: 'compress' | 'format'; label: string }[] = [
  { key: 'compress', label: '压体积' },
  { key: 'format', label: '转格式' },
]

/** 当前拼图模式：网格 / 长图 */
const mode = ref<'grid' | 'merge'>(props.mode ?? 'grid')

// 全站拖拽上传：把图片拖到页面任意位置导入当前工具
useImageDrop(async (files) => {
  try {
    for (const file of files) {
      images.value.push(await loadImageFromFile(file))
    }
    refreshPreviewUrls()
    doRender()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
  }
})

const fileInput = ref<HTMLInputElement | null>(null)
const images = ref<LoadedImage[]>([])
const resultCanvas = ref<HTMLCanvasElement | null>(null)
const previewUrls = ref<string[]>([])

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><rect x="3.5" y="3.5" width="17" height="7.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="7" rx="2"/><path d="M7 8.5h4"/></svg>`

// ---------- 网格模式参数 ----------
const gridKey = ref('3x3')
const gap = ref(4)
const bgKey = ref('transparent')

const GRIDS = [
  { key: '2x2', label: '2×2', rows: 2, cols: 2 },
  { key: '2x3', label: '2×3', rows: 2, cols: 3 },
  { key: '3x3', label: '3×3', rows: 3, cols: 3 },
] as const

const BGS = [
  { key: 'transparent', label: '透明', value: null as string | null },
  { key: 'white', label: '白色', value: '#ffffff' },
  { key: 'black', label: '黑色', value: '#1f2937' },
  { key: 'gray', label: '浅灰', value: '#e5e7eb' },
]

const currentGrid = computed(() => GRIDS.find((g) => g.key === gridKey.value) ?? GRIDS[2])
const currentBg = computed(() => BGS.find((b) => b.key === bgKey.value)?.value ?? null)

// ---------- 交互式预览：把拼图结果铺成可拖拽换位的图片网格 ----------
/** 网格模式下需要渲染的格子数量（行列之积；不足的格子留空作占位/终点） */
const previewCellCount = computed(() => {
  if (mode.value !== 'grid') return 0
  return currentGrid.value.rows * currentGrid.value.cols
})

/** 网格预览样式：按当前布局排布，等比方形格 + 当前间距/背景（贴近导出效果） */
const gridStyle = computed<Record<string, string>>(() => ({
  gridTemplateColumns: `repeat(${currentGrid.value.cols}, 1fr)`,
  gridAutoRows: '1fr',
  aspectRatio: `${currentGrid.value.cols} / ${currentGrid.value.rows}`,
  gap: `${gap.value}px`,
  background: currentBg.value ?? 'transparent',
}))

/** 当前高亮的放下目标格 */
const dragOverIndex = ref<number | null>(null)

function onPreviewDragOver(index: number, event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverIndex.value = index
}

function onPreviewDrop(index: number) {
  const from = dragIndex.value
  dragIndex.value = null
  dragOverIndex.value = null
  if (from == null || from === index) return
  moveImage(from, index)
}

// ---------- 点选格子：旋转 / 翻转 / 删除 直接作用于选中格 ----------
const selected = ref<number | null>(null)

const selectedLabel = computed(() => (selected.value != null && selected.value < images.value.length ? `第 ${selected.value + 1} 张` : ''))

function toggleSelect(index: number) {
  if (index >= images.value.length) return
  selected.value = selected.value === index ? null : index
}

function cellAction(action: 'r90' | 'flipH' | 'flipV' | 'delete') {
  const i = selected.value
  if (i == null || i >= images.value.length) return
  if (action === 'delete') {
    removeImage(i)
  } else {
    rotateImage(i, action)
  }
}

// ---------- 长图模式参数 ----------
const direction = ref<MergeDirection>('vertical')
const ratioKey = ref('free')
const fitMode = ref<CanvasFitMode>('crop')

const RATIOS = [
  { key: 'free', label: '原始', value: null as number | null },
  { key: '1:1', label: '1:1', value: 1 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '3:4', label: '3:4', value: 3 / 4 },
  { key: '9:16', label: '9:16', value: 9 / 16 },
]

const currentRatio = computed(() => RATIOS.find((r) => r.key === ratioKey.value)?.value ?? null)

function pickImages() {
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length === 0) return
  try {
    for (const file of files) {
      images.value.push(await loadImageFromFile(file))
    }
    refreshPreviewUrls()
    doRender()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
  } finally {
    input.value = ''
  }
}

/** 一键载入内置示例图体验完整流程 */
async function loadSample() {
  try {
    const files = await fetchSampleFiles('scene', 6)
    for (const file of files) {
      images.value.push(await loadImageFromFile(file))
    }
    refreshPreviewUrls()
    doRender()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '示例图加载失败', 'error')
  }
}

/** 拖拽排序状态：源索引 */
const dragIndex = ref<number | null>(null)

function onDragStart(index: number, event: DragEvent) {
  dragIndex.value = index
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

/** 移除指定位置的图片并释放其 bitmap */
function removeImage(index: number) {
  const removed = images.value.splice(index, 1)[0]
  if (selected.value === index) selected.value = null
  try {
    removed?.bitmap.close()
  } catch {
    /* bitmap 已关闭，忽略 */
  }
  refreshPreviewUrls()
  doRender()
}

/** 将指定位置的图片移动到目标位置（拖拽换位共用） */
function moveImage(from: number, to: number) {
  const arr = images.value
  const target = Math.max(0, Math.min(to, arr.length - 1))
  if (from === target) return
  recordOrder()
  const moved = arr.splice(from, 1)[0]
  arr.splice(target, 0, moved)
  refreshPreviewUrls()
  doRender()
}

// ---------- 排序撤销 / 重做 ----------
// 只在排序前记录当前顺序快照（数组里存的是对象引用，零拷贝）。删除不入栈：
// removeImage 会 close 掉那张图的 bitmap，不可逆，硬要还原只会出一张失效图。
const orderHistory: LoadedImage[][] = []
const redoHistory: LoadedImage[][] = []

function recordOrder() {
  orderHistory.push(images.value.slice())
  redoHistory.length = 0
  if (orderHistory.length > 50) orderHistory.shift()
}

function undoOrder() {
  const prev = orderHistory.pop()
  if (!prev) return
  redoHistory.push(images.value.slice())
  images.value = prev
  refreshPreviewUrls()
  doRender()
}

function redoOrder() {
  const next = redoHistory.pop()
  if (!next) return
  orderHistory.push(images.value.slice())
  images.value = next
  refreshPreviewUrls()
  doRender()
}

/** 重新生成本地预览 URL（图片增删排序后调用一次，避免 computed 全量重复 toDataURL） */
function refreshPreviewUrls() {
  previewUrls.value = images.value.map((img) => {
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    canvas.getContext('2d')?.drawImage(img.bitmap, 0, 0)
    return canvas.toDataURL('image/png')
  })
}

/** 把指定图片旋转 / 翻转后重渲染，避免横向竖图混排在拼图里看着别扭 */
async function rotateImage(index: number, action: 'r90' | 'flipH' | 'flipV') {
  const img = images.value[index]
  if (!img) return
  try {
    await applyRotFlip(img, action)
    refreshPreviewUrls()
    doRender()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '图片变换失败', 'error')
  }
}

/** 根据当前模式与参数渲染拼图结果 */
function doRender() {
  if (images.value.length === 0) {
    resultCanvas.value = null
    return
  }
  try {
    let canvas: HTMLCanvasElement
    if (mode.value === 'grid') {
      canvas = createCollage(
        images.value.map((img) => img.bitmap),
        { rows: currentGrid.value.rows, cols: currentGrid.value.cols, gap: gap.value, bgColor: currentBg.value },
      )
    } else {
      canvas = mergeImages(
        images.value.map((img) => img.bitmap),
        { direction: direction.value, gap: gap.value, bg: currentBg.value },
      )
      canvas = fitCanvasRatio(canvas, currentRatio.value, fitMode.value)
    }
    resultCanvas.value = canvas
  } catch (error) {
    showToast(error instanceof Error ? error.message : '拼图失败', 'error')
  }
}

// 结果画布异步同步预览已移除：预览改为交互式图片网格（可拖拽换位），resultCanvas 仅用于导出

function switchMode(m: 'grid' | 'merge') {
  if (mode.value === m) return
  mode.value = m
  doRender()
}

async function resultFiles(): Promise<File[]> {
  if (!resultCanvas.value || images.value.length === 0) return []
  const base = images.value.length === 1 ? images.value[0].name : mode.value === 'grid' ? '网格拼图' : '长图拼接'
  return [await canvasToFile(resultCanvas.value, `${base}.png`)]
}

function saveResult() {
  if (!resultCanvas.value || images.value.length === 0) return
  const base = images.value.length === 1 ? images.value[0].name : mode.value === 'grid' ? '网格拼图' : '长图拼接'
  downloadCanvas(resultCanvas.value, `${base}.png`)
  showToast('已开始下载', 'success')
}

async function onPickNext(key: string) {
  if (key !== 'compress' && key !== 'format') return
  const files = await resultFiles()
  const first = files[0]
  if (!first) {
    showToast('还没有可发送的拼图结果', 'error')
    return
  }
  emit('navigate', key, first)
}

// 组件卸载时释放全部图片 bitmap
onUnmounted(() => {
  images.value.forEach((img) => {
    try {
      img.bitmap.close()
    } catch {
      /* bitmap 已关闭，忽略 */
    }
  })
})
</script>

<template>
  <div class="app-shell">
    <!-- 顶部导航 -->
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">拼图</div>
    </div>

    <div class="page-content tool-page">
      <!-- 未选图状态 -->
      <div v-if="images.length === 0" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择多张图片拼成网格 / 长图</div>
        <p class="empty-hint">适合一次想发多张，拼成网格或长图再分享</p>
        <div class="empty-actions">
          <button class="btn btn-primary" style="width: 180px" @click="pickImages">选择图片</button>
          <button class="btn btn-sample" @click="loadSample">体验示例</button>
        </div>
      </div>

      <template v-else>
        <!-- 拼图预览：交互式网格，直接拖动换位 -->
        <div class="card">
          <div class="card-title">
            拼图预览（拖动换位）
            <span class="order-actions">
              <button class="mini-btn" title="撤销排序" aria-label="撤销排序" :disabled="orderHistory.length === 0" @click="undoOrder">↶</button>
              <button class="mini-btn" title="重做" aria-label="重做" :disabled="redoHistory.length === 0" @click="redoOrder">↷</button>
            </span>
          </div>

          <template v-if="mode === 'grid' && previewCellCount > 0">
            <div
              class="preview-grid"
              :style="gridStyle"
              @dragend="dragIndex = null; dragOverIndex = null"
            >
              <div
                v-for="k in previewCellCount"
                :key="k"
                class="preview-cell"
                :class="{ 'has-img': (k - 1) < previewUrls.length, 'drop-hint': dragOverIndex === (k - 1), 'selected': selected === (k - 1) }"
                :draggable="(k - 1) < previewUrls.length"
                @dragstart="onDragStart(k - 1, $event)"
                @dragover="onPreviewDragOver(k - 1, $event)"
                @dragleave="dragOverIndex = null"
                @drop="onPreviewDrop(k - 1)"
                @click="toggleSelect(k - 1)"
              >
                <img v-if="(k - 1) < previewUrls.length" :src="previewUrls[k - 1]" :alt="`第${k}张`" draggable="false" />
                <span class="cell-no">{{ k }}</span>
              </div>
            </div>
          </template>

          <template v-else-if="mode === 'merge'">
            <div
              class="preview-strip"
              :class="direction"
              @dragend="dragIndex = null; dragOverIndex = null"
            >
              <div
                v-for="(url, index) in previewUrls"
                :key="index"
                class="preview-cell strip-cell"
                :class="{ 'drop-hint': dragOverIndex === index, 'selected': selected === index }"
                draggable="true"
                @dragstart="onDragStart(index, $event)"
                @dragover="onPreviewDragOver(index, $event)"
                @dragleave="dragOverIndex = null"
                @drop="onPreviewDrop(index)"
                @click="toggleSelect(index)"
              >
                <img :src="url" :alt="`第${index + 1}张`" draggable="false" />
                <span class="cell-no">{{ index + 1 }}</span>
              </div>
            </div>
          </template>

          <!-- 预览区操作条：点选某一格后，旋转 / 翻转 / 删除 直接作用于该格 -->
          <div v-if="selected !== null && selected < previewUrls.length" class="cell-actions-bar">
            <span class="action-label">{{ selectedLabel }}</span>
            <button class="action-btn" title="旋转 90°" aria-label="旋转 90°" @click="cellAction('r90')">↻</button>
            <button class="action-btn" title="水平翻转" aria-label="水平翻转" @click="cellAction('flipH')">⇋</button>
            <button class="action-btn" title="垂直翻转" aria-label="垂直翻转" @click="cellAction('flipV')">⇅</button>
            <button class="action-btn danger" title="删除" aria-label="删除" @click="cellAction('delete')">✕</button>
          </div>

          <p class="tip-text">点选一张图片可旋转 / 翻转 / 删除，拖动图片直接换位。云端不参与，导出按原图实际尺寸保存。</p>
        </div>

        <!-- 拼图设置 -->
        <div class="card">
          <div class="card-title">拼图设置</div>
          <div class="form-row">
            <span class="label">拼图模式</span>
            <div class="seg-control" style="flex: 1">
              <div class="seg-item" :class="{ active: mode === 'grid' }" @click="switchMode('grid')">网格</div>
              <div class="seg-item" :class="{ active: mode === 'merge' }" @click="switchMode('merge')">长图</div>
            </div>
          </div>

          <template v-if="mode === 'grid'">
            <div class="form-row">
              <span class="label">网格布局</span>
              <div class="seg-control" style="flex: 1">
                <div
                  v-for="g in GRIDS"
                  :key="g.key"
                  class="seg-item"
                  :class="{ active: gridKey === g.key }"
                  @click="gridKey = g.key; doRender()"
                >
                  {{ g.label }}
                </div>
              </div>
            </div>
            <div class="form-row">
              <span class="label">格子间距</span>
              <input v-model.number="gap" type="range" min="0" max="40" step="1" style="flex: 1" @input="doRender" />
            </div>
            <div class="form-row">
              <span class="label">背景色</span>
              <div class="seg-control" style="flex: 1">
                <div
                  v-for="b in BGS"
                  :key="b.key"
                  class="seg-item"
                  :class="{ active: bgKey === b.key }"
                  @click="bgKey = b.key; doRender()"
                >
                  {{ b.label }}
                </div>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="form-row">
              <span class="label">排列方向</span>
              <div class="seg-control" style="flex: 1">
                <div class="seg-item" :class="{ active: direction === 'vertical' }" @click="direction = 'vertical'; doRender()">竖排</div>
                <div class="seg-item" :class="{ active: direction === 'horizontal' }" @click="direction = 'horizontal'; doRender()">横排</div>
              </div>
            </div>
            <div class="form-row">
              <span class="label">间距</span>
              <input v-model.number="gap" type="range" min="0" max="40" step="1" style="flex: 1" @input="doRender" />
              <span class="range-value">{{ gap }}px</span>
            </div>
            <div class="form-row">
              <span class="label">背景色</span>
              <div class="seg-control" style="flex: 1">
                <div
                  v-for="b in BGS"
                  :key="b.key"
                  class="seg-item"
                  :class="{ active: bgKey === b.key }"
                  @click="bgKey = b.key; doRender()"
                >
                  {{ b.label }}
                </div>
              </div>
            </div>
            <div class="form-row">
              <span class="label">画布比例</span>
              <div class="seg-control" style="flex: 1">
                <div
                  v-for="r in RATIOS"
                  :key="r.key"
                  class="seg-item"
                  :class="{ active: ratioKey === r.key }"
                  @click="ratioKey = r.key; doRender()"
                >
                  {{ r.label }}
                </div>
              </div>
            </div>
            <div v-if="ratioKey !== 'free'" class="form-row">
              <span class="label">超出处理</span>
              <div class="seg-control" style="flex: 1">
                <div class="seg-item" :class="{ active: fitMode === 'crop' }" @click="fitMode = 'crop'; doRender()">裁切</div>
                <div class="seg-item" :class="{ active: fitMode === 'contain' }" @click="fitMode = 'contain'; doRender()">留白</div>
              </div>
            </div>
          </template>
        </div>

        <!-- 跨工具接力入口 -->
        <div v-if="resultCanvas" class="next-row">
          <NextTools :options="NEXT_CHAIN" @pick="onPickNext" />
        </div>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="images.length > 0" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImages">继续加图</button>
      <ShareButton :get-files="resultFiles" variant="outline" />
      <button class="btn btn-primary" @click="saveResult">保存图片</button>
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
          <stop offset="0%" stop-color="#818cf8" />
          <stop offset="100%" stop-color="#6366f1" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.app-shell {
  isolation: isolate;
  --primary: #818cf8;
  --gradient: linear-gradient(135deg, #818cf8, #6366f1);
  --gradient-soft: linear-gradient(135deg, color-mix(in srgb, #818cf8 12%, transparent), color-mix(in srgb, #6366f1 14%, transparent));
  --primary-light: color-mix(in srgb, #818cf8 8%, #fff);
}

/* 背景氛围光斑：柔和多色 radial 光晕（全站统一） */
.app-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(520px circle at 12% 6%, rgba(129, 140, 248, 0.2), transparent 55%),
    radial-gradient(480px circle at 88% 10%, rgba(250, 204, 21, 0.16), transparent 55%),
    radial-gradient(640px circle at 42% 88%, rgba(168, 85, 247, 0.18), transparent 60%),
    radial-gradient(430px circle at 96% 62%, rgba(16, 185, 129, 0.14), transparent 55%),
    radial-gradient(360px circle at 70% 30%, rgba(244, 114, 182, 0.1), transparent 55%);
}

/* 交互式拼图预览：网格布局，格子为可拖拽换位的方形图块 */
.preview-grid {
  display: grid;
  width: 100%;
  max-height: 62vh;
  border-radius: 8px;
  border: 1px solid rgba(31, 41, 55, 0.04);
  overflow: hidden;
}

.preview-cell {
  position: relative;
  aspect-ratio: 1 / 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-page);
}

.preview-cell > img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

.preview-cell.has-img {
  cursor: grab;
}

.preview-cell.selected {
  outline: 2.5px solid var(--primary);
  outline-offset: -2px;
  z-index: 1;
}

.preview-cell.drop-hint {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.5);
}

.preview-cell .cell-no {
  position: absolute;
  left: 6px;
  top: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(17, 24, 39, 0.5);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* 长图模式：竖排满宽 / 横排滚动条 */
.preview-strip {
  display: flex;
  gap: 8px;
}

.preview-strip.vertical {
  flex-direction: column;
}

.preview-strip.horizontal {
  flex-direction: row;
  overflow-x: auto;
  padding-bottom: 6px;
}

.preview-strip .preview-cell {
  aspect-ratio: auto;
  border-radius: 8px;
  border: 1px solid rgba(31, 41, 55, 0.04);
}

.preview-strip.vertical .strip-cell > img {
  object-fit: contain;
  max-height: 52vh;
}

.preview-strip.horizontal .strip-cell {
  min-width: 150px;
  max-width: 150px;
}

.preview-strip.horizontal .strip-cell > img {
  object-fit: cover;
}

.range-value {
  min-width: 40px;
  font-size: 12px;
  color: var(--text-sub);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 预览区操作条：点选格子后出现，旋转 / 翻转 / 删除直接作用于该格 */
.cell-actions-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 12px;
  background: var(--gradient-soft);
}

.action-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  margin-right: auto;
  flex-shrink: 0;
}

.action-btn {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 10px;
  background: #fff;
  border: 1px solid var(--border);
  color: var(--text-sub);
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
  flex-shrink: 0;
}

.action-btn:active {
  transform: scale(0.92);
}

.action-btn.danger {
  color: var(--danger);
}

/* 卡片标题行放排序撤销/重做：主标题左、按钮右，窄屏不换行 */
.card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.order-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* PC 宽屏：双栏——设置独占左栏，拼图预览占据右栏 */
@media (min-width: 768px) {
  .page-content.tool-page {
    --pane-left: 1fr;
    --pane-right: 1.2fr;
  }

  .page-content .card:nth-child(1) {
    grid-column: 1;
    grid-row: 1;
  }

  .page-content .card:nth-child(2) {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
