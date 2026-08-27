/**
 * 九宫格切图工具
 * 将图片按 rows × cols 均匀切分为多块，支持块间留白（gap）与透明背景
 */

/** 浏览器 canvas 最大边长（Chrome/Safari 约 16384px，超出无法绘制） */
const MAX_CANVAS_DIM = 16384

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

  // 浏览器 canvas 最大尺寸限制（约 16384px），超出会静默失败或白屏
  if (bitmap.width > MAX_CANVAS_DIM || bitmap.height > MAX_CANVAS_DIM) {
    throw new Error('图片尺寸过大（超出浏览器画布上限 16384px），请先缩小图片再切图')
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

/**
 * 将切块按原布局拼回成一张完整预览图（含块间留白）
 * 留白处保持透明，便于在棋盘格背景上观察留白与透明背景效果
 */
export function buildSlicePreview(
  slices: SliceResult[],
  rows: number,
  cols: number,
  gap = 0,
): HTMLCanvasElement {
  if (slices.length === 0) {
    throw new Error('没有可预览的切块')
  }
  const sliceW = slices[0].canvas.width
  const sliceH = slices[0].canvas.height
  const totalW = sliceW * cols + gap * (cols - 1)
  const totalH = sliceH * rows + gap * (rows - 1)

  // 浏览器 canvas 最大尺寸限制（约 16384px），超出会静默失败或白屏
  if (totalW > MAX_CANVAS_DIM || totalH > MAX_CANVAS_DIM) {
    throw new Error('预览尺寸过大（超出浏览器画布上限 16384px），请减少行列数或缩小留白')
  }

  const canvas = document.createElement('canvas')
  canvas.width = totalW
  canvas.height = totalH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 2D')
  }
  slices.forEach((slice, index) => {
    const r = Math.floor(index / cols)
    const c = index % cols
    ctx.drawImage(slice.canvas, c * (sliceW + gap), r * (sliceH + gap))
  })
  return canvas
}

/** 生成切块下载文件名 */
export function buildSliceFilename(baseName: string, row: number, col: number, rows: number, cols: number): string {
  const padLen = String(Math.max(rows, cols)).length
  const r = String(row).padStart(padLen, '0')
  const c = String(col).padStart(padLen, '0')
  return `${baseName}_${r}${c}.png`
}
