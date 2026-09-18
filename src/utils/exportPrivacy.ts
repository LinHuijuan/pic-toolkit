/**
 * 导出隐私偏好：是否在导出时移除拍摄信息（设备、GPS 位置等敏感元数据）。
 * 本工具的导出产物都经过 canvas 重编码，本身就不带原始 EXIF；这里做成一个可开关的默认项，
 * 把「更安全」设为默认并持久化到本地，用户可随时关掉。
 */
import { ref } from 'vue'

const KEY = 'pic-toolkit:strip-exif'

let cached: boolean | null = null

function load(): boolean {
  if (cached !== null) return cached
  try {
    const v = localStorage.getItem(KEY)
    cached = v === null ? true : v !== 'off'
  } catch {
    cached = true
  }
  return cached
}

export const stripExif = ref(load())

export function setStripExif(value: boolean): void {
  stripExif.value = value
  cached = value
  try {
    localStorage.setItem(KEY, value ? 'on' : 'off')
  } catch {
    /* 忽略存储失败 */
  }
}