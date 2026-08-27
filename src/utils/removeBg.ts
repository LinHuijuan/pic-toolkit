/**
 * AI 抠图工具（@imgly/background-removal）
 * 完全在浏览器本地执行，图片不上传任何服务器
 */

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
  // （首次约 800KB JS + 40MB 模型），首屏不占用体积与启动耗时。
  const { removeBackground } = await import('@imgly/background-removal')

  // 能力检测：支持 WebGPU 的桌面浏览器用 GPU 推理可显著提速，否则回退 CPU
  const canUseGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  const device = canUseGpu ? ('gpu' as const) : ('cpu' as const)

  const blob = await removeBackground(imageSrc, {
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
    device,
  })

  onProgress?.({ percent: 100, stage: '完成' })
  return blob
}

/** 将抠图结果叠加到指定背景色上 */
export function composeBackground(blob: Blob, bgColor: string | null): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('当前浏览器不支持 Canvas 2D'))
        return
      }
      if (bgColor) {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      resolve(canvas)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('抠图结果解析失败'))
    }
    img.src = url
  })
}

/** 将抠图结果（PNG Blob）融合到指定背景图上，输出尺寸与背景图一致（cover 铺满） */
export function composeBackgroundImage(
  blob: Blob,
  bg: HTMLImageElement | HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const bw = bg instanceof HTMLImageElement ? bg.naturalWidth : bg.width
      const bh = bg instanceof HTMLImageElement ? bg.naturalHeight : bg.height
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, bw)
      canvas.height = Math.max(1, bh)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('当前浏览器不支持 Canvas 2D'))
        return
      }
      ctx.drawImage(bg as HTMLImageElement, 0, 0, canvas.width, canvas.height)
      const scale = Math.max(canvas.width / img.width, canvas.height / img.height)
      const dw = img.width * scale
      const dh = img.height * scale
      ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
      URL.revokeObjectURL(url)
      resolve(canvas)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('抠图结果解析失败'))
    }
    img.src = url
  })
}
