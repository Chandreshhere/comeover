// business_onboarding — venue / club verification (POST /business/venues) and
// Venue plan activation (Razorpay order → checkout; activated by the signed
// webhook server-side). Proof of business uploads privately to S3.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';
import { AppText, Button, Card, Chip, Icon, IconButton, ListGroup, ListRow, Mascot, OptionCard, Pictogram, ProgressBar, QueryState, Screen, ScreenHeader, Skeleton, Tag, TextField } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { fadeIn } from '@/theme/motion';
import { business } from '@/api/endpoints';
import { CITY } from '@/data/catalog';
import { uploadAsset } from '@/services/upload';
import { payForBusinessPlan } from '@/services/razorpay';
import useRemote from '@/features/premium/useRemote';
import { rupees, shortDate, usePlans } from '@/features/premium/plans';
import { errorMessage, fetchMyVenue, normaliseVenue } from './businessShared';
import useBusinessStore from './useBusinessStore';

const STEPS = ['Business', 'Location', 'Verify', 'Team', 'Plan'];
const TYPES = [
  { id: 'cafe', label: 'Café or restaurant', pictogram: 'chai' },
  { id: 'sport', label: 'Sports venue or court', pictogram: 'badminton' },
  { id: 'fitness', label: 'Gym or studio', pictogram: 'gym' },
  { id: 'games', label: 'Games or entertainment', pictogram: 'board' },
  { id: 'club', label: 'Club or community group', pictogram: 'people' },
];
const ROLES = [
  { id: 'manager', label: 'Manager', sub: 'Edit profile, offers and campaigns' },
  { id: 'staff', label: 'Staff', sub: 'Verify offers at the counter' },
  { id: 'analyst', label: 'Analyst', sub: 'View reports only' },
];
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_COPY = {
  in_review: { label: 'In review', bg: colors.orangeSoft, title: 'Submitted for review' },
  verified: { label: 'Verified', bg: colors.mint, title: 'is verified' },
  rejected: { label: 'Not approved', bg: colors.pinkSoft, title: 'needs changes' },
  suspended: { label: 'Suspended', bg: colors.pinkSoft, title: 'is paused' },
};

