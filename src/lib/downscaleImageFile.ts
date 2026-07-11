/**
 * Resize so the longest side is at most maxDim, then encode as JPEG for smaller uploads.
 * (PNG transparency becomes white background — fine for chat photos.)
 */
export async function downscaleImageFileToJpeg(
  file: File,
  options?: { maxDim?: number; quality?: number }
): Promise<Blob> {
  const maxDim = options?.maxDim ?? 1280
  const quality = options?.quality ?? 0.85

  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are allowed.')
  }
  if (file.type.startsWith('video/')) {
    throw new Error('Video is not supported.')
  }

  const bitmap = await createImageBitmap(file)
  try {
    const w = bitmap.width
    const h = bitmap.height
    let nw = w
    let nh = h
    if (w > maxDim || h > maxDim) {
      if (w >= h) {
        nw = maxDim
        nh = Math.max(1, Math.round((h * maxDim) / w))
      } else {
        nh = maxDim
        nw = Math.max(1, Math.round((w * maxDim) / h))
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = nw
    canvas.height = nh
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not available')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, nw, nh)
    ctx.drawImage(bitmap, 0, 0, nw, nh)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Could not encode image'))
        },
        'image/jpeg',
        quality
      )
    })
  } finally {
    bitmap.close()
  }
}
