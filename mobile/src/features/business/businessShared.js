// Business hub data helpers. Everything comes from the API:
//   GET  /venues?category · GET /venues/{id} · POST /business/venues
//   GET  /business/campaigns · POST /business/campaigns
//   GET  /business/analytics?venueId&range · POST /business/payments/order
// Shapes are normalised defensively so screens tolerate partial payloads.
import { business } from '@/api/endpoints';
import { categoryBySlug } from '@/data/catalog';
import { itemsOf } from '@/features/premium/useRemote';

// The API returns `offers` as an array of strings or { title|text, terms } objects.
// The screens show the first one as `offer` (+ optional `offerTerms`).
function firstOffer(v) {
  const list = Array.isArray(v.offers) ? v.offers : [];
  const o = list[0];
  if (!o) return { offer: v.offer || '', offerTerms: v.offerTerms || '' };
  if (typeof o === 'string') return { offer: o, offerTerms: v.offerTerms || '' };
  return { offer: o.title || o.text || o.name || v.offer || '', offerTerms: o.terms || o.conditions || v.offerTerms || '' };
}

export function normaliseVenue(v) {
  if (!v) return null;
  const categories = Array.isArray(v.categories) ? v.categories : v.category ? [v.category] : [];
  return {
    ...v,
    ...firstOffer(v),
    categories,
    pictogram: v.pictogram || categoryBySlug[categories[0]]?.pictogram || 'pin',
    accentIndex: v.accentIndex ?? 0,
    kind: v.kind || categoryBySlug[categories[0]]?.label || 'Venue',
    verified: !!v.verified,
    sponsored: !!v.sponsored,
    upcomingPlans: Array.isArray(v.upcomingPlans) ? v.upcomingPlans : [],
  };
}

export async function fetchVenues(category) {
  const res = await business.venues(category ? { category } : undefined);
  return itemsOf(res).map(normaliseVenue);
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
  `${venue?.name || 'This venue'} paid to show this to people around ${area || venue?.area || 'you'}. Paid placement can move it higher in this list, but it never skips safety checks, spam limits or relevance filters, and it never guarantees who shows up.`;

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
