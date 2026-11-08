// Create step 6 — review how the plan looks, confirm the safety checklist, publish.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ActivityCard, AppText, Icon, ListGroup, ListRow } from '@/components';
import { categoryBySlug } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { colors, layout, radius, space } from '@/theme/tokens';
import { durationLabel, relativeDay, timeLabel } from '@/utils/format';
import haptics from '@/utils/haptics';
import StepScaffold, { FieldLabel } from './components/StepScaffold';
import { computeStartsAt, draftToActivity, looksPrivate } from './createUtils';

const CHECKS = [
  { key: 'public', label: 'It’s in a public place', sub: 'No homes, hotel rooms or private addresses.' },
  { key: 'inapp', label: 'I’ll coordinate in the app chat', sub: 'Keep details in IRL until you’ve met.' },
  { key: 'tools', label: 'I know how to report, block and cancel', sub: 'Available on every plan and chat.' },
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
  network: { msg: 'No connection. Your draft is saved — try again when you’re back online.' },
  timeout: { msg: 'The server took too long. Your draft is saved — try again.' },
};

const newClientKey = () => `create_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function Check({ checked, label, sub, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.xs, minHeight: 44 }}>
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
          marginTop: 2,
        }}
      >
        {checked && <Icon name="check" size={14} color={colors.white} />}
      </View>
      <View style={{ flex: 1, marginLeft: space.sm }}>
        <AppText variant="bodyStrong">{label}</AppText>
        <AppText variant="caption" color={colors.muted}>
          {sub}
        </AppText>
      </View>
    </Pressable>
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
      const activity = await publishDraft();
      haptics.success();
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

  return (
    <StepScaffold
      step={6}
      title="Looks good?"
      subtitle="This is how your plan appears to people nearby."
      onNext={publish}
      nextLabel="Publish plan"
      nextIcon="send"
      loading={loading}
      nextDisabled={!allChecked || problems.length > 0}
      error={error || (problems.length ? `Missing: ${problems.join(', ')}` : null)}
      hint={!allChecked ? 'Tick the safety checklist to publish' : null}
    >
      {!!error && !!fixRoute && (
        <Pressable
          onPress={() => nav.navigate(fixRoute)}
          accessibilityRole="button"
          accessibilityLabel={`${error} Go back and fix it.`}
          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.pinkSoft, borderRadius: radius.quest, padding: space.sm, marginTop: space.md }}
        >
          <Icon name="alert-circle" size={18} color={colors.danger} />
          <AppText variant="label" style={{ flex: 1, marginLeft: space.xs }}>
            {error}
          </AppText>
          <AppText variant="label" color={colors.deep}>
            Fix
          </AppText>
        </Pressable>
      )}

      <View style={{ backgroundColor: colors.periwinkle, borderRadius: radius.hero, padding: space.md, marginTop: space.lg }}>
        <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: space.sm }}>
          In Discover
        </AppText>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <ActivityCard activity={preview} variant="tile" width={168} />
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <AppText variant="caption" color={colors.inkSoft}>
              Category
            </AppText>
            <AppText variant="bodyStrong">{draft.custom ? 'Custom plan' : categoryBySlug[draft.category]?.label}</AppText>
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xs }}>
              Host
            </AppText>
            <AppText variant="bodyStrong">{profile.name || 'You'}</AppText>
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xs }}>
              Visible to
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={2}>
              {draft.audience === 'circle' && circle ? circle.name : AUDIENCE_LABEL[draft.audience]}
            </AppText>
          </View>
        </View>
        <AppText variant="label" color={colors.inkSoft} style={{ marginTop: space.md, marginBottom: space.sm }}>
          In lists
        </AppText>
        <ActivityCard activity={preview} variant="row" />
      </View>

      <FieldLabel>Summary</FieldLabel>
      <ListGroup>
        <ListRow icon="activity" title={preview.title} subtitle={draft.description || 'No description yet'} onPress={() => nav.navigate('create_activity_details')} />
        <ListRow
          icon="clock"
          title={['now', 'in15'].includes(draft.when) ? (draft.when === 'now' ? 'Starting now' : 'In 15 minutes') : `${relativeDay(startsAt)} · ${timeLabel(startsAt)}`}
          subtitle={durationLabel(draft.durationMin)}
          onPress={() => nav.navigate('create_activity_time')}
        />
        <ListRow icon="map-pin" title={`${draft.venueType} · ${draft.area}`} subtitle={draft.venueName || 'Exact spot shared after you accept people'} onPress={() => nav.navigate('create_activity_place')} />
        <ListRow
          icon="users"
          title={`Up to ${draft.capacity} people · ${draft.joinRule === 'approval' ? 'You approve' : 'Instant join'}`}
          subtitle={[draft.level && draft.level !== 'any' ? draft.level : 'Any level', draft.ageRange].filter(Boolean).join(' · ')}
          onPress={() => nav.navigate('create_activity_group')}
        />
        <ListRow icon="credit-card" title={draft.cost || 'Free'} subtitle={(draft.tags || []).join(' · ') || 'No tags'} onPress={() => nav.navigate('create_activity_details')} last={!draft.accessibility} />
        {!!draft.accessibility && <ListRow icon="info" title="Accessibility" subtitle={draft.accessibility} onPress={() => nav.navigate('create_activity_details')} last />}
      </ListGroup>

      <FieldLabel>Safety checklist</FieldLabel>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md, paddingVertical: space.xs }}>
        {CHECKS.map((c) => (
          <Check key={c.key} label={c.label} sub={c.sub} checked={!!checks[c.key]} onPress={() => setChecks((s) => ({ ...s, [c.key]: !s[c.key] }))} />
        ))}
      </View>

      <View style={{ flexDirection: 'row', marginTop: space.md, paddingHorizontal: layout.screenPadding / 4 }}>
        <Icon name="shield" size={14} color={colors.muted} style={{ marginTop: 2 }} />
        <AppText variant="caption" color={colors.muted} style={{ flex: 1, marginLeft: 6 }}>
          Plans are reviewed automatically for spam and unsafe locations. Hosting never costs money, and nobody can be paid to attend.
        </AppText>
      </View>
    </StepScaffold>
  );
}
