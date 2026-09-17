/**
 * DOM / OffscreenCanvas helpers — main thread only.
 * Never import this module from the Web Worker.
 */

export interface SanitizedImage {
  width: number;
  height: number;
  imageData: Uint8ClampedArray;
}

export async function purgeCoverImage(file: File | Blob): Promise<SanitizedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (width < 1 || height < 1) {
      throw new Error('Imagem de disfarce inválida (dimensões zero)');
    }

    let imageData: ImageData;

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
      if (!ctx) throw new Error('OffscreenCanvas 2D indisponível');
      ctx.drawImage(bitmap, 0, 0, width, height);
      imageData = ctx.getImageData(0, 0, width, height);
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D indisponível');
      ctx.drawImage(bitmap, 0, 0, width, height);
      imageData = ctx.getImageData(0, 0, width, height);
    } else {
      throw new Error('Canvas indisponível neste contexto');
    }

    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) {
      data[i] = 255;
    }

    return {
      width,
      height,
      imageData: new Uint8ClampedArray(data),
    };
  } finally {
    bitmap.close();
  }
}

export async function exportPngBlob(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Blob> {
  const clamped = new Uint8ClampedArray(imageData.length);
  clamped.set(imageData);
  for (let i = 3; i < clamped.length; i += 4) {
    clamped[i] = 255;
  }

  const img = new ImageData(clamped, width, height);

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D indisponível');
    ctx.putImageData(img, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  if (typeof document === 'undefined') {
    throw new Error('exportPngBlob requer thread principal (DOM)');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível');
  ctx.putImageData(img, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Falha ao exportar PNG'));
      },
      'image/png',
    );
  });
}
