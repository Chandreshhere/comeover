'use strict';
// Private S3 media. Uploads use a presigned PUT whose Content-Type AND
// Content-Length are part of the signature, so the client can only upload the
// exact type/size it declared. Keys are namespaced kind/ownerId/uuid so
// ownership is checked when a key is attached to a record.
const crypto = require('crypto');
const { err } = require('./http');
const { s3 } = require('./aws');

const IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const KINDS = {
  avatar: { maxBytes: 5 * 1024 * 1024, types: IMG },
  bill: { maxBytes: 10 * 1024 * 1024, types: [...IMG, 'application/pdf'] },
  venue_proof: { maxBytes: 10 * 1024 * 1024, types: [...IMG, 'application/pdf'] },
  evidence: { maxBytes: 15 * 1024 * 1024, types: [...IMG, 'application/pdf'] },
  chat: { maxBytes: 8 * 1024 * 1024, types: IMG },
};
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };

function checkUpload({ kind, contentType, sizeBytes }) {
  const k = KINDS[kind];
  if (!k) throw err.badRequest('invalid_kind', `kind must be one of ${Object.keys(KINDS).join(', ')}`);
  if (!k.types.includes(contentType)) throw err.badRequest('unsupported_type', `Allowed: ${k.types.join(', ')}`);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > k.maxBytes) throw err.badRequest('file_too_large', `Max ${Math.round(k.maxBytes / 1048576)} MB`);
  return k;
}

const keyFor = (kind, ownerId, contentType) => `${kind}/${ownerId}/${crypto.randomUUID()}.${EXT[contentType]}`;
const isOwnedKey = (key, kind, ownerId) => typeof key === 'string' && key.startsWith(`${kind}/${ownerId}/`) && !key.includes('..');

async function createUpload({ userId, kind, contentType, sizeBytes }) {
  checkUpload({ kind, contentType, sizeBytes });
  const Bucket = process.env.MEDIA_BUCKET;
  if (!Bucket) throw err.unavailable('media_not_configured');
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const key = keyFor(kind, userId, contentType);
  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes, ServerSideEncryption: 'AES256' }),
    { expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length']) }
  );
  return {
    uploadUrl,
    key,
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'Content-Length': String(sizeBytes), 'x-amz-server-side-encryption': 'AES256' },
    expiresInSec: 300,
  };
}

async function signedGet(key, expiresIn = 300) {
  const Bucket = process.env.MEDIA_BUCKET;
  if (!Bucket || !key) return null;
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket, Key: key }), { expiresIn });
}

module.exports = { KINDS, checkUpload, keyFor, isOwnedKey, createUpload, signedGet };
