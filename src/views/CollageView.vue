<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, canvasToFile, downloadCanvas, type LoadedImage } from '../utils/imageLoader'
import { createCollage } from '../utils/imageCollage'
import { mergeImages, fitCanvasRatio, type MergeDirection, type CanvasFitMode } from '../utils/imageMerge'
import { showToast } from '../utils/toast'
import { fetchSampleFiles } from '../utils/sampleImage'
import ShareButton from '../components/ShareButton.vue'

const emit = defineEmits<{ back: [] }>()
const props = defineProps<{ mode?: 'grid' | 'merge' }>()

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
const previewCanvas = ref<HTMLCanvasElement | null>(null)
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

function onDragOver(_index: number, event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

/** 拖拽放置：把源图移动到目标位置 */
function onDrop(index: number) {
  const from = dragIndex.value
  dragIndex.value = null
  if (from == null || from === index) return
  moveImage(from, index)
}

/** 移除指定位置的图片并释放其 bitmap */
function removeImage(index: number) {
  const removed = images.value.splice(index, 1)[0]
  try {
    removed?.bitmap.close()
  } catch {
    /* bitmap 已关闭，忽略 */
  }
  refreshPreviewUrls()
  doRender()
}

/** 将指定位置的图片移动到目标位置（拖拽 / 上移下移共用） */
function moveImage(from: number, to: number) {
  const arr = images.value
  const target = Math.max(0, Math.min(to, arr.length - 1))
  if (from === target) return
  const moved = arr.splice(from, 1)[0]
  arr.splice(target, 0, moved)
  refreshPreviewUrls()
  doRender()
}

function moveImageByStep(index: number, delta: -1 | 1) {
  moveImage(index, index + delta)
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
        { direction: direction.value },
      )
      canvas = fitCanvasRatio(canvas, currentRatio.value, fitMode.value)
    }
    resultCanvas.value = canvas
  } catch (error) {
    showToast(error instanceof Error ? error.message : '拼图失败', 'error')
  }
}

// 结果画布更新时同步到预览画布（避免 toDataURL 的大内存开销）
// flush: 'post' 确保预览 canvas 已挂载（首次生成结果时 v-if 刚变为 true）
watch(
  resultCanvas,
  (canvas) => {
    const el = previewCanvas.value
    if (!el || !canvas) return
    el.width = canvas.width
    el.height = canvas.height
    el.getContext('2d')?.drawImage(canvas, 0, 0)
  },
  { flush: 'post' },
)

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

    <div class="page-content">
      <!-- 未选图状态 -->
      <div v-if="images.length === 0" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择多张图片拼成网格 / 长图</div>
        <div class="empty-actions">
          <button class="btn btn-primary" style="width: 180px" @click="pickImages">选择图片</button>
          <button class="btn btn-sample" @click="loadSample">体验示例</button>
        </div>
      </div>

      <template v-else>
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

        <!-- 已选图片列表 -->
        <div class="card">
          <div class="card-title">已选图片（{{ images.length }} 张）</div>
          <div class="img-item-list">
            <div
              v-for="(url, index) in previewUrls"
              :key="index"
              class="img-item-row"
              draggable="true"
              @dragstart="onDragStart(index, $event)"
              @dragover="onDragOver(index, $event)"
              @drop="onDrop(index)"
              @dragend="dragIndex = null"
            >
              <span class="drag-handle">⠿</span>
              <span class="img-item-index">{{ index + 1 }}</span>
              <img :src="url" :alt="`第${index + 1}张`" class="img-item-thumb" />
              <div class="img-item-actions">
                <button class="mini-btn" :disabled="index === 0" @click="moveImageByStep(index, -1)">↑</button>
                <button class="mini-btn" :disabled="index === images.length - 1" @click="moveImageByStep(index, 1)">↓</button>
                <button class="mini-btn danger" @click="removeImage(index)">✕</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 拼图预览 -->
        <div class="card">
          <div class="card-title">拼图预览</div>
          <div class="preview-wrap">
            <canvas v-if="resultCanvas" ref="previewCanvas" class="merge-preview"></canvas>
          </div>
          <p class="tip-text">预览为压缩显示，保存的原图按实际尺寸导出。</p>
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

/* 预览：宽高比自适应 + 限高，object-fit:contain 避免固定高度容器把内容纵向压扁 */
.merge-preview {
  display: block;
  width: 100%;
  height: auto;
  max-height: 62vh;
  object-fit: contain;
  border-radius: 8px;
  background: var(--bg-page);
}

.img-item-list {
  display: flex;
  flex-direction: column;
}

.img-item-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
}

.img-item-row + .img-item-row {
  border-top: 1px dashed var(--border);
}

.img-item-row[draggable='true']:active {
  cursor: grabbing;
}

.drag-handle {
  color: var(--text-sub);
  font-size: 15px;
  cursor: grab;
  flex-shrink: 0;
  user-select: none;
}

.img-item-index {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--gradient-soft);
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.img-item-thumb {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--bg-page);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 8px rgba(31, 41, 55, 0.08);
}

.img-item-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
}

.mini-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 9px;
  background: var(--bg-page);
  border: 1px solid var(--border);
  color: var(--text-sub);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
}

.mini-btn:active {
  transform: scale(0.92);
}

.mini-btn:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.mini-btn.danger {
  color: var(--danger);
}

/* PC 宽屏：设置区 + 图片列表左栏，拼图预览右栏；列表行 hover 抬升 */
@media (min-width: 768px) {
  .page-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 20px;
    align-items: start;
  }

  .page-content .card:nth-child(1) {
    grid-column: 1;
    grid-row: 1;
  }

  .page-content .card:nth-child(2) {
    grid-column: 1;
    grid-row: 2;
  }

  .page-content .card:nth-child(3) {
    grid-column: 2;
    grid-row: 1 / span 2;
  }

  .img-item-row {
    transition: background 0.2s, transform 0.2s;
  }

  .img-item-row + .img-item-row {
    margin-top: 4px;
  }

  .img-item-row:hover {
    background: rgba(244, 246, 252, 0.8);
    transform: translateY(-2px);
  }
}
</style>
