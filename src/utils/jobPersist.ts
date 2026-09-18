/**
 * 长任务「强刷/断线后恢复」的持久化层
 *
 * 把进行中超分 / 抠图 / 证件照 / 美颜的输入文件缓到 IndexedDB，刷新后能接着跑，
 * 不用重新选图、重新调参。针对「缓存会不会越堆越大」的担忧：
 *  - 单槽：每个任务 key 只有一条记录，任务结束（成功/失败）立刻删除；
 *  - 体积上限：输入超过 MAX_PERSIST_BYTES 直接跳过持久化，任务照跑；
 *  - 配额容错：IndexedDB 写不进去（配额满等情况）静默降级，绝不影响主流程；
 *  - 过期清理：超过 TTL 的旧记录在读取时清除，避免残留占空间。
 */

const DB_NAME = 'pic-toolkit'
const STORE = 'pending-jobs'
const DB_VERSION = 1
/** 超过该体积就不持久化（输入很大的任务，刷新后不承诺恢复） */
export const MAX_PERSIST_BYTES = 12 * 1024 * 1024
/** 存太久的记录视为失效，读取时清理 */
const TTL_MS = 4 * 60 * 60 * 1000

interface PendingRecord {
  key: string
  variant: string | null
  file: File
  ts: number
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' })
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

/** 记录一条进行中的任务（单槽覆盖旧记录，超限/写失败则静默跳过） */
export async function savePendingJob(
  key: string,
  file: File,
  variant: string | null,
): Promise<void> {
  if (file.size > MAX_PERSIST_BYTES) return
  await withStore('readwrite', (store) => store.put({ key, variant, file, ts: Date.now() }))
}

/** 删除某任务的持久化记录（任务结束调用） */
export async function clearPendingJob(key: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(key))
}

/** 读取某任务待恢复的输入；顺带清掉过期的记录 */
export async function loadPendingJob(key: string): Promise<PendingRecord | null> {
  const rec = await withStore<PendingRecord>('readonly', (store) => store.get(key))
  if (!rec) return null
  if (Date.now() - rec.ts > TTL_MS) {
    await clearPendingJob(key)
    return null
  }
  return rec
}