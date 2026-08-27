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
