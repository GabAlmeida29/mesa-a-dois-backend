import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { HttpError } from '../lib/http-error';
import { storage } from '../storage';

const MAX_SIZE_BY_FOLDER = { logos: 1600, dishes: 1600, avatars: 512 } as const;
const MAX_INPUT_PIXELS = 50_000_000;
const WEBP_QUALITY = 80;

export type ImageFolder = keyof typeof MAX_SIZE_BY_FOLDER;

export const isImageFolder = (value: unknown): value is ImageFolder =>
  typeof value === 'string' && Object.hasOwn(MAX_SIZE_BY_FOLDER, value);

export const imageService = {
  async store(buffer: Buffer, folder: ImageFolder) {
    const size = MAX_SIZE_BY_FOLDER[folder];
    let output: Buffer;
    try {
      output = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch {
      throw new HttpError(400, 'Não foi possível processar a imagem');
    }
    const key = `${folder}/${new Date().getFullYear()}/${randomUUID()}.webp`;
    return storage.save(key, output, 'image/webp');
  },
};
