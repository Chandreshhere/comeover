#!/usr/bin/env node
'use strict';
// Static checks (no database needed):
//  - every handler module loads and its routes compile
//  - no duplicate routes
//  - every mounted route is documented in docs/API.md
//  - coverage of the documented routes (what is still unported)
//  - every operation in 08_api_contract.json is mounted
const fs = require('fs');
const path = require('path');
const { MODULES, load } = require('../src/handlers');
const { compileRouteKey } = require('../src/lib/http');

const root = path.join(__dirname, '..');
const mounted = new Map();
const missingModules = [];
for (const name of MODULES) {
  const mod = load(name);
  if (!mod || !mod.routes) {
    missingModules.push(name);
    continue;
  }
  for (const key of Object.keys(mod.routes)) {
    compileRouteKey(key);
    if (mounted.has(key)) throw new Error(`duplicate route ${key} (${mounted.get(key)} and ${name})`);
    mounted.set(key, name);
  }
}

// Models load and register.
const models = require('../src/models');

const apiMd = fs.readFileSync(path.join(root, 'docs', 'API.md'), 'utf8');
const norm = (k) => k.replace(/\{[^}]+\}/g, '{}').replace(' /v1/', ' /');
const documented = new Set();
for (const m of apiMd.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/[^`\s]+)`/g)) documented.add(norm(`${m[1]} ${m[2].replace(/\?.*$/, '')}`));

const undocumented = [...mounted.keys()].filter((k) => !documented.has(norm(k)));
const mountedNorm = new Set([...mounted.keys()].map(norm));
const unported = [...documented].filter((k) => !mountedNorm.has(k));

let contractMissing = [];
const contractPath = path.join(root, '..', '08_api_contract.json');
if (fs.existsSync(contractPath)) {
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const ops = contract.groups.flatMap((g) => g.operations).map((o) => norm(`${o.split('?')[0]}`.replace(/^(\w+) /, '$1 /v1').replace('/v1/', '/')));
  contractMissing = ops.filter((o) => !mountedNorm.has(o));
}

console.log(`models: ${Object.keys(models).length}`);
console.log(`modules mounted: ${MODULES.length - missingModules.length}/${MODULES.length}${missingModules.length ? ` (not yet ported: ${missingModules.join(', ')})` : ''}`);
console.log(`routes mounted: ${mounted.size}`);
console.log(`documented routes: ${documented.size}; still unported: ${unported.length}`);
console.log(`contract operations missing: ${contractMissing.length}`);
if (undocumented.length) {
  console.error(`UNDOCUMENTED routes:\n  ${undocumented.join('\n  ')}`);
  process.exit(1);
}
if (process.argv.includes('--strict') && (unported.length || contractMissing.length)) {
  console.error(`unported:\n  ${unported.join('\n  ')}\ncontract missing:\n  ${contractMissing.join('\n  ')}`);
  process.exit(1);
}
console.log('OK');
