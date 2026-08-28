<script setup lang="ts">
/**
 * 系统分享按钮
 * 只在浏览器确实能分享图片时渲染，避免给不支持的环境摆一个点了没反应的按钮。
 * 结果文件由调用方通过 getFiles 现取，因此点击到 navigator.share 之间只应有一次导出计算。
 */
import { ref } from 'vue'
import { canShareFiles, shareFiles } from '../utils/share'
import { showToast } from '../utils/toast'

const props = defineProps<{
  getFiles: () => Promise<File[]>
  title?: string
  disabled?: boolean
  variant?: 'primary' | 'ghost' | 'outline'
  label?: string
}>()

/** navigator 的能力不会在运行中变化，创建时判定一次即可 */
const supported = canShareFiles()
const busy = ref(false)

async function onClick() {
  if (busy.value || props.disabled) return
  busy.value = true
  try {
    const result = await shareFiles(await props.getFiles(), props.title)
    if (result === 'shared') showToast('已调起分享', 'success')
    else if (result === 'unsupported') showToast('当前浏览器不支持分享图片，请改用下载', 'error')
    else if (result === 'failed') showToast('分享失败，请改用下载', 'error')
    // cancelled：用户自己关掉了分享面板，不需要提示
  } catch {
    showToast('分享失败，请改用下载', 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button
    v-if="supported"
    class="btn"
    :class="`btn-${variant || 'ghost'}`"
    :disabled="disabled || busy"
    @click="onClick"
  >
    {{ busy ? '准备中…' : label || '分享' }}
  </button>
</template>
