// business_redeem: staff confirm a member's perk code.
// POST /business/redemptions/confirm { code, groupSize? } → { redemption: BusinessRedemption }
// The code is case-insensitive and spaces are ignored. Camera scanning is out
// of scope: staff type the 6 characters shown under the member's QR code.
// Recent confirmations come from GET /business/redemptions (hidden on error).
import React, { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AppText, Button, Card, Icon, IconBubble, ListGroup, ListRow, Screen, ScreenHeader, SectionHeader } from '@/components';
import { colors, fonts, isDark, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { business } from '@/api/endpoints';
import { relativeDay, timeLabel } from '@/utils/format';
import haptics from '@/utils/haptics';
import sfx from '@/services/sfx';
import useRemote, { itemsOf } from '@/features/premium/useRemote';
import Stepper from '@/features/create/components/Stepper';
import { CODE_LENGTH, CONFIRM_ERRORS, friendlyError, levelLabel, normaliseCode, spacedCode } from './perks';

function ResultCard({ redemption: r, onNext }) {
  const u = r.user || {};
  const rows = [
    ['user', 'Guest', u.firstName || 'Member'],
    ['award', 'Level', u.level ? levelLabel(u.level, u.levelName) : null],
    ['ticket', 'Perk', r.offer?.label || r.offer?.title],
    ['users', 'Group size', r.groupSize ? String(r.groupSize) : null],
  ].filter(([, , v]) => v);
  return (
    <Animated.View entering={enter(0)}>
      <Card bg={colors.mint} elevated={false} style={{ marginTop: space.lg }} accessibilityLabel={`Confirmed. ${rows.map(([, k, v]) => `${k}: ${v}`).join('. ')}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconBubble size={44} tone="surface" icon="check-circle" iconSize={24} duo={colors.success} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="h2">Confirmed</AppText>
            <AppText variant="caption" color={colors.inkSoft}>
              Code {spacedCode(r.code)}
            </AppText>
          </View>
        </View>
        <ListGroup style={{ marginTop: space.md }}>
          {rows.map(([icon, k, v], i) => (
            <ListRow key={k} icon={icon} title={v} subtitle={k} last={i === rows.length - 1} />
          ))}
        </ListGroup>
      </Card>
      <Button title="Check another code" icon="refresh-cw" full={false} align="center" style={{ marginTop: space.lg }} onPress={onNext} />
    </Animated.View>
  );
}

export default function BusinessRedeemScreen() {
  const [code, setCode] = useState('');
  const [sizeOn, setSizeOn] = useState(false);
  const [groupSize, setGroupSize] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const input = useRef(null);

  const recentQ = useRemote(() => business.redemptions(), []);
  const recent = itemsOf(recentQ.data).slice(0, 5);
  const counts = recentQ.data?.counts;

  const ready = code.length === CODE_LENGTH;

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await business.confirmRedemption({ code, ...(sizeOn ? { groupSize } : {}) });
      const r = res?.redemption || res;
      setResult(r);
      sfx.play('chime');
      haptics.success();
      recentQ.reload();
    } catch (e) {
      haptics.warning();
      setError(friendlyError(e, 'Could not check the code. Try again.', CONFIRM_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setCode('');
    setError(null);
    setSizeOn(false);
    setTimeout(() => input.current?.focus(), 50);
  };

  return (
    <Screen
      keyboard
      header={<ScreenHeader title="Check a code" />}
      footer={result ? null : <Button title="Confirm" icon="check" disabled={!ready} loading={busy} onPress={confirm} />}
    >
      {result ? (
        <ResultCard redemption={result} onNext={reset} />
      ) : (
        <>
          <AppText color={colors.muted} align="center" style={{ marginTop: space.md }}>
            Ask the guest for the 6-character code under their QR code.
          </AppText>

          <View
            style={{
              marginTop: space.lg,
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              borderWidth: 1.2,
              borderColor: error ? colors.danger : colors.border,
              paddingVertical: space.md,
              paddingHorizontal: space.sm,
            }}
          >
            <TextInput
              ref={input}
              value={code}
              onChangeText={(t) => {
                setCode(normaliseCode(t));
                if (error) setError(null);
              }}
              placeholder="ABC123"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              keyboardAppearance={isDark() ? 'dark' : 'light'}
              returnKeyType="done"
              onSubmitEditing={confirm}
              maxLength={12}
              accessibilityLabel="Perk code, 6 characters"
              style={{ fontFamily: fonts.bold, fontSize: 36, letterSpacing: 10, paddingLeft: 10, textAlign: 'center', color: colors.ink, paddingVertical: space.xs }}
            />
          </View>
          <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.xs }}>
            {code.length}/{CODE_LENGTH} · letters and numbers, spaces are ignored
          </AppText>

          {!!error && (
            <View
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.pinkSoft, borderRadius: radius.quest, padding: space.sm, marginTop: space.md }}
              accessibilityLiveRegion="polite"
            >
              <Icon name="alert-circle" size={18} color={colors.danger} />
              <AppText variant="label" style={{ flex: 1, marginLeft: space.xs }}>
                {error}
              </AppText>
            </View>
          )}

          <ListGroup style={{ marginTop: space.lg }}>
            <ListRow icon="users" title="Set group size" subtitle="Otherwise we use the plan's group" toggle={sizeOn} onToggle={setSizeOn} last />
          </ListGroup>
          {sizeOn && <Stepper value={groupSize} onChange={setGroupSize} min={1} max={20} label="Group size" style={{ marginTop: space.sm }} />}
        </>
      )}

      {recent.length > 0 && (
        <>
          <SectionHeader
            title="Recent"
            right={
              counts ? (
                <AppText variant="label" color={colors.muted}>
                  {`Today ${counts.today ?? 0} · Week ${counts.week ?? 0}`}
                </AppText>
              ) : null
            }
          />
          <ListGroup>
            {recent.map((r, i) => (
              <ListRow
                key={r.id}
                icon="ticket"
                title={`${r.user?.firstName || 'Member'} · ${r.offer?.label || 'Perk'}`}
                subtitle={[r.redeemedAt ? `${relativeDay(r.redeemedAt)} · ${timeLabel(r.redeemedAt)}` : null, r.groupSize ? `Group of ${r.groupSize}` : null].filter(Boolean).join(' · ')}
                last={i === recent.length - 1}
              />
            ))}
          </ListGroup>
        </>
      )}

    </Screen>
  );
}
