/**
 * 智能裁剪推荐（本地显著性分析）
 * 思路：将图片缩为小图，用「与全图均值的色彩差异 + 边缘能量」计算每个像素的显著性，
 * 再通过积分图在满足目标比例的最大内接框上滑动窗口，找到最显著的区域作为最佳裁剪框。
 * 全程在浏览器本地计算，无需联网，不含任何图片上传。
 */

export interface SmartCropRect {
  x: number
  y: number
  w: number
  h: number
}

/** 分析用的小图尺寸（越小越快，足够定位大体位置） */
const ANALYZE_W = 48
const ANALYZE_H = 32

export function detectSmartCrop(canvas: HTMLCanvasElement, ratio: number = 4 / 3): SmartCropRect {
  const w = ANALYZE_W
  const h = ANALYZE_H

  // 缩到小图并读取像素
  const small = document.createElement('canvas')
  small.width = w
  small.height = h
  const sctx = small.getContext('2d')
  if (!sctx) return { x: 0, y: 0, w: 1, h: 1 }
  sctx.drawImage(canvas, 0, 0, w, h)
  const data = sctx.getImageData(0, 0, w, h).data

  // 转灰度并求均值
  const gray = new Array<number>(w * h)
  let sum = 0
  for (let i = 0; i < w * h; i++) {
    const g = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114
    gray[i] = g
    sum += g
  }
  const avg = sum / (w * h)

  // 显著性 = 与均值对比 + 边缘能量
  const sal = new Array<number>(w * h).fill(0)
  for (let i = 0; i < w * h; i++) {
    sal[i] = Math.abs(gray[i] - avg)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const right = x < w - 1 ? gray[i + 1] : gray[i]
      const down = y < h - 1 ? gray[i + w] : gray[i]
      sal[i] += 0.7 * (Math.abs(right - gray[i]) + Math.abs(down - gray[i]))
    }
  }

  // 目标框：满足 ratio 的最大内接框（限制在分析图范围内）
  let boxW: number
  let boxH: number
  const imgRatio = w / h
  if (imgRatio > ratio) {
    boxW = w
    boxH = Math.round(w / ratio)
    if (boxH > h) {
      boxH = h
      boxW = Math.round(h * ratio)
    }
  } else {
    boxH = h
    boxW = Math.round(h * ratio)
    if (boxW > w) {
      boxW = w
      boxH = Math.round(w / ratio)
    }
  }
  boxW = Math.max(8, Math.min(w, boxW))
  boxH = Math.max(8, Math.min(h, boxH))

  // 积分图（便于 O(1) 求任意窗口和）
  const iw = w + 1
  const integral = new Array<number>(iw * (h + 1)).fill(0)
  for (let y = 1; y <= h; y++) {
    let rowSum = 0
    for (let x = 1; x <= w; x++) {
      rowSum += sal[(y - 1) * w + (x - 1)]
      integral[y * iw + x] = integral[(y - 1) * iw + x] + rowSum
    }
  }
  const windowSum = (x0: number, y0: number, x1: number, y1: number) =>
    integral[y1 * iw + x1] - integral[y0 * iw + x1] - integral[y1 * iw + x0] + integral[y0 * iw + x0]

  // 滑动窗口找最显著位置
  let best = -Infinity
  let bx = 0
  let by = 0
  const maxX = w - boxW
  const maxY = h - boxH
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      const s = windowSum(x, y, x + boxW, y + boxH)
      if (s > best) {
        best = s
        bx = x
        by = y
      }
    }
  }

  return { x: bx / w, y: by / h, w: boxW / w, h: boxH / h }
}
