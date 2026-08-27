<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useImageDrop } from '../composables/useImageDrop'
import { prepareAiModel } from '../utils/aiModel'
import {
  loadImageFromFile,
  fileToDataUrl,
  canvasToBlob,
  downloadBlob,
  type LoadedImage,
} from '../utils/imageLoader'
import {
  removeImageBackground,
  composeBackground,
  composeBackgroundImage,
  type RemoveBgProgress,
} from '../utils/removeBg'
import { showToast } from '../utils/toast'
import { fetchSampleFile } from '../utils/sampleImage'
import CompareSlider from '../components/CompareSlider.vue'

const emit = defineEmits<{ back: []; consumed: [] }>()

const props = defineProps<{ incomingFile?: File | null }>()

// 全站拖拽上传：把图片拖到页面任意位置导入当前工具
useImageDrop((files) => {
  if (files[0]) processFile(files[0])
})

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const sourceFileRef = ref<File | null>(null)
const processing = ref(false)
const progress = ref<RemoveBgProgress>({ percent: 0, stage: '' })
const resultUrl = ref('')
const resultBlob = ref<Blob | null>(null)
const bgColor = ref<string | null>(null)
/** 自定义背景图（与纯色互斥，启用时优先） */
const bgImageUrl = ref('')
let bgImageEl: HTMLImageElement | null = null
const bgFileInput = ref<HTMLInputElement | null>(null)
const resultReady = ref(false)

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

// 接收其他工具流转过来的图片（如图片编辑 → 抠图）
onMounted(() => {
  if (props.incomingFile) {
    processFile(props.incomingFile).catch((error) => {
      showToast(error instanceof Error ? error.message : '图片加载失败', 'error')
    })
    emit('consumed')
  }
})

async function startRemove() {
  if (!source.value || processing.value) return
  processing.value = true
  resultReady.value = false
  try {
    const dataUrl = await fileToDataUrl(await sourceFile())
    // 先单独完成模型准备：进度写在共享状态上，用户切去其他工具也不会丢，
    // 不必被这个页面的全屏进度条绑住
    await prepareAiModel()
    const blob = await removeImageBackground(dataUrl, (p) => {
      progress.value = p
    })
    resultBlob.value = blob
    await refreshResult()
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

/** 根据当前背景（背景图/纯色/透明）合成最终结果，刷新预览 */
async function refreshResult() {
  if (!resultBlob.value) return
  const canvas = await composeResult()
  resultUrl.value = canvas.toDataURL('image/png')
}

/** 统一合成入口：背景图优先，其次纯色/透明 */
async function composeResult(): Promise<HTMLCanvasElement> {
  if (!resultBlob.value) throw new Error('暂无抠图结果')
  if (bgImageEl) {
    return composeBackgroundImage(resultBlob.value, bgImageEl)
  }
  return composeBackground(resultBlob.value, bgColor.value)
}

async function changeBg(color: string | null) {
  const needRefresh = !!bgImageEl || bgColor.value !== color
  // 选择纯色/透明时移除自定义背景图
  bgImageUrl.value = ''
  bgImageEl = null
  bgColor.value = color
  if (resultBlob.value && needRefresh) {
    await refreshResult()
  }
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
    if (resultBlob.value) await refreshResult()
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
  if (resultBlob.value) refreshResult()
}

async function saveResult() {
  if (!source.value || !resultBlob.value) return
  const canvas = await composeResult()
  const blob = await canvasToBlob(canvas, 'image/png')
  const suffix = bgColor.value ? '抠图' : '抠图透明背景'
  downloadBlob(blob, `${source.value.name}_${suffix}.png`)
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

          <div v-else-if="resultReady" class="compare-wrap">
            <CompareSlider :before="sourceUrl" :after="resultUrl" before-label="原图" after-label="抠图结果" />
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
    <input
      ref="bgFileInput"
      type="file"
      accept="image/*"
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
  border: 1px solid var(--border-color, #e5e7eb);
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
}
</style>
