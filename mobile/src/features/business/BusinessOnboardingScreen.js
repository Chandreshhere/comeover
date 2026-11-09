// business_onboarding — venue / club verification (POST /business/venues) and
// Venue plan activation (Razorpay order → checkout; activated by the signed
// webhook server-side). Proof of business uploads privately to S3.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  AppText,
  Button,
  Card,
  Chip,
  ChipGrid,
  Icon,
  IconBubble,
  IconButton,
  ListGroup,
  ListRow,
  Mascot,
  OptionCard,
  ProgressBar,
  QueryState,
  Screen,
  ScreenHeader,
  Segmented,
  Skeleton,
  Tag,
  TextField,
} from '@/components';
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

// One group of questions per step.
const STEPS = ['Business', 'Location', 'Proof', 'Contact', 'Team', 'Plan'];
const TYPES = [
  { id: 'cafe', label: 'Café or restaurant', pictogram: 'chai' },
  { id: 'sport', label: 'Sports venue or court', pictogram: 'badminton' },
  { id: 'fitness', label: 'Gym or studio', pictogram: 'gym' },
  { id: 'games', label: 'Games or entertainment', pictogram: 'board' },
  { id: 'club', label: 'Club or community group', pictogram: 'people' },
];
const ROLES = [
  { value: 'manager', label: 'Manager', sub: 'Edits the profile, offers and campaigns' },
  { value: 'staff', label: 'Staff', sub: 'Verifies offers at the counter' },
  { value: 'analyst', label: 'Analyst', sub: 'Views reports only' },
];
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A function so the colours follow the live light/dark palette.
const statusCopy = () => ({
  in_review: { label: 'In review', bg: colors.orangeSoft, title: 'In review' },
  verified: { label: 'Verified', bg: colors.mint, title: 'You’re verified' },
  rejected: { label: 'Not approved', bg: colors.pinkSoft, title: 'Needs changes' },
  suspended: { label: 'Suspended', bg: colors.pinkSoft, title: 'Venue paused' },
});

// Step title + one helper line (same pattern on every step).
function StepTitle({ title, subtitle }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <AppText variant="h2" accessibilityRole="header">
        {title}
      </AppText>
      {!!subtitle && (
        <AppText color={colors.muted} style={{ marginTop: space.xxs }}>
          {subtitle}
        </AppText>
      )}
    </View>
  );
}

