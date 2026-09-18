/**
 * 轻提示工具
 * - 在页面底部弹出短暂提示（成功 / 错误 / 普通），自动消失
 * - 替代浏览器 alert，避免打断操作
 * - 同一时刻最多叠 MAX_TOASTS 条：连续报错时新的替换最早的，避免越叠越多把屏幕糊满
 * - 点击任意一条可手动关闭
 */

export type ToastType = 'success' | 'error' | 'info'

const TOAST_DURATION = 2400
/** 同屏最多同时出现的 toast 数 */
const MAX_TOASTS = 3

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
  const c = getContainer()
  // 先加新的，再淘汰最早一条，保证最新提示一定在场
  const el = document.createElement('div')
  el.className = `toast-item toast-${type}`
  el.textContent = message

  let removed = false
  const dismiss = () => {
    if (removed) return
    removed = true
    el.classList.remove('show')
    setTimeout(() => el.remove(), 250)
  }

  el.addEventListener('click', dismiss)
  c.appendChild(el)
  while (c.childElementCount > MAX_TOASTS) {
    const oldest = c.firstElementChild as HTMLElement | null
    if (!oldest) break
    oldest.remove()
  }

  // 触发过渡动画（下一帧再加类，确保初始状态生效）
  requestAnimationFrame(() => {
    el.classList.add('show')
  })
  setTimeout(dismiss, TOAST_DURATION)
}