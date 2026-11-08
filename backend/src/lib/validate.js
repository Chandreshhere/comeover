'use strict';
// Tiny dependency-free request validator. Unknown fields are stripped.
//
// Field spec: { type: 'string'|'integer'|'number'|'boolean'|'array'|'object',
//   required, nullable, default, min, max (length for strings/arrays, value for numbers),
//   enum, pattern, format: 'uuid'|'e164'|'datetime'|'slug'|'vpa'|'hhmm', items, fields, trim }
const { err } = require('./http');

const FORMATS = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  e164: /^\+[1-9]\d{7,14}$/,
  slug: /^[a-z0-9][a-z0-9_-]{1,39}$/,
  vpa: /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$/,
  hhmm: /^([01]\d|2[0-3]):[0-5]\d$/,
};

function checkField(spec, value, path, errors) {
  if (value === undefined || value === '') {
    if (spec.default !== undefined) return typeof spec.default === 'function' ? spec.default() : spec.default;
    if (spec.required) errors.push({ path, code: 'required' });
    return undefined;
  }
  if (value === null) {
    if (spec.nullable) return null;
    errors.push({ path, code: 'not_nullable' });
    return undefined;
  }
  switch (spec.type) {
    case 'string': {
      if (typeof value !== 'string') return errors.push({ path, code: 'type', expected: 'string' }), undefined;
      const v = spec.trim === false ? value : value.trim();
      if (spec.min != null && v.length < spec.min) errors.push({ path, code: 'too_short', min: spec.min });
      if (spec.max != null && v.length > spec.max) errors.push({ path, code: 'too_long', max: spec.max });
      if (spec.enum && !spec.enum.includes(v)) errors.push({ path, code: 'enum', allowed: spec.enum });
      if (spec.pattern && !spec.pattern.test(v)) errors.push({ path, code: 'pattern' });
      if (spec.format === 'datetime') {
        if (Number.isNaN(Date.parse(v))) errors.push({ path, code: 'format', format: 'datetime' });
      } else if (spec.format && FORMATS[spec.format] && !FORMATS[spec.format].test(v)) {
        errors.push({ path, code: 'format', format: spec.format });
      }
      return v;
    }
    case 'integer':
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n) || (spec.type === 'integer' && !Number.isInteger(n))) {
        errors.push({ path, code: 'type', expected: spec.type });
        return undefined;
      }
      if (spec.min != null && n < spec.min) errors.push({ path, code: 'too_small', min: spec.min });
      if (spec.max != null && n > spec.max) errors.push({ path, code: 'too_large', max: spec.max });
      if (spec.enum && !spec.enum.includes(n)) errors.push({ path, code: 'enum', allowed: spec.enum });
      return n;
    }
    case 'boolean': {
      if (value === 'true' || value === true) return true;
      if (value === 'false' || value === false) return false;
      errors.push({ path, code: 'type', expected: 'boolean' });
      return undefined;
    }
    case 'array': {
      if (!Array.isArray(value)) return errors.push({ path, code: 'type', expected: 'array' }), undefined;
      if (spec.min != null && value.length < spec.min) errors.push({ path, code: 'too_few', min: spec.min });
      if (spec.max != null && value.length > spec.max) errors.push({ path, code: 'too_many', max: spec.max });
      const out = spec.items ? value.map((v, i) => checkField({ required: true, ...spec.items }, v, `${path}[${i}]`, errors)) : value.slice();
      if (spec.unique && new Set(out.map((x) => JSON.stringify(x))).size !== out.length) errors.push({ path, code: 'not_unique' });
      return out;
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return errors.push({ path, code: 'type', expected: 'object' }), undefined;
      if (!spec.fields) return value;
      return checkObject(spec.fields, value, path, errors);
    }
    default:
      return value;
  }
}

function checkObject(fields, input, prefix, errors) {
  const out = {};
  const src = input || {};
  for (const [name, spec] of Object.entries(fields)) {
    const v = checkField(spec, src[name], prefix ? `${prefix}.${name}` : name, errors);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

function validate(fields, input) {
  const errors = [];
  const value = checkObject(fields, input, '', errors);
  return { value, errors };
}

// Validate or throw 400 validation_failed.
function check(fields, input) {
  const { value, errors } = validate(fields, input);
  if (errors.length) throw err.badRequest('validation_failed', 'Some fields are invalid', errors);
  return value;
}

module.exports = { validate, check, FORMATS };
