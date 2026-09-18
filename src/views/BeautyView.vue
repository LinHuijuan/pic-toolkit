<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, bitmapToCanvas, downloadCanvas, canvasToFile, type LoadedImage } from '../utils/imageLoader'
import { saveMany } from '../utils/zip'
import ShareButton from '../components/ShareButton.vue'
import AiModelBanner from '../components/AiModelBanner.vue'
import CopyButton from '../components/CopyButton.vue'
import { beautifyImage } from '../utils/imageBeauty'
import { useAiJob, hydrateJob } from '../utils/aiJob'
import { showToast } from '../utils/toast'
import { fetchSampleFile } from '../utils/sampleImage'
import CompareSlider from '../components/CompareSlider.vue'
import NextTools from '../components/NextTools.vue'

const emit = defineEmits<{
  back: []
  consumed: []
  navigate: [view: 'edit' | 'grid', file: File]
}>()
const props = defineProps<{ incomingFile?: File | null }>()

/** 美颜完可把成品直接送下一步：「再编辑」或「切九宫格」，不用重新选图 */
const NEXT_CHAIN: { key: 'edit' | 'grid'; label: string }[] = [
  { key: 'edit', label: '继续编辑' },
  { key: 'grid', label: '切九宫格' },
]

useImageDrop((files) => {
  if (files[0]) processFile(files[0])
})

/** 结果连同产出它的那组参数一起存：切回来时滑块和图必须对得上 */
interface BeautyResult {
  canvas: HTMLCanvasElement
  smoothness: number
  brightness: number
}

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const sourceFileRef = ref<File | null>(null)
const resultCanvas = ref<HTMLCanvasElement | null>(null)
const resultUrl = ref('')
const originUrl = ref('')
const processing = ref(false)
const job = useAiJob<BeautyResult>('beauty')

const smoothness = ref(50)
const brightness = ref(8)

/** 一次美颜结果的快照（canvas 供下载/接力复用，url 供展示/对比） */
interface BeautyShot {
  canvas: HTMLCanvasElement
  url: string
}

/** 可撤销的历史（不含正在显示的当前帧；栈顶最近） */
const hist = ref<BeautyShot[]>([])
/** 撤销后可供重做的历史 */
const redoHist = ref<BeautyShot[]>([])
const MAX_HIST = 50

const canUndo = computed(
  () => hist.value.length > 0 || (resultUrl.value !== '' && resultUrl.value !== originUrl.value),
)
const canRedo = computed(() => redoHist.value.length > 0)

function currentShot(): BeautyShot {
  return { canvas: resultCanvas.value!, url: resultUrl.value }
}

/** 把当前帧转成原图画布：重置/撤销到「没做任何美颜」时下载与接力都拿它当结果 */
function originalCanvas(): HTMLCanvasElement | null {
  if (!source.value) return null
  return bitmapToCanvas(source.value.bitmap)
}

function showOriginal() {
  const c = originalCanvas()
  if (!c) return
  resultCanvas.value = c
  resultUrl.value = originUrl.value
}

function capHistory() {
  if (hist.value.length > MAX_HIST) hist.value = hist.value.slice(-MAX_HIST)
}

function recordPendingShot() {
  if (resultCanvas.value && resultUrl.value) hist.value.push(currentShot())
  capHistory()
}

/** 上一步：有更早结果则退回那一次；否则退回原图 */
function undo() {
  if (hist.value.length === 0) {
    if (!resultCanvas.value || resultUrl.value === originUrl.value) return
    redoHist.value.push(currentShot())
    showOriginal()
    return
  }
  redoHist.value.push(currentShot())
  const prev = hist.value.pop()!
  resultCanvas.value = prev.canvas
  resultUrl.value = prev.url
}

function redo() {
  const next = redoHist.value.pop()
  if (!next) return
  hist.value.push(currentShot())
  resultCanvas.value = next.canvas
  resultUrl.value = next.url
}

