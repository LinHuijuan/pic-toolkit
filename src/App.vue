<script setup lang="ts">
import { ref, watch, computed, defineAsyncComponent, onMounted, onUnmounted } from 'vue'
import { DROP_EVENT } from './composables/useImageDrop'
import { aiModel, prepareAiModel } from './utils/aiModel'
import { stopTrackingBottomBarHeight, trackBottomBarHeight } from './utils/bottomBar'
import { formatDuration } from './utils/format'
import { isImageFile } from './utils/imageLoader'
import PwaUpdateBanner from './components/PwaUpdateBanner.vue'
import { hydrateRecent } from './utils/recent'

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
  | 'exif'
  | 'privacy'

/** 具体工具（不含首页 / 隐私页），用于「返回上一步」接力栈的类型 */
type ToolKey = Exclude<ViewName, 'home' | 'privacy'>

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
const ExifView = defineAsyncComponent(() => import('./views/ExifView.vue'))
const PrivacyView = defineAsyncComponent(() => import('./views/PrivacyView.vue'))

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
  'exif',
  'privacy',
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
  exif: 'EXIF 信息',
  privacy: '隐私说明',
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

/**
 * 跨工具「一条龙」的回退链：记录从哪个工具、带着哪张成品跳过来的，
 * 目标工具点返回时可一步步退回上一个工具，而不只被弹回首页。
 * 栈顶即最近一步。
 */
const relayStack = ref<{ view: ToolKey; file: File }[]>([])

/**
 * 跨工具导航。tool-to-tool 且携带文件时，把来源压入回退栈；
 * record=false 用于从「返回上一步」反向导航，避免把自己再记一笔。
 */
function navigate(view: ViewName, file?: File, record = true) {
  if (
    record &&
    file &&
    view !== 'home' &&
    view !== 'privacy' &&
    currentView.value !== 'home' &&
    currentView.value !== 'privacy' &&
    view !== currentView.value
  ) {
    relayStack.value.push({ view: currentView.value as ToolKey, file })
  }
  if (file) {
    transferImage.value = file
  }
  if (view === 'home') {
    transferImage.value = null
    relayStack.value = []
  }
  const target = hashOf(view)
  if (location.hash === target) {
    currentView.value = view
    return
  }
  // 只改 hash，视图切换统一由 hashchange 驱动，保证返回键与地址栏行为一致
  location.hash = target
}

/** 工具页的「返回」：有接力来源则退回上一步工具（带回它的成品），否则回首页 */
function goBack() {
  const from = relayStack.value.pop()
  if (from) {
    navigate(from.view, from.file, false)
    return
  }
  navigate('home')
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
// 模型下载出错也在底部露一条可重试的错误条，避免在工具页里摸不着头脑（可手动关掉）
const dismissModelError = ref(false)

// 模型下载进度条可手动收起成一枚小胶囊，避免遮挡底部操作栏；错误态始终展示
const modelCollapsed = ref(false)
// 模型指示条可拖动：记录用户拖走的位置（默认居中贴底，拖动后切换到自定义坐标）
const modelPos = ref<{ x: number; y: number } | null>(null)
const modelStyle = computed(() => {
  const p = modelPos.value
  return p ? { left: `${p.x}px`, top: `${p.y}px`, bottom: 'auto', transform: 'none' } : {}
})
function startModelDrag(e: PointerEvent) {
  if (aiModel.stage === 'error') return
  // 以整个指示条为几何基准（手柄只是可抓的把手）
  const chip = (e.currentTarget as HTMLElement).closest('.model-chip') as HTMLElement
  const rect = chip.getBoundingClientRect()
  const offX = e.clientX - rect.left
  const offY = e.clientY - rect.top
  const w = rect.width
  const h = rect.height
  function onMove(ev: PointerEvent) {
    modelPos.value = {
      x: Math.min(window.innerWidth - w, Math.max(0, ev.clientX - offX)),
      y: Math.min(window.innerHeight - h, Math.max(0, ev.clientY - offY)),
    }
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function retryModel() {
  dismissModelError.value = false
  prepareAiModel().catch(() => {})
}

// ---- PWA 安装引导：beforeinstallprompt 触发时低调提示一次，点「安装」才弹原生确认 ----
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}
const INSTALL_DISMISS_KEY = 'pwa-install-dismissed'
const installPrompt = ref<BeforeInstallPromptEvent | null>(null)
const showInstallHint = ref(false)
const installDismissed = ref(() => localStorage.getItem(INSTALL_DISMISS_KEY) === '1')

function onBeforeInstallPrompt(e: Event) {
  e.preventDefault()
  installPrompt.value = e as BeforeInstallPromptEvent
  // 「暂时不要」过的用户不再烦
  if (!installDismissed.value()) showInstallHint.value = true
}

async function acceptInstall() {
  const evt = installPrompt.value
  if (!evt) return
  showInstallHint.value = false
  try {
    await evt.prompt()
    await evt.userChoice
  } catch {
    /* 浏览器拒绝展开时静默收起 */
  }
  installPrompt.value = null
}

function dismissInstall() {
  showInstallHint.value = false
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, '1')
  } catch {
    /* 忽略存储失败 */
  }
}

