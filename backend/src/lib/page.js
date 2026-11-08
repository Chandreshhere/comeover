'use strict';
// Uniform pagination: ?cursor=&limit= → { items, nextCursor }.
// Cursors are opaque (base64url JSON); clients must not parse them.
//
// Offset style (simple lists):
//   const p = pageParams(req.query);
//   const rows = await Model.find(q).sort({ createdAt: -1 }).skip(p.offset).limit(p.fetchLimit).lean();
//   return pageOf(rows, p, present);
//
// Keyset style (feeds that change while paging): sort by { createdAt: -1, _id: -1 } and
//   const p = pageParams(req.query); Model.find({ ...q, ...afterKeyset(p.cursor, 'createdAt') })
//   return keysetPageOf(rows, p, 'createdAt', present);
const { err } = require('./http');

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch (e) {
    throw err.badRequest('invalid_cursor');
  }
}

function pageParams(query = {}, { def = 20, max = 50 } = {}) {
  const n = parseInt(query.limit, 10);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
  const c = decodeCursor(query.cursor);
  const offset = c && Number.isInteger(c.o) && c.o >= 0 ? c.o : 0;
  return { limit, offset, fetchLimit: limit + 1, sqlLimit: limit + 1, cursor: c };
}

// rows were fetched with .skip(offset).limit(limit + 1)
async function pageOf(rows, { limit, offset }, map = (x) => x) {
  const more = rows.length > limit;
  const items = await Promise.all(rows.slice(0, limit).map((r, i) => map(r, i)));
  return { items, nextCursor: more ? encodeCursor({ o: offset + limit }) : null };
}

// Keyset helpers (descending by `field`, ties broken by _id).
function afterKeyset(cursor, field = 'createdAt') {
  if (!cursor || cursor.k == null || cursor.id == null) return {};
  const v = cursor.t === 'd' ? new Date(cursor.k) : cursor.k;
  return { $or: [{ [field]: { $lt: v } }, { [field]: v, _id: { $lt: cursor.id } }] };
}

async function keysetPageOf(rows, { limit }, field = 'createdAt', map = (x) => x) {
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const items = await Promise.all(page.map((r, i) => map(r, i)));
  if (!more || !last) return { items, nextCursor: null };
  const k = last[field];
  return { items, nextCursor: encodeCursor({ k: k instanceof Date ? k.toISOString() : k, t: k instanceof Date ? 'd' : 'v', id: last._id }) };
}

module.exports = { encodeCursor, decodeCursor, pageParams, pageOf, afterKeyset, keysetPageOf };
