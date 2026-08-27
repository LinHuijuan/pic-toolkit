<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { loadImageFromFile, downloadCanvas, type LoadedImage } from '../utils/imageLoader'
import { upscaleImage, SUPER_RESOLUTION_SCALE } from '../utils/superResolution'
import { showToast } from '../utils/toast'
import { fetchSampleFile } from '../utils/sampleImage'

const emit = defineEmits<{ back: []; consumed: [] }>()
const props = defineProps<{ incomingFile?: File | null }>()

useImageDrop((files) => {
  if (files[0]) processFile(files[0])
})

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const resultCanvas = ref<HTMLCanvasElement | null>(null)
const resultUrl = ref('')
const processing = ref(false)
const progress = ref(0)

/** 空状态渐变 SVG 图标（与首页功能卡片风格一致） */
const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="url(#icon-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
const EMPTY_ICON = `<svg ${STROKE}><path d="M12 3.5c3.2 4.2 5.5 7.1 5.5 10a5.5 5.5 0 1 1-11 0c0-2.9 2.3-5.8 5.5-10Z"/><path d="M11 12.5h2"/><path d="m9.5 15.5 2.5 2.5 2.5-2.5"/></svg>`

async function processFile(file: File) {
  try {
    source.value = await loadImageFromFile(file)
    resultCanvas.value = null
    resultUrl.value = ''
    run()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
  }
}

async function run() {
  if (!source.value) return
  processing.value = true
  progress.value = 5
  try {
    const canvas = await upscaleImage(source.value.bitmap, (p) => (progress.value = p))
    resultCanvas.value = canvas
    resultUrl.value = canvas.toDataURL('image/png')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '超分失败，请检查网络后重试（需下载模型）', 'error')
  } finally {
    processing.value = false
  }
}

function pickImage() {
  fileInput.value?.click()
}

async function loadSample() {
  try {
    const file = await fetchSampleFile('scene')
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

function saveResult() {
  if (!source.value || !resultCanvas.value) return
  downloadCanvas(resultCanvas.value, `${source.value.name}_x${SUPER_RESOLUTION_SCALE}.png`)
  showToast('已开始下载', 'success')
}

onMounted(() => {
  if (props.incomingFile) {
    processFile(props.incomingFile).catch(() => showToast('图片加载失败', 'error'))
    emit('consumed')
  }
})
</script>

<template>
  <div class="app-shell">
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">超分辨率</div>
    </div>

    <div class="page-content">
      <div v-if="!source" class="empty-state">
        <div class="empty-icon" v-html="EMPTY_ICON"></div>
        <div>选择一张小图，AI 本地放大提升清晰度</div>
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
              <div class="progress-track"><div class="progress-fill" :style="{ width: progress + '%' }"></div></div>
              <p class="tip-text">AI 正在放大图片… {{ progress }}%</p>
            </div>
            <!-- 完成后显示对比 -->
            <div v-else-if="resultUrl" class="compare-wrap">
              <img :src="resultUrl" alt="超分结果" class="result-img" />
              <p class="tip-text">已放大到原图 {{ SUPER_RESOLUTION_SCALE }} 倍，保存的原图按实际尺寸导出。</p>
            </div>
            <div v-else class="upscale-wait">
              <p class="tip-text">点击「开始超分」进行本地放大</p>
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
      <button class="btn btn-primary" :disabled="!resultUrl || processing" @click="saveResult">
        保存超分图（x{{ SUPER_RESOLUTION_SCALE }}）
      </button>
    </div>

    <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="handleFileChange" />
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

.progress-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.12);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--gradient);
  transition: width 0.25s ease;
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
