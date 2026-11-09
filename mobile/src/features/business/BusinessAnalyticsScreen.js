// business_analytics — impressions, joins, check-ins and attributable actions.
// Data: GET /business/analytics?venueId&range → { venue, labels?, days?, series:{impressions,joins,checkIns,actions,planViews?},
//        totals?, previousTotals? } and GET /business/campaigns.
import React, { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Card, EmptyState, Icon, IconBubble, IconButton, ListGroup, ListRow, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader, Segmented, Sheet, Tag } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { business } from '@/api/endpoints';
import { weekdayShort, monthShort } from '@/utils/format';
import useRemote from '@/features/premium/useRemote';
import { rupees, shortDate } from '@/features/premium/plans';
import { fetchCampaigns, normaliseVenue } from './businessShared';
import { BarChart, Funnel, formatCount } from './components/Charts';

const RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];
const METRICS = [
  { value: 'impressions', label: 'Impressions' },
  { value: 'joins', label: 'Joins' },
  { value: 'checkIns', label: 'Check-ins' },
];
const HOW_WE_COUNT = [
  ['clock', 'Joins, check-ins and redemptions count within 7 days of a member seeing your plan.'],
  ['map-pin', 'Check-ins are optional for members, so real attendance can differ.'],
  ['shield', 'Attendance is never guaranteed, and figures never include personal details.'],
];

const sum = (a = []) => a.reduce((x, y) => x + (Number(y) || 0), 0);

// A function so the colours follow the live light/dark palette.
const campaignStatus = (s) => {
  const all = {
    active: { label: 'Active', bg: colors.mint },
    in_review: { label: 'In review', bg: colors.orangeSoft },
    scheduled: { label: 'Scheduled', bg: colors.periwinkleWash },
    paused: { label: 'Paused', bg: colors.surfaceSubtle },
    ended: { label: 'Ended', bg: colors.surfaceSubtle },
    rejected: { label: 'Not approved', bg: colors.pinkSoft },
  };
  return all[s] || all.in_review;
};

function labelsFor(data, n, range) {
  if (Array.isArray(data?.labels) && data.labels.length === n) return data.labels;
  const days = Array.isArray(data?.days) && data.days.length === n ? data.days.map((d) => new Date(d)) : null;
  return Array.from({ length: n }, (_, i) => {
    const d = days ? days[i] : new Date(Date.now() - (n - 1 - i) * 864e5);
    // 30-day ranges: show sparse date labels so the axis stays readable.
    if (range === '30d') return i % 7 === 0 || i === n - 1 ? `${d.getDate()} ${monthShort[d.getMonth()]}` : '';
    return weekdayShort[d.getDay()];
  });
}

