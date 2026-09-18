/**
 * 图片加载与导出工具
 * - 使用 createImageBitmap 加载，自动处理手机拍照的 EXIF 方向
 * - HEIC / HEIF 按文件头识别（Windows 上常常没有 MIME），原生解不动时走 libheif 兜底
 * - 提供 canvas → Blob → 下载 的导出链路
 */

import { decodeHeic, isHeicFile, heicErrorMessage } from './heic'
import { showToast } from './toast'

export interface LoadedImage {
  bitmap: ImageBitmap
  width: number
  height: number
  name: string
  /** 是否因超大被自动缩小到安全尺寸（内存护栏触发） */
  downscaled: boolean
}

/**
 * 大图内存护栏：单张解码后超过该像素量就先收敛到安全区间再往下走，
 * 避免超大图在各工具的画布操作里把内存撑爆、卡死页面。绝大多数照片不会触到这个阈值。
 */
export const MAX_IMAGE_MEGAPIXELS = 48

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

  // 大图护栏：超阈值就缩小到安全像素量，避免各工具的画布操作撑爆内存
  const downscaled = bitmap.width * bitmap.height > MAX_IMAGE_MEGAPIXELS * 1e6
  if (downscaled) {
    const reduced = bitmapToCanvas(bitmap)
    bitmap.close()
    bitmap = await createImageBitmap(reduced)
    showToast('图片非常大，已自动缩小到安全尺寸以便稳定处理（不影响大多数使用场景）', 'info')
  }

  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    name: file.name.replace(/\.[^.]+$/, ''),
    downscaled,
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

/**
 * 把原图渲染成一张适合做「前后对比」的预览图（限制长边，避免超大图加载成卡顿）。
 * 返回 objectURL，调用方负责在合适时机 revoke。
 */
export async function createPreviewUrl(bitmap: ImageBitmap, maxEdge = 1400): Promise<string> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await canvasToBlob(canvas, 'image/png', 1)
  return URL.createObjectURL(blob)
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
  const revoke = () => URL.revokeObjectURL(url)
  // 点击时浏览器已取得 blob URL 引用，可安全释放；但移动端下载面板弹出较慢，多留 3 秒余量
  a.addEventListener('click', () => setTimeout(revoke, 3000), { once: true })
  a.click()
  document.body.removeChild(a)
  // 万一点击监听没触发（异常路径），5 秒后兜底释放，避免 objectURL 泄漏
  setTimeout(revoke, 5000)
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
