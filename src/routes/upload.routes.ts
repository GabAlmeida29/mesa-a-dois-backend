import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middlewares/auth';
import { HttpError } from '../lib/http-error';
import { imageService, isImageFolder } from '../services/image.service';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, 'Formato de imagem não suportado'));
  },
});

export const uploadRoutes = Router();

uploadRoutes.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Envie um arquivo no campo "file"');
  const folder = req.query.folder ?? 'dishes';
  if (!isImageFolder(folder)) throw new HttpError(400, 'Pasta inválida');
  res.status(201).json({ url: await imageService.store(req.file.buffer, folder) });
});
