/**
 * 本地存储用量统计与一键清理
 *
 * 站点数据分四块堆着：SW precache（应用壳）、推理资源缓存（onnx / wasm / imgly 分片）、
 * IndexedDB（长任务恢复的临时文件）、localStorage（偏好）。其中前两块会随模型下载、版本
 * 更新持续膨胀，时间久了没人知道占了多大、还能不能清掉。这里给出：
 *  - 各缓存分桶大小（逐个枚举 Cache Storage 的真实占用）；
 *  - 站点总计（交给浏览器自己的 storage.estimate，最准）；
 *  - 一键清空应用缓存（删缓存与临时任务，不动偏好设置）。
 */

/** 每个命名的 Cache 桶：名字与字节数 */
export interface CacheBucket {
  name: string
  size: number
}

export interface StorageStat {
  /** 站点总计占用（含 Cache Storage、IndexedDB、localStorage） */
  totalUsage: number
  /** 站点配额 */
  quota: number
  caches: CacheBucket[]
}

/** 用户语义名词：把 workbox 生成的桶名翻译成看得懂的标签，方便清理判断 */
export function cacheBucketLabel(name: string): string {
  if (name.includes('precache')) return '应用缓存'
  if (name.includes('inference-assets')) return 'AI 推理模型'
  if (name.includes('imgly')) return '抠图模型分片'
  if (name.includes('vendor')) return '第三方依赖'
  return name
}

/** 逐个读每个 Cache 桶里的响应体大小，得到各分桶真实占用 */
async function measureCaches(names: string[]): Promise<CacheBucket[]> {
  const buckets: CacheBucket[] = []
  for (const name of names) {
    const cache = await caches.open(name)
    const requests = await cache.keys()
    let size = 0
    for (const req of requests) {
      const res = await cache.match(req)
      if (!res) continue
      const blob = await res.clone().blob()
      size += blob.size
    }
    buckets.push({ name, size })
  }
  return buckets
}

/** 汇总站点存储用量 */
export async function getStorageStats(): Promise<StorageStat> {
  let cachesAll: string[] = []
  let estimate = { usage: 0, quota: 0 }
  try {
    if (typeof caches !== 'undefined') cachesAll = await caches.keys()
  } catch {
    cachesAll = []
  }
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate()
      estimate = { usage: est.usage ?? 0, quota: est.quota ?? 0 }
    }
  } catch {
    /* estimate 不可用时按缓存枚举兜底 */
  }
  const buckets = await measureCaches(cachesAll)
  const cacheUsage = buckets.reduce((s, b) => s + b.size, 0)
  return {
    // estimate 与逐桶实测可能互相补盲：estimate 归并了 Cache API + IndexedDB + localStorage，
    // 但个别环境（预览/未注册 SW）模型资源走浏览器网络缓存、不纳入 estimate，
    // 这里取其与逐桶实测的较大者，避免把真实占用的几十 MB 显示成个位数而显得「假」。
    totalUsage: Math.max(estimate.usage, cacheUsage),
    quota: estimate.quota || 0,
    caches: buckets,
  }
}

/** 清空应用缓存：删掉所有 Cache Storage，并补掉长任务恢复遗留的 IndexedDB 临时记录 */
export async function clearAppCache(): Promise<number> {
  let freed = 0
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
      freed += names.length
    }
  } catch {
    /* 忽略单个清理失败 */
  }
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('pic-toolkit')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  } catch {
    /* 忽略 */
  }
  return freed
}

/** 字节转可读大小 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`
}