/**
 * JPEG 元数据搬运
 *
 * canvas 重绘出来的 JPEG 只含像素：拍摄时间、机型、色彩描述在一次导出后全丢，
 * 摄影与存档场景里这是硬伤。这里从源 JPEG 中把 APP1（Exif）与 APP2（ICC Profile）
 * 两段原样取出，插回输出 JPEG 头部 —— 纯字节搬运，不解析字段内容。
 *
 * 唯一的例外是 ICC：Chrome 给 canvas 输出统一附了一段 sRGB 描述，此时再搬源 ICC
 * 会让一张图带两份互相矛盾的色彩描述，所以只在输出自己没有 ICC 时才搬。
 *
 * 另一处必须改的字段是 Orientation：画面在 createImageBitmap 阶段已按 EXIF 转正，
 * 若把 orientation=6 原样带过去，看图软件会在已经正过来的图上再转一次。
 *
 * 注意隐私：EXIF 可能含 GPS。所以这条链路是显式 opt-in 的，默认仍然剥干净。
 */

export interface JpegMetadata {
  /** 完整的 APP1 段（含 FF E1 与长度字段） */
  exif: Uint8Array | null
  /** 完整的 APP2 段（ICC Profile） */
  icc: Uint8Array | null
}

/** JPEG 里没有长度字段的标志：RST 系列、TEM、以及填充字节 FF00 */
function isStandaloneMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x00
}

/** 从源 JPEG 取出 Exif 与 ICC 段；不是 JPEG 或结构不认识时返回空 */
export async function extractJpegMetadata(source: Blob): Promise<JpegMetadata> {
  const empty: JpegMetadata = { exif: null, icc: null }
  const bytes = new Uint8Array(await source.arrayBuffer())
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return empty

  const result: JpegMetadata = { exif: null, icc: null }
  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break
    const marker = bytes[i + 1]
    // SOS 之后是熵编码数据，EOI 之后没有段了
    if (marker === 0xda || marker === 0xd9) break
    if (isStandaloneMarker(marker)) {
      i += 2
      continue
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    // 长度字段含自身两字节，所以小于 2 一定是坏数据
    if (len < 2) break
    const end = i + 2 + len
    if (end > bytes.length) break
    // slice 而不是 subarray：只留这一小段，不把整张源图的字节缓冲挂在手里
    if (marker === 0xe1 && !result.exif) result.exif = bytes.slice(i, end)
    else if (marker === 0xe2 && !result.icc) result.icc = bytes.slice(i, end)
    i = end
  }
  return result
}

/** 就地把 Exif 段里的 Orientation 写成 1（画面已经转正，不能再让看图软件转一次） */
function normalizeOrientation(exif: Uint8Array): void {
  // 段结构：FF E1 + 长度(2) + "Exif\0\0"(6) + TIFF
  const tiffStart = 10
  if (exif.length <= tiffStart + 8) return
  // 'II' = 小端，'MM' = 大端
  const little = exif[tiffStart] === 0x49 && exif[tiffStart + 1] === 0x49
  const dv = new DataView(exif.buffer, exif.byteOffset + tiffStart, exif.byteLength - tiffStart)
  const ifd0 = dv.getUint32(4, little)
  if (ifd0 + 2 > dv.byteLength) return
  const count = dv.getUint16(ifd0, little)
  for (let n = 0; n < count; n++) {
    const entry = ifd0 + 2 + n * 12
    if (entry + 12 > dv.byteLength) return
    if (dv.getUint16(entry, little) !== 0x0112) continue
    // Orientation 是 SHORT，值按字节序落在 4 字节字段的前两字节
    dv.setUint16(entry + 8, 1, little)
    return
  }
}

/** APP2 段是否是 ICC 描述（标识紧跟在 FF Ex + 长度字段之后） */
function isIccProfile(bytes: Uint8Array, segStart: number): boolean {
  const id = 'ICC_PROFILE\0'
  if (segStart + 4 + id.length > bytes.length) return false
  for (let i = 0; i < id.length; i++) {
    if (bytes[segStart + 4 + i] !== id.charCodeAt(i)) return false
  }
  return true
}

