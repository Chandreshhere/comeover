// Business hub data helpers. Everything comes from the API:
//   GET  /venues?category · GET /venues/{id} · POST /business/venues
//   GET  /business/campaigns · POST /business/campaigns
//   GET  /business/analytics?venueId&range · POST /business/payments/order
// Shapes are normalised defensively so screens tolerate partial payloads.
import { business, perks as perksApi } from '@/api/endpoints';
import { categoryBySlug } from '@/data/catalog';
import { itemsOf } from '@/features/premium/useRemote';
import { isPerkOffer, normaliseOffer } from './perks';

// Legacy venues carry `offers` as strings or { title|text, terms } objects; the
// screens show the first one as `offer` (+ optional `offerTerms`). Partner perks
// (VenueOffer objects with id + label) are kept separately as `perks`.
function firstOffer(v) {
  const list = (Array.isArray(v.offers) ? v.offers : []).filter((o) => !isPerkOffer(o));
  const o = list[0];
  if (!o) return { offer: v.offer || '', offerTerms: v.offerTerms || '' };
  if (typeof o === 'string') return { offer: o, offerTerms: v.offerTerms || '' };
  return { offer: o.title || o.text || o.name || v.offer || '', offerTerms: o.terms || o.conditions || v.offerTerms || '' };
}

export function normaliseVenue(v) {
  if (!v) return null;
  const categories = Array.isArray(v.categories) ? v.categories : v.category ? [v.category] : [];
  const perks = (Array.isArray(v.offers) ? v.offers : []).map(normaliseOffer).filter(Boolean);
  return {
    ...v,
    ...firstOffer(v),
    perks,
    hasOffer: v.hasOffer ?? perks.length > 0,
    bestOfferLabel: v.bestOfferLabel || perks[0]?.label || null,
    categories,
    pictogram: v.pictogram || categoryBySlug[categories[0]]?.pictogram || 'pin',
    accentIndex: v.accentIndex ?? 0,
    kind: v.kind || categoryBySlug[categories[0]]?.label || 'Venue',
    verified: !!v.verified,
    sponsored: !!v.sponsored,
    upcomingPlans: Array.isArray(v.upcomingPlans) ? v.upcomingPlans : [],
  };
}

// `near`: { lat, lng } or { area } so the API sorts by distance.
export async function fetchVenues(category, { hasOffer, near, limit } = {}) {
  const res = await business.venues({ category: category || undefined, hasOffer: hasOffer ? 'true' : undefined, limit, ...(near || {}) });
  return itemsOf(res).map(normaliseVenue);
}

// Reference point for "nearby" lists: rounded device coords, else the home area.
export function nearParams(coords, area) {
  if (coords?.latitude != null && coords?.longitude != null) return { lat: coords.latitude, lng: coords.longitude };
  return area ? { area } : {};
}

// Venues that currently run a perk (GET /venues?hasOffer=true), best first.
export async function fetchPerkVenues(near, max = 6) {
  const list = await fetchVenues(null, { hasOffer: true, near, limit: 20 });
  return list.filter((v) => v.hasOffer && v.bestOfferLabel).slice(0, max);
}

// GET /me/perks → level, show-up, unlocked / locked perks and the next unlock.
export async function fetchMyPerks(coords) {
  const r = (await perksApi.mine(coords?.latitude != null ? { lat: coords.latitude, lng: coords.longitude } : undefined)) || {};
  const items = (list) =>
    (Array.isArray(list) ? list : [])
      .map((p) => ({ offer: normaliseOffer(p?.offer), venue: p?.venue ? normaliseVenue(p.venue) : null }))
      .filter((p) => p.offer && p.venue);
  return {
    level: r.level || null,
    showUpRate: typeof r.showUpRate === 'number' ? r.showUpRate : null,
    plansConsidered: r.plansConsidered ?? 0,
    unlocked: items(r.unlocked),
    locked: items(r.locked),
    nextUnlock: r.nextUnlock || null,
  };
}

export async function fetchVenue(id) {
  return normaliseVenue(await business.venue(id));
}

// The caller's own venue: GET /business/venues/me. 404 / code 'no_venue' when
// they haven't onboarded.
export async function fetchMyVenue() {
  try {
    return normaliseVenue(await business.myVenue());
  } catch (e) {
    if (e?.status === 404 || e?.code === 'no_venue' || e?.code === 'not_found') return null;
    throw e;
  }
}

// Campaign money may come as minor units or rupees; normalise to rupees.
export function normaliseCampaign(c) {
  const rupees = (minor, major) => (minor != null ? minor / 100 : major ?? 0);
  return {
    ...c,
    title: c.title || c.activity?.title || 'Sponsored plan',
    status: c.status || 'in_review',
    budget: rupees(c.budgetMinor, c.budget),
    spent: rupees(c.spentMinor, c.spent),
    days: c.durationDays ?? c.days ?? null,
    impressions: c.impressions ?? c.metrics?.impressions ?? 0,
    joins: c.joins ?? c.metrics?.joins ?? 0,
    checkIns: c.checkIns ?? c.metrics?.checkIns ?? 0,
    actions: c.actions ?? c.metrics?.actions ?? 0,
  };
}

export async function fetchCampaigns() {
  return itemsOf(await business.campaigns()).map(normaliseCampaign);
}

// Paid-placement disclosure. Prefer the server's own text for the placement.
export const sponsoredReason = (venue, area) =>
  venue?.sponsorDisclosure ||
  `${venue?.name || 'This venue'} paid to show this to people around ${area || venue?.area || 'you'}. It can rank higher, but never skips safety checks or filters.`;

// Upcoming plans held at a venue: from the venue payload, else plans in the
// app store that reference the venue id.
export function plansForVenue(venue, activities = []) {
  if (!venue) return [];
  const cutoff = Date.now() - 30 * 60000;
  const fromVenue = venue.upcomingPlans || [];
  const fromStore = activities.filter((a) => a.venueId && a.venueId === venue.id);
  const byId = new Map([...fromStore, ...fromVenue].map((a) => [a.id, a]));
  return Array.from(byId.values()).filter((a) => a.status !== 'cancelled' && new Date(a.startsAt).getTime() > cutoff);
}

export const errorMessage = (e, fallback) => {
  if (e?.status === 0 || e?.code === 'network' || e?.code === 'timeout') return 'No connection. Check your internet and try again.';
  return e?.message || fallback;
};
