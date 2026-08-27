import { onMounted, onUnmounted } from 'vue'

/** 全局拖拽丢入图片文件的自定义事件名 */
export const DROP_EVENT = 'app-drop-files'

/**
 * 让当前视图接收从页面任意位置拖入的图片文件。
 * 由 App.vue 在放置区 drop 时统一派发 DROP_EVENT，这里只负责监听。
 */
export function useImageDrop(handler: (files: File[]) => void) {
  const listener = (e: Event) => {
    const ev = e as CustomEvent<File[]>
    const files = ev.detail
    if (files && Array.isArray(files) && files.length) handler(files)
  }
  onMounted(() => window.addEventListener(DROP_EVENT, listener))
  onUnmounted(() => window.removeEventListener(DROP_EVENT, listener))
}
