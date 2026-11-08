// Presentation helpers for circle data returned by the API:
// GET /circles/{id}/members → PublicUser[] with `role`,
// GET /circles/{id}/challenge → shared milestone.
import { personById } from '@/data/catalog';

export const ROLE_LABEL = { owner: 'Owner', moderator: 'Moderator', member: 'Member' };
const ROLE_ORDER = { owner: 0, moderator: 1, member: 2 };

// Sorts members by role, hides blocked people and labels the signed-in user.
export function sortMembers(list = [], { profileName, blocked = [] } = {}) {
  return list
    .filter((m) => m && !blocked.includes(m.id))
    .map((m) => ({
      ...m,
      role: m.role || 'member',
      name: m.id === 'me' ? (profileName ? `${profileName} (you)` : 'You') : m.name || personById[m.id]?.name || 'Member',
    }))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) || (a.name || '').localeCompare(b.name || ''));
}

// Accepts the server challenge payload and fills safe defaults for display.
export function normalizeChallenge(ch) {
  if (!ch) return null;
  const goal = Math.max(1, ch.goal ?? ch.target ?? 1);
  const progress = Math.min(goal, ch.progress ?? ch.count ?? 0);
  const endsAt = ch.endsAt ? new Date(ch.endsAt) : null;
  const daysLeft = ch.daysLeft ?? (endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 864e5)) : null);
  return {
    id: ch.id,
    title: ch.title || `${goal} group meetups`,
    subtitle: ch.subtitle || ch.description || 'Every verified circle meetup counts',
    goal,
    progress,
    daysLeft,
    rewardXp: ch.rewardXp ?? ch.xpReward ?? null,
    joined: !!(ch.joined || ch.joinedAt || ch.myParticipation),
    completed: progress >= goal,
    contributors: (ch.contributors || [])
      .map((p) => ({ id: p.userId || p.id, name: p.name || personById[p.userId || p.id]?.name || 'Member', count: p.count ?? p.meetups ?? 0 }))
      .sort((a, b) => b.count - a.count),
  };
}
