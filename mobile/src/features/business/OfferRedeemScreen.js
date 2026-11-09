// offer_redeem: show a perk code to venue staff.
// params { offerId, venueId, activityId? } → POST /offers/{offerId}/redeem
// params { redemptionId }                  → GET  /redemptions/{id}
// While the code is issued and this screen is focused it polls GET
// /redemptions/{id} every 4 s. Staff type the 6-character code in their
// business hub; when it flips to `redeemed`, Mo celebrates. No payments here.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Icon, Screen, ScreenHeader, Sheet, Skeleton } from '@/components';
import { colors, isDark, radius, space, type } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { perks as perksApi } from '@/api/endpoints';
import GuideCharacter from '@/features/guide/GuideCharacter';
import useRemote from '@/features/premium/useRemote';
import haptics from '@/utils/haptics';
import sfx from '@/services/sfx';
import { fetchVenue } from './businessShared';
import { countdownLabel, friendlyError, isMissing, msLeft, redeemErrorCopy, spacedCode } from './perks';
import QRCode from './components/QRCode';

const POLL_MS = 4000;
const QR_SIZE = 208;

const unwrap = (res) => res?.redemption || res || null;

function loadErrorCopy(e) {
  if (isMissing(e)) return { title: 'Code not found', body: 'This code is not available any more. You can get a new one from the venue page.' };
  return { title: 'Could not load your code', body: friendlyError(e, 'Something went wrong on our side. Try again in a moment.'), retry: true };
}

// Mo plus a short message and centred actions (errors, expired, cancelled, redeemed).
function Moment({ mood, hopKey, title, body, children }) {
  return (
    <Animated.View entering={enter(0)} style={{ alignItems: 'center', paddingTop: space.xl, paddingHorizontal: space.md }} accessibilityLiveRegion="polite">
      <GuideCharacter size={150} state={mood} hopKey={hopKey} decorative style={{ marginBottom: space.sm }} />
      <AppText variant="h1" align="center" accessibilityRole="header">
        {title}
      </AppText>
      {!!body && (
        <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 300 }}>
          {body}
        </AppText>
      )}
      <View style={{ marginTop: space.lg, alignSelf: 'stretch', alignItems: 'center', gap: space.xs }}>{children}</View>
    </Animated.View>
  );
}

