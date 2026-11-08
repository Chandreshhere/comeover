#!/usr/bin/env node
'use strict';
// Static verification without AWS or a database:
//  1. every module under src/ loads (syntax + require graph), handlers export functions
//  2. template.yaml is up to date with the handlers' route tables
//  3. every operation in 08_api_contract.json has a route
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const fail = (m) => {
  failed += 1;
  console.error(`FAIL ${m}`);
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
}

// 1. load modules
const files = walk(path.join(ROOT, 'src'));
for (const f of files) {
  try {
    const m = require(f);
    if (f.includes(`${path.sep}handlers${path.sep}`)) {
      const fns = Object.values(m).filter((v) => typeof v === 'function');
      if (!fns.length) fail(`${path.relative(ROOT, f)} exports no handler functions`);
    }
  } catch (e) {
    fail(`${path.relative(ROOT, f)}: ${e.message}`);
  }
}
console.log(`modules loaded: ${files.length}`);

// 2. template freshness + route uniqueness
const { GROUPS, loadRoutes, render } = require('./build-template');
const all = GROUPS.flatMap((g) => loadRoutes(g.file).map((r) => ({ r, g: g.fn })));
const seen = new Map();
for (const { r, g } of all) {
  const norm = r.replace(/\{[^}]+\}/g, '{}');
  if (seen.has(norm)) fail(`duplicate route ${r} in ${g} and ${seen.get(norm)}`);
  seen.set(norm, g);
}
const tpl = path.join(ROOT, 'template.yaml');
if (!fs.existsSync(tpl)) fail('template.yaml missing — run npm run template');
else if (fs.readFileSync(tpl, 'utf8') !== render()) fail('template.yaml is stale — run npm run template');
console.log(`http routes: ${all.length}`);

// 3. contract coverage
const contractPath = path.join(ROOT, '..', '08_api_contract.json');
if (fs.existsSync(contractPath)) {
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const routes = new Set(all.map(({ r }) => r.replace(/\{[^}]+\}/g, '{}')));
  let n = 0;
  for (const g of contract.groups) {
    for (const op of g.operations) {
      n += 1;
      const [method, rawPath] = op.split(' ');
      const key = `${method} /v1${rawPath.split('?')[0].replace(/\{[^}]+\}/g, '{}')}`;
      if (!routes.has(key)) fail(`contract operation not implemented: ${op}`);
    }
  }
  console.log(`contract operations checked: ${n}`);
}

// 4. every route is documented in docs/API.md as `METHOD /path`
const apiDoc = path.join(ROOT, 'docs', 'API.md');
if (fs.existsSync(apiDoc)) {
  const doc = fs.readFileSync(apiDoc, 'utf8');
  let missing = 0;
  for (const { r } of all) {
    const [method, p] = r.split(' ');
    if (!doc.includes(`\`${method} ${p.replace(/^\/v1/, '')}\``)) {
      missing += 1;
      fail(`route not documented in docs/API.md: ${r}`);
    }
  }
  console.log(`documented routes: ${all.length - missing}/${all.length}`);
} else fail('docs/API.md missing');

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('OK');
