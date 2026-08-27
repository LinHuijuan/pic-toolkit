/**
 * 图片水印工具
 * 支持文字水印两种模式：
 * - tile：斜向平铺（防盗图经典样式）
 * - single：单点放置（四角 / 居中）
 */

export type WatermarkMode = 'tile' | 'single'
export type WatermarkPosition = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface WatermarkOptions {
  text: string
  /** 字号（相对源图短边比例，0.03 表示 3%） */
  fontSizeRatio?: number
  color?: string
  /** 透明度 0~1 */
  opacity?: number
  mode?: WatermarkMode
  position?: WatermarkPosition
  /** 平铺旋转角度（度） */
  angle?: number
  /** 单点模式下距边缘留白 */
  marginRatio?: number
  fontFamily?: string
  /** 单点模式下文字中心位置（相对图片 0~1 比例），设置后优先于 position 与 marginRatio */
  xRatio?: number
  yRatio?: number
}

/** 浏览器 canvas 最大边长（Chrome/Safari 约 16384px，超出无法绘制） */
const MAX_CANVAS_DIM = 16384

const DEFAULT_OPTIONS: Required<Omit<WatermarkOptions, 'text' | 'xRatio' | 'yRatio'>> = {
  fontSizeRatio: 0.04,
  color: '#ffffff',
  opacity: 0.4,
  mode: 'tile',
  position: 'bottom-right',
  angle: -30,
  marginRatio: 0.05,
  fontFamily: 'sans-serif',
}

/** 图片水印选项 */
export interface ImageWatermarkOptions {
  /** 透明度 0~1 */
  opacity?: number
  mode?: WatermarkMode
  position?: WatermarkPosition
  /** Logo 宽度相对源图宽度比例（0~1），默认 0.2 */
  sizeRatio?: number
  /** 单点模式下距边缘留白 */
  marginRatio?: number
  /** 单点模式下 Logo 中心位置（相对图片 0~1 比例），设置后优先于 position 与 marginRatio */
  xRatio?: number
  yRatio?: number
}

const DEFAULT_IMAGE_OPTIONS: Required<Omit<ImageWatermarkOptions, 'xRatio' | 'yRatio'>> = {
  opacity: 0.4,
  mode: 'tile',
  position: 'bottom-right',
  sizeRatio: 0.2,
  marginRatio: 0.05,
}

/**
 * 绘制图片水印（Logo 平铺 / 单点放置）并返回新 canvas（不修改原图）
 * @param bitmap 源图
 * @param logo Logo 图片（建议使用透明背景 PNG）
 */
export function drawImageWatermark(
  bitmap: ImageBitmap,
  logo: ImageBitmap,
  options: ImageWatermarkOptions,
): HTMLCanvasElement {
  const opts = { ...DEFAULT_IMAGE_OPTIONS, ...options }

  const w = bitmap.width
  const h = bitmap.height

  // 浏览器 canvas 最大尺寸限制（约 16384px），超出会静默失败或白屏
  if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {
    throw new Error('图片尺寸过大（超出浏览器画布上限 16384px），请先压缩图片后再添加水印')
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }

  ctx.drawImage(bitmap, 0, 0)

  const logoW = Math.max(8, Math.round(w * opts.sizeRatio))
  const logoH = Math.max(1, Math.round((logoW * logo.height) / logo.width))
  ctx.globalAlpha = opts.opacity

  if (opts.mode === 'tile') {
    // 平铺
    const spacingX = logoW * 1.5
    const spacingY = logoH * 2.2
    for (let x = -spacingX; x < w + spacingX; x += spacingX) {
      for (let y = -spacingY; y < h + spacingY; y += spacingY) {
        ctx.drawImage(logo, x, y, logoW, logoH)
      }
    }
  } else {
    // 单点放置
    let x: number
    let y: number
    if (opts.xRatio !== undefined && opts.yRatio !== undefined) {
      // 自定义位置（拖拽）：Logo 中心按图片比例定位
      x = w * opts.xRatio - logoW / 2
      y = h * opts.yRatio - logoH / 2
    } else {
      const margin = Math.round(Math.min(w, h) * opts.marginRatio)
      switch (opts.position) {
        case 'center':
          x = (w - logoW) / 2
          y = (h - logoH) / 2
          break
        case 'top-left':
          x = margin
          y = margin
          break
        case 'top-right':
          x = w - margin - logoW
          y = margin
          break
        case 'bottom-left':
          x = margin
          y = h - margin - logoH
          break
        case 'bottom-right':
        default:
          x = w - margin - logoW
          y = h - margin - logoH
          break
      }
    }
    ctx.drawImage(logo, x, y, logoW, logoH)
  }

  ctx.globalAlpha = 1
  return canvas
}

