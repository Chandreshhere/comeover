#!/usr/bin/env node
// Writes src/config.env.json from the deployed backend stack.
//
//   npm run configure -- --stack irl-prod --region ap-south-1     (uses the AWS CLI)
//   npm run configure -- --outputs outputs.json                    (saved describe-stacks Outputs)
//   npm run configure -- --api https://…/v1 --ws wss://… --region ap-south-1 --pool ap-south-1_x --client abc
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : acc), [])
);

const target = path.join(__dirname, '..', 'src', 'config.env.json');
const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};

let outputs = {};
if (args.outputs) {
  const raw = JSON.parse(fs.readFileSync(args.outputs, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.Stacks?.[0]?.Outputs || [];
  outputs = Object.fromEntries(list.map((o) => [o.OutputKey, o.OutputValue]));
} else if (args.stack) {
  const raw = execFileSync('aws', ['cloudformation', 'describe-stacks', '--stack-name', args.stack, ...(args.region ? ['--region', args.region] : []), '--query', 'Stacks[0].Outputs', '--output', 'json'], { encoding: 'utf8' });
  outputs = Object.fromEntries(JSON.parse(raw).map((o) => [o.OutputKey, o.OutputValue]));
}

const pick = (...keys) => keys.map((k) => outputs[k]).find(Boolean);
const next = {
  ...current,
  API_URL: args.api || pick('HttpApiUrl', 'ApiUrl') || current.API_URL || '',
  WS_URL: args.ws || pick('WebSocketUrl', 'WsUrl') || current.WS_URL || '',
  AWS_REGION: args.region || pick('Region') || current.AWS_REGION || '',
  COGNITO_USER_POOL_ID: args.pool || pick('UserPoolId') || current.COGNITO_USER_POOL_ID || '',
  COGNITO_CLIENT_ID: args.client || pick('UserPoolClientId', 'MobileClientId') || current.COGNITO_CLIENT_ID || '',
  MEDIA_CDN_URL: args.cdn || pick('MediaCdnUrl', 'MediaDistributionUrl') || current.MEDIA_CDN_URL || '',
};

fs.writeFileSync(target, JSON.stringify(next, null, 2) + '\n');
const missing = ['API_URL', 'AWS_REGION', 'COGNITO_CLIENT_ID'].filter((k) => !next[k]);
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
if (missing.length) console.warn(`Still missing: ${missing.join(', ')}`);
