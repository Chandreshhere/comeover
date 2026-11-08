// split_create — describe the bill, pick people, payer and split method.
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Chip, Pictogram, Screen, ScreenHeader, SectionHeader, Segmented, Skeleton, TextField } from '@/components';
import { colors, layout, radius, space } from '@/theme/tokens';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { inr } from '@/utils/format';
import { METHODS, METHOD_LABEL, UPI_RE, minorToInput, nameOf, newDraft, participantsOf, peoplePool, toMinor } from './lib/split';
import { LedgerNote, PersonToggle, Steps } from './components/SplitBits';

const POOL_PREVIEW = 8;

export default function SplitCreateScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const paramActivityId = route.params?.activityId || null;
  const activities = useAppStore((s) => s.activities);
  const joinStates = useAppStore((s) => s.joinStates);
  const conversations = useAppStore((s) => s.conversations);
  const blocked = useAppStore((s) => s.blocked);
  const users = useAppStore((s) => s.users); // names/avatars resolve as profiles arrive

  // Recent plans + chats are where split partners come from.
  const joinedL = useLoader('my:joined', (s) => s.loadMyActivities('joined'));
  const pastL = useLoader('my:past', (s) => s.loadMyActivities('past'));
  useLoader('conversations', (s) => s.loadConversations({ silent: true }));
  const activityL = useLoader(paramActivityId ? `activity:${paramActivityId}` : 'activity:none', (s) => (paramActivityId ? s.loadActivity(paramActivityId) : null), [paramActivityId]);

  const linkable = useMemo(
    () =>
      activities
        .filter((a) => (['accepted', 'checked_in', 'completed'].includes(joinStates[a.id]) || a.host?.id === 'me') && a.status !== 'cancelled')
        .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt))
        .slice(0, 12),
    [activities, joinStates]
  );
  const paramActivity = useMemo(() => (paramActivityId ? activities.find((x) => x.id === paramActivityId) : null), [activities, paramActivityId]);

  const initial = useMemo(() => {
    const base = route.params?.draft;
    if (base) return base;
    const a = paramActivity;
    if (!paramActivityId) return newDraft();
    if (!a) return newDraft({ activityId: paramActivityId });
    const participants = participantsOf(a);
    return newDraft({ activityId: a.id, description: a.title, participants, payeeId: a.host?.id && participants.includes(a.host.id) ? a.host.id : 'me' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [draft, setDraft] = useState(initial);
  const [totalText, setTotalText] = useState(minorToInput(initial.totalMinor));
  const [showAll, setShowAll] = useState(false);
  const [touched, setTouched] = useState(false);
  const patch = (p) => setDraft((d) => ({ ...d, ...p }));

  // Deep-linked from a plan that wasn't cached yet: fill in once GET /activities/{id} returns.
  useEffect(() => {
    if (!paramActivity || draft.activityId !== paramActivity.id || draft.participants.length > 1) return;
    const participants = participantsOf(paramActivity);
    setDraft((d) => ({
      ...d,
      description: d.description || paramActivity.title,
      participants,
      payeeId: paramActivity.host?.id && participants.includes(paramActivity.host.id) ? paramActivity.host.id : d.payeeId,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramActivity]);

  const linkActivity = (a) => {
    if (draft.activityId === a.id) {
      patch({ activityId: null });
      return;
    }
    const participants = participantsOf(a);
    patch({ activityId: a.id, description: draft.description || a.title, participants, payeeId: participants.includes(draft.payeeId) ? draft.payeeId : 'me' });
  };

  const allKnown = useMemo(() => peoplePool({ activities, joinStates, conversations, blocked }), [activities, joinStates, conversations, blocked]);
  const pool = useMemo(() => {
    const selected = draft.participants.filter((id) => !blocked.includes(id));
    const others = allKnown.filter((id) => !selected.includes(id));
    return Array.from(new Set(['me', ...selected, ...(showAll ? others : others.slice(0, Math.max(0, POOL_PREVIEW - selected.length)))]));
    // `users` keeps names fresh when profiles arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, draft.participants, blocked, allKnown, users]);
  const hasMore = allKnown.filter((id) => !draft.participants.includes(id)).length > Math.max(0, POOL_PREVIEW - draft.participants.length);
  const loadingPeople = (joinedL.loading || pastL.loading || activityL.loading) && pool.length <= 1;

  const toggle = (id) => {
    if (id === 'me') return; // you're always part of your own split
    const has = draft.participants.includes(id);
    const participants = has ? draft.participants.filter((x) => x !== id) : [...draft.participants, id];
    patch({ participants, payeeId: participants.includes(draft.payeeId) ? draft.payeeId : 'me' });
  };

  const itemised = draft.method === 'itemised';
  const totalMinor = toMinor(totalText);
  const upiError = draft.payeeUpi && !UPI_RE.test(draft.payeeUpi.trim()) ? 'That doesn’t look like a UPI ID (e.g. name@okbank).' : null;
  const errors = {
    description: !draft.description.trim() ? 'Add a short description.' : null,
    total: !itemised && totalMinor <= 0 ? 'Enter the bill total.' : null,
    people: draft.participants.length < 2 ? 'Add at least one other person.' : null,
    upi: upiError,
  };
  const valid = !Object.values(errors).some(Boolean);

  const next = (target) => {
    setTouched(true);
    if (!valid && target !== 'split_bill_scan') return;
    if (target === 'split_bill_scan' && (errors.description || errors.people || errors.upi)) return;
    const d = { ...draft, description: draft.description.trim(), payeeUpi: draft.payeeUpi.trim(), totalMinor: itemised ? 0 : totalMinor };
    nav.navigate(target, { draft: target === 'split_bill_scan' ? { ...d, method: 'itemised' } : d });
  };

  return (
    <Screen
      keyboard
      header={<ScreenHeader title="New split" subtitle="Step 1 of 3" />}
      footer={
        <View style={{ gap: space.xs }}>
          <Button
            title={itemised ? 'Add items' : `Review ${totalMinor ? inr(totalMinor) : 'split'}`}
            iconRight="arrow-right"
            onPress={() => next(itemised ? 'split_assign_items' : 'split_summary')}
            disabled={touched && !valid}
          />
          <Button title="Scan a bill instead" icon="camera" variant="secondary" onPress={() => next('split_bill_scan')} />
        </View>
      }
    >
      <Steps step={1} />
      <TextField label="What was it for?" value={draft.description} onChangeText={(t) => patch({ description: t })} placeholder="e.g. Court booking, chai & snacks" maxLength={60} error={touched ? errors.description : null} />
      {!itemised && (
        <TextField
          label="Total amount (₹)"
          value={totalText}
          onChangeText={(t) => setTotalText(t.replace(/[^0-9.]/g, ''))}
          placeholder="0"
          keyboardType="decimal-pad"
          icon="hash"
          helper={totalMinor ? `${inr(totalMinor)} total` : 'Include tax and tip'}
          error={touched ? errors.total : null}
        />
      )}

      {linkable.length > 0 && (
        <>
          <SectionHeader title="Link to a plan" style={{ marginTop: space.xs }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -layout.screenPadding }} contentContainerStyle={{ paddingHorizontal: layout.screenPadding, gap: space.xs }}>
            {linkable.map((a) => (
              <Chip key={a.id} label={a.title} pictogram={a.pictogram} selected={draft.activityId === a.id} onPress={() => linkActivity(a)} />
            ))}
          </ScrollView>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 6 }}>
            Linking adds everyone from the plan and posts the split in its group chat.
          </AppText>
        </>
      )}

      <SectionHeader
        title={`Who's splitting? (${draft.participants.length})`}
        action={showAll ? 'Show fewer' : hasMore ? 'More people' : undefined}
        onAction={() => setShowAll((v) => !v)}
      />
      {loadingPeople ? (
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={96} height={42} r={radius.pill} />
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {pool.map((id) => (
            <PersonToggle key={id} id={id} name={nameOf(id)} selected={draft.participants.includes(id)} onPress={() => toggle(id)} disabled={id === 'me'} />
          ))}
        </View>
      )}
      {!loadingPeople && pool.length <= 1 ? (
        <AppText variant="caption" color={colors.muted} style={{ marginTop: 6 }}>
          You can split with people you've shared a plan or chat with. Link a plan above, or join one first.
        </AppText>
      ) : null}
      {touched && errors.people ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: 6 }}>
          {errors.people}
        </AppText>
      ) : null}

      <SectionHeader title="Who paid?" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {draft.participants.map((id) => (
          <PersonToggle key={id} id={id} size="sm" name={nameOf(id)} selected={draft.payeeId === id} onPress={() => patch({ payeeId: id })} />
        ))}
      </View>
      <TextField
        style={{ marginTop: space.md }}
        label={draft.payeeId === 'me' ? 'Your UPI ID (optional)' : `${nameOf(draft.payeeId)}'s UPI ID (optional)`}
        value={draft.payeeUpi}
        onChangeText={(t) => patch({ payeeUpi: t })}
        placeholder="name@okbank"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        icon="at-sign"
        helper="Only the UPI ID is shared with this group so people can pay in their own app. Never share PINs."
        error={errors.upi}
      />

      <SectionHeader title="How to split" style={{ marginTop: space.xs }} />
      <Segmented options={METHODS} value={draft.method} onChange={(m) => patch({ method: m })} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
        <Pictogram name={itemised ? 'food' : draft.method === 'percentage' ? 'star' : 'people'} size={18} color={colors.inkSoft} />
        <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 6, flex: 1 }}>
          {METHOD_LABEL[draft.method]} —{' '}
          {draft.method === 'equal'
            ? 'everyone pays the same.'
            : draft.method === 'custom'
            ? 'set each person’s amount on the next step.'
            : draft.method === 'percentage'
            ? 'set each person’s share in % on the next step.'
            : 'add items and tap who had what. Tax and tip split proportionally.'}
        </AppText>
      </View>

      <LedgerNote style={{ marginTop: space.xl }} />
    </Screen>
  );
}
