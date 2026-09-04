/**
 * 极简单页 PDF 封装（与 zip.ts 同思路：手写二进制，零新依赖）
 *
 * 结构：Catalog → Pages → Page（整页贴一张 JPEG，DCTDecode 直存不 deflate，
 * JPEG 本身已压缩）→ Content。页面尺寸按 300dpi 把像素换算成 pt（1pt = 1/72 英寸），
 * 打印时选「实际大小」得到与排版图物理尺寸一致的成片，选「适合纸张」则自动缩放。
 * 证书照排版图是 300dpi 概念，6 寸版换算出来正好是 152×102mm 的相纸页面。
 */

/** 把 JPEG 字节组装成单页 PDF；宽高为图片像素（按 300dpi 换算页面 pt 尺寸） */
export function buildSingleImagePdf(jpeg: Uint8Array, widthPx: number, heightPx: number): Blob {
  // 页面尺寸：像素 → pt（300dpi 下 1px = 72/300 pt）。两位小数足够打印精度
  const pageW = ((widthPx / 300) * 72).toFixed(2)
  const pageH = ((heightPx / 300) * 72).toFixed(2)

  const chunks: (string | Uint8Array)[] = []
  let offset = 0
  // xref 记的是字节偏移：字符串按 1 字节/字符计（内容全 ASCII，中文只出现在下载文件名里，不进 PDF 内部）
  const push = (part: string | Uint8Array) => {
    chunks.push(part)
    offset += part.length
  }
  // 1~5 号对象的起始字节偏移
  const offsets: number[] = []

  push('%PDF-1.4\n')

  offsets[1] = offset
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  offsets[2] = offset
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')

  offsets[3] = offset
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\nendobj\n',
  )

  offsets[4] = offset
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  )
  push(jpeg)
  push('\nendstream\nendobj\n')

  offsets[5] = offset
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)

  // xref 表：每条目固定 20 字节（10 位偏移 + 空格 + 5 位代 + 空格 + 类型 + 空格 + LF）
  const xrefOffset = offset
  let xref = 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)

  return new Blob(chunks, { type: 'application/pdf' })
}

/** 把画布按 JPEG 编码后打包成单页 PDF（质量 0.95：证件照打印够用且体积可控） */
export async function canvasToPdfBlob(canvas: HTMLCanvasElement, quality = 0.95): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  if (!blob) {
    throw new Error('图片编码失败')
  }
  const jpeg = new Uint8Array(await blob.arrayBuffer())
  return buildSingleImagePdf(jpeg, canvas.width, canvas.height)
}
