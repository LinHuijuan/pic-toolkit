/**
 * PWA 更新状态
 *
 * 改成 registerType: 'prompt' 后，Service Worker 抓到新版本不会自动接管，
 * 而是停下来等用户决定。这里把「有新版」暴露成响应式状态 + 一个刷新动作，
 * 由全局横幅提示用户点击刷新；离线就绪只在第一次出现时轻轻提一句。
 */
import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import { showToast } from '../utils/toast'

/** 是否已检测到新版本，可供横幅组件驱动显示 */
export const pwaUpdate = ref(false)

let triggerReload: (() => Promise<void>) | null = null

/** 已就绪的新安装，交给横幅按钮调用：让待命 SW 接管并刷新 */
export async function applyPwaUpdate(): Promise<void> {
  if (triggerReload) {
    await triggerReload()
    return
  }
  window.location.reload()
}

/** 在入口调用一次，注册 SW 并监听更新事件 */
export function initPwa(): void {
  triggerReload = registerSW({
    immediate: true,
    onNeedRefresh() {
      pwaUpdate.value = true
    },
    onOfflineReady() {
      showToast('已支持离线使用', 'success')
    },
  }) as unknown as () => Promise<void>
}