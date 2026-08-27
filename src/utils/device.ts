/**
 * 推理后端能力探测
 *
 * `'gpu' in navigator` 只能说明属性存在，不代表真的能拿到 adapter：
 * Chrome 可通过策略禁用 WebGPU、虚拟机与部分安卓 WebView 上 navigator.gpu 存在但
 * requestAdapter() 返回 null。此时把 device 设为 'gpu' 会让推理在初始化阶段直接抛错，
 * 用户看到的是"AI 功能坏了"，而实际上回退 CPU 就能正常工作。
 */

export type InferenceDevice = 'gpu' | 'cpu'

let devicePromise: Promise<InferenceDevice> | null = null

/** 探测是否可用 WebGPU，结果进程内缓存（探测本身需异步申请 adapter） */
export function detectInferenceDevice(): Promise<InferenceDevice> {
  if (!devicePromise) {
    devicePromise = (async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
      if (!gpu?.requestAdapter) return 'cpu'
      try {
        return (await gpu.requestAdapter()) ? 'gpu' : 'cpu'
      } catch {
        return 'cpu'
      }
    })()
  }
  return devicePromise
}
