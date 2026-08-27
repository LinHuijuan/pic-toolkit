/**
 * 网格拼图工具
 * - 将多张图片按 行×列 网格拼成一张图（朋友圈九宫格场景）
 * - 每格统一大小，图片按 cover 方式裁切居中填充
 * - 图片数量超过格子数时只取前 N 张；不足时空格留白
 */

export interface CollageOptions {
  rows: number
  cols: number
  /** 格子间距（px），默认 4 */
  gap?: number
  /** 画布背景色（留白 / 间距区域），默认透明 */
  bgColor?: string | null
}

/** 浏览器 canvas 最大边长（Chrome/Safari 约 16384px，超出无法绘制） */
const MAX_CANVAS_DIM = 16384

/** 将多张位图拼成网格图，返回画布 */
export function createCollage(
  bitmaps: ImageBitmap[],
  options: CollageOptions,
): HTMLCanvasElement {
  const { rows, cols } = options
  if (rows <= 0 || cols <= 0) {
    throw new Error('网格行列数必须大于 0')
  }
  const gap = Math.max(0, options.gap ?? 4)
  const total = rows * cols
  const used = bitmaps.slice(0, total)

  // 统一格子尺寸：取所有图片的最大宽 / 最大高
  const cellW = used.length > 0 ? Math.max(...used.map((b) => b.width)) : 100
  const cellH = used.length > 0 ? Math.max(...used.map((b) => b.height)) : 100

  const canvas = document.createElement('canvas')
  canvas.width = cellW * cols + gap * (cols - 1)
  canvas.height = cellH * rows + gap * (rows - 1)

  // 浏览器 canvas 最大尺寸限制（约 16384px），超出会静默失败或白屏
  if (canvas.width > MAX_CANVAS_DIM || canvas.height > MAX_CANVAS_DIM) {
    throw new Error('拼图尺寸过大（超出浏览器画布上限 16384px），请减少图片数量或改用更小的图片')
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }

  // 背景色（覆盖间距与空格区域）
  if (options.bgColor) {
    ctx.fillStyle = options.bgColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  used.forEach((bitmap, index) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    const x = col * (cellW + gap)
    const y = row * (cellH + gap)

    // cover 裁切：等比缩放铺满格子，居中裁剪
    const scale = Math.max(cellW / bitmap.width, cellH / bitmap.height)
    const sw = cellW / scale
    const sh = cellH / scale
    const sx = (bitmap.width - sw) / 2
    const sy = (bitmap.height - sh) / 2
    ctx.drawImage(bitmap, sx, sy, sw, sh, x, y, cellW, cellH)
  })

  return canvas
}
