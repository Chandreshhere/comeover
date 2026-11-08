-- 002: production extensions on top of the 001 baseline (07_postgres_schema.sql).
-- Adds geo, idempotency, moderation, rate limiting, realtime, progression,
-- business, notifications, itemised expenses and entitlements.
CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Identity & profiles
-- ---------------------------------------------------------------------------
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS cognito_sub TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_reason TEXT,
  ADD COLUMN IF NOT EXISTS status_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS home_area TEXT,
  ADD COLUMN IF NOT EXISTS intents TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS boundaries VARCHAR(240),
  ADD COLUMN IF NOT EXISTS languages TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reliability_score NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (reliability_score BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}';

-- Client presentation fields.
ALTER TABLE activity_categories
  ADD COLUMN IF NOT EXISTS short TEXT,
  ADD COLUMN IF NOT EXISTS pictogram TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100;

-- City areas for the manual (location-off) discovery path.
CREATE TABLE IF NOT EXISTS city_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city TEXT NOT NULL,
  name TEXT NOT NULL,
  centroid geography(Point,4326) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(city, name)
);

-- ---------------------------------------------------------------------------
-- Activities: geo + privacy + lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS geog geography(Point,4326),
  ADD COLUMN IF NOT EXISTS coarse_geohash TEXT,
  ADD COLUMN IF NOT EXISTS join_rule TEXT NOT NULL DEFAULT 'approval' CHECK (join_rule IN ('approval','instant')),
  ADD COLUMN IF NOT EXISTS venue_type TEXT,
  ADD COLUMN IF NOT EXISTS cost_note TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS accessibility_notes TEXT,
  ADD COLUMN IF NOT EXISTS activity_level TEXT NOT NULL DEFAULT 'any' CHECK (activity_level IN ('any','beginner','intermediate','advanced')),
  ADD COLUMN IF NOT EXISTS circle_id UUID REFERENCES circles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sponsored_campaign_id UUID,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS moderation_note TEXT;

CREATE INDEX IF NOT EXISTS activities_geog_gix ON activities USING GIST (geog);
CREATE INDEX IF NOT EXISTS activities_geohash_idx ON activities (coarse_geohash);
CREATE INDEX IF NOT EXISTS activities_circle_idx ON activities (circle_id) WHERE circle_id IS NOT NULL;

-- geog + a ~1.2 km geohash cell are derived from the venue coordinates.
-- Raw latitude/longitude are never returned to non-participants (see src/lib/geo.js).
CREATE OR REPLACE FUNCTION activities_set_geo() RETURNS trigger AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geog := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    NEW.coarse_geohash := ST_GeoHash(ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326), 6);
  ELSE
    NEW.geog := NULL;
    NEW.coarse_geohash := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activities_geo_trg ON activities;
CREATE TRIGGER activities_geo_trg BEFORE INSERT OR UPDATE OF latitude, longitude ON activities
  FOR EACH ROW EXECUTE FUNCTION activities_set_geo();

-- Join requests: idempotency, intro, waitlist, check-in provenance.
ALTER TABLE activity_participants
  ADD COLUMN IF NOT EXISTS intro VARCHAR(280),
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS waitlist_position INTEGER,
  ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS check_in_method TEXT CHECK (check_in_method IN ('proximity','manual','host'));
CREATE INDEX IF NOT EXISTS activity_participants_activity_state_idx ON activity_participants(activity_id, state);

CREATE TABLE IF NOT EXISTS activity_feedback (
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  about_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  showed_up BOOLEAN,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5), -- private; never shown raw to others
  note VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, from_user_id, about_user_id),
  CHECK (from_user_id <> about_user_id)
);

CREATE TABLE IF NOT EXISTS reliability_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('attended','no_show','late_cancel','host_cancel','disputed','appeal_upheld')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, activity_id, kind)
);

