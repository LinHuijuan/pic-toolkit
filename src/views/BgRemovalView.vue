<script setup lang="ts">
import { ref, reactive, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { prepareAiModel } from '../utils/aiModel'
import {
  loadImageFromFile,
  fileToDataUrl,
  canvasToBlob,
  canvasToFile,
  downloadBlob,
  type LoadedImage,
} from '../utils/imageLoader'
import { useAiJob } from '../utils/aiJob'
import {
  removeImageBackground,
  composeBackground,
  composeBackgroundImage,
  loadCutoutCanvas,
} from '../utils/removeBg'
import {
  styleCutout,
  eraseStroke,
  isStyled,
  isRelevant,
  DEFAULT_CUTOUT_STYLE,
  type CutoutStyle,
} from '../utils/cutoutStyle'
import { showToast } from '../utils/toast'
import { fetchSampleFile } from '../utils/sampleImage'
import CompareSlider from '../components/CompareSlider.vue'
import ShareButton from '../components/ShareButton.vue'

const emit = defineEmits<{ back: []; consumed: [] }>()

const props = defineProps<{ incomingFile?: File | null }>()

// 全站拖拽上传：把图片拖到页面任意位置导入当前工具
useImageDrop((files) => {
  if (files[0]) processFile(files[0])
})

/** 一次抠图任务的产物：AI 原始抠图 + 用户在其上落下的擦除笔迹 */
interface CutoutResult {
  blob: Blob
  strokes: EraseStroke[]
}

/** 一笔擦除：坐标以工作面（AI 抠图原始尺寸）为准，重放与撤销都按这份记录 */
interface EraseStroke {
  points: { x: number; y: number }[]
  radius: number
}

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const sourceFileRef = ref<File | null>(null)
const processing = ref(false)
const job = useAiJob<CutoutResult>('cutout')
const progress = computed(() => ({ percent: job.percent, stage: job.stage }))
const resultUrl = ref('')
const resultBlob = ref<Blob | null>(null)
const bgColor = ref<string | null>(null)
/** 自定义背景图（与纯色互斥，启用时优先） */
const bgImageUrl = ref('')
let bgImageEl: HTMLImageElement | null = null
const bgFileInput = ref<HTMLInputElement | null>(null)
const resultReady = ref(false)

/** 擦除/描边的工作面：抠图结果的一份拷贝，重置时从 resultBlob 再解码 */
const workCanvas = ref<HTMLCanvasElement | null>(null)
/** 预览长边上限：合成仍在原尺寸做，只是编码前先缩小，滑块才不会掉帧 */
const PREVIEW_EDGE = 1400
/** 擦除镜面长边上限：笔迹以工作面为准，镜面上只需要看清落点 */
const ERASE_EDGE = 1600
const style = reactive<CutoutStyle>({ ...DEFAULT_CUTOUT_STYLE })
const eraseMode = ref(false)
const brushSize = ref(48)
const eraseStrokes = ref<EraseStroke[]>([])
const eraseCanvas = ref<HTMLCanvasElement | null>(null)
const eraseRatio = ref(1)

/** 笔迹同时挂在任务结果上，切走再回来才能按原样重建工作面 */
function setStrokes(next: EraseStroke[]) {
  eraseStrokes.value = next
  if (job.result) job.result.strokes = next
}

const OUTLINE_COLORS = ['#ffffff', '#0f172a', '#f472b6', '#34d399', '#facc15']

type PresetKey = 'none' | 'sticker' | 'poster'

const PRESETS: Record<PresetKey, Pick<CutoutStyle, 'outlineWidth' | 'shadowBlur'>> = {
  none: { outlineWidth: 0, shadowBlur: 0 },
  sticker: { outlineWidth: 14, shadowBlur: 0 },
  poster: { outlineWidth: 10, shadowBlur: 28 },
}

const PRESET_LIST: { key: PresetKey; label: string }[] = [
  { key: 'none', label: '原样' },
  { key: 'sticker', label: '贴纸描边' },
  { key: 'poster', label: '描边 + 投影' },
]

const BG_COLORS = [
  { label: '透明', value: null as string | null },
  { label: '白色', value: '#ffffff' },
  { label: '红色', value: '#ef4444' },
  { label: '蓝色', value: '#3b82f6' },
  { label: '绿色', value: '#22c55e' },
]

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><circle cx="6.5" cy="6.5" r="2.8"/><circle cx="6.5" cy="17.5" r="2.8"/><path d="M8.8 8.2 20.5 20M8.8 15.8 20.5 4"/></svg>`

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

/** 加载图片并开始抠图 */
async function processFile(file: File) {
  sourceFileRef.value = file
  source.value = await loadImageFromFile(file)
  refreshSourceUrl()
  resultReady.value = false
  resultUrl.value = ''
  resultBlob.value = null
  workCanvas.value = null
  eraseMode.value = false
  eraseStrokes.value = []
  await startRemove()
}

/** 一键载入内置示例图体验完整流程 */
async function loadSample() {
  try {
    const file = await fetchSampleFile('person')
    await processFile(file)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '示例图加载失败', 'error')
  }
}

// 接收其他工具流转过来的图片（如图片编辑 → 抠图）；
// 没有新图时先看共享任务：切去别的工具再回来，进度和结果都还在
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  if (props.incomingFile) {
    processFile(props.incomingFile).catch((error) => {
      showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
    })
    emit('consumed')
    return
  }
  const file = job.input
  if (file && job.status !== 'idle') restoreJob(file).catch(() => showToast('图片加载失败', 'error'))
})

/** 用共享任务里记住的那张图恢复界面，再接回同一次抠图 */
async function restoreJob(file: File) {
  sourceFileRef.value = file
  source.value = await loadImageFromFile(file)
  refreshSourceUrl()
  if (job.status === 'error') {
    showToast(job.error || '上次抠图失败，点「开始抠图」重试', 'error')
    return
  }
  eraseStrokes.value = job.result?.strokes ?? []
  await startRemove()
}

async function startRemove() {
  if (!source.value || processing.value) return
  processing.value = true
  resultReady.value = false
  try {
    const file = await sourceFile()
    // 任务本体交给共享登记表：跑完的结果与笔迹都挂在上面，视图卸载也不影响它
    const result = await job.run(file, async (report) => {
      const dataUrl = await fileToDataUrl(file)
      // 模型准备单独走共享进度：下载 42MB 期间切去其他工具也不会丢
      await prepareAiModel()
      report(1)
      const blob = await removeImageBackground(dataUrl, (p) => report(p.percent, p.stage))
      return { blob, strokes: [] as EraseStroke[] }
    })
    resultBlob.value = result.blob
    await prepareWork()
    await refreshResult()
    resultReady.value = true
    if (eraseMode.value) {
      // 抠图期间擦除面板被 v-if 卸载过，重新挂载后要把新底稿画回去
      await nextTick()
      drawErasePreview()
    }
  } catch (error) {
    console.error(error)
    showToast('抠图失败，请重试。如首次使用需先下载 AI 模型，请保持网络畅通', 'error')
  } finally {
    processing.value = false
  }
}

/** 获取源文件（选图时已缓存，处理期间重新选图也不受影响） */
async function sourceFile(): Promise<File> {
  if (sourceFileRef.value) {
    return sourceFileRef.value
  }
  // 兜底：重新从源图导出 dataURL
  const canvas = document.createElement('canvas')
  canvas.width = source.value!.width
  canvas.height = source.value!.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source.value!.bitmap, 0, 0)
  return canvasToBlob(canvas).then(
    (blob) => new File([blob], 'image.png', { type: 'image/png' }),
  )
}

/** 根据当前背景（背景图/纯色/透明）合成最终结果，刷新预览 */
async function refreshResult() {
  if (!resultBlob.value) return
  const canvas = await composeResult()
  resultUrl.value = canvasToPreviewUrl(canvas)
}

/** 预览只需按屏幕尺寸看，导出仍走全尺寸合成，两者互不影响 */
function canvasToPreviewUrl(canvas: HTMLCanvasElement): string {
  const fit = Math.min(1, PREVIEW_EDGE / Math.max(canvas.width, canvas.height))
  let target = canvas
  if (fit < 1) {
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round(canvas.width * fit))
    small.height = Math.max(1, Math.round(canvas.height * fit))
    const ctx = small.getContext('2d')
    if (ctx) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(canvas, 0, 0, small.width, small.height)
    }
    target = small
  }
  return target.toDataURL('image/png')
}

/** 统一合成入口：背景图优先，其次纯色/透明 */
async function composeResult(): Promise<HTMLCanvasElement> {
  const sprite = styledSprite()
  if (!sprite) throw new Error('暂无抠图结果')
  if (bgImageEl) {
    return composeBackgroundImage(sprite, bgImageEl)
  }
  return composeBackground(sprite, bgColor.value)
}

const hasStyle = computed(() => isStyled(style))
const hasErase = computed(() => eraseStrokes.value.length > 0)

/** 抠图完成后解码出工作面，擦除只在这份拷贝上落笔 */
async function prepareWork() {
  if (!resultBlob.value) return
  const canvas = await loadCutoutCanvas(resultBlob.value)
  // 解码得到的是未擦除的底稿，按记录把笔迹补回去，恢复会话时才不会丢
  for (const s of eraseStrokes.value) eraseStroke(canvas, s.points, s.radius)
  workCanvas.value = canvas
}

/** 先做边缘清理与描边投影，未启用任何效果时直接用工作画布 */
function styledSprite(): HTMLCanvasElement | null {
  if (!workCanvas.value) return null
  return isRelevant(style) ? styleCutout(workCanvas.value, style) : workCanvas.value
}

function applyPreset(key: PresetKey) {
  Object.assign(style, PRESETS[key])
}

/** 当前滑块值与某个预设完全一致时，该预设按钮高亮 */
function isPresetActive(key: PresetKey) {
  return (
    style.outlineWidth === PRESETS[key].outlineWidth &&
    style.shadowBlur === PRESETS[key].shadowBlur
  )
}

/**
 * 预览刷新统一走这里：一次合成可能耗时上百毫秒，用「帧内合并 + 跑完再补一次」
 * 节流，既跟得上滑块，又不会让多次刷新互相抢着写 resultUrl。
 */
let refreshQueued = false
let refreshing = false
let refreshDirty = false

function requestRefresh() {
  if (eraseMode.value || !resultBlob.value) return
  if (refreshing) {
    refreshDirty = true
    return
  }
  if (refreshQueued) return
  refreshQueued = true
  requestAnimationFrame(async () => {
    refreshQueued = false
    refreshing = true
    refreshDirty = false
    try {
      await refreshResult()
    } catch (error) {
      console.error(error)
    } finally {
      refreshing = false
    }
    if (refreshDirty) requestRefresh()
  })
}

watch(style, requestRefresh)

async function toggleErase() {
  eraseMode.value = !eraseMode.value
  if (eraseMode.value) {
    await nextTick()
    drawErasePreview()
  } else {
    requestRefresh()
  }
}

/** 擦除模式下把主体画到可见画布上，底下透出棋盘格表示透明 */
function drawErasePreview() {
  const view = eraseCanvas.value
  const sprite = workCanvas.value
  if (!view || !sprite) return
  // 镜面只是绘图辅助，按屏幕尺寸封顶，避免大图再占一份全分辨率画布
  const fit = Math.min(1, ERASE_EDGE / Math.max(sprite.width, sprite.height))
  view.width = Math.max(1, Math.round(sprite.width * fit))
  view.height = Math.max(1, Math.round(sprite.height * fit))
  const ctx = view.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sprite, 0, 0, view.width, view.height)
  // canvas 的位图会被拉伸到 CSS 盒子，只能自己按宽高比反推显示宽度
  eraseRatio.value = view.width / view.height
}

function spritePoint(event: PointerEvent): { x: number; y: number } | null {
  const view = eraseCanvas.value
  const sprite = workCanvas.value
  if (!view || !sprite) return null
  const rect = view.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  // 一律换算到工作面坐标，镜面自身的像素密度不参与计算
  return {
    x: ((event.clientX - rect.left) / rect.width) * sprite.width,
    y: ((event.clientY - rect.top) / rect.height) * sprite.height,
  }
}

let strokePoints: { x: number; y: number }[] = []
let strokeRadius = 0

function onEraseDown(event: PointerEvent) {
  const point = spritePoint(event)
  if (!point) return
  event.preventDefault()
  ;(event.target as Element).setPointerCapture?.(event.pointerId)
  // 半径在落笔时定死，中途调笔刷不会让已画的一笔在重放时变形
  strokeRadius = brushSize.value / 2
  strokePoints = [point]
  paintErase([point], strokeRadius)
}

function onEraseMove(event: PointerEvent) {
  if (strokePoints.length === 0) return
  const point = spritePoint(event)
  if (!point) return
  const last = strokePoints[strokePoints.length - 1]
  strokePoints.push(point)
  paintErase([last, point], strokeRadius)
}

function onEraseUp() {
  if (strokePoints.length === 0) return
  const points = strokePoints
  strokePoints = []
  setStrokes([...eraseStrokes.value, { points, radius: strokeRadius }])
}

/** 同一笔同时落在工作面和可见镜面上，省掉逐帧整图回读 */
function paintErase(points: { x: number; y: number }[], radius: number) {
  const sprite = workCanvas.value
  if (sprite) eraseStroke(sprite, points, radius)
  const view = eraseCanvas.value
  if (view && sprite) {
    const k = view.width / sprite.width
    eraseStroke(
      view,
      points.map((p) => ({ x: p.x * k, y: p.y * k })),
      radius * k,
    )
  }
}

/** 回到 AI 原始抠图再重放剩余笔迹：省掉一份全分辨率底稿，代价只是一次解码 */
async function rebuildWork() {
  await prepareWork()
  if (eraseMode.value) drawErasePreview()
  else requestRefresh()
}

async function undoErase() {
  if (eraseStrokes.value.length === 0) return
  setStrokes(eraseStrokes.value.slice(0, -1))
  await rebuildWork()
}

/** 丢弃所有擦除笔迹，回到 AI 原始抠图 */
async function resetErase() {
  if (!resultBlob.value) return
  setStrokes([])
  await rebuildWork()
  showToast('已还原抠图结果', 'success')
}

/** Ctrl/⌘+Z 撤销上一笔擦除，和水印页的肌肉记忆保持一致（退出擦除后同样可用） */
function onKeydown(event: KeyboardEvent) {
  if (eraseStrokes.value.length === 0) return
  if (event.shiftKey || !(event.metaKey || event.ctrlKey)) return
  if (event.key.toLowerCase() !== 'z') return
  event.preventDefault()
  undoErase()
}

function changeBg(color: string | null) {
  const needRefresh = !!bgImageEl || bgColor.value !== color
  // 选择纯色/透明时移除自定义背景图
  bgImageUrl.value = ''
  bgImageEl = null
  bgColor.value = color
  if (needRefresh) requestRefresh()
}

/** 选择自定义背景图并融合到抠图结果上 */
async function chooseBgImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const dataUrl = await fileToDataUrl(file)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('背景图加载失败'))
      img.src = dataUrl
    })
    bgImageEl = img
    bgImageUrl.value = dataUrl
    bgColor.value = null
    requestRefresh()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '背景图加载失败', 'error')
  } finally {
    input.value = ''
  }
}

/** 移除自定义背景图 */
function clearBgImage() {
  bgImageUrl.value = ''
  bgImageEl = null
  requestRefresh()
}

/** 擦除镜面的底色跟着当前背景走：擦完看到的就是导出的样子，不再一律透出棋盘格 */
const eraseBackdrop = computed<CSSProperties>(() => {
  if (bgImageUrl.value) {
    return {
      backgroundImage: `url(${bgImageUrl.value})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }
  if (bgColor.value) return { background: bgColor.value }
  return { background: 'repeating-conic-gradient(#e8eaf0 0 25%, #fff 0 50%) 0 0 / 18px 18px' }
})

