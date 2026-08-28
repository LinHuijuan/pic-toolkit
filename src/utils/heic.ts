/**
 * HEIC / HEIF 识别与解码
 *
 * iPhone 默认拍照格式就是 HEIC，而 Windows 上的 Chrome / Edge 解不了它；
 * 更麻烦的是这些系统常常根本给不出 MIME —— 靠 file.type 判断会把文件直接挡在门外，
 * 所以「是不是图片」只能看文件头。
 *
 * 两条路径：
 * 1. 原生 createImageBitmap。iOS Safari 与装了 HEVC 扩展的桌面浏览器能直接解，零成本。
 * 2. 兜底动态加载 libheif 解码器（heic2any）。下载的是解码用的代码，图片字节始终留在本机，
 *    与本项目里 onnxruntime / mediapipe 的 wasm 从 CDN 取是同一种做法；
 *    cdn.jsdelivr.net 已在 Service Worker 的缓存规则里，取过一次之后离线也能用。
 */

/** 与 onnxruntime wasm 同一个 CDN，复用已有的 SW 缓存规则 */
const HEIC_DECODER_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm'

/** ISO-BMFF 里属于 HEIF 家族的 brand */
const HEIF_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis',
  'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1',
])

const HEIF_EXT = /\.(heic|heif|heifs|heix|hevx)$/i

/** 读文件头判断是否 HEIC/HEIF：前 8 字节是 ftyp box，brand 落在第 8~11 字节 */
export async function isHeicFile(file: Blob, name = ''): Promise<boolean> {
  if (file.size < 12) return false
  const head = new Uint8Array(await file.slice(4, 12).arrayBuffer())
  const tag = String.fromCharCode(head[0], head[1], head[2], head[3])
  if (tag === 'ftyp') {
    const brand = String.fromCharCode(head[4], head[5], head[6], head[7])
    return HEIF_BRANDS.has(brand)
  }
  // 极少数文件头不规范，退一步按后缀判断
  return HEIF_EXT.test(name)
}

/**
 * HEIC → JPEG。返回可以直接进现有管线的 Blob。
 * 解码器只有真的遇到 HEIC 才会被下载，不影响其它格式的启动开销。
 */
export async function decodeHeic(file: Blob): Promise<Blob> {
  const mod = (await import(/* @vite-ignore */ HEIC_DECODER_URL)) as {
    default?: (input: { blob: Blob; toType: string; toQuality: number }) => Promise<Blob | Blob[]>
  }
  const convert = mod.default
  if (typeof convert !== 'function') {
    throw new Error('HEIC 解码器加载失败，请检查网络后重试')
  }
  const result = await convert({ blob: file, toType: 'image/jpeg', toQuality: 0.92 })
  const jpeg = Array.isArray(result) ? result[0] : result
  if (!jpeg || !jpeg.type.includes('jpeg')) {
    throw new Error('HEIC 解码失败，请在手机上另存为 JPEG 后再试')
  }
  return jpeg
}

/** 面向用户的失败提示：区分「拿不到解码器」和「这张文件解不开」 */
export function heicErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/failed to fetch|networkerror|load failure|import/i.test(message)) {
    return '无法下载 HEIC 解码组件，请检查网络后重试，或先把图片另存为 JPG'
  }
  return `这张 HEIC 图片解不开（${message}），可先在手机上另存为 JPG`
}
