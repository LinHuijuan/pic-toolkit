/**
 * 抠图结果的边缘处理、描边与投影
 * - 边缘收缩：@imgly 的掩码在发丝与轮廓外普遍留一圈原始背景，看上去像白边。
 *   对 alpha 跑一次方形最小值滤波（腐蚀）把这一圈吃掉，只改 alpha、不动尺寸。
 * - 羽化：把处理后的 alpha 当作 destination-in 掩码叠回主体，配合模糊柔化边缘。
 * - 描边：@imgly 只返回成品图、拿不到 mask，所以描边只能对 alpha 做膨胀：
 *   把 alpha 抽出来缩放后跑两次一维最大值滤波（横向 + 纵向 = 方形膨胀），
 *   再放大回来垫在主体下方。这样边缘自带平滑，且大图上的耗时可控。
 * - 投影用 canvas 阴影画一次主体，再用 destination-out 把主体本身擦掉，只留下影子。
 * - 输出会按描边宽度与阴影半径加一圈留白，否则主体贴边时描边/投影会被裁掉。
 * - 顺序固定为「收缩羽化 → 描边投影」：先清边再包边，描边才会贴着干净的轮廓。
 */

export interface CutoutStyle {
  /** 描边颜色，outlineWidth 为 0 时忽略 */
  outlineColor: string
  /** 描边宽度（输出图像素），0 表示不描边 */
  outlineWidth: number
  /** 投影颜色（带 alpha 的 rgba） */
  shadowColor: string
  /** 投影模糊半径，0 表示不投影 */
  shadowBlur: number
  /** 投影纵向偏移 */
  shadowOffsetY: number
  /** alpha 收缩半径（输出图像素），吃掉抠图边缘残留的一圈原始背景 */
  shrinkWidth: number
  /** 边缘羽化半径（输出图像素），0 表示保持硬边 */
  featherWidth: number
}

export const DEFAULT_CUTOUT_STYLE: CutoutStyle = {
  outlineColor: '#ffffff',
  outlineWidth: 0,
  shadowColor: 'rgba(15, 23, 42, 0.35)',
  shadowBlur: 0,
  shadowOffsetY: 12,
  shrinkWidth: 1,
  featherWidth: 0,
}

/**
 * 是否启用了会撑大画布的效果（描边/投影）。
 * 边缘收缩与羽化不计入：它们只改 alpha，尺寸不变，预览仍可与原图 1:1 对齐。
 */
export function isStyled(style?: CutoutStyle | null): boolean {
  return !!style && (style.outlineWidth > 0 || style.shadowBlur > 0)
}

/** 描边与投影需要的额外留白（未启用的效果不计入） */
function neededMargin(style: CutoutStyle): number {
  const outline = style.outlineWidth > 0 ? style.outlineWidth : 0
  const shadow = style.shadowBlur > 0 ? style.shadowBlur + Math.abs(style.shadowOffsetY) : 0
  return Math.ceil(Math.max(outline, shadow))
}

/** 描边掩码的分辨率上限 */
const OUTLINE_MAX_EDGE = 1024
/** 边缘处理掩码的分辨率上限：收缩半径通常只有 1~3 像素，掩码不够细就吃不准 */
const REFINE_MAX_EDGE = 2048

/**
 * 把 sprite 的 alpha 抽成一张缩放后的掩码。
 * 描边（膨胀）与边缘收缩（腐蚀）共用这条路径：掩码在缩小空间里滤波，
 * 半径与代价都按缩小后的尺寸算，避免大图逐像素卡住。
 * @param margin 输出相对 sprite 的留白，掩码必须在「含留白」的坐标系里采样，
 *               否则放大回去时效果会相对主体整体偏移一个留白的量
 * @returns ctx 是采样画布的上下文，顺手用它 createImageData 省一次分配
 */