/**
 * 扫描输出 JPEG 的头部 APP 段。
 * @returns at 插入点，即头部连续 APP0（JFIF）段的末尾。Exif 规范要求 APP1 紧跟 APP0，
 *          而 Chrome 的编码器会先写一段 sRGB 的 APP2，插到所有 APP 段末尾就取不到机型了
 *          hasIcc 表示编码器自己已经写过 ICC —— Chrome 给 canvas 输出统一附一段 sRGB
 */
function scanOutputHead(bytes: Uint8Array): { at: number; hasIcc: boolean } {
  let i = 2
  let at = 2
  let hasIcc = false
  let inHeadApp0 = true
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break
    const marker = bytes[i + 1]
    if (marker < 0xe0 || marker > 0xef) break
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (len < 2) break
    const end = i + 2 + len
    if (end > bytes.length) break
    if (inHeadApp0) {
      if (marker === 0xe0) at = end
      else inHeadApp0 = false
    }
    if (marker === 0xe2 && isIccProfile(bytes, i)) hasIcc = true
    i = end
  }
  return { at, hasIcc }
}

/**
 * 把源图的 Exif 注入输出 JPEG，输出自己没有色彩描述时再补上源图的 ICC。
 * 只在「输出确实是 JPEG」且「源也是 JPEG」时生效，其余情况原样返回。
 */
export async function withJpegMetadata(output: Blob, source: Blob | null | undefined): Promise<Blob> {
  if (!source || !output.type.includes('jpeg')) return output
  const { exif, icc: sourceIcc } = await extractJpegMetadata(source)
  if (!exif && !sourceIcc) return output
  if (exif) normalizeOrientation(exif)

  const bytes = new Uint8Array(await output.arrayBuffer())
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return output
  const { at, hasIcc } = scanOutputHead(bytes)
  // 一张图只该有一个色彩描述：编码器已经标了 sRGB 就听它的，再塞源 ICC 两份会互相矛盾
  const icc = hasIcc ? null : sourceIcc
  if (!exif && !icc) return output

  const parts: BlobPart[] = [bytes.subarray(0, at)]
  if (exif) parts.push(exif)
  if (icc) parts.push(icc)
  parts.push(bytes.subarray(at))
  return new Blob(parts, { type: 'image/jpeg' })
}

/* ---------------------------------------------------------------------------
 * 拍摄信息读取（仅用于在界面展示，不参与导出）
 *
 * 上面 extractJpegMetadata 是「整段搬运」只取字节不解析；这里才真正读 TIFF/EXIF
 * 的 IFD 字段，把相机、拍摄时间、曝光参数、GPS 等变成人能看懂的文本。
 * 同样只认 JPEG（APP1 段是 Exif），命中不了就返回 null，渲染端据此选择不展示。
 * ------------------------------------------------------------------------- */

export interface ExifInfo {
  /** 拍摄设备品牌 */
  make?: string
  /** 设备型号 */
  model?: string
  /** 拍摄时间（已转成 YYYY-MM-DD HH:MM） */
  datetime?: string
  /** 快门，如 1/200 秒 */
  exposure?: string
  /** 光圈，如 f/2.8 */
  fnumber?: string
  /** ISO 感光度，如 ISO 200 */
  iso?: string
  /** 焦距，如 35mm */
  focalLength?: string
  /** 简短 GPS 坐标，如 N 23.1234° E 113.5678° */
  gps?: string
}

/** Exif 字段 ID */
const T_MAKE = 0x010f
const T_MODEL = 0x0110
const T_DATETIME = 0x0132
const T_EXIF_IFD = 0x8769
const T_GPS_IFD = 0x8825
const T_EXPOSURE = 0x829a
const T_FNUMBER = 0x829d
const T_ISO = 0x8827
const T_DATETIME_ORIG = 0x9003
const T_FOCAL = 0x920a
const T_GPS_LAT_REF = 0x0001
const T_GPS_LAT = 0x0002
const T_GPS_LON_REF = 0x0003
const T_GPS_LON = 0x0004

