/**
 * AI 模型预下载与预热
 * - 预下载：调用 @imgly 的 preload 提前拉取抠图模型，闲时备好、用时即取
 * - 预热：用内置示例图后台跑一次抠图，提前完成 onnx 会话初始化
 *   （@imgly 每次 removeBackground 都会重建会话并重新载入模型权重到内存，
 *    即使模型已缓存仍需"准备时间"，预热可让真正使用时零等待）
 */

import { reactive } from 'vue'
import { fetchSampleFile } from './sampleImage'
import { detectInferenceDevice } from './device'
import { BG_MODEL } from './removeBg'

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

/** 模型是否已就绪（只读查询，不会触发下载） */
export function isAiModelReady(): boolean {
  return prepared
}

/**
 * 共享的模型状态：原本进度只能由发起方组件持有，切到别的工具再回来进度就丢了、
 * 证件照与抠图也会各自重复触发下载。提升到模块级后所有视图绑定同一份状态。
 */
export const aiModel = reactive<AiModelProgress>({
  stage: 'idle',
  percent: 0,
  loadedMB: 0,
  totalMB: 0,
  elapsedMs: 0,
  remainingSeconds: null,
  message: '',
})

function setProgress(p: Partial<AiModelProgress>) {
  Object.assign(aiModel, p)
}

/** 预下载并预热 AI 抠图模型（模块级单例，避免并发重复初始化） */
export function prepareAiModel(): Promise<void> {
  if (prepared) {
    setProgress({ stage: 'ready', percent: 100, message: '模型已就绪' })
    return Promise.resolve()
  }
  if (preparing) return preparing
  preparing = doPrepare()
  return preparing
}

async function doPrepare(): Promise<void> {
  const start = Date.now()
  const device = await detectInferenceDevice()
  try {
    const { preload, removeBackground } = await import('@imgly/background-removal')

    // 阶段一：预下载模型文件（fetch 进度 key 以 'fetch:' 开头，current/total 为字节）
    setProgress({
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
      model: BG_MODEL,
      progress: (key: string, current: number, total: number) => {
        if (!key.startsWith('fetch')) return
        const elapsedMs = Date.now() - start
        const seconds = Math.max(elapsedMs / 1000, 0.001)
        const speed = current / seconds
        const remainingSeconds = total > 0 && speed > 0 ? (total - current) / speed : null
        const totalMB = total > 0 ? total / MB : 0
        setProgress({
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
    setProgress({
      stage: 'warming',
      percent: 99,
      loadedMB: 0,
      totalMB: 0,
      elapsedMs: Date.now() - start,
      remainingSeconds: null,
      message: '初始化模型会话…',
    })
    const file = await fetchSampleFile('scene')
    await removeBackground(file, { device, model: BG_MODEL })

    prepared = true
    setProgress({
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
    setProgress({
      stage: 'error',
      message: error instanceof Error ? error.message : '模型下载失败，请检查网络后重试',
    })
    throw error
  }
}
