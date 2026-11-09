'use strict';
// Handler registry. Each module exports `routes` (see lib/http.js). Modules that
// haven't been ported yet are skipped so the server boots during the migration.
const logger = require('../logger');
const { mountRoutes } = require('../lib/http');

// Order matters only within a module (register literal segments like /me before /{id}).
const MODULES = ['auth', 'profile', 'discovery', 'activities', 'assistant', 'circles', 'messaging', 'progress', 'expenses', 'safety', 'monetization', 'partners', 'webhooks', 'admin', 'insights'];

function load(name) {
  try {
    return require(`./${name}`);
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(`handlers${require('path').sep}${name}`)) return null;
    if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(`./${name}'`)) return null;
    throw e;
  }
}

function mountAll(app) {
  const seen = new Map();
  const mounted = [];
  const missing = [];
  for (const name of MODULES) {
    const mod = load(name);
    if (!mod || !mod.routes) {
      missing.push(name);
      continue;
    }
    for (const key of Object.keys(mod.routes)) {
      if (seen.has(key)) throw new Error(`duplicate route "${key}" in ${name} (already in ${seen.get(key)})`);
      seen.set(key, name);
    }
    mountRoutes(app, mod.routes);
    mounted.push(name);
  }
  if (missing.length) logger.warn({ msg: 'handler_modules_missing', missing });
  return { mounted, missing, routes: [...seen.keys()] };
}

module.exports = { MODULES, mountAll, load };
