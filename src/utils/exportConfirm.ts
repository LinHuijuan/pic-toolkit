/**
 * 批量导出前的清单确认
 *
 * 多文件打包下载前，先弹一张清单卡给用户过目（文件名、每张大小、合计、预计 ZIP 体积），
 * 确认后再真正打包，避免用户打包完才发现某张不符合预期。单张时直接下载、不进弹窗。
 */
import { reactive } from 'vue'
import { saveMany } from './zip'

export interface ExportRow {
  name: string
  size: number
}

export const exportSummary = reactive({
  visible: false,
  rows: [] as ExportRow[],
  total: 0,
  zipName: '',
  onConfirm: () => {},
  onCancel: () => {},
})

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export const totalLabel = () => formatSize(exportSummary.total)
export const rowLabel = (size: number) => formatSize(size)

/**
 * 打开确认弹窗，返回用户是否确认。
 * 调用方按返回值决定是否继续真正的下载。
 */
export function openExportConfirm(
  rows: ExportRow[],
  total: number,
  zipName: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    exportSummary.rows = rows
    exportSummary.total = total
    exportSummary.zipName = zipName
    exportSummary.visible = true
    exportSummary.onConfirm = () => {
      exportSummary.visible = false
      resolve(true)
    }
    exportSummary.onCancel = () => {
      exportSummary.visible = false
      resolve(false)
    }
  })
}

/**
 * 批量导出的统一出口：多张弹清单确认后再打包；单张/空则直接走 saveMany。
 * @returns 是否真正执行了导出
 */
export async function confirmExportFlow(
  files: File[],
  zipName: string,
): Promise<boolean> {
  if (files.length <= 1) {
    await saveMany(files, zipName)
    return files.length === 1
  }
  const rows = files.map((f) => ({ name: f.name, size: f.size }))
  const total = files.reduce((s, f) => s + f.size, 0)
  const ok = await openExportConfirm(rows, total, zipName)
  if (ok) await saveMany(files, zipName)
  return ok
}