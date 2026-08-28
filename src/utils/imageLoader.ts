/**
 * 图片加载与导出工具
 * - 使用 createImageBitmap 加载，自动处理手机拍照的 EXIF 方向
 * - HEIC / HEIF 按文件头识别（Windows 上常常没有 MIME），原生解不动时走 libheif 兜底
 * - 提供 canvas → Blob → 下载 的导出链路
 */

import { decodeHeic, isHeicFile, heicErrorMessage } from './heic'

export interface LoadedImage {
  bitmap: ImageBitmap
  width: number
  height: number
  name: string
}

/** MIME 说不上话时（Windows 对 HEIC 常给空串）按后缀放行 */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg|avif|tiff?|heic|heif|heifs)$/i

/** 是否按图片处理：MIME 或后缀任一命中 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXT.test(file.name)
}

/** 从 File 加载图片（自动纠正手机拍照方向） */
export async function loadImageFromFile(file: File): Promise<LoadedImage> {
  const heic = await isHeicFile(file, file.name)
  if (!heic && !isImageFile(file)) {
    throw new Error('请选择图片文件')
  }

  let bitmap: ImageBitmap
  try {
    // imageOrientation: 'from-image' 自动应用 EXIF 方向，解决手机拍照旋转问题
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (error) {
    if (!heic) {
      console.error(error)
      throw new Error('无法解码这张图片，请确认文件完整或另存为 JPG / PNG')
    }
    try {
      bitmap = await createImageBitmap(await decodeHeic(file), { imageOrientation: 'from-image' })
    } catch (decodeError) {
      console.error(decodeError)
      throw new Error(heicErrorMessage(decodeError))
    }
  }

  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    name: file.name.replace(/\.[^.]+$/, ''),
  }
}

function readAsDataUrl(source: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(source)
  })
}

/**
 * 图片 → DataURL（用于 @imgly/background-removal 抠图与自定义背景图输入）
 * 输入方（<img> / 模型内部的 createImageBitmap）在 Windows 上一样解不动 HEIC，
 * 所以这里先本地转成 JPEG；解码组件拿不到时退回原文件，
 * 让 iOS Safari 这类原生支持 HEIC 的环境仍然走得通。
 */
export async function fileToDataUrl(file: File): Promise<string> {
  if (await isHeicFile(file, file.name)) {
    try {
      return await readAsDataUrl(await decodeHeic(file))
    } catch {
      /* 退回原文件 */
    }
  }
  return readAsDataUrl(file)
}

/** ImageBitmap → canvas */
export function bitmapToCanvas(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }
  ctx.drawImage(bitmap, 0, 0)
  return canvas
}

/** canvas → Blob */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality = 1,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('图片导出失败'))
        }
      },
      type,
      quality,
    )
  })
}

/**
 * 检测画布是否含透明像素（3×3 网格分散抽样，覆盖中部区域，避免透明区在画面中间时被漏检）
 * 用于决定输出格式：含透明像素时需用 PNG / WebP，否则可安全输出 JPEG
 */
export function isCanvasTranslucent(canvas: HTMLCanvasElement): boolean {
  const w = canvas.width
  const h = canvas.height
  if (w === 0 || h === 0) return false
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  // 按 3×3 网格取采样区块，每块读取其左上角一个小方块的 alpha 通道
  const grid = 3
  const block = 32
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      const cx = Math.round(((c + 0.5) / grid) * w)
      const cy = Math.round(((r + 0.5) / grid) * h)
      const sx = Math.max(0, Math.min(cx - block / 2, w - block))
      const sy = Math.max(0, Math.min(cy - block / 2, h - block))
      const sw = Math.min(block, w - sx)
      const sh = Math.min(block, h - sy)
      const data = ctx.getImageData(sx, sy, sw, sh).data
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 250) return true
      }
    }
  }
  return false
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 延迟释放，确保下载已触发
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** canvas 直接下载（用 toBlob 避免大图转 DataURL 导致内存翻倍） */
export async function downloadCanvas(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await canvasToBlob(canvas, 'image/png')
  downloadBlob(blob, filename)
}

/**
 * canvas → File
 * Web Share API 只接受 File（需要文件名与 MIME），导出前先物料化成 File 才能分享
 */
export async function canvasToFile(
  canvas: HTMLCanvasElement,
  filename: string,
  type = 'image/png',
  quality = 1,
): Promise<File> {
  const blob = await canvasToBlob(canvas, type, quality)
  return new File([blob], filename, { type })
}
