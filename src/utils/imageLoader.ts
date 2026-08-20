/**
 * 图片加载与导出工具
 * - 使用 createImageBitmap 加载，自动处理手机拍照的 EXIF 方向
 * - 提供 canvas → Blob → 下载 的导出链路
 */

export interface LoadedImage {
  bitmap: ImageBitmap
  width: number
  height: number
  name: string
}

/** 从 File 加载图片（自动纠正手机拍照方向） */
export async function loadImageFromFile(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件')
  }
  // imageOrientation: 'from-image' 自动应用 EXIF 方向，解决手机拍照旋转问题
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    name: file.name.replace(/\.[^.]+$/, ''),
  }
}

/** File → DataURL（用于 @imgly/background-removal 抠图输入） */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
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

/** canvas 直接下载 */
export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  const url = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
