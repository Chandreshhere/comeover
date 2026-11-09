// business_offers: the venue's perks: list with status and week / total
// redemptions, plus a create / edit form (pause, resume, end).
// GET /business/offers · POST /business/offers · PATCH /business/offers/{id}
// The venue funds every discount; members unlock perks by level and never
// spend XP or pay Come Over for them.
import React, { useEffect, useState } from 'react';
import { BackHandler, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Card, EmptyState, ErrorState, Icon, IconButton, Screen, ScreenHeader, SectionHeader, Sheet, Skeleton, Tag } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { business } from '@/api/endpoints';
import haptics from '@/utils/haptics';
import useRemote, { itemsOf } from '@/features/premium/useRemote';
import { formatCount } from './components/Charts';
import OfferForm from './components/OfferForm';
import { emptyOfferForm, formToOfferBody, friendlyError, isMissing, isOffline, MAX_OPEN_OFFERS, normaliseOffer, offerConditions, offerToForm, validateOffer } from './perks';

// A function so the colours follow the live light/dark palette.
const offerStatus = (s) =>
  ({
    active: { label: 'Active', bg: colors.mint },
    paused: { label: 'Paused', bg: colors.orangeSoft },
    ended: { label: 'Ended', bg: colors.surfaceSubtle },
  }[s] || { label: 'Active', bg: colors.mint });

const SAVE_ERRORS = {
  offer_limit: `You can run up to ${MAX_OPEN_OFFERS} offers. End one to add another.`,
  too_many_offers: `You can run up to ${MAX_OPEN_OFFERS} offers. End one to add another.`,
  no_venue: 'List your venue first, then add offers.',
  no_business: 'Set up your business profile first, then add offers.',
  offer_ended: 'This offer has ended. Create a new one instead.',
  validation_failed: 'Some details are not valid. Check them and try again.',
  route_not_found: 'Offers are not switched on yet. Try again later.',
  forbidden: 'Only staff of this venue can change its offers.',
};

