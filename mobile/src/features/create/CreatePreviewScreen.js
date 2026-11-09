// Create step 6 — one summary card (tap a line to edit), an optional table hold
// at a partner venue, three safety checks, publish.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { ReduceMotion, ZoomIn } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, ListGroup, ListRow, usePressScale } from '@/components';
import { tableHolds } from '@/api/endpoints';
import { IconBubble } from '@/components/Card';
import { categoryBySlug } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { accents, colors, radius, space } from '@/theme/tokens';
import { durationLabel, relativeDay, timeLabel } from '@/utils/format';
import haptics from '@/utils/haptics';
import StepScaffold, { FieldLabel } from './components/StepScaffold';
import { computeStartsAt, draftToActivity, looksPrivate } from './createUtils';

// Safety confirmations: all three are required before publishing.
const CHECKS = [
  { key: 'public', label: 'It’s a public place, not a home' },
  { key: 'inapp', label: 'I’ll keep chat in the app until we meet' },
  { key: 'tools', label: 'I know how to report, block and cancel' },
];

const AUDIENCE_LABEL = { everyone: 'Everyone nearby', circle: 'Circle members', invite_only: 'Invite only' };

// Server validation codes from POST /activities → friendly copy + where to fix it.
const PUBLISH_ERRORS = {
  private_venue_not_allowed: { msg: 'That place looks private. Plans must be in public places.', fix: 'create_activity_place' },
  venue_not_allowed: { msg: 'That venue can’t be used for plans. Pick another public place.', fix: 'create_activity_place' },
  start_in_past: { msg: 'The start time has passed. Pick a new time.', fix: 'create_activity_time' },
  invalid_time: { msg: 'That time doesn’t work. Pick a new time.', fix: 'create_activity_time' },
  category_restricted: { msg: 'This activity type isn’t available right now. Choose another one.', fix: 'create_activity_type' },
  capacity_out_of_range: { msg: 'Group size must be between 2 and 30.', fix: 'create_activity_group' },
  not_circle_member: { msg: 'You’re no longer in that circle. Choose who can see the plan again.', fix: 'create_activity_group' },
  duplicate_plan: { msg: 'You already have a very similar plan live. Edit that one instead.' },
  rate_limited: { msg: 'You’ve published a lot of plans recently. Try again in a little while.' },
  account_restricted: { msg: 'Your account is limited right now, so you can’t host plans. Check the Safety center for details.' },
  network: { msg: 'No connection. Your draft is saved. Try again when you’re back online.' },
  timeout: { msg: 'The server took too long. Your draft is saved. Try again.' },
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const checkPop = ZoomIn.springify().damping(14).stiffness(260).reduceMotion(ReduceMotion.System);

const newClientKey = () => `create_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

// Checklist row (56pt): the 24pt box is centred on the label's first 22pt
// line via a 1pt text offset, and the tick pops in with a spring.
function Check({ checked, label, onPress, last }) {
  const press = usePressScale(0.98);
  return (
    <AnimatedPressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={[{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.md, minHeight: 56, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }, press.style]}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: checked ? colors.ink : colors.border,
          backgroundColor: checked ? colors.ink : colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked && (
          <Animated.View entering={checkPop}>
            <Icon name="check" size={14} color={colors.white} />
          </Animated.View>
        )}
      </View>
      <AppText variant="bodyStrong" style={{ flex: 1, marginLeft: space.sm, paddingTop: 1 }}>
        {label}
      </AppText>
    </AnimatedPressable>
  );
}

export default function CreatePreviewScreen() {
  const nav = useNavigation();
  const draft = useAppStore((s) => s.draft);
  const profile = useAppStore((s) => s.profile);
  const progress = useAppStore((s) => s.progress);
  const circles = useAppStore((s) => s.circles);
  const updateDraft = useAppStore((s) => s.updateDraft);
  const publishDraft = useAppStore((s) => s.publishDraft);

  const [checks, setChecks] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fixRoute, setFixRoute] = useState(null);

  // Stable idempotency key for this draft so a retried publish can't create duplicates.
  useEffect(() => {
    if (!draft.clientKey) updateDraft({ clientKey: newClientKey() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.clientKey]);

  const preview = useMemo(() => draftToActivity(draft, profile, progress), [draft, profile, progress]);
  const circle = useMemo(() => circles.find((c) => c.id === draft.circleId), [circles, draft.circleId]);
  const allChecked = CHECKS.every((c) => checks[c.key]);

  const problems = [];
  if (!draft.category) problems.push('activity');
  if (!draft.startsAt && !['now', 'in15'].includes(draft.when)) problems.push('time');
  if (looksPrivate(draft.venueName)) problems.push('a public place');
  if ((draft.title || '').trim().length < 3) problems.push('title');

  const publish = async () => {
    setError(null);
    setFixRoute(null);
    setLoading(true);
    try {
      // Relative windows are re-anchored at publish time so "now" means now.
      if (['now', 'in15'].includes(draft.when)) updateDraft({ startsAt: computeStartsAt(draft.when) });
      else if (draft.startsAt && new Date(draft.startsAt).getTime() < Date.now()) {
        setError(PUBLISH_ERRORS.start_in_past.msg);
        setFixRoute(PUBLISH_ERRORS.start_in_past.fix);
        setLoading(false);
        return;
      }
      if (!draft.clientKey) updateDraft({ clientKey: newClientKey() });
      // Read before publishing: publishDraft resets the draft.
      const wantsHold = !!draft.venueId && draft.tableHold !== false;
      const activity = await publishDraft();
      haptics.success();
      // Ask the partner venue to hold a table. Fire and forget: a missing
      // endpoint (404) or any other error never blocks the plan.
      if (wantsHold && activity?.id) tableHolds.request(activity.id, {}).catch(() => null);
      nav.reset({ index: 1, routes: [{ name: 'main' }, { name: 'activity_detail', params: { id: activity.id, justPublished: true } }] });
    } catch (e) {
      // The draft stays in the store on failure; nothing is lost.
      setLoading(false);
      haptics.warning();
      if (e?.code === 'age_gate_required') {
        nav.navigate('age_gate', { returnTo: { screen: 'create_activity_preview' } });
        return;
      }
      const known = PUBLISH_ERRORS[e?.code];
      setError(known?.msg || e?.message || 'Could not publish. Check your connection and try again.');
      setFixRoute(known?.fix || null);
    }
  };

  const startsAt = draft.startsAt || preview.startsAt;
  const accent = accents[(preview.accentIndex ?? 0) % accents.length];
  const catLabel = draft.custom ? 'Custom plan' : categoryBySlug[draft.category]?.label || 'Activity';
  const audience = draft.audience === 'circle' && circle ? circle.name : AUDIENCE_LABEL[draft.audience];

  return (
    <StepScaffold
      step={6}
      title="Looks good?"
      subtitle="Tap any line to change it."
      onNext={publish}
      nextLabel="Publish plan"
      nextIcon="send"
      loading={loading}
      nextDisabled={!allChecked || problems.length > 0}
      error={(fixRoute ? null : error) || (problems.length ? `Missing: ${problems.join(', ')}` : null)}
      hint={!allChecked ? 'Tick the three checks to publish' : null}
    >
      {!!error && !!fixRoute && (
        <Pressable
          onPress={() => nav.navigate(fixRoute)}
          accessibilityRole="button"
          accessibilityLabel={`${error} Go back and fix it.`}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, backgroundColor: colors.pinkSoft, borderRadius: radius.quest, paddingHorizontal: space.sm, marginTop: space.md }}
        >
          <Icon name="alert-circle" size={18} color={colors.danger} />
          <AppText variant="label" style={{ flex: 1, marginHorizontal: space.xs }}>
            {error}
          </AppText>
          <AppText variant="label" color={colors.deep}>
            Fix
          </AppText>
          <Icon name="chevron-right" size={14} color={colors.deep} />
        </Pressable>
      )}

      {/* Summary card */}
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md, marginTop: space.lg }}>
        <Pressable
          onPress={() => nav.navigate('create_activity_details')}
          accessibilityRole="button"
          accessibilityLabel={`${preview.title}. ${catLabel}. Edit details`}
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <IconBubble size={48} shape="squircle" bg={accent.bg} duo={colors.surface} pictogram={preview.pictogram} iconSize={26} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="h3" numberOfLines={2}>
              {preview.title}
            </AppText>
            <AppText variant="caption" color={colors.muted} numberOfLines={2} style={{ marginTop: 2 }}>
              {draft.description || `${catLabel} · hosted by you`}
            </AppText>
          </View>
          <Icon name="chevron-right" size={18} color={colors.muted} style={{ marginLeft: space.xs }} />
        </Pressable>
        <ListRow
          icon="clock"
          title={['now', 'in15'].includes(draft.when) ? (draft.when === 'now' ? 'Starting now' : 'In 15 minutes') : `${relativeDay(startsAt)} · ${timeLabel(startsAt)}`}
          subtitle={durationLabel(draft.durationMin)}
          onPress={() => nav.navigate('create_activity_time')}
        />
        <ListRow icon="map-pin" title={`${draft.venueType} · ${draft.area}`} subtitle={draft.venueName || 'Exact spot shared after you accept people'} onPress={() => nav.navigate('create_activity_place')} />
        <ListRow
          icon="users"
          title={`Up to ${draft.capacity} · ${draft.joinRule === 'approval' ? 'You approve' : 'Instant join'}`}
          subtitle={[audience, draft.level && draft.level !== 'any' ? draft.level : null, draft.ageRange].filter(Boolean).join(' · ')}
          onPress={() => nav.navigate('create_activity_group')}
        />
        <ListRow
          icon="dollar-sign"
          title={draft.cost || 'Free'}
          subtitle={[(draft.tags || []).join(' · '), draft.accessibility ? 'Accessibility notes' : null].filter(Boolean).join(' · ') || null}
          onPress={() => nav.navigate('create_activity_details')}
          last
        />
      </View>

      {/* Partner venue: optional table hold (no payment involved) */}
      {!!draft.venueId && (
        <>
          <FieldLabel>Partner venue</FieldLabel>
          <ListGroup>
            <ListRow
              icon="calendar-check"
              title="Ask the venue to hold a table"
              subtitle={`We send ${draft.venueName || 'the venue'} your time and group size. No payment needed.`}
              toggle={draft.tableHold !== false}
              onToggle={(v) => updateDraft({ tableHold: v })}
              last
            />
          </ListGroup>
        </>
      )}

      {/* Safety confirmations */}
      <FieldLabel>Before you publish</FieldLabel>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }}>
        {CHECKS.map((c, i) => (
          <Check key={c.key} label={c.label} checked={!!checks[c.key]} last={i === CHECKS.length - 1} onPress={() => setChecks((s) => ({ ...s, [c.key]: !s[c.key] }))} />
        ))}
      </View>
    </StepScaffold>
  );
}
