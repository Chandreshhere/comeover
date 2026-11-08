'use strict';
// S3-compatible client (AWS S3, Cloudflare R2, MinIO). Created lazily.
const config = require('../config');

let client;
function s3() {
  if (!client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    client = new S3Client({
      region: config.s3.region,
      ...(config.s3.endpoint ? { endpoint: config.s3.endpoint } : {}),
      forcePathStyle: config.s3.forcePathStyle,
      ...(config.s3.accessKeyId && config.s3.secretAccessKey
        ? { credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey } }
        : {}), // otherwise the default AWS credential chain (instance role, env, …)
    });
  }
  return client;
}

module.exports = { s3 };
