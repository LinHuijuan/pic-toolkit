/**
 * 把不同来源的 AI 进度阶段名统一成一句话的中文。
 * @imgly 与 onnxruntime 的阶段名各不相同（fetch / compute:inference / init …），
 * 这里按关键词收敛，未知阶段退回原文避免丢失信息。
 */
export function aiStageLabel(stage: string): string {
  const s = stage.toLowerCase()
  if (!s) return '处理中'
  if (s.includes('fetch') || s.includes('download')) return '下载模型'
  if (s.includes('upload') || s.includes('load')) return '准备数据'
  if (s.includes('init') || s.includes('prepare')) return '初始化'
  if (s.includes('inference') || s.includes('compute') || s.includes('predict')) return 'AI 推理'
  if (s.includes('decode')) return '解码图片'
  if (s.includes('encode') || s.includes('render') || s.includes('write')) return '输出结果'
  if (s.includes('done') || s.includes('complete')) return '完成'
  return stage
}