const styleCard = ref<HTMLElement | null>(null)
const styleFlashing = ref(false)
let styleFlashTimer: number | undefined

/** 描边与投影在移动端整卡位于首屏以下，用一个明确入口把用户带过去 */
function jumpToStyle() {
  styleCard.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  styleFlashing.value = true
  if (styleFlashTimer !== undefined) window.clearTimeout(styleFlashTimer)
  styleFlashTimer = window.setTimeout(() => {
    styleFlashing.value = false
    styleFlashTimer = undefined
  }, 1600)
}

/** 按当前背景合成最终结果并导出 PNG 文件（下载与分享共用同一份产物与命名） */
async function buildResultFile(): Promise<File | null> {
  if (!source.value || !resultBlob.value) return null
  const canvas = await composeResult()
  const suffix = bgColor.value ? '抠图' : '抠图透明背景'
  return canvasToFile(canvas, `${source.value.name}_${suffix}.png`, 'image/png')
}

async function resultFiles(): Promise<File[]> {
  const file = await buildResultFile()
  return file ? [file] : []
}

async function saveResult() {
  const file = await buildResultFile()
  if (!file) return
  downloadBlob(file, file.name)
  showToast('已开始下载', 'success')
}

const sourceUrl = ref('')
// 在选图后生成源图预览
async function refreshSourceUrl() {
  if (!source.value) return
  const canvas = document.createElement('canvas')
  canvas.width = source.value.width
  canvas.height = source.value.height
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.drawImage(source.value.bitmap, 0, 0)
    sourceUrl.value = canvas.toDataURL('image/png')
  }
}

