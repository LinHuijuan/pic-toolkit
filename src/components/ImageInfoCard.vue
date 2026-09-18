<script setup lang="ts">
import { computed } from 'vue'
import type { ExifInfo } from '../utils/exif'

const props = withDefaults(defineProps<{
  /** 源文件对象 */
  file: File | null
  /** 加载后的 bitmap 宽高（空则不显示像素） */
  width?: number | null
  height?: number | null
  /** 额外的拍摄信息（若从源文件读出 EXIF） */
  exif: ExifInfo | null
}>(), {
  width: null,
  height: null,
})

/** 拍摄信息的可读字段 */
const exifEntries = computed<[string, string][]>(() => {
  const info = props.exif
  if (!info) return []
  const map: [string, string][] = []
  if (info.datetime) map.push(['拍摄时间', info.datetime])
  if (info.make && info.model) map.push(['设备', `${info.make} ${info.model}`])
  else if (info.model) map.push(['设备', info.model])
  else if (info.make) map.push(['品牌', info.make])
  if (info.exposure) map.push(['快门', info.exposure])
  if (info.fnumber) map.push(['光圈', info.fnumber])
  if (info.iso) map.push(['感光度', info.iso])
  if (info.focalLength) map.push(['焦距', info.focalLength])
  if (info.gps) map.push(['位置', info.gps])
  return map
})

/** 格式化文件大小（KB/MB） */
const sizeLabel = computed(() => {
  if (!props.file) return ''
  const size = props.file.size
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
})

function guessFormatFromExt(name: string): string {
  const m = name.match(/\.([^.]+)$/)
  if (!m) return 'unknown'
  return m[1].toLowerCase()
}

const formatLabel = computed(() => {
  if (!props.file) return ''
  let mime = props.file.type
  if (mime) {
    // 截去 image/ 前缀
    mime = mime.replace(/^image\//, '').toUpperCase()
    if (mime) return mime
  }
  const ext = guessFormatFromExt(props.file.name)
  return ext ? ext.toUpperCase() : ''
})

const dpiLabel = computed(() => {
  if (!props.width || !props.height) return ''
  // 常见的换算：24 寸屏幕，长边约 59 厘米；以 300 dpi 输出，长边像素约为 6969
  // 这里只提示「如果要以 300 DPI 打印」，不必强制绑定；由工具自行判断
  const longest = Math.max(props.width, props.height)
  const inches = longest / 300
  const cm = (inches * 2.54).toFixed(1)
  return `300dpi 打印约 ${cm} cm`
})

const hasInfo = computed(() => !!props.file || (props.width && props.height))
</script>

<template>
  <div v-if="hasInfo" class="card">
    <div class="card-title">图片信息</div>
    <div class="info-grid">
      <div v-if="file" class="info-row">
        <span class="info-label">文件名</span>
        <span class="info-value">{{ file.name }}</span>
      </div>
      <div v-if="file && sizeLabel" class="info-row">
        <span class="info-label">大小</span>
        <span class="info-value">{{ sizeLabel }}</span>
      </div>
      <div v-if="file && formatLabel" class="info-row">
        <span class="info-label">格式</span>
        <span class="info-value">{{ formatLabel }}</span>
      </div>
      <div v-if="width && height" class="info-row">
        <span class="info-label">像素</span>
        <span class="info-value">{{ width }} × {{ height }}</span>
      </div>
      <div v-if="width && height && dpiLabel" class="info-row">
        <span class="info-label">打印参考</span>
        <span class="info-value">{{ dpiLabel }}</span>
      </div>
    </div>

    <!-- 拍摄信息并入同一张信息卡，避免嵌套卡片 -->
    <template v-if="exifEntries.length">
      <div class="exif-subtitle">拍摄信息</div>
      <div class="info-grid">
        <div v-for="[label, value] in exifEntries" :key="label" class="info-row">
          <span class="info-label">{{ label }}</span>
          <span class="info-value">{{ value }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.info-grid {
  display: flex;
  flex-direction: column;
}

.exif-subtitle {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-sub);
}

.info-row {
  display: flex;
  gap: 16px;
  padding: 4px 0;
  font-size: 13px;
}

.info-row + .info-row {
  border-top: 1px dashed var(--border);
}

.info-label {
  flex: 0 0 68px;
  color: var(--text-sub);
}

.info-value {
  flex: 1;
  color: var(--text-main);
  word-break: break-all;
  line-height: 1.4;
}
</style>