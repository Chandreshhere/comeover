'use strict';
// users ← app_users + profiles + notification_preferences + user_progress + availability_status.
// `profile` is null until profile setup (the first PATCH /me with a name).
const { makeSchema, sub, Mixed, model } = require('./_base');

const ProfileSchema = sub({
  displayName: { type: String, required: true, maxlength: 40 },
  avatarKey: { type: String, default: null },
  bio: { type: String, maxlength: 240, default: null },
  homeCity: { type: String, default: null },
  homeArea: { type: String, default: null },
  interests: { type: [String], default: [] },
  intents: { type: [String], default: [] },
  visibility: { type: String, enum: ['discoverable', 'friends_only', 'hidden'], default: 'discoverable' },
  boundaries: { type: String, maxlength: 240, default: null },
  languages: { type: [String], default: [] },
  reliabilityScore: { type: Number, min: 0, max: 1, default: 1 },
  preferences: { type: Mixed, default: () => ({}) }, // pronouns, avatarSeed, availabilityWindows, radiusKm, showOnRadar, analyticsConsent, language, onboardedAt…
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const NotificationPrefsSchema = sub({
  productUpdates: { type: Boolean, default: false },
  nearbyActivities: { type: Boolean, default: true },
  joinRequests: { type: Boolean, default: true },
  messages: { type: Boolean, default: true },
  questReminders: { type: Boolean, default: false },
  quietHours: { type: sub({ start: { type: String, default: '22:00' }, end: { type: String, default: '08:00' } }), default: () => ({}) },
});

const ProgressSchema = sub({
  xpTotal: { type: Number, min: 0, default: 0 },
  level: { type: Number, default: 1 },
  weeklyGoal: { type: Number, min: 1, max: 14, default: 2 },
  streakWeeks: { type: Number, default: 0 },
  freezesLeft: { type: Number, default: 1 },
  dailyStreakOptIn: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
});

const AvailabilitySchema = sub({
  status: { type: String, enum: ['now', 'later', 'busy'], default: 'busy' },
  activitySlugs: { type: [String], default: [] },
  coarseCell: { type: String, default: null }, // ~1.2 km cell id; exact coordinates are discarded
  area: { type: String, default: null },
  until: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
});

const UserSchema = makeSchema({
  phone: { type: String, required: true }, // E.164; 'deleted:<id>' after purge
  status: { type: String, enum: ['active', 'limited', 'suspended', 'deleted'], default: 'active' },
  statusReason: { type: String, default: null },
  statusUntil: { type: Date, default: null },
  ageVerified: { type: Boolean, default: false },
  ageVerifiedAt: { type: Date, default: null },
  ageVerificationMethod: { type: String, default: null },
  termsAcceptedAt: { type: Date, default: null },
  roles: { type: [String], enum: ['admin', 'moderator'], default: [] }, // admin console access
  profile: { type: ProfileSchema, default: null },
  notificationPrefs: { type: NotificationPrefsSchema, default: () => ({}) },
  progress: { type: ProgressSchema, default: () => ({}) },
  availability: { type: AvailabilitySchema, default: () => ({}) },
  lastActiveAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  purgeAfter: { type: Date, default: null },
});

UserSchema.index({ phone: 1 }, { unique: true });
UserSchema.index({ status: 1, purgeAfter: 1 });
UserSchema.index({ 'availability.status': 1, 'availability.coarseCell': 1 });
UserSchema.index({ roles: 1 }, { sparse: true });
UserSchema.index({ lastActiveAt: -1 });
UserSchema.index({ createdAt: -1 });

UserSchema.virtual('hasProfile').get(function hasProfile() {
  return !!(this.profile && this.profile.displayName);
});

module.exports = model('User', UserSchema, 'users');
