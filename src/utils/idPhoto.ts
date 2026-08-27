/**
 * 证件照规格工具
 * - 标准规格（像素尺寸，基于 300dpi）
 * - 按规格居中裁切缩放（cover）
 * - 一版多张：在 6 寸相纸上排版
 */

export interface IdPhotoSpec {
  key: string
  label: string
  /** 规格像素宽度（300dpi） */
  width: number
  /** 规格像素高度（300dpi） */
  height: number
}

export const ID_PHOTO_SPECS: IdPhotoSpec[] = [
  { key: 'one', label: '一寸', width: 295, height: 413 },
  { key: 'small-one', label: '小一寸', width: 260, height: 378 },
  { key: 'large-one', label: '大一寸', width: 390, height: 567 },
  { key: 'two', label: '二寸', width: 413, height: 579 },
  { key: 'small-two', label: '小二寸', width: 413, height: 531 },
]

/** 6 寸相纸尺寸（152 × 102 mm，300dpi） */
export const SHEET_WIDTH = 1795
export const SHEET_HEIGHT = 1205

/** 人物定位焦点（归一化中心坐标与缩放，用于手动微调裁切） */
export interface FitFocus {
  /** 裁切中心横坐标（0~1，相对源图） */
  x: number
  /** 裁切中心纵坐标（0~1，相对源图） */
  y: number
  /** 缩放倍率（1 为默认 cover，>1 放大人物） */
  zoom: number
}

/**
 * 将画布按规格居中裁切缩放（cover：超出部分裁掉）
 * 传入 focus 时以指定焦点为中心裁切并支持缩放，用于人像手动微调
 * @returns 规格像素尺寸的新画布
 */
export function fitToSpec(canvas: HTMLCanvasElement, spec: IdPhotoSpec, focus?: FitFocus): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = spec.width
  out.height = spec.height
  const ctx = out.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }
  const baseScale = Math.max(spec.width / canvas.width, spec.height / canvas.height)
  const scale = baseScale * (focus?.zoom ?? 1)
  const sw = spec.width / scale
  const sh = spec.height / scale
  // 默认居中；传入 focus 时以焦点为中心
  const fx = (focus?.x ?? 0.5) * canvas.width
  const fy = (focus?.y ?? 0.5) * canvas.height
  const sx = Math.max(0, Math.min(fx - sw / 2, canvas.width - sw))
  const sy = Math.max(0, Math.min(fy - sh / 2, canvas.height - sh))
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, spec.width, spec.height)
  return out
}

/**
 * 一版多张：在 6 寸相纸上排版多张规格证件照
 * 一寸排 3 列 × 2 行，其余规格排 2 列 × 2 行；每张占格子 82% 居中（预留裁剪空间）
 */
export function layoutOnSheet(specCanvas: HTMLCanvasElement, spec: IdPhotoSpec): HTMLCanvasElement {
  const cols = spec.key === 'one' ? 3 : 2
  const rows = 2
  const sheet = document.createElement('canvas')
  sheet.width = SHEET_WIDTH
  sheet.height = SHEET_HEIGHT
  const ctx = sheet.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT)
  const cellW = SHEET_WIDTH / cols
  const cellH = SHEET_HEIGHT / rows
  const s = Math.min((cellW * 0.82) / spec.width, (cellH * 0.82) / spec.height)
  const dw = Math.round(spec.width * s)
  const dh = Math.round(spec.height * s)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.drawImage(specCanvas, cellW * c + (cellW - dw) / 2, cellH * r + (cellH - dh) / 2, dw, dh)
    }
  }
  return sheet
}