/** 绘制水印并返回新 canvas（不修改原图） */
export function drawWatermark(bitmap: ImageBitmap, options: WatermarkOptions): HTMLCanvasElement {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const text = opts.text.trim()
  if (!text) {
    throw new Error('水印文字不能为空')
  }

  const w = bitmap.width
  const h = bitmap.height

  // 浏览器 canvas 最大尺寸限制（约 16384px），超出会静默失败或白屏
  if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {
    throw new Error('图片尺寸过大（超出浏览器画布上限 16384px），请先压缩图片后再添加水印')
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }

  ctx.drawImage(bitmap, 0, 0)

  // 以短边为基准计算字号
  const shortSide = Math.min(w, h)
  const fontSize = Math.max(12, Math.round(shortSide * opts.fontSizeRatio))
  ctx.font = `${fontSize}px ${opts.fontFamily}`
  ctx.fillStyle = opts.color
  ctx.globalAlpha = opts.opacity

  if (opts.mode === 'tile') {
    drawTileWatermark(ctx, text, w, h, fontSize, opts.angle)
  } else {
    drawSingleWatermark(ctx, text, w, h, fontSize, opts.position, opts.marginRatio, opts.xRatio, opts.yRatio)
  }

  ctx.globalAlpha = 1
  return canvas
}

/** 斜向平铺水印 */
function drawTileWatermark(
  ctx: CanvasRenderingContext2D,
  text: string,
  w: number,
  h: number,
  fontSize: number,
  angle: number,
): void {
  const metrics = ctx.measureText(text)
  const textW = metrics.width
  const textH = fontSize

  // 计算平铺网格（保证任意旋转都能铺满）
  const spacingX = textW + textW * 0.6
  const spacingY = textH + textH * 2.2
  const rad = (angle * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const neededW = w * cos + h * sin + spacingX
  const neededH = h * cos + w * sin + spacingY

  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.rotate(rad)
  ctx.translate(-w / 2, -h / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let x = -spacingX; x < neededW; x += spacingX) {
    for (let y = -spacingY; y < neededH; y += spacingY) {
      ctx.fillText(text, x + spacingX / 2, y + spacingY / 2)
    }
  }
  ctx.restore()
}

/** 单点水印 */
function drawSingleWatermark(
  ctx: CanvasRenderingContext2D,
  text: string,
  w: number,
  h: number,
  fontSize: number,
  position: WatermarkPosition,
  marginRatio: number,
  xRatio?: number,
  yRatio?: number,
): void {
  const metrics = ctx.measureText(text)
  const textW = metrics.width
  const textH = fontSize

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  let x: number
  let y: number
  if (xRatio !== undefined && yRatio !== undefined) {
    // 自定义位置（拖拽）：文字中心按图片比例定位
    x = w * xRatio
    y = h * yRatio
  } else {
    const margin = Math.round(Math.min(w, h) * marginRatio)
    switch (position) {
      case 'center':
        x = w / 2
        y = h / 2
        break
      case 'top-left':
        x = margin + textW / 2
        y = margin + textH / 2
        break
      case 'top-right':
        x = w - margin - textW / 2
        y = margin + textH / 2
        break
      case 'bottom-left':
        x = margin + textW / 2
        y = h - margin - textH / 2
        break
      case 'bottom-right':
      default:
        x = w - margin - textW / 2
        y = h - margin - textH / 2
        break
    }
  }
  ctx.fillText(text, x, y)
}
