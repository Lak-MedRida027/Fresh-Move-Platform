/**
 * Browser image pipeline for the admin uploader:
 * decode (EXIF orientation applied) → 3 WebP sizes + a tiny placeholder.
 *
 * Re-encoding from canvas pixels writes a brand-new file, so EXIF, GPS and
 * any other metadata in the original are dropped by construction.
 *
 * WebP encoding uses the browser's canvas encoder when it has one. Browsers
 * without it (canvas falls back to PNG) get a WebAssembly encoder, loaded only
 * then.
 */
import { IMAGE_WIDTHS, type ImageSize } from '../media';
import { fitLongSide, MAX_INPUT_BYTES, MIN_LONG_SIDE, PLACEHOLDER_SIDE, SIZES, WEBP_QUALITY } from './sizes';

export type PipelineError = 'too_big' | 'not_image' | 'unsupported' | 'too_small' | 'encode_failed';

export class ImageError extends Error {
  constructor(public code: PipelineError) {
    super(code);
  }
}

export interface Processed {
  /** Size of the lg file (the original aspect ratio, long side ≤ 1600). */
  width: number;
  height: number;
  files: Record<ImageSize, Blob>;
  placeholder: string;
}

let nativeWebp: Promise<boolean> | undefined;
/** Whether canvas.toBlob can write WebP (Chrome, Firefox, Edge: yes). */
function canvasWritesWebp(): Promise<boolean> {
  nativeWebp ??= new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    c.toBlob((b) => resolve(b?.type === 'image/webp'), 'image/webp', WEBP_QUALITY);
  });
  return nativeWebp;
}

async function encodeWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  if (await canvasWritesWebp()) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality));
    if (blob?.type === 'image/webp') return blob;
  }
  const { default: encode } = await import('@jsquash/webp/encode.js');
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  const buffer = await encode(pixels, { quality: Math.round(quality * 100) });
  return new Blob([buffer], { type: 'image/webp' });
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Some formats (HEIC on Safari) decode in <img> but not in createImageBitmap.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } catch {
      throw new ImageError('unsupported');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return c;
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function processImage(file: File): Promise<Processed> {
  if (file.size > MAX_INPUT_BYTES) throw new ImageError('too_big');
  // Phones sometimes send HEIC with an empty type; let the decoder decide then.
  if (file.type && !file.type.startsWith('image/')) throw new ImageError('not_image');
  const bitmap = await decode(file);
  try {
    if (Math.max(bitmap.width, bitmap.height) < MIN_LONG_SIDE) throw new ImageError('too_small');
    // Draw the largest size from the original, then the smaller ones from it:
    // no canvas is ever bigger than 1600 px (phones limit canvas memory).
    const files = {} as Record<ImageSize, Blob>;
    const lgSize = fitLongSide(bitmap.width, bitmap.height, IMAGE_WIDTHS.lg);
    const lg = draw(bitmap, lgSize.width, lgSize.height);
    for (const size of [...SIZES].reverse()) {
      const { width, height } = fitLongSide(lg.width, lg.height, IMAGE_WIDTHS[size]);
      const canvas = size === 'lg' ? lg : draw(lg, width, height);
      files[size] = await encodeWebp(canvas, WEBP_QUALITY);
    }
    const tiny = fitLongSide(lg.width, lg.height, PLACEHOLDER_SIDE);
    const placeholder = await dataUrl(await encodeWebp(draw(lg, tiny.width, tiny.height), 0.5));
    return { width: lg.width, height: lg.height, files, placeholder };
  } catch (e) {
    throw e instanceof ImageError ? e : new ImageError('encode_failed');
  } finally {
    bitmap.close();
  }
}
