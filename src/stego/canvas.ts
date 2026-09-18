/**
 * DOM / OffscreenCanvas helpers — main thread only.
 * Never import this module from the Web Worker.
 */

export interface SanitizedImage {
  width: number;
  height: number;
  imageData: Uint8ClampedArray;
}

/**
 * Decode cover at full native resolution (naturalWidth × naturalHeight).
 * Prefer HTMLImageElement so EXIF-oriented / progressive decodes settle before sizing.
 */
export async function purgeCoverImage(file: File | Blob): Promise<SanitizedImage> {
  if (typeof document !== 'undefined') {
    return purgeViaHtmlImage(file);
  }
  return purgeViaImageBitmap(file);
}

async function purgeViaHtmlImage(file: File | Blob): Promise<SanitizedImage> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  let canvas: HTMLCanvasElement | null = null;
  try {
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Falha ao decodificar imagem de disfarce'));
      img.src = url;
    });
    if (typeof img.decode === 'function') {
      try {
        await img.decode();
      } catch {
        /* onload already fired — continue */
      }
    }

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width < 1 || height < 1) {
      throw new Error(
        'Dimensões da imagem inválidas (0×0). Aguarde o decode completo ou escolha outro ficheiro.',
      );
    }

    // Cross-check with ImageBitmap when available (must not be smaller than natural size).
    try {
      const bitmap = await createImageBitmap(img);
      try {
        if (bitmap.width < 1 || bitmap.height < 1) {
          throw new Error('ImageBitmap com dimensões zero');
        }
        if (bitmap.width < width || bitmap.height < height) {
          throw new Error(
            `Dimensões inconsistentes: natural ${width}×${height} vs bitmap ${bitmap.width}×${bitmap.height}`,
          );
        }
      } finally {
        bitmap.close();
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Dimensões inconsistentes')) {
        throw err;
      }
      /* ImageBitmap optional — HTMLImage path is authoritative */
    }

    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D indisponível');
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    if (imageData.width !== width || imageData.height !== height) {
      throw new Error(
        `getImageData devolveu ${imageData.width}×${imageData.height}, esperado ${width}×${height}`,
      );
    }

    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) {
      data[i] = 255;
    }

    return { width, height, imageData: new Uint8ClampedArray(data) };
  } finally {
    URL.revokeObjectURL(url);
    img.onload = null;
    img.onerror = null;
    img.removeAttribute('src');
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

async function purgeViaImageBitmap(file: File | Blob): Promise<SanitizedImage> {
  const bitmap = await createImageBitmap(file);
  let canvas: OffscreenCanvas | null = null;
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (width < 1 || height < 1) {
      throw new Error('Imagem de disfarce inválida (dimensões zero)');
    }

    if (typeof OffscreenCanvas === 'undefined') {
      throw new Error('Canvas indisponível neste contexto');
    }

    canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!ctx) throw new Error('OffscreenCanvas 2D indisponível');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) {
      data[i] = 255;
    }

    return { width, height, imageData: new Uint8ClampedArray(data) };
  } finally {
    bitmap.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
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
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('OffscreenCanvas 2D indisponível');
      ctx.putImageData(img, 0, 0);
      return await canvas.convertToBlob({ type: 'image/png' });
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('exportPngBlob requer thread principal (DOM)');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível');
    ctx.putImageData(img, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Falha ao exportar PNG'));
        },
        'image/png',
      );
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
