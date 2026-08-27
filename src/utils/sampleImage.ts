/**
 * 内置示例图工具
 * - 提供「体验示例图」能力：拉取打包在 public/examples 下的示例图并转成 File，
 *   走与用户手动选图完全一致的加载链路，降低新用户的上手门槛
 */

export type SampleKind = 'scene' | 'person'

const URLS: Record<SampleKind, string> = {
  scene: `${import.meta.env.BASE_URL}examples/sample-scene.png`,
  person: `${import.meta.env.BASE_URL}examples/sample-person.png`,
}

const NAMES: Record<SampleKind, string> = {
  scene: '示例图片.png',
  person: '示例人像.png',
}

// 同一 kind 的 File 复用，避免重复网络请求
const cache = new Map<SampleKind, File>()

/** 拉取一张内置示例图并转成 File */
export async function fetchSampleFile(kind: SampleKind): Promise<File> {
  const cached = cache.get(kind)
  if (cached) return cached
  const resp = await fetch(URLS[kind])
  if (!resp.ok) {
    throw new Error('示例图加载失败')
  }
  const blob = await resp.blob()
  const file = new File([blob], NAMES[kind], { type: blob.type || 'image/png' })
  cache.set(kind, file)
  return file
}

/** 加载 count 张示例图（交替 scene / person），用于拼接、拼图等多图工具演示 */
export async function fetchSampleFiles(kind: SampleKind, count = 2): Promise<File[]> {
  const files: File[] = []
  for (let i = 0; i < count; i++) {
    // 交替选用两种示例图，让多图结果更有层次
    const k: SampleKind = i % 2 === 0 ? kind : kind === 'scene' ? 'person' : 'scene'
    const f = await fetchSampleFile(k)
    const unique = new File([f], `${i % 2 === 0 ? '示例图片' : '示例人像'}_${i + 1}.png`, {
      type: f.type,
    })
    files.push(unique)
  }
  return files
}

const smallCache = new Map<string, File>()

/**
 * 长边压到 edge 的小图示例。
 * 内置示例图本身是 900×1200 / 1280×800，直接拿来演示超分既不符合"小图放大"的场景，
 * 也会立刻撞上输入预算被降级，所以演示用图需要先缩小。
 */
export async function fetchSmallSampleFile(kind: SampleKind, edge: number): Promise<File> {
  const key = `${kind}-${edge}`
  const cached = smallCache.get(key)
  if (cached) return cached

  const source = await fetchSampleFile(kind)
  const bitmap = await createImageBitmap(source)
  const fit = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * fit))
  const h = Math.max(1, Math.round(bitmap.height * fit))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('示例图处理失败'))), 'image/png'),
  )
  const file = new File([blob], `示例小图_${w}x${h}.png`, { type: 'image/png' })
  smallCache.set(key, file)
  return file
}
