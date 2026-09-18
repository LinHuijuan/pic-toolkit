<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, canvasToBlob, canvasToFile, createPreviewUrl, downloadCanvas, type LoadedImage } from '../utils/imageLoader'
import { saveMany } from '../utils/zip'
import { useAiJob, hydrateJob } from '../utils/aiJob'
import { upscaleImage, predictUpscaleOutput, MAX_INPUT_EDGE, SUPER_RESOLUTION_SCALE } from '../utils/superResolution'
import { showToast } from '../utils/toast'
import { formatDuration } from '../utils/format'
import { fetchSmallSampleFile } from '../utils/sampleImage'
import ShareButton from '../components/ShareButton.vue'
import AiModelBanner from '../components/AiModelBanner.vue'
import CopyButton from '../components/CopyButton.vue'
import CompareSlider from '../components/CompareSlider.vue'
import NextTools from '../components/NextTools.vue'

const emit = defineEmits<{
  back: []
  consumed: []
  navigate: [view: 'compress', file: File]
}>()
const props = defineProps<{ incomingFile?: File | null }>()

useImageDrop((files) => {
  if (files[0]) processFile(files[0])
})

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const sourceFileRef = ref<File | null>(null)
const resultCanvas = ref<HTMLCanvasElement | null>(null)
const resultUrl = ref('')
/** 原图预览（前后对比用），objectURL，切图/卸载时释放 */
const sourceUrl = ref('')
const processing = ref(false)
const job = useAiJob<HTMLCanvasElement>('upscale')
const progress = computed(() => job.percent)
/** 真实输出尺寸与倍率：大图受输出预算约束，实际倍率可能低于模型标称的 x4 */
const outputInfo = ref<{ w: number; h: number; ratio: number; capped: boolean } | null>(null)

/** 选完图就预告真实输出尺寸，不用等跑完才发现被降级 */
const estimate = computed(() => {
  const bitmap = source.value?.bitmap
  return bitmap ? predictUpscaleOutput(bitmap.width, bitmap.height) : null
})