function VenueStatus({ venue, venuePlan, planPrice, onEdit, onReload, refreshing }) {
  const nav = useNavigation();
  const paymentSubmittedAt = useBusinessStore((s) => s.paymentSubmittedAt);
  const markPaymentSubmitted = useBusinessStore((s) => s.markPaymentSubmitted);
  const clearPayment = useBusinessStore((s) => s.clearPayment);
  const [paying, setPaying] = useState(false);
  const [payNotice, setPayNotice] = useState(null);

  const status = venue.status || 'in_review';
  const allCopy = statusCopy();
  const copy = allCopy[status] || allCopy.in_review;
  const planActive = venue.planStatus === 'active';
  const awaitingActivation = !planActive && (venue.planStatus === 'payment_processing' || !!paymentSubmittedAt);
  const canPay = status === 'verified' && !planActive && !awaitingActivation;

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
        setPayNotice('Payment cancelled, nothing was charged.');
      } else {
        setPayNotice(`Payment didn't go through: ${res.error || 'please try again.'}`);
      }
    } catch (e) {
      setPayNotice(errorMessage(e, 'Couldn’t start the payment. Try again.'));
    } finally {
      setPaying(false);
    }
  };

  const title = planActive ? 'You’re all set' : copy.title;
  const subtitle =
    status === 'in_review'
      ? `Usually 2–3 working days. We'll text ${venue.contact?.phone ? `+91 ${venue.contact.phone}` : 'you'}.`
      : status === 'verified'
      ? planActive
        ? 'Create labelled campaigns and track results.'
        : 'Activate the Venue plan to unlock campaigns and analytics.'
      : venue.reviewNote || 'Update your details and resubmit.';
  const planTag = planActive ? 'Active' : awaitingActivation ? 'Activating' : status === 'verified' ? 'Not active' : 'After verification';

  let footer;
  if (planActive) footer = <Button title="Open dashboard" icon="bar-chart-2" onPress={() => nav.navigate('business_analytics', { venueId: venue.id })} />;
  else if (canPay) footer = <Button title={planPrice ? `Pay ${planPrice} & activate` : 'Activate Venue plan'} icon="credit-card" loading={paying} disabled={paying} onPress={pay} />;
  else if (status === 'rejected') footer = <Button title="Edit and resubmit" onPress={onEdit} />;
  else footer = <Button title="Explore partner places" onPress={() => nav.navigate('business_discovery')} />;

  return (
    <Screen
      header={
        <ScreenHeader
          title="Your venue"
          right={planActive ? <IconButton icon="plus" accessibilityLabel="New campaign" onPress={() => nav.navigate('business_campaign_create', { venueId: venue.id })} /> : null}
        />
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onReload} tintColor={colors.ink} />}
      footer={footer}
    >
      <Animated.View entering={fadeIn()} style={{ alignItems: 'center', marginTop: space.md }}>
        <Mascot size={120} pose={status === 'verified' ? 'cheer' : 'wave'} />
        <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityRole="header">
          {title}
        </AppText>
        <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 320 }}>
          {subtitle}
        </AppText>
      </Animated.View>

      {awaitingActivation && (
        <Card bg={colors.orangeSoft} elevated={false} style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center' }} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.ink} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong">Activating your plan</AppText>
            <AppText variant="caption" color={colors.inkSoft}>
              Payment received. Pull to refresh to check.
            </AppText>
          </View>
        </Card>
      )}
      {payNotice && (
        <AppText variant="caption" color={colors.danger} align="center" style={{ marginTop: space.md }} accessibilityLiveRegion="polite">
          {payNotice}
        </AppText>
      )}

      <ListGroup style={{ marginTop: space.xl }}>
        <ListRow icon="briefcase" title={venue.name} subtitle={[TYPES.find((t) => t.id === venue.type)?.label || venue.kind, venue.area].filter(Boolean).join(' · ')} />
        <ListRow
          icon="activity"
          title="Status"
          subtitle={venue.submittedAt ? `Submitted ${shortDate(venue.submittedAt)}` : undefined}
          right={<Tag label={copy.label} bg={copy.bg} fg={colors.ink} />}
        />
        <ListRow
          icon="credit-card"
          title="Venue plan"
          subtitle={planPrice ? `${planPrice} / month + GST` : undefined}
          right={<Tag label={planTag} bg={planActive ? colors.mint : colors.surfaceSubtle} fg={colors.ink} />}
          last
        />
      </ListGroup>
      {canPay && (
        <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
          Paid via Razorpay by UPI, card or net banking. No wallet balance is held.
        </AppText>
      )}

      {status === 'in_review' && <Button title="Edit application" variant="ghost" full={false} align="center" style={{ marginTop: space.md }} onPress={onEdit} />}
    </Screen>
  );
}

