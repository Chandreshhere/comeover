// circle_create — start a recurring group. Name first; look, who can join and
// area are quick picks; rules sit behind an expandable row.
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Chip, ChipGrid, Icon, IconButton, Pictogram, Screen, ScreenHeader, Segmented, TextField } from '@/components';
import { CITY, categories } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { accents, colors, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';

const EXTRA_PICTOS = ['people', 'star', 'sun'];
const MAX_RULES = 5;
const GRID = 5;

const VISIBILITY = [
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
];
const VISIBILITY_HINT = {
  public: 'Anyone nearby can find and join.',
  private: 'People ask to join and you approve.',
};

const CREATE_ERRORS = {
  rate_limited: 'You’ve created a few circles recently. Try again later.',
  name_taken: 'A circle with this name already exists nearby. Try another name.',
  account_restricted: 'Your account is limited right now, so you can’t create circles. Check the Safety center for details.',
  validation_error: null,
};

function Section({ title, right, children, first }) {
  return (
    <View style={{ marginTop: first ? space.xs : space.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.sm }}>
        <AppText variant="h3" accessibilityRole="header" style={{ flex: 1 }}>
          {title}
        </AppText>
        {right}
      </View>
      {children}
    </View>
  );
}

export default function CircleCreateScreen() {
  const nav = useNavigation();
  const profileArea = useAppStore((s) => s.profile.area);
  const createCircle = useAppStore((s) => s.createCircle);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pictogram, setPictogram] = useState('people');
  const [visibility, setVisibility] = useState('public');
  const [area, setArea] = useState(profileArea);
  const [rules, setRules] = useState(['Meet in public places', 'Be on time or drop a note']);
  const [rule, setRule] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [accentIndex, setAccentIndex] = useState(2);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Categories come from the server taxonomy, so build the icon list at render time.
  const PICTOS = useMemo(() => Array.from(new Set([...categories.map((c) => c.pictogram), ...EXTRA_PICTOS])), []);
  const nameOk = name.trim().length >= 3;
  const addRule = () => {
    const r = rule.trim();
    if (!r || rules.length >= MAX_RULES) return;
    setRules((x) => [...x, r]);
    setRule('');
  };

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const circle = await createCircle({ name: name.trim(), description: description.trim(), pictogram, visibility, area: area || undefined, rules, accentIndex });
      haptics.success();
      nav.replace('circle_detail', { id: circle.id });
    } catch (e) {
      setError(CREATE_ERRORS[e?.code] || e?.message || 'Could not create the circle. Check your connection and try again.');
      setSaving(false);
    }
  };

  return (
    <Screen
      keyboard
      header={<ScreenHeader title="New circle" />}
      footer={
        <View>
          {!!error && (
            <AppText variant="caption" color={colors.danger} align="center" style={{ marginBottom: space.xs }} accessibilityLiveRegion="polite">
              {error}
            </AppText>
          )}
          <Button title="Create circle" icon="check" disabled={!nameOk} loading={saving} onPress={create} />
        </View>
      }
    >
      {/* Live preview */}
      <View
        style={{ backgroundColor: accents[accentIndex].bg, borderRadius: radius.hero, padding: space.md, flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}
        accessible
        accessibilityLabel={`Circle preview: ${name.trim() || 'Your circle'}`}
      >
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={pictogram} size={26} color={colors.white} duotoneColor={colors.periwinkle} duotoneOpacity={0.9} />
        </View>
        <View style={{ marginLeft: space.sm, flex: 1 }}>
          <AppText variant="h3" numberOfLines={1}>
            {name.trim() || 'Your circle'}
          </AppText>
          <AppText variant="caption" color={colors.inkSoft} numberOfLines={1}>
            {[area, visibility === 'private' ? 'Private' : 'Public'].filter(Boolean).join(' · ')}
          </AppText>
        </View>
      </View>

      <View style={{ marginTop: space.lg }}>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Satellite Sunday Cyclists" maxLength={40} />
        <TextField label="What's it about?" value={description} onChangeText={setDescription} placeholder="Who it's for, how often you meet" multiline maxLength={500} />
      </View>

      <Section title="Icon & colour" first>
        <ChipGrid columns={GRID}>
          {PICTOS.map((p) => {
            const on = pictogram === p;
            return (
              <Pressable
                key={p}
                onPress={() => setPictogram(p)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Icon ${p}`}
                style={({ pressed }) => ({
                  height: 48,
                  borderRadius: 16,
                  backgroundColor: on ? colors.ink : colors.surface,
                  borderWidth: 1.2,
                  borderColor: on ? colors.ink : colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                })}
              >
                <Pictogram name={p} size={24} color={on ? colors.white : colors.ink} duotoneColor={on ? colors.periwinkle : colors.deep} duotoneOpacity={0.45} />
              </Pressable>
            );
          })}
        </ChipGrid>
        {/* Colours sit on the same 5-column grid as the icons above. */}
        <ChipGrid columns={GRID} style={{ marginTop: space.sm }}>
          {accents.map((a, i) => {
            const on = accentIndex === i;
            return (
              <Pressable
                key={`accent-${i}`}
                onPress={() => setAccentIndex(i)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Colour ${i + 1}`}
                style={{ height: 48, borderRadius: 16, padding: 3, borderWidth: 2, borderColor: on ? colors.ink : 'transparent' }}
              >
                <View style={{ flex: 1, borderRadius: 12, backgroundColor: a.bg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                  {on && <Icon name="check" size={16} color={colors.ink} />}
                </View>
              </Pressable>
            );
          })}
        </ChipGrid>
      </Section>

      <Section title="Who can join">
        <Segmented options={VISIBILITY} value={visibility} onChange={setVisibility} />
        <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
          {VISIBILITY_HINT[visibility]}
        </AppText>
      </Section>

      {CITY.areas.length > 0 && (
        <Section title="Home area">
          <ChipGrid columns={2}>
            {CITY.areas.map((a) => (
              <Chip key={a} label={a} fill selected={area === a} onPress={() => setArea(a)} />
            ))}
          </ChipGrid>
        </Section>
      )}

      {/* Rules: collapsed by default (two sensible defaults are pre-filled). */}
      <View style={{ marginTop: space.xl, backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }}>
        <Pressable
          onPress={() => setRulesOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: rulesOpen }}
          accessibilityLabel={`Rules, ${rules.length} of ${MAX_RULES}`}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60 }}
        >
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center', marginRight: space.sm }}>
            <Icon name="list" size={18} color={colors.ink} />
          </View>
          <AppText variant="bodyStrong" style={{ flex: 1 }}>
            Rules
          </AppText>
          <AppText variant="label" color={colors.muted} style={{ marginRight: space.xs }}>
            {rules.length}/{MAX_RULES}
          </AppText>
          <Icon name={rulesOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
        </Pressable>
        {rulesOpen && (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.xs, paddingBottom: space.sm }}>
            {rules.map((r, i) => (
              <View key={`${r}${i}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center', marginRight: space.sm }}>
                  <AppText variant="caption" maxScale={1.1}>
                    {i + 1}
                  </AppText>
                </View>
                <AppText style={{ flex: 1 }}>{r}</AppText>
                <IconButton icon="x" variant="plain" size={40} accessibilityLabel={`Remove rule ${r}`} onPress={() => setRules((x) => x.filter((_, j) => j !== i))} />
              </View>
            ))}
            {rules.length < MAX_RULES && (
              <TextField
                value={rule}
                onChangeText={setRule}
                placeholder="Add a rule"
                maxLength={80}
                onSubmitEditing={addRule}
                returnKeyType="done"
                style={{ marginTop: space.xs, marginBottom: 0 }}
                right={<IconButton icon="plus" variant={rule.trim() ? 'ink' : 'surface'} size={36} accessibilityLabel="Add rule" onPress={addRule} style={{ marginRight: -space.xs }} />}
              />
            )}
          </View>
        )}
      </View>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
        Community guidelines apply to every circle.
      </AppText>
    </Screen>
  );
}
