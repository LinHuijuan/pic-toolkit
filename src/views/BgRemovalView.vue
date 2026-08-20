<script setup lang="ts">
import { ref } from 'vue'
import {
  loadImageFromFile,
  fileToDataUrl,
  canvasToBlob,
  downloadBlob,
  type LoadedImage,
} from '../utils/imageLoader'
import { removeImageBackground, composeBackground, type RemoveBgProgress } from '../utils/removeBg'

const emit = defineEmits<{ back: [] }>()

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const processing = ref(false)
const progress = ref<RemoveBgProgress>({ percent: 0, stage: '' })
const resultUrl = ref('')
const resultBlob = ref<Blob | null>(null)
const bgColor = ref<string | null>(null)
const resultReady = ref(false)

const BG_COLORS = [
  { label: '透明', value: null as string | null },
  { label: '白色', value: '#ffffff' },
  { label: '红色', value: '#ef4444' },
  { label: '蓝色', value: '#3b82f6' },
  { label: '绿色', value: '#22c55e' },
]

function pickImage() {
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    source.value = await loadImageFromFile(file)
    refreshSourceUrl()
    resultReady.value = false
    resultUrl.value = ''
    resultBlob.value = null
    await startRemove()
  } catch (error) {
    alert(error instanceof Error ? error.message : '图片加载失败')
  } finally {
    input.value = ''
  }
}

async function startRemove() {
  if (!source.value || processing.value) return
  processing.value = true
  resultReady.value = false
  try {
    const dataUrl = await fileToDataUrl(await sourceFile())
    const blob = await removeImageBackground(dataUrl, (p) => {
      progress.value = p
    })
    resultBlob.value = blob
    await applyBgColor()
    resultReady.value = true
  } catch (error) {
    console.error(error)
    alert('抠图失败，请重试。如首次使用需先下载 AI 模型，请保持网络畅通')
  } finally {
    processing.value = false
  }
}

/** 获取源文件（从 LoadedImage 无法直接还原 File，这里直接再取一次 input 文件） */
async function sourceFile(): Promise<File> {
  const input = fileInput.value
  if (input && input.files && input.files.length > 0) {
    return input.files[0]
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

async function applyBgColor() {
  if (!resultBlob.value) return
  const canvas = await composeBackground(resultBlob.value, bgColor.value)
  resultUrl.value = canvas.toDataURL('image/png')
}

async function changeBg(color: string | null) {
  if (color === bgColor.value) return
  bgColor.value = color
  if (resultBlob.value) {
    await applyBgColor()
  }
}

async function saveResult() {
  if (!source.value || !resultBlob.value) return
  const canvas = await composeBackground(resultBlob.value, bgColor.value)
  const blob = await canvasToBlob(canvas, 'image/png')
  const suffix = bgColor.value ? '抠图' : '抠图透明背景'
  downloadBlob(blob, `${source.value.name}_${suffix}.png`)
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
        <div class="empty-icon">✂️</div>
        <div>选择一张图片，AI 自动去除背景</div>
        <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择图片</button>
        <p class="tip-text" style="max-width: 280px; text-align: center">
          首次使用需下载 AI 模型（约 40MB），之后可离线使用。全程本地处理，图片不会上传。
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

          <div v-else-if="resultReady" class="compare-wrap">
            <div class="compare-item">
              <div class="compare-label">原图</div>
              <div class="preview-wrap">
                <img :src="sourceUrl" alt="原图" />
              </div>
            </div>
            <div class="compare-item">
              <div class="compare-label">抠图结果</div>
              <div class="preview-wrap">
                <img :src="resultUrl" alt="抠图结果" />
              </div>
            </div>
          </div>

          <div v-else class="preview-wrap" style="height: 200px">
            <img :src="sourceUrl" alt="原图" style="max-height: 200px" />
          </div>
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
          <p class="tip-text">透明背景可直接用于贴图、表情包；换色后适合证件照场景。</p>
        </div>

        <p v-if="processing" class="tip-text">AI 识别中，请勿关闭页面…</p>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <button v-if="!resultReady" class="btn btn-primary" :disabled="processing" @click="startRemove">
        {{ processing ? '处理中…' : '开始抠图' }}
      </button>
      <button v-else class="btn btn-primary" @click="saveResult">保存图片</button>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      style="display: none"
      @change="handleFileChange"
    />
  </div>
</template>

<style scoped>
.compare-wrap {
  grid-template-columns: 1fr 1fr;
}
</style>
