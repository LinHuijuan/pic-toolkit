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
 * 把源图的 Exif / ICC 注入输出 JPEG。
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