function extractAlpha(
  sprite: HTMLCanvasElement,
  margin: number,
  maxEdge: number,
): { mask: Uint8ClampedArray; w: number; h: number; scale: number; ctx: CanvasRenderingContext2D } | null {
  const fullW = sprite.width + margin * 2
  const fullH = sprite.height + margin * 2
  const scale = Math.min(1, maxEdge / Math.max(fullW, fullH))
  const w = Math.max(1, Math.round(fullW * scale))
  const h = Math.max(1, Math.round(fullH * scale))

  const sample = document.createElement('canvas')
  sample.width = w
  sample.height = h
  const ctx = sample.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  // 用变换落位，避免整数化让主体在掩码里偏移半像素
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.drawImage(sprite, margin, margin)
  const src = ctx.getImageData(0, 0, w, h).data

  const mask = new Uint8ClampedArray(w * h)
  for (let i = 0; i < w * h; i++) mask[i] = src[i * 4 + 3]
  return { mask, w, h, scale, ctx }
}

/** 是否需要对抠图结果做后处理（含只改 alpha、不撑大画布的边缘处理） */
export function isRelevant(style?: CutoutStyle | null): boolean {
  if (!style) return false
  return isStyled(style) || style.shrinkWidth > 0 || style.featherWidth > 0
}

/**
 * 用膨胀后的 alpha 生成描边层。
 * 半径按掩码缩放比例换算，1px 描边在大图上对应几个掩码像素都算得准。
 */
function buildOutlineLayer(
  sprite: HTMLCanvasElement,
  color: string,
  width: number,
  margin: number,
): HTMLCanvasElement | null {
  const sampled = extractAlpha(sprite, margin, OUTLINE_MAX_EDGE)
  if (!sampled) return null
  const { mask, w, h, scale, ctx } = sampled

  const radius = Math.max(1, Math.round(width * scale))
  const dilated = boxFilter(mask, w, h, radius, false)

  const out = ctx.createImageData(w, h)
  const rgb = parseRgb(color)
  for (let i = 0; i < w * h; i++) {
    out.data[i * 4] = rgb[0]
    out.data[i * 4 + 1] = rgb[1]
    out.data[i * 4 + 2] = rgb[2]
    out.data[i * 4 + 3] = dilated[i]
  }
  const layer = document.createElement('canvas')
  layer.width = w
  layer.height = h
  layer.getContext('2d')?.putImageData(out, 0, 0)
  return layer
}

/**
 * 方形邻域极值滤波，可分离成横向 + 纵向两遍。
 * erode=false 取最大值是膨胀（描边向外撑），true 取最小值是腐蚀（边缘往里收）：
 * 同一份代码只差比较方向。窗口在画布边界按截断处理，贴边的主体不会被啃掉一圈。
 */
function boxFilter(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  erode: boolean,
): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(src.length)
  const out = new Uint8ClampedArray(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = erode ? 255 : 0
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w - 1, x + r)
      for (let i = x0; i <= x1; i++) {
        const v = src[y * w + i]
        if (erode ? v < m : v > m) m = v
      }
      tmp[y * w + x] = m
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = erode ? 255 : 0
      const y0 = Math.max(0, y - r)
      const y1 = Math.min(h - 1, y + r)
      for (let i = y0; i <= y1; i++) {
        const v = tmp[i * w + x]
        if (erode ? v < m : v > m) m = v
      }
      out[y * w + x] = m
    }
  }
  return out
}

/** 解析 #rgb / #rrggbb / rgba(...) 到 [r,g,b]，解析失败按白色处理 */
function parseRgb(color: string): [number, number, number] {
  const hex = color.trim()
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ]
  }
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
      parseInt(hex[3] + hex[3], 16),
    ]
  }
  const nums = Array.from(hex.matchAll(/(\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]))
  if (nums.length >= 3) return [nums[0], nums[1], nums[2]]
  return [255, 255, 255]
}

