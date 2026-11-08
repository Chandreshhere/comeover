// Collects screens from every feature module. Each feature exports
// `screens = { <inventory_id>: Component }` and optional `options`.
// Any inventory id without an implementation falls back to <Placeholder/>.
import { INVENTORY } from './inventory';
import Placeholder from './Placeholder';

import * as onboarding from '@/features/onboarding';
import * as discover from '@/features/discover';
import * as plans from '@/features/plans';
import * as live from '@/features/live';
import * as create from '@/features/create';
import * as progress from '@/features/progress';
import * as assistant from '@/features/assistant';
import * as circles from '@/features/circles';
import * as messaging from '@/features/messaging';
import * as splitmate from '@/features/splitmate';
import * as profile from '@/features/profile';
import * as safety from '@/features/safety';
import * as premium from '@/features/premium';
import * as business from '@/features/business';
import * as system from '@/features/system';

const modules = [onboarding, discover, plans, live, create, progress, assistant, circles, messaging, splitmate, profile, safety, premium, business, system];

const implemented = Object.assign({}, ...modules.map((m) => m.screens || {}));
const options = Object.assign({}, ...modules.map((m) => m.options || {}));

export const SCREENS = INVENTORY.map((s) => ({
  ...s,
  component: implemented[s.id] || Placeholder,
  options: options[s.id] || {},
  implemented: !!implemented[s.id],
}));

export const getScreen = (id) => SCREENS.find((s) => s.id === id);
