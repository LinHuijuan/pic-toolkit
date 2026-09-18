/**
 * 对已加载图片做旋转 / 翻转：原地替换 bitmap，不改变调用方持有的引用。
 *
 * 供拼图、九宫格、证件照等缺旋转入口的工具复用，UI 上每次点击即对当前图
 * 再转 90° 或镜像一次，无需额外维护「变换状态栈」。用完记得关旧 bitmap，避免泄漏。
 */

import { applyTransform, type EditTransform } from './imageEdit'
import type { LoadedImage } from './imageLoader'

export type RotFlipAction = 'r90' | 'flipH' | 'flipV'

export async function applyRotFlip(img: LoadedImage, action: RotFlipAction): Promise<void> {
  const t: EditTransform = { rotation: 0, flipH: false, flipV: false }
  if (action === 'r90') t.rotation = 90
  else if (action === 'flipH') t.flipH = true
  else t.flipV = true

  const canvas = applyTransform(img.bitmap, t)
  img.bitmap.close()
  const next = await createImageBitmap(canvas)
  img.bitmap = next
  img.width = next.width
  img.height = next.height
}