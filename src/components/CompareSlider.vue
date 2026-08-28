<script setup lang="ts">
import { nextTick, onMounted, ref, computed, watch } from 'vue'

/**
 * 前后对比滑条（Before / After 对比）
 * 上层原图通过 clip-path 控制可见宽度，拖动把手即可在原图与结果之间切换。
 * 支持鼠标（pointer 事件）与移动端触摸，兼容触控笔。
 */
const props = defineProps<{
  before: string
  after: string
  beforeLabel?: string
  afterLabel?: string
}>()

/** 分界线位置（0-100，从左到右） */
const pos = ref(50)
const container = ref<HTMLDivElement | null>(null)
const beforeImg = ref<HTMLImageElement | null>(null)
const dragging = ref(false)

/**
 * 容器宽度按图片自身比例算，而不是撑满卡片：
 * 竖图撑满宽度会高出视口，若改用裁切压高度，主体的头就没了 —— 抠图预览最不能接受的正是这个。
 */
const rootStyle = ref<Record<string, string>>({})

function syncRatio() {
  const img = beforeImg.value
  if (!img || !img.naturalWidth || !img.naturalHeight) return
  rootStyle.value = { '--cmp-ratio': String(img.naturalWidth / img.naturalHeight) }
}

onMounted(syncRatio)
watch(() => [props.before, props.after], () => nextTick(syncRatio))

/** 上层原图的裁剪范围：左侧保留 pos，右侧裁掉 (100-pos) */
const beforeStyle = computed(() => ({
  clipPath: `inset(0 ${100 - pos.value}% 0 0)`,
}))

function updatePos(clientX: number) {
  const el = container.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return
  const p = ((clientX - rect.left) / rect.width) * 100
  pos.value = Math.max(0, Math.min(100, p))
}

function onPointerDown(e: PointerEvent) {
  dragging.value = true
  container.value?.setPointerCapture(e.pointerId)
  updatePos(e.clientX)
}

function onPointerMove(e: PointerEvent) {
  if (dragging.value) updatePos(e.clientX)
}

function onPointerUp() {
  dragging.value = false
}
</script>

<template>
  <div
    ref="container"
    class="compare-slider"
    :class="{ dragging }"
    :style="rootStyle"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- 底层：结果图（铺满原图区域，保持比例完整展示） -->
    <img class="cmp-img cmp-after" :src="after" :alt="afterLabel || '结果图'" draggable="false" />
    <!-- 上层：原图（clip-path 控制从左到右露出） -->
    <img
      ref="beforeImg"
      class="cmp-img cmp-before"
      :src="before"
      :alt="beforeLabel || '原图'"
      draggable="false"
      :style="beforeStyle"
      @load="syncRatio"
    />

    <!-- 分界线 + 拖动把手 -->
    <div class="cmp-divider" :style="{ left: pos + '%' }">
      <div class="cmp-handle">
        <span class="cmp-arrow">‹</span>
        <span class="cmp-arrow">›</span>
      </div>
    </div>

    <!-- 标签 -->
    <span class="cmp-tag cmp-tag-before">{{ beforeLabel || '原图' }}</span>
    <span class="cmp-tag cmp-tag-after">{{ afterLabel || '结果' }}</span>

    <!-- 提示 -->
    <span class="cmp-hint">⟷ 拖动对比</span>
  </div>
</template>

<style scoped>
.compare-slider {
  position: relative;
  width: min(100%, calc(var(--cmp-ratio, 1) * 62vh));
  margin: 0 auto;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 4px 16px rgba(31, 41, 55, 0.08);
  line-height: 0;
  cursor: ew-resize;
  /* 透明结果的兜底色：棋盘格 */
  background: repeating-conic-gradient(#f1f3f9 0% 25%, #ffffff 0% 50%) 0 0 / 16px 16px;
}

.compare-slider.dragging {
  cursor: grabbing;
}

/* 结果图：底层，铺满容器保持比例（cover 裁切保证填满） */
.cmp-after {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 原图：上层，正常流撑开容器尺寸，clip-path 控制可见 */
.cmp-before {
  position: relative;
  display: block;
  width: 100%;
  height: auto;
}

.cmp-img {
  pointer-events: none;
}

.cmp-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 2px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 1px rgba(31, 41, 55, 0.1);
  z-index: 3;
}

/* 拖动把手 */
.cmp-handle {
  position: absolute;
  top: 50%;
  left: 0;
  transform: translate(-50%, -50%);
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #ecf0f7;
  box-shadow: 0 3px 10px rgba(31, 41, 55, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
}

.cmp-arrow {
  font-size: 15px;
  font-weight: 700;
  color: #4f6ef7;
  line-height: 1;
}

/* 标签 */
.cmp-tag {
  position: absolute;
  top: 10px;
  z-index: 3;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(31, 41, 55, 0.6);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  backdrop-filter: blur(4px);
}

.cmp-tag-before {
  left: 10px;
}

.cmp-tag-after {
  right: 10px;
  background: rgba(79, 110, 247, 0.82);
}

.cmp-hint {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(31, 41, 55, 0.45);
  color: rgba(255, 255, 255, 0.92);
  font-size: 11px;
  line-height: 1;
  pointer-events: none;
  opacity: 0.85;
}
</style>
