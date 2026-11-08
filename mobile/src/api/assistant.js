// IRL Guide — suggestions come from POST /assistant/suggest. The backend runs
// the LLM grounded on real nearby plans from the database, enforces the daily
// quota and guardrails, and never invents plans or acts on the user's behalf.
import { assistant } from './endpoints';

export const SUGGESTED_PROMPTS = [
  'What can I do nearby?',
  'Find someone for chai',
  'I have 20 minutes free',
  'Find a gym partner',
  'Suggest something for tonight',
  'Find a group for badminton',
  'Help me organise a weekend plan',
];

// Returns { reply, activityIds, activities, draft, promptsLeft }.
export async function suggest(prompt, { coords, radiusKm } = {}) {
  return assistant.suggest({ prompt, lat: coords?.latitude, lng: coords?.longitude, radiusKm: radiusKm ? Math.min(25, Math.max(0.2, radiusKm)) : undefined });
}
