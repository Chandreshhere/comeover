#!/usr/bin/env node
'use strict';
// Grant or revoke admin console roles.
//   npm run grant-role -- +919876543210 admin
//   npm run grant-role -- 9876543210 moderator
//   npm run grant-role -- 9876543210 none          (revoke all roles)
// The user is created if they have never signed in (they still sign in with Slide OTP).
const db = require('../src/lib/db');
const { normalizePhone } = require('../src/lib/phone');

async function grantRole(phoneRaw, role) {
  if (!['admin', 'moderator', 'none'].includes(role)) throw new Error('role must be admin | moderator | none');
  const phone = normalizePhone(phoneRaw);
  const { User } = require('../src/models');
  const roles = role === 'none' ? [] : [role];
  const user = await User.findOneAndUpdate({ phone }, { $set: { roles }, $setOnInsert: { phone } }, { upsert: true, new: true }).lean();
  const { audit } = require('../src/lib/audit');
  await audit({ action: 'admin.role_granted_cli', targetType: 'user', targetId: user._id, metadata: { roles } });
  return user;
}

if (require.main === module) {
  const [phone, role] = process.argv.slice(2);
  if (!phone || !role) {
    console.error('usage: npm run grant-role -- <phone> <admin|moderator|none>');
    process.exit(2);
  }
  (async () => {
    await db.connect();
    const u = await grantRole(phone, role);
    console.log(`User ${u._id} (${u.phone}) roles = [${u.roles.join(', ')}]`);
    await db.disconnect();
  })().catch(async (e) => {
    console.error(e.message || e);
    await db.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { grantRole };
