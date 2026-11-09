// business_campaign_create — sponsor a plan with audience, budget and duration
// (POST /business/campaigns). Paid placement is always labelled and never
// bypasses safety or relevance; reach is reported after delivery, never promised.
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ActivityCard,
  AppText,
  Button,
  Card,
  Chip,
  ChipGrid,
  EmptyState,
  Icon,
  IconBubble,
  ListGroup,
  ListRow,
  Mascot,
  OptionCard,
  QueryState,
  Screen,
  ScreenHeader,
  SectionHeader,
  Segmented,
  TextField,
} from '@/components';
import { colors, space } from '@/theme/tokens';
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

const FieldLabel = ({ children, style }) => (
  <AppText variant="label" color={colors.inkSoft} style={[{ marginBottom: space.xs }, style]}>
    {children}
  </AppText>
);

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
  const [interestsOpen, setInterestsOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState(3);
  const [budget, setBudget] = useState('2000');
  const [days, setDays] = useState(7);
  const [dailyCap, setDailyCap] = useState('');
  const [capOpen, setCapOpen] = useState(false);
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
  const showCap = capOpen || !!dailyCap;
  const interestLabels = interests.map((slug) => categories.find((c) => c.slug === slug)?.short).filter(Boolean);

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
      setSubmitError(errorMessage(e, "Couldn't submit the campaign. Nothing was charged. Try again."));
      setStatus('error');
    }
  };

  if (!venue) {
    return (
      <Screen header={<ScreenHeader title="New campaign" />}>
        <QueryState status={venueQ.status} error={venueQ.error} hasData={false} onRetry={venueQ.reload} skeletonRows={3} skeletonHeight={96} style={{ marginTop: space.xs }}>
          <EmptyState title="Verify your venue first" body="Campaigns are for verified partners." cta="Start verification" onCta={() => nav.navigate('business_onboarding')} />
        </QueryState>
      </Screen>
    );
  }

  if (venue.status && venue.status !== 'verified') {
    return (
      <Screen header={<ScreenHeader title="New campaign" />}>
        <EmptyState title="Almost there" body="Campaigns unlock once your venue is verified." cta="See verification status" onCta={() => nav.navigate('business_onboarding')} />
      </Screen>
    );
  }

  if (status === 'done') {
    return (
      <Screen header={<ScreenHeader title="" back={false} />} footer={<Button title="Open dashboard" onPress={() => nav.navigate('business_analytics', { venueId: venue.id })} />}>
        <Animated.View entering={fadeIn()} style={{ alignItems: 'center', marginTop: space.xl }}>
          <Mascot size={140} mood="celebrate" celebrateKey={1} />
          <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityRole="header" accessibilityLiveRegion="polite">
            Campaign submitted
          </AppText>
          <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 320 }}>
            {result?.status === 'active' ? 'Your sponsored plan is live.' : 'We review it first, usually within a day.'} Labelled “Sponsored”, capped at {rupees(capNum)} a day.
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
      <SectionHeader title="Plan to promote" style={{ marginTop: space.xs }} />
      {eligible.map((a) => {
        const on = activityId === a.id;
        return (
          <OptionCard
            key={a.id}
            title={a.title}
            subtitle={`${new Date(a.startsAt).toDateString().slice(0, 10)} · ${a.joinedCount ?? 0}/${a.capacity} joined`}
            selected={on}
            onPress={() => setActivityId(a.id)}
            left={<IconBubble size={40} tone="subtle" bg={on ? colors.white : undefined} pictogram={a.pictogram || 'sparkle'} iconSize={22} />}
          />
        );
      })}
      <Card
        onPress={() => nav.navigate('create_activity_type', { category: venue.categories?.[0], venueName: venue.name, area: venue.area })}
        elevated={false}
        r={20}
        style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.2, borderColor: colors.border, borderStyle: 'dashed' }}
        accessibilityLabel="Create a new plan at this venue"
      >
        <IconBubble size={40} tone="periwinkle" icon="plus" iconSize={20} />
        <View style={{ flex: 1, marginLeft: space.sm }}>
          <AppText variant="bodyStrong">Host a new plan here</AppText>
          {!eligible.length && (
            <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
              No upcoming plans at {venue.name} yet
            </AppText>
          )}
        </View>
        <Icon name="chevron-right" size={18} color={colors.muted} />
      </Card>

      {/* Audience */}
      <SectionHeader title="Audience" />
      <FieldLabel>Areas</FieldLabel>
      <ChipGrid columns={2}>
        {CITY.areas.map((a) => (
          <Chip key={a} label={a} fill selected={areas.includes(a)} onPress={() => toggle(areas, setAreas, a)} />
        ))}
      </ChipGrid>
      <FieldLabel style={{ marginTop: space.md }}>Radius around venue</FieldLabel>
      <Segmented options={RADII.map((r) => ({ value: r, label: `${r} km` }))} value={radiusKm} onChange={setRadiusKm} />
      <ListGroup style={{ marginTop: space.md }}>
        <ListRow
          icon="sliders"
          title="Interests (optional)"
          subtitle={interestLabels.length ? interestLabels.join(', ') : 'Anyone nearby'}
          onPress={() => setInterestsOpen((o) => !o)}
          right={<Icon name={interestsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />}
          last
        />
      </ListGroup>
      {interestsOpen && (
        <ChipGrid columns={2} style={{ marginTop: space.sm }}>
          {categories.map((c) => (
            <Chip key={c.slug} label={c.short} pictogram={c.pictogram} fill selected={interests.includes(c.slug)} onPress={() => toggle(interests, setInterests, c.slug)} />
          ))}
        </ChipGrid>
      )}
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
        Areas and interests only. Never precise location or sensitive traits.
      </AppText>

      {/* Budget */}
      <SectionHeader title="Budget" />
      <TextField label="Total budget (₹)" value={budget} onChangeText={(v) => setBudget(v.replace(/\D/g, ''))} keyboardType="number-pad" icon="credit-card" error={budgetError} helper={`Minimum ${rupees(MIN_BUDGET)} · GST extra`} />
      <FieldLabel>Duration</FieldLabel>
      <Segmented options={DURATIONS.map((d) => ({ value: d, label: `${d} days` }))} value={days} onChange={setDays} />
      <ListGroup style={{ marginTop: space.md }}>
        <ListRow
          icon="clock"
          title="Daily cap"
          subtitle={dailyCap ? `${rupees(capNum)} a day` : `${rupees(autoCap)} a day (auto)`}
          onPress={() => setCapOpen((o) => !o)}
          right={<Icon name={showCap ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />}
          last
        />
      </ListGroup>
      {showCap && (
        <TextField
          value={dailyCap}
          onChangeText={(v) => setDailyCap(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
          placeholder={`${autoCap} (auto)`}
          accessibilityLabel="Daily cap in rupees"
          error={capError}
          helper="Spend stops for the day at this amount"
          style={{ marginTop: space.sm }}
        />
      )}

      {/* Review */}
      <SectionHeader title="Review" />
      {selected ? (
        <View>
          <SponsoredLabel style={{ marginBottom: space.xs }} />
          <ActivityCard activity={{ ...selected, sponsored: true }} variant="row" style={{ borderWidth: 1.2, borderColor: colors.border }} />
        </View>
      ) : (
        <Card elevated={false} bg={colors.surfaceSubtle} style={{ alignItems: 'center' }}>
          <AppText color={colors.muted} align="center">
            Pick a plan to preview it
          </AppText>
        </Card>
      )}
      <ListGroup style={{ marginTop: space.md }}>
        <ListRow title="No guaranteed attendance" subtitle="Reach is never a promise of turnout" toggle={checks.noGuarantee} onToggle={(v) => setChecks((c) => ({ ...c, noGuarantee: v }))} />
        <ListRow title="Always labelled" subtitle="Shows “Sponsored” and a “Why am I seeing this?” link" toggle={checks.labelled} onToggle={(v) => setChecks((c) => ({ ...c, labelled: v }))} />
        <ListRow title="No shortcuts" subtitle="Never bypasses safety review, spam limits or relevance" toggle={checks.noBypass} onToggle={(v) => setChecks((c) => ({ ...c, noBypass: v }))} last />
      </ListGroup>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
        Invoiced with your Venue plan via Razorpay. No prepaid wallet balance.
      </AppText>
    </Screen>
  );
}
