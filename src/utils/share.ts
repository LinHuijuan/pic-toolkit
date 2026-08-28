/**
 * 系统分享出口
 * - Web Share API 能把图片直接递给微信 / 小红书 / 相册，比「下载 → 回相册 → 再选图」少三步，
 *   也是这类工具在手机上真正的出口；不支持的环境由调用方回退到下载
 * - 分享必须在用户手势的有效窗口内完成，所以调用方应尽早把 Blob 备好，
 *   点击到 navigator.share 之间不要插入长耗时计算
 * - 多张图的另一条出口是打包成 zip（见 utils/zip.ts），逐张触发下载并不可靠
 */

let cachedSupport: boolean | null = null

/** 当前浏览器能否分享图片文件（能力探测，结果缓存） */
export function canShareFiles(): boolean {
  if (cachedSupport !== null) return cachedSupport
  try {
    const probe = new File([new Blob(['0'], { type: 'image/png' })], 'probe.png', { type: 'image/png' })
    cachedSupport =
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [probe] })
  } catch {
    cachedSupport = false
  }
  return cachedSupport
}

export type ShareResult = 'shared' | 'cancelled' | 'unsupported' | 'failed'

/** 把一组图片交给系统分享；用户主动取消不算失败 */
export async function shareFiles(files: File[], title?: string): Promise<ShareResult> {
  if (files.length === 0) return 'failed'
  if (!canShareFiles()) return 'unsupported'
  try {
    await navigator.share({ files, title })
    return 'shared'
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}
