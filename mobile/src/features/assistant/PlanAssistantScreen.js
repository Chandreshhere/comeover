// SCREEN C — IRL Guide / Plan Assistant (reference: right phone).
// Periwinkle focal card with an animated orb, quick-input buttons, usage
// indicator, composer, suggestion chips and a compact roadmap preview.
// The guide only suggests; a manual path is always one tap away.
// Data: POST /assistant/suggest via store.askGuide (server-side LLM grounded on
// real nearby plans, server-enforced daily quota), nearby people, quests.
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import {
  ActivityCard,
  AppText,
  AvatarStack,
  Button,
  Card,
  Chip,
  ChipRow,
  Icon,
  IconButton,
  Orb,
  Screen,
  ScreenHeader,
  Sheet,
  ListRow,
} from '@/components';
import { colors, fonts, layout, radius, shadow, space } from '@/theme/tokens';
import { enter, fadeIn } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { SUGGESTED_PROMPTS } from '@/api/assistant';
import haptics from '@/utils/haptics';
import RoadmapTimeline from './components/RoadmapTimeline';

const dayDiff = (iso) => {
  const a = new Date(iso);
  const b = new Date();
  return Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 864e5);
};

function Bubble({ m, activitiesById, onOpen, onDraft, onManual, onRetry }) {
  if (m.role === 'error') {
    return (
      <Animated.View entering={fadeIn()} style={{ marginTop: space.sm }}>
        <View style={{ alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: colors.pinkSoft, borderRadius: 20, borderBottomLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 10 }} accessibilityLiveRegion="polite">
          <AppText>{m.text}</AppText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }}>
          {m.retry && <Button title="Try again" icon="refresh-cw" size="sm" full={false} onPress={() => onRetry(m.retry)} />}
          <Button title="Browse myself" size="sm" variant="secondary" full={false} onPress={onManual} />
          <Button title="Create a plan" size="sm" variant="secondary" full={false} onPress={() => onDraft(null)} />
        </View>
      </Animated.View>
    );
  }
  if (m.role === 'user') {
    return (
      <Animated.View entering={fadeIn()} style={{ alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: colors.ink, borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10, marginTop: space.sm }}>
        <AppText color={colors.white}>{m.text}</AppText>
      </Animated.View>
    );
  }
  return (
    <Animated.View entering={fadeIn()} style={{ marginTop: space.sm }}>
      <View style={{ alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: colors.periwinkleWash, borderRadius: 20, borderBottomLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 10 }}>
        <AppText>{m.text}</AppText>
      </View>
      {m.activityIds?.map((id) => {
        const a = activitiesById[id];
        return a ? <ActivityCard key={id} activity={a} variant="row" onPress={() => onOpen(a)} style={{ marginTop: space.xs, borderWidth: 1.2, borderColor: colors.border }} /> : null;
      })}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }}>
        {m.draft && <Button title="Draft this plan" icon="edit-3" size="sm" full={false} onPress={() => onDraft(m)} />}
        <Button title="Browse myself" size="sm" variant="secondary" full={false} onPress={onManual} />
      </View>
    </Animated.View>
  );
}

