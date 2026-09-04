<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import {
  loadImageFromFile,
  fileToDataUrl,
  canvasToBlob,
  canvasToFile,
  downloadBlob,
  type LoadedImage,
} from '../utils/imageLoader'
import { removeImageBackground, composeBackground, composeBackgroundImage, loadCutoutCanvas } from '../utils/removeBg'
import { DEFAULT_CUTOUT_STYLE, styleCutout } from '../utils/cutoutStyle'
import { saveMany } from '../utils/zip'
import { useAiJob } from '../utils/aiJob'
import { prepareAiModel } from '../utils/aiModel'
import {
  ID_PHOTO_SPECS,
  ID_PHOTO_SPEC_GROUPS,
  mmToPx300,
  fitToSpec,
  layoutOnSheet,
  type IdPhotoSpec,
} from '../utils/idPhoto'
import { canvasToPdfBlob } from '../utils/pdf'
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

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const sourceFileRef = ref<File | null>(null)
const sourceUrl = ref('')
const processing = ref(false)
const job = useAiJob<Blob>('idPhoto')
const progress = computed(() => ({ percent: job.percent, stage: job.stage }))
const resultBlob = ref<Blob | null>(null)
const resultUrl = ref('')
const resultReady = ref(false)
const bgColor = ref<string | null>('#ffffff')
/** 自定义背景图（与纯色/透明互斥，启用时优先） */
const bgImageUrl = ref('')
let bgImageEl: HTMLImageElement | null = null
const bgFileInput = ref<HTMLInputElement | null>(null)
const specKey = ref('')
const sheetMode = ref(false)

/** 自定义规格尺寸（mm），非法输入在 change 时纠正到 10~200 的合理打印范围 */
const customW = ref(33)
const customH = ref(48)

function clampMm(v: number): number {
  // 非法输入（如清空）回退到 33×48 这个最常用档
  if (!Number.isFinite(v)) return 33
  return Math.round(Math.min(200, Math.max(10, v)))
}

const currentSpec = computed<IdPhotoSpec | null>(() => {
  if (specKey.value === 'custom') {
    const w = clampMm(customW.value)
    const h = clampMm(customH.value)
    return { key: 'custom', label: `自定义${w}x${h}mm`, mm: [w, h], width: mmToPx300(w), height: mmToPx300(h) }
  }
  return ID_PHOTO_SPECS.find((s) => s.key === specKey.value) ?? null
})

// 人物定位焦点（拖动十字 + 缩放），仅规格裁切时生效
const focus = reactive({ x: 0.5, y: 0.5, zoom: 1 })
const flatUrl = ref('')
let flatCanvas: HTMLCanvasElement | null = null
const focusStage = ref<HTMLElement | null>(null)
let focusDragging = false
let lastPX = 0
let lastPY = 0

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function focusStageDown(e: PointerEvent) {
  if (!flatCanvas || !focusStage.value) return
  const rect = focusStage.value.getBoundingClientRect()
  focus.x = clampNum((e.clientX - rect.left) / rect.width, 0, 1)
  focus.y = clampNum((e.clientY - rect.top) / rect.height, 0, 1)
  focusDragging = true
  lastPX = e.clientX
  lastPY = e.clientY
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  scheduleFocusRefresh()
}

function focusStageMove(e: PointerEvent) {
  if (!focusDragging || !focusStage.value) return
  const rect = focusStage.value.getBoundingClientRect()
  const dx = (e.clientX - lastPX) / rect.width
  const dy = (e.clientY - lastPY) / rect.height
  lastPX = e.clientX
  lastPY = e.clientY
  focus.x = clampNum(focus.x + dx, 0, 1)
  focus.y = clampNum(focus.y + dy, 0, 1)
  scheduleFocusRefresh()
}

function focusStageUp() {
  focusDragging = false
  scheduleFocusRefresh()
}

