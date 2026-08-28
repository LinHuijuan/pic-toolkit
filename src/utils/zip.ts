/**
 * 浏览器内打包 ZIP
 *
 * 批量导出原本靠「每隔几百毫秒连续触发下载」，桌面浏览器会弹拦截、移动端基本必丢，
 * 九宫格切 9 张就是 9 次弹窗。打成一个 zip 一次下载才是可靠出口。
 *
 * 没有引第三方库，原因写在格式选择上：图片本身已经是 JPEG / PNG / WebP 的压缩码流，
 * deflate 再压一遍几乎不省体积，只会白烧 CPU 与内存。所以这里用 store（只存不压），
 * 自己写本地文件头 + 中央目录 + CRC32 三部分。
 */

import { downloadBlob } from './imageLoader'

export interface ZipEntry {
  /** 包内文件名，不能含路径分隔符（重名会自动加序号） */
  name: string
  blob: Blob
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 本地时间转 DOS 时间戳（zip 存的就是这个格式，取错了归档里会显示 1980） */
function dosTime(d: Date): number {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff
}

function dosDate(d: Date): number {
  const year = Math.max(1980, d.getFullYear())
  return (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)
}

/** 压平路径并给重名让路：同名文件塞进同一个包，解压时会被静默覆盖 */
function uniqueName(raw: string, used: Map<string, number>): string {
  const base = (raw || '未命名').replace(/[\\/]/g, '_').replace(/^\.+/, '') || '未命名'
  const seen = used.get(base)
  if (seen === undefined) {
    used.set(base, 1)
    return base
  }
  used.set(base, seen + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? `${base.slice(0, dot)}_${seen}${base.slice(dot)}` : `${base}_${seen}`
}

export async function zipFiles(entries: ZipEntry[], date = new Date()): Promise<Blob> {
  const time = dosTime(date)
  const day = dosDate(date)
  const localParts: BlobPart[] = []
  const centralParts: BlobPart[] = []
  const used = new Map<string, number>()
  // offset 始终指向下一个本地文件头该落的位置，也就是中央目录里的「相对偏移」
  let offset = 0
  let centralSize = 0

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(uniqueName(entry.name, used))
    const size = entry.blob.size
    // 逐张取字节只为算 CRC，算完即撒手：峰值内存等于单张图，而不是整包
    const bytes = new Uint8Array(await entry.blob.arrayBuffer())
    const sum = crc32(bytes)

    // 先建 Uint8Array 再套 DataView：Blob 收的是 ArrayBufferView，而 view.buffer 的类型是 ArrayBufferLike
    const localBuf = new Uint8Array(30)
    const local = new DataView(localBuf.buffer)
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // 解压所需版本 2.0
    local.setUint16(6, 0x0800, true) // 标志位：文件名是 UTF-8
    local.setUint16(8, 0, true) // 压缩方式：store
    local.setUint16(10, time, true)
    local.setUint16(12, day, true)
    local.setUint32(14, sum, true)
    local.setUint32(18, size, true)
    local.setUint32(22, size, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true) // 无扩展字段
    localParts.push(localBuf, nameBytes, entry.blob)

    const centralBuf = new Uint8Array(46)
    const central = new DataView(centralBuf.buffer)
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true) // 打包版本
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint16(10, 0, true)
    central.setUint16(12, time, true)
    central.setUint16(14, day, true)
    central.setUint32(16, sum, true)
    central.setUint32(20, size, true)
    central.setUint32(24, size, true)
    central.setUint16(28, nameBytes.length, true)
    central.setUint16(30, 0, true) // 无扩展字段
    central.setUint16(32, 0, true) // 无注释
    central.setUint16(34, 0, true) // 起始磁盘号
    central.setUint16(36, 0, true) // 内部属性
    central.setUint32(38, 0, true) // 外部属性
    central.setUint32(42, offset, true)
    centralParts.push(centralBuf, nameBytes)

    offset += 30 + nameBytes.length + size
    centralSize += 46 + nameBytes.length
  }

  const eocdBuf = new Uint8Array(22)
  const eocd = new DataView(eocdBuf.buffer)
  eocd.setUint32(0, 0x06054b50, true)
  eocd.setUint16(8, entries.length, true)
  eocd.setUint16(10, entries.length, true)
  eocd.setUint32(12, centralSize, true)
  eocd.setUint32(16, offset, true)

  return new Blob([...localParts, ...centralParts, eocdBuf], { type: 'application/zip' })
}

/** 打包一组文件并直接触发下载（一次下载，不再依赖连续点击的间隔） */
export async function downloadZip(entries: ZipEntry[], filename: string): Promise<void> {
  downloadBlob(await zipFiles(entries), filename)
}

/**
 * 一组产物的统一出口：只有一张就直接下载，多张才打包。
 * 单张图套一层 zip 只会让用户多解一次，反而更麻烦。
 */
export async function saveMany(files: File[], zipName: string): Promise<void> {
  if (files.length === 0) return
  if (files.length === 1) {
    downloadBlob(files[0], files[0].name)
    return
  }
  await downloadZip(
    files.map((file) => ({ name: file.name, blob: file })),
    zipName,
  )
}
