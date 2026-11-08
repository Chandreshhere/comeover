-- PostgreSQL baseline schema; enable PostGIS if using geo-distance filters.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- CREATE EXTENSION IF NOT EXISTS postgis; -- enable when using PostGIS on the selected managed database.

CREATE TABLE app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT UNIQUE NOT NULL,
  age_verified BOOLEAN NOT NULL DEFAULT FALSE,
  age_verified_at TIMESTAMPTZ,
  age_verification_method TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','limited','suspended','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_key TEXT,
  bio VARCHAR(240),
  home_city TEXT,
  interests TEXT[] NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'discoverable' CHECK (visibility IN ('discoverable','friends_only','hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activity_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  risk_level TEXT NOT NULL DEFAULT 'standard' CHECK (risk_level IN ('standard','elevated','restricted'))
);

CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id UUID NOT NULL REFERENCES app_users(id),
  category_id UUID REFERENCES activity_categories(id),
  title TEXT NOT NULL,
  description TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  capacity SMALLINT NOT NULL DEFAULT 4 CHECK (capacity BETWEEN 2 AND 30),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','circle','invite_only')),
  venue_name TEXT,
  coarse_area TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  exact_location_visible_after_accept BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','full','in_progress','completed','cancelled','moderated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX activities_start_status_idx ON activities(status, starts_at);
CREATE INDEX activities_host_idx ON activities(host_user_id, created_at DESC);

CREATE TABLE activity_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('requested','accepted','waitlisted','declined','cancelled','checked_in','completed','no_show')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  completion_confirmed_at TIMESTAMPTZ,
  UNIQUE(activity_id, user_id)
);
CREATE INDEX activity_participants_user_idx ON activity_participants(user_id, requested_at DESC);

CREATE TABLE circles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app_users(id),
  name TEXT NOT NULL,
  description VARCHAR(500),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE circle_members (
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','moderator','member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(circle_id, user_id)
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('direct','activity_group','circle')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES app_users(id),
  body TEXT,
  media_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX messages_conversation_time_idx ON messages(conversation_id, created_at DESC);

CREATE TABLE user_blocks (
  blocker_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(blocker_user_id, blocked_user_id),
  CHECK(blocker_user_id <> blocked_user_id)
);
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID NOT NULL REFERENCES app_users(id),
  reported_user_id UUID REFERENCES app_users(id),
  activity_id UUID REFERENCES activities(id),
  reason_code TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','actioned','dismissed','appealed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE xp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES activities(id),
  event_type TEXT NOT NULL,
  xp_delta INTEGER NOT NULL CHECK (xp_delta >= 0),
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  criteria JSONB NOT NULL,
  xp_reward INTEGER NOT NULL CHECK (xp_reward >= 0),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE user_quests (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  quest_id UUID NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  progress JSONB NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'available' CHECK (state IN ('available','started','completed','claimed','expired')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,quest_id)
);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id UUID NOT NULL REFERENCES app_users(id),
  activity_id UUID REFERENCES activities(id),
  description TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  total_minor BIGINT NOT NULL CHECK(total_minor > 0),
  split_method TEXT NOT NULL CHECK(split_method IN ('equal','custom','itemised','percentage')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE expense_shares (
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id),
  amount_minor BIGINT NOT NULL CHECK(amount_minor >= 0),
  state TEXT NOT NULL DEFAULT 'unsettled' CHECK(state IN ('unsettled','marked_paid','confirmed','disputed')),
  payment_reference TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(expense_id,user_id)
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id),
  store TEXT NOT NULL CHECK(store IN ('apple','google','web')),
  product_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  store_transaction_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  product_updates BOOLEAN NOT NULL DEFAULT FALSE,
  nearby_activities BOOLEAN NOT NULL DEFAULT TRUE,
  join_requests BOOLEAN NOT NULL DEFAULT TRUE,
  messages BOOLEAN NOT NULL DEFAULT TRUE,
  quest_reminders BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_hours JSONB NOT NULL DEFAULT '{"start":"22:00","end":"08:00"}'
);
CREATE TABLE device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('ios','android')),
  token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Production requirements: add row-level authorization, audit events, rate limits,
-- soft deletion/retention jobs, encryption at rest, and geospatial index strategy.
-- Do not award XP from client requests. Do not treat user-reported payments as bank-confirmed.
