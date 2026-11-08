// circle_members — member list with roles and moderation actions.
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Avatar, Button, Icon, ListRow, ProgressBar, QueryState, Screen, ScreenHeader, SearchBar, Sheet, Tag } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, radius, space } from '@/theme/tokens';
import { ROLE_LABEL, sortMembers } from './circleUtils';

const ROLE_TAG = {
  owner: { bg: colors.ink, fg: colors.white },
  moderator: { bg: colors.periwinkle, fg: colors.ink },
  member: { bg: colors.surfaceSubtle, fg: colors.inkSoft },
};

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

      <QueryState status={load.status} error={load.error} hasData={members.length > 0} onRetry={load.reload} skeletonRows={4} skeletonHeight={64} empty={{ title: 'No members to show', body: 'Profiles are only shown to people who share a circle or plan.' }} style={{ marginTop: space.md }}>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md, marginTop: space.md }}>
        {filtered.map((m, i) => (
          <Pressable
            key={m.id}
            onPress={() => m.id !== 'me' && setSelected(m)}
            disabled={m.id === 'me'}
            accessibilityRole="button"
            accessibilityLabel={`${m.name}, ${ROLE_LABEL[m.role]}`}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, borderBottomWidth: i === filtered.length - 1 ? 0 : 1, borderBottomColor: colors.border, minHeight: 64 }}
          >
            <Avatar seed={m.id === 'me' ? avatarSeed : m.id} uri={m.id === 'me' ? avatarUri : m.avatarUrl} size={44} />
            <View style={{ flex: 1, marginLeft: space.sm }}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {m.name}
              </AppText>
              <AppText variant="caption" color={colors.muted}>
                {m.level ? `Level ${m.level} · ` : ''}
                {m.area || 'Member'}
              </AppText>
            </View>
            <Tag label={ROLE_LABEL[m.role] || 'Member'} bg={(ROLE_TAG[m.role] || ROLE_TAG.member).bg} fg={(ROLE_TAG[m.role] || ROLE_TAG.member).fg} />
            {m.id !== 'me' && <Icon name="more-vertical" size={18} color={colors.muted} style={{ marginLeft: space.xs }} />}
          </Pressable>
        ))}
        {filtered.length === 0 && (
          <AppText color={colors.muted} align="center" style={{ paddingVertical: space.lg }}>
            No members match “{q}”
          </AppText>
        )}
      </View>
      </QueryState>

      {hidden > 0 && !q && (
        <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.md }}>
          + {hidden} more members. Profiles are only shown to people who share a circle or plan.
        </AppText>
      )}

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title={selected?.name}>
        {selected && (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Avatar seed={selected.id} uri={selected.avatarUrl} size={60} />
              <View style={{ marginLeft: space.md, flex: 1 }}>
                <AppText variant="bodyStrong">{ROLE_LABEL[selected.role]} · Level {selected.level ?? '—'}</AppText>
                <AppText variant="caption" color={colors.muted}>
                  Around {selected.area || 'nearby'}
                </AppText>
              </View>
            </View>
            {selected.reliability != null && (
              <View style={{ marginTop: space.md }}>
                <AppText variant="caption" color={colors.inkSoft}>
                  {Math.round(selected.reliability * 100)}% show-up rate
                </AppText>
                <ProgressBar value={selected.reliability} fill={colors.success} style={{ marginTop: 6 }} accessibilityLabel="Show-up rate" />
              </View>
            )}
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md, marginTop: space.lg }}>
              {canRemove(selected) && <ListRow icon="user-minus" title={removing ? 'Removing…' : 'Remove from circle'} onPress={() => !removing && remove(selected)} />}
              <ListRow icon="flag" title="Report" subtitle="Tell us what happened — they won't know it was you" onPress={() => { const u = selected.id; setSelected(null); nav.navigate('report_flow', { userId: u }); }} />
              <ListRow icon="slash" title="Block" danger subtitle="They can't see your plans or contact you" onPress={() => { const u = selected.id; setSelected(null); nav.navigate('block_confirm', { userId: u }); }} last />
            </View>
            {!!removeError && (
              <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
                {removeError}
              </AppText>
            )}
            <Button title="Close" variant="secondary" style={{ marginTop: space.md }} onPress={() => setSelected(null)} />
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