/** 只保留投影、擦掉主体自身 */
function buildShadowLayer(
  sprite: HTMLCanvasElement,
  style: CutoutStyle,
  margin: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = sprite.width + margin * 2
  canvas.height = sprite.height + margin * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.save()
  ctx.shadowColor = style.shadowColor
  ctx.shadowBlur = style.shadowBlur
  ctx.shadowOffsetY = style.shadowOffsetY
  ctx.drawImage(sprite, margin, margin)
  ctx.restore()
  // 影子已经画好，把主体本身挖掉，只留投影
  ctx.globalCompositeOperation = 'destination-out'
  ctx.drawImage(sprite, margin, margin)
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

/**
 * 清理抠图边缘：腐蚀 alpha 吃掉残留的一圈原始背景，再按需羽化。
 * 只改 alpha，输出尺寸与输入完全一致，所以预览仍能与原图 1:1 对齐。
 */
function refineAlpha(sprite: HTMLCanvasElement, style: CutoutStyle): HTMLCanvasElement {
  const { shrinkWidth, featherWidth } = style
  if (shrinkWidth <= 0 && featherWidth <= 0) return sprite

  const sampled = extractAlpha(sprite, 0, REFINE_MAX_EDGE)
  if (!sampled) return sprite
  const { mask, w, h, scale, ctx } = sampled
  // 腐蚀量额外加上羽化宽度：模糊会把边缘对称摊开约 feather 像素，
  // 而白边的颜色仍在主体图层里（这一步只改 alpha），不多收这一圈又会把白边糊回来。
  const radius = Math.max(1, Math.round((shrinkWidth + featherWidth) * scale))
  const alpha = boxFilter(mask, w, h, radius, true)

  const maskData = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    maskData.data[i * 4] = 255
    maskData.data[i * 4 + 1] = 255
    maskData.data[i * 4 + 2] = 255
    maskData.data[i * 4 + 3] = alpha[i]
  }
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = w
  maskCanvas.height = h
  maskCanvas.getContext('2d')?.putImageData(maskData, 0, 0)

  const out = document.createElement('canvas')
  out.width = sprite.width
  out.height = sprite.height
  const octx = out.getContext('2d')
  if (!octx) return sprite
  octx.drawImage(sprite, 0, 0)
  // destination-in：掩码的 alpha 决定主体每个像素保留多少，等于按清理后的轮廓重裁一遍
  octx.globalCompositeOperation = 'destination-in'
  if (featherWidth > 0) octx.filter = `blur(${featherWidth}px)`
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  // 掩码是缩放后的，放大回原尺寸本身也会带来一层柔化
  octx.drawImage(maskCanvas, 0, 0, out.width, out.height)
  octx.filter = 'none'
  octx.globalCompositeOperation = 'source-over'
  return out
}

/**
 * 给透明底主体做边缘清理并加描边与投影，返回带留白的新画布。
 * @param sprite 透明底主体画布（擦除后的工作画布）
 * @param style 各效果参数，未启用的一项会被跳过
 */
export function styleCutout(sprite: HTMLCanvasElement, style: CutoutStyle): HTMLCanvasElement {
  // 先清边再包边：描边与投影都要贴着处理过的轮廓，否则会跟着白边走
  const base = refineAlpha(sprite, style)
  const margin = isStyled(style) ? neededMargin(style) : 0
  const out = document.createElement('canvas')
  out.width = base.width + margin * 2
  out.height = base.height + margin * 2
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D')

  if (margin === 0) {
    ctx.drawImage(base, 0, 0)
    return out
  }

  if (style.shadowBlur > 0) {
    ctx.drawImage(buildShadowLayer(base, style, margin), 0, 0)
  }

  if (style.outlineWidth > 0) {
    const layer = buildOutlineLayer(base, style.outlineColor, style.outlineWidth, margin)
    if (layer) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      // 掩码是缩小后算的，放大回原尺寸时顺便把锯齿抹平
      ctx.drawImage(layer, 0, 0, out.width, out.height)
    }
  }

  ctx.drawImage(base, margin, margin)
  return out
}

/**
 * 在主体上擦除一块（destination-out）。
 * 供「擦除笔刷」调用：只擦不补，所以工作画布始终是抠图结果的一份拷贝。
 */
export function eraseStroke(
  working: HTMLCanvasElement,
  points: { x: number; y: number }[],
  radius: number,
): void {
  const ctx = working.getContext('2d')
  if (!ctx || points.length === 0) return
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = radius * 2
  ctx.strokeStyle = 'rgba(0,0,0,1)'
  ctx.fillStyle = 'rgba(0,0,0,1)'
  if (points.length === 1) {
    ctx.beginPath()
    ctx.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
    ctx.stroke()
  }
  ctx.restore()
}
