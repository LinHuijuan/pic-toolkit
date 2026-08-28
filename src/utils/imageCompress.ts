/**
 * 图片压缩工具
 * - 本地 canvas 重绘压缩，支持质量调节、最长边限制与批量处理
 * - 输出格式可选 智能 / JPEG / WebP：同画质下 WebP 通常再省 25~35%，
 *   且它支持透明，等于给「透明图压不动」这条死路开了一扇窗
 * - 智能模式：含透明像素输出 PNG，否则 JPEG（保持最早的默认行为）
 * - 显式选 JPEG 而图片含透明时仍回退 PNG，因为 JPEG 根本没有 alpha 通道
 */

import { canvasToBlob, isCanvasTranslucent } from './imageLoader'
import { withJpegMetadata } from './exif'

export type CompressFormat = 'auto' | 'jpeg' | 'webp'

type MimeType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface CompressOptions {
  /** 压缩质量 0~1，对 JPEG / WebP 生效 */
  quality: number
  /** 最长边限制（px），超出时等比缩放，不传则不限制尺寸 */
  maxDimension?: number
  /** 输出格式，默认 auto */
  format?: CompressFormat
  /** 传入源图 Blob 则把它的 Exif / ICC 搬进 JPEG 输出（可能含 GPS，由调用方决定是否开启） */
  metadataFrom?: Blob
}

export interface TargetSizeOptions extends Omit<CompressOptions, 'quality'> {
  /** 目标体积（字节） */
  targetBytes: number
}

/** 实际使用的编码器 */
export type EncodedFormat = 'png' | 'jpeg' | 'webp'

export interface CompressResult {
  blob: Blob
  width: number
  height: number
  type: string
  /** 真正使用的编码器（与所选格式不同时说明发生了回退，如透明图无法输出 JPEG） */
  format: EncodedFormat
}

/** WebP 编码在个别浏览器上不可用，探测一次缓存结果 */
let webpEncodable: boolean | null = null

export async function canEncodeWebp(): Promise<boolean> {
  if (webpEncodable !== null) return webpEncodable
  const probe = document.createElement('canvas')
  probe.width = 2
  probe.height = 2
  // 不支持时浏览器会回退成 PNG 或直接失败，两种情况都算不可用
  const blob = await canvasToBlob(probe, 'image/webp', 0.8).catch(() => null)
  webpEncodable = !!blob && blob.type === 'image/webp'
  return webpEncodable
}

/** 把画布缩放重绘到目标最长边 */
function scaleCanvas(bitmap: ImageBitmap, maxDimension: number): HTMLCanvasElement {
  const scale = maxDimension > 0 ? Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height)) : 1
  const targetW = Math.max(1, Math.round(bitmap.width * scale))
  const targetH = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH)
  return canvas
}

/**
 * 决定实际编码格式。
 * 透明像素是唯一的硬约束：JPEG 装不了 alpha，遇到透明只能走 PNG 或 WebP。
 */
async function resolveFormat(
  want: CompressFormat,
  hasAlpha: boolean,
): Promise<{ mime: MimeType; format: EncodedFormat }> {
  if (want === 'webp' && (await canEncodeWebp())) {
    return { mime: 'image/webp', format: 'webp' }
  }
  if (hasAlpha) {
    return { mime: 'image/png', format: 'png' }
  }
  return { mime: 'image/jpeg', format: 'jpeg' }
}

/** 压缩一张 ImageBitmap，返回编码后的 Blob */
export async function compressBitmap(
  bitmap: ImageBitmap,
  options: CompressOptions,
): Promise<CompressResult> {
  const canvas = scaleCanvas(bitmap, options.maxDimension ?? 0)
  const { mime, format } = await resolveFormat(options.format ?? 'auto', isCanvasTranslucent(canvas))
  const raw = await canvasToBlob(canvas, mime, format === 'png' ? 1 : options.quality)
  // 非 JPEG 的输出会在 withJpegMetadata 里原样返回
  const blob = await withJpegMetadata(raw, options.metadataFrom)
  return { blob, width: canvas.width, height: canvas.height, type: mime, format }
}

/**
 * 按目标体积压缩：二分搜索质量，让输出体积最贴近目标。
 * PNG 是无损格式、没有质量旋钮，所以选到 PNG 时直接返回，
 * 由调用方判断是否超限（透明图想压体积请把格式切成 WebP）。
 * @param options.targetBytes 目标体积（字节）
 */
export async function compressToTargetSize(
  bitmap: ImageBitmap,
  options: TargetSizeOptions,
): Promise<CompressResult> {
  const canvas = scaleCanvas(bitmap, options.maxDimension ?? 0)
  const { mime, format } = await resolveFormat(options.format ?? 'auto', isCanvasTranslucent(canvas))
  const { targetBytes } = options

  if (mime === 'image/png') {
    const blob = await canvasToBlob(canvas, 'image/png', 1)
    return { blob, width: canvas.width, height: canvas.height, type: mime, format }
  }

  // 二分搜索质量，8 次迭代精度足够
  let low = 0.05
  let high = 1
  let best: CompressResult | null = null
  for (let i = 0; i < 8; i++) {
    const quality = (low + high) / 2
    const blob = await canvasToBlob(canvas, mime, quality)
    const result: CompressResult = { blob, width: canvas.width, height: canvas.height, type: mime, format }
    if (!best || Math.abs(blob.size - targetBytes) < Math.abs(best.blob.size - targetBytes)) {
      best = result
    }
    if (blob.size > targetBytes) {
      high = quality
    } else {
      low = quality
    }
  }
  const picked: CompressResult =
    best ?? {
      blob: await canvasToBlob(canvas, mime, 0.5),
      width: canvas.width,
      height: canvas.height,
      type: mime,
      format,
    }
  // 元数据是在搜索收敛后才贴上去的，Exif 自带缩略图会让最终体积略高于目标
  picked.blob = await withJpegMetadata(picked.blob, options.metadataFrom)
  return picked
}
