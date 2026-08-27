/**
 * 图片编辑工具
 * - 旋转 / 水平垂直翻转（基于旋转后坐标系）
 * - 按矩形区域裁切
 */

export interface EditTransform {
  /** 旋转角度（顺时针） */
  rotation: 0 | 90 | 180 | 270
  /** 水平翻转（相对旋转后的视图） */
  flipH: boolean
  /** 垂直翻转（相对旋转后的视图） */
  flipV: boolean
}

/** 应用旋转 / 翻转，返回新 canvas（不修改原图） */
export function applyTransform(bitmap: ImageBitmap, transform: EditTransform): HTMLCanvasElement {
  const { rotation, flipH, flipV } = transform
  const swap = rotation === 90 || rotation === 270
  const w = swap ? bitmap.height : bitmap.width
  const h = swap ? bitmap.width : bitmap.height

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }
  ctx.translate(w / 2, h / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  if (flipH) ctx.scale(-1, 1)
  if (flipV) ctx.scale(1, -1)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  return canvas
}

/** 按矩形区域裁切（坐标为像素） */
export function cropCanvas(
  canvas: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(rect.w))
  out.height = Math.max(1, Math.round(rect.h))
  const ctx = out.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }
  ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height)
  return out
}

/** 等比居中裁切（cover）：按目标比例从画布中心裁出区域 */
export function centerCropToRatio(
  canvas: HTMLCanvasElement,
  ratio: number,
): HTMLCanvasElement {
  const current = canvas.width / canvas.height
  if (Math.abs(current - ratio) < 0.001) return canvas
  let sw = canvas.width
  let sh = canvas.height
  if (current > ratio) {
    sw = Math.round(sh * ratio)
  } else {
    sh = Math.round(sw / ratio)
  }
  const out = document.createElement('canvas')
  out.width = sw
  out.height = sh
  const ctx = out.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }
  ctx.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, sw, sh)
  return out
}

/** 图片调色参数（各值均为比率/度数，1 或 0 表示不改变） */
export interface ImageAdjustments {
  brightness: number // 0~2，1 原始
  contrast: number // 0~2，1 原始
  saturate: number // 0~3，1 原始
  sepia: number // 0~1
  grayscale: number // 0~1
  hueRotate: number // -180~180 度
  sharpen: number // 0~1，清晰度（锐化）
}

/** 默认（无任何调整） */
export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  sepia: 0,
  grayscale: 0,
  hueRotate: 0,
  sharpen: 0,
}

/** 一键滤镜预设（每个预设通过调色参数组合实现） */
export type FilterKey = 'none' | 'bw' | 'film' | 'japan' | 'cool' | 'warm' | 'vivid'

export interface FilterPreset {
  key: FilterKey
  label: string
  adj: Partial<ImageAdjustments>
}

export const FILTERS: FilterPreset[] = [
  { key: 'none', label: '原图', adj: {} },
  { key: 'bw', label: '黑白', adj: { grayscale: 1, contrast: 1.06, brightness: 1.02 } },
  { key: 'film', label: '胶片', adj: { sepia: 0.28, contrast: 1.1, saturate: 1.12, brightness: 0.98 } },
  { key: 'japan', label: '日系', adj: { brightness: 1.08, contrast: 0.92, saturate: 0.85, sepia: 0.06 } },
  { key: 'cool', label: '冷调', adj: { brightness: 1.02, contrast: 1.05, saturate: 1.06, hueRotate: -12 } },
  { key: 'warm', label: '暖调', adj: { sepia: 0.18, contrast: 1.04, saturate: 1.15, hueRotate: 8 } },
  { key: 'vivid', label: '鲜亮', adj: { contrast: 1.12, saturate: 1.3, brightness: 1.02 } },
]

/**
 * 应用调色 + 滤镜到画布（基于 canvas 2D 的 filter，性能友好）。
 * 清晰度单独用卷积锐化实现。
 */
export function applyAdjustments(source: HTMLCanvasElement, adj: ImageAdjustments): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }

  const filters: string[] = []
  if (adj.brightness !== 1) filters.push(`brightness(${Math.max(0, adj.brightness)})`)
  if (adj.contrast !== 1) filters.push(`contrast(${Math.max(0, adj.contrast)})`)
  if (adj.saturate !== 1) filters.push(`saturate(${Math.max(0, adj.saturate)})`)
  if (adj.sepia > 0) filters.push(`sepia(${Math.min(1, adj.sepia)})`)
  if (adj.grayscale > 0) filters.push(`grayscale(${Math.min(1, adj.grayscale)})`)
  if (adj.hueRotate !== 0) filters.push(`hue-rotate(${adj.hueRotate}deg)`)

  if (filters.length > 0) {
    ctx.filter = filters.join(' ')
  }
  ctx.drawImage(source, 0, 0)
  ctx.filter = 'none'

  if (adj.sharpen > 0) {
    return sharpenCanvas(out, adj.sharpen)
  }
  return out
}

/** 卷积锐化（拉普拉斯核），amount 0~1 控制强度 */
function sharpenCanvas(src: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const srcCtx = src.getContext('2d')
  if (!srcCtx || w < 3 || h < 3) return src
  const srcData = srcCtx.getImageData(0, 0, w, h)
  const px = srcData.data
  const out = new Uint8ClampedArray(px)
  const k = Math.max(0, Math.min(1, amount)) * 0.6
  const center = 1 + 4 * k
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const idx = i + c
        const t = px[idx - 4 * w]
        const b = px[idx + 4 * w]
        const l = px[idx - 4]
        const r = px[idx + 4]
        const v = center * px[idx] - k * (t + b + l + r)
        out[idx] = v
      }
    }
  }
  const outCanvas = document.createElement('canvas')
  outCanvas.width = w
  outCanvas.height = h
  outCanvas.getContext('2d')?.putImageData(new ImageData(out, w, h), 0, 0)
  return outCanvas
}