export default function BusinessOnboardingScreen() {
  const nav = useNavigation();
  const setMyVenue = useBusinessStore((s) => s.setMyVenue);
  const myVenueQ = useRemote(fetchMyVenue, []);
  const plans = usePlans();
  const venuePlan = plans.venue;
  const planPrice = venuePlan?.priceMonthly ? rupees(venuePlan.priceMonthly) : null;

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
    f.name.trim().length >= 2 && !!f.type,
    f.address.trim().length >= 5 && !!f.area,
    !!f.proof?.key && !uploading && !gstinError,
    f.contactName.trim().length >= 2 && PHONE_RE.test(f.phone) && (!f.email || !emailError),
    true,
    f.agreeLabels && f.agreeNoGuarantee && f.agreeTerms,
  ];
  const lastStep = step === STEPS.length - 1;

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

  const canAddStaff = f.staffName.trim().length >= 2 && PHONE_RE.test(f.staffPhone);
  const addStaff = () => {
    if (!canAddStaff) return;
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
      setSubmitError(errorMessage(e, "We couldn't submit right now. Your answers are kept. Try again."));
    } finally {
      setSubmitting(false);
    }
  };

  // Loading the owner's existing application.
  if (!myVenue && myVenueQ.status !== 'ready' && !editing) {
    return (
      <Screen header={<ScreenHeader title="List your venue" />}>
        <QueryState status={myVenueQ.status} error={myVenueQ.error} hasData={false} onRetry={myVenueQ.reload} skeletonRows={3} skeletonHeight={72} style={{ marginTop: space.xs }}>
          <View />
        </QueryState>
        {myVenueQ.status === 'error' ? <Button title="Start a new application" variant="ghost" full={false} align="center" onPress={() => setEditing(true)} /> : null}
      </Screen>
    );
  }

  if (myVenue && !editing) {
    return <VenueStatus venue={myVenue} venuePlan={venuePlan} planPrice={planPrice} onEdit={startEditing} onReload={myVenueQ.reload} refreshing={myVenueQ.refreshing} />;
  }

  const goBack = step > 0 ? () => setStep((s) => s - 1) : myVenue ? () => setEditing(false) : undefined;
  const footer = (
    <View>
      {submitError && (
        <AppText variant="caption" color={colors.danger} style={{ marginBottom: space.xs }} accessibilityLiveRegion="polite">
          {submitError}
        </AppText>
      )}
      <Button
        title={lastStep ? 'Submit for verification' : step === 4 && !f.staff.length ? 'Skip for now' : 'Continue'}
        disabled={!valid[step] || submitting}
        loading={submitting}
        onPress={() => (lastStep ? submit() : setStep((s) => s + 1))}
      />
    </View>
  );

  return (
    <Screen keyboard header={<ScreenHeader title="List your venue" subtitle={`Step ${step + 1} of ${STEPS.length}`} onBack={goBack} />} footer={footer}>
      <ProgressBar value={(step + 1) / STEPS.length} height={6} style={{ marginTop: space.xs, marginBottom: space.lg }} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`} />

      {step === 0 && (
        <Animated.View entering={fadeIn()} key="s0">
          <StepTitle title="About your place" subtitle="Members see this on your venue page." />
          <TextField label="Business or club name" value={f.name} onChangeText={(v) => set({ name: v })} placeholder="e.g. Sunrise Badminton Club" maxLength={60} />
          <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: space.xs }}>
            Type
          </AppText>
          {TYPES.map((t) => {
            const on = f.type === t.id;
            return (
              <OptionCard
                key={t.id}
                title={t.label}
                selected={on}
                onPress={() => set({ type: t.id })}
                left={<IconBubble size={40} tone="subtle" bg={on ? colors.white : undefined} pictogram={t.pictogram} iconSize={22} />}
              />
            );
          })}
          <TextField label="Short description (optional)" value={f.about} onChangeText={(v) => set({ about: v })} placeholder="What makes your place great for groups?" multiline maxLength={240} style={{ marginTop: space.md }} />
        </Animated.View>
      )}

      {step === 1 && (
        <Animated.View entering={fadeIn()} key="s1">
          <StepTitle title="Where are you?" subtitle="Only this public address is shown to members." />
          <TextField label="Public address" value={f.address} onChangeText={(v) => set({ address: v })} placeholder="Building, street, landmark" multiline maxLength={160} icon="map-pin" />
          <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: space.xs }}>
            Area{CITY.name ? ` in ${CITY.name}` : ''}
          </AppText>
          <ChipGrid columns={2}>
            {CITY.areas.map((a) => (
              <Chip key={a} label={a} fill selected={f.area === a} onPress={() => set({ area: a })} />
            ))}
          </ChipGrid>
        </Animated.View>
      )}

      {step === 2 && (
        <Animated.View entering={fadeIn()} key="s2">
          <StepTitle title="Verify your business" subtitle="Licence, GST certificate, utility bill or club registration." />
          <Card
            onPress={uploading ? undefined : pickProof}
            elevated={false}
            style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: f.proof?.key ? colors.success : uploadError ? colors.danger : colors.border, alignItems: 'center', paddingVertical: space.lg }}
            accessibilityLabel={f.proof ? `Proof ${f.proof.key ? 'uploaded' : uploading ? 'uploading' : 'not uploaded'}: ${f.proof.name}. Tap to change.` : 'Upload proof of business'}
          >
            {f.proof ? (
              <>
                <View>
                  <Image source={{ uri: f.proof.uri }} style={{ width: 96, height: 96, borderRadius: radius.sm, opacity: uploading ? 0.5 : 1 }} accessibilityIgnoresInvertColors />
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
                <IconBubble size={44} tone="periwinkle" icon="upload" iconSize={22} />
                <AppText variant="bodyStrong" style={{ marginTop: space.xs }}>
                  Upload proof
                </AppText>
                <AppText variant="caption" color={colors.muted}>
                  JPG or PNG · max 10 MB · seen only by reviewers
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
          <TextField
            label="GSTIN (optional)"
            value={f.gstin}
            onChangeText={(v) => set({ gstin: v.toUpperCase() })}
            placeholder="24ABCDE1234F1Z5"
            autoCapitalize="characters"
            maxLength={15}
            error={gstinError}
            helper="For GST invoices on the Venue plan"
            style={{ marginTop: space.lg }}
          />
        </Animated.View>
      )}

      {step === 3 && (
        <Animated.View entering={fadeIn()} key="s3">
          <StepTitle title="Who should we contact?" subtitle="We'll message this number about your review." />
          <TextField label="Contact person" value={f.contactName} onChangeText={(v) => set({ contactName: v })} placeholder="Full name" />
          <TextField label="Mobile" value={f.phone} onChangeText={(v) => set({ phone: v.replace(/\D/g, '') })} placeholder="98XXXXXXXX" keyboardType="phone-pad" maxLength={10} error={phoneError} icon="phone" />
          <TextField label="Email (optional)" value={f.email} onChangeText={(v) => set({ email: v.trim() })} placeholder="owner@yourplace.in" keyboardType="email-address" autoCapitalize="none" error={emailError} icon="mail" />
        </Animated.View>
      )}

      {step === 4 && (
        <Animated.View entering={fadeIn()} key="s4">
          <StepTitle title="Add your team" subtitle="Optional. Staff can help without your login." />
          {f.staff.length > 0 && (
            <ListGroup style={{ marginBottom: space.lg }}>
              {f.staff.map((m, i) => (
                <ListRow
                  key={m.id}
                  icon="user"
                  title={m.name}
                  subtitle={`${ROLES.find((r) => r.value === m.role)?.label} · +91 ${m.phone}`}
                  last={i === f.staff.length - 1}
                  right={<IconButton icon="x" size={36} variant="plain" accessibilityLabel={`Remove ${m.name}`} onPress={() => set({ staff: f.staff.filter((x) => x.id !== m.id) })} />}
                />
              ))}
            </ListGroup>
          )}
          <TextField label="Name" value={f.staffName} onChangeText={(v) => set({ staffName: v })} placeholder="Team member's name" />
          <TextField label="Mobile" value={f.staffPhone} onChangeText={(v) => set({ staffPhone: v.replace(/\D/g, '') })} placeholder="98XXXXXXXX" keyboardType="phone-pad" maxLength={10} />
          <AppText variant="label" color={colors.inkSoft} style={{ marginBottom: space.xs }}>
            Role
          </AppText>
          <Segmented options={ROLES} value={f.staffRole} onChange={(v) => set({ staffRole: v })} />
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
            {ROLES.find((r) => r.value === f.staffRole)?.sub}
          </AppText>
          <Button title="Add team member" icon="user-plus" variant="secondary" style={{ marginTop: space.md }} disabled={!canAddStaff} onPress={addStaff} />
        </Animated.View>
      )}

      {step === 5 && (
        <Animated.View entering={fadeIn()} key="s5">
          <StepTitle title="Venue plan" subtitle="You pay nothing until you're verified." />
          {venuePlan ? (
            <Card elevated={false} style={{ borderWidth: 1.2, borderColor: colors.border }}>
              <AppText variant="label" color={colors.muted}>
                {venuePlan.name} plan
              </AppText>
              {planPrice ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: space.xxs }}>
                  <AppText variant="h1">{planPrice}</AppText>
                  <AppText color={colors.muted} style={{ marginLeft: space.xs, marginBottom: 3 }}>
                    / month + GST
                  </AppText>
                </View>
              ) : (
                <AppText variant="h3" style={{ marginTop: space.xxs }}>
                  Price shown before you pay
                </AppText>
              )}
              {(venuePlan.featureItems || []).length > 0 && (
                <View style={{ marginTop: space.sm, gap: space.xs }}>
                  {venuePlan.featureItems.map((x) => (
                    <View key={x.key} style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Icon name="check" size={16} color={colors.success} />
                      <AppText style={{ marginLeft: space.xs, flex: 1 }}>{x.label}</AppText>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          ) : plans.status === 'error' ? (
            <Card elevated={false} bg={colors.surfaceSubtle} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginRight: space.sm }}>
                Couldn't load pricing. You'll see it before paying.
              </AppText>
              <Button title="Retry" size="xs" variant="secondary" full={false} onPress={plans.reload} />
            </Card>
          ) : (
            <Skeleton height={160} r={radius.card} />
          )}
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
            Billed via Razorpay with a GST invoice. No wallet balance is held.
          </AppText>

          <AppText variant="label" color={colors.inkSoft} style={{ marginTop: space.xl, marginBottom: space.xs }}>
            Partner agreement
          </AppText>
          <ListGroup>
            <ListRow title="Keep “Sponsored” labels" subtitle="I won't hide or remove them" toggle={f.agreeLabels} onToggle={(v) => set({ agreeLabels: v })} />
            <ListRow title="No attendance promises" subtitle="Reach is not guaranteed turnout" toggle={f.agreeNoGuarantee} onToggle={(v) => set({ agreeNoGuarantee: v })} />
            <ListRow title="Partner terms" subtitle="Public venue · safety rules · offers as listed" toggle={f.agreeTerms} onToggle={(v) => set({ agreeTerms: v })} last />
          </ListGroup>
          {myVenue ? (
            <Button title="Cancel editing" variant="ghost" full={false} align="center" style={{ marginTop: space.md }} onPress={() => setEditing(false)} />
          ) : (
            <Button title="Not now" variant="ghost" full={false} align="center" style={{ marginTop: space.md }} onPress={() => nav.navigate('business_discovery')} accessibilityLabel="Not now. Browse partner places" />
          )}
        </Animated.View>
      )}
    </Screen>
  );
}
