/**
 * 本地超分辨率（Real-ESRGAN x4 + onnxruntime-web）
 * - 完全在本机推理，图片与模型不上传服务器
 * - 优先使用 WebGPU 后端（支持时提速），否则回退 wasm
 * - onnx 会话单例缓存，避免重复下载/加载模型
 */

/**
 * 轻量 x4 超分模型（4.9MB），随站点同源部署。
 * 不用体积 64MB 的通用版：放大收益有限，却会让移动网络下的首次等待变成分钟级。
 */
const MODEL_URL = `${import.meta.env.BASE_URL}models/RealESRGAN_x4plus_anime_4B32F.onnx`

/** 上采样倍率 */
const SCALE = 4

/**
 * 分块推理参数。整图推理在单线程 wasm 上会把页面卡死（GitHub Pages 无 COOP/COEP，
 * onnxruntime-web 无法开线程），按 256px 分块、留 16px 重叠消缝，每块之间让出主线程。
 */
const TILE = 256
const OVERLAP = 16
/** x4 之后的输出长边上限：再大只是把耗时平方级拉长，画质上没有收益 */
const MAX_OUTPUT_EDGE = 2560

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

/** 源图长边预算：x4 后超过 MAX_OUTPUT_EDGE 的放大既慢又没有画质收益，先把输入压回来 */
export const MAX_INPUT_EDGE = Math.max(4, Math.floor(MAX_OUTPUT_EDGE / SCALE))

function fitInputSize(width: number, height: number): { w: number; h: number; shrunk: boolean } {
  const fit = Math.min(1, MAX_INPUT_EDGE / Math.max(width, height))
  return {
    w: Math.max(4, Math.round(width * fit)),
    h: Math.max(4, Math.round(height * fit)),
    shrunk: fit < 1,
  }
}

/** 开跑前就能算出的真实结果，用来提前告知尺寸和降级，不让用户等到最后才发现 */
export function predictUpscaleOutput(width: number, height: number): {
  w: number
  h: number
  ratio: number
  shrunk: boolean
} {
  const { w, h, shrunk } = fitInputSize(width, height)
  return {
    w: w * SCALE,
    h: h * SCALE,
    ratio: Math.round((w / width) * SCALE * 10) / 10,
    shrunk,
  }
}

/** RRDBNet 内部有两次下采样，喂进去的边长必须是 4 的倍数 */
function round4(n: number): number {
  return Math.max(4, Math.ceil(n / 4) * 4)
}

/** 截取源图一块（补齐到 4 的倍数）转为 NCHW float32（RGB，归一化 0~1） */
function tileTensor(
  ort: OrtLike,
  source: HTMLCanvasElement,
  x: number,
  y: number,
  tw: number,
  th: number,
): { input: unknown; pw: number; ph: number } {
  const pw = round4(tw)
  const ph = round4(th)
  const tmp = document.createElement('canvas')
  tmp.width = pw
  tmp.height = ph
  const ctx = tmp.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, pw, ph)
  ctx.drawImage(source, x, y, tw, th, 0, 0, tw, th)
  const d = ctx.getImageData(0, 0, pw, ph).data
  const n = pw * ph
  const chw = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    chw[i] = d[i * 4] / 255
    chw[n + i] = d[i * 4 + 1] / 255
    chw[2 * n + i] = d[i * 4 + 2] / 255
  }
  return { input: new ort.Tensor('float32', chw, [1, 3, ph, pw]), pw, ph }
}

/**
 * 对位图执行 x4 超分放大（分块推理）
 * @param bitmap 原始位图
 * @param onProgress 进度回调（percent 0~100）
 */
export async function upscaleImage(
  bitmap: ImageBitmap,
  onProgress?: (percent: number) => void,
): Promise<HTMLCanvasElement> {
  onProgress?.(4)
  const { ort, session } = await getSession()
  onProgress?.(12)

  // 输入预算：与 predictUpscaleOutput 共用同一套规则，预告的尺寸就是实际尺寸
  const { w, h } = fitInputSize(bitmap.width, bitmap.height)

  const source = document.createElement('canvas')
  source.width = w
  source.height = h
  const sctx = source.getContext('2d')
  if (!sctx) throw new Error('当前浏览器不支持 Canvas 2D')
  sctx.drawImage(bitmap, 0, 0, w, h)

  const result = document.createElement('canvas')
  result.width = w * SCALE
  result.height = h * SCALE
  const rctx = result.getContext('2d')
  if (!rctx) throw new Error('当前浏览器不支持 Canvas 2D')

  const inputName = session.inputNames[0] ?? 'input'
  const outName = session.outputNames[0]
  const step = TILE - OVERLAP
  const tilesX = Math.ceil(w / step)
  const tilesY = Math.ceil(h / step)
  const totalTiles = tilesX * tilesY
  let done = 0

  for (let ty = 0; ty < tilesY; ty++) {
    const y = Math.min(ty * step, Math.max(0, h - TILE))
    const th = Math.min(TILE, h - y)
    for (let tx = 0; tx < tilesX; tx++) {
      const x = Math.min(tx * step, Math.max(0, w - TILE))
      const tw = Math.min(TILE, w - x)
      const { input, pw, ph } = tileTensor(ort, source, x, y, tw, th)
      const outputs = await session.run({ [inputName]: input })
      const out = outputs[outName]
      if (!out) throw new Error('超分模型输出异常')

      const oW = pw * SCALE
      const oH = ph * SCALE
      const plane = oW * oH
      const od = out.data
      const tile = rctx.createImageData(oW, oH)
      for (let p = 0; p < plane; p++) {
        tile.data[p * 4] = clamp01(od[p]) * 255
        tile.data[p * 4 + 1] = clamp01(od[plane + p]) * 255
        tile.data[p * 4 + 2] = clamp01(od[2 * plane + p]) * 255
        tile.data[p * 4 + 3] = 255
      }
      // 补齐出的多余区域落在图像外，putImageData 会自动裁掉；重叠带由后一块覆盖
      rctx.putImageData(tile, x * SCALE, y * SCALE)

      done++
      // 每块之间让出主线程：GitHub Pages 不下发 COOP/COEP，onnxruntime-web 只能
      // 单线程跑在主线程上，不让出就会像整图推理一样把页面彻底卡死
      await new Promise((r) => setTimeout(r, 0))
      onProgress?.(12 + Math.round((done / totalTiles) * 86))
    }
  }

  onProgress?.(100)
  return result
}

/** 模型标称倍率，供 UI 展示与预算换算使用 */
export const SUPER_RESOLUTION_SCALE = SCALE
