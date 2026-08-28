/**
 * AI 长任务的模块级登记表
 *
 * 推理的 promise 原本握在视图里：用户切去别的工具再回来，视图已销毁、结果没人接收，
 * 只能从头再等一次。这里按工具 key 保存「输入文件 + 进度 + promise + 结果」，
 * 视图重新挂载时先查这张表 —— 还在跑的就接着显示进度，跑完的直接取结果。
 *
 * 记录用 shallowReactive：只有这一层字段会整体换值，结果内部（笔迹点数组、
 * 画布等）不需要也不值得被深度代理，逐层建代理在热路径上纯属开销。
 */

import { shallowReactive } from 'vue'

export type AiJobStatus = 'idle' | 'running' | 'done' | 'error'

export type ReportProgress = (percent: number, stage?: string) => void

interface JobRecord {
  status: AiJobStatus
  input: File | null
  variant: string | null
  result: unknown
  percent: number
  stage: string
  error: string | null
  elapsedMs: number
  startedAt: number
  runId: number
  promise: Promise<unknown> | null
}

export interface AiJob<T> {
  readonly status: AiJobStatus
  readonly input: File | null
  /** 当前任务的参数签名，视图重挂载时按它接回同一次在跑的任务 */
  readonly variant: string | null
  readonly result: T | null
  readonly percent: number
  readonly stage: string
  readonly error: string | null
  readonly elapsedMs: number
  /**
   * 同一张图正在跑或已跑完就直接复用，否则开一个新任务。
   * @param variant 参数签名，输入与签名都没变才算同一次任务；参数变了换个签名即可强制重跑
   */
  run(input: File, task: (report: ReportProgress) => Promise<T>, variant?: string): Promise<T>
}

const records = new Map<string, JobRecord>()

let ticker: number | undefined

function startTicker(r: JobRecord) {
  if (ticker === undefined) {
    ticker = window.setInterval(() => {
      let anyRunning = false
      records.forEach((rec) => {
        if (rec.status !== 'running') return
        rec.elapsedMs = Date.now() - rec.startedAt
        anyRunning = true
      })
      if (!anyRunning && ticker !== undefined) {
        window.clearInterval(ticker)
        ticker = undefined
      }
    }, 250)
  }
  r.elapsedMs = 0
  r.startedAt = Date.now()
}

function clear(r: JobRecord) {
  r.status = 'idle'
  r.input = null
  r.variant = null
  r.result = null
  r.percent = 0
  r.stage = ''
  r.error = null
  r.elapsedMs = 0
  r.promise = null
}

export function useAiJob<T>(key: string): AiJob<T> {
  let r = records.get(key)
  if (!r) {
    r = shallowReactive<JobRecord>({
      status: 'idle',
      input: null,
      variant: null,
      result: null,
      percent: 0,
      stage: '',
      error: null,
      elapsedMs: 0,
      startedAt: 0,
      runId: 0,
      promise: null,
    })
    records.set(key, r)
  }
  const rec = r

  function run(
    input: File,
    task: (report: ReportProgress) => Promise<T>,
    variant?: string,
  ): Promise<T> {
    const sig = variant ?? null
    if (rec.input === input && rec.variant === sig) {
      if (rec.status === 'running' && rec.promise) return rec.promise as Promise<T>
      if (rec.status === 'done') return Promise.resolve(rec.result as T)
    }
    clear(rec)
    const runId = ++rec.runId
    rec.input = input
    rec.variant = sig
    rec.status = 'running'
    startTicker(rec)

    const report: ReportProgress = (percent, stage) => {
      if (rec.runId !== runId) return
      rec.percent = Math.round(Math.min(100, Math.max(0, percent)))
      if (stage !== undefined) rec.stage = stage
    }

    const promise = task(report).then(
      (result) => {
        // 期间可能已被新任务替换，旧任务的回写一律作废
        if (rec.runId === runId) {
          rec.result = result
          rec.status = 'done'
          rec.percent = 100
          rec.elapsedMs = Date.now() - rec.startedAt
        }
        return result
      },
      (error: unknown) => {
        if (rec.runId === runId) {
          rec.status = 'error'
          rec.error = error instanceof Error ? error.message : String(error)
          rec.elapsedMs = Date.now() - rec.startedAt
        }
        throw error
      },
    )
    rec.promise = promise
    return promise
  }

  return {
    get status() {
      return rec.status
    },
    get input() {
      return rec.input
    },
    get variant() {
      return rec.variant
    },
    get result() {
      return rec.result as T | null
    },
    get percent() {
      return rec.percent
    },
    get stage() {
      return rec.stage
    },
    get error() {
      return rec.error
    },
    get elapsedMs() {
      return rec.elapsedMs
    },
    run,
  }
}
