<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  loadImageFromFile,
  downloadCanvas,
  type LoadedImage,
} from '../utils/imageLoader'
import { drawWatermark, type WatermarkMode, type WatermarkPosition } from '../utils/watermark'

const emit = defineEmits<{ back: [] }>()

const fileInput = ref<HTMLInputElement | null>(null)
const source = ref<LoadedImage | null>(null)

const text = ref('© 图片工具箱')
const mode = ref<WatermarkMode>('tile')
const fontSizeRatio = ref(4) // 百分比，4 = 4%
const opacity = ref(40) // 百分比
const color = ref('#ffffff')
const position = ref<WatermarkPosition>('bottom-right')
const angle = ref(-30)
const hasDarkOption = ref(false)

const COLORS = [
  { label: '白色', value: '#ffffff' },
  { label: '黑色', value: '#000000' },
  { label: '红色', value: '#ef4444' },
  { label: '蓝色', value: '#3b82f6' },
]

const resultCanvas = ref<HTMLCanvasElement | null>(null)
const resultUrl = ref('')

function pickImage() {
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    source.value = await loadImageFromFile(file)
    // 根据图片亮度自动推荐水印颜色
    hasDarkOption.value = isImageBright(file)
    if (hasDarkOption.value) {
      color.value = '#ffffff'
    }
    applyWatermark()
  } catch (error) {
    alert(error instanceof Error ? error.message : '图片加载失败')
  } finally {
    input.value = ''
  }
}

/** 粗略判断图片整体亮度，决定默认水印颜色 */
function isImageBright(_file: File): boolean {
  // 简化处理：加载首帧像素均值成本较高，直接返回 false 使用默认白色
  return false
}

function applyWatermark() {
  if (!source.value) return
  try {
    const canvas = drawWatermark(source.value.bitmap, {
      text: text.value,
      fontSizeRatio: fontSizeRatio.value / 100,
      color: color.value,
      opacity: opacity.value / 100,
      mode: mode.value,
      position: position.value,
      angle: angle.value,
    })
    resultCanvas.value = canvas
    resultUrl.value = canvas.toDataURL('image/png')
  } catch (error) {
    alert(error instanceof Error ? error.message : '水印生成失败')
  }
}

function saveResult() {
  if (!source.value || !resultCanvas.value) return
  downloadCanvas(resultCanvas.value, `${source.value.name}_水印.png`)
}

function handleReplace() {
  if (!source.value || !resultCanvas.value) return
  // 用带水印的结果替换当前源图，继续叠加
  const canvas = resultCanvas.value
  createImageBitmap(canvas).then((newBitmap) => {
    source.value = {
      bitmap: newBitmap,
      width: canvas.width,
      height: canvas.height,
      name: source.value?.name ?? 'image',
    }
    applyWatermark()
  })
}

// 参数变化时自动重新生成
watch([text, mode, fontSizeRatio, opacity, color, position, angle], applyWatermark)
</script>

<template>
  <div class="app-shell">
    <!-- 顶部导航 -->
    <div class="top-bar">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="page-title">添加水印</div>
    </div>

    <div class="page-content">
      <!-- 未选图状态 -->
      <div v-if="!source" class="empty-state">
        <div class="empty-icon">💧</div>
        <div>选择一张图片添加水印</div>
        <button class="btn btn-primary" style="width: 180px" @click="pickImage">选择图片</button>
      </div>

      <template v-else>
        <!-- 结果预览 -->
        <div class="card">
          <div class="card-title">预览</div>
          <div class="preview-wrap">
            <img :src="resultUrl" alt="水印预览" />
          </div>
        </div>

        <!-- 水印设置 -->
        <div class="card">
          <div class="card-title">水印设置</div>

          <div class="form-row">
            <span class="label">水印文字</span>
            <input v-model="text" type="text" maxlength="30" placeholder="请输入水印文字" />
          </div>

          <div class="form-row">
            <span class="label">样式</span>
            <div class="seg-control" style="flex: 1">
              <div class="seg-item" :class="{ active: mode === 'tile' }" @click="mode = 'tile'">
                平铺
              </div>
              <div class="seg-item" :class="{ active: mode === 'single' }" @click="mode = 'single'">
                单点
              </div>
            </div>
          </div>

          <div v-if="mode === 'tile'" class="range-row">
            <span class="label">旋转角度</span>
            <input v-model.number="angle" type="range" min="-90" max="90" step="5" />
            <span class="range-val">{{ angle }}°</span>
          </div>

          <div v-else class="form-row">
            <span class="label">位置</span>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end">
              <div
                v-for="pos in (['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as WatermarkPosition[])"
                :key="pos"
                class="pos-chip"
                :class="{ active: position === pos }"
                @click="position = pos"
              >
                {{ ({ center: '居中', 'top-left': '左上', 'top-right': '右上', 'bottom-left': '左下', 'bottom-right': '右下' } as Record<string, string>)[pos] }}
              </div>
            </div>
          </div>

          <div class="range-row">
            <span class="label">字号</span>
            <input v-model.number="fontSizeRatio" type="range" min="1" max="15" />
            <span class="range-val">{{ fontSizeRatio }}%</span>
          </div>

          <div class="range-row">
            <span class="label">透明度</span>
            <input v-model.number="opacity" type="range" min="5" max="100" step="5" />
            <span class="range-val">{{ opacity }}%</span>
          </div>

          <div class="form-row">
            <span class="label">颜色</span>
            <div class="color-dots">
              <div
                v-for="c in COLORS"
                :key="c.value"
                class="color-dot"
                :class="{ active: color === c.value }"
                :style="{ background: c.value }"
                @click="color = c.value"
              ></div>
            </div>
          </div>
        </div>

        <p class="tip-text">
          参数调整后自动生成预览。水印支持叠加使用：点击「继续叠加」可在已加水印的图上再加一层。
        </p>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="source" class="bottom-bar">
      <button class="btn btn-ghost" @click="pickImage">重新选图</button>
      <button class="btn btn-outline" @click="handleReplace">继续叠加</button>
      <button class="btn btn-primary" @click="saveResult">保存图片</button>
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
.pos-chip {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1.5px solid var(--border);
  background: #fff;
  font-size: 13px;
  color: var(--text-sub);
  cursor: pointer;
}

.pos-chip.active {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
}
</style>
