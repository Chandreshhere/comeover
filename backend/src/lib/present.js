'use strict';
// Response presenters. Shapes match the mobile client models
// (mobile/src/data/seed.js + src/store/useAppStore.js). camelCase only.
const geo = require('./geo');
const media = require('./media');

function accentIndex(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 5;
}

const round2 = (n) => (n == null ? null : Math.round(Number(n) * 100) / 100);
// Public reliability is shown in 5% steps so single events can't be inferred.
const publicReliability = (n) => (n == null ? null : Math.round(Number(n) * 20) / 20);

async function avatarUrl(key) {
  if (!key) return null;
  if (process.env.MEDIA_CDN_URL) return `${process.env.MEDIA_CDN_URL.replace(/\/$/, '')}/${key}`;
  return media.signedGet(key, 3600).catch(() => null);
}

const category = (r) => ({ slug: r.slug, label: r.label, short: r.short || r.label, pictogram: r.pictogram || 'sparkle', riskLevel: r.risk_level });

async function publicUser(r, { distanceM } = {}) {
  return {
    id: r.id || r.user_id,
    name: r.display_name,
    area: r.area || r.home_area || null,
    ...(distanceM != null ? { distanceM: geo.coarseDistanceMeters(distanceM), distanceBand: geo.distanceBand(distanceM) } : {}),
    reliability: publicReliability(r.reliability_score),
    level: r.level || 1,
    interests: r.interests || [],
    availability: r.availability_status || 'busy',
    intent: (r.activity_slugs && r.activity_slugs[0]) || null,
    completed: r.completed || 0,
    avatarKey: r.avatar_key || null,
    avatarUrl: await avatarUrl(r.avatar_key),
  };
}

function conversation(r) {
  return {
    id: r.id,
    kind: r.kind,
    activityId: r.activity_id || null,
    circleId: r.circle_id || null,
    title: r.title,
    memberIds: r.member_ids || [],
    muted: !!r.muted,
    unread: r.unread || 0,
    lastMessage: r.last_message_id
      ? { id: r.last_message_id, senderId: r.last_message_kind === 'system' ? 'system' : r.last_message_sender, body: r.last_message_body, createdAt: r.last_message_at }
      : null,
  };
}

function message(r) {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.kind === 'system' ? 'system' : r.sender_user_id,
    body: r.deleted_at ? null : r.body,
    mediaKey: r.deleted_at ? null : r.media_key || null,
    deleted: !!r.deleted_at,
    createdAt: r.created_at,
  };
}

function circle(r) {
  return {
    id: r.id,
    name: r.name,
    pictogram: r.pictogram || 'people',
    members: r.member_count || 0,
    area: r.area || null,
    accentIndex: accentIndex(r.id),
    visibility: r.visibility,
    description: r.description || '',
    rules: r.rules || [],
    memberSeeds: (r.member_seeds || []).slice(0, 6),
    nextPlanIds: r.next_plan_ids || [],
    ownerId: r.owner_user_id,
    ownerName: r.owner_name || null,
    myRole: r.my_role || null,
    category: r.category_slug || null,
  };
}

function quest(r) {
  return {
    id: r.slug,
    kind: r.kind,
    title: r.title,
    subtitle: r.description,
    pictogram: r.pictogram || 'sparkle',
    progress: r.progress_count != null ? r.progress_count : 0,
    total: r.total || 1,
    xp: r.xp_reward,
    state: r.state || 'available',
  };
}

function expense(r, shares = [], items) {
  return {
    id: r.id,
    activityId: r.activity_id || null,
    description: r.description,
    totalMinor: Number(r.total_minor),
    currency: r.currency,
    splitMethod: r.split_method,
    createdBy: r.creator_user_id,
    payeeId: r.payee_user_id || r.creator_user_id,
    payeeUpi: r.payee_upi_vpa || null,
    receiptKey: r.receipt_key || null,
    createdAt: r.created_at,
    ...(items ? { items: items.map((i) => ({ id: i.id, label: i.label, amountMinor: Number(i.amount_minor), quantity: i.quantity, assignees: i.assignees || [] })) } : {}),
    shares: shares.map((s) => ({ userId: s.user_id, amountMinor: Number(s.amount_minor), state: s.state, paymentReference: s.payment_reference || null, bankVerified: false })),
  };
}

function notification(r) {
  const data = r.data || {};
  return { id: r.id, type: r.type, title: r.title, body: r.body, createdAt: r.created_at, read: !!r.read_at, target: data.target || null };
}

function subscription(ents, sub) {
  const rank = { pro: 2, plus: 1 };
  const tier = ents.filter((e) => rank[e]).sort((a, b) => rank[b] - rank[a])[0] || 'free';
  return {
    tier,
    status: sub ? sub.status : tier === 'free' ? null : 'active',
    expiresAt: sub ? sub.expires_at : null,
    store: sub ? sub.store : null,
    venue: ents.includes('venue'),
  };
}

module.exports = { accentIndex, round2, publicReliability, avatarUrl, category, publicUser, conversation, message, circle, quest, expense, notification, subscription };