// 组件卸载时释放源图 bitmap 与临时监听
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (styleFlashTimer !== undefined) {
    window.clearTimeout(styleFlashTimer)
    styleFlashTimer = undefined
  }
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
      <div class="page-title">AI 抠图</div>
    </div>

    <div class="page-content">
      <!-- 未选图状态 -->
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张图片，AI 自动去除背景</div>
        <div class="empty-actions">
                  <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择图片</button>
                  <button class="btn btn-sample" @click="loadSample">体验示例图</button>
                </div>
        <p class="tip-text" style="max-width: 280px; text-align: center">
          首次使用需下载 AI 模型（约 42MB），仅一次、之后可离线使用。全程本地处理，图片不会上传。
        </p>
      </div>

      <template v-else>
        <!-- 原图与结果对比 -->
        <div class="card">
          <div class="card-title">处理结果</div>
          <div v-if="processing" class="progress-wrap">
            <div class="progress-bar">
              <div class="progress-inner" :style="{ width: progress.percent + '%' }"></div>
            </div>
            <div class="progress-text">
              {{ progress.stage }} {{ progress.percent }}%
            </div>
          </div>

          <div v-else-if="resultReady && eraseMode" class="erase-wrap">
            <canvas
              ref="eraseCanvas"
              class="erase-canvas"
              :style="{ '--erase-ratio': eraseRatio, ...eraseBackdrop }"
              @pointerdown="onEraseDown"
              @pointermove="onEraseMove"
              @pointerup="onEraseUp"
              @pointercancel="onEraseUp"
            ></canvas>
            <p class="tip-text" style="margin-top: 10px">
              按住并拖动即可擦掉多余部分，擦错一笔点「撤销上一笔」或按 Ctrl/⌘+Z。
              背景按当前设置显示，「退出擦除」后即为最终效果。
            </p>
          </div>

          <!-- 描边/投影会撑大画布，与原图不再 1:1 对齐，此时直接展示成品 -->
          <div v-else-if="resultReady && hasStyle" class="result-wrap">
            <img :src="resultUrl" alt="最终效果" />
          </div>

          <div v-else-if="resultReady" class="compare-wrap">
            <CompareSlider :before="sourceUrl" :after="resultUrl" before-label="原图" after-label="抠图结果" />
          </div>

          <div v-else class="preview-wrap" style="height: 200px">
            <img :src="sourceUrl" alt="原图" style="max-height: 200px" />
          </div>

          <button
            v-if="resultReady && !hasStyle && !eraseMode"
            class="style-jump"
            @click="jumpToStyle"
          >
            <span>边缘有白边？收一下再描边，做成贴纸和海报</span>
            <span class="style-jump-arrow">↓</span>
          </button>
        </div>

        <!-- 背景色设置 -->
        <div v-if="resultReady" class="card">
          <div class="card-title">更换背景</div>
          <div class="form-row">
            <span class="label">背景色</span>
            <div class="color-dots">
              <div
                v-for="c in BG_COLORS"
                :key="c.label"
                class="color-dot"
                :class="{ active: bgColor === c.value }"
                :style="c.value ? { background: c.value } : { background: 'repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0/12px 12px' }"
                @click="changeBg(c.value)"
              ></div>
            </div>
          </div>
          <div class="form-row">
            <span class="label">背景图</span>
            <div class="bg-select">
              <button class="btn btn-outline btn-sm" @click="bgFileInput?.click()">选择背景图</button>
              <div v-if="bgImageUrl" class="bg-thumb">
                <img :src="bgImageUrl" alt="背景图" />
                <span class="bg-thumb-remove" @click="clearBgImage">×</span>
              </div>
            </div>
          </div>
          <p class="tip-text">透明背景可直接用于贴图、表情包；换色后适合证件照场景。</p>
        </div>

        <!-- 边缘精修 / 描边 / 投影 / 擦除 -->
        <div v-if="resultReady" ref="styleCard" class="card" :class="{ 'card-flash': styleFlashing }">
          <div class="card-title">边缘与描边</div>
          <div class="range-row">
            <span class="label">边缘收缩</span>
            <input v-model.number="style.shrinkWidth" type="range" min="0" max="6" step="1" />
            <span class="range-val">{{ style.shrinkWidth || '关' }}</span>
          </div>
          <div class="range-row">
            <span class="label">边缘羽化</span>
            <input v-model.number="style.featherWidth" type="range" min="0" max="8" step="1" />
            <span class="range-val">{{ style.featherWidth || '关' }}</span>
          </div>
          <p class="tip-text">
            收缩用来吃掉抠图边缘残留的一圈背景，头发丝周围有白边时调到 1~2；
            羽化让主体与新背景的过渡更自然。两者只改边缘，不改变尺寸。
          </p>
          <div class="form-row">
            <span class="label">风格</span>
            <div class="preset-btns">
              <button
                v-for="p in PRESET_LIST"
                :key="p.key"
                class="btn btn-outline btn-sm"
                :class="{ 'btn-active': isPresetActive(p.key) }"
                @click="applyPreset(p.key)"
              >{{ p.label }}</button>
            </div>
          </div>
          <div v-if="style.outlineWidth > 0" class="form-row">
            <span class="label">描边色</span>
            <div class="color-dots">
              <div
                v-for="c in OUTLINE_COLORS"
                :key="c"
                class="color-dot"
                :class="{ active: style.outlineColor === c }"
                :style="{ background: c }"
                @click="style.outlineColor = c"
              ></div>
            </div>
          </div>
          <div class="range-row">
            <span class="label">描边宽度</span>
            <input v-model.number="style.outlineWidth" type="range" min="0" max="30" step="1" />
            <span class="range-val">{{ style.outlineWidth || '关' }}</span>
          </div>
          <div class="range-row">
            <span class="label">投影柔化</span>
            <input v-model.number="style.shadowBlur" type="range" min="0" max="60" step="2" />
            <span class="range-val">{{ style.shadowBlur || '关' }}</span>
          </div>
          <div class="range-row">
            <span class="label">擦除笔刷</span>
            <input v-model.number="brushSize" type="range" min="10" max="160" step="2" />
            <span class="range-val">{{ brushSize }}px</span>
          </div>
          <div class="form-row">
            <span class="label">擦除多余</span>
            <div class="preset-btns">
              <button class="btn btn-outline btn-sm" :class="{ 'btn-active': eraseMode }" @click="toggleErase">
                {{ eraseMode ? '退出擦除' : '开始擦除' }}
              </button>
              <button v-if="hasErase" class="btn btn-outline btn-sm" @click="undoErase">撤销上一笔</button>
              <button v-if="hasErase" class="btn btn-ghost btn-sm" @click="resetErase">还原</button>
            </div>
          </div>
          <p class="tip-text">描边 + 投影适合做贴纸、表情包和海报元素，导出时会一并烘进 PNG。</p>
        </div>

        <p v-if="processing" class="tip-text">全程本地处理，切去别的工具也不会打断，回来接着看。</p>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <ShareButton v-if="resultReady" :get-files="resultFiles" variant="outline" />
      <button v-if="!resultReady" class="btn btn-primary" :disabled="processing" @click="startRemove">
        {{ processing ? '处理中…' : '开始抠图' }}
      </button>
      <button v-else class="btn btn-primary" @click="saveResult">保存图片</button>
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
      ref="bgFileInput"
      type="file"
      accept="image/*,.heic,.heif"
      style="display: none"
      @change="chooseBgImage"
    />
    <!-- 渐变图标定义（供空状态图标引用） -->
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <defs>
        <linearGradient id="icon-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#34d399" />
          <stop offset="100%" stop-color="#22c55e" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.app-shell {
  isolation: isolate;
  --primary: #34d399;
  --gradient: linear-gradient(135deg, #34d399, #22c55e);
  --gradient-soft: linear-gradient(135deg, color-mix(in srgb, #34d399 12%, transparent), color-mix(in srgb, #22c55e 14%, transparent));
  --primary-light: color-mix(in srgb, #34d399 8%, #fff);
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
/* 前后对比交给 CompareSlider 组件渲染（含拖动交互与标签） */
.compare-wrap {
  max-width: 640px;
  margin: 0 auto;
}

/* 背景图选择 */
.bg-select {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.bg-thumb {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.bg-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.bg-thumb-remove {
  position: absolute;
  top: 0;
  right: 0;
  width: 16px;
  height: 16px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
  border-radius: 0 0 0 8px;
  cursor: pointer;
}

/* 擦除模式：画布透出棋盘格表示已变透明的区域 */
.erase-wrap {
  max-width: 640px;
  margin: 0 auto;
}
/* 成品预览：棋盘格画在图身上，避免比图更宽的空白 */
.result-wrap {
  text-align: center;
}
.result-wrap img {
  display: inline-block;
  max-width: 100%;
  max-height: 62vh;
  border-radius: 14px;
  background: repeating-conic-gradient(#e8eaf0 0 25%, #fff 0 50%) 0 0 / 18px 18px;
}
.erase-canvas {
  display: block;
  width: min(100%, calc(var(--erase-ratio, 1) * 62vh));
  height: auto;
  margin: 0 auto;
  border-radius: 12px;
  cursor: crosshair;
  touch-action: none;
  background: repeating-conic-gradient(#e8eaf0 0 25%, #fff 0 50%) 0 0 / 18px 18px;
}

/* 描边/投影入口：贴在结果下方，点了直接滚到那张卡片 */
.style-jump {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 12px;
  padding: 11px 14px;
  border: 1px dashed color-mix(in srgb, var(--primary) 45%, #fff);
  border-radius: 12px;
  background: var(--gradient-soft);
  color: #0f172a;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.style-jump-arrow {
  animation: jump-hint 1.6s ease-in-out infinite;
}
@keyframes jump-hint {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(3px);
  }
}
/* 滚过去之后短暂描边，确认"就是这个卡片" */
.card-flash {
  animation: card-flash 1.6s ease;
}
@keyframes card-flash {
  0%,
  55% {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 55%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  .style-jump-arrow,
  .card-flash {
    animation: none;
  }
}

/* 风格预设与擦除开关：小尺寸按钮横排 */
.preset-btns {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.preset-btns .btn {
  width: auto;
  padding: 8px 12px;
  font-size: 13px;
  border-radius: 10px;
}
.preset-btns .btn-active {
  background: var(--gradient);
  border-color: transparent;
  color: #fff;
}

/* PC 宽屏：结果左栏 + 背景设置右栏双栏布局 */
@media (min-width: 768px) {
  .page-content {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
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

  .page-content .card:nth-child(3) {
    grid-column: 2;
    grid-row: 2;
  }
}
</style>