const dragDepth = ref(0)
const isDragging = ref(false)

const imageFiles = (list: FileList): File[] => Array.from(list).filter(isImageFile)

function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragDepth.value++
  isDragging.value = true
}

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
}

function resetDragOverlay() {
  dragDepth.value = 0
  isDragging.value = false
}

function onDragLeave(e: DragEvent) {
  // 只有真正把文件拖出页面才退出拖拽态；在子元素间穿过时 dragleave 也会触发，
  // 但 relatedTarget 仍在文档内，此时只做递减、不归零，避免遮罩卡在「松手还在」。
  const leavingWindow = !e.relatedTarget || !(e.relatedTarget instanceof Node) || !document.documentElement.contains(e.relatedTarget)
  if (leavingWindow) {
    resetDragOverlay()
  } else if (dragDepth.value > 0) {
    dragDepth.value--
    if (dragDepth.value <= 0) isDragging.value = false
  }
}

/** 拖拽期间窗口失焦（切走应用 / Alt+Tab）也把遮罩收掉，避免一直挂着 */
function onWindowBlur() {
  if (isDragging.value) resetDragOverlay()
}

/** Esc 取消当前拖拽遮罩 */
function onKeydownDrag(e: KeyboardEvent) {
  if (e.key === 'Escape' && isDragging.value) {
    resetDragOverlay()
    e.preventDefault()
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  resetDragOverlay()
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
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('keydown', onKeydownDrag)
  window.addEventListener('hashchange', onHashChange)
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  // 无 hash 的首次访问归一化为 #/，让首页也有一个可复制分享的稳定地址
  if (!location.hash) location.replace(`${location.pathname}${location.search}#/`)
  trackBottomBarHeight()
  // 恢复上次会话的「最近处理」记录（IndexedDB 里有才重建，失败静默）
  void hydrateRecent()
})

onUnmounted(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('keydown', onKeydownDrag)
  window.removeEventListener('hashchange', onHashChange)
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  stopTrackingBottomBarHeight()
})
</script>

<style scoped>
/* 视图切换过渡：淡入 + 轻微上移 + 极微缩放（约 280ms），进入节奏更连贯 */
.view-fade-enter-active,
.view-fade-leave-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}

.view-fade-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.995);
}