const elapsedMs = computed(() => job.elapsedMs)
let disposed = false
const remainingMs = computed(() => {
  const p = progress.value
  if (!processing.value || p < 15) return null
  return Math.max(0, Math.round((elapsedMs.value / p) * (100 - p)))
})

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><path d="M12 3.5c3.2 4.2 5.5 7.1 5.5 10a5.5 5.5 0 1 1-11 0c0-2.9 2.3-5.8 5.5-10Z"/><path d="M11 12.5h2"/><path d="m9.5 15.5 2.5 2.5 2.5-2.5"/></svg>`

async function processFile(file: File) {
  try {
    sourceFileRef.value = file
    source.value = await loadImageFromFile(file)
    if (sourceUrl.value) {
      URL.revokeObjectURL(sourceUrl.value)
      sourceUrl.value = ''
    }
    sourceUrl.value = await createPreviewUrl(source.value!.bitmap)
    resultCanvas.value = null
    outputInfo.value = null
    if (resultUrl.value) {
      URL.revokeObjectURL(resultUrl.value)
      resultUrl.value = ''
    }
    // 不自动开跑：放大是重计算，必须由用户显式触发
  } catch (error) {
    showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
  }
}

/** 把放大结果落到界面上：跑完与切回来复用同一条路径 */
async function applyResult(canvas: HTMLCanvasElement, bitmap: ImageBitmap) {
  const full = canvas.width >= bitmap.width * SUPER_RESOLUTION_SCALE
  resultCanvas.value = canvas
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = URL.createObjectURL(await canvasToBlob(canvas, 'image/png', 1))
  outputInfo.value = {
    w: canvas.width,
    h: canvas.height,
    ratio: Math.round((canvas.width / bitmap.width) * 10) / 10,
    capped: !full,
  }
}

async function run() {
  if (!source.value || !sourceFileRef.value || processing.value) return
  processing.value = true
  const file = sourceFileRef.value
  const bitmap = source.value.bitmap
  try {
    // 任务本身交给共享登记表：切去别的工具再回来，进度与结果都还在
    const canvas = await job.run(file, (report) => {
      report(5)
      return upscaleImage(bitmap, (p) => report(p))
    })
    if (disposed) return
    await applyResult(canvas, bitmap)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '超分失败，请检查网络后重试（需下载模型）', 'error')
  } finally {
    processing.value = false
  }
}

/** 接着上次离开时的那次放大：在跑就继续显示进度，跑完就直接接回结果 */
async function restoreJob(file: File) {
  sourceFileRef.value = file
  source.value = await loadImageFromFile(file)
  const done = job.result
  if (job.status === 'done' && done) await applyResult(done, source.value.bitmap)
  else if (job.status === 'running') run()
}

function pickImage() {
  fileInput.value?.click()
}

async function loadSample() {
  try {
    const file = await fetchSmallSampleFile('scene', 220)
    await processFile(file)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '示例图加载失败', 'error')
  }
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''
  processFile(file)
}

/** 批量队列：只保留已编码的 File 与预览 URL，画布结果用完即弃，避免多张大图同时驻留内存 */
interface UpscaleBatchItem {
  name: string
  url: string
  blob: Blob
}

/** 一次上限：超分逐张分块推理较重，再多会把等待拖到不友好 */
const MAX_BATCH = 10

const batchInput = ref<HTMLInputElement | null>(null)
const batchItems = ref<UpscaleBatchItem[]>([])
const batchProcessing = ref(false)
const batchDone = ref(0)
const batchTotal = ref(0)
/** 当前那张的推理进度（0~100） */
const batchFilePercent = ref(0)

function clearBatch() {
  batchItems.value.forEach((item) => URL.revokeObjectURL(item.url))
  batchItems.value = []
  batchDone.value = 0
  batchTotal.value = 0
  batchFilePercent.value = 0
}

function pickBatch() {
  batchInput.value?.click()
}

/** 把一组小图逐张放大到 4 倍，全部共用缓存的模型会话 */
async function runUpscaleBatch(files: File[]) {
  if (batchProcessing.value || files.length === 0) return
  const list = files.slice(0, MAX_BATCH)
  if (files.length > list.length) {
    showToast(`一次最多 ${MAX_BATCH} 张，已取前 ${MAX_BATCH} 张`, 'error')
  }
  clearBatch()
  batchProcessing.value = true
  batchTotal.value = list.length
  try {
    for (const file of list) {
      batchFilePercent.value = 0
      try {
        const image = await loadImageFromFile(file)
        try {
          const canvas = await upscaleImage(image.bitmap, (p) => (batchFilePercent.value = p))
          const ratio = Math.round((canvas.width / image.width) * 10) / 10
          const blob = await canvasToBlob(canvas, 'image/png', 1)
          const name = `${image.name}_x${ratio}.png`
          batchItems.value.push({ name, url: URL.createObjectURL(blob), blob })
        } finally {
          image.bitmap.close()
        }
      } catch {
        showToast(`${file.name} 处理失败，已跳过`, 'error')
      }
      batchDone.value++
      // 逐张让出主线程：批量多张时不能把页面锁死
      await new Promise((r) => setTimeout(r, 0))
    }
  } finally {
    batchProcessing.value = false
    batchFilePercent.value = 0
  }
}

function handleBatchChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  runUpscaleBatch(files)
}

async function saveUpscaleBatch() {
  const files = await batchFiles()
  if (files.length === 0) return
  await saveMany(files, '批量超分.zip')
  showToast(files.length > 1 ? '已打包下载' : '已开始下载', 'success')
}

async function batchFiles(): Promise<File[]> {
  return batchItems.value.map((item) => new File([item.blob], item.name, { type: item.blob.type }))
}

async function resultFiles(): Promise<File[]> {
  if (!source.value || !resultCanvas.value) return []
  const ratio = outputInfo.value?.ratio ?? SUPER_RESOLUTION_SCALE
  return [await canvasToFile(resultCanvas.value, `${source.value.name}_x${ratio}.png`)]
}

function saveResult() {
  if (!source.value || !resultCanvas.value) return
  const ratio = outputInfo.value?.ratio ?? SUPER_RESOLUTION_SCALE
  downloadCanvas(resultCanvas.value, `${source.value.name}_x${ratio}.png`)
  showToast('已开始下载', 'success')
}

/** 放大成果直送压缩，把体积压回可传的尺寸 */
const NEXT_CHAIN: { key: 'compress'; label: string }[] = [{ key: 'compress', label: '压体积' }]

async function onPickNext() {
  const [file] = await resultFiles()
  if (!file) {
    showToast('还没有可发送的超分结果', 'error')
    return
  }
  emit('navigate', 'compress', file)
}

onMounted(async () => {
  if (props.incomingFile) {
    processFile(props.incomingFile).catch(() => showToast('图片加载失败', 'error'))
    emit('consumed')
    return
  }
  // 强刷回来先恢复可能进行中的任务，再判断是否要接着跑
  await hydrateJob('upscale')
  const file = job.input
  if (file && job.status !== 'idle') restoreJob(file).catch(() => showToast('图片加载失败', 'error'))
})

onUnmounted(() => {
  disposed = true
  clearBatch()
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
})
</script>

<template>
  <div class="app-shell">
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">超分辨率</div>
    </div>

    <div class="page-content tool-page">
      <AiModelBanner />
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选一张小图（长边 {{ MAX_INPUT_EDGE }}px 内），本地放大 4 倍</div>
        <p class="empty-hint">适合原图偏小或发糊、想放大 4 倍再发出去的场景</p>
        <p class="tip-text">首次需下载 4.9MB 模型，之后离线可用。</p>
        <div class="empty-actions">
          <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择图片</button>
          <button class="btn btn-sample" @click="loadSample">体验示例</button>
        </div>
      </div>

      <template v-else>
        <div class="card">
          <div class="card-title">预览</div>
          <div class="preview-wrap">
            <!-- 处理中显示进度占位 -->
            <div v-if="processing" class="upscale-loading">
              <div class="progress-bar"><div class="progress-inner" :style="{ width: progress + '%' }"></div></div>
              <p class="tip-text">
                AI 正在本地放大… {{ progress }}%（已用 {{ formatDuration(elapsedMs) }}<template v-if="remainingMs !== null">
                  ，约再 {{ formatDuration(remainingMs) }}</template
                >）
              </p>
              <p class="tip-text">分块推理，进度会一块一块推进；切去别的工具也不会打断，回来接着看。</p>
            </div>
            <!-- 完成后显示前后对比 -->
            <div v-else-if="resultUrl && sourceUrl && outputInfo">
              <CompareSlider :before="sourceUrl" :after="resultUrl" before-label="原图" after-label="超分" />
              <p class="tip-text" style="text-align: center; margin-top: 8px">
                已输出 {{ outputInfo.w }} × {{ outputInfo.h }}（较原图 ×{{ outputInfo.ratio }}）。
                <template v-if="outputInfo.capped">源图长边超出预算，为保证速度按 {{ MAX_INPUT_EDGE }}px 上限收敛后再放大。</template>
              </p>
            </div>
            <div v-else-if="estimate" class="upscale-wait">
              <p class="tip-text">
                将输出 {{ estimate.w }} × {{ estimate.h }}（×{{ estimate.ratio }}）
                <template v-if="estimate.shrunk">，源图超过长边预算，已按上限收敛</template>
                。
              </p>
              <p class="tip-text">全程在你的设备上计算，图片不上传。</p>
            </div>
          </div>
          <div class="bottom-inline">
            <button v-if="!processing && !resultUrl" class="btn btn-primary" @click="run">开始超分</button>
          </div>
        </div>

        <!-- 批量：调好模型，一次放大多张小图 -->
        <div class="card">
          <div class="card-title">批量超分</div>
          <p class="tip-text">
            一次给多张小图做同样的 4 倍放大（共用已缓存的模型）；保存全部时多张会打成一个 ZIP。
          </p>
          <button
            class="btn btn-outline"
            style="width: 100%"
            :disabled="batchProcessing"
            @click="pickBatch"
          >
            {{
              batchProcessing
                ? `正在放大 ${batchDone + 1} / ${batchTotal}（单张 ${batchFilePercent}%）…`
                : '选择多张小图'
            }}
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
            <button class="btn btn-primary" @click="saveUpscaleBatch">保存全部</button>
          </div>
        </div>
      </template>
    </div>

    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <ShareButton :get-files="resultFiles" variant="outline" :disabled="!resultUrl || processing" />
      <CopyButton :get-files="resultFiles" variant="outline" :disabled="!resultUrl || processing" />
      <button class="btn btn-primary" :disabled="!resultUrl || processing" @click="saveResult">
        保存超分图{{ outputInfo ? `（x${outputInfo.ratio}）` : '' }}
      </button>
    </div>

    <!-- 超分成果直送压缩 -->
    <div v-if="resultUrl && !processing" class="next-row">
      <NextTools :options="NEXT_CHAIN" @pick="onPickNext" />
    </div>

    <input ref="fileInput" type="file" accept="image/*,.heic,.heif" style="display: none" @change="handleFileChange" />
    <input ref="batchInput" type="file" accept="image/*,.heic,.heif" multiple style="display: none" @change="handleBatchChange" />
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <defs>
        <linearGradient id="icon-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#38bdf8" />
          <stop offset="100%" stop-color="#2563eb" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.app-shell {
  isolation: isolate;
  --primary: #38bdf8;
  --gradient: linear-gradient(135deg, #38bdf8, #2563eb);
  --gradient-soft: linear-gradient(135deg, color-mix(in srgb, #38bdf8 12%, transparent), color-mix(in srgb, #2563eb 14%, transparent));
  --primary-light: color-mix(in srgb, #38bdf8 8%, #fff);
}

.app-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(520px circle at 12% 6%, rgba(56, 189, 248, 0.2), transparent 55%),
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

.upscale-loading,
.upscale-wait {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px 0;
  min-height: 120px;
  justify-content: center;
}

.bottom-inline {
  display: flex;
  justify-content: center;
  margin-top: 12px;
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

.next-row {
  margin-top: 16px;
  padding: 0 2px;
}
</style>
