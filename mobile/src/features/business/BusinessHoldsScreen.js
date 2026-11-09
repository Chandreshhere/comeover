// business_holds: table requests from hosts planning at your venue.
// GET  /business/table-holds?status=upcoming|requested|all → { items: TableHold[] }
// POST /business/table-holds/{id}/respond { decision, reason? } → TableHold
// No money changes hands: the venue just confirms or declines.
import React, { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AppText, Button, Card, EmptyState, ErrorState, Screen, ScreenHeader, Segmented, Sheet, Skeleton, Tag, TextField } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { business } from '@/api/endpoints';
import { relativeDay, timeLabel } from '@/utils/format';
import haptics from '@/utils/haptics';
import useRemote, { itemsOf } from '@/features/premium/useRemote';
import { friendlyError, isMissing, isOffline } from './perks';

const FILTERS = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'requested', label: 'To answer' },
  { value: 'all', label: 'All' },
];

// A function so the colours follow the live light/dark palette.
const holdStatus = (s) =>
  ({
    requested: { label: 'Waiting for you', bg: colors.orangeSoft },
    confirmed: { label: 'Confirmed', bg: colors.mint },
    declined: { label: 'Declined', bg: colors.pinkSoft },
    cancelled: { label: 'Cancelled', bg: colors.surfaceSubtle },
  }[s] || { label: 'Requested', bg: colors.surfaceSubtle });

const RESPOND_ERRORS = {
  hold_not_pending: 'This request was already answered or cancelled.',
  hold_not_found: 'This request is no longer open.',
};

function HoldCard({ hold: h, busy, onConfirm, onDecline }) {
  const st = holdStatus(h.status);
  const when = h.activity?.startsAt || h.startsAt;
  const title = h.activity?.title || 'Plan';
  const meta = [when ? `${relativeDay(when)} · ${timeLabel(when)}` : null, h.partySize ? `Party of ${h.partySize}` : null, h.host?.firstName ? `Host ${h.host.firstName}` : null].filter(Boolean).join(' · ');
  return (
    <Card elevated={false} style={{ borderWidth: 1.2, borderColor: colors.border }} accessibilityLabel={`${title}. ${meta}. ${st.label}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
          {title}
        </AppText>
        <Tag label={st.label} bg={st.bg} fg={colors.ink} style={{ marginLeft: space.xs, alignSelf: 'center' }} />
      </View>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xxs }}>
        {meta}
      </AppText>
      {!!h.note && (
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xs }}>
          “{h.note}”
        </AppText>
      )}
      {h.status === 'declined' && !!h.declineReason && (
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xs }}>
          Reason: {h.declineReason}
        </AppText>
      )}
      {h.status === 'requested' && (
        <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.md }}>
          <Button title="Decline" size="sm" variant="secondary" style={{ flex: 1 }} disabled={!!busy} onPress={onDecline} />
          <Button title="Confirm" size="sm" icon="check" style={{ flex: 1 }} loading={busy === 'confirm'} disabled={!!busy} onPress={onConfirm} />
        </View>
      )}
    </Card>
  );
}

export default function BusinessHoldsScreen() {
  const [filter, setFilter] = useState('upcoming');
  const [busy, setBusy] = useState({}); // holdId -> 'confirm' | 'decline'
  const [declining, setDeclining] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const q = useRemote(() => business.tableHolds({ status: filter }), [filter]);
  const items = itemsOf(q.data);

  const replace = (hold) => q.setData({ ...(q.data || {}), items: items.map((x) => (x.id === hold.id ? { ...x, ...hold } : x)) });

  const respond = async (h, decision, why) => {
    setBusy((b) => ({ ...b, [h.id]: decision }));
    setError(null);
    try {
      const res = await business.respondTableHold(h.id, { decision, ...(why ? { reason: why } : {}) });
      const updated = res?.hold || res;
      replace(updated?.id ? updated : { id: h.id, status: decision === 'confirm' ? 'confirmed' : 'declined', declineReason: why || null });
      haptics.success();
      setDeclining(null);
      setReason('');
    } catch (e) {
      haptics.warning();
      setError(friendlyError(e, 'Could not send your answer. Try again.', RESPOND_ERRORS));
      if (e?.code === 'hold_not_pending' || e?.code === 'hold_not_found') q.reload();
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[h.id];
        return next;
      });
    }
  };

  let body;
  if (!q.data && (q.status === 'loading' || q.status === 'idle')) {
    body = (
      <View style={{ gap: space.sm, marginTop: space.md }}>
        <Skeleton height={120} r={radius.card} />
        <Skeleton height={120} r={radius.card} />
      </View>
    );
  } else if (!q.data && q.status === 'error' && !isMissing(q.errorObj)) {
    body = <ErrorState kind={isOffline(q.errorObj) ? 'offline' : 'api'} onRetry={q.reload} />;
  } else if (!items.length) {
    body = (
      <EmptyState
        title={filter === 'requested' ? 'All answered' : 'No table requests'}
        body="When a host plans at your venue and asks you to hold a table, it shows up here."
      />
    );
  } else {
    body = (
      <View style={{ gap: space.sm, marginTop: space.md }}>
        {items.map((h, i) => (
          <Animated.View key={h.id} entering={enter(i)}>
            <HoldCard hold={h} busy={busy[h.id]} onConfirm={() => respond(h, 'confirm')} onDecline={() => setDeclining(h)} />
          </Animated.View>
        ))}
      </View>
    );
  }

  return (
    <Screen header={<ScreenHeader title="Table requests" />} refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.reload} tintColor={colors.ink} />}>
      <Segmented options={FILTERS} value={filter} onChange={setFilter} style={{ marginTop: space.xs }} />
      {!!error && !declining && (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      )}
      {body}

      <Sheet
        visible={!!declining}
        onClose={() => !busy[declining?.id] && setDeclining(null)}
        title="Decline this request?"
        footer={
          <View style={{ gap: space.xs }}>
            <Button title="Decline request" variant="danger" loading={busy[declining?.id] === 'decline'} onPress={() => respond(declining, 'decline', reason.trim())} />
            <Button title="Back" variant="ghost" disabled={!!busy[declining?.id]} onPress={() => setDeclining(null)} />
          </View>
        }
      >
        <AppText color={colors.inkSoft} style={{ marginBottom: space.md }}>
          The host gets a note that you couldn't hold a table. The plan still goes ahead.
        </AppText>
        <TextField label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="e.g. Fully booked that evening" maxLength={140} />
        {!!error && (
          <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </AppText>
        )}
      </Sheet>
    </Screen>
  );
}
