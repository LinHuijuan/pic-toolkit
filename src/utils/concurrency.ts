/**
 * 批量任务的限并发执行器。
 *
 * 图片编解码（canvas.toBlob）在部分浏览器走后台编码线程，把一批图片开 N 个并发槽
 * 一起推进，能让编码线程彼此重叠，而不是逐张等在一条关卡上。并发数取一个不大不小的
 * 值：太小等于串行，太大又会让多张大图同时占内存。
 */
export async function runConcurrent<T>(
  size: number,
  workerCount: number,
  task: (index: number) => Promise<T>,
  isCancelled?: () => boolean,
): Promise<PromiseSettledResult<T>[]> {
  if (size <= 0) return []
  const results: PromiseSettledResult<T>[] = new Array(size)
  const slots = Math.max(1, Math.min(workerCount, size))
  let cursor = 0

  await Promise.all(
    Array.from({ length: slots }, async () => {
      for (;;) {
        // 取消在取下一个任务前判断：正在处理的那一张只能等它跑完，
        // 但后续任务不会再有新槽启动，批量会尽快停下。
        if (isCancelled?.()) return
        const index = cursor++
        if (index >= size) return
        results[index] = await Promise.allSettled([task(index)]).then(([r]) => r)
      }
    }),
  )
  return results
}