/** 重置：回到没做任何美颜的原图，清空撤销/重做历史 */
function resetBeauty() {
  if (!source.value) return
  smoothness.value = 0
  brightness.value = 0
  showOriginal()
  hist.value = []
  redoHist.value = []
  showToast('已重置到原图', 'success')
}

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><path d="M12 3.5c3.2 4.2 5.5 7.1 5.5 10a5.5 5.5 0 1 1-11 0c0-2.9 2.3-5.8 5.5-10Z"/><path d="M8.5 14.5h7M9.5 17h5"/></svg>`

async function processFile(file: File) {
  try {
    sourceFileRef.value = file
    source.value = await loadImageFromFile(file)
    originUrl.value = URL.createObjectURL(file)
    resultCanvas.value = null
    resultUrl.value = ''
    hist.value = []
    redoHist.value = []
    smoothness.value = 50
    brightness.value = 8
    run()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
  }
}

/** 结果上屏时把滑块摆回产出这张图的参数，界面与实际效果不会各说各话 */
function applyResult(result: BeautyResult) {
  // 把当前帧存进可撤销历史再上新结果
  recordPendingShot()
  redoHist.value = []
  resultCanvas.value = result.canvas
  resultUrl.value = result.canvas.toDataURL('image/png')
  smoothness.value = result.smoothness
  brightness.value = result.brightness
}

/** 接回在跑的任务时要沿用登记表里的签名：此时滑块已回到默认值，自己拼会对不上。
 *  只能走这个一次性开关，run 是模板上的事件处理器，不能带参数。 */
let attachSig: string | null = null

async function run() {
  if (!source.value || !sourceFileRef.value) return
  processing.value = true
  const params = { smoothness: smoothness.value, brightness: brightness.value }
  const sig = attachSig ?? `${params.smoothness}:${params.brightness}`
  attachSig = null
  try {
    // 参数签名参与复用判断：滑块一动签名就变，必须真跑一次，不能拿上一次的结果糊弄
    const result = await job.run(
      sourceFileRef.value,
      async () => ({ canvas: await beautifyImage(source.value!.bitmap, params), ...params }),
      sig,
    )
    applyResult(result)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '美颜失败，请检查网络后重试（需下载模型）', 'error')
  } finally {
    processing.value = false
  }
}

/** 切走再回来：跑完的直接接回结果，还在跑的自己会写回登记表 */
async function restoreJob(file: File) {
  sourceFileRef.value = file
  source.value = await loadImageFromFile(file)
  originUrl.value = URL.createObjectURL(file)
  hist.value = []
  redoHist.value = []
  const done = job.result
  if (job.status === 'done' && done) {
    applyResult(done)
    return
  }
  if (job.status === 'running') {
    attachSig = job.variant
    run()
  }
}

function pickImage() {
  fileInput.value?.click()
}

async function loadSample() {
  try {
    const file = await fetchSampleFile('person')
    await processFile(file)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '示例图加载失败', 'error')
  }
}

async function resultFiles(): Promise<File[]> {
  if (!source.value || !resultCanvas.value) return []
  return [await canvasToFile(resultCanvas.value, `${source.value.name}_美颜.png`)]
}

function saveResult() {
  if (!source.value || !resultCanvas.value) return
  downloadCanvas(resultCanvas.value, `${source.value.name}_美颜.png`)
  showToast('已开始下载', 'success')
}

/** 把美颜结果直送下一步工具：送单张成品，不必在新工具里重新选图 */
async function onPickNext(key: string) {
  if (key !== 'edit' && key !== 'grid') return
  const files = await resultFiles()
  const first = files[0]
  if (!first) {
    showToast('还没有可发送的美颜结果', 'error')
    return
  }
  emit('navigate', key, first)
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''
  processFile(file)
}

/** 批量队列：只保留已编码的 File 与预览 URL，画布结果用完即弃，避免多张大图同时驻留内存 */
interface BeautyBatchItem {
  name: string
  url: string
  blob: Blob
}

/** 一次上限：美颜逐张推理，再多移动端内存会吃不消，也会把等待拖到不友好 */
const MAX_BATCH = 20

const batchInput = ref<HTMLInputElement | null>(null)
const batchItems = ref<BeautyBatchItem[]>([])
const batchProcessing = ref(false)
const batchProgress = ref(0) // 已完成张数

function clearBatch() {
  batchItems.value.forEach((item) => URL.revokeObjectURL(item.url))
  batchItems.value = []
  batchProgress.value = 0
}

function pickBatch() {
  batchInput.value?.click()
}

/** 把当前参数批量套到一组人像，逐张出 PNG 并催生预览缩略图 */
async function runBeautyBatch(files: File[]) {
  if (batchProcessing.value || files.length === 0) return
  const list = files.slice(0, MAX_BATCH)
  if (files.length > list.length) {
    showToast(`一次最多 ${MAX_BATCH} 张，已取前 ${MAX_BATCH} 张`, 'error')
  }
  clearBatch()
  batchProcessing.value = true
  try {
    const params = { smoothness: smoothness.value, brightness: brightness.value }
    for (const file of list) {
      try {
        const image = await loadImageFromFile(file)
        try {
          // 批量与单图共用同一套推理（模型模块级缓存），不需要走单图的任务登记表
          const canvas = await beautifyImage(image.bitmap, params)
          const encoded = await canvasToFile(canvas, `${image.name}_美颜.png`, 'image/png')
          batchItems.value.push({
            name: encoded.name,
            url: URL.createObjectURL(encoded),
            blob: encoded,
          })
        } finally {
          image.bitmap.close()
        }
      } catch {
        showToast(`${file.name} 处理失败，已跳过`, 'error')
      }
      batchProgress.value++
      // 逐张让出主线程：批量多张时不能把页面锁死
      await new Promise((r) => setTimeout(r, 0))
    }
  } finally {
    batchProcessing.value = false
  }
}

function handleBatchChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  runBeautyBatch(files)
}

async function batchFiles(): Promise<File[]> {
  return batchItems.value.map((item) => new File([item.blob], item.name, { type: item.blob.type }))
}

async function saveBeautyBatch() {
  const files = await batchFiles()
  if (files.length === 0) return
  await saveMany(files, '批量美颜.zip')
  showToast(files.length > 1 ? '已打包下载' : '已开始下载', 'success')
}

onMounted(async () => {
  if (props.incomingFile) {
    processFile(props.incomingFile).catch(() => showToast('图片加载失败', 'error'))
    emit('consumed')
    return
  }
  // 强刷回来先恢复可能进行中的任务，再判断是否要接着跑
  await hydrateJob('beauty')
  const file = job.input
  if (file && job.status !== 'idle') restoreJob(file).catch(() => showToast('图片加载失败', 'error'))
})

onUnmounted(() => {
  clearBatch()
  if (originUrl.value) URL.revokeObjectURL(originUrl.value)
})
</script>

<template>
  <div class="app-shell">
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">美颜修图</div>
    </div>

    <div class="page-content tool-page">
      <AiModelBanner />
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张人像，AI 本地检测人脸并磨皮提亮</div>
        <p class="empty-hint">适合人像精修，磨皮提亮一键到位</p>
        <div class="empty-actions">
          <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择图片</button>
          <button class="btn btn-sample" @click="loadSample">体验示例</button>
        </div>
      </div>

      <template v-else>
        <div class="card">
          <div class="card-title card-title-row">
            <span>预览</span>
            <div v-if="resultUrl" class="hist-tools">
              <button class="hist-tool" :disabled="!canUndo" title="回到上一次美颜结果" @click="undo">
                ↺ 上一步
              </button>
              <button class="hist-tool" :disabled="!canRedo" title="重做被撤销的美颜" @click="redo">
                ↻ 重做
              </button>
              <button
                class="hist-tool"
                :disabled="resultUrl === originUrl"
                title="重置到没做任何美颜的原图"
                @click="resetBeauty"
              >
                ♻ 重置
              </button>
            </div>
          </div>
          <div class="preview-wrap">
            <div v-if="processing" class="beauty-loading">
              <p class="tip-text">正在检测人脸并美颜…</p>
            </div>
            <template v-else-if="resultUrl">
              <CompareSlider
                :before="originUrl"
                :after="resultUrl"
                before-label="美颜前"
                after-label="美颜后"
              />
              <p class="tip-text">
                拖动中缝观察美颜前后差异。处理全程在本地完成，人物信息不会上传。
              </p>
            </template>
            <div v-else class="beauty-wait">
              <p class="tip-text">点击「应用美颜」进行本地处理</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">美颜参数</div>
          <div class="form-row">
            <span class="label">磨皮强度</span>
            <input v-model.number="smoothness" type="range" min="0" max="100" step="1" style="flex: 1" @change="run" />
            <span class="param-value">{{ smoothness }}</span>
          </div>
          <div class="form-row">
            <span class="label">提亮程度</span>
            <input v-model.number="brightness" type="range" min="-30" max="30" step="1" style="flex: 1" @change="run" />
            <span class="param-value">{{ brightness }}</span>
          </div>
          <button class="btn btn-primary" style="width: 100%" :disabled="processing" @click="run">
            {{ processing ? '处理中…' : '应用美颜' }}
          </button>
        </div>

        <!-- 美颜成品的下一步：直送「继续编辑 / 切九宫格」，不用重新选图 -->
        <div v-if="resultUrl" class="next-row">
          <NextTools :options="NEXT_CHAIN" @pick="onPickNext" />
        </div>

        <!-- 批量：调好一套参数，一次磨皮多张人像 -->
        <div class="card">
          <div class="card-title">批量美颜</div>
          <p class="tip-text">
            调好磨皮与提亮后，可一次给多张人像做同样处理；保存全部时多张会打成一个 ZIP。
          </p>
          <button
            class="btn btn-outline"
            style="width: 100%"
            :disabled="batchProcessing"
            @click="pickBatch"
          >
            {{ batchProcessing ? `处理中 ${batchProgress} 张…` : '选择多张人像' }}
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
            <button class="btn btn-ghost" @click="clearBatch">清空</button>
            <button class="btn btn-primary" @click="saveBeautyBatch">保存全部</button>
          </div>
        </div>
      </template>
    </div>

    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <ShareButton :get-files="resultFiles" variant="outline" :disabled="!resultUrl || processing" />
      <CopyButton :get-files="resultFiles" variant="outline" :disabled="!resultUrl || processing" />
      <button class="btn btn-primary" :disabled="!resultUrl || processing" @click="saveResult">保存图片</button>
    </div>

    <input ref="fileInput" type="file" accept="image/*,.heic,.heif" style="display: none" @change="handleFileChange" />
    <input ref="batchInput" type="file" accept="image/*,.heic,.heif" multiple style="display: none" @change="handleBatchChange" />
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

.app-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(520px circle at 12% 6%, rgba(244, 114, 182, 0.2), transparent 55%),
    radial-gradient(480px circle at 88% 10%, rgba(250, 204, 21, 0.16), transparent 55%),
    radial-gradient(640px circle at 42% 88%, rgba(168, 85, 247, 0.18), transparent 60%),
    radial-gradient(430px circle at 96% 62%, rgba(16, 185, 129, 0.14), transparent 55%),
    radial-gradient(360px circle at 70% 30%, rgba(244, 114, 182, 0.1), transparent 55%);
}

.result-img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 60vh;
  object-fit: contain;
  border-radius: 8px;
  background: var(--bg-page);
}

.beauty-loading,
.beauty-wait {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}

/* 预览卡标题行：左标题、右历史工具条，预览区保持干净 */
.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.hist-tools {
  display: flex;
  gap: 6px;
}
.hist-tool {
  padding: 4px 10px;
  border: none;
  border-radius: 999px;
  background: var(--primary-light, rgba(244, 114, 182, 0.1));
  color: var(--primary, #f472b6);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  transition: background 0.16s, transform 0.15s, opacity 0.16s;
}
.hist-tool:hover:not(:disabled) {
  background: color-mix(in srgb, var(--primary, #f472b6) 16%, transparent);
}
.hist-tool:active:not(:disabled) {
  transform: scale(0.95);
}
.hist-tool:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  background: var(--bg-page, #f6f7fb);
  color: var(--text-sub, #6b7280);
}

.param-value {
  width: 34px;
  text-align: right;
  font-size: 13px;
  color: var(--text-sub);
  flex-shrink: 0;
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

/* 接力段：与上方参数区划清边界，下方留出空气感，避免和批量卡贴死 */
.next-row {
  margin: 2px 0 8px;
  padding: 16px 2px 0;
  border-top: 1px solid rgba(31, 41, 55, 0.06);
}

/* 桌面：双栏结构与落位走 style.css 的 .tool-page 默认规则，这里只调左右比例 */
@media (min-width: 768px) {
  .page-content.tool-page {
    --pane-left: 1.25fr;
  }
}
</style>
