// Direct-to-S3 uploads with presigned URLs from POST /media/upload-url.
// The backend validates kind, content type and size before signing.
import { media } from '@/api/endpoints';
import config from '@/config';

const MAX_BYTES = { avatar: 5 * 1024 * 1024, bill: 10 * 1024 * 1024, venue_proof: 10 * 1024 * 1024 };

// asset: react-native-image-picker asset { uri, type, fileSize }
export async function uploadAsset(asset, kind) {
  const contentType = asset.type || 'image/jpeg';
  const sizeBytes = asset.fileSize || 0;
  if (sizeBytes && sizeBytes > (MAX_BYTES[kind] || MAX_BYTES.bill)) {
    const e = new Error('That file is too large.');
    e.code = 'file_too_large';
    throw e;
  }
  const { uploadUrl, key, headers } = await media.uploadUrl({ kind, contentType, sizeBytes });
  const blob = await (await fetch(asset.uri)).blob();
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType, ...(headers || {}) }, body: blob });
  if (!res.ok) {
    const e = new Error('Upload failed. Try again.');
    e.code = 'upload_failed';
    throw e;
  }
  return { key, url: mediaUrl(key) };
}

export const mediaUrl = (key) => (key && config.MEDIA_CDN_URL ? `${config.MEDIA_CDN_URL.replace(/\/$/, '')}/${key}` : null);