function OfferRow({ offer: o, onPress }) {
  const st = offerStatus(o.status);
  const ended = o.status === 'ended';
  const stats = o.stats || {};
  const conditions = offerConditions(o);
  return (
    <Card
      onPress={ended ? undefined : onPress}
      elevated={false}
      style={{ borderWidth: 1.2, borderColor: colors.border, opacity: ended ? 0.7 : 1 }}
      accessibilityLabel={`${o.label}, ${st.label}. ${o.title}. ${stats.week ?? 0} this week, ${stats.total ?? 0} in total.${ended ? '' : ' Edit'}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {o.label}
          </AppText>
          {o.title !== o.label && (
            <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>
              {o.title}
            </AppText>
          )}
        </View>
        <Tag label={st.label} bg={st.bg} fg={colors.ink} style={{ marginLeft: space.xs, alignSelf: 'center' }} />
        {!ended && <Icon name="chevron-right" size={18} color={colors.muted} style={{ marginLeft: space.xs }} />}
      </View>
      {conditions.length > 0 && (
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xs }} numberOfLines={2}>
          {conditions.join(' · ')}
        </AppText>
      )}
      <View style={{ flexDirection: 'row', marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
        {[
          ['This week', stats.week ?? 0],
          ['Total', stats.total ?? 0],
        ].map(([k, v]) => (
          <View key={k} style={{ flex: 1, alignItems: 'center' }}>
            <AppText variant="bodyStrong">{formatCount(v)}</AppText>
            <AppText variant="caption" color={colors.muted}>
              {k}
            </AppText>
          </View>
        ))}
      </View>
    </Card>
  );
}

export default function BusinessOffersScreen() {
  const nav = useNavigation();
  const q = useRemote(() => business.offers(), []);
  const offers = itemsOf(q.data)
    .map((o) => {
      const n = normaliseOffer(o);
      return n ? { ...n, status: o.status || 'active', stats: o.stats || {} } : null;
    })
    .filter(Boolean);
  const openCount = offers.filter((o) => o.status !== 'ended').length;
  const atLimit = openCount >= MAX_OPEN_OFFERS;

  const [editing, setEditing] = useState(null); // null | { offer: Offer | null }
  const [form, setForm] = useState(emptyOfferForm);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [statusBusy, setStatusBusy] = useState(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const errors = validateOffer(form);
  const valid = Object.keys(errors).length === 0;

  const close = () => {
    setEditing(null);
    setSaveError(null);
    setShowErrors(false);
  };
  // Android back closes the form first.
  useEffect(() => {
    if (!editing) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [editing]);

  const openNew = () => {
    setForm(emptyOfferForm());
    setEditing({ offer: null });
  };
  const openEdit = (o) => {
    setForm(offerToForm(o));
    setEditing({ offer: o });
  };

  const save = async () => {
    if (!valid) {
      setShowErrors(true);
      haptics.warning();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const body = formToOfferBody(form);
      if (editing?.offer) await business.updateOffer(editing.offer.id, body);
      else await business.createOffer(body);
      haptics.success();
      close();
      q.reload();
    } catch (e) {
      haptics.warning();
      setSaveError(friendlyError(e, 'Could not save the offer. Check the details and try again.', SAVE_ERRORS));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status) => {
    const o = editing?.offer;
    if (!o) return;
    setStatusBusy(status);
    setSaveError(null);
    try {
      await business.updateOffer(o.id, { status });
      haptics.success();
      setConfirmEnd(false);
      if (status === 'ended') close();
      else setEditing({ offer: { ...o, status } });
      q.reload();
    } catch (e) {
      haptics.warning();
      setSaveError(friendlyError(e, 'Could not update the offer. Try again.', SAVE_ERRORS));
    } finally {
      setStatusBusy(null);
    }
  };

  // ---------- form ----------
  if (editing) {
    const o = editing.offer;
    return (
      <Screen
        keyboard
        header={<ScreenHeader title={o ? 'Edit offer' : 'New offer'} onBack={close} />}
        footer={
          <View>
            {!!(saveError || (showErrors && !valid)) && (
              <AppText variant="caption" color={colors.danger} align="center" style={{ marginBottom: space.xs }} accessibilityLiveRegion="polite">
                {saveError || 'Check the highlighted fields.'}
              </AppText>
            )}
            <Button title={o ? 'Save changes' : 'Create offer'} icon="check" loading={saving} disabled={!!statusBusy} onPress={save} />
          </View>
        }
      >
        <OfferForm form={form} onChange={setForm} errors={errors} showErrors={showErrors} />

        {o && (
          <>
            <SectionHeader title="Status" right={<Tag label={offerStatus(o.status).label} bg={offerStatus(o.status).bg} fg={colors.ink} />} />
            <View style={{ flexDirection: 'row', gap: space.xs }}>
              {o.status === 'paused' ? (
                <Button title="Resume" icon="play" variant="secondary" style={{ flex: 1 }} loading={statusBusy === 'active'} disabled={!!statusBusy || saving} onPress={() => setStatus('active')} />
              ) : (
                <Button title="Pause" icon="pause-circle" variant="secondary" style={{ flex: 1 }} loading={statusBusy === 'paused'} disabled={!!statusBusy || saving} onPress={() => setStatus('paused')} />
              )}
              <Button title="End offer" icon="x-circle" variant="secondary" style={{ flex: 1 }} disabled={!!statusBusy || saving} onPress={() => setConfirmEnd(true)} />
            </View>
            <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
              Paused offers are hidden from members until you resume them.
            </AppText>
          </>
        )}

        <Sheet
          visible={confirmEnd}
          onClose={() => !statusBusy && setConfirmEnd(false)}
          title="End this offer?"
          footer={
            <View style={{ gap: space.xs }}>
              <Button title="End offer" variant="danger" loading={statusBusy === 'ended'} onPress={() => setStatus('ended')} />
              <Button title="Keep it" variant="ghost" disabled={!!statusBusy} onPress={() => setConfirmEnd(false)} />
            </View>
          }
        >
          <AppText color={colors.inkSoft}>Members stop seeing it straight away. Codes already shown can still be confirmed until they expire.</AppText>
        </Sheet>
      </Screen>
    );
  }

  // ---------- list ----------
  let body;
  if (!q.data && (q.status === 'loading' || q.status === 'idle')) {
    body = (
      <View style={{ gap: space.sm, marginTop: space.md }}>
        <Skeleton height={130} r={radius.card} />
        <Skeleton height={130} r={radius.card} />
      </View>
    );
  } else if (!q.data && q.status === 'error') {
    if (q.errorObj?.code === 'no_venue' || q.errorObj?.code === 'no_business') {
      body = <EmptyState title="No venue yet" body="List and verify your venue to add perks." cta="List your venue" onCta={() => nav.navigate('business_onboarding')} />;
    } else if (isMissing(q.errorObj)) {
      body = <EmptyState title="Offers are almost here" body="Perks for your venue will switch on soon. Check back in a little while." />;
    } else {
      body = <ErrorState kind={isOffline(q.errorObj) ? 'offline' : 'api'} onRetry={q.reload} />;
    }
  } else if (!offers.length) {
    body = <EmptyState title="No offers yet" body="Add a perk to bring groups in. Members unlock it as they level up." cta="Create an offer" onCta={openNew} />;
  } else {
    body = (
      <View style={{ gap: space.sm, marginTop: space.md }}>
        {offers.map((o, i) => (
          <Animated.View key={o.id} entering={enter(i)}>
            <OfferRow offer={o} onPress={() => openEdit(o)} />
          </Animated.View>
        ))}
        {atLimit && (
          <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.xs }}>
            You are running {MAX_OPEN_OFFERS} offers, the most at once. End one to add another.
          </AppText>
        )}
      </View>
    );
  }

  const canAdd = !!q.data && !atLimit;
  return (
    <Screen
      header={<ScreenHeader title="Offers" right={canAdd ? <IconButton icon="plus" accessibilityLabel="New offer" onPress={openNew} /> : null} />}
      refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.reload} tintColor={colors.ink} />}
    >
      <AppText color={colors.muted} style={{ marginTop: space.xs }}>
        You fund the discount. Members unlock it as they level up and show the code when they pay.
      </AppText>
      {body}
    </Screen>
  );
}
