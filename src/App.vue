<script setup lang="ts">
import { ref, watch, computed, defineAsyncComponent, onMounted, onUnmounted } from 'vue'
import { DROP_EVENT } from './composables/useImageDrop'
import { aiModel } from './utils/aiModel'
import { formatDuration } from './utils/format'

type ViewName =
  | 'home'
  | 'edit'
  | 'grid'
  | 'watermark'
  | 'removeBg'
  | 'compress'
  | 'merge'
  | 'format'
  | 'collage'
  | 'idPhoto'
  | 'upscale'
  | 'beauty'
  | 'colorReplace'

/* 视图按需拆包：只有真正进入某个工具时才下载它那份代码 */
const HomeView = defineAsyncComponent(() => import('./views/HomeView.vue'))
const ImageEditView = defineAsyncComponent(() => import('./views/ImageEditView.vue'))
const GridSliceView = defineAsyncComponent(() => import('./views/GridSliceView.vue'))
const WatermarkView = defineAsyncComponent(() => import('./views/WatermarkView.vue'))
const BgRemovalView = defineAsyncComponent(() => import('./views/BgRemovalView.vue'))
const ImageCompressView = defineAsyncComponent(() => import('./views/ImageCompressView.vue'))
const CollageView = defineAsyncComponent(() => import('./views/CollageView.vue'))
const FormatConvertView = defineAsyncComponent(() => import('./views/FormatConvertView.vue'))
const IdPhotoView = defineAsyncComponent(() => import('./views/IdPhotoView.vue'))
const SuperResView = defineAsyncComponent(() => import('./views/SuperResView.vue'))
const BeautyView = defineAsyncComponent(() => import('./views/BeautyView.vue'))
const ColorReplaceView = defineAsyncComponent(() => import('./views/ColorReplaceView.vue'))

const VIEW_NAMES: ViewName[] = [
  'home',
  'edit',
  'grid',
  'watermark',
  'removeBg',
  'compress',
  'merge',
  'format',
  'collage',
  'idPhoto',
  'upscale',
  'beauty',
  'colorReplace',
]

/** 各工具的文档标题：分享出去的链接在浏览器历史与标签页里可辨识 */
const TITLES: Record<ViewName, string> = {
  home: '图片工具箱 · 图片不离开你的设备',
  edit: '图片编辑',
  grid: '九宫格切图',
  watermark: '添加水印',
  removeBg: 'AI 抠图',
  compress: '图片压缩',
  merge: '长图拼接',
  format: '图片格式转换',
  collage: '网格拼图',
  idPhoto: '证件照换底色',
  upscale: '超分辨率放大',
  beauty: '美颜修图',
  colorReplace: '局部改色',
}

/** 用 hash 而非 history API：部署在 GitHub Pages 子路径下没有服务端重写，
 *  刷新 /#removeBg 这类真实路径会 404，hash 则始终由同一个 index.html 承接。 */
function hashOf(view: ViewName): string {
  return view === 'home' ? '#/' : `#/${view}`
}

function parseHash(): ViewName {
  const name = decodeURIComponent(location.hash.replace(/^#\/?/, ''))
  return (VIEW_NAMES as string[]).includes(name) ? (name as ViewName) : 'home'
}

const currentView = ref<ViewName>(parseHash())

/** 跨工具流转的图片（如图片编辑 → 其他工具），目标视图消费后清空 */
const transferImage = ref<File | null>(null)

function navigate(view: ViewName, file?: File) {
  if (file) {
    transferImage.value = file
  }
  if (view === 'home') {
    transferImage.value = null
  }
  const target = hashOf(view)
  if (location.hash === target) {
    currentView.value = view
    return
  }
  // 只改 hash，视图切换统一由 hashchange 驱动，保证返回键与地址栏行为一致
  location.hash = target
}

function onHashChange() {
  currentView.value = parseHash()
}

watch(
  currentView,
  (view) => {
    document.title = view === 'home' ? TITLES.home : `${TITLES[view]} · 图片工具箱`
  },
  { immediate: true },
)

// ---- 全局拖拽上传：把图片拖到页面任意位置即可导入当前工具 ----
const isModelDownloading = computed(() => aiModel.stage === 'downloading' || aiModel.stage === 'warming')

const dragDepth = ref(0)
const isDragging = ref(false)

const imageFiles = (list: FileList): File[] => Array.from(list).filter((f) => f.type.startsWith('image/'))

function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragDepth.value++
  isDragging.value = true
}

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
}

function onDragLeave() {
  if (dragDepth.value > 0) dragDepth.value--
  if (dragDepth.value <= 0) isDragging.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragDepth.value = 0
  isDragging.value = false
  const files = e.dataTransfer ? imageFiles(e.dataTransfer.files) : []
  if (!files.length) return
  if (currentView.value === 'home') {
    // 首页拖入：默认进入图片编辑并载入
    navigate('edit', files[0])
    return
  }
  window.dispatchEvent(new CustomEvent<File[]>(DROP_EVENT, { detail: files }))
}

