/**
 * 九宫格切图工具
 * 将图片按 rows × cols 均匀切分为多块，支持块间留白（gap）与透明背景
 */

export interface GridSliceOptions {
  rows: number
  cols: number
  /** 块间留白（像素），0 表示无缝切割 */
  gap?: number
  /** 是否输出透明背景（表情包等用途），默认 false 输出白底 */
  transparent?: boolean
}

export interface SliceResult {
  canvas: HTMLCanvasElement
  row: number
  col: number
}

/** 计算单块尺寸：原图宽高按 cols/rows 均分 */
export function calcSliceSize(
  width: number,
  height: number,
  rows: number,
  cols: number,
  gap = 0,
): { sliceW: number; sliceH: number } {
  const sliceW = Math.floor((width - gap * (cols - 1)) / cols)
  const sliceH = Math.floor((height - gap * (rows - 1)) / rows)
  return { sliceW, sliceH }
}

/**
 * 将图片切分为 rows × cols 块
 * @param bitmap 源图（ImageBitmap）
 * @param options 切分参数
 * @returns 每块独立的 canvas，按行优先排列
 */
export function sliceGrid(bitmap: ImageBitmap, options: GridSliceOptions): SliceResult[] {
  const { rows, cols, gap = 0, transparent = false } = options
  if (rows < 1 || cols < 1) {
    throw new Error('行列数必须大于 0')
  }

  const srcW = bitmap.width
  const srcH = bitmap.height
  const { sliceW, sliceH } = calcSliceSize(srcW, srcH, rows, cols, gap)
  if (sliceW <= 0 || sliceH <= 0) {
    throw new Error('切块尺寸过小，请减少行列数或缩小留白')
  }

  const results: SliceResult[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const canvas = document.createElement('canvas')
      canvas.width = sliceW
      canvas.height = sliceH
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('当前浏览器不支持 Canvas 2D')
      }
      if (!transparent) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, sliceW, sliceH)
      }
      const sx = c * (sliceW + gap)
      const sy = r * (sliceH + gap)
      ctx.drawImage(bitmap, sx, sy, sliceW, sliceH, 0, 0, sliceW, sliceH)
      results.push({ canvas, row: r + 1, col: c + 1 })
    }
  }
  return results
}

/** 生成切块下载文件名 */
export function buildSliceFilename(baseName: string, row: number, col: number, rows: number, cols: number): string {
  const padLen = String(Math.max(rows, cols)).length
  const r = String(row).padStart(padLen, '0')
  const c = String(col).padStart(padLen, '0')
  return `${baseName}_${r}${c}.png`
}