.view-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* 全局拖拽放置遮罩：淡入 + 内卡缩放弹入，提示携带当前工具名 */
.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(480px circle at 20% 20%, rgba(79, 110, 247, 0.16), transparent 55%),
    radial-gradient(420px circle at 80% 30%, rgba(139, 92, 246, 0.14), transparent 55%),
    rgba(248, 249, 255, 0.78);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  animation: drop-fade 0.22s ease;
}
@keyframes drop-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.drop-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 36px 48px;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 20px 60px rgba(79, 110, 247, 0.2);
  color: #4f6ef7;
  font-weight: 600;
  font-size: 15px;
  text-align: center;
  animation: drop-pop 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes drop-pop {
  from { opacity: 0; transform: scale(0.94) translateY(6px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.drop-hint svg {
  width: 48px;
  height: 48px;
}
.drop-hint-name {
  font-size: 13px;
  font-weight: 500;
  color: #6b7280;
}
.drop-hint-name b {
  color: #4f6ef7;
  font-weight: 600;
}

/* 全局模型下载指示条：不拦截点击，切到任何工具都持续可见 */
.model-chip {
  position: fixed;
  left: 50%;
  bottom: calc(18px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 900;
  /* 下载态纯展示不拦截点击；出错态需要点按钮，但整条仍不遮断页面 */
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

.model-chip.is-error {
  pointer-events: auto;
  background: rgba(51, 42, 42, 0.95);
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

/* 收起态：收成一枚小胶囊，只留百分比，点开恢复详情 */
.model-chip.is-collapsed {
  min-width: 0;
  padding: 7px 12px;
}

/* 拖动把手：悬在指示条上沿，可抓取移开（指示条本体不拦截点击，把手启用指针） */
.model-chip-grip {
  position: absolute;
  top: -10px;
  right: 10px;
  pointer-events: auto;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  font-size: 14px;
  line-height: 1;
  padding: 2px 5px;
  cursor: grab;
  touch-action: none;
}
.model-chip-grip:active {
  cursor: grabbing;
}
.model-chip-grip:hover {
  color: #fff;
}

/* 收起按钮：缩成 × 放右上角 */
.model-chip-collapse {
  position: absolute;
  top: 5px;
  right: 8px;
  pointer-events: auto;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-size: 15px;
  line-height: 1;
  padding: 2px 3px;
  cursor: pointer;
}
.model-chip-collapse:hover {
  color: #fff;
}

/* 收起态展开按钮 */
.model-chip-expand {
  pointer-events: auto;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  padding: 2px 6px;
  cursor: pointer;
}
.model-chip-expand:hover {
  color: #dbeafe;
}

/* 出错态：可点按钮 */
.model-chip-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  color: #fecaca;
  font-size: 12px;
  line-height: 1.5;
}

.model-chip-actions {
  display: flex;
  gap: 8px;
}

.chip-btn {
  pointer-events: auto;
  padding: 4px 12px;
  border: none;
  border-radius: 999px;
  background: #fff;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.chip-btn--ghost {
  background: transparent;
  color: #fca5a5;
  border: 1px solid rgba(255, 255, 255, 0.35);
}

/* PWA 可安装提示条：吸顶通栏，色弱不打扰，一次可永久关闭 */
.install-hint {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 920;
  width: min(560px, calc(100vw - 24px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 9px 14px;
  border-radius: 999px;
  background: rgba(28, 30, 38, 0.88);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.install-hint-text {
  color: #fff;
  font-size: 13px;
  line-height: 1.3;
}

.install-hint-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.install-hint-btn {
  pointer-events: auto;
  padding: 4px 12px;
  border: none;
  border-radius: 999px;
  background: #fff;
  color: #1c1e26;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.install-hint-btn--ghost {
  background: transparent;
  color: #d1d5db;
  border: 1px solid rgba(255, 255, 255, 0.28);
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
        @back="goBack"
        @navigate="navigate"
        @consumed="transferImage = null"
      />
      <GridSliceView
        v-else-if="currentView === 'grid'"
        :incoming-file="transferImage"
        @back="goBack"
        @navigate="navigate"
        @consumed="transferImage = null"
      />
      <WatermarkView
        v-else-if="currentView === 'watermark'"
        :incoming-file="transferImage"
        @back="goBack"
        @navigate="navigate"
        @consumed="transferImage = null"
      />
      <BgRemovalView
        v-else-if="currentView === 'removeBg'"
        :incoming-file="transferImage"
        @back="goBack"
        @navigate="navigate"
        @consumed="transferImage = null"
      />
      <ImageCompressView
        v-else-if="currentView === 'compress'"
        :incoming-file="transferImage"
        @back="goBack"
        @navigate="navigate"
        @consumed="transferImage = null"
      />
      <CollageView
        v-else-if="currentView === 'merge' || currentView === 'collage'"
        :mode="currentView === 'collage' ? 'grid' : 'merge'"
        @back="goBack"
        @navigate="navigate"
      />
      <FormatConvertView
        v-else-if="currentView === 'format'"
        :incoming-file="transferImage"
        @back="goBack"
        @navigate="navigate"
        @consumed="transferImage = null"
      />

      <IdPhotoView
        v-else-if="currentView === 'idPhoto'"
        :incoming-file="transferImage"
        @back="goBack"
        @navigate="navigate"
        @consumed="transferImage = null"
      />
      <SuperResView
        v-else-if="currentView === 'upscale'"
        :incoming-file="transferImage"
        @back="goBack"
        @navigate="navigate"
        @consumed="transferImage = null"
      />
      <BeautyView
        v-else-if="currentView === 'beauty'"
        :incoming-file="transferImage"
        @back="goBack"
        @navigate="navigate"
        @consumed="transferImage = null"
      />
      <ColorReplaceView
        v-else-if="currentView === 'colorReplace'"
        :incoming-file="transferImage"
        @back="goBack"
        @navigate="navigate"
        @consumed="transferImage = null"
      />
      <ExifView
        v-else-if="currentView === 'exif'"
        :incoming-file="transferImage"
        @back="goBack"
        @consumed="transferImage = null"
        @navigate="navigate"
      />
      <PrivacyView v-else-if="currentView === 'privacy'" @back="goBack" />
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
        <div v-if="currentView === 'home'">松开鼠标，开始处理图片</div>
        <template v-else>
          <div>松开鼠标，立即处理图片</div>
          <div class="drop-hint-name">将导入 <b>{{ TITLES[currentView] }}</b></div>
        </template>
      </div>
    </div>

    <!-- 全局模型下载指示：切到任何工具都持续可见，且不拦截操作；可拖动移开，也可收成小胶囊避免遮挡底部按钮 -->
    <div
      v-if="isModelDownloading || (aiModel.stage === 'error' && !dismissModelError)"
      class="model-chip"
      :class="{ 'is-error': aiModel.stage === 'error', 'is-collapsed': modelCollapsed }"
      :style="modelStyle"
    >
      <template v-if="aiModel.stage !== 'error'">
        <button class="model-chip-grip" aria-label="拖动移开" @pointerdown="startModelDrag">⠿</button>
        <template v-if="!modelCollapsed">
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
          <button class="model-chip-collapse" aria-label="收起" @click="modelCollapsed = true">×</button>
        </template>
        <template v-else>
          <button class="model-chip-expand" @click="modelCollapsed = false">
            AI 模型 {{ aiModel.percent }}% ▸
          </button>
        </template>
      </template>
      <template v-else>
        <div class="model-chip-error">
          <span>{{ aiModel.message }}</span>
          <div class="model-chip-actions">
            <button class="chip-btn" @click="retryModel">重试</button>
            <button class="chip-btn chip-btn--ghost" @click="dismissModelError = true">知道了</button>
          </div>
        </div>
      </template>
    </div>

    <!-- 反馈 / 最近处理入口已收进各页面底部，不再悬浮遮挡内容 -->

    <!-- PWA 可安装提示：低调通栏条，可能立即关掉且不再出现 -->
    <Transition name="view-fade">
      <div v-if="showInstallHint" class="install-hint">
        <span class="install-hint-text">可安装到桌面，离线也能用</span>
        <div class="install-hint-actions">
          <button class="install-hint-btn" @click="acceptInstall">安装</button>
          <button class="install-hint-btn install-hint-btn--ghost" @click="dismissInstall">暂时不要</button>
        </div>
      </div>
    </Transition>

    <!-- 有新版时出现的刷新横幅 -->
    <PwaUpdateBanner />
  </div>
</template>
