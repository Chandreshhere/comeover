// plan_assistant — chat with Mo, the Come Over guide. Mo greets you with a
// few suggestion chips, thinks while the guide looks around, and answers with
// real nearby plans you can open or turn into a draft. The guide only
// suggests; browsing or creating a plan yourself is always one tap away.
// Data: POST /assistant/suggest via store.askGuide (server-side LLM grounded on
// real nearby plans, server-enforced daily quota) and nearby people.
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { ActivityCard, AppText, Button, Chip, ChipGrid, Icon, IconButton, ListGroup, ListRow, Screen, ScreenHeader, Sheet } from '@/components';
import GuideCharacter from '@/features/guide/GuideCharacter';
import { colors, fonts, isDark, layout, radius, space } from '@/theme/tokens';
import { fadeIn } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { SUGGESTED_PROMPTS } from '@/api/assistant';
import haptics from '@/utils/haptics';

// Short chip labels for the suggested prompts (the full prompt is what's sent
// and what screen readers hear). Unknown prompts fall back to their own text.
const PROMPT_CHIPS = {
  'What can I do nearby?': { label: 'Nearby now', icon: 'map-pin' },
  'Find someone for chai': { label: 'Chai buddy', icon: 'coffee' },
  'I have 20 minutes free': { label: '20 min free', icon: 'clock' },
  'Find a gym partner': { label: 'Gym partner', icon: 'activity' },
  'Suggest something for tonight': { label: 'Tonight', icon: 'moon' },
  'Find a group for badminton': { label: 'Badminton', icon: 'users' },
  'Help me organise a weekend plan': { label: 'Weekend plan', icon: 'calendar' },
};
const CHIP_COUNT = 6;

