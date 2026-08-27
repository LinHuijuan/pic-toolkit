/**
 * 图片压缩工具
 * - 本地 canvas 重绘压缩，支持质量调节与批量处理
 * - JPEG 应用质量参数；含透明像素的图输出 PNG 保留透明通道
 */

import { canvasToBlob, isCanvasTranslucent } from './imageLoader'

export interface CompressOptions {
  /** 压缩质量 0~1，仅对 JPEG 生效 */
  quality: number
  /** 最长边限制（px），超出时等比缩放，不传则不限制尺寸 */
  maxDimension?: number
}

export interface CompressResult {
  blob: Blob
  width: number
  height: number
  type: string
}

/** 压缩一张 ImageBitmap，返回编码后的 Blob */
export async function compressBitmap(
  bitmap: ImageBitmap,
  options: CompressOptions,
): Promise<CompressResult> {
  // 最长边限制：等比缩小画布，超出部分裁掉
  const maxDim = options.maxDimension ?? 0
  const scale = maxDim > 0 ? Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height)) : 1
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

  const hasAlpha = isCanvasTranslucent(canvas)
  const type = hasAlpha ? 'image/png' : 'image/jpeg'
  const blob = await canvasToBlob(canvas, type, type === 'image/jpeg' ? options.quality : 1)

  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    type,
  }
}

/**
 * 按目标体积压缩（二分搜索质量，仅对 JPEG 有效）
 * 含透明像素的图输出 PNG 为无损格式，无法控制体积，直接返回原结果（调用方需自行判断）
 * @param targetBytes 目标体积（字节）
 * @param maxDimension 最长边限制（px），不传则不限制尺寸
 */
export async function compressToTargetSize(
  bitmap: ImageBitmap,
  targetBytes: number,
  maxDimension?: number,
): Promise<CompressResult> {
  const maxDim = maxDimension ?? 0
  const scale = maxDim > 0 ? Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height)) : 1
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

  // 透明图输出 PNG，无法按体积压缩
  if (isCanvasTranslucent(canvas)) {
    const blob = await canvasToBlob(canvas, 'image/png', 1)
    return { blob, width: targetW, height: targetH, type: 'image/png' }
  }

  // 二分搜索质量，使输出体积最接近目标值（8 次迭代精度足够）
  let low = 0.05
  let high = 1
  let best: CompressResult | null = null
  for (let i = 0; i < 8; i++) {
    const quality = (low + high) / 2
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    const result: CompressResult = { blob, width: targetW, height: targetH, type: 'image/jpeg' }
    if (!best || Math.abs(blob.size - targetBytes) < Math.abs(best.blob.size - targetBytes)) {
      best = result
    }
    if (blob.size > targetBytes) {
      high = quality
    } else {
      low = quality
    }
  }
  return (
    best ?? {
      blob: await canvasToBlob(canvas, 'image/jpeg', 0.5),
      width: targetW,
      height: targetH,
      type: 'image/jpeg',
    }
  )
}
