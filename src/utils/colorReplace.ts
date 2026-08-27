/**
 * 局部改色 / 区域颜色替换
 * - 在指定矩形区域内，把接近「源色」的像素替换成「目标色」，边缘平滑过渡
 * - 全程本地像素处理，图片不上传服务器
 */

/** 区域矩形（比例坐标 0~1，相对图片宽高） */
export interface ReplaceRect {
  x: number
  y: number
  w: number
  h: number
}

export type Rgb = [number, number, number]

/** hex → rgb 三元组 */
export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '')
  const v = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** rgb → hex 字符串（#rrggbb） */
export function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** 读取画布指定像素颜色（越界时返回最近的边界像素或黑色） */
export function getPixelRgb(canvas: HTMLCanvasElement, x: number, y: number): Rgb {
  const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x)))
  const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y)))
  const ctx = canvas.getContext('2d')
  if (!ctx) return [0, 0, 0]
  const d = ctx.getImageData(px, py, 1, 1).data
  return [d[0], d[1], d[2]]
}

export interface ReplaceOptions {
  /** 源色（要被替换的颜色） */
  from: Rgb
  /** 目标色（替换成的颜色） */
  to: Rgb
  /** 容差 0~100：越大覆盖的颜色范围越宽（0 时仅替换与源色完全相同的像素） */
  tolerance: number
}

/**
 * 在矩形区域内把接近 from 的像素替换为 to
 * @param source 源画布（不会被修改）
 * @param rect 区域（比例坐标 0~1）
 */
export function replaceColorInRegion(source: HTMLCanvasElement, rect: ReplaceRect, options: ReplaceOptions): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D')
  ctx.drawImage(source, 0, 0)

  const sx = Math.max(0, Math.round(rect.x * source.width))
  const sy = Math.max(0, Math.round(rect.y * source.height))
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(rect.w * source.width)))
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(rect.h * source.height)))

  const img = ctx.getImageData(sx, sy, sw, sh)
  const d = img.data
  const [fr, fg, fb] = options.from
  const [tr, tg, tb] = options.to
  // 容差半径（欧氏距离）：0~100 映射到 0~255；tolerance=0 时取 1，仅精确匹配
  const t = Math.max(1, (options.tolerance / 100) * 255)
  const t2 = t * t

  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - fr
    const dg = d[i + 1] - fg
    const db = d[i + 2] - fb
    const dist2 = dr * dr + dg * dg + db * db
    if (dist2 > t2) continue
    // alpha 随距离线性衰减：中心完全替换，边缘平滑过渡到原图，避免色块硬边
    const alpha = 1 - Math.sqrt(dist2) / t
    d[i] = d[i] + (tr - d[i]) * alpha
    d[i + 1] = d[i + 1] + (tg - d[i + 1]) * alpha
    d[i + 2] = d[i + 2] + (tb - d[i + 2]) * alpha
  }
  ctx.putImageData(img, sx, sy)
  return out
}
