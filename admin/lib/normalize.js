// Defensive normalisers. Response shapes are not final, so every field is read
// from camelCase or snake_case (or a nested object) and missing data renders
// as "—" instead of crashing.
import { SLA_HOURS } from './format';

export function g(o, ...keys) {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of keys) {
    const v = k.split('.').reduce((a, p) => (a == null ? undefined : a[p]), o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export const listOf = (res) => (Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : Array.isArray(res?.data) ? res.data : Array.isArray(res?.results) ? res.results : []);
export const cursorOf = (res) => (Array.isArray(res) ? null : g(res, 'nextCursor', 'next_cursor', 'cursor.next') ?? null);
export const shortId = (id) => (id ? String(id).slice(0, 8) : '—');
const num = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const bool = (v) => (v === undefined || v === null ? undefined : v === true || v === 'true' || v === 1);

export function maskPhone(p) {
  if (!p) return undefined;
  const s = String(p);
  if (s.includes('•') || s.includes('*')) return s;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 6) return s;
  return `+${digits.slice(0, 2)} ${digits.slice(2, 4)}••• ••${digits.slice(-3)}`;
}

export function person(obj, id, name) {
  if (obj && typeof obj === 'object') {
    const pid = g(obj, 'id', 'userId', 'user_id') || id;
    return { id: pid, name: g(obj, 'displayName', 'display_name', 'name', 'profile.displayName', 'profile.display_name') || name || shortId(pid), status: g(obj, 'status') };
  }
  if (!id && !name) return null;
  return { id: id || obj, name: name || shortId(id || obj), status: undefined };
}

export function normEvidence(list) {
  return (Array.isArray(list) ? list : []).map((e, i) =>
    typeof e === 'string'
      ? { id: e, type: 'file', label: e.split('/').pop() || `Evidence ${i + 1}`, url: /^https?:\/\//.test(e) ? e : undefined }
      : {
          id: g(e, 'id', 'key') || String(i),
          type: g(e, 'type', 'kind') || 'item',
          label: g(e, 'label', 'name', 'key', 'title') || `Evidence ${i + 1}`,
          content: g(e, 'content', 'text', 'excerpt', 'body'),
          url: g(e, 'url', 'signedUrl', 'signed_url', 'downloadUrl'),
          createdAt: g(e, 'createdAt', 'created_at'),
        }
  );
}

export function normAppeal(a) {
  if (!a) return null;
  return {
    id: g(a, 'id'),
    status: g(a, 'status') || 'open',
    statement: g(a, 'statement', 'text', 'body'),
    createdAt: g(a, 'createdAt', 'created_at', 'submittedAt'),
    decidedAt: g(a, 'decidedAt', 'decided_at'),
    decidedBy: g(a, 'decidedByName', 'decided_by_name', 'decidedBy.displayName', 'decidedBy', 'decided_by'),
  };
}

export function normReportAction(x) {
  return {
    id: g(x, 'id'),
    action: g(x, 'action'),
    notes: g(x, 'notes', 'reason'),
    durationDays: num(g(x, 'durationDays', 'duration_days')),
    by: g(x, 'adminName', 'admin_name', 'admin.displayName', 'admin_id', 'adminId'),
    createdAt: g(x, 'createdAt', 'created_at'),
  };
}

export function normReport(r) {
  if (!r) return null;
  const priority = String(g(r, 'priority', 'severity') || 'normal');
  const createdAt = g(r, 'createdAt', 'created_at');
  const hours = SLA_HOURS[priority] ?? 24;
  const slaDueAt = g(r, 'slaDueAt', 'sla_due_at') || (createdAt ? new Date(new Date(createdAt).getTime() + hours * 3600e3).toISOString() : undefined);
  const act = g(r, 'activity');
  const activityId = g(r, 'activityId', 'activity_id');
  const appealRaw = g(r, 'appeal') || (Array.isArray(r.appeals) ? r.appeals[0] : undefined);
  return {
    id: g(r, 'id'),
    reason: g(r, 'reasonCode', 'reason_code', 'reason') || 'other',
    status: g(r, 'status') || 'open',
    priority,
    details: g(r, 'details', 'description'),
    createdAt,
    resolvedAt: g(r, 'resolvedAt', 'resolved_at'),
    slaDueAt,
    assignee: g(r, 'assignee', 'assignedAdminName', 'assigned_admin_name', 'assignedAdmin.displayName', 'assigned_admin_id'),
    reporter: person(g(r, 'reporter', 'reporterUser', 'reporter_user'), g(r, 'reporterUserId', 'reporter_user_id', 'reporterId'), g(r, 'reporterName', 'reporter_name')),
    reported: person(g(r, 'reported', 'reportedUser', 'reported_user'), g(r, 'reportedUserId', 'reported_user_id', 'reportedId'), g(r, 'reportedName', 'reported_name')),
    activity: act
      ? { id: g(act, 'id') || activityId, title: g(act, 'title'), venueType: g(act, 'venueType', 'venue_type'), area: g(act, 'coarseArea', 'coarse_area', 'area') }
      : activityId
        ? { id: activityId, title: g(r, 'activityTitle', 'activity_title') }
        : null,
    messageId: g(r, 'messageId', 'message_id'),
    evidence: normEvidence(g(r, 'evidence') || g(r, 'evidenceKeys', 'evidence_keys')),
    actions: (g(r, 'actions', 'reportActions', 'report_actions') || []).map(normReportAction),
    appeal: normAppeal(appealRaw),
    priorReports: listOf(g(r, 'priorReports', 'prior_reports', 'otherReports', 'other_reports') || []).map(normReport),
    reportedProfile: g(r, 'reportedProfile', 'reported_profile') ? normUser(g(r, 'reportedProfile', 'reported_profile')) : null,
  };
}

export function normUser(u) {
  if (!u) return null;
  const stats = g(u, 'stats') || {};
  const sub = g(u, 'subscription', 'entitlement');
  return {
    id: g(u, 'id', 'userId', 'user_id'),
    name: g(u, 'displayName', 'display_name', 'name', 'profile.displayName', 'profile.display_name') || shortId(g(u, 'id')),
    phone: maskPhone(g(u, 'phoneMasked', 'phone_masked', 'phone', 'phoneE164', 'phone_e164')),
    status: g(u, 'status') || 'active',
    statusReason: g(u, 'statusReason', 'status_reason'),
    statusUntil: g(u, 'statusUntil', 'status_until'),
    createdAt: g(u, 'createdAt', 'created_at', 'joinedAt'),
    lastActiveAt: g(u, 'lastActiveAt', 'last_active_at', 'lastActive'),
    deletedAt: g(u, 'deletedAt', 'deleted_at'),
    area: g(u, 'homeArea', 'home_area', 'area', 'profile.home_area', 'profile.homeArea'),
    city: g(u, 'homeCity', 'home_city', 'city'),
    phoneVerified: bool(g(u, 'phoneVerified', 'phone_verified')) ?? !!g(u, 'phone', 'phoneE164', 'phone_e164', 'phoneMasked', 'phone_masked'),
    ageVerified: bool(g(u, 'ageVerified', 'age_verified')),
    ageVerifiedAt: g(u, 'ageVerifiedAt', 'age_verified_at'),
    ageMethod: g(u, 'ageVerificationMethod', 'age_verification_method'),
    idVerified: bool(g(u, 'idVerified', 'id_verified')),
    reliability: num(g(u, 'reliabilityScore', 'reliability_score', 'reliability', 'profile.reliability_score')),
    riskScore: num(g(u, 'riskScore', 'risk_score')),
    completed: num(g(stats, 'completed', 'completedActivities') ?? g(u, 'completedActivities', 'completed_activities', 'completed')),
    hosted: num(g(stats, 'hosted') ?? g(u, 'hosted', 'hostedActivities', 'hosted_activities')),
    noShows: num(g(stats, 'noShows', 'no_shows') ?? g(u, 'noShows', 'no_shows')),
    lateCancels: num(g(stats, 'lateCancels', 'late_cancels') ?? g(u, 'lateCancels', 'late_cancels', 'cancellations')),
    reportsAgainst: listOf(g(u, 'reportsAgainst', 'reports_against') || []).map(normReport),
    reportsBy: listOf(g(u, 'reportsBy', 'reports_by', 'reportsFiled', 'reports_filed') || []).map(normReport),
    subscription: sub ? normSubscription(sub) : null,
  };
}

export function normAudit(e) {
  const meta = g(e, 'metadata', 'meta') || {};
  const actor = g(e, 'actor');
  const adminId = g(e, 'actorAdminId', 'actor_admin_id');
  const userId = g(e, 'actorUserId', 'actor_user_id');
  return {
    id: String(g(e, 'id') ?? ''),
    at: g(e, 'createdAt', 'created_at', 'at'),
    action: g(e, 'action') || 'event',
    targetType: g(e, 'targetType', 'target_type', 'entityType', 'entity_type', 'target.type'),
    targetId: g(e, 'targetId', 'target_id', 'entityId', 'entity_id', 'target.id'),
    actorName:
      (actor && typeof actor === 'object' ? g(actor, 'displayName', 'display_name', 'name', 'email') : actor) ||
      g(e, 'actorName', 'actor_name', 'actorAdminName', 'actor_admin_name') ||
      (adminId ? `admin ${shortId(adminId)}` : userId ? `user ${shortId(userId)}` : 'system'),
    actorRole: (actor && typeof actor === 'object' ? g(actor, 'role') : undefined) || g(e, 'actorRole', 'actor_role') || (adminId ? 'admin' : userId ? 'user' : 'system'),
    reason: g(e, 'reason') || g(meta, 'reason', 'notes'),
    meta,
  };
}

const PRIVATE_VENUES = ['private', 'residence', 'home', 'flat', 'my place'];

export function normActivity(a) {
  const venueType = g(a, 'venueType', 'venue_type');
  const explicitPublic = bool(g(a, 'publicVenue', 'public_venue', 'isPublicVenue', 'is_public_venue'));
  const host = g(a, 'host');
  return {
    id: g(a, 'id'),
    title: g(a, 'title') || 'Untitled plan',
    description: g(a, 'description'),
    host: person(host, g(a, 'hostUserId', 'host_user_id', 'hostId'), g(a, 'hostName', 'host_name')),
    category: g(a, 'categorySlug', 'category_slug', 'category.slug', 'category'),
    area: g(a, 'coarseArea', 'coarse_area', 'area'),
    venueName: g(a, 'venueName', 'venue_name'),
    venueType,
    publicVenue: explicitPublic ?? (venueType ? !PRIVATE_VENUES.some((p) => String(venueType).toLowerCase().includes(p)) : undefined),
    startsAt: g(a, 'startsAt', 'starts_at'),
    capacity: num(g(a, 'capacity')),
    joined: num(g(a, 'joinedCount', 'joined_count', 'participantCount', 'participant_count')),
    status: g(a, 'moderationStatus', 'moderation_status', 'status') || 'open',
    flags: listOf(g(a, 'flags', 'flagReasons', 'flag_reasons') || []).map((f) => (typeof f === 'string' ? f : g(f, 'code', 'type', 'reason') || 'flag')),
    signals: listOf(g(a, 'signals', 'reasons') || []).map((s) => (typeof s === 'string' ? s : g(s, 'message', 'label', 'text') || JSON.stringify(s))),
    riskScore: num(g(a, 'riskScore', 'risk_score')),
    reports: num(g(a, 'reportCount', 'report_count', 'reports')),
    duplicateOf: g(a, 'duplicateOf', 'duplicate_of', 'duplicate.id'),
    duplicateTitle: g(a, 'duplicate.title', 'duplicateTitle', 'duplicate_title'),
    similarity: num(g(a, 'similarity', 'duplicate.similarity')),
    moderationNote: g(a, 'moderationNote', 'moderation_note'),
    sponsored: !!g(a, 'sponsoredCampaignId', 'sponsored_campaign_id', 'sponsored'),
    createdAt: g(a, 'createdAt', 'created_at'),
  };
}

export function normSubscription(s) {
  return {
    id: g(s, 'id'),
    user: person(g(s, 'user'), g(s, 'userId', 'user_id'), g(s, 'userName', 'user_name', 'displayName', 'display_name')),
    store: g(s, 'store'),
    productId: g(s, 'productId', 'product_id'),
    tier: g(s, 'tier', 'entitlement') || (String(g(s, 'productId', 'product_id') || '').match(/(plus|pro|venue)/)?.[1] ?? undefined),
    status: g(s, 'status') || 'unknown',
    entitled: bool(g(s, 'entitled', 'isEntitled', 'is_entitled', 'active')),
    startedAt: g(s, 'startedAt', 'started_at'),
    expiresAt: g(s, 'expiresAt', 'expires_at'),
    txn: g(s, 'storeTransactionIdMasked', 'store_transaction_id_masked', 'storeTransactionId', 'store_transaction_id'),
    note: g(s, 'note', 'supportNote', 'support_note'),
  };
}

export function normCampaign(c) {
  return {
    id: g(c, 'id'),
    venue: g(c, 'venueName', 'venue_name', 'venue.name', 'venue', 'businessName', 'business_name'),
    title: g(c, 'title', 'name'),
    area: g(c, 'area', 'coarseArea', 'coarse_area'),
    status: g(c, 'status') || 'unknown',
    budgetMinor: num(g(c, 'budgetMinor', 'budget_minor')),
    days: num(g(c, 'durationDays', 'duration_days', 'days')),
    startsAt: g(c, 'startsAt', 'starts_at', 'startedAt', 'started_at'),
    endsAt: g(c, 'endsAt', 'ends_at'),
    impressions: num(g(c, 'impressions', 'stats.impressions')),
    joins: num(g(c, 'joins', 'joinRequests', 'join_requests', 'stats.joins')),
    checkIns: num(g(c, 'checkIns', 'check_ins', 'stats.checkIns', 'stats.check_ins')),
    labelled: bool(g(c, 'labelled', 'sponsoredLabel', 'sponsored_label')) ?? true,
  };
}

export function normCategory(c) {
  return {
    id: g(c, 'id'),
    slug: g(c, 'slug'),
    label: g(c, 'label', 'name') || g(c, 'slug'),
    risk: g(c, 'riskLevel', 'risk_level', 'risk') || 'standard',
    active: bool(g(c, 'isActive', 'is_active', 'active')) ?? true,
    plans30d: num(g(c, 'plans30d', 'plans_30d', 'activityCount', 'activity_count')),
  };
}

export function normArea(a) {
  return {
    id: g(a, 'id') || g(a, 'name'),
    name: g(a, 'name'),
    city: g(a, 'city'),
    active: bool(g(a, 'active', 'isActive', 'is_active')) ?? true,
    pilot: bool(g(a, 'pilot', 'isPilot', 'is_pilot')),
    plansWeek: num(g(a, 'plansWeek', 'plans_week', 'plansPerWeek')),
    medianAcceptMin: num(g(a, 'medianAcceptMin', 'median_accept_min', 'medianTimeToAcceptMin')),
    latitude: num(g(a, 'latitude', 'lat', 'centroid.latitude')),
    longitude: num(g(a, 'longitude', 'lng', 'centroid.longitude')),
  };
}

export function normQuest(q) {
  const criteria = g(q, 'criteria') || {};
  return {
    id: g(q, 'id'),
    slug: g(q, 'slug') || g(q, 'id'),
    title: g(q, 'title') || '',
    description: g(q, 'description') || '',
    kind: g(q, 'kind', 'cadence') || g(criteria, 'kind', 'cadence') || '',
    xp: num(g(q, 'xpReward', 'xp_reward', 'xp')) ?? 0,
    active: bool(g(q, 'active', 'isActive', 'is_active')) ?? false,
    startsAt: g(q, 'startsAt', 'starts_at') || null,
    endsAt: g(q, 'endsAt', 'ends_at') || null,
    criteria,
  };
}
