import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  // Through fetch like every other provider, so tests fake it at the same boundary.
  requestHandler: new FetchHttpHandler(),
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

export const r2 = {
  publicUrl: (key: string) => `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`,

  async uploadFile(buffer: Buffer, extension: string, mimeType: string, folder = 'uploads') {
    const key = `${folder}/${randomUUID()}.${extension}`;
    await client.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: buffer, ContentType: mimeType }));
    return { key, url: this.publicUrl(key) };
  },

  /** For our own encrypted files only: anything public is read through `publicUrl`. */
  async getFile(key: string) {
    const res = await client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  },

  async deleteFile(key: string) {
    await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  },
};
