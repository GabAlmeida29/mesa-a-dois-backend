import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middlewares/auth';
import { HttpError } from '../lib/http-error';
import { storage } from '../storage';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'];
const FOLDERS = ['logos', 'dishes'] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, 'Formato de imagem não suportado'));
  },
});

export const uploadRoutes = Router();

uploadRoutes.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Envie um arquivo no campo "file"');
  const folder = String(req.query.folder ?? 'dishes');
  if (!FOLDERS.includes(folder as (typeof FOLDERS)[number])) {
    throw new HttpError(400, 'Pasta inválida');
  }
  const maxSize = 1600;

  let output: Buffer;
  try {
    output = await sharp(req.file.buffer, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new HttpError(400, 'Não foi possível processar a imagem');
  }

  const key = `${folder}/${new Date().getFullYear()}/${randomUUID()}.webp`;
  const url = await storage.save(key, output, 'image/webp');
  res.status(201).json({ url });
});