// 拖动/缩放时用 rAF 节流重建结果图，避免高频 canvas 重绘卡顿
let focusRaf = 0
function scheduleFocusRefresh() {
  if (focusRaf) cancelAnimationFrame(focusRaf)
  focusRaf = requestAnimationFrame(() => {
    focusRaf = 0
    if (resultBlob.value) applyBgColor()
  })
}

const BG_COLORS = [
  { label: '白底', value: '#ffffff' },
  { label: '蓝底', value: '#438edb' },
  { label: '红底', value: '#d9001b' },
  { label: '透明', value: null as string | null },
]

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="12" cy="10.5" r="2.8"/><path d="M7.5 17.5c.9-2 2.6-3 4.5-3s3.6 1 4.5 3"/></svg>`

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

/** 加载照片并开始处理 */
async function processFile(file: File) {
  sourceFileRef.value = file
  source.value = await loadImageFromFile(file)
  refreshSourceUrl()
  resultReady.value = false
  resultUrl.value = ''
  resultBlob.value = null
  bgColor.value = '#ffffff'
  bgImageUrl.value = ''
  bgImageEl = null
  styledCache.value = null
  focus.x = 0.5
  focus.y = 0.5
  focus.zoom = 1
  flatUrl.value = ''
  flatCanvas = null
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

// 接收其他工具流转过来的图片（如图片编辑 → 证件照）；
// 没有新图时先看共享任务：切去别的工具再回来，进度和结果都还在
onMounted(() => {
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
    showToast(job.error || '上次处理失败，点「开始处理」重试', 'error')
    return
  }
  await startRemove()
}

async function startRemove() {
  if (!source.value || processing.value) return
  processing.value = true
  resultReady.value = false
  try {
    const file = await sourceFile()
    // 任务本体交给共享登记表：视图卸载也不影响它跑完
    const blob = await job.run(file, async (report) => {
      const dataUrl = await fileToDataUrl(file)
      // 模型准备与 AI 抠图共用同一份共享状态与缓存，不重复下载
      await prepareAiModel()
      report(1)
      return removeImageBackground(dataUrl, (p) => report(p.percent, p.stage))
    })
    resultBlob.value = blob
    styledCache.value = null
    await applyBgColor()
    resultReady.value = true
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

/** 生成最终结果画布：抠图(+边缘精修) + 底色 + 规格裁切 + 一版多张排版；传入 bgOverride 时按指定底色生成（多底色导出用，忽略自定义背景图） */
async function buildResultCanvas(bgOverride?: string): Promise<HTMLCanvasElement> {
  if (!resultBlob.value) throw new Error('尚无处理结果')
  const styled = await getStyledCanvas()
  const base = bgOverride != null
    ? await composeBackground(styled, bgOverride)
    : bgImageEl
      ? await composeBackgroundImage(resultBlob.value, bgImageEl)
      : await composeBackground(styled, bgColor.value)
  const canvas = currentSpec.value
    ? fitToSpec(base, currentSpec.value, { x: focus.x, y: focus.y, zoom: focus.zoom })
    : base
  if (sheetMode.value && currentSpec.value) {
    return layoutOnSheet(canvas, currentSpec.value)
  }
  return canvas
}

/** 边缘精修：收缩吃掉发丝边的原底色残留，羽化柔化过渡（只改 alpha，尺寸不变） */
const edgeShrink = ref(1)
const edgeFeather = ref(0)
/** 边缘处理结果按参数缓存：拖动人物焦点时的高频重建不必反复跑滤波 */
const styledCache = ref<{ shrink: number; feather: number; canvas: HTMLCanvasElement } | null>(null)

async function getStyledCanvas(): Promise<HTMLCanvasElement> {
  if (!resultBlob.value) throw new Error('尚无处理结果')
  const cached = styledCache.value
  if (cached && cached.shrink === edgeShrink.value && cached.feather === edgeFeather.value) {
    return cached.canvas
  }
  const base = await loadCutoutCanvas(resultBlob.value)
  const canvas = styleCutout(base, {
    ...DEFAULT_CUTOUT_STYLE,
    outlineWidth: 0,
    shadowBlur: 0,
    shrinkWidth: edgeShrink.value,
    featherWidth: edgeFeather.value,
  })
  styledCache.value = { shrink: edgeShrink.value, feather: edgeFeather.value, canvas }
  return canvas
}

async function changeEdge() {
  if (!resultBlob.value) return
  await applyBgColor()
}

async function applyBgColor() {
  if (!resultBlob.value) return
  const canvas = await buildResultCanvas()
  resultUrl.value = canvas.toDataURL('image/png')
  if (flatCanvas) flatUrl.value = flatCanvas.toDataURL('image/png')
}

/** 切换证件照规格（无规格 = 原尺寸，custom = 自定义毫米尺寸） */
async function changeSpec(key: string) {
  if (specKey.value === key) return
  specKey.value = key
  if (resultBlob.value) {
    await applyBgColor()
  }
}

/** 自定义尺寸输入变更：先纠正非法值再重建结果 */
async function onCustomSizeInput(which: 'w' | 'h', event: Event) {
  const v = (event.target as HTMLInputElement).valueAsNumber
  if (which === 'w') customW.value = clampMm(v)
  else customH.value = clampMm(v)
  if (resultBlob.value) {
    await applyBgColor()
  }
}

/** 切换一版多张排版（v-model 已同步状态，这里只需重建结果） */
async function changeSheet() {
  if (resultBlob.value) {
    await applyBgColor()
  }
}

async function changeBg(color: string | null) {
  if (color === bgColor.value && !bgImageEl) return
  // 选择纯色/透明时移除自定义背景图（两者互斥）
  bgImageUrl.value = ''
  bgImageEl = null
  bgColor.value = color
  focus.x = 0.5
  focus.y = 0.5
  focus.zoom = 1
  if (resultBlob.value) {
    await applyBgColor()
  }
}

/** 选择自定义背景图并融合到抠图结果上（与纯色/透明互斥） */
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
    focus.x = 0.5
    focus.y = 0.5
    focus.zoom = 1
    if (resultBlob.value) await applyBgColor()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '背景图加载失败', 'error')
  } finally {
    input.value = ''
  }
}

/** 移除自定义背景图，回到透明底 */
function clearBgImage() {
  bgImageUrl.value = ''
  bgImageEl = null
  focus.x = 0.5
  focus.y = 0.5
  focus.zoom = 1
  if (resultBlob.value) applyBgColor()
}

/** 导出最终证件照文件：有底色/背景图用 JPEG（体积更小），透明底用 PNG 保留通道 */
async function buildResultFile(): Promise<File | null> {
  if (!source.value || !resultBlob.value) return null
  const canvas = await buildResultCanvas()
  const label = bgImageEl ? '背景图' : (BG_COLORS.find((c) => c.value === bgColor.value)?.label ?? '')
  const specLabel = currentSpec.value ? `_${currentSpec.value.label}` : ''
  const base = `${source.value.name}_证件照${specLabel}${label}`
  const opaque = bgColor.value !== null || !!bgImageEl
  // 有底色/背景图（无透明通道）：JPEG 体积更小，适合证件照场景
  // 透明底：JPEG 不支持透明通道，必须用 PNG 保留
  return opaque
    ? canvasToFile(canvas, `${base}.jpg`, 'image/jpeg', 0.95)
    : canvasToFile(canvas, `${base}.png`, 'image/png')
}

async function resultFiles(): Promise<File[]> {
  const file = await buildResultFile()
  return file ? [file] : []
}

async function saveResult() {
  try {
    const file = await buildResultFile()
    if (!file) return
    downloadBlob(file, file.name)
    showToast('已开始下载', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function exportPdf() {
  if (!source.value || !resultBlob.value || pdfBusy.value) return
  pdfBusy.value = true
  try {
    const canvas = await buildResultCanvas()
    const pdf = await canvasToPdfBlob(canvas)
    const label = bgImageEl ? '背景图' : (BG_COLORS.find((c) => c.value === bgColor.value)?.label ?? '')
    const specLabel = currentSpec.value ? `_${currentSpec.value.label}` : ''
    downloadBlob(pdf, `${source.value.name}_证件照${specLabel}${label}_6寸版.pdf`)
    showToast('PDF 已开始下载，打印时选「实际大小」', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'PDF 导出失败', 'error')
  } finally {
    pdfBusy.value = false
  }
}

/** 多底色一键导出：报名系统要蓝底、打印要白底，一次出齐免得反复切换下载（忽略自定义背景图） */
const MULTI_BG_TARGETS = [
  { label: '白底', color: '#ffffff' },
  { label: '蓝底', color: '#438edb' },
  { label: '红底', color: '#d9001b' },
]
const multiBusy = ref(false)
async function exportMultiBg() {
  if (!source.value || !resultBlob.value || multiBusy.value) return
  multiBusy.value = true
  try {
    const specLabel = currentSpec.value ? `_${currentSpec.value.label}` : ''
    const files: File[] = []
    for (const t of MULTI_BG_TARGETS) {
      const canvas = await buildResultCanvas(t.color)
      files.push(await canvasToFile(canvas, `${source.value.name}_证件照${specLabel}_${t.label}.jpg`, 'image/jpeg', 0.95))
    }
    await saveMany(files, `${source.value.name}_证件照${specLabel}_多底色.zip`)
    showToast('三种底色已打包下载', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导出失败', 'error')
  } finally {
    multiBusy.value = false
  }
}

/** 导出一版多张打印 PDF：页面物理尺寸与排版图一致，打印店选「实际大小」直接出片 */
const pdfBusy = ref(false)

function refreshSourceUrl() {
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
      <div class="page-title">证件照换底色</div>
    </div>

    <div class="page-content tool-page">
      <!-- 未选图状态 -->
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张人像照片，AI 自动抠图换底色</div>
        <div class="empty-actions">
          <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择照片</button>
          <button class="btn btn-sample" @click="loadSample">体验示例图</button>
        </div>
        <p class="tip-text" style="max-width: 280px; text-align: center">
          首次使用需下载 AI 模型（约 42MB），仅一次、之后可离线使用。全程本地处理，照片不会上传。
        </p>
      </div>

      <template v-else>
        <!-- 处理结果 -->
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

          <div v-else-if="resultReady" class="compare-wrap">
            <CompareSlider :before="sourceUrl" :after="resultUrl" before-label="原图" after-label="证件照" />
          </div>

          <div v-else class="preview-wrap" style="height: 200px">
            <img :src="sourceUrl" alt="原图" style="max-height: 200px" />
          </div>
        </div>

        <!-- 底色选择 -->
        <div v-if="resultReady" class="card">
          <div class="card-title">选择底色</div>
          <div class="form-row">
            <span class="label">底色</span>
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
              <button class="btn btn-outline" @click="bgFileInput?.click()">选择背景图</button>
              <div v-if="bgImageUrl" class="bg-thumb">
                <img :src="bgImageUrl" alt="背景图" />
                <span class="bg-thumb-remove" @click="clearBgImage">×</span>
              </div>
            </div>
          </div>
          <div class="form-row" style="margin-top: 12px">
            <span class="label">边缘收缩</span>
            <div class="edge-ctrl">
              <input
                v-model.number="edgeShrink"
                type="range"
                min="0"
                max="6"
                step="1"
                class="edge-range"
                @change="changeEdge"
              />
              <span class="range-value">{{ edgeShrink || '关' }}</span>
            </div>
          </div>
          <div class="form-row">
            <span class="label">边缘羽化</span>
            <div class="edge-ctrl">
              <input
                v-model.number="edgeFeather"
                type="range"
                min="0"
                max="8"
                step="1"
                class="edge-range"
                @change="changeEdge"
              />
              <span class="range-value">{{ edgeFeather || '关' }}</span>
            </div>
          </div>
          <p class="tip-text">换底后发丝边缘有白边残留时，把收缩调到 1~2 吃掉；羽化让边缘与新背景的过渡更柔。</p>
          <div class="form-row">
            <span class="label">多底色</span>
            <button class="btn btn-outline inline-btn" :disabled="multiBusy" @click="exportMultiBg">
              {{ multiBusy ? '生成中…' : '白/蓝/红 打包下载' }}
            </button>
          </div>
          <p class="tip-text">白底、蓝底、红底为常见证件照背景色；也可选择自定义背景图，与纯色/透明互斥。多底色按当前规格与排版设置一键出齐三种底色。</p>

          <div class="form-row" style="margin-top: 12px; align-items: flex-start">
            <span class="label" style="padding-top: 7px">规格</span>
            <div class="spec-groups">
              <div v-for="g in ID_PHOTO_SPEC_GROUPS" :key="g.key" class="spec-row">
                <span class="spec-group-name">{{ g.label }}</span>
                <div class="spec-chips">
                  <div
                    v-if="g.key === 'common'"
                    class="pos-chip"
                    :class="{ active: specKey === '' }"
                    @click="changeSpec('')"
                  >
                    原尺寸
                  </div>
                  <div
                    v-for="s in g.specs"
                    :key="s.key"
                    class="pos-chip"
                    :class="{ active: specKey === s.key }"
                    @click="changeSpec(s.key)"
                  >
                    {{ s.label }}
                  </div>
                </div>
              </div>
              <div class="spec-row">
                <span class="spec-group-name">自定义</span>
                <div class="spec-chips">
                  <div class="pos-chip" :class="{ active: specKey === 'custom' }" @click="changeSpec('custom')">自定义尺寸</div>
                  <template v-if="specKey === 'custom'">
                    <span class="spec-unit">宽</span>
                    <input
                      class="spec-input"
                      type="number"
                      min="10"
                      max="200"
                      :value="customW"
                      @change="onCustomSizeInput('w', $event)"
                    />
                    <span class="spec-unit">× 高</span>
                    <input
                      class="spec-input"
                      type="number"
                      min="10"
                      max="200"
                      :value="customH"
                      @change="onCustomSizeInput('h', $event)"
                    />
                    <span class="spec-unit">mm</span>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <div v-if="currentSpec" class="form-row">
            <span class="label">一版多张</span>
            <div style="display: flex; align-items: center; gap: 8px; flex: 1; justify-content: flex-end">
              <span class="range-value">{{ currentSpec.key === 'one' ? '6 张' : '4 张' }}</span>
              <input
                v-model="sheetMode"
                type="checkbox"
                style="width: 22px; height: 22px; accent-color: var(--primary); flex-shrink: 0"
                @change="changeSheet"
              />
            </div>
          </div>
          <div v-if="currentSpec" class="form-row" style="align-items: flex-start; flex-wrap: wrap; margin-top: 4px">
            <span class="label">人物位置</span>
            <div class="focus-wrap">
              <div
                ref="focusStage"
                class="focus-stage"
                @pointerdown="focusStageDown"
                @pointermove="focusStageMove"
                @pointerup="focusStageUp"
                @pointerleave="focusStageUp"
              >
                <img :src="flatUrl || resultUrl" alt="人像" class="focus-img" />
                <div class="focus-cross" :style="{ left: focus.x * 100 + '%', top: focus.y * 100 + '%' }"></div>
              </div>
              <div class="form-row" style="margin-top: 8px; justify-content: flex-end; align-items: center">
                <span class="label">缩放</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  v-model.number="focus.zoom"
                  class="focus-range"
                  @input="scheduleFocusRefresh"
                />
              </div>
              <p class="tip-text">拖动十字使人物位于裁切中心，缩放可控制人物大小。</p>
            </div>
          </div>
          <div v-if="sheetMode && resultReady" class="form-row" style="margin-top: 8px">
            <span class="label">打印</span>
            <button class="btn btn-outline inline-btn" :disabled="pdfBusy" @click="exportPdf">
              {{ pdfBusy ? '生成中…' : '导出打印 PDF' }}
            </button>
          </div>
          <p class="tip-text">
            {{ currentSpec ? `${currentSpec.label}规格输出 ${currentSpec.width}×${currentSpec.height} 像素（300dpi，约 ${currentSpec.mm[0]}×${currentSpec.mm[1]}mm），按规格居中裁切，请确保人像位于照片中央。` : '不限制输出尺寸，保持原图比例。' }}
            {{ sheetMode ? '一版多张为 6 寸相纸排版，可直接打印，也可导出打印 PDF。' : '' }}
          </p>
        </div>

        <p v-if="processing" class="tip-text">全程本地处理，切去别的工具也不会打断，回来接着看。</p>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <ShareButton v-if="resultReady" :get-files="resultFiles" variant="outline" />
      <button v-if="!resultReady" class="btn btn-primary" :disabled="processing" @click="startRemove">
        {{ processing ? '处理中…' : '开始处理' }}
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
          <stop offset="0%" stop-color="#c084fc" />
          <stop offset="100%" stop-color="#d946ef" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.app-shell {
  isolation: isolate;
  --primary: #c084fc;
  --gradient: linear-gradient(135deg, #c084fc, #d946ef);
  --gradient-soft: linear-gradient(135deg, color-mix(in srgb, #c084fc 12%, transparent), color-mix(in srgb, #d946ef 14%, transparent));
  --primary-light: color-mix(in srgb, #c084fc 8%, #fff);
}

/* 背景氛围光斑：柔和多色 radial 光晕（全站统一） */
.app-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(520px circle at 12% 6%, rgba(192, 132, 252, 0.2), transparent 55%),
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

/* 规格分组：组名窄列右对齐，chips 紧贴组名不推到行尾 */
.spec-groups {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.spec-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spec-group-name {
  flex-shrink: 0;
  width: 64px;
  text-align: right;
  font-size: 12px;
  color: var(--text-sub);
}

.spec-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

/* 自定义尺寸输入：窄数字框，非法值在 change 时纠正 */
.spec-input {
  width: 64px;
  padding: 6px 8px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  font-size: 13px;
  color: inherit;
}

.spec-unit {
  font-size: 12px;
  color: var(--text-sub);
}

/* 卡片内联导出按钮（打印 PDF / 多底色）：不占底栏 */
.inline-btn {
  width: auto;
  padding: 8px 16px;
  font-size: 13px;
  border-radius: 10px;
}

/* 边缘精修滑杆：与一版多张行同构，控件贴行尾收窄 */
.edge-ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  justify-content: flex-end;
}

.edge-range {
  flex: 1;
  max-width: 220px;
  accent-color: var(--primary);
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
.bg-select .btn {
  width: auto;
  padding: 8px 16px;
  font-size: 13px;
  border-radius: 10px;
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

/* 人物位置微调（拖动十字 + 缩放） */
.focus-wrap {
  flex: 1;
  min-width: 0;
}
.focus-stage {
  position: relative;
  width: 100%;
  margin-top: 4px;
  border-radius: 12px;
  overflow: hidden;
  background: #f1f3f9;
  border: 1px solid var(--border);
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}
.focus-img {
  display: block;
  width: 100%;
  height: auto;
  pointer-events: none;
}
.focus-cross {
  position: absolute;
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  border: 2px solid var(--primary, #4f6ef7);
  border-radius: 50%;
  pointer-events: none;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.8), 0 2px 8px rgba(0, 0, 0, 0.25);
}
.focus-cross::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1px;
  height: 26px;
  background: var(--primary, #4f6ef7);
  transform: translate(-50%, -50%);
}
.focus-range {
  flex: 1;
  max-width: 220px;
  accent-color: var(--primary);
}

/* PC 宽屏：双栏落位走 style.css 的 .tool-page 默认规则，这里只调左右比例 */
@media (min-width: 768px) {
  .page-content.tool-page {
    --pane-left: 1.2fr;
  }
}
</style>