-- ---------------------------------------------------------------------------
-- Idempotency, rate limits, OTP
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id UUID NOT NULL,
  key TEXT NOT NULL,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys(created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  tokens DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_attempts (
  id BIGSERIAL PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  ip TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('send','verify')),
  success BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_attempts_phone_idx ON otp_attempts(phone_e164, created_at DESC);

-- ---------------------------------------------------------------------------
-- Admin, audit, moderation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer','support','moderator','admin')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  actor_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_target_idx ON audit_events(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor_user_id, created_at DESC);

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence_keys TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  ADD COLUMN IF NOT EXISTS circle_id UUID REFERENCES circles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence_note VARCHAR(2000),
  ADD COLUMN IF NOT EXISTS assigned_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS reports_queue_idx ON reports(status, priority, created_at);
CREATE INDEX IF NOT EXISTS reports_reported_idx ON reports(reported_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS report_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('dismiss','warn','limit','suspend','remove_content','cancel_activity','restore','escalate')),
  notes TEXT,
  duration_days INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  statement VARCHAR(2000) NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','overturned')),
  decided_by UUID REFERENCES admin_users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Realtime (API Gateway WebSocket)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ws_connections (
  connection_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ws_connections_user_idx ON ws_connections(user_id);
CREATE TABLE IF NOT EXISTS ws_subscriptions (
  connection_id TEXT NOT NULL REFERENCES ws_connections(connection_id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  PRIMARY KEY (connection_id, channel)
);
CREATE INDEX IF NOT EXISTS ws_subscriptions_channel_idx ON ws_subscriptions(channel);

ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ; -- "delete for me" on direct chats (reappears on new message)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS circle_id UUID REFERENCES circles(id) ON DELETE CASCADE;

-- System messages ("Meher accepted you…") have no human sender.
ALTER TABLE messages ALTER COLUMN sender_user_id DROP NOT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user','system'));
DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_sender_chk CHECK (kind = 'system' OR sender_user_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trusted_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','accepted','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone_e164)
);
CREATE TABLE IF NOT EXISTS plan_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  trusted_contact_id UUID REFERENCES trusted_contacts(id) ON DELETE CASCADE,
  share_token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS availability_status (
  user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'busy' CHECK (status IN ('now','later','busy')),
  activity_slugs TEXT[] NOT NULL DEFAULT '{}',
  coarse_geohash TEXT, -- 6-char cell (~1.2 km); exact coordinates are discarded
  area TEXT,
  available_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS availability_status_geo_idx ON availability_status(status, coarse_geohash);

-- ---------------------------------------------------------------------------
-- Circles
-- ---------------------------------------------------------------------------
ALTER TABLE circles
  ADD COLUMN IF NOT EXISTS area TEXT,
  ADD COLUMN IF NOT EXISTS pictogram TEXT NOT NULL DEFAULT 'people',
  ADD COLUMN IF NOT EXISTS category_slug TEXT,
  ADD COLUMN IF NOT EXISTS rules TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','moderated'));

CREATE TABLE IF NOT EXISTS circle_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description VARCHAR(500),
  target_count INTEGER NOT NULL CHECK (target_count > 0),
  xp_reward INTEGER NOT NULL DEFAULT 0 CHECK (xp_reward >= 0),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS circle_challenge_progress (
  challenge_id UUID NOT NULL REFERENCES circle_challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (challenge_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Progression
-- ---------------------------------------------------------------------------
-- Levels double as roadmap milestones (subtitle/pictogram for the journey path).
CREATE TABLE IF NOT EXISTS levels (
  level INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  xp_threshold INTEGER NOT NULL UNIQUE,
  subtitle TEXT,
  pictogram TEXT
);
CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  pictogram TEXT,
  color TEXT NOT NULL DEFAULT 'lavender',
  criteria JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
-- One recover/freeze per ISO week, applied to a missed day (daily opt-in) or the week.
CREATE TABLE IF NOT EXISTS streak_freezes (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
-- Server-side IRL Guide quota (per IST day).
CREATE TABLE IF NOT EXISTS assistant_usage (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, achievement_id)
);
CREATE TABLE IF NOT EXISTS user_progress (
  user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  xp_total INTEGER NOT NULL DEFAULT 0 CHECK (xp_total >= 0),
  level INTEGER NOT NULL DEFAULT 1,
  weekly_goal INTEGER NOT NULL DEFAULT 2 CHECK (weekly_goal BETWEEN 1 AND 14),
  streak_weeks INTEGER NOT NULL DEFAULT 0,
  freezes_left INTEGER NOT NULL DEFAULT 1,
  daily_streak_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Daily XP cap bookkeeping (Asia/Kolkata calendar day).
CREATE TABLE IF NOT EXISTS xp_daily_totals (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS xp_events_user_time_idx ON xp_events(user_id, created_at DESC);
ALTER TABLE quests ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'weekly' CHECK (kind IN ('daily','weekly','milestone'));
ALTER TABLE quests ADD COLUMN IF NOT EXISTS pictogram TEXT;
ALTER TABLE user_quests ADD COLUMN IF NOT EXISTS period_key TEXT NOT NULL DEFAULT 'all';
-- Daily/weekly quests repeat, so a claim is unique per period.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.key_column_usage WHERE table_name = 'user_quests' AND constraint_name = 'user_quests_pkey' AND column_name = 'period_key') THEN
    ALTER TABLE user_quests DROP CONSTRAINT user_quests_pkey;
    ALTER TABLE user_quests ADD CONSTRAINT user_quests_pkey PRIMARY KEY (user_id, quest_id, period_key);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Business: venues, campaigns, invoices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app_users(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('venue','club','organiser')),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected','suspended')),
  contact_email TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  gstin TEXT,
  verification_doc_key TEXT,
  review_note TEXT,
  plan_id TEXT,
  agreements JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS business_staff (
  business_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','manager','staff')),
  PRIMARY KEY (business_id, user_id)
);
CREATE TABLE IF NOT EXISTS venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  area TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geog geography(Point,4326),
  venue_type TEXT,
  category_slugs TEXT[] NOT NULL DEFAULT '{}',
  description VARCHAR(1000),
  is_public_place BOOLEAN NOT NULL DEFAULT TRUE,
  booking_url TEXT,
  offers JSONB NOT NULL DEFAULT '[]',
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venues_geog_gix ON venues USING GIST (geog);

CREATE OR REPLACE FUNCTION venues_set_geo() RETURNS trigger AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geog := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  ELSE
    NEW.geog := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS venues_geo_trg ON venues;
CREATE TRIGGER venues_geo_trg BEFORE INSERT OR UPDATE OF latitude, longitude ON venues
  FOR EACH ROW EXECUTE FUNCTION venues_set_geo();

CREATE TABLE IF NOT EXISTS sponsored_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  audience JSONB NOT NULL DEFAULT '{}',
  budget_minor BIGINT NOT NULL CHECK (budget_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('draft','pending_review','active','paused','completed','rejected')),
  label TEXT NOT NULL DEFAULT 'Sponsored', -- paid placement is always labelled
  created_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
DO $$ BEGIN
  ALTER TABLE activities ADD CONSTRAINT activities_campaign_fk FOREIGN KEY (sponsored_campaign_id) REFERENCES sponsored_campaigns(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE sponsored_campaigns ADD COLUMN IF NOT EXISTS spent_minor BIGINT NOT NULL DEFAULT 0 CHECK (spent_minor >= 0);

-- Plans can be pinned to a verified partner venue.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venues(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS activities_venue_idx ON activities (venue_id) WHERE venue_id IS NOT NULL;

-- Daily plan views (non-host detail opens) for venue analytics.
CREATE TABLE IF NOT EXISTS activity_daily_metrics (
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (activity_id, day)
);

CREATE TABLE IF NOT EXISTS campaign_metrics (
  campaign_id UUID NOT NULL REFERENCES sponsored_campaigns(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  join_requests INTEGER NOT NULL DEFAULT 0,
  check_ins INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, day)
);

CREATE TABLE IF NOT EXISTS business_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  razorpay_order_id TEXT UNIQUE,
  razorpay_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('activity','nearby','join','message','quest','safety','system','marketing')),
  title TEXT NOT NULL,
  body TEXT,
  data JSONB NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- SplitMate: itemised bills (ledger only; no custody)
-- ---------------------------------------------------------------------------
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS payee_user_id UUID REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS payee_upi_vpa TEXT, -- a public VPA for deep links only; never PINs/credentials
  ADD COLUMN IF NOT EXISTS receipt_key TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
ALTER TABLE expense_shares
  ADD COLUMN IF NOT EXISTS settlement_intent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS expense_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS item_assignments (
  item_id UUID NOT NULL REFERENCES expense_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  share_ratio NUMERIC(6,3) NOT NULL DEFAULT 1 CHECK (share_ratio > 0),
  PRIMARY KEY (item_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Entitlements (server-owned; derived from verified store/business purchases)
-- ---------------------------------------------------------------------------
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS original_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN,
  ADD COLUMN IF NOT EXISTS raw_status JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  entitlement TEXT NOT NULL CHECK (entitlement IN ('plus','pro','venue')),
  source TEXT NOT NULL CHECK (source IN ('apple','google','razorpay','grant')),
  source_ref TEXT,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entitlement)
);
