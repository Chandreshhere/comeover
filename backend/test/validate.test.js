'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, check } = require('../src/lib/validate');

const SPEC = {
  name: { type: 'string', required: true, min: 2, max: 10 },
  phone: { type: 'string', format: 'e164' },
  id: { type: 'string', format: 'uuid' },
  upi: { type: 'string', format: 'vpa' },
  count: { type: 'integer', min: 1, max: 5, default: 2 },
  tags: { type: 'array', max: 3, unique: true, items: { type: 'string', max: 5 }, default: () => [] },
  nested: { type: 'object', fields: { ok: { type: 'boolean', required: true } } },
  kind: { type: 'string', enum: ['a', 'b'] },
};

test('valid input passes, defaults applied, unknown fields stripped', () => {
  const { value, errors } = validate(SPEC, { name: '  Riya ', phone: '+919812345678', extra: 'drop me', nested: { ok: 'true', more: 1 } });
  assert.deepEqual(errors, []);
  assert.deepEqual(value, { name: 'Riya', phone: '+919812345678', count: 2, tags: [], nested: { ok: true } });
});

test('reports every problem with a path and code', () => {
  const { errors } = validate(SPEC, {
    phone: '98123',
    id: 'nope',
    upi: 'bad upi',
    count: 9,
    tags: ['a', 'a', 'toolongtag', 'x'],
    nested: {},
    kind: 'z',
  });
  const codes = errors.map((e) => `${e.path}:${e.code}`);
  for (const c of ['name:required', 'phone:format', 'id:format', 'upi:format', 'count:too_large', 'tags:too_many', 'tags:not_unique', 'tags[2]:too_long', 'nested.ok:required', 'kind:enum']) {
    assert.ok(codes.includes(c), `missing ${c} in ${codes.join(',')}`);
  }
});

test('integers from query strings are coerced; floats rejected for integer', () => {
  assert.equal(validate({ n: { type: 'integer' } }, { n: '3' }).value.n, 3);
  assert.equal(validate({ n: { type: 'integer' } }, { n: '3.5' }).errors[0].code, 'type');
});

test('check throws a 400 validation_failed HttpError', () => {
  assert.throws(
    () => check(SPEC, {}),
    (e) => e.status === 400 && e.code === 'validation_failed' && Array.isArray(e.details)
  );
});

test('nullable fields accept null', () => {
  assert.deepEqual(validate({ a: { type: 'string', nullable: true } }, { a: null }).value, { a: null });
  assert.equal(validate({ a: { type: 'string' } }, { a: null }).errors[0].code, 'not_nullable');
});
