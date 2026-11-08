'use strict';
// Uniform pagination: ?cursor=&limit= → { items, nextCursor }.
// Cursors are opaque (base64url JSON); clients must not parse them.
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
  return { limit, offset, sqlLimit: limit + 1 };
}

// rows were fetched with LIMIT limit+1 OFFSET offset.
function pageOf(rows, { limit, offset }, map = (x) => x) {
  const more = rows.length > limit;
  return { items: rows.slice(0, limit).map(map), nextCursor: more ? encodeCursor({ o: offset + limit }) : null };
}

module.exports = { encodeCursor, decodeCursor, pageParams, pageOf };
