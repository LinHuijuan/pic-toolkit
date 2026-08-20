<script setup lang="ts">
import { ref, computed } from 'vue'
import { loadImageFromFile, downloadCanvas, type LoadedImage } from '../utils/imageLoader'
import { sliceGrid, buildSliceFilename, type SliceResult } from '../utils/gridSlice'

const emit = defineEmits<{ back: [] }>()

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)
const rows = ref(3)
const cols = ref(3)
const gap = ref(0)
const transparent = ref(false)
const slices = ref<SliceResult[]>([])
const gridMode = ref<'3x3' | '2x2' | '3x1' | '1x3' | 'custom'>('3x3')

const GRID_PRESETS = [
  { key: '3x3', label: '3×3', rows: 3, cols: 3 },
  { key: '2x2', label: '2×2', rows: 2, cols: 2 },
  { key: '3x1', label: '3×1', rows: 3, cols: 1 },
  { key: '1x3', label: '1×3', rows: 1, cols: 3 },
] as const

function pickImage() {
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    source.value = await loadImageFromFile(file)
    slices.value = []
    gridMode.value = '3x3'
    doSlice()
  } catch (error) {
    alert(error instanceof Error ? error.message : '图片加载失败')
  } finally {
    input.value = ''
  }
}

function applyPreset(preset: { key: string; rows: number; cols: number }) {
  gridMode.value = preset.key as typeof gridMode.value
  rows.value = preset.rows
  cols.value = preset.cols
  doSlice()
}

function switchToCustom() {
  gridMode.value = 'custom'
}

function doSlice() {
  if (!source.value) return
  try {
    slices.value = sliceGrid(source.value.bitmap, {
      rows: rows.value,
      cols: cols.value,
      gap: gap.value,
      transparent: transparent.value,
    })
  } catch (error) {
    alert(error instanceof Error ? error.message : '切图失败')
  }
}

function saveAll() {
  if (!source.value || slices.value.length === 0) return
  // 浏览器会拦截连续多张下载，逐张触发并提示
  slices.value.forEach((slice, index) => {
    setTimeout(() => {
      downloadCanvas(
        slice.canvas,
        buildSliceFilename(source.value!.name, slice.row, slice.col, rows.value, cols.value),
      )
    }, index * 300)
  })
}

const previewUrls = computed<string[]>(() =>
  slices.value.map((slice) => slice.canvas.toDataURL('image/png')),
)
</script>

<template>
  <div class="app-shell">
    <!-- 顶部导航 -->
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">九宫格切图</div>
    </div>

    <div class="page-content">
      <!-- 未选图状态 -->
      <div v-if="!source" class="empty-state">
        <div class="empty-icon">🔲</div>
        <div>选择一张图片开始切图</div>
        <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择图片</button>
      </div>

      <template v-else>
        <!-- 原图预览 -->
        <div class="card">
          <div class="card-title">原图</div>
          <div class="preview-wrap">
            <img :src="previewUrls[0] ? '' : ''" style="display: none" alt="" />
            <canvas
              :width="source.width"
              :height="source.height"
              style="max-width: 100%; max-height: 220px"
            ></canvas>
          </div>
        </div>

        <!-- 切分设置 -->
        <div class="card">
          <div class="card-title">切分设置</div>
          <div class="seg-control" style="margin-bottom: 12px">
            <div
              v-for="preset in GRID_PRESETS"
              :key="preset.key"
              class="seg-item"
              :class="{ active: gridMode === preset.key }"
              @click="applyPreset(preset)"
            >
              {{ preset.label }}
            </div>
            <div
              class="seg-item"
              :class="{ active: gridMode === 'custom' }"
              @click="switchToCustom"
            >
              自定义
            </div>
          </div>

          <div v-if="gridMode === 'custom'" class="form-row">
            <span class="label">行列数</span>
            <div style="display: flex; align-items: center; gap: 8px">
              <input
                v-model.number="rows"
                type="number"
                min="1"
                max="10"
                style="width: 64px"
                @change="doSlice"
              />
              <span style="color: var(--text-sub)">×</span>
              <input
                v-model.number="cols"
                type="number"
                min="1"
                max="10"
                style="width: 64px"
                @change="doSlice"
              />
            </div>
          </div>

          <div class="form-row">
            <span class="label">块间留白</span>
            <div style="display: flex; align-items: center; gap: 8px">
              <span class="range-val">{{ gap }}px</span>
              <input v-model.number="gap" type="range" min="0" max="30" @change="doSlice" />
            </div>
          </div>

          <div class="form-row">
            <span class="label">透明背景</span>
            <input
              v-model="transparent"
              type="checkbox"
              style="width: 22px; height: 22px; accent-color: var(--primary)"
              @change="doSlice"
            />
          </div>
        </div>

        <!-- 切分结果 -->
        <div class="card">
          <div class="card-title">切分结果（{{ slices.length }} 块）</div>
          <div class="slice-grid" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: `${gap > 0 ? Math.min(gap, 12) : 4}px` }">
            <img
              v-for="(url, index) in previewUrls"
              :key="index"
              :src="url"
              :alt="`第${index + 1}块`"
              class="slice-item"
            />
          </div>
          <p class="tip-text">
            提示：手机浏览器会拦截连续多张下载，点击「保存全部」后请逐张允许；也可以长按图片保存。
          </p>
        </div>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <button class="btn btn-primary" @click="saveAll">保存全部</button>
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
.slice-grid {
  display: grid;
}

.slice-item {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 4px;
  background: #fff;
}
</style>
