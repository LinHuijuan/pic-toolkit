<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { DROP_EVENT } from './composables/useImageDrop'
import HomeView from './views/HomeView.vue'
import ImageEditView from './views/ImageEditView.vue'
import GridSliceView from './views/GridSliceView.vue'
import WatermarkView from './views/WatermarkView.vue'
import BgRemovalView from './views/BgRemovalView.vue'
import ImageCompressView from './views/ImageCompressView.vue'
import CollageView from './views/CollageView.vue'
import FormatConvertView from './views/FormatConvertView.vue'
import IdPhotoView from './views/IdPhotoView.vue'
import SuperResView from './views/SuperResView.vue'
import BeautyView from './views/BeautyView.vue'
import ColorReplaceView from './views/ColorReplaceView.vue'

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

const currentView = ref<ViewName>('home')

/** 跨工具流转的图片（如图片编辑 → 其他工具），目标视图消费后清空 */
const transferImage = ref<File | null>(null)

function navigate(view: ViewName, file?: File) {
  if (file) {
    transferImage.value = file
  }
  if (view === 'home') {
    transferImage.value = null
  }
  currentView.value = view
}

// ---- 全局拖拽上传：把图片拖到页面任意位置即可导入当前工具 ----
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
})

onUnmounted(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('paste', onPaste)
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
  </div>
</template>
