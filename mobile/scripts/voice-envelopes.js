// Builds src/services/voiceEnvelopes.json: a loudness envelope (25 values per
// second, 0..1) for each of Mo's recorded lines in src/assets/voice, used to
// lip-sync his mouth to the audio. Re-run after replacing any voice file:
//   node scripts/voice-envelopes.js        (needs ffmpeg on PATH)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'assets', 'voice');
const OUT = path.join(__dirname, '..', 'src', 'services', 'voiceEnvelopes.json');
const RATE = 8000;
const FPS = 25;
const WIN = RATE / FPS;

const out = {};
for (const f of fs.readdirSync(DIR).filter((n) => /^mo_.*\.m4a$/.test(n))) {
  const pcm = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', path.join(DIR, f), '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const n = Math.floor(pcm.length / 2);
  const db = [];
  for (let i = 0; i < n; i += WIN) {
    let sum = 0;
    let c = 0;
    for (let j = i; j < Math.min(n, i + WIN); j++) {
      const v = pcm.readInt16LE(j * 2) / 32768;
      sum += v * v;
      c++;
    }
    db.push(20 * Math.log10(Math.sqrt(sum / Math.max(1, c)) + 1e-6));
  }
  const sorted = [...db].sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * 0.95)] || -10;
  const floor = Math.max(-50, peak - 30);
  let level = 0;
  const env = db.map((d) => {
    const target = Math.max(0, Math.min(1, (d - floor) / (peak - floor))) ** 1.4;
    level += (target - level) * (target > level ? 0.7 : 0.45); // fast open, softer close
    return Math.round(level * 100) / 100;
  });
  out[f.replace(/\.m4a$/, '')] = { fps: FPS, env };
}
fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log('wrote', Object.keys(out).length, 'envelopes to', path.relative(process.cwd(), OUT));
