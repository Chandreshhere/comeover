import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, AvatarStack, Pictogram, Segmented } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import { weekdayShort, monthShort } from '@/utils/format';

const ROW_H = 40;

// Compact Gantt-style roadmap preview (reference: right phone, bottom).
// Rows are quests and accepted plans placed across the visible days.
export default function RoadmapTimeline({ items, onPressItem }) {
  const [range, setRange] = useState('week');
  const [w, setW] = useState(0);
  const cols = 5;
  const today = new Date();

  const labels = useMemo(() => {
    if (range === 'day') return ['9a', '12p', '3p', '6p', '9p'];
    if (range === 'month') {
      return Array.from({ length: cols }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() + (i - 2) * 7);
        return `${d.getDate()} ${monthShort[d.getMonth()]}`;
      });
    }
    return Array.from({ length: cols }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i - 2);
      return weekdayShort[d.getDay()];
    });
  }, [range]);

  const colW = w / cols;
  const placed = items.slice(0, 4).map((it, row) => {
    // Items carry day offsets (-2..+2) relative to today for the week view.
    const scale = range === 'month' ? 1 / 7 : range === 'day' ? 0 : 1;
    let start = 2 + it.startOffset * scale;
    let span = Math.max(range === 'day' ? 1.2 : 1, it.span * (range === 'month' ? 0.6 : 1));
    if (range === 'day') start = Math.max(0, Math.min(cols - 1.2, (it.hour - 9) / 3));
    start = Math.max(0, Math.min(cols - span, start));
    return { ...it, row, left: start * colW + 2, width: span * colW - 4 };
  });

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="h3">Roadmap</AppText>
        <Segmented compact options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} value={range} onChange={setRange} style={{ width: 190 }} />
      </View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: placed.length * (ROW_H + 8) + 44, marginTop: space.md }}>
        {w > 0 && (
          <>
            {/* today line */}
            <View style={{ position: 'absolute', left: colW * 2.5, top: 0, bottom: 22, width: 2, backgroundColor: colors.ink }} />
            <View style={{ position: 'absolute', left: colW * 2.5 - 24, top: -6, backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
              <AppText variant="caption" color={colors.white}>
                Today
              </AppText>
            </View>
            {placed.map((it) => (
              <Pressable
                key={it.id}
                accessibilityRole="button"
                accessibilityLabel={`${it.title}, ${it.status}`}
                onPress={() => onPressItem?.(it)}
                style={{
                  position: 'absolute',
                  top: 18 + it.row * (ROW_H + 8),
                  left: it.left,
                  width: it.width,
                  height: ROW_H,
                  borderRadius: radius.pill,
                  backgroundColor: it.status === 'active' ? colors.orange : it.status === 'done' ? colors.surface : colors.periwinkleWash,
                  borderWidth: 1.2,
                  borderColor: it.status === 'done' ? colors.border : it.status === 'active' ? colors.orange : colors.periwinkle,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingLeft: 4,
                  paddingRight: 8,
                  overflow: 'hidden',
                }}
              >
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                  <Pictogram name={it.status === 'done' ? 'check' : it.pictogram} size={16} color={colors.white} strokeWidth={it.status === 'done' ? 3 : 2} />
                </View>
                <AppText variant="label" numberOfLines={1} style={{ marginLeft: 6, flex: 1 }}>
                  {it.title}
                </AppText>
                {it.people?.length ? <AvatarStack seeds={it.people} size={22} max={3} ringColor={it.status === 'active' ? colors.orange : colors.white} /> : null}
              </Pressable>
            ))}
            {/* day labels */}
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row' }}>
              {labels.map((l, i) => (
                <AppText key={l + i} variant="caption" color={i === 2 ? colors.ink : colors.muted} align="center" style={{ width: colW, fontFamily: i === 2 ? 'Poppins-Bold' : undefined }}>
                  {l}
                </AppText>
              ))}
            </View>
          </>
        )}
      </View>
    </View>
  );
}
