const MAX_IMAGE_EDGE = 1600;

/** 把选中的图片读成像素，等比缩到最长边不超过二维码解码上限。 */
export async function readCheckinImageData(source: File | string): Promise<ImageData> {
  const loaded = await loadImageSource(source);
  try {
    const { width, height } = loaded;
    if (!width || !height) throw new Error('image has no size');
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2d context unavailable');
    context.drawImage(loaded.source, 0, 0, targetWidth, targetHeight);
    return context.getImageData(0, 0, targetWidth, targetHeight);
  } finally {
    loaded.release();
  }
}

/** 优先用 ImageBitmap 解码文件；读完后临时位图 / objectURL 都要释放。 */
async function loadImageSource(
  source: File | string,
): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof source !== 'string' && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(source);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // 位图解码器不支持当前格式时，退回 Image 再试一次。
    }
  }

  const objectUrl = typeof source === 'string' ? '' : URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('image load failed'));
      image.src = objectUrl || (source as string);
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (reason) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    throw reason;
  }
}
