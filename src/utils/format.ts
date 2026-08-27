/** 通用展示格式化，供所有视图复用（避免依赖具体业务模块） */

/** 将毫秒格式化为可读时长（秒 / 分秒） */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r > 0 ? `${m} 分 ${r} 秒` : `${m} 分`
}
