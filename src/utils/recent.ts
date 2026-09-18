/**
 * 会话内「最近处理」记录。
 *
 * 既驻内存即时响应，也乐观落入 IndexedDB：上次导出的成果在刷新/重开标签后仍能找回重下。
 * 容量上设了总字节上限与过期 TTL，只为不让它悄悄把本地存满；写库失败静默降级为纯内存，
 * 绝不影响导出主流程。
 */

import { ref } from 'vue'

export interface RecentBatch {
  id: number
  /** 该批成果的全部文件：重下时原样再走一遍保存，得到和上次完全一致的结果 */
  files: File[]
  /** 多张打包时用的 zip 名 / 单张时直接复用文件名 */
  zipName: string
  /** 用批次第一张做封面缩略图 */
  coverUrl: string
  count: number
  ts: number
}

const DB_NAME = 'pic-recent'
const STORE = 'batches'
const DB_VERSION = 1
/** 最近记录总占用上限（超出丢最旧），既控内存也控磁盘 */
const MAX_TOTAL_BYTES = 40 * 1024 * 1024
/** 超过该时长视为过期，加载时清理 */
const TTL_MS = 3 * 24 * 60 * 60 * 1000
/** 内存最多保留条数（瓶盖，避免刷新多开缓存堆积） */
const MAX_BATCHES = 8

export const recentBatches = ref<RecentBatch[]>([])

let hydrated = false

interface Row {
  id: number
  files: File[]
  zipName: string
  ts: number
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDb()
  if (!db) return undefined
  return new Promise<T | undefined>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => {
        db.close()
        resolve(req.result)
      }
      req.onerror = () => {
        db.close()
        resolve(undefined)
      }
    } catch {
      db.close()
      resolve(undefined)
    }
  })
}

async function loadRows(): Promise<Row[]> {
  const all = await withStore<Row[]>('readonly', (store) => store.getAll())
  return all ?? []
}

async function saveRow(row: Row): Promise<void> {
  await withStore('readwrite', (store) => store.put(row))
}

async function deleteRow(id: number): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id))
}

async function clearRows(): Promise<void> {
  await withStore('readwrite', (store) => store.clear())
}

/** 用数组里真实的本地字节数做总占用判断，避免拿压缩前的估算说服不了人 */
function totalBytes(files: File[]): number {
  return files.reduce((s, f) => s + f.size, 0)
}

/**
 * 记录一批导出成果。先入内存立即可见，再异步落库；落库前按总字节上限裁剪最旧。
 * 返回首个 id，供调用方可能的自增序号使用。
 */
export function pushRecentBatch(files: File[], zipName: string): void {
  const first = files[0]
  if (!files.length || !first) return

  const id = Date.now()
  // 已入内存的批次整体占用的字节，超过上限时从最旧开始丢弃本地（磁盘）记录
  recentBatches.value.push({
    id,
    files,
    zipName,
    coverUrl: URL.createObjectURL(first),
    count: files.length,
    ts: Date.now(),
  })
  // 先按条数裁内存，再异步按字节裁磁盘
  while (recentBatches.value.length > MAX_BATCHES) {
    const dropped = recentBatches.value.shift()
    if (dropped) URL.revokeObjectURL(dropped.coverUrl)
  }
  void persistWithCap({ id, files, zipName, ts: Date.now() })
}

async function persistWithCap(row: Row): Promise<void> {
  const rows = await loadRows()
  // 合并后总算计：塞不下的从最旧记录（内存也同步处理好对应项）开始丢
  const merged = [row, ...rows]
  let bytes = merged.reduce((s, r) => s + totalBytes(r.files), 0)
  const keep = merged.filter((r) => {
    if (bytes <= MAX_TOTAL_BYTES) return true
    bytes -= totalBytes(r.files)
    dropFromMemory(r.id)
    return false
  })
  for (const r of keep) await saveRow(r)
}

function dropFromMemory(id: number): void {
  const i = recentBatches.value.findIndex((b) => b.id === id)
  if (i >= 0) {
    const [removed] = recentBatches.value.splice(i, 1)
    if (removed) URL.revokeObjectURL(removed.coverUrl)
  }
}

/** 从库恢复最近记录（启动时调用一次）；顺带清掉过期记录 */
export async function hydrateRecent(): Promise<void> {
  if (hydrated) return
  hydrated = true
  const rows = await loadRows()
  if (!rows.length) return
  const now = Date.now()
  const fresh: Row[] = []
  for (const row of rows) {
    if (now - row.ts > TTL_MS) {
      await deleteRow(row.id)
      continue
    }
    fresh.push(row)
  }
  // 按时间倒序（新的在前）重建；同时受条数与字节上限约束
  fresh.sort((a, b) => b.ts - a.ts)
  for (const row of fresh) {
    recentBatches.value.push({
      id: row.id,
      files: row.files,
      zipName: row.zipName,
      coverUrl: URL.createObjectURL(row.files[0]),
      count: row.files.length,
      ts: row.ts,
    })
  }
  trimMemory()
}

function trimMemory(): void {
  while (recentBatches.value.length > MAX_BATCHES) {
    const dropped = recentBatches.value.shift()
    if (dropped) URL.revokeObjectURL(dropped.coverUrl)
  }
}

/** 清空最近记录（内存 + 磁盘） */
export async function clearRecent(): Promise<void> {
  recentBatches.value.forEach((b) => URL.revokeObjectURL(b.coverUrl))
  recentBatches.value = []
  await clearRows()
}