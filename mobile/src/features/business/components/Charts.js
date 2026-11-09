// Minimal SVG charts for the business dashboard (bar chart + funnel). Values are always also
// available as text (accessibilityLabel + summary) — no colour-only meaning.
// Colours are read at render time so the charts follow light / dark mode.
import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { AppText } from '@/components';
import { colors, space } from '@/theme/tokens';

// Indian digit grouping (12,34,567) without depending on Intl.
export function formatCount(n) {
  const s = Math.round(n).toString();
  if (s.length <= 3) return s;
  return `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${s.slice(-3)}`;
}

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

// Axis labels centred under their x position, clamped inside the chart so the
// first / last never get clipped. Empty labels are skipped (sparse 30-day axis).
const LABEL_W = 44;
function AxisLabels({ labels, xAt, width }) {
  return (
    <View style={{ height: 16, marginTop: 6 }}>
      {labels.map((l, i) =>
        l ? (
          <AppText
            key={l + i}
            variant="caption"
            color={colors.muted}
            align="center"
            numberOfLines={1}
            maxScale={1.2}
            style={{ position: 'absolute', width: LABEL_W, left: Math.max(0, Math.min(width - LABEL_W, xAt(i) - LABEL_W / 2)) }}
          >
            {l}
          </AppText>
        ) : null
      )}
    </View>
  );
}

export function BarChart({ data, labels, height = 140, color, highlightLast = true, unit = '' }) {
  const [w, setW] = useState(0);
  const fill = color || colors.periwinkle;
  const max = niceMax(Math.max(0, ...data));
  const n = Math.max(1, data.length);
  // Gaps shrink with more bars so 30 days still fit a 320pt phone.
  const gap = w ? Math.min(10, (w * 0.4) / n) : 0;
  const barW = w ? Math.max(2, (w - gap * (n - 1)) / n) : 0;
  const plotH = height - 22;
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Bar chart. ${labels.map((l, i) => `${l}: ${data[i]}${unit}`).join(', ')}`}
    >
      {w > 0 && (
        <Svg width={w} height={plotH}>
          {[0.5, 1].map((t) => (
            <Line key={t} x1={0} x2={w} y1={plotH - plotH * t} y2={plotH - plotH * t} stroke={colors.border} strokeWidth={1} strokeDasharray="3 5" />
          ))}
          {data.map((v, i) => {
            const h = Math.max(4, (v / max) * (plotH - 6));
            const last = highlightLast && i === data.length - 1;
            return <Rect key={i} x={i * (barW + gap)} y={plotH - h} width={barW} height={h} rx={Math.min(8, barW / 2)} fill={last ? colors.ink : fill} />;
          })}
        </Svg>
      )}
      {w > 0 && <AxisLabels labels={labels} width={w} xAt={(i) => i * (barW + gap) + barW / 2} />}
    </View>
  );
}

// Horizontal funnel bars with explicit percentages.
export function Funnel({ steps }) {
  const top = steps[0]?.value || 1;
  return (
    <View style={{ gap: space.sm }}>
      {steps.map((s, i) => {
        const pct = Math.round((s.value / top) * 100);
        return (
          <View key={s.label} accessible accessibilityLabel={`${s.label}: ${s.value}, ${pct} percent of impressions`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xxs }}>
              <AppText variant="label">{s.label}</AppText>
              <AppText variant="label" color={colors.inkSoft}>
                {formatCount(s.value)} {i > 0 ? `· ${pct}%` : ''}
              </AppText>
            </View>
            <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.track, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(2, pct)}%`, height: 10, borderRadius: 5, backgroundColor: i === steps.length - 1 ? colors.ink : colors.periwinkle }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}
