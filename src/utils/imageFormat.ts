/**
 * 图片格式转换工具
 * - PNG / JPEG / WebP 互转
 * - 透明图片转 JPEG 时自动填充白色背景
 */

import { canvasToBlob, isCanvasTranslucent } from './imageLoader'

export type OutputFormat = 'png' | 'jpeg' | 'webp'

export interface FormatConvertResult {
  blob: Blob
  type: string
  width: number
  height: number
}

const JPEG_QUALITY = 0.92

/** 将一张 ImageBitmap 转换为目标格式，返回编码后的 Blob */
export async function convertImageFormat(
  bitmap: ImageBitmap,
  format: OutputFormat,
): Promise<FormatConvertResult> {
  let canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }
  ctx.drawImage(bitmap, 0, 0)

  let type: string
  let quality: number | undefined
  switch (format) {
    case 'png':
      type = 'image/png'
      break
    case 'jpeg':
      // JPEG 不支持透明通道，先铺白底
      if (isCanvasTranslucent(canvas)) {
        const white = document.createElement('canvas')
        white.width = canvas.width
        white.height = canvas.height
        const whiteCtx = white.getContext('2d')
        if (!whiteCtx) {
          throw new Error('当前浏览器不支持 Canvas 2D')
        }
        whiteCtx.fillStyle = '#ffffff'
        whiteCtx.fillRect(0, 0, white.width, white.height)
        whiteCtx.drawImage(canvas, 0, 0)
        canvas = white
      }
      type = 'image/jpeg'
      quality = JPEG_QUALITY
      break
    case 'webp':
      type = 'image/webp'
      quality = JPEG_QUALITY
      break
  }

  const blob = await canvasToBlob(canvas, type, quality)
  return { blob, type, width: canvas.width, height: canvas.height }
}
