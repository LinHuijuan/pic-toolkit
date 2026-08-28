/**
 * AI 抠图工具（@imgly/background-removal）
 * 完全在浏览器本地执行，图片不上传任何服务器
 */

import { detectInferenceDevice } from './device'

/**
 * 抠图模型档位：isnet_quint8（42.3MB）。
 * @imgly 默认档 isnet_fp16（84.1MB），体积翻倍但抠图边缘提升有限，
 * 移动端首次加载会退化成分钟级等待，故显式降到量化版。
 * 预热与推理必须共用同一档，否则会各下载一份模型。
 */
export const BG_MODEL = 'isnet_quint8' as const

export interface RemoveBgProgress {
  percent: number
  stage: string
}

/**
 * 执行 AI 抠图
 * @param imageSrc 图片 DataURL 或 URL
 * @param onProgress 进度回调（首次运行需下载模型，耗时较长）
 * @returns 透明背景 PNG Blob
 */
export async function removeImageBackground(
  imageSrc: string,
  onProgress?: (progress: RemoveBgProgress) => void,
): Promise<Blob> {
  onProgress?.({ percent: 0, stage: '准备模型…' })
  // 按需动态加载 @imgly/background-removal：onnxruntime / wasm 仅在真正抠图时下载
  // （首次约 800KB JS + 42MB 模型），首屏不占用体积与启动耗时。
  const { removeBackground } = await import('@imgly/background-removal')

  const device = await detectInferenceDevice()

  const run = (target: typeof device) =>
    removeBackground(imageSrc, {
      model: BG_MODEL,
      progress: (key: string, current: number, total: number) => {
        // key 为 'fetch:xxx' / 'compute:inference' / 'compute:decode' 等阶段
        let percent = Math.round((current / Math.max(total, 1)) * 100)
        let stage = '处理中…'
        if (key.startsWith('fetch')) {
          stage = '下载 AI 模型…'
          percent = Math.round(percent / 2)
        } else if (key === 'compute:inference') {
          stage = 'AI 识别主体…'
          percent = 50 + Math.round((percent / 100) * 40)
        } else if (key.startsWith('compute')) {
          stage = '生成抠图结果…'
          percent = 90 + Math.round((percent / 100) * 10)
        }
        onProgress?.({ percent: Math.min(percent, 99), stage })
      },
      output: {
        format: 'image/png',
        quality: 1,
      },
      device: target,
    })

  let blob: Blob
  try {
    blob = await run(device)
  } catch (error) {
    // requestAdapter() 成功不代表 webgpu 会话一定建得起来（驱动黑名单、Dawn
    // 初始化失败都会走到这里）。回退 CPU 只是慢，总比整个功能不可用强。
    if (device !== 'gpu') throw error
    console.warn('WebGPU 推理会话创建失败，回退 CPU', error)
    onProgress?.({ percent: 0, stage: 'GPU 不可用，改用 CPU…' })
    blob = await run('cpu')
  }

  onProgress?.({ percent: 100, stage: '完成' })
  return blob
}

/**
 * 合成入参：既可以是 AI 返回的 PNG Blob，也可以是用户擦除/描边后的画布。
 * 抠图工作室需要在画布上落笔，所以合成链路必须能直接吃画布。
 */
export type CutoutSource = Blob | HTMLCanvasElement

interface Drawable {
  node: HTMLImageElement | HTMLCanvasElement
  width: number
  height: number
}

/** 统一解码成可 drawImage 的对象 */
function loadDrawable(src: CutoutSource): Promise<Drawable> {
  if (src instanceof HTMLCanvasElement) {
    return Promise.resolve({ node: src, width: src.width, height: src.height })
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(src)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ node: img, width: img.width, height: img.height })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('抠图结果解析失败'))
    }
    img.src = url
  })
}

/**
 * 把抠图结果解码成独立画布，作为擦除/描边的工作面。
 * 传入画布时返回副本，保证「重置擦除」随时能拿回干净底稿。
 */
export async function loadCutoutCanvas(src: CutoutSource): Promise<HTMLCanvasElement> {
  const { node, width, height } = await loadDrawable(src)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.drawImage(node, 0, 0)
  return canvas
}

/** 将抠图结果叠加到指定背景色上 */
export async function composeBackground(
  src: CutoutSource,
  bgColor: string | null,
): Promise<HTMLCanvasElement> {
  const { node, width, height } = await loadDrawable(src)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D')
  if (bgColor) {
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(node, 0, 0)
  return canvas
}

/** 将抠图结果融合到指定背景图上，输出尺寸与背景图一致（cover 铺满） */
export async function composeBackgroundImage(
  src: CutoutSource,
  bg: HTMLImageElement | HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const { node, width, height } = await loadDrawable(src)
  const bw = bg instanceof HTMLImageElement ? bg.naturalWidth : bg.width
  const bh = bg instanceof HTMLImageElement ? bg.naturalHeight : bg.height
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, bw)
  canvas.height = Math.max(1, bh)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D')
  ctx.drawImage(bg, 0, 0, canvas.width, canvas.height)
  const scale = Math.max(canvas.width / width, canvas.height / height)
  const dw = width * scale
  const dh = height * scale
  ctx.drawImage(node, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
  return canvas
}
