import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';

export interface StorageDriver {
  save(key: string, data: Buffer, contentType: string): Promise<string>;
  remove(url: string): Promise<void>;
}

class LocalStorage implements StorageDriver {
  private readonly root = path.resolve(env.UPLOAD_DIR);

  async save(key: string, data: Buffer): Promise<string> {
    const target = path.join(this.root, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/uploads/${key}`;
  }

  async remove(url: string): Promise<void> {
    const marker = '/uploads/';
    const idx = url.indexOf(marker);
    if (idx < 0) return;
    const key = url.slice(idx + marker.length);
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root)) return;
    await unlink(target).catch(() => undefined);
  }
}

class S3Storage implements StorageDriver {
  private readonly client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });

  async save(key: string, data: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: data,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${(env.S3_PUBLIC_URL ?? '').replace(/\/$/, '')}/${key}`;
  }

  async remove(url: string): Promise<void> {
    const base = (env.S3_PUBLIC_URL ?? '').replace(/\/$/, '') + '/';
    if (!url.startsWith(base)) return;
    await this.client
      .send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: url.slice(base.length) }))
      .catch(() => undefined);
  }
}

export const storage: StorageDriver = env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