export default function PlanAssistantScreen() {
  const nav = useNavigation();
  const scrollRef = useRef(null);
  const activities = useAppStore((s) => s.activities);
  const joinStates = useAppStore((s) => s.joinStates);
  const quests = useAppStore((s) => s.quests);
  const blocked = useAppStore((s) => s.blocked);
  const users = useAppStore((s) => s.users);
  const nearbyPeopleIds = useAppStore((s) => s.nearbyPeopleIds);
  const area = useAppStore((s) => s.profile.area);
  const askGuide = useAppStore((s) => s.askGuide);
  useLoader('nearbyPeople', (s) => s.loadNearbyPeople());
  useLoader('quests', (s) => s.loadQuests());

  const [input, setInput] = useState('');
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [promptsLeft, setPromptsLeft] = useState(null); // unknown until the server answers
  const [menu, setMenu] = useState(false);

  const activitiesById = useMemo(() => Object.fromEntries(activities.map((a) => [a.id, a])), [activities]);
  const availableNow = useMemo(
    () => nearbyPeopleIds.map((id) => users[id]).filter((p) => p && p.availability === 'now' && !blocked.includes(p.id)).map((p) => p.id),
    [nearbyPeopleIds, users, blocked]
  );
  const outOfIdeas = promptsLeft === 0;

  const timeline = useMemo(() => {
    const items = [];
    quests
      .filter((q) => q.state === 'completed' || q.state === 'claimed')
      .slice(0, 1)
      .forEach((q) => items.push({ id: q.id, title: q.title, pictogram: q.pictogram, status: 'done', startOffset: -2, span: 1.6, hour: 9, target: 'social_roadmap' }));
    activities
      .filter((a) => ['accepted', 'checked_in'].includes(joinStates[a.id]) && dayDiff(a.startsAt) >= -1 && dayDiff(a.startsAt) <= 2)
      .slice(0, 2)
      .forEach((a) => items.push({ id: a.id, title: a.title, pictogram: a.pictogram, status: 'active', startOffset: dayDiff(a.startsAt), span: 1.6, hour: new Date(a.startsAt).getHours(), people: (a.participants || []).filter((p) => p !== 'me'), target: 'activity_detail', params: { id: a.id } }));
    quests
      .filter((q) => q.state === 'started' || q.state === 'available')
      .slice(0, 4 - items.length)
      .forEach((q, i) => items.push({ id: q.id, title: q.title, pictogram: q.pictogram, status: 'upcoming', startOffset: i % 2 ? 0 : -1, span: 2.4, hour: 12 + i * 3, target: 'daily_challenges' }));
    return items;
  }, [quests, activities, joinStates]);

  const ask = async (text, { retry = false } = {}) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    if (outOfIdeas) {
      setThread((t) => [...t, { id: `e${Date.now()}`, role: 'error', text: "You've used today's guide ideas. Browsing and creating plans stays unlimited — try the map or start a plan." }]);
      return;
    }
    haptics.light();
    setInput('');
    setListening(false);
    if (!retry) setThread((t) => [...t, { id: `u${Date.now()}`, role: 'user', text: q }]);
    setBusy(true);
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
        msg = "That's all the guide ideas for today. Browsing and creating plans stay unlimited.";
        canRetry = false;
      } else if (e?.code === 'network' || e?.code === 'timeout') {
        msg = "You're offline, so the guide can't look around right now. Your saved plans still work.";
      } else if (e?.code === 'unsupported_intent' || e?.code === 'content_blocked') {
        msg = e?.message || 'The guide only helps with platonic, public activities.';
        canRetry = false;
      }
      setThread((t) => [...t, { id: `e${Date.now()}`, role: 'error', text: msg, retry: canRetry ? q : null }]);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollTo({ y: 460, animated: true }), 120);
    }
  };

  return (
    <Screen
      bg={colors.surface}
      keyboard
      padded={false}
      scroll={false}
      header={
        <ScreenHeader
          title="IRL Guide"
          right={<IconButton icon="menu" accessibilityLabel="Guide options" onPress={() => setMenu(true)} />}
        />
      }
    >
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: layout.screenPadding, paddingBottom: 48 }}>
        {/* Focal card */}
        <Animated.View entering={enter(0)} style={{ backgroundColor: colors.periwinkle, borderRadius: radius.hero, padding: space.md, marginTop: space.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Pressable onPress={() => nav.navigate('live_radar')} accessibilityRole="button" accessibilityLabel={`${availableNow.length} people available now. Open live radar.`} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <AvatarStack seeds={availableNow} size={34} max={3} ringColor={colors.periwinkle} />
              <AppText variant="caption" style={{ marginLeft: 8 }}>
                {availableNow.length} free now
              </AppText>
            </Pressable>
            <IconButton icon="sliders" variant="glass" size={40} accessibilityLabel="Discovery filters" onPress={() => nav.navigate('filters_sheet')} />
          </View>
          <View style={{ alignItems: 'center', marginTop: space.xs }}>
            <Orb size={190} listening={listening || busy} />
            <View style={{ backgroundColor: colors.glass, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, marginTop: -6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' }}>
              <AppText variant="label">{busy ? 'Looking around you…' : listening ? 'Listening… (type below for now)' : 'Hi! What are you in the mood for?'}</AppText>
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.lg, marginTop: space.lg, marginBottom: space.xs }}>
            <IconButton icon="map" variant="glass" size={48} accessibilityLabel="Open map" onPress={() => nav.navigate('map_discovery')} />
            <IconButton
              icon={listening ? 'square' : 'mic'}
              variant="ink"
              size={68}
              iconSize={26}
              accessibilityLabel={listening ? 'Stop listening' : 'Voice input'}
              onPress={() => setListening((l) => !l)}
            />
            <IconButton icon="edit-3" variant="glass" size={48} accessibilityLabel="Create a plan manually" onPress={() => nav.navigate('create_activity_type')} />
          </View>
        </Animated.View>

        {/* Usage */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="star" size={14} />
            <AppText variant="label" style={{ marginLeft: 6 }}>
              {promptsLeft == null ? 'Daily ideas' : `${promptsLeft} idea${promptsLeft === 1 ? '' : 's'} left today`}
            </AppText>
          </View>
          <AppText variant="caption" color={colors.muted}>
            Optional · you always choose
          </AppText>
        </View>

        {/* Composer */}
        <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSubtle, borderRadius: radius.pill, borderWidth: 1.2, borderColor: colors.border, paddingLeft: 18, paddingRight: 5, height: 56, marginTop: space.sm }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask me anything…"
            placeholderTextColor={colors.muted}
            returnKeyType="send"
            onSubmitEditing={() => ask()}
            accessibilityLabel="Ask the IRL Guide"
            style={{ flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, paddingVertical: 0 }}
          />
          <Pressable
            onPress={() => ask()}
            disabled={!input.trim() || busy}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: input.trim() ? colors.ink : colors.white, borderWidth: 1.2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
          >
            {busy ? <ActivityIndicator color={colors.ink} size="small" /> : <Icon name="send" size={18} color={input.trim() ? colors.white : colors.ink} />}
          </Pressable>
        </View>

        {/* Suggestions */}
        <View style={{ marginHorizontal: -layout.screenPadding, marginTop: space.sm }}>
          <ChipRow>
            {SUGGESTED_PROMPTS.map((p, i) => (
              <Chip key={p} label={p} selected={i === 0 && thread.length === 0} onPress={() => ask(p)} />
            ))}
          </ChipRow>
        </View>

        {/* Conversation */}
        {thread.length > 0 && (
          <View style={{ marginTop: space.sm }}>
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
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
                <ActivityIndicator color={colors.deep} size="small" />
                <AppText variant="caption" color={colors.muted} style={{ marginLeft: 8 }}>
                  Checking plans {area ? `near ${area}` : 'nearby'}…
                </AppText>
              </View>
            )}
          </View>
        )}

        {/* Roadmap preview */}
        <Card elevated={false} style={[{ marginTop: space.xl, borderWidth: 1.2, borderColor: colors.border }, shadow.none]}>
          <RoadmapTimeline items={timeline} onPressItem={(it) => nav.navigate(it.target, it.params)} />
        </Card>

        <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.md }}>
          The guide suggests plans; it never messages people for you or decides who is safe. Report and block are always available.
        </AppText>
      </ScrollView>

      <Sheet visible={menu} onClose={() => setMenu(false)} title="Guide">
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }}>
          <ListRow icon="edit-3" title="Create a plan manually" subtitle="Skip the guide entirely" onPress={() => { setMenu(false); nav.navigate('create_activity_type'); }} />
          <ListRow icon="trash-2" title="Clear this conversation" onPress={() => { setThread([]); setMenu(false); }} />
          <ListRow icon="shield" title="Safety center" onPress={() => { setMenu(false); nav.navigate('safety_center'); }} />
          <ListRow icon="star" title="Get more ideas with Plus" subtitle="Core discovery stays free" onPress={() => { setMenu(false); nav.navigate('premium_compare'); }} last />
        </View>
      </Sheet>
    </Screen>
  );
}