/** 在指定 IFD 里按 tag 找条目的起始偏移，找不到返回 -1 */
function findEntry(
  dv: DataView,
  little: boolean,
  ifdOffset: number,
  tag: number,
): number {
  if (ifdOffset < 0 || ifdOffset + 2 > dv.byteLength) return -1
  const count = dv.getUint16(ifdOffset, little)
  for (let n = 0; n < count; n++) {
    const entry = ifdOffset + 2 + n * 12
    if (entry + 12 > dv.byteLength) return -1
    if (dv.getUint16(entry, little) === tag) return entry
  }
  return -1
}

/** 读无符号值：按 tag 的实际类型（LONG=4 / SHORT=3 / BYTE=1）取对应宽度 */
function readUint(dv: DataView, little: boolean, base: number, entry: number): number {
  const type = dv.getUint16(entry + 2, little)
  const count = dv.getUint32(entry + 4, little)
  const sizeOf = type === 4 ? 4 : type === 3 ? 2 : 1
  const inline = count * sizeOf <= 4
  const at = inline
    ? entry + 8
    : base + dv.getUint32(entry + 8, little)
  if (type === 4) return dv.getUint32(at, little)
  if (type === 3) return dv.getUint16(at, little)
  return dv.getUint8(at)
}

/** 读 ASCII 字符串（可能是 inline 4 字节内，也可能是偏移指向的缓冲区） */
function readAscii(dv: DataView, little: boolean, base: number, entry: number): string | undefined {
  const count = dv.getUint32(entry + 4, little)
  const off = count <= 4 ? entry + 8 : base + dv.getUint32(entry + 8, little)
  let s = ''
  for (let i = 0; i < count; i++) {
    const c = dv.getUint8(off + i)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  const trimmed = s.trim()
  return trimmed || undefined
}

/** 读 RATIONAL（分子/分母各一个 LONG） */
function readRational(dv: DataView, little: boolean, base: number, entry: number): number {
  const off = base + dv.getUint32(entry + 8, little)
  const num = dv.getUint32(off, little)
  const den = dv.getUint32(off + 4, little)
  return den === 0 ? NaN : num / den
}

/** 快门时间的展示：>1 秒直接写秒，否则写成 1/n */
function formatExposure(s: number): string | undefined {
  if (!Number.isFinite(s) || s <= 0) return undefined
  if (s >= 1) return `${Math.round(s * 10) / 10} 秒`
  const den = Math.round(1 / s)
  return `1/${den} 秒`
}

function formatDate(raw: string): string | undefined {
  // 标准 EXIF 格式 YYYY:MM:DD HH:MM:SS
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})(?::\d{2})?$/)
  if (!m) return raw
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
}

function degreesToDecimal(
  dv: DataView,
  little: boolean,
  base: number,
  dEntry: number,
): number {
  const off = base + dv.getUint32(dEntry + 8, little)
  const deg = dv.getUint32(off, little) / (dv.getUint32(off + 4, little) || 1)
  const min = dv.getUint32(off + 8, little) / (dv.getUint32(off + 12, little) || 1)
  const sec = dv.getUint32(off + 16, little) / (dv.getUint32(off + 20, little) || 1)
  return deg + min / 60 + sec / 3600
}

