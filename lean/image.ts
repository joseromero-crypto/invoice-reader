import sharp from 'sharp';
import type { ImageInput } from './transcribe.ts';

// Same photo prep in the worker and the bench: EXIF-rotate, ≤2576 px on the long edge, JPEG q85.
export async function prepareImage(photo: Buffer): Promise<ImageInput> {
  const jpeg = await sharp(photo).rotate().resize({ width: 2576, height: 2576, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { mediaType: 'image/jpeg', base64: jpeg.toString('base64') };
}
