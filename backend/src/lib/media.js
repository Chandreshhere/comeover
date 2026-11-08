'use strict';
// Private media on S3-compatible storage. Uploads use a presigned PUT whose
// Content-Type AND Content-Length are part of the signature, so the client can
// only upload the exact type/size it declared. Keys are namespaced
// kind/ownerId/uuid so ownership is checked when a key is attached to a record.
const crypto = require('crypto');
const config = require('../config');
const { err } = require('./http');
const { s3 } = require('./s3');

const IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const KINDS = {
  avatar: { maxBytes: 5 * 1024 * 1024, types: IMG },
  bill: { maxBytes: 10 * 1024 * 1024, types: [...IMG, 'application/pdf'] },
  venue_proof: { maxBytes: 10 * 1024 * 1024, types: [...IMG, 'application/pdf'] },
  evidence: { maxBytes: 15 * 1024 * 1024, types: [...IMG, 'application/pdf'] },
  chat: { maxBytes: 8 * 1024 * 1024, types: IMG },
  export: { maxBytes: 50 * 1024 * 1024, types: ['application/json'] },
};
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf', 'application/json': 'json' };

function checkUpload({ kind, contentType, sizeBytes }) {
  const k = KINDS[kind];
  if (!k || kind === 'export') throw err.badRequest('invalid_kind', `kind must be one of ${Object.keys(KINDS).filter((x) => x !== 'export').join(', ')}`);
  if (!k.types.includes(contentType)) throw err.badRequest('unsupported_type', `Allowed: ${k.types.join(', ')}`);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > k.maxBytes) throw err.badRequest('file_too_large', `Max ${Math.round(k.maxBytes / 1048576)} MB`);
  return k;
}

const keyFor = (kind, ownerId, contentType) => `${kind}/${ownerId}/${crypto.randomUUID()}.${EXT[contentType]}`;
const isOwnedKey = (key, kind, ownerId) => typeof key === 'string' && key.startsWith(`${kind}/${ownerId}/`) && !key.includes('..');
const isConfigured = () => !!config.s3.bucket;

async function createUpload({ userId, kind, contentType, sizeBytes }) {
  checkUpload({ kind, contentType, sizeBytes });
  if (!isConfigured()) throw err.unavailable('media_not_configured');
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const key = keyFor(kind, userId, contentType);
  const sse = config.s3.serverSideEncryption;
  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes, ...(sse ? { ServerSideEncryption: sse } : {}) }),
    { expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length']) }
  );
  return {
    uploadUrl,
    key,
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'Content-Length': String(sizeBytes), ...(sse ? { 'x-amz-server-side-encryption': sse } : {}) },
    expiresInSec: 300,
  };
}

// Server-side write (e.g. data exports).
async function putObject(key, body, contentType = 'application/json') {
  if (!isConfigured()) throw err.unavailable('media_not_configured');
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const sse = config.s3.serverSideEncryption;
  await s3().send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType, ...(sse ? { ServerSideEncryption: sse } : {}) }));
  return key;
}

async function signedGet(key, expiresIn = 300) {
  if (!isConfigured() || !key) return null;
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }), { expiresIn });
}

// Public URL via CDN when configured, else a short-lived signed GET.
async function publicUrl(key, expiresIn = 3600) {
  if (!key) return null;
  if (config.s3.cdnUrl) return `${config.s3.cdnUrl.replace(/\/$/, '')}/${key}`;
  return signedGet(key, expiresIn).catch(() => null);
}

module.exports = { KINDS, checkUpload, keyFor, isOwnedKey, isConfigured, createUpload, putObject, signedGet, publicUrl };
