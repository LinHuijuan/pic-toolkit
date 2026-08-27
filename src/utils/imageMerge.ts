/**
 * 长图拼接工具
 * - 多图竖排 / 横排拼成长图
 * - 竖排时以最大宽度为画布宽（窄图居中），横排时以最大高度为画布高（矮图居中）
 */

export type MergeDirection = 'vertical' | 'horizontal'

export interface MergeOptions {
  direction: MergeDirection
  /** 图片间距（px），默认 0 */
  gap?: number
}

/** 浏览器 canvas 最大边长（Chrome/Safari 约 16384px，超出无法绘制） */
const MAX_CANVAS_DIM = 16384

/** 将多张位图拼成一张长图，返回画布 */
export function mergeImages(
  bitmaps: ImageBitmap[],
  options: MergeOptions,
): HTMLCanvasElement {
  if (bitmaps.length === 0) {
    throw new Error('请至少选择一张图片')
  }
  const gap = Math.max(0, options.gap ?? 0)

  const widths = bitmaps.map((b) => b.width)
  const heights = bitmaps.map((b) => b.height)

  const vertical = options.direction === 'vertical'
  const canvasW = vertical ? Math.max(...widths) : widths.reduce((a, b) => a + b, 0) + gap * (bitmaps.length - 1)
  const canvasH = vertical ? heights.reduce((a, b) => a + b, 0) + gap * (bitmaps.length - 1) : Math.max(...heights)

  // 浏览器 canvas 最大尺寸限制（约 16384px），超出会静默失败或白屏
  if (canvasW > MAX_CANVAS_DIM || canvasH > MAX_CANVAS_DIM) {
    throw new Error('拼接后尺寸过大（超出浏览器画布上限 16384px），请减少图片数量')
  }

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }

  let cursor = 0
  for (const bitmap of bitmaps) {
    const x = vertical ? Math.round((canvasW - bitmap.width) / 2) : cursor
    const y = vertical ? cursor : Math.round((canvasH - bitmap.height) / 2)
    ctx.drawImage(bitmap, x, y)
    cursor += (vertical ? bitmap.height : bitmap.width) + gap
  }

  return canvas
}

/** 画布适配方式：裁切（保留分辨率，去掉多余边缘）或留白（等比缩小，白底居中） */
export type CanvasFitMode = 'crop' | 'contain'

/**
 * 将画布调整为目标宽高比
 * @param canvas 原画布
 * @param ratio 目标宽高比（宽 / 高），null 或 <=0 表示不调整
 * @param mode crop：按目标比例从中心裁切；contain：等比缩小后居中，留白填充白色
 */
export function fitCanvasRatio(
  canvas: HTMLCanvasElement,
  ratio: number | null,
  mode: CanvasFitMode,
): HTMLCanvasElement {
  if (!ratio || ratio <= 0) return canvas
  const current = canvas.width / canvas.height
  if (Math.abs(current - ratio) < 0.001) return canvas

  const out = document.createElement('canvas')
  const ctx = out.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }

  if (mode === 'crop') {
    // 保持分辨率，从中心裁出目标比例区域
    let sw = canvas.width
    let sh = canvas.height
    if (current > ratio) {
      sw = Math.round(sh * ratio)
    } else {
      sh = Math.round(sw / ratio)
    }
    out.width = sw
    out.height = sh
    ctx.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, sw, sh)
    return out
  }

  // contain：等比缩小并居中，留白填白
  let targetW = canvas.width
  let targetH = canvas.height
  if (current > ratio) {
    targetH = Math.round(targetW / ratio)
  } else {
    targetW = Math.round(targetH * ratio)
  }
  out.width = targetW
  out.height = targetH
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, targetW, targetH)
  const scale = Math.min(targetW / canvas.width, targetH / canvas.height)
  const dw = canvas.width * scale
  const dh = canvas.height * scale
  ctx.drawImage(canvas, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh)
  return out
}