export default function OfferRedeemScreen() {
  const nav = useNavigation();
  const { params = {} } = useRoute();
  const focused = useIsFocused();
  const [phase, setPhase] = useState('loading'); // loading | ready | error
  const [r, setR] = useState(null);
  const [error, setError] = useState(null); // { e, kind: 'issue' | 'load' }
  const [now, setNow] = useState(Date.now());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [hop, setHop] = useState(0);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  const offerId = r?.offer?.id || params.offerId || null;
  // The venue page gives us the offer's label and window for headers and error copy.
  const venueQ = useRemote(() => fetchVenue(params.venueId), [params.venueId], { enabled: !!params.venueId, refetchOnFocus: false });
  const offerCtx = r?.offer || venueQ.data?.perks?.find((p) => p.id === offerId) || null;

  const issue = useCallback(async () => {
    if (!offerId) return;
    setPhase('loading');
    setError(null);
    try {
      const red = unwrap(await perksApi.redeem(offerId, params.activityId ? { activityId: params.activityId } : {}));
      if (!red?.code) throw Object.assign(new Error('bad_response'), { code: 'bad_response' });
      if (!alive.current) return;
      setR(red);
      setNow(Date.now());
      setPhase('ready');
    } catch (e) {
      if (!alive.current) return;
      haptics.warning();
      setError({ e, kind: 'issue' });
      setPhase('error');
    }
  }, [offerId, params.activityId]);

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const red = unwrap(await perksApi.redemption(params.redemptionId));
      if (!red?.code) throw Object.assign(new Error('bad_response'), { code: 'bad_response' });
      if (!alive.current) return;
      setR(red);
      setNow(Date.now());
      setPhase('ready');
    } catch (e) {
      if (!alive.current) return;
      setError({ e, kind: 'load' });
      setPhase('error');
    }
  }, [params.redemptionId]);

  // First load: an existing code by id, else ask for one.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (params.redemptionId) load();
    else if (params.offerId) issue();
    else {
      setError({ e: { status: 404 }, kind: 'load' });
      setPhase('error');
    }
  }, [params.redemptionId, params.offerId, load, issue]);

  // Expired = issued with expiresAt in the past (the server may not have flipped it yet).
  const status = r?.status === 'issued' && r?.expiresAt && msLeft(r.expiresAt, now) <= 0 ? 'expired' : r?.status;
  const issued = phase === 'ready' && status === 'issued';

  // Poll while issued and on screen.
  useEffect(() => {
    if (!focused || !issued || !r?.id) return undefined;
    const id = r.id;
    const t = setInterval(async () => {
      try {
        const red = unwrap(await perksApi.redemption(id));
        if (alive.current && red?.id === id) setR((prev) => ({ ...prev, ...red }));
      } catch (e) {
        // keep polling quietly; the countdown still runs locally
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [focused, issued, r?.id]);

  // Countdown tick.
  useEffect(() => {
    if (!focused || !issued) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [focused, issued]);

  // Celebrate the moment staff confirm the code.
  const prevStatus = useRef(null);
  useEffect(() => {
    if (status === 'redeemed' && prevStatus.current && prevStatus.current !== 'redeemed') {
      sfx.play('chime');
      haptics.success();
      setHop((k) => k + 1);
    }
    prevStatus.current = status || null;
  }, [status]);

  // A confirm sheet left open makes no sense once the code is used or expired.
  useEffect(() => {
    if (!issued) setConfirmCancel(false);
  }, [issued]);

  const done = () => (nav.canGoBack() ? nav.goBack() : nav.navigate('my_perks'));

  const cancelCode = async () => {
    if (!r?.id) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const red = unwrap(await perksApi.cancelRedemption(r.id));
      if (!alive.current) return;
      setR((prev) => ({ ...prev, ...(red || {}), status: red?.status || 'cancelled' }));
      setConfirmCancel(false);
    } catch (e) {
      if (!alive.current) return;
      if (e?.code === 'not_cancellable') {
        // Already used or expired: show its real state instead.
        setConfirmCancel(false);
        try {
          const red = unwrap(await perksApi.redemption(r.id));
          if (alive.current && red?.id) setR((prev) => ({ ...prev, ...red }));
        } catch (err) {
          // the countdown still decides locally
        }
      } else {
        setCancelError(friendlyError(e, 'Could not cancel the code. Try again.'));
      }
    } finally {
      if (alive.current) setCancelling(false);
    }
  };

  const offer = r?.offer || offerCtx || {};
  const venue = r?.venue || (venueQ.data ? { id: venueQ.data.id, name: venueQ.data.name, area: venueQ.data.area } : null);
  const where = venue ? [venue.name, venue.area].filter(Boolean).join(' · ') : '';
  const newCodeButton = offerId ? <Button title="Get a new code" icon="refresh-cw" full={false} align="center" onPress={issue} /> : null;
  const doneButton = (primary) => <Button title="Done" variant={primary ? 'primary' : 'ghost'} full={false} align="center" onPress={done} />;

  let body;
  if (phase === 'loading') {
    body = (
      <View style={{ alignItems: 'center', marginTop: space.lg }} accessibilityLabel="Getting your code">
        <Skeleton width={180} height={26} />
        <Skeleton width={120} height={14} style={{ marginTop: space.xs }} />
        <Skeleton width={QR_SIZE + space.md * 2} height={QR_SIZE + 90} r={radius.card} style={{ marginTop: space.lg }} />
        <AppText variant="caption" color={colors.muted} style={{ marginTop: space.md }}>
          Getting your code
        </AppText>
      </View>
    );
  } else if (phase === 'error') {
    const copy = error?.kind === 'load' ? loadErrorCopy(error.e) : redeemErrorCopy(error?.e, offerCtx);
    const locked = error?.e?.code === 'offer_locked';
    body = (
      <Moment mood="think" title={copy.title} body={copy.body}>
        {copy.retry ? <Button title="Try again" icon="refresh-cw" full={false} align="center" onPress={error?.kind === 'load' ? load : issue} /> : null}
        {locked ? <Button title="See your perks" variant={copy.retry ? 'ghost' : 'primary'} full={false} align="center" onPress={() => nav.navigate('my_perks')} /> : null}
        {doneButton(!copy.retry && !locked)}
      </Moment>
    );
  } else if (status === 'redeemed') {
    body = (
      <Moment mood="happy" hopKey={hop} title="Enjoy!" body={[`${offer.label || 'Your perk'}${venue?.name ? ` at ${venue.name}` : ''}.`, r.groupSize > 1 ? `For your group of ${r.groupSize}.` : null, 'Have a great time.'].filter(Boolean).join(' ')}>
        {doneButton(true)}
      </Moment>
    );
  } else if (status === 'expired') {
    body = (
      <Moment mood="think" title="This code expired" body="Codes last 20 minutes. Get a new one when you are at the venue.">
        {newCodeButton}
        {doneButton(!newCodeButton)}
      </Moment>
    );
  } else if (status === 'cancelled') {
    body = (
      <Moment mood="idle" title="Code cancelled" body="No problem. You can get a new code while the perk is available.">
        {newCodeButton}
        {doneButton(!newCodeButton)}
      </Moment>
    );
  } else if (r) {
    const left = r.expiresAt ? msLeft(r.expiresAt, now) : null;
    const soon = left != null && left < 2 * 60000;
    body = (
      <Animated.View entering={enter(0)} style={{ alignItems: 'center' }}>
        <AppText variant="h2" align="center" style={{ marginTop: space.md }} numberOfLines={2}>
          {offer.label || 'Your perk'}
        </AppText>
        {!!where && (
          <AppText variant="label" color={colors.muted} align="center" style={{ marginTop: 2 }} numberOfLines={1}>
            {where}
          </AppText>
        )}

        {/* Always black on white so any scanner can read it. */}
        <View
          style={{
            marginTop: space.lg,
            backgroundColor: colors.pureWhite,
            borderRadius: radius.card,
            padding: space.md,
            alignItems: 'center',
            borderWidth: isDark() ? 0 : 1.2,
            borderColor: colors.border,
          }}
        >
          <QRCode value={r.qrPayload || `comeover:redeem:${r.code}`} size={QR_SIZE} accessibilityLabel="QR code for this perk" />
          <AppText
            maxScale={1.2}
            color={colors.pureBlack}
            align="center"
            accessibilityLabel={`Code ${spacedCode(r.code)}`}
            style={{ ...type.display, fontSize: 34, lineHeight: 42, letterSpacing: 8, paddingLeft: 8, marginTop: space.sm }}
          >
            {r.code}
          </AppText>
        </View>

        {left != null && (
          <View
            style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, height: 36, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: soon ? colors.orangeSoft : colors.surfaceSubtle }}
            accessible
            accessibilityLabel={`Expires in ${Math.max(1, Math.ceil(left / 60000))} minutes`}
          >
            <Icon name="clock" size={15} color={colors.ink} />
            <AppText variant="label" style={{ marginLeft: space.xs }}>
              Expires in {countdownLabel(left)}
            </AppText>
          </View>
        )}

        <AppText variant="bodyStrong" align="center" style={{ marginTop: space.lg }}>
          Show this to the staff before you pay
        </AppText>
        {offer.minGroup > 1 && (
          <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.xxs }}>
            For groups of {offer.minGroup}+
          </AppText>
        )}

        <Button title="Cancel code" variant="ghost" size="sm" full={false} align="center" style={{ marginTop: space.lg }} onPress={() => setConfirmCancel(true)} />
      </Animated.View>
    );
  }

  return (
    <Screen header={<ScreenHeader title={issued ? 'Your code' : 'Perk'} />}>
      {body}
      <Sheet
        visible={confirmCancel}
        onClose={() => !cancelling && setConfirmCancel(false)}
        title="Cancel this code?"
        footer={
          <View style={{ gap: space.xs }}>
            <Button title="Cancel code" variant="danger" loading={cancelling} onPress={cancelCode} />
            <Button title="Keep it" variant="ghost" disabled={cancelling} onPress={() => setConfirmCancel(false)} />
          </View>
        }
      >
        <AppText color={colors.inkSoft}>You can get a new one any time while the perk is available.</AppText>
        {!!cancelError && (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
            {cancelError}
          </AppText>
        )}
      </Sheet>
    </Screen>
  );
}
