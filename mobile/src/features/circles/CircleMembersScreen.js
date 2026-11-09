// circle_members — member list with roles and moderation actions.
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Avatar, Icon, ListGroup, ListRow, QueryState, Screen, ScreenHeader, SearchBar, Sheet, Tag, usePressScale } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, space } from '@/theme/tokens';
import { ROLE_LABEL, sortMembers } from './circleUtils';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// A function so the tag colours follow light/dark mode.
const roleTag = (role) =>
  ({
    owner: { bg: colors.ink, fg: colors.white, icon: 'crown' },
    moderator: { bg: colors.periwinkleWash, fg: colors.ink, icon: 'shield' },
  }[role] || null);

function MemberRow({ m, isLast, avatarSeed, avatarUri, onPress }) {
  const press = usePressScale(0.98);
  const me = m.id === 'me';
  const tag = roleTag(m.role);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={me ? undefined : press.onPressIn}
      onPressOut={me ? undefined : press.onPressOut}
      disabled={me}
      accessibilityRole="button"
      accessibilityLabel={`${m.name}, ${ROLE_LABEL[m.role] || 'Member'}`}
      accessibilityHint={me ? undefined : 'Opens member options'}
      style={[{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.border, minHeight: 64 }, press.style]}
    >
      <Avatar seed={me ? avatarSeed : m.id} uri={me ? avatarUri : m.avatarUrl} size={40} />
      <View style={{ flex: 1, marginHorizontal: space.sm }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {m.name}
        </AppText>
        {m.area || m.level ? (
          <AppText variant="caption" color={colors.muted} numberOfLines={1}>
            {[m.level ? `Level ${m.level}` : null, m.area].filter(Boolean).join(' · ')}
          </AppText>
        ) : null}
      </View>
      {/* Only owners and moderators get a tag; plain members stay quiet. */}
      {tag ? <Tag label={ROLE_LABEL[m.role]} bg={tag.bg} fg={tag.fg} icon={tag.icon} style={{ alignSelf: 'center' }} /> : null}
      {/* Fixed-width trailing slot keeps every row's right edge aligned. */}
      <View style={{ width: 18 + space.xs, alignItems: 'flex-end' }}>{me ? null : <Icon name="more-horizontal" size={18} color={colors.muted} />}</View>
    </AnimatedPressable>
  );
}

export default function CircleMembersScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const id = route.params?.id;
  const circles = useAppStore((s) => s.circles);
  const rawMembers = useAppStore((s) => s.circleMembers[id]);
  const blocked = useAppStore((s) => s.blocked);
  const profileName = useAppStore((s) => s.profile.name);
  const avatarSeed = useAppStore((s) => s.profile.avatarSeed);
  const avatarUri = useAppStore((s) => s.profile.avatarUri);
  const removeCircleMember = useAppStore((s) => s.removeCircleMember);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(null);

  const load = useLoader(`circleMembers:${id}`, (s) => s.loadCircleMembers(id), [id]);

  const c = useMemo(() => circles.find((x) => x.id === id), [circles, id]);
  const iAmOwner = c?.ownerId === 'me' || c?.myRole === 'owner';
  const iAmMod = c?.myRole === 'moderator';
  const members = useMemo(() => sortMembers(rawMembers || [], { profileName, blocked }), [rawMembers, profileName, blocked]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? members.filter((m) => (m.name || '').toLowerCase().includes(n)) : members;
  }, [members, q]);
  const hidden = c && rawMembers ? Math.max(0, (c.members || 0) - members.length) : 0;

  if (!c && !rawMembers) {
    return (
      <Screen header={<ScreenHeader title="Members" />}>
        <QueryState status={load.status} error={load.error} hasData={false} onRetry={load.reload} empty={{ title: 'Circle not found', cta: 'Back', onCta: () => nav.goBack() }} style={{ marginTop: space.md }} />
      </Screen>
    );
  }

  // Owner (or moderator for regular members) only — DELETE /circles/{id}/members/{userId}.
  const canRemove = (m) => m.id !== 'me' && m.role !== 'owner' && (iAmOwner || (iAmMod && m.role === 'member'));
  const remove = (m) => {
    Alert.alert(`Remove ${m.name}?`, 'They can no longer see circle-only plans. They are not notified of the reason.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setRemoving(true);
          setRemoveError(null);
          try {
            await removeCircleMember(id, m.id);
            setSelected(null);
          } catch (e) {
            setRemoveError(e?.message || 'Could not remove this member. Try again.');
          } finally {
            setRemoving(false);
          }
        },
      },
    ]);
  };

  return (
    <Screen header={<ScreenHeader title="Members" subtitle={c?.name} />} keyboard>
      <SearchBar placeholder="Search members" value={q} onChangeText={setQ} style={{ marginTop: space.xs }} />

      <QueryState status={load.status} error={load.error} hasData={members.length > 0} onRetry={load.reload} skeletonRows={4} skeletonHeight={64} empty={{ title: 'No members to show', body: 'Profiles show only to people who share a circle or plan.' }} style={{ marginTop: space.md }}>
        <ListGroup style={{ marginTop: space.md }}>
          {filtered.map((m, i) => (
            <MemberRow key={m.id} m={m} isLast={i === filtered.length - 1} avatarSeed={avatarSeed} avatarUri={avatarUri} onPress={() => m.id !== 'me' && setSelected(m)} />
          ))}
          {filtered.length === 0 && (
            <AppText color={colors.muted} align="center" style={{ paddingVertical: space.lg }}>
              No members match “{q}”
            </AppText>
          )}
        </ListGroup>
      </QueryState>

      {hidden > 0 && !q && (
        <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.md }}>
          +{hidden} more members. Some profiles are private.
        </AppText>
      )}

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title={selected?.name}>
        {selected && (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Avatar seed={selected.id} uri={selected.avatarUrl} size={52} />
              <View style={{ marginLeft: space.sm, flex: 1 }}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {[ROLE_LABEL[selected.role] || 'Member', selected.level ? `Level ${selected.level}` : null].filter(Boolean).join(' · ')}
                </AppText>
                <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                  {[selected.area ? `Around ${selected.area}` : null, selected.reliability != null ? `${Math.round(selected.reliability * 100)}% show-up rate` : null].filter(Boolean).join(' · ') || 'Circle member'}
                </AppText>
              </View>
            </View>
            <ListGroup style={{ marginTop: space.md }}>
              {canRemove(selected) && <ListRow icon="user-minus" title={removing ? 'Removing…' : 'Remove from circle'} onPress={() => !removing && remove(selected)} />}
              <ListRow icon="flag" title="Report" subtitle="They won't know it was you" onPress={() => { const u = selected.id; setSelected(null); nav.navigate('report_flow', { userId: u }); }} />
              <ListRow icon="slash" title="Block" danger subtitle="They can't see your plans or message you" onPress={() => { const u = selected.id; setSelected(null); nav.navigate('block_confirm', { userId: u }); }} last />
            </ListGroup>
            {!!removeError && (
              <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
                {removeError}
              </AppText>
            )}
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