// Plain stat tile: label, big number, change vs the previous period.
function Kpi({ label, value, prev, rangeLabel }) {
  const delta = prev ? Math.round(((value - prev) / prev) * 100) : null;
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}.${delta != null ? ` ${delta >= 0 ? 'Up' : 'Down'} ${Math.abs(delta)} percent versus the previous ${rangeLabel}.` : ''}`}
      style={{ flex: 1, minWidth: 0, backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md }}
    >
      <AppText variant="caption" color={colors.muted} numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="h1" style={{ marginTop: space.xxs }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {formatCount(value)}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xxs, minHeight: 14 }}>
        {delta != null ? (
          <>
            <Icon name={delta >= 0 ? 'trending-up' : 'trending-down'} size={13} color={delta >= 0 ? colors.success : colors.inkSoft} />
            <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} style={{ marginLeft: space.xxs, flex: 1 }}>
              {delta >= 0 ? '+' : ''}
              {delta}% vs prior
            </AppText>
          </>
        ) : null}
      </View>
    </View>
  );
}

export default function BusinessAnalyticsScreen() {
  const nav = useNavigation();
  const { params = {} } = useRoute();
  const [range, setRange] = useState('7d');
  const [metric, setMetric] = useState('impressions');
  const [howOpen, setHowOpen] = useState(false);

  const analyticsQ = useRemote(() => business.analytics({ venueId: params.venueId, range }), [params.venueId, range]);
  const campaignsQ = useRemote(fetchCampaigns, []);
  const data = analyticsQ.data;
  const venue = data?.venue ? normaliseVenue(data.venue) : null;
  const venueId = params.venueId || venue?.id;
  const noVenue = analyticsQ.status === 'error' && (analyticsQ.errorObj?.status === 404 || analyticsQ.errorObj?.code === 'no_venue');
  const rangeLabel = range === '30d' ? '30 days' : '7 days';
  const newCampaign = () => nav.navigate('business_campaign_create', { venueId });

  const series = useMemo(() => {
    const s = data?.series || {};
    return { impressions: s.impressions || [], joins: s.joins || [], checkIns: s.checkIns || [], actions: s.actions || [], planViews: s.planViews || null };
  }, [data]);
  const n = series.impressions.length;
  const labels = useMemo(() => labelsFor(data, n, range), [data, n, range]);
  const totals = useMemo(
    () => ({
      impressions: data?.totals?.impressions ?? sum(series.impressions),
      joins: data?.totals?.joins ?? sum(series.joins),
      checkIns: data?.totals?.checkIns ?? sum(series.checkIns),
      actions: data?.totals?.actions ?? sum(series.actions),
      planViews: data?.totals?.planViews ?? (series.planViews ? sum(series.planViews) : null),
    }),
    [data, series]
  );
  const prev = data?.previousTotals || {};
  const campaigns = campaignsQ.data || [];
  const hasSeries = n >= 2;

  if (noVenue) {
    return (
      <Screen header={<ScreenHeader title="Business dashboard" />}>
        <EmptyState title="No venue yet" body="Verify your venue to see results here." cta="List your venue" onCta={() => nav.navigate('business_onboarding')} />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={analyticsQ.refreshing || campaignsQ.refreshing}
          onRefresh={() => {
            analyticsQ.reload();
            campaignsQ.reload();
          }}
          tintColor={colors.ink}
        />
      }
      header={
        <ScreenHeader
          title="Business dashboard"
          subtitle={venue?.name || 'Your venue'}
          right={<IconButton icon="plus" accessibilityLabel="New campaign" onPress={newCampaign} />}
        />
      }
    >
      <Segmented options={RANGES} value={range} onChange={setRange} style={{ marginTop: space.xs }} />

      <QueryState status={analyticsQ.status} error={analyticsQ.error} hasData={!!data} onRetry={analyticsQ.reload} skeletonRows={3} skeletonHeight={120} style={{ marginTop: space.md }}>
        <>
          <Animated.View entering={enter(0)} style={{ gap: space.sm, marginTop: space.md }}>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Kpi label="Impressions" value={totals.impressions} prev={prev.impressions} rangeLabel={rangeLabel} />
              <Kpi label="Join requests" value={totals.joins} prev={prev.joins} rangeLabel={rangeLabel} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Kpi label="Check-ins" value={totals.checkIns} prev={prev.checkIns} rangeLabel={rangeLabel} />
              <Kpi label="Offer redemptions" value={totals.actions} prev={prev.actions} rangeLabel={rangeLabel} />
            </View>
          </Animated.View>

          <SectionHeader title="Daily trend" />
          {hasSeries ? (
            <Card elevated={false}>
              <Segmented compact options={METRICS} value={metric} onChange={setMetric} style={{ marginBottom: space.md }} />
              <BarChart data={series[metric]} labels={labels} />
              <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
                Total {formatCount(sum(series[metric]))} · today highlighted
              </AppText>
            </Card>
          ) : (
            <Card elevated={false} bg={colors.surfaceSubtle}>
              <AppText color={colors.muted}>Trends appear after a few days of activity.</AppText>
            </Card>
          )}

          {totals.impressions > 0 && (
            <>
              <SectionHeader title="Funnel" />
              <Card elevated={false}>
                <Funnel
                  steps={[
                    { label: 'Impressions', value: totals.impressions },
                    ...(totals.planViews != null ? [{ label: 'Plan views', value: totals.planViews }] : []),
                    { label: 'Join requests', value: totals.joins },
                    { label: 'Check-ins', value: totals.checkIns },
                  ]}
                />
                {totals.joins > 0 ? (
                  <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
                    {Math.round((totals.checkIns / totals.joins) * 100)}% of join requests checked in over {rangeLabel}.
                  </AppText>
                ) : null}
              </Card>
            </>
          )}
        </>
      </QueryState>

      <SectionHeader title="Campaigns" />
      <QueryState
        status={campaignsQ.status}
        error={campaignsQ.error}
        hasData={campaigns.length > 0}
        onRetry={campaignsQ.reload}
        skeletonRows={2}
        skeletonHeight={120}
        empty={{ title: 'No campaigns yet', body: 'Sponsor a plan to reach people nearby.', cta: 'New campaign', onCta: newCampaign }}
      >
        <View style={{ gap: space.sm }}>
          {campaigns.map((c) => {
            const st = campaignStatus(c.status);
            const stats = [
              ['Impr.', c.impressions],
              ['Joins', c.joins],
              ['Check-ins', c.checkIns],
              ['Offers', c.actions],
            ];
            return (
              <Card
                key={c.id}
                elevated={false}
                style={{ borderWidth: 1.2, borderColor: colors.border }}
                accessibilityLabel={`${c.title}, ${st.label}. ${rupees(c.spent)} of ${rupees(c.budget)} spent. ${stats.map(([k, v]) => `${k} ${v}`).join(', ')}`}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {c.title}
                  </AppText>
                  <Tag label={st.label} bg={st.bg} fg={colors.ink} style={{ marginLeft: space.xs }} />
                </View>
                <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xxs }} numberOfLines={1}>
                  {[`${rupees(c.spent)} of ${rupees(c.budget)}`, c.days ? `${c.days} days` : null, c.startedAt ? `from ${shortDate(c.startedAt)}` : null].filter(Boolean).join(' · ')}
                </AppText>
                <ProgressBar value={c.budget ? c.spent / c.budget : 0} height={6} style={{ marginTop: space.xs }} accessibilityLabel="Budget spent" />
                <View style={{ flexDirection: 'row', marginTop: space.sm }}>
                  {stats.map(([k, v]) => (
                    <View key={k} style={{ alignItems: 'center', flex: 1 }}>
                      <AppText variant="bodyStrong">{formatCount(v)}</AppText>
                      <AppText variant="caption" color={colors.muted}>
                        {k}
                      </AppText>
                    </View>
                  ))}
                </View>
              </Card>
            );
          })}
        </View>
      </QueryState>

      <ListGroup style={{ marginTop: space.xl }}>
        <ListRow icon="info" title="How we count" onPress={() => setHowOpen(true)} last />
      </ListGroup>

      <Sheet visible={howOpen} onClose={() => setHowOpen(false)} title="How we count">
        <View style={{ gap: space.md }}>
          {HOW_WE_COUNT.map(([icon, text]) => (
            <View key={icon} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <IconBubble size={40} tone="periwinkle" icon={icon} iconSize={20} />
              <AppText color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }}>
                {text}
              </AppText>
            </View>
          ))}
        </View>
        <Button title="Got it" style={{ marginTop: space.lg }} onPress={() => setHowOpen(false)} />
      </Sheet>
    </Screen>
  );
}
