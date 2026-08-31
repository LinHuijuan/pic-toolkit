<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, canvasToBlob, canvasToFile, downloadCanvas, type LoadedImage } from '../utils/imageLoader'
import { useAiJob } from '../utils/aiJob'
import { upscaleImage, predictUpscaleOutput, MAX_INPUT_EDGE, SUPER_RESOLUTION_SCALE } from '../utils/superResolution'
import { showToast } from '../utils/toast'
import { formatDuration } from '../utils/format'
import { fetchSmallSampleFile } from '../utils/sampleImage'
import ShareButton from '../components/ShareButton.vue'

const emit = defineEmits<{ back: []; consumed: [] }>()
const props = defineProps<{ incomingFile?: File | null }>()

useImageDrop((files) => {
  if (files[0]) processFile(files[0])
})

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const sourceFileRef = ref<File | null>(null)
const resultCanvas = ref<HTMLCanvasElement | null>(null)
const resultUrl = ref('')
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

onMounted(() => {
  if (props.incomingFile) {
    processFile(props.incomingFile).catch(() => showToast('图片加载失败', 'error'))
    emit('consumed')
    return
  }
  const file = job.input
  if (file && job.status !== 'idle') restoreJob(file).catch(() => showToast('图片加载失败', 'error'))
})

onUnmounted(() => {
  disposed = true
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
})
</script>

<template>
  <div class="app-shell">
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">超分辨率</div>
    </div>

    <div class="page-content tool-page">
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选一张小图（长边 {{ MAX_INPUT_EDGE }}px 内），本地放大 4 倍</div>
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
            <!-- 完成后显示结果 -->
            <div v-else-if="resultUrl && outputInfo" class="compare-wrap">
              <img :src="resultUrl" alt="超分结果" class="result-img" />
              <p class="tip-text">
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
      </template>
    </div>

    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <ShareButton :get-files="resultFiles" variant="outline" :disabled="!resultUrl || processing" />
      <button class="btn btn-primary" :disabled="!resultUrl || processing" @click="saveResult">
        保存超分图{{ outputInfo ? `（x${outputInfo.ratio}）` : '' }}
      </button>
    </div>

    <input ref="fileInput" type="file" accept="image/*,.heic,.heif" style="display: none" @change="handleFileChange" />
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
</style>
