// "Mo", the Come Over guide: the same artwork as the app icon and the mobile
// app (white body, lavender outline, sprout on top). Solid colours only.
// pose: 'wave' (one arm up, default) or 'cheer' (both arms up).
const OUTLINE = '#C9D2FF';
const INK = '#1D2142';

function Arm({ side, up }) {
  // Drawn hanging down; rotated about the shoulder when raised.
  const left = side === 'left';
  const transform = up ? (left ? 'rotate(102 52 116)' : 'rotate(-102 148 116)') : undefined;
  const d = left
    ? 'M45.29 110.78 L25.87 139.01 A6.5 6.5 0 0 0 36.13 146.99 L58.71 121.22 A8.5 8.5 0 0 0 45.29 110.78 Z'
    : 'M141.29 121.22 L163.87 146.99 A6.5 6.5 0 0 0 174.13 139.01 L154.71 110.78 A8.5 8.5 0 0 0 141.29 121.22 Z';
  const wrist = left ? [38.02, 147.82] : [161.98, 147.82];
  const hand = left ? [29.16, 145.37] : [170.84, 145.37];
  return (
    <g transform={transform}>
      <path d={d} fill="#FFFFFF" stroke={OUTLINE} strokeWidth="3" strokeLinejoin="round" />
      <circle cx={wrist[0]} cy={wrist[1]} r="4.6" fill="#FFFFFF" stroke={OUTLINE} strokeWidth="3" />
      <circle cx={hand[0]} cy={hand[1]} r="9.5" fill="#FFFFFF" stroke={OUTLINE} strokeWidth="3" />
      <circle cx={hand[0]} cy={hand[1]} r="8" fill="#FFFFFF" />
    </g>
  );
}

export default function Mascot({ size = 120, pose = 'wave', shadow = true, style }) {
  const cheer = pose === 'cheer';
  return (
    <svg width={size} height={Math.round((size * 194) / 172)} viewBox="14 6 172 194" aria-hidden="true" style={{ display: 'block', flex: 'none', ...style }}>
      {shadow ? <ellipse cx="100" cy="190" rx="46" ry="6" fill="#1B2A6B" opacity="0.14" /> : null}
      <path d="M100 50 C99 40 101 32 104 26" stroke="#3FAF76" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <path d="M103 28 C93 17 80 20 77 29 C87 36 97 35 103 28 Z" fill="#3FAF76" />
      <path d="M104 27 C110 13 124 11 131 17 C125 28 113 32 104 27 Z" fill="#63CF95" />
      <Arm side="left" up={cheer} />
      <Arm side="right" up />
      <ellipse cx="76" cy="179" rx="15" ry="8.5" fill={OUTLINE} />
      <ellipse cx="124" cy="179" rx="15" ry="8.5" fill={OUTLINE} />
      <path d="M100 44 C140 44 162 80 163 120 C164 158 138 181 100 181 C62 181 36 158 37 120 C38 80 60 44 100 44 Z" fill="#FFFFFF" stroke={OUTLINE} strokeWidth="3.5" strokeLinejoin="round" />
      <ellipse cx="63" cy="121" rx="9" ry="5.5" fill="#FFA9C6" />
      <ellipse cx="137" cy="121" rx="9" ry="5.5" fill="#FFA9C6" />
      <path d="M71 79 Q79 74.5 87 78" stroke={INK} strokeWidth="3.6" strokeLinecap="round" fill="none" />
      <path d="M113 78 Q121 74.5 129 79" stroke={INK} strokeWidth="3.6" strokeLinecap="round" fill="none" />
      <ellipse cx="80" cy="101" rx="9" ry="9.5" fill={INK} />
      <ellipse cx="120" cy="101" rx="9" ry="9.5" fill={INK} />
      <circle cx="76.5" cy="96.5" r="3.4" fill="#FFFFFF" />
      <circle cx="116.5" cy="96.5" r="3.4" fill="#FFFFFF" />
      <circle cx="83.5" cy="104.5" r="1.6" fill="#FFFFFF" />
      <circle cx="123.5" cy="104.5" r="1.6" fill="#FFFFFF" />
      <path d="M89 121 Q100 132 111 121" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />
    </svg>
  );
}
