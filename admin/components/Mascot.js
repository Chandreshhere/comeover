// "Mo", the Project IRL mascot (same original artwork as the mobile app).
export default function Mascot({ size = 120, pose = 'stride' }) {
  const front = pose === 'cheer' ? 'M156 96 C170 82 176 64 178 46' : 'M156 100 C176 92 186 76 192 62';
  const fh = pose === 'cheer' ? [179, 41] : [194, 58];
  const back = pose === 'cheer' ? 'M80 96 C66 82 60 66 58 50' : 'M78 104 C62 112 50 124 40 128';
  const bh = pose === 'cheer' ? [57, 45] : [36, 130];
  return (
    <svg width={size} height={(size * 200) / 220} viewBox="0 0 220 200" aria-hidden="true">
      <g stroke="#090A0E" strokeWidth="3" strokeLinecap="round" opacity="0.55">
        <path d="M22 78 L36 78" />
        <path d="M12 94 L32 94" />
        <path d="M18 110 L30 110" />
      </g>
      <path d="M96 142 C84 158 66 166 46 164" stroke="#090A0E" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M30 158 C40 152 52 156 54 164 C54 170 46 172 38 172 L28 172 C24 172 22 166 26 162 Z" fill="#090A0E" />
      <path d={back} stroke="#090A0E" strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx={bh[0]} cy={bh[1]} r="7" fill="#fff" stroke="#090A0E" strokeWidth="4" />
      <path d="M70 92 C66 52 98 30 128 36 C160 42 172 74 166 104 C160 134 132 150 104 146 C80 142 72 120 70 92 Z" fill="#fff" stroke="#090A0E" strokeWidth="4" />
      <path d="M122 37 C120 24 126 14 136 10" stroke="#090A0E" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M136 10 C146 2 160 6 162 15 C151 21 142 19 136 10 Z" fill="#F0A34B" stroke="#090A0E" strokeWidth="2.5" />
      <circle cx="112" cy="96" r="6" fill="#E6A2F2" />
      <circle cx="158" cy="98" r="6" fill="#E6A2F2" />
      <ellipse cx="126" cy="80" rx="5" ry="7" fill="#090A0E" />
      <ellipse cx="148" cy="82" rx="5" ry="7" fill="#090A0E" />
      <path d="M126 99 C132 108 143 108 149 100" stroke="#090A0E" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M134 142 C142 160 156 172 172 175" stroke="#090A0E" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M168 166 C180 162 196 166 198 177 C198 184 190 186 180 186 L168 186 C163 186 161 180 164 173 Z" fill="#090A0E" />
      <path d={front} stroke="#090A0E" strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx={fh[0]} cy={fh[1]} r="7" fill="#fff" stroke="#090A0E" strokeWidth="4" />
    </svg>
  );
}
