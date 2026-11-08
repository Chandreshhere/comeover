// business_analytics — impressions, joins, check-ins and attributable actions.
// Data: GET /business/analytics?venueId&range → { venue, labels?, days?, series:{impressions,joins,checkIns,actions,planViews?},
//        totals?, previousTotals? } and GET /business/campaigns.
import React, { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Card, EmptyState, Icon, IconButton, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader, Segmented, Tag } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { business } from '@/api/endpoints';
import { weekdayShort, monthShort } from '@/utils/format';
import useRemote from '@/features/premium/useRemote';
import { rupees, shortDate } from '@/features/premium/plans';
import { fetchCampaigns, normaliseVenue } from './businessShared';
import { BarChart, Funnel, LineChart, formatCount } from './components/Charts';

const RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

const sum = (a = []) => a.reduce((x, y) => x + (Number(y) || 0), 0);

const STATUS = {
  active: { label: 'Active', bg: colors.mint },
  in_review: { label: 'In review', bg: colors.orangeSoft },
  scheduled: { label: 'Scheduled', bg: colors.periwinkleWash },
  paused: { label: 'Paused', bg: colors.surfaceSubtle },
  ended: { label: 'Ended', bg: colors.surfaceSubtle },
  rejected: { label: 'Not approved', bg: colors.pinkSoft },
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

function Kpi({ label, value, prev, bg, icon, rangeLabel }) {
  const delta = prev ? Math.round(((value - prev) / prev) * 100) : null;
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}.${delta != null ? ` ${delta >= 0 ? 'Up' : 'Down'} ${Math.abs(delta)} percent versus the previous ${rangeLabel}.` : ''}`}
      style={{ flexBasis: '48%', flexGrow: 1, backgroundColor: bg, borderRadius: radius.card, padding: space.md }}
    >
      <Icon name={icon} size={18} />
      <AppText variant="h1" style={{ marginTop: space.xs }}>
        {formatCount(value)}
      </AppText>
      <AppText variant="caption" color={colors.inkSoft}>
        {label}
      </AppText>
      {delta != null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <Icon name={delta >= 0 ? 'trending-up' : 'trending-down'} size={13} color={colors.inkSoft} />
          <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 4 }}>
            {delta >= 0 ? '+' : ''}
            {delta}% vs prior {rangeLabel}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

export default function BusinessAnalyticsScreen() {
  const nav = useNavigation();
  const { params = {} } = useRoute();
  const [range, setRange] = useState('7d');
  const [metric, setMetric] = useState('impressions');

  const analyticsQ = useRemote(() => business.analytics({ venueId: params.venueId, range }), [params.venueId, range]);
  const campaignsQ = useRemote(fetchCampaigns, []);
  const data = analyticsQ.data;
  const venue = data?.venue ? normaliseVenue(data.venue) : null;
  const venueId = params.venueId || venue?.id;
  const noVenue = analyticsQ.status === 'error' && (analyticsQ.errorObj?.status === 404 || analyticsQ.errorObj?.code === 'no_venue');
  const rangeLabel = range === '30d' ? '30 days' : '7 days';

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
        <EmptyState title="No venue yet" body="Verify your venue or club to see impressions, joins and check-ins here." cta="List your venue" onCta={() => nav.navigate('business_onboarding')} />
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
          subtitle={`${venue?.name || 'Your venue'} · last ${rangeLabel}`}
          right={<IconButton icon="plus" variant="ink" accessibilityLabel="New campaign" onPress={() => nav.navigate('business_campaign_create', { venueId })} />}
        />
      }
    >
      <Segmented options={RANGES} value={range} onChange={setRange} style={{ marginTop: space.xs }} />

      <QueryState status={analyticsQ.status} error={analyticsQ.error} hasData={!!data} onRetry={analyticsQ.reload} skeletonRows={3} skeletonHeight={150} style={{ marginTop: space.md }}>
        <>
          <Animated.View entering={enter(0)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md }}>
            <Kpi label="Impressions" value={totals.impressions} prev={prev.impressions} bg={colors.periwinkle} icon="eye" rangeLabel={rangeLabel} />
            <Kpi label="Join requests" value={totals.joins} prev={prev.joins} bg={colors.pink} icon="user-plus" rangeLabel={rangeLabel} />
            <Kpi label="Check-ins" value={totals.checkIns} prev={prev.checkIns} bg={colors.orange} icon="map-pin" rangeLabel={rangeLabel} />
            <Kpi label="Offer redemptions" value={totals.actions} prev={prev.actions} bg={colors.mint} icon="gift" rangeLabel={rangeLabel} />
          </Animated.View>

          {hasSeries ? (
            <>
              <SectionHeader title="Daily trend" />
              <Card>
                <Segmented
                  compact
                  options={[
                    { value: 'impressions', label: 'Impressions' },
                    { value: 'joins', label: 'Joins' },
                    { value: 'checkIns', label: 'Check-ins' },
                  ]}
                  value={metric}
                  onChange={setMetric}
                  style={{ marginBottom: space.md }}
                />
                <BarChart data={series[metric]} labels={labels} />
                <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
                  Today is shown in black. Total: {formatCount(sum(series[metric]))}
                </AppText>
              </Card>

              <SectionHeader title="Joins vs check-ins" />
              <Card>
                <LineChart
                  labels={labels}
                  series={[
                    { name: 'Join requests', data: series.joins, color: colors.deep },
                    { name: 'Check-ins', data: series.checkIns, color: colors.orange, dashed: true },
                  ]}
                />
                {totals.joins > 0 ? (
                  <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
                    {Math.round((totals.checkIns / totals.joins) * 100)}% of join requests checked in over the last {rangeLabel}.
                  </AppText>
                ) : null}
              </Card>
            </>
          ) : (
            <Card elevated={false} bg={colors.surfaceSubtle} style={{ marginTop: space.lg }}>
              <AppText color={colors.muted}>Daily trends appear once your venue has a few days of activity.</AppText>
            </Card>
          )}

          {totals.impressions > 0 && (
            <>
              <SectionHeader title="Funnel" />
              <Card>
                <Funnel
                  steps={[
                    { label: 'Impressions', value: totals.impressions },
                    ...(totals.planViews != null ? [{ label: 'Plan views', value: totals.planViews }] : []),
                    { label: 'Join requests', value: totals.joins },
                    { label: 'Check-ins', value: totals.checkIns },
                  ]}
                />
              </Card>
            </>
          )}
        </>
      </QueryState>

      <SectionHeader title="Campaigns" action="New" onAction={() => nav.navigate('business_campaign_create', { venueId })} />
      <QueryState
        status={campaignsQ.status}
        error={campaignsQ.error}
        hasData={campaigns.length > 0}
        onRetry={campaignsQ.reload}
        skeletonRows={2}
        skeletonHeight={130}
        empty={{ title: 'No campaigns yet', body: 'Sponsor one of your plans to reach people nearby — always labelled.', cta: 'New campaign', onCta: () => nav.navigate('business_campaign_create', { venueId }) }}
      >
        <View style={{ gap: space.sm }}>
          {campaigns.map((c) => {
            const st = STATUS[c.status] || STATUS.in_review;
            return (
              <Card key={c.id} elevated={false} style={{ borderWidth: 1.2, borderColor: colors.border }} accessibilityLabel={`${c.title}, ${st.label}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {c.title}
                  </AppText>
                  <Tag label={st.label} bg={st.bg} />
                </View>
                <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
                  {[c.startedAt ? `Started ${shortDate(c.startedAt)}` : null, c.days ? `${c.days} days` : null, `${rupees(c.spent)} of ${rupees(c.budget)} spent`].filter(Boolean).join(' · ')}
                </AppText>
                <ProgressBar value={c.budget ? c.spent / c.budget : 0} style={{ marginTop: space.xs }} accessibilityLabel="Budget spent" />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm }}>
                  {[
                    ['Impr.', c.impressions],
                    ['Joins', c.joins],
                    ['Check-ins', c.checkIns],
                    ['Offers', c.actions],
                  ].map(([k, v]) => (
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

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface, borderRadius: radius.quest, padding: space.md, marginTop: space.xl }}>
        <Icon name="info" size={16} color={colors.inkSoft} style={{ marginTop: 2 }} />
        <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 8, flex: 1 }}>
          Joins, check-ins and redemptions are counted when they happen within 7 days of a member seeing your plan. Check-ins are optional for members, so real attendance can differ. We never guarantee attendance, and figures never include members' personal details.
        </AppText>
      </View>
    </Screen>
  );
}
