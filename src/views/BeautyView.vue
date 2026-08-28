<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, downloadCanvas, canvasToFile, type LoadedImage } from '../utils/imageLoader'
import ShareButton from '../components/ShareButton.vue'
import { beautifyImage } from '../utils/imageBeauty'
import { useAiJob } from '../utils/aiJob'
import { showToast } from '../utils/toast'
import { fetchSampleFile } from '../utils/sampleImage'

const emit = defineEmits<{ back: []; consumed: [] }>()
const props = defineProps<{ incomingFile?: File | null }>()

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
    run()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
  }
}

/** 结果上屏时把滑块摆回产出这张图的参数，界面与实际效果不会各说各话 */
function applyResult(result: BeautyResult) {
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

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''
  processFile(file)
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
  if (originUrl.value) URL.revokeObjectURL(originUrl.value)
})
</script>

<template>
  <div class="app-shell">
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">美颜修图</div>
    </div>

    <div class="page-content">
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张人像，AI 本地检测人脸并磨皮提亮</div>
        <div class="empty-actions">
          <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择图片</button>
          <button class="btn btn-sample" @click="loadSample">体验示例</button>
        </div>
      </div>

      <template v-else>
        <div class="card">
          <div class="card-title">预览</div>
          <div class="preview-wrap">
            <div v-if="processing" class="beauty-loading">
              <p class="tip-text">正在检测人脸并美颜…</p>
            </div>
            <template v-else-if="resultUrl">
              <img :src="originUrl" alt="原图" class="result-img" />
              <p class="tip-text">已在本地完成人脸检测与美颜，人物信息不会上传。</p>
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
      </template>
    </div>

    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <ShareButton :get-files="resultFiles" variant="outline" :disabled="!resultUrl || processing" />
      <button class="btn btn-primary" :disabled="!resultUrl || processing" @click="saveResult">保存图片</button>
    </div>

    <input ref="fileInput" type="file" accept="image/*,.heic,.heif" style="display: none" @change="handleFileChange" />
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

.param-value {
  width: 34px;
  text-align: right;
  font-size: 13px;
  color: var(--text-sub);
  flex-shrink: 0;
}

/* 桌面：预览在左、参数在右，与其他工具页的双栏结构保持一致 */
@media (min-width: 768px) {
  .page-content {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
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
}
</style>