/** 全局粘贴：Ctrl+V 剪贴板图片，直接进入当前工具（首页则进入图片编辑） */
function onPaste(e: ClipboardEvent) {
  const list = e.clipboardData?.files
  if (!list || !list.length) return
  const files = imageFiles(list)
  if (!files.length) return
  if (currentView.value === 'home') {
    navigate('edit', files[0])
    return
  }
  window.dispatchEvent(new CustomEvent<File[]>(DROP_EVENT, { detail: files }))
}

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
  window.addEventListener('paste', onPaste)
  window.addEventListener('hashchange', onHashChange)
  // 无 hash 的首次访问归一化为 #/，让首页也有一个可复制分享的稳定地址
  if (!location.hash) location.replace(`${location.pathname}${location.search}#/`)
})

onUnmounted(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('hashchange', onHashChange)
})
</script>

<style scoped>
/* 视图切换过渡：淡入 + 轻微上移（约 300ms） */
.view-fade-enter-active,
.view-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.view-fade-enter-from {
  opacity: 0;
  transform: translateY(14px);
}

.view-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* 全局拖拽放置遮罩 */
.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(4px);
}
.drop-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 36px 48px;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 20px 60px rgba(79, 110, 247, 0.18);
  color: #4f6ef7;
  font-weight: 600;
  font-size: 16px;
}
.drop-hint svg {
  width: 48px;
  height: 48px;
}

/* 全局模型下载指示条：不拦截点击，切到任何工具都持续可见 */
.model-chip {
  position: fixed;
  left: 50%;
  bottom: calc(18px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 900;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 220px;
  max-width: calc(100vw - 32px);
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(28, 30, 38, 0.9);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
}
.model-chip-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  overflow: hidden;
}
.model-chip-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #4f6ef7, #22d3ee);
  transition: width 0.3s ease;
}
.model-chip-text {
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
}
</style>

<template>
  <div class="app-shell">
    <!-- 视图切换：淡入 + 轻微上移（约 300ms） -->
    <Transition name="view-fade" mode="out-in">
      <HomeView v-if="currentView === 'home'" @navigate="navigate" />
      <ImageEditView
        v-else-if="currentView === 'edit'"
        :incoming-file="transferImage"
        @back="navigate('home')"
        @navigate="navigate"
        @consumed="transferImage = null"
      />
      <GridSliceView
        v-else-if="currentView === 'grid'"
        :incoming-file="transferImage"
        @back="navigate('home')"
        @consumed="transferImage = null"
      />
      <WatermarkView
        v-else-if="currentView === 'watermark'"
        :incoming-file="transferImage"
        @back="navigate('home')"
        @consumed="transferImage = null"
      />
      <BgRemovalView
        v-else-if="currentView === 'removeBg'"
        :incoming-file="transferImage"
        @back="navigate('home')"
        @consumed="transferImage = null"
      />
      <ImageCompressView
        v-else-if="currentView === 'compress'"
        :incoming-file="transferImage"
        @back="navigate('home')"
        @consumed="transferImage = null"
      />
      <CollageView
        v-else-if="currentView === 'merge' || currentView === 'collage'"
        :mode="currentView === 'collage' ? 'grid' : 'merge'"
        @back="navigate('home')"
      />
      <FormatConvertView
        v-else-if="currentView === 'format'"
        :incoming-file="transferImage"
        @back="navigate('home')"
        @consumed="transferImage = null"
      />

      <IdPhotoView
        v-else-if="currentView === 'idPhoto'"
        :incoming-file="transferImage"
        @back="navigate('home')"
        @consumed="transferImage = null"
      />
      <SuperResView
        v-else-if="currentView === 'upscale'"
        :incoming-file="transferImage"
        @back="navigate('home')"
        @consumed="transferImage = null"
      />
      <BeautyView
        v-else-if="currentView === 'beauty'"
        :incoming-file="transferImage"
        @back="navigate('home')"
        @consumed="transferImage = null"
      />
      <ColorReplaceView
        v-else-if="currentView === 'colorReplace'"
        :incoming-file="transferImage"
        @back="navigate('home')"
        @consumed="transferImage = null"
      />
    </Transition>

    <!-- 全局拖拽放置遮罩 -->
    <div v-if="isDragging" class="drop-overlay">
      <div class="drop-hint">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 16V4M7 9l5-5 5 5" />
          <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
        <div>松开鼠标，立即处理图片</div>
      </div>
    </div>

    <!-- 全局模型下载指示：切到任何工具都持续可见，且不拦截操作 -->
    <div v-if="isModelDownloading" class="model-chip">
      <div class="model-chip-track">
        <div class="model-chip-fill" :style="{ width: aiModel.percent + '%' }"></div>
      </div>
      <span class="model-chip-text">
        {{ aiModel.stage === 'warming' ? '初始化 AI 模型…' : '下载 AI 模型' }}
        <template v-if="aiModel.totalMB > 0">
          {{ aiModel.loadedMB.toFixed(1) }} / {{ aiModel.totalMB.toFixed(0) }} MB
        </template>
        <span v-if="aiModel.remainingSeconds != null">
          · 约 {{ formatDuration(aiModel.remainingSeconds * 1000) }}后好
        </span>
      </span>
    </div>
  </div>
</template>
