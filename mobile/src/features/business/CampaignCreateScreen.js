// business_campaign_create — sponsor a plan with audience, budget and duration
// (POST /business/campaigns). Paid placement is always labelled and never
// bypasses safety or relevance; reach is reported after delivery, never promised.
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActivityCard, AppText, Button, Card, Chip, EmptyState, Icon, ListGroup, ListRow, Mascot, OptionCard, Pictogram, QueryState, Screen, ScreenHeader, SectionHeader, Segmented, TextField } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { fadeIn } from '@/theme/motion';
import { business } from '@/api/endpoints';
import { CITY, categories } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import useRemote from '@/features/premium/useRemote';
import { rupees } from '@/features/premium/plans';
import { errorMessage, fetchMyVenue, fetchVenue, plansForVenue } from './businessShared';
import { SponsoredLabel } from './components/VenueCard';
import useBusinessStore from './useBusinessStore';

const MIN_BUDGET = 500;
const DURATIONS = [3, 7, 14];
const RADII = [1, 3, 5, 10];

export default function CampaignCreateScreen() {
  const nav = useNavigation();
  const { params = {} } = useRoute();
  const activities = useAppStore((s) => s.activities);
  const cachedVenue = useBusinessStore((s) => s.myVenue);
  const venueQ = useRemote(() => (params.venueId ? fetchVenue(params.venueId) : fetchMyVenue()), [params.venueId]);
  const venue = venueQ.data || (!params.venueId ? cachedVenue : null);

  const eligible = useMemo(() => plansForVenue(venue, activities), [venue, activities]);

  const [activityId, setActivityId] = useState(params.activityId || null);
  const [areas, setAreas] = useState([]);
  const [interests, setInterests] = useState([]);
  const [radiusKm, setRadiusKm] = useState(3);
  const [budget, setBudget] = useState('2000');
  const [days, setDays] = useState(7);
  const [dailyCap, setDailyCap] = useState('');
  const [checks, setChecks] = useState({ noGuarantee: false, labelled: false, noBypass: false });
  const [status, setStatus] = useState('idle'); // idle | submitting | done | error
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);

  // Default audience to the venue's own area and categories once it loads.
  useEffect(() => {
    if (!venue) return;
    setAreas((a) => (a.length ? a : venue.area ? [venue.area] : []));
    setInterests((i) => (i.length ? i : (venue.categories || []).slice(0, 2)));
  }, [venue]);

  const selected = eligible.find((a) => a.id === activityId) || null;
  const budgetNum = parseInt(budget || '0', 10) || 0;
  const autoCap = Math.ceil(budgetNum / days);
  const capNum = dailyCap ? parseInt(dailyCap, 10) || 0 : autoCap;
  const budgetError = budget && budgetNum < MIN_BUDGET ? `Minimum budget is ${rupees(MIN_BUDGET)}` : null;
  const capError = dailyCap && (capNum < 50 || capNum > budgetNum) ? 'Daily cap must be between ₹50 and your total budget' : null;
  const canSubmit = !!venue && !!selected && areas.length > 0 && !budgetError && budgetNum >= MIN_BUDGET && !capError && checks.noGuarantee && checks.labelled && checks.noBypass && status !== 'submitting';

  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = async () => {
    if (!canSubmit) return;
    setStatus('submitting');
    setSubmitError(null);
    const payload = {
      venueId: venue.id,
      activityId: selected.id,
      audience: { areas, interests, radiusKm },
      budgetMinor: budgetNum * 100,
      durationDays: days,
      dailyCapMinor: capNum * 100,
      label: 'Sponsored',
      acknowledgements: checks,
    };
    try {
      const res = await business.createCampaign(payload);
      setResult(res || null);
      setStatus('done');
    } catch (e) {
      setSubmitError(errorMessage(e, "Couldn't submit the campaign. Nothing was charged — try again."));
      setStatus('error');
    }
  };

  if (!venue) {
    return (
      <Screen header={<ScreenHeader title="New campaign" />}>
        <QueryState status={venueQ.status} error={venueQ.error} hasData={false} onRetry={venueQ.reload} skeletonRows={3} skeletonHeight={120}>
          <EmptyState title="Verify your venue first" body="Campaigns are available to verified Venue / Club partners." cta="Start verification" onCta={() => nav.navigate('business_onboarding')} />
        </QueryState>
      </Screen>
    );
  }

  if (venue.status && venue.status !== 'verified') {
    return (
      <Screen header={<ScreenHeader title="New campaign" />}>
        <EmptyState title="Almost there" body="Campaigns unlock once your venue is verified and the Venue plan is active." cta="See verification status" onCta={() => nav.navigate('business_onboarding')} />
      </Screen>
    );
  }

  if (status === 'done') {
    return (
      <Screen header={<ScreenHeader title="" back={false} />} footer={<Button title="Open dashboard" onPress={() => nav.navigate('business_analytics', { venueId: venue.id })} />}>
        <Animated.View entering={fadeIn()} style={{ alignItems: 'center', marginTop: space.xl }}>
          <View style={{ backgroundColor: colors.periwinkle, borderRadius: radius.hero, padding: space.lg, width: '100%', alignItems: 'center' }}>
            <Mascot size={160} mood="celebrate" celebrateKey={1} />
          </View>
          <AppText variant="h1" align="center" style={{ marginTop: space.lg }} accessibilityLiveRegion="polite">
            Campaign submitted
          </AppText>
          <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 310 }}>
            {result?.status === 'active'
              ? 'Your sponsored plan is live.'
              : 'We review sponsored plans before they run (usually within a day).'}{' '}
            It always shows a “Sponsored” label, and spend stops each day at your {rupees(capNum)} cap.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen
      keyboard
      header={<ScreenHeader title="New campaign" subtitle={venue.name} />}
      footer={
        <View>
          {submitError && (
            <AppText variant="caption" color={colors.danger} style={{ marginBottom: space.xs }} accessibilityLiveRegion="polite">
              {submitError}
            </AppText>
          )}
          <Button title={`Submit · ${rupees(budgetNum)} over ${days} days`} disabled={!canSubmit} loading={status === 'submitting'} onPress={submit} />
        </View>
      }
    >
      {/* What to promote */}
      <SectionHeader title="1. Plan to promote" style={{ marginTop: space.xs }} />
      {eligible.length ? (
        eligible.map((a) => (
          <OptionCard
            key={a.id}
            title={a.title}
            subtitle={`${new Date(a.startsAt).toDateString().slice(0, 10)} · ${a.joinedCount ?? 0}/${a.capacity} joined`}
            selected={activityId === a.id}
            onPress={() => setActivityId(a.id)}
            left={
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: activityId === a.id ? colors.white : colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
                <Pictogram name={a.pictogram || 'sparkle'} size={22} />
              </View>
            }
          />
        ))
      ) : (
        <AppText color={colors.muted}>No upcoming plans at {venue.name} yet.</AppText>
      )}
      <Button
        title="Create a new plan at this venue"
        icon="plus"
        variant="secondary"
        style={{ marginTop: space.xs }}
        onPress={() => nav.navigate('create_activity_type', { category: venue.categories?.[0], venueName: venue.name, area: venue.area })}
      />

      {/* Audience */}
      <SectionHeader title="2. Who should see it" />
      <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: 6 }}>
        Areas
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {CITY.areas.map((a) => (
          <Chip key={a} label={a} selected={areas.includes(a)} onPress={() => toggle(areas, setAreas, a)} />
        ))}
      </View>
      <AppText variant="label" color={colors.inkSoft} style={{ marginTop: space.md, marginBottom: 6 }}>
        Interests (optional)
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {categories.map((c) => (
          <Chip key={c.slug} label={c.short} pictogram={c.pictogram} selected={interests.includes(c.slug)} onPress={() => toggle(interests, setInterests, c.slug)} />
        ))}
      </View>
      <AppText variant="label" color={colors.inkSoft} style={{ marginTop: space.md, marginBottom: 6 }}>
        Radius around venue
      </AppText>
      <Segmented options={RADII.map((r) => ({ value: r, label: `${r} km` }))} value={radiusKm} onChange={setRadiusKm} />
      <AppText variant="caption" color={colors.muted} style={{ marginTop: 6 }}>
        Targeting uses coarse areas and stated interests only — never precise location, age or other sensitive traits.
      </AppText>

      {/* Budget */}
      <SectionHeader title="3. Budget & duration" />
      <TextField label="Total budget (₹)" value={budget} onChangeText={(v) => setBudget(v.replace(/\D/g, ''))} keyboardType="number-pad" icon="credit-card" error={budgetError} helper={`Minimum ${rupees(MIN_BUDGET)} · GST extra`} />
      <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: 6 }}>
        Duration
      </AppText>
      <Segmented options={DURATIONS.map((d) => ({ value: d, label: `${d} days` }))} value={days} onChange={setDays} />
      <TextField
        label="Daily cap (₹)"
        value={dailyCap}
        onChangeText={(v) => setDailyCap(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        placeholder={`${autoCap} (auto)`}
        error={capError}
        helper="Spend stops for the day once the cap is reached"
        style={{ marginTop: space.md }}
      />

      {/* Preview */}
      <SectionHeader title="Preview" />
      {selected ? (
        <View>
          <SponsoredLabel style={{ marginBottom: 6 }} />
          <AppText variant="caption" color={colors.muted} style={{ marginBottom: 6 }}>
            Members also see a “Why am I seeing this?” link explaining the paid placement.
          </AppText>
          <ActivityCard activity={{ ...selected, sponsored: true }} variant="row" style={{ borderWidth: 1.2, borderColor: colors.border }} />
        </View>
      ) : (
        <Card elevated={false} bg={colors.surfaceSubtle} style={{ alignItems: 'center' }}>
          <AppText color={colors.muted}>Pick a plan to preview the sponsored card</AppText>
        </Card>
      )}
      <Card elevated={false} bg={colors.periwinkleWash} style={{ marginTop: space.sm }}>
        <AppText variant="label">About reach</AppText>
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 4 }}>
          Delivered impressions, joins and check-ins appear in your dashboard once the campaign runs. Reach depends on activity nearby and is never a promise of views, joins or attendance.
        </AppText>
      </Card>

      {/* Compliance */}
      <SectionHeader title="4. Before you submit" />
      <ListGroup>
        <ListRow title="No guaranteed attendance" subtitle="I won't promise members or claim guaranteed turnout" toggle={checks.noGuarantee} onToggle={(v) => setChecks((c) => ({ ...c, noGuarantee: v }))} />
        <ListRow title="Always labelled" subtitle="The plan shows a “Sponsored” label and disclosure everywhere" toggle={checks.labelled} onToggle={(v) => setChecks((c) => ({ ...c, labelled: v }))} />
        <ListRow title="No shortcuts" subtitle="Boosts never bypass safety review, spam limits or relevance" toggle={checks.noBypass} onToggle={(v) => setChecks((c) => ({ ...c, noBypass: v }))} last />
      </ListGroup>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: space.md }}>
        <Icon name="file-text" size={14} color={colors.muted} style={{ marginTop: 2 }} />
        <AppText variant="caption" color={colors.muted} style={{ marginLeft: 6, flex: 1 }}>
          Campaigns are invoiced with your Venue plan through Razorpay. No prepaid wallet balance is held.
        </AppText>
      </View>
    </Screen>
  );
}
