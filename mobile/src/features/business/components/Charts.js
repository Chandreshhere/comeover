// Minimal SVG charts for the business dashboard. Values are always also
// available as text (accessibilityLabel + summary) — no colour-only meaning.
import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
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

export function BarChart({ data, labels, height = 140, color = colors.periwinkle, highlightLast = true, unit = '' }) {
  const [w, setW] = useState(0);
  const max = niceMax(Math.max(...data));
  const gap = 10;
  const barW = w ? (w - gap * (data.length - 1)) / data.length : 0;
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
            return <Rect key={i} x={i * (barW + gap)} y={plotH - h} width={barW} height={h} rx={Math.min(8, barW / 2)} fill={last ? colors.ink : color} />;
          })}
        </Svg>
      )}
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        {labels.map((l, i) => (
          <AppText key={l + i} variant="caption" color={colors.muted} align="center" style={{ width: barW, marginRight: i < labels.length - 1 ? gap : 0 }}>
            {l}
          </AppText>
        ))}
      </View>
    </View>
  );
}

// Two-series line chart (e.g. join requests vs check-ins).
export function LineChart({ series, labels, height = 150 }) {
  const [w, setW] = useState(0);
  const max = niceMax(Math.max(...series.flatMap((s) => s.data)));
  const plotH = height - 24;
  const pad = 6;
  const x = (i) => pad + (i * (w - pad * 2)) / (labels.length - 1);
  const y = (v) => plotH - pad - (v / max) * (plotH - pad * 2);
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Line chart. ${series.map((s) => `${s.name}: ${s.data.join(', ')}`).join('. ')}`}
    >
      {w > 0 && (
        <Svg width={w} height={plotH}>
          {[0.5, 1].map((t) => (
            <Line key={t} x1={0} x2={w} y1={y(max * t)} y2={y(max * t)} stroke={colors.border} strokeWidth={1} strokeDasharray="3 5" />
          ))}
          {series.map((s) => {
            const d = s.data.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ');
            return (
              <React.Fragment key={s.name}>
                <Path d={d} stroke={s.color} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '6 5' : undefined} />
                <Circle cx={x(s.data.length - 1)} cy={y(s.data[s.data.length - 1])} r={4} fill={s.color} />
              </React.Fragment>
            );
          })}
        </Svg>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        {labels.map((l, i) => (
          <AppText key={l + i} variant="caption" color={colors.muted}>
            {l}
          </AppText>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.xs }}>
        {series.map((s) => (
          <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: s.color, marginRight: 6 }} />
            <AppText variant="caption" color={colors.inkSoft}>
              {s.name}
              {s.dashed ? ' (dashed)' : ''}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

// Horizontal funnel bars with explicit percentages.
export function Funnel({ steps }) {
  const top = steps[0]?.value || 1;
  return (
    <View style={{ gap: 10 }}>
      {steps.map((s, i) => {
        const pct = Math.round((s.value / top) * 100);
        return (
          <View key={s.label} accessible accessibilityLabel={`${s.label}: ${s.value}, ${pct} percent of impressions`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
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