function VenueStatus({ venue, venuePlan, planPrice, onEdit, onReload, refreshing }) {
  const nav = useNavigation();
  const paymentSubmittedAt = useBusinessStore((s) => s.paymentSubmittedAt);
  const markPaymentSubmitted = useBusinessStore((s) => s.markPaymentSubmitted);
  const clearPayment = useBusinessStore((s) => s.clearPayment);
  const [paying, setPaying] = useState(false);
  const [payNotice, setPayNotice] = useState(null);

  const status = venue.status || 'in_review';
  const copy = STATUS_COPY[status] || STATUS_COPY.in_review;
  const planActive = venue.planStatus === 'active';
  const awaitingActivation = !planActive && (venue.planStatus === 'payment_processing' || !!paymentSubmittedAt);

  useEffect(() => {
    if (planActive && paymentSubmittedAt) clearPayment();
  }, [planActive, paymentSubmittedAt, clearPayment]);

  const pay = async () => {
    setPaying(true);
    setPayNotice(null);
    try {
      const res = await payForBusinessPlan({
        planId: venuePlan?.planId || venuePlan?.id || 'venue',
        venueId: venue.id,
        contact: venue.contact?.phone ? `+91${venue.contact.phone}` : undefined,
        email: venue.contact?.email || undefined,
        name: venue.contact?.name || venue.name,
      });
      if (res.status === 'submitted') {
        markPaymentSubmitted();
        onReload();
      } else if (res.status === 'cancelled') {
        setPayNotice({ ok: false, text: 'Payment cancelled — nothing was charged.' });
      } else {
        setPayNotice({ ok: false, text: `Payment didn't go through: ${res.error || 'please try again.'}` });
      }
    } catch (e) {
      setPayNotice({ ok: false, text: errorMessage(e, 'Couldn’t start the payment. Try again.') });
    } finally {
      setPaying(false);
    }
  };

  return (
    <Screen
      header={<ScreenHeader title="Venue verification" />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onReload} tintColor={colors.ink} />}
      footer={
        planActive ? (
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            <Button title="Dashboard" variant="secondary" style={{ flex: 1 }} onPress={() => nav.navigate('business_analytics', { venueId: venue.id })} />
            <Button title="New campaign" style={{ flex: 1 }} onPress={() => nav.navigate('business_campaign_create', { venueId: venue.id })} />
          </View>
        ) : status === 'verified' && !awaitingActivation ? (
          <Button title={planPrice ? `Pay ${planPrice} & activate` : 'Activate Venue plan'} icon="credit-card" loading={paying} disabled={paying} onPress={pay} />
        ) : (
          <Button title="Explore partner places" onPress={() => nav.navigate('business_discovery')} />
        )
      }
    >
      <Animated.View entering={fadeIn()} style={{ alignItems: 'center', marginTop: space.lg }}>
        <View style={{ backgroundColor: colors.periwinkle, borderRadius: radius.hero, padding: space.lg, width: '100%', alignItems: 'center' }}>
          <Mascot size={150} pose="wave" />
        </View>
        <AppText variant="h1" align="center" style={{ marginTop: space.lg }} accessibilityRole="header">
          {status === 'in_review' ? copy.title : `${venue.name} ${copy.title}`}
        </AppText>
        <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 310 }}>
          {status === 'in_review'
            ? `We check every venue before it appears in the app. Reviews usually take 2–3 working days; we'll message ${venue.contact?.phone ? `+91 ${venue.contact.phone}` : 'you'} with the outcome.`
            : status === 'verified'
            ? planActive
              ? 'Your Venue plan is active. Create labelled campaigns and track results from your dashboard.'
              : 'You’re verified. Activate the Venue plan to unlock sponsored slots, offers and analytics.'
            : venue.reviewNote || 'Please update your details and resubmit.'}
        </AppText>
      </Animated.View>

      {awaitingActivation && (
        <Card bg={colors.orangeSoft} elevated={false} style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center' }} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.ink} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong">Payment received — activation pending</AppText>
            <AppText variant="caption" color={colors.inkSoft}>
              We activate your plan as soon as the payment gateway confirms it. Pull to refresh to check.
            </AppText>
          </View>
        </Card>
      )}
      {payNotice && (
        <AppText variant="caption" color={payNotice.ok ? colors.success : colors.danger} style={{ marginTop: space.md }} accessibilityLiveRegion="polite">
          {payNotice.text}
        </AppText>
      )}

      <ListGroup style={{ marginTop: space.lg }}>
        <ListRow icon="briefcase" title={venue.name} subtitle={[TYPES.find((t) => t.id === venue.type)?.label || venue.kind, venue.area].filter(Boolean).join(' · ')} />
        {!!venue.submittedAt && <ListRow icon="calendar" title="Submitted" subtitle={shortDate(venue.submittedAt)} />}
        <ListRow icon="activity" title="Status" right={<Tag label={copy.label} bg={copy.bg} />} />
        <ListRow
          icon="credit-card"
          title="Venue plan"
          right={<Tag label={planActive ? 'Active' : awaitingActivation ? 'Activating' : status === 'verified' ? 'Not active' : 'After verification'} bg={planActive ? colors.mint : colors.surfaceSubtle} />}
          last
        />
      </ListGroup>

      {status === 'verified' && !planActive && venuePlan && (
        <Card bg={colors.ink} style={{ marginTop: space.md }}>
          <AppText variant="caption" color="rgba(255,255,255,0.7)">
            {venuePlan.name} plan
          </AppText>
          <AppText variant="h1" color={colors.white}>
            {planPrice} <AppText color="rgba(255,255,255,0.7)">/ month + GST</AppText>
          </AppText>
          <AppText variant="caption" color="rgba(255,255,255,0.7)" style={{ marginTop: space.xs }}>
            Paid through Razorpay by UPI, card or net banking. Project IRL never holds a balance or wallet for your venue.
          </AppText>
        </Card>
      )}

      {(status === 'rejected' || status === 'in_review') && <Button title="Edit and resubmit" variant="ghost" style={{ marginTop: space.md }} onPress={onEdit} />}
    </Screen>
  );
}

