/**
 * 复制到剪贴板出口
 * - 把图片直接写进系统剪贴板，用户可立即粘贴到聊天框 / 文档，比「下载 → 再选择」少两步
 * - 只在浏览器真的支持剪贴板写图片时渲染按钮，不支持的环境由调用方回退到下载
 * - 剪贴板写入对用户手势敏感，调用方应尽早把 File 备好，点击到 write 之间不要插入长耗时计算
 */

let cachedSupport: boolean | null = null

/** 当前浏览器能否把图片写入剪贴板（能力探测，结果缓存） */
export function canCopyImage(): boolean {
  if (cachedSupport !== null) return cachedSupport
  cachedSupport =
    typeof navigator.clipboard?.write === 'function' && typeof ClipboardItem !== 'undefined'
  return cachedSupport
}

export type CopyResult = 'copied' | 'empty' | 'unsupported' | 'failed'

/**
 * 把一组图片中第一张写入剪贴板。
 * 批量导出场景复制意义有限，这里只取首张，语义与「把成品粘到别处」对齐。
 */
export async function copyFilesToClipboard(files: File[]): Promise<CopyResult> {
  if (files.length === 0) return 'empty'
  if (!canCopyImage()) return 'unsupported'
  try {
    const target = files[0]
    await navigator.clipboard.write([new ClipboardItem({ [target.type]: target })])
    return 'copied'
  } catch (error) {
    return 'failed'
  }
}