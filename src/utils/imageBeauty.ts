/**
 * 本地美颜 / 人像修图（MediaPipe 人脸关键点 + 磨皮提亮）
 * - 完全在本机检测与修图，人脸信息不上传服务器
 * - MediaPipe FaceLandmarker 以 wasm 加载，模型走官方 CDN
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

/** wasm 运行时（jsDelivr CDN） */
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
/** 人脸关键点模型（Google 官方托管） */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

type Pt = { x: number; y: number }

let landmarkerPromise: Promise<FaceLandmarker> | null = null

/** 获取（缓存）人脸检测器 */
async function getLandmarker(): Promise<FaceLandmarker> {
  if (landmarkerPromise) return landmarkerPromise
  landmarkerPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
    return FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'IMAGE',
      numFaces: 4,
      minFaceDetectionConfidence: 0.5,
    })
  })()
  return landmarkerPromise
}

export interface BeautyOptions {
  /** 磨皮强度 0~100 */
  smoothness: number
  /** 提亮 -30~30 */
  brightness: number
}

function canvasFromBitmap(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  return canvas
}

/** 用 Canvas 2D filter blurt 生成轻度模糊图（人脸区域磨皮的底图） */
function blurredCanvas(canvas: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = canvas.width
  c.height = canvas.height
  const ctx = c.getContext('2d')
  if (!ctx) return canvas
  ctx.filter = `blur(${radius}px)`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'
  return c
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/**
 * 对位图执行美颜（人脸磨皮 + 提亮）
 * @param bitmap 原始位图
 * @param options smoothness 0~100，brightness -30~30
 */
export async function beautifyImage(
  bitmap: ImageBitmap,
  options: BeautyOptions,
  onProgress?: (percent: number) => void,
): Promise<HTMLCanvasElement> {
  onProgress?.(10)
  const landmarker = await getLandmarker()
  onProgress?.(30)

  const src = canvasFromBitmap(bitmap)
  const w = src.width
  const h = src.height
  const ctx = src.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D')

  const imgData = ctx.getImageData(0, 0, w, h)
  const d = imgData.data

  const faces = ((landmarker.detect(src).faceLandmarks ?? []) as Pt[][])
  const smoothFactor = Math.max(0, Math.min(1, options.smoothness / 100))
  const bright = options.brightness / 100

  let blurred: HTMLCanvasElement | null = null
  let bd: Uint8ClampedArray | null = null
  if (smoothFactor > 0) {
    const radius = Math.max(2, Math.round(Math.min(w, h) * (0.004 + options.smoothness * 0.00008)))
    blurred = blurredCanvas(src, radius)
    bd = blurred.getContext('2d')?.getImageData(0, 0, w, h).data ?? null
  }

  onProgress?.(55)

  // 逐张人脸：在椭圆区域内做磨皮与提亮混合（径向渐变衰减，边缘平滑过渡到原图）
  for (const face of faces) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0
    for (const p of face) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    const cx = ((minX + maxX) / 2) * w
    const cy = ((minY + maxY) / 2) * h
    const rx = ((maxX - minX) / 2) * w * 1.05
    const ry = ((maxY - minY) / 2) * h * 1.15
    const x0 = Math.max(0, Math.floor(cx - rx))
    const x1 = Math.min(w - 1, Math.ceil(cx + rx))
    const y0 = Math.max(0, Math.floor(cy - ry))
    const y1 = Math.min(h - 1, Math.ceil(cy + ry))

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x - cx) / rx
        const dy = (y - cy) / ry
        const dist2 = dx * dx + dy * dy
        if (dist2 >= 1) continue
        // 中心强、边缘弱的平滑蒙版（擦除边界硬边）
        const alpha = smoothFactor * (1 - dist2)
        const idx = (y * w + x) * 4
        for (let c = 0; c < 3; c++) {
          let val = d[idx + c]
          if (bd) val = val + (bd[idx + c] - val) * alpha
          val = val * (1 + bright)
          d[idx + c] = clamp255(val)
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0)
  onProgress?.(95)
  return src
}
