<script setup lang="ts">
/**
 * 复制到剪贴板按钮
 * 只在浏览器确实能把图片写进剪贴板时渲染，避免给不支持的环境摆一个点了没反应的按钮。
 * 结果文件由调用方通过 getFiles 现取，因此点击到 clipboard.write 之间只应有一次导出计算。
 * label 约定：与分享按钮一致，默认「复制」即可，不要自造文案。
 */
import { ref } from 'vue'
import { canCopyImage, copyFilesToClipboard } from '../utils/clipboard'
import { showToast } from '../utils/toast'

const props = defineProps<{
  getFiles: () => Promise<File[]>
  disabled?: boolean
  variant?: 'primary' | 'ghost' | 'outline'
  label?: string
}>()

/** navigator 的能力不会在运行中变化，创建时判定一次即可 */
const supported = canCopyImage()
const busy = ref(false)

async function onClick() {
  if (busy.value || props.disabled) return
  busy.value = true
  try {
    const result = await copyFilesToClipboard(await props.getFiles())
    if (result === 'copied') showToast('已复制到剪贴板', 'success')
    else if (result === 'unsupported') showToast('当前浏览器不支持复制图片，请改用下载', 'error')
    else if (result === 'failed') showToast('复制失败，请改用下载', 'error')
    else showToast('暂无可复制的结果', 'error')
  } catch {
    showToast('复制失败，请改用下载', 'error')
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
    {{ busy ? '复制中…' : label || '复制' }}
  </button>
</template>