import { notFound, unprocessable } from '../../lib/errors';
import { getQueue } from '../../lib/queue';
import { r2 } from '../../lib/r2';
import { UserModel } from './models/user.model';

export const STORAGE_QUEUE = 'storage';
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * What the bytes are, ignoring what the client claims: the bucket is public, so a labelled
 * upload could otherwise put an HTML page on our domain.
 */
export function sniffImage(b: Buffer) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { extension: 'jpg', mimeType: 'image/jpeg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: 'png', mimeType: 'image/png' };
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { extension: 'webp', mimeType: 'image/webp' };
  return null;
}

export const AvatarsService = {
  async upload(userId: string, buffer: Buffer) {
    const image = sniffImage(buffer);
    if (!image) throw unprocessable('Use a JPEG, PNG or WebP photo', 'PHOTO_INVALID');
    const { key, url } = await r2.uploadFile(buffer, image.extension, image.mimeType, `avatars/${userId}`);
    const previous = await UserModel.findByIdAndUpdate(userId, { avatarKey: key }).select('avatarKey');
    if (!previous) throw notFound('Account not found');
    if (previous.avatarKey) await this.purge(previous.avatarKey);
    return { avatarUrl: url };
  },

  async remove(userId: string) {
    const previous = await UserModel.findByIdAndUpdate(userId, { $unset: { avatarKey: 1 } }).select('avatarKey');
    if (previous?.avatarKey) await this.purge(previous.avatarKey);
  },

  /** Queued so a passing R2 failure can't leave a closed account's photo behind. */
  purge: (key: string) => getQueue(STORAGE_QUEUE).add('delete', { key }),
};