const BUBBLE = { maxWidth: '86%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 };

function Bubble({ m, activitiesById, onOpen, onDraft, onManual, onRetry }) {
  if (m.role === 'user') {
    return (
      <Animated.View entering={fadeIn()} style={[BUBBLE, { alignSelf: 'flex-end', backgroundColor: colors.ink, borderBottomRightRadius: 6, marginTop: space.md }]}>
        <AppText color={colors.white}>{m.text}</AppText>
      </Animated.View>
    );
  }
  const error = m.role === 'error';
  const cards = error ? [] : (m.activityIds || []).map((id) => activitiesById[id]).filter(Boolean);
  return (
    <Animated.View entering={fadeIn()} style={{ marginTop: space.md }}>
      <View style={[BUBBLE, { alignSelf: 'flex-start', backgroundColor: error ? colors.pinkSoft : colors.periwinkleWash, borderBottomLeftRadius: 6 }]} accessibilityLiveRegion="polite">
        <AppText>{m.text}</AppText>
      </View>
      {cards.length > 0 && (
        <View style={{ gap: space.xs, marginTop: space.xs }}>
          {cards.map((a) => (
            <ActivityCard key={a.id} activity={a} variant="row" onPress={() => onOpen(a)} style={{ borderWidth: 1.2, borderColor: colors.border }} />
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs, marginTop: space.xs }}>
        {error && m.retry ? <Button title="Try again" icon="refresh-cw" size="sm" variant="secondary" full={false} onPress={() => onRetry(m.retry)} /> : null}
        {!error && m.draft ? <Button title="Draft this plan" icon="edit-3" size="sm" variant="secondary" full={false} onPress={() => onDraft(m)} /> : null}
        <Button title="Browse myself" size="sm" variant={error && !m.retry ? 'secondary' : 'ghost'} full={false} onPress={onManual} />
        {error && !m.retry ? <Button title="Create a plan" size="sm" variant="ghost" full={false} onPress={() => onDraft(null)} /> : null}
      </View>
    </Animated.View>
  );
}

export default function PlanAssistantScreen() {
  const nav = useNavigation();
  const scrollRef = useRef(null);
  const activities = useAppStore((s) => s.activities);
  const blocked = useAppStore((s) => s.blocked);
  const users = useAppStore((s) => s.users);
  const nearbyPeopleIds = useAppStore((s) => s.nearbyPeopleIds);
  const area = useAppStore((s) => s.profile.area);
  const askGuide = useAppStore((s) => s.askGuide);
  useLoader('nearbyPeople', (s) => s.loadNearbyPeople());

  const [input, setInput] = useState('');
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);
  const [promptsLeft, setPromptsLeft] = useState(null); // unknown until the server answers
  const [menu, setMenu] = useState(false);

  const activitiesById = useMemo(() => Object.fromEntries(activities.map((a) => [a.id, a])), [activities]);
  const availableNow = useMemo(
    () => nearbyPeopleIds.map((id) => users[id]).filter((p) => p && p.availability === 'now' && !blocked.includes(p.id)).map((p) => p.id),
    [nearbyPeopleIds, users, blocked]
  );
  const outOfIdeas = promptsLeft === 0;
  const last = thread[thread.length - 1];
  const moState = busy ? 'think' : last?.role === 'error' ? 'sad' : last?.role === 'guide' ? 'happy' : thread.length ? 'idle' : 'wave';
  const canSend = !!input.trim() && !busy;

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);

  const ask = async (text, { retry = false } = {}) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    if (outOfIdeas) {
      setThread((t) => [...t, { id: `e${Date.now()}`, role: 'error', text: "You've used today's ideas. Browsing and creating plans stay unlimited." }]);
      scrollToEnd();
      return;
    }
    haptics.light();
    setInput('');
    if (!retry) setThread((t) => [...t, { id: `u${Date.now()}`, role: 'user', text: q }]);
    setBusy(true);
    scrollToEnd();
    try {
      const res = await askGuide(q);
      if (typeof res?.promptsLeft === 'number') setPromptsLeft(res.promptsLeft);
      const resById = Object.fromEntries((res?.activities || []).map((a) => [a.id, a]));
      const ids = (res?.activityIds || Object.keys(resById)).filter((id) => !blocked.includes((resById[id] || activitiesById[id])?.host?.id));
      setThread((t) => [...t, { id: `g${Date.now()}`, role: 'guide', text: res?.reply || 'Here’s what I found nearby.', activityIds: ids, draft: res?.draft || null }]);
    } catch (e) {
      let msg = e?.message || "I couldn't reach the guide.";
      let canRetry = true;
      if (e?.code === 'quota_exceeded') {
        setPromptsLeft(0);
        msg = "That's all the ideas for today. Browsing and creating plans stay unlimited.";
        canRetry = false;
      } else if (e?.code === 'network' || e?.code === 'timeout') {
        msg = "You're offline, so I can't look around right now. Your saved plans still work.";
      } else if (e?.code === 'unsupported_intent' || e?.code === 'content_blocked') {
        msg = e?.message || 'I only help with platonic, public activities.';
        canRetry = false;
      }
      setThread((t) => [...t, { id: `e${Date.now()}`, role: 'error', text: msg, retry: canRetry ? q : null }]);
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  };

  const go = (route, params) => {
    setMenu(false);
    nav.navigate(route, params);
  };

  const composer = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <View style={{ flex: 1, height: 52, justifyContent: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1.2, borderColor: colors.border, paddingHorizontal: space.lg }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask Mo anything…"
          placeholderTextColor={colors.muted}
          returnKeyType="send"
          keyboardAppearance={isDark() ? 'dark' : 'light'}
          onSubmitEditing={() => ask()}
          accessibilityLabel="Ask the Come Over Guide"
          style={{ fontFamily: fonts.regular, fontSize: 15, color: colors.ink, paddingVertical: 0 }}
        />
      </View>
      <Pressable
        onPress={() => ask()}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !canSend, busy }}
        style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: canSend ? colors.ink : colors.track, alignItems: 'center', justifyContent: 'center' }}
      >
        {busy ? <ActivityIndicator color={colors.inkSoft} size="small" /> : <Icon name="send" size={20} color={canSend ? colors.white : colors.muted} />}
      </Pressable>
    </View>
  );

  return (
    <Screen
      keyboard
      padded={false}
      scroll={false}
      header={<ScreenHeader title="Plan with Mo" right={<IconButton icon="more-horizontal" accessibilityLabel="Guide options" onPress={() => setMenu(true)} />} />}
      footer={composer}
    >
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: layout.screenPadding, paddingBottom: space.lg }}>
        {/* Mo */}
        <View style={{ alignItems: 'center', marginTop: space.xs }}>
          <GuideCharacter size={112} state={moState} decorative />
          <AppText variant="h2" align="center" accessibilityRole="header" style={{ marginTop: space.xs }}>
            What are you in the mood for?
          </AppText>
          <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.xxs }}>
            {promptsLeft == null ? 'I suggest real plans nearby. You decide.' : `${promptsLeft} idea${promptsLeft === 1 ? '' : 's'} left today · you decide`}
          </AppText>
        </View>

        {/* Suggestions */}
        {thread.length === 0 && (
          <ChipGrid columns={2} style={{ marginTop: space.lg }}>
            {SUGGESTED_PROMPTS.slice(0, CHIP_COUNT).map((p) => {
              const c = PROMPT_CHIPS[p] || { label: p };
              return <Chip key={p} label={c.label} icon={c.icon} fill accessibilityLabel={p} onPress={() => ask(p)} />;
            })}
          </ChipGrid>
        )}

        {/* Conversation */}
        {thread.map((m) => (
          <Bubble
            key={m.id}
            m={m}
            activitiesById={activitiesById}
            onOpen={(a) => nav.navigate('activity_detail', { id: a.id })}
            onDraft={(msg) => (msg ? nav.navigate('assistant_result', { draft: msg.draft, activityIds: msg.activityIds }) : nav.navigate('create_activity_type'))}
            onManual={() => nav.navigate('discover_search')}
            onRetry={(q) => ask(q, { retry: true })}
          />
        ))}
        {busy && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md }} accessibilityLiveRegion="polite">
            <GuideCharacter size={36} state="think" decorative />
            <AppText variant="caption" color={colors.muted} style={{ marginLeft: space.xs }}>
              Checking plans {area ? `near ${area}` : 'nearby'}…
            </AppText>
          </View>
        )}
      </ScrollView>

      <Sheet visible={menu} onClose={() => setMenu(false)} title="Options">
        <ListGroup>
          <ListRow icon="edit-3" title="Create a plan myself" onPress={() => go('create_activity_type')} />
          <ListRow icon="users" title="Who's free now" subtitle={`${availableNow.length} nearby`} onPress={() => go('live_radar')} />
          <ListRow icon="map" title="Open the map" onPress={() => go('map_discovery')} />
          <ListRow
            icon="trash-2"
            title="Clear conversation"
            onPress={() => {
              setThread([]);
              setMenu(false);
            }}
          />
          <ListRow icon="shield" title="Safety center" subtitle="Mo never messages anyone for you" onPress={() => go('safety_center')} />
          <ListRow icon="star" title="More ideas with Plus" subtitle="Core discovery stays free" onPress={() => go('premium_compare')} last />
        </ListGroup>
      </Sheet>
    </Screen>
  );
}
