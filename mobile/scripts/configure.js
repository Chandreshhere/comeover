#!/usr/bin/env node
// Writes src/config.env.json for a deployed Project IRL API.
//
//   npm run configure -- --api https://api.example.com/v1
//       (WS_URL defaults to wss://<same host>/ws)
//   npm run configure -- --api https://api.example.com/v1 --ws wss://api.example.com/ws --cdn https://media.example.com
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : acc), [])
);

const target = path.join(__dirname, '..', 'src', 'config.env.json');
const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};

let api = (args.api || current.API_URL || '').replace(/\/$/, '');
if (api && !/\/v1$/.test(api)) api = `${api}/v1`;
let ws = args.ws || current.WS_URL || '';
if (!ws && api) {
  const u = new URL(api);
  ws = `${u.protocol === 'http:' ? 'ws:' : 'wss:'}//${u.host}/ws`;
}

const next = { ...current, API_URL: api, WS_URL: ws, MEDIA_CDN_URL: args.cdn || current.MEDIA_CDN_URL || '' };
delete next.AWS_REGION;
delete next.COGNITO_USER_POOL_ID;
delete next.COGNITO_CLIENT_ID;

fs.writeFileSync(target, JSON.stringify(next, null, 2) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
if (!next.API_URL) console.warn('Still missing: API_URL (pass --api https://<host>/v1)');
