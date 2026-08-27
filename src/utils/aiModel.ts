/**
 * AI 模型预下载与预热
 * - 预下载：调用 @imgly 的 preload 提前拉取抠图模型，闲时备好、用时即取
 * - 预热：用内置示例图后台跑一次抠图，提前完成 onnx 会话初始化
 *   （@imgly 每次 removeBackground 都会重建会话并重新载入模型权重到内存，
 *    即使模型已缓存仍需"准备时间"，预热可让真正使用时零等待）
 */

import { fetchSampleFile } from './sampleImage'

export type AiModelStage = 'idle' | 'downloading' | 'warming' | 'ready' | 'error'

export interface AiModelProgress {
  stage: AiModelStage
  percent: number
  /** 已下载大小（MB） */
  loadedMB: number
  /** 模型总大小（MB），未知时为 0 */
  totalMB: number
  /** 已用时长（ms） */
  elapsedMs: number
  /** 预计剩余时间（秒），无法估算时为 null */
  remainingSeconds: number | null
  message: string
}

const MB = 1024 * 1024

let prepared = false
let preparing: Promise<void> | null = null

/** 探测 WebGPU（与 removeBg.ts 保持一致） */
function detectDevice(): 'gpu' | 'cpu' {
  return typeof navigator !== 'undefined' && 'gpu' in navigator ? 'gpu' : 'cpu'
}

/** 预下载并预热 AI 抠图模型（模块级单例，避免并发重复初始化） */
export function prepareAiModel(onProgress: (p: AiModelProgress) => void): Promise<void> {
  if (prepared) {
    onProgress({
      stage: 'ready',
      percent: 100,
      loadedMB: 0,
      totalMB: 0,
      elapsedMs: 0,
      remainingSeconds: null,
      message: '模型已就绪',
    })
    return Promise.resolve()
  }
  if (preparing) return preparing
  preparing = doPrepare(onProgress)
  return preparing
}

async function doPrepare(onProgress: (p: AiModelProgress) => void): Promise<void> {
  const start = Date.now()
  const device = detectDevice()
  try {
    const { preload, removeBackground } = await import('@imgly/background-removal')

    // 阶段一：预下载模型文件（fetch 进度 key 以 'fetch:' 开头，current/total 为字节）
    onProgress({
      stage: 'downloading',
      percent: 0,
      loadedMB: 0,
      totalMB: 0,
      elapsedMs: 0,
      remainingSeconds: null,
      message: '下载 AI 模型…',
    })
    await preload({
      device,
      progress: (key: string, current: number, total: number) => {
        if (!key.startsWith('fetch')) return
        const elapsedMs = Date.now() - start
        const seconds = Math.max(elapsedMs / 1000, 0.001)
        const speed = current / seconds
        const remainingSeconds = total > 0 && speed > 0 ? (total - current) / speed : null
        const totalMB = total > 0 ? total / MB : 0
        onProgress({
          stage: 'downloading',
          percent: total > 0 ? Math.min(99, Math.round((current / total) * 100)) : 0,
          loadedMB: current / MB,
          totalMB,
          elapsedMs,
          remainingSeconds,
          message: '下载 AI 模型…',
        })
      },
    })

    // 阶段二：用示例图后台跑一次推理，预热 onnx 会话
    onProgress({
      stage: 'warming',
      percent: 99,
      loadedMB: 0,
      totalMB: 0,
      elapsedMs: Date.now() - start,
      remainingSeconds: null,
      message: '初始化模型会话…',
    })
    const file = await fetchSampleFile('scene')
    await removeBackground(file, { device })

    prepared = true
    onProgress({
      stage: 'ready',
      percent: 100,
      loadedMB: 0,
      totalMB: 0,
      elapsedMs: Date.now() - start,
      remainingSeconds: null,
      message: '模型已就绪',
    })
  } catch (error) {
    preparing = null
    throw error
  }
}

/** 将毫秒格式化为可读时长（秒 / 分秒） */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r > 0 ? `${m} 分 ${r} 秒` : `${m} 分`
}
