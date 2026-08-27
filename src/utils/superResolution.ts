/**
 * 本地超分辨率（Real-ESRGAN x4 + onnxruntime-web）
 * - 完全在本机推理，图片与模型不上传服务器
 * - 优先使用 WebGPU 后端（支持时提速），否则回退 wasm
 * - onnx 会话单例缓存，避免重复下载/加载模型
 */

/** 模型权重来源（HuggingFace 官方托管，浏览器可直接 fetch） */
const MODEL_URL = 'https://huggingface.co/qualcomm/Real-ESRGAN-x4plus/resolve/main/Real-ESRGAN-x4plus.onnx'

/** 上采样倍率 */
const SCALE = 4

interface OrtLike {
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown
  InferenceSession: {
    create: (url: string, options?: unknown) => Promise<InferenceSessionLike>
  }
  env: { wasm: { numThreads?: number } }
}

interface InferenceSessionLike {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>
  inputNames: string[]
  outputNames: string[]
}

let ortPromise: Promise<OrtLike> | null = null
let sessionPromise: Promise<{ ort: OrtLike; session: InferenceSessionLike }> | null = null

/** 加载 onnxruntime：优先 WebGPU，失败回退 wasm（保证跨设备可用） */
async function loadOrt(): Promise<OrtLike> {
  if (ortPromise) return ortPromise
  ortPromise = (async () => {
    try {
      const webgpu = (await import('onnxruntime-web/webgpu')) as unknown as OrtLike
      return webgpu
    } catch {
      const wasm = (await import('onnxruntime-web')) as unknown as OrtLike
      return wasm
    }
  })()
  return ortPromise
}

/** 获取（缓存）推理会话 */
async function getSession(): Promise<{ ort: OrtLike; session: InferenceSessionLike }> {
  if (sessionPromise) return sessionPromise
  sessionPromise = (async () => {
    const ort = await loadOrt()
    try {
      const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['webgpu'] })
      return { ort, session }
    } catch {
      const session = await ort.InferenceSession.create(MODEL_URL)
      return { ort, session }
    }
  })()
  return sessionPromise
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function canvasFromBitmap(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  return canvas
}

function padCanvas(src: HTMLCanvasElement, pw: number, ph: number): HTMLCanvasElement {
  if (src.width === pw && src.height === ph) return src
  const canvas = document.createElement('canvas')
  canvas.width = pw
  canvas.height = ph
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, pw, ph)
  ctx.drawImage(src, 0, 0)
  return canvas
}

/**
 * 对位图执行 x4 超分放大
 * @param bitmap 原始位图
 * @param onProgress 进度回调（percent 0~100）
 */
export async function upscaleImage(
  bitmap: ImageBitmap,
  onProgress?: (percent: number) => void,
): Promise<HTMLCanvasElement> {
  onProgress?.(5)
  const { ort, session } = await getSession()
  onProgress?.(15)

  const src = canvasFromBitmap(bitmap)
  const w = src.width
  const h = src.height
  // Real-ESRGAN 需输入尺寸为 4 的倍数
  const pw = Math.ceil(w / SCALE) * SCALE
  const ph = Math.ceil(h / SCALE) * SCALE
  const padded = padCanvas(src, pw, ph)

  const ctx = padded.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D')
  const imageData = ctx.getImageData(0, 0, pw, ph).data

  // 转为 NCHW float32（RGB，归一化 0~1）
  const pixelCount = pw * ph
  const chw = new Float32Array(3 * pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    chw[i] = imageData[i * 4] / 255
    chw[pixelCount + i] = imageData[i * 4 + 1] / 255
    chw[2 * pixelCount + i] = imageData[i * 4 + 2] / 255
  }

  const inputName = session.inputNames[0] ?? 'input'
  const input = new ort.Tensor('float32', chw, [1, 3, ph, pw])
  onProgress?.(40)
  const outputs = await session.run({ [inputName]: input })
  onProgress?.(75)

  const outName = session.outputNames[0]
  const out = outputs[outName]
  if (!out) throw new Error('超分模型输出异常')
  const outW = pw * SCALE
  const outH = ph * SCALE
  const plane = outH * outW
  const outData = out.data

  const result = document.createElement('canvas')
  result.width = outW
  result.height = outH
  const rctx = result.getContext('2d')
  if (!rctx) throw new Error('当前浏览器不支持 Canvas 2D')
  const outImage = rctx.createImageData(outW, outH)
  for (let p = 0; p < plane; p++) {
    outImage.data[p * 4] = clamp01(outData[p]) * 255
    outImage.data[p * 4 + 1] = clamp01(outData[plane + p]) * 255
    outImage.data[p * 4 + 2] = clamp01(outData[2 * plane + p]) * 255
    outImage.data[p * 4 + 3] = 255
  }
  rctx.putImageData(outImage, 0, 0)
  onProgress?.(90)

  // 裁掉补齐区域，回到原图 x4 尺寸
  if (outW === w * SCALE && outH === h * SCALE) return result
  const cropped = document.createElement('canvas')
  cropped.width = w * SCALE
  cropped.height = h * SCALE
  cropped.getContext('2d')?.drawImage(result, 0, 0, w * SCALE, h * SCALE, 0, 0, w * SCALE, h * SCALE)
  onProgress?.(100)
  return cropped
}

/** 方便占位导出（避免未使用告警） */
export const SUPER_RESOLUTION_SCALE = SCALE
