// circle_create — start a recurring group.
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Chip, IconButton, Icon, OptionCard, Pictogram, Screen, ScreenHeader, TextField } from '@/components';
import { CITY, categories } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import { accents, colors, radius, space } from '@/theme/tokens';
import haptics from '@/utils/haptics';

const EXTRA_PICTOS = ['people', 'star', 'sun'];
const MAX_RULES = 5;

const CREATE_ERRORS = {
  rate_limited: 'You’ve created a few circles recently. Try again later.',
  name_taken: 'A circle with this name already exists nearby. Try another name.',
  account_restricted: 'Your account is limited right now, so you can’t create circles. Check the Safety center for details.',
  validation_error: null,
};

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
      {/* live preview */}
      <View style={{ backgroundColor: accents[accentIndex].bg, borderRadius: radius.hero, padding: space.lg, flexDirection: 'row', alignItems: 'center', marginTop: space.xs }} accessibilityLabel="Circle preview">
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name={pictogram} size={28} color={colors.white} />
        </View>
        <View style={{ marginLeft: space.sm, flex: 1 }}>
          <AppText variant="h2" numberOfLines={1}>
            {name.trim() || 'Your circle'}
          </AppText>
          <AppText variant="caption" color={colors.inkSoft}>
            1 member{area ? ` · ${area}` : ''} · {visibility === 'private' ? 'Private' : 'Public'}
          </AppText>
        </View>
      </View>

      <View style={{ marginTop: space.lg }}>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Satellite Sunday Cyclists" maxLength={40} />
        <TextField label="What's it about?" value={description} onChangeText={setDescription} placeholder="Who is it for, how often you meet, the vibe…" multiline maxLength={500} />
      </View>

      <AppText variant="h3" style={{ marginTop: space.xs, marginBottom: space.sm }}>
        Icon & colour
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {PICTOS.map((p) => (
          <Pressable
            key={p}
            onPress={() => setPictogram(p)}
            accessibilityRole="radio"
            accessibilityState={{ selected: pictogram === p }}
            accessibilityLabel={`Icon ${p}`}
            style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: pictogram === p ? colors.ink : colors.surface, borderWidth: 1.2, borderColor: pictogram === p ? colors.ink : colors.border, alignItems: 'center', justifyContent: 'center' }}
          >
            <Pictogram name={p} size={24} color={pictogram === p ? colors.white : colors.ink} />
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
        {accents.map((a, i) => (
          <Pressable
            key={a.bg}
            onPress={() => setAccentIndex(i)}
            accessibilityRole="radio"
            accessibilityState={{ selected: accentIndex === i }}
            accessibilityLabel={`Colour ${i + 1}`}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: a.bg, borderWidth: accentIndex === i ? 3 : 1, borderColor: accentIndex === i ? colors.ink : colors.border }}
          />
        ))}
      </View>

      <AppText variant="h3" style={{ marginTop: space.xl, marginBottom: space.sm }}>
        Visibility
      </AppText>
      <OptionCard title="Public" subtitle="Anyone nearby can find and join" selected={visibility === 'public'} onPress={() => setVisibility('public')} left={<Icon name="globe" size={20} color={visibility === 'public' ? colors.white : colors.ink} />} />
      <OptionCard title="Private" subtitle="People request to join; you approve" selected={visibility === 'private'} onPress={() => setVisibility('private')} left={<Icon name="lock" size={20} color={visibility === 'private' ? colors.white : colors.ink} />} />

      {CITY.areas.length > 0 && (
        <>
          <AppText variant="h3" style={{ marginTop: space.xl, marginBottom: space.sm }}>
            Home area
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {CITY.areas.map((a) => (
              <Chip key={a} label={a} selected={area === a} onPress={() => setArea(a)} />
            ))}
          </View>
        </>
      )}

      <AppText variant="h3" style={{ marginTop: space.xl, marginBottom: space.sm }}>
        Rules ({rules.length}/{MAX_RULES})
      </AppText>
      {rules.map((r, i) => (
        <View key={`${r}${i}`} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.quest, paddingLeft: space.md, paddingRight: 4, paddingVertical: 4, marginBottom: space.xs }}>
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
          right={<IconButton icon="plus" variant={rule.trim() ? 'ink' : 'surface'} size={36} accessibilityLabel="Add rule" onPress={addRule} />}
        />
      )}
      <AppText variant="caption" color={colors.muted}>
        Circles follow the IRL community guidelines. Owners can remove members; everyone can report and block.
      </AppText>
    </Screen>
  );
}