export default function BusinessOnboardingScreen() {
  const nav = useNavigation();
  const setMyVenue = useBusinessStore((s) => s.setMyVenue);
  const myVenueQ = useRemote(fetchMyVenue, []);
  const plans = usePlans();
  const venuePlan = plans.venue;
  const planPrice = venuePlan ? rupees(venuePlan.priceMonthly) : null;

  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [f, setF] = useState({
    name: '',
    type: null,
    gstin: '',
    about: '',
    address: '',
    area: null,
    proof: null, // { uri, name, key }
    contactName: '',
    phone: '',
    email: '',
    staff: [],
    staffName: '',
    staffPhone: '',
    staffRole: 'staff',
    agreeLabels: false,
    agreeNoGuarantee: false,
    agreeTerms: false,
  });
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  const myVenue = myVenueQ.data;
  useEffect(() => {
    if (myVenueQ.status === 'ready') setMyVenue(myVenue || null);
  }, [myVenueQ.status, myVenue, setMyVenue]);

  // Prefill the form from an existing application when editing.
  const startEditing = () => {
    if (myVenue) {
      set({
        name: myVenue.name || '',
        type: myVenue.type || null,
        gstin: myVenue.gstin || '',
        about: myVenue.about || '',
        address: myVenue.publicAddress || myVenue.publicLocation || '',
        area: myVenue.area || null,
        contactName: myVenue.contact?.name || '',
        phone: myVenue.contact?.phone || '',
        email: myVenue.contact?.email || '',
      });
    }
    setStep(0);
    setEditing(true);
  };

  const gstinError = f.gstin && !GSTIN_RE.test(f.gstin.trim().toUpperCase()) ? 'GSTIN looks incorrect (15 characters, e.g. 24ABCDE1234F1Z5)' : null;
  const phoneError = f.phone && !PHONE_RE.test(f.phone) ? 'Enter a 10-digit Indian mobile number' : null;
  const emailError = f.email && !EMAIL_RE.test(f.email) ? 'Enter a valid email' : null;

  const valid = [
    f.name.trim().length >= 2 && !!f.type && !gstinError,
    f.address.trim().length >= 5 && !!f.area,
    !!f.proof?.key && !uploading && f.contactName.trim().length >= 2 && PHONE_RE.test(f.phone) && (!f.email || !emailError),
    true,
    f.agreeLabels && f.agreeNoGuarantee && f.agreeTerms,
  ];

  const uploadProof = async (asset) => {
    setUploading(true);
    setUploadError(null);
    set({ proof: { uri: asset.uri, name: asset.fileName || 'proof.jpg', key: null, asset } });
    try {
      const { key } = await uploadAsset(asset, 'venue_proof');
      setF((x) => ({ ...x, proof: x.proof ? { ...x.proof, key } : x.proof }));
    } catch (e) {
      setUploadError(e?.code === 'file_too_large' ? 'That file is too large (max 10 MB).' : errorMessage(e, 'Upload failed. Try again.'));
    } finally {
      setUploading(false);
    }
  };

  const pickProof = async () => {
    try {
      const res = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1, quality: 0.7 });
      if (res?.didCancel || res?.errorCode) return;
      const asset = res?.assets?.[0];
      if (asset) uploadProof(asset);
    } catch (e) {
      setUploadError('Couldn’t open your photos. Try again.');
    }
  };

  const addStaff = () => {
    if (f.staffName.trim().length < 2 || !PHONE_RE.test(f.staffPhone)) return;
    set({ staff: [...f.staff, { id: `${Date.now()}`, name: f.staffName.trim(), phone: f.staffPhone, role: f.staffRole }], staffName: '', staffPhone: '' });
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    const payload = {
      name: f.name.trim(),
      type: f.type,
      gstin: f.gstin.trim().toUpperCase() || null,
      about: f.about.trim(),
      publicAddress: f.address.trim(),
      area: f.area,
      proofKey: f.proof?.key,
      contact: { name: f.contactName.trim(), phone: f.phone, email: f.email || null },
      staff: f.staff.map(({ name, phone, role }) => ({ name, phone, role })),
      planId: venuePlan?.planId || venuePlan?.id || null,
      agreements: { sponsoredLabels: f.agreeLabels, noAttendanceGuarantee: f.agreeNoGuarantee, partnerTerms: f.agreeTerms },
    };
    try {
      const res = await business.onboard(payload);
      const v = normaliseVenue({ status: 'in_review', submittedAt: new Date().toISOString(), ...payload, ...(res?.venue || res || {}) });
      myVenueQ.setData(v);
      setMyVenue(v);
      setEditing(false);
    } catch (e) {
      setSubmitError(errorMessage(e, "We couldn't submit right now. Your answers are kept — try again."));
    } finally {
      setSubmitting(false);
    }
  };

  // Loading the owner's existing application.
  if (!myVenue && myVenueQ.status !== 'ready' && !editing) {
    return (
      <Screen header={<ScreenHeader title="List your venue" />}>
        <QueryState status={myVenueQ.status} error={myVenueQ.error} hasData={false} onRetry={myVenueQ.reload} skeletonRows={3} skeletonHeight={120} style={{ marginTop: space.md }}>
          <View />
        </QueryState>
        {myVenueQ.status === 'error' ? <Button title="Start a new application" variant="ghost" onPress={() => setEditing(true)} /> : null}
      </Screen>
    );
  }

  if (myVenue && !editing) {
    return <VenueStatus venue={myVenue} venuePlan={venuePlan} planPrice={planPrice} onEdit={startEditing} onReload={myVenueQ.reload} refreshing={myVenueQ.refreshing} />;
  }

  const footer = (
    <View>
      {submitError && (
        <AppText variant="caption" color={colors.danger} style={{ marginBottom: space.xs }} accessibilityLiveRegion="polite">
          {submitError}
        </AppText>
      )}
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        {step > 0 && <Button title="Back" variant="secondary" full={false} onPress={() => setStep((s) => s - 1)} />}
        <Button
          title={step === STEPS.length - 1 ? 'Submit for verification' : 'Continue'}
          style={{ flex: 1 }}
          disabled={!valid[step] || submitting}
          loading={submitting}
          onPress={() => (step === STEPS.length - 1 ? submit() : setStep((s) => s + 1))}
        />
      </View>
    </View>
  );

  return (
    <Screen keyboard header={<ScreenHeader title="List your venue" subtitle={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`} onBack={step > 0 ? () => setStep((s) => s - 1) : undefined} />} footer={footer}>
      <ProgressBar value={(step + 1) / STEPS.length} style={{ marginTop: space.xs, marginBottom: space.lg }} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`} />

      {step === 0 && (
        <Animated.View entering={fadeIn()} key="s0">
          <AppText variant="h2" style={{ marginBottom: space.md }} accessibilityRole="header">
            Tell us about your place
          </AppText>
          <TextField label="Business or club name" value={f.name} onChangeText={(v) => set({ name: v })} placeholder="e.g. Sunrise Badminton Club" maxLength={60} />
          <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: 6 }}>
            Type
          </AppText>
          {TYPES.map((t) => (
            <OptionCard
              key={t.id}
              title={t.label}
              selected={f.type === t.id}
              onPress={() => set({ type: t.id })}
              left={
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: f.type === t.id ? colors.white : colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
                  <Pictogram name={t.pictogram} size={22} />
                </View>
              }
            />
          ))}
          <TextField
            label="GSTIN (optional)"
            value={f.gstin}
            onChangeText={(v) => set({ gstin: v.toUpperCase() })}
            placeholder="24ABCDE1234F1Z5"
            autoCapitalize="characters"
            maxLength={15}
            error={gstinError}
            helper="Needed for GST invoices on the Venue plan"
            style={{ marginTop: space.md }}
          />
          <TextField label="Short description" value={f.about} onChangeText={(v) => set({ about: v })} placeholder="What makes your place great for groups?" multiline maxLength={240} />
        </Animated.View>
      )}

      {step === 1 && (
        <Animated.View entering={fadeIn()} key="s1">
          <AppText variant="h2" accessibilityRole="header">
            Where are you?
          </AppText>
          <AppText color={colors.muted} style={{ marginTop: 4, marginBottom: space.md }}>
            Only your public venue address is shown to members. Plans held here use it as the meeting point.
          </AppText>
          <TextField label="Public address" value={f.address} onChangeText={(v) => set({ address: v })} placeholder="Building, street, landmark" multiline maxLength={160} icon="map-pin" />
          <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: 6 }}>
            Area{CITY.name ? ` in ${CITY.name}` : ''}
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {CITY.areas.map((a) => (
              <Chip key={a} label={a} selected={f.area === a} onPress={() => set({ area: a })} />
            ))}
          </View>
        </Animated.View>
      )}

      {step === 2 && (
        <Animated.View entering={fadeIn()} key="s2">
          <AppText variant="h2" accessibilityRole="header">
            Verify your business
          </AppText>
          <AppText color={colors.muted} style={{ marginTop: 4, marginBottom: space.md }}>
            Upload one proof: shop & establishment licence, GST certificate, utility bill or club registration. It's stored privately and only our review team sees it.
          </AppText>
          <Card
            onPress={uploading ? undefined : pickProof}
            elevated={false}
            style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: f.proof?.key ? colors.success : uploadError ? colors.danger : colors.border, alignItems: 'center', paddingVertical: space.lg }}
            accessibilityLabel={f.proof ? `Proof ${f.proof.key ? 'uploaded' : uploading ? 'uploading' : 'not uploaded'}: ${f.proof.name}. Tap to change.` : 'Upload proof of business'}
          >
            {f.proof ? (
              <>
                <View>
                  <Image source={{ uri: f.proof.uri }} style={{ width: 96, height: 96, borderRadius: 16, opacity: uploading ? 0.5 : 1 }} accessibilityIgnoresInvertColors />
                  {uploading ? (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                      <ActivityIndicator color={colors.ink} />
                    </View>
                  ) : null}
                </View>
                <AppText variant="label" style={{ marginTop: space.xs }} numberOfLines={1}>
                  {f.proof.name}
                </AppText>
                <AppText variant="caption" color={f.proof.key ? colors.success : colors.deep}>
                  {uploading ? 'Uploading privately…' : f.proof.key ? 'Uploaded · tap to change' : 'Tap to try again'}
                </AppText>
              </>
            ) : (
              <>
                <Icon name="upload" size={26} />
                <AppText variant="bodyStrong" style={{ marginTop: space.xs }}>
                  Upload proof
                </AppText>
                <AppText variant="caption" color={colors.muted}>
                  Photo or scan · JPG/PNG · max 10 MB
                </AppText>
              </>
            )}
          </Card>
          {uploadError ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
              <AppText variant="caption" color={colors.danger} style={{ flex: 1 }} accessibilityLiveRegion="polite">
                {uploadError}
              </AppText>
              {f.proof?.asset ? <Button title="Retry" size="xs" variant="secondary" full={false} onPress={() => uploadProof(f.proof.asset)} /> : null}
            </View>
          ) : null}
          <TextField label="Contact person" value={f.contactName} onChangeText={(v) => set({ contactName: v })} placeholder="Full name" style={{ marginTop: space.lg }} />
          <TextField label="Mobile" value={f.phone} onChangeText={(v) => set({ phone: v.replace(/\D/g, '') })} placeholder="98XXXXXXXX" keyboardType="phone-pad" maxLength={10} error={phoneError} icon="phone" />
          <TextField label="Email (optional)" value={f.email} onChangeText={(v) => set({ email: v.trim() })} placeholder="owner@yourplace.in" keyboardType="email-address" autoCapitalize="none" error={emailError} icon="mail" />
        </Animated.View>
      )}

      {step === 3 && (
        <Animated.View entering={fadeIn()} key="s3">
          <AppText variant="h2" accessibilityRole="header">
            Add your team
          </AppText>
          <AppText color={colors.muted} style={{ marginTop: 4, marginBottom: space.md }}>
            Optional. You'll be the owner. Staff roles let others help without sharing your login.
          </AppText>
          {f.staff.length > 0 && (
            <ListGroup style={{ marginBottom: space.md }}>
              {f.staff.map((m, i) => (
                <ListRow
                  key={m.id}
                  icon="user"
                  title={m.name}
                  subtitle={`${ROLES.find((r) => r.id === m.role)?.label} · +91 ${m.phone}`}
                  last={i === f.staff.length - 1}
                  right={<IconButton icon="x" size={36} variant="plain" accessibilityLabel={`Remove ${m.name}`} onPress={() => set({ staff: f.staff.filter((x) => x.id !== m.id) })} />}
                />
              ))}
            </ListGroup>
          )}
          <TextField label="Name" value={f.staffName} onChangeText={(v) => set({ staffName: v })} placeholder="Team member's name" />
          <TextField label="Mobile" value={f.staffPhone} onChangeText={(v) => set({ staffPhone: v.replace(/\D/g, '') })} placeholder="98XXXXXXXX" keyboardType="phone-pad" maxLength={10} />
          {ROLES.map((r) => (
            <OptionCard key={r.id} title={r.label} subtitle={r.sub} selected={f.staffRole === r.id} onPress={() => set({ staffRole: r.id })} />
          ))}
          <Button title="Add team member" icon="user-plus" variant="secondary" style={{ marginTop: space.xs }} disabled={f.staffName.trim().length < 2 || !PHONE_RE.test(f.staffPhone)} onPress={addStaff} />
        </Animated.View>
      )}

      {step === 4 && (
        <Animated.View entering={fadeIn()} key="s4">
          {venuePlan ? (
            <Card bg={colors.ink}>
              <AppText variant="caption" color="rgba(255,255,255,0.7)">
                {venuePlan.name} plan
              </AppText>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 2 }}>
                <AppText variant="display" color={colors.white}>
                  {planPrice}
                </AppText>
                <AppText color="rgba(255,255,255,0.7)" style={{ marginLeft: 6, marginBottom: 4 }}>
                  / month + GST
                </AppText>
              </View>
              <View style={{ marginTop: space.sm, gap: 6 }}>
                {venuePlan.features.map((x) => (
                  <View key={x} style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name="check" size={15} color={colors.periwinkle} />
                    <AppText color={colors.white} style={{ marginLeft: 8, flex: 1 }}>
                      {x}
                    </AppText>
                  </View>
                ))}
              </View>
              <AppText variant="caption" color="rgba(255,255,255,0.6)" style={{ marginTop: space.sm }}>
                You pay nothing until you're verified. You'll see the final price before activating.
              </AppText>
            </Card>
          ) : plans.status === 'error' ? (
            <Card elevated={false} bg={colors.surfaceSubtle}>
              <AppText variant="caption" color={colors.inkSoft}>
                Couldn't load Venue plan pricing. You can still submit — you'll see the price before paying.
              </AppText>
              <Button title="Retry" size="xs" variant="secondary" full={false} style={{ marginTop: space.xs }} onPress={plans.reload} />
            </Card>
          ) : (
            <Skeleton height={180} r={radius.card} />
          )}

          <View style={{ backgroundColor: colors.surface, borderRadius: radius.quest, padding: space.md, marginTop: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name="file-text" size={16} />
              <AppText variant="label" style={{ marginLeft: 6 }}>
                How business billing works
              </AppText>
            </View>
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 6 }}>
              After verification you pay through Razorpay (an authorised Indian payment gateway) by UPI, card or net banking, and get a GST invoice. Project IRL never holds a balance or wallet for your venue, and member bookings are paid to you directly.
            </AppText>
          </View>

          <ListGroup style={{ marginTop: space.md }}>
            <ListRow title="Sponsored content stays labelled" subtitle="I won't hide or remove “Sponsored” labels" toggle={f.agreeLabels} onToggle={(v) => set({ agreeLabels: v })} />
            <ListRow title="No attendance guarantees" subtitle="I understand reach is not guaranteed attendance and won't promise it" toggle={f.agreeNoGuarantee} onToggle={(v) => set({ agreeNoGuarantee: v })} />
            <ListRow title="Partner terms" subtitle="Public venue only · member safety rules apply · offers honoured as listed" toggle={f.agreeTerms} onToggle={(v) => set({ agreeTerms: v })} last />
          </ListGroup>
          {myVenue ? <Button title="Cancel editing" variant="ghost" style={{ marginTop: space.sm }} onPress={() => setEditing(false)} /> : null}
          {!myVenue ? (
            <AppText variant="label" color={colors.deep} align="center" style={{ marginTop: space.md }} onPress={() => nav.navigate('business_discovery')} accessibilityRole="button" suppressHighlighting>
              Not now — browse partner places
            </AppText>
          ) : null}
        </Animated.View>
      )}
    </Screen>
  );
}
