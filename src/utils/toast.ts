/**
 * 轻提示工具
 * - 在页面底部弹出短暂提示（成功 / 错误 / 普通），自动消失
 * - 替代浏览器 alert，避免打断操作
 */

export type ToastType = 'success' | 'error' | 'info'

const TOAST_DURATION = 2400

let container: HTMLDivElement | null = null

function getContainer(): HTMLDivElement {
  if (!container) {
    container = document.createElement('div')
    container.className = 'toast-container'
    document.body.appendChild(container)
  }
  return container
}

/** 弹出轻提示 */
export function showToast(message: string, type: ToastType = 'info'): void {
  const el = document.createElement('div')
  el.className = `toast-item toast-${type}`
  el.textContent = message
  getContainer().appendChild(el)
  // 触发过渡动画（下一帧再加类，确保初始状态生效）
  requestAnimationFrame(() => {
    el.classList.add('show')
  })
  setTimeout(() => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 250)
  }, TOAST_DURATION)
}