/** 从 Exif 段（去掉 "Exif\0\0" 头）解析 TIFF 并提取拍摄信息 */
function parseTiff(exifBytes: Uint8Array): ExifInfo | null {
  if (exifBytes.length < 14) return null
  const little = exifBytes[0] === 0x49 && exifBytes[1] === 0x49
  if (!little && !(exifBytes[0] === 0x4d && exifBytes[1] === 0x4d)) return null
  const dv = new DataView(exifBytes.buffer, exifBytes.byteOffset, exifBytes.byteLength)
  const base = 8
  const ifd0 = dv.getUint32(4, little)
  const info: ExifInfo = {}

  info.make = readTagString(dv, little, base, ifd0, T_MAKE)
  info.model = readTagString(dv, little, base, ifd0, T_MODEL)
  const date = readTagString(dv, little, base, ifd0, T_DATETIME)
  if (date) info.datetime = formatDate(date)

  const exifIfd = findEntry(dv, little, ifd0, T_EXIF_IFD)
    ? base + readUint(dv, little, base, findEntry(dv, little, ifd0, T_EXIF_IFD))
    : -1
  if (exifIfd >= 0) {
    const origin = readTagString(dv, little, base, exifIfd, T_DATETIME_ORIG)
    if (origin) info.datetime = formatDate(origin)
    const expEntry = findEntry(dv, little, exifIfd, T_EXPOSURE)
    if (expEntry >= 0) info.exposure = formatExposure(readRational(dv, little, base, expEntry))
    const fEntry = findEntry(dv, little, exifIfd, T_FNUMBER)
    if (fEntry >= 0) {
      const v = readRational(dv, little, base, fEntry)
      if (Number.isFinite(v)) info.fnumber = `f/${Math.round(v * 10) / 10}`
    }
    const isoEntry = findEntry(dv, little, exifIfd, T_ISO)
    if (isoEntry >= 0) info.iso = `ISO ${readUint(dv, little, base, isoEntry)}`
    const focalEntry = findEntry(dv, little, exifIfd, T_FOCAL)
    if (focalEntry >= 0) {
      const v = readRational(dv, little, base, focalEntry)
      if (Number.isFinite(v)) info.focalLength = `${Math.round(v)}mm`
    }
  }

  const gpsIfd = findEntry(dv, little, ifd0, T_GPS_IFD)
    ? base + readUint(dv, little, base, findEntry(dv, little, ifd0, T_GPS_IFD))
    : -1
  if (gpsIfd >= 0) {
    const latEntry = findEntry(dv, little, gpsIfd, T_GPS_LAT)
    const lonEntry = findEntry(dv, little, gpsIfd, T_GPS_LON)
    if (latEntry >= 0 && lonEntry >= 0) {
      const lat = degreesToDecimal(dv, little, base, latEntry)
      const lon = degreesToDecimal(dv, little, base, lonEntry)
      const latRef = readTagString(dv, little, base, gpsIfd, T_GPS_LAT_REF) ?? 'N'
      const lonRef = readTagString(dv, little, base, gpsIfd, T_GPS_LON_REF) ?? 'E'
      const latStr = `${latRef === 'N' ? 'N' : 'S'} ${lat.toFixed(1)}°`
      const lonStr = `${lonRef === 'E' ? 'E' : 'W'} ${lon.toFixed(1)}°`
      info.gps = `${latStr} ${lonStr}`
    }
  }

  return info
}

/** 在某个 IFD 里读 ASCII 字符串字段 */
function readTagString(
  dv: DataView,
  little: boolean,
  base: number,
  ifdOffset: number,
  tag: number,
): string | undefined {
  const entry = findEntry(dv, little, ifdOffset, tag)
  return entry < 0 ? undefined : readAscii(dv, little, base, entry)
}

/** 从一张图片中读出拍摄信息；非 JPEG 或没有 Exif 段时返回 null */
export async function readExifInfo(source: Blob): Promise<ExifInfo | null> {
  if (!source || !source.type.includes('jpeg')) return null
  const bytes = new Uint8Array(await source.arrayBuffer())
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break
    const marker = bytes[i + 1]
    if (marker === 0xda || marker === 0xd9) break
    if (isStandaloneMarker(marker)) {
      i += 2
      continue
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (len < 2) break
    const end = i + 2 + len
    if (end > bytes.length) break
    // APP1 且标识是 "Exif\0\0"（段体从 FF E1 + 长度之后开始，即 i+4）
    const body = i + 4
    if (
      marker === 0xe1 &&
      body + 6 <= end &&
      bytes[body] === 0x45 && bytes[body + 1] === 0x78 && bytes[body + 2] === 0x69 &&
      bytes[body + 3] === 0x66 && bytes[body + 4] === 0x00 && bytes[body + 5] === 0x00
    ) {
      // 去掉 6 字节 "Exif\0\0"，剩下的就是 TIFF 头
      return parseTiff(bytes.subarray(body + 6, end))
    }
    i = end
  }
  return null
}
