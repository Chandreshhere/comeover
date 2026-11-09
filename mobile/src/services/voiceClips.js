// Mo's recorded lines (src/assets/voice). When Mo says one of these exact
// lines, the recording plays instead of the phone's text-to-speech voice, so he
// sounds the same, friendly and a bit cartoonish, on every device.
//
// Voice: ElevenLabs "Charlie" (energetic) on the expressive v3 model with
// emotion tags per beat ([excited], [playfully], [giggles]…), pitched up ~5
// semitones (ffmpeg asetrate 1.33 + atempo 0.8) into Mo's cartoon voice.
// After replacing any file, run `node scripts/voice-envelopes.js` so the
// lip sync matches. If a line's text changes in the app, update it here too
// or that line falls back to the phone's text-to-speech.
/* eslint-disable global-require */
const CLIPS = {
  "Hi, I'm Mo! Come Over helps you find people for real plans nearby.": { asset: require('../assets/voice/mo_intro1.m4a'), key: 'mo_intro1' },
  "Pick a plan, host it or ask to join. Once you're in, chat opens. Then meet up!": { asset: require('../assets/voice/mo_intro2.m4a'), key: 'mo_intro2' },
  "Exact spots stay private until you're in. And real meetups earn you XP!": { asset: require('../assets/voice/mo_intro3.m4a'), key: 'mo_intro3' },
  'This is Discover: real plans happening near you, today and this week.': { asset: require('../assets/voice/mo_tour1.m4a'), key: 'mo_tour1' },
  'Search chai, badminton or people. Not sure what to do? Ask the plan assistant.': { asset: require('../assets/voice/mo_tour2.m4a'), key: 'mo_tour2' },
  'Free right now? Tap here, and plans nearby can find you.': { asset: require('../assets/voice/mo_status.m4a'), key: 'mo_status' },
  'This is a plan. Tap it for the details, then tap Request to join in!': { asset: require('../assets/voice/mo_featured.m4a'), key: 'mo_featured' },
  'Your chats open here once you join a plan. The bell keeps you posted.': { asset: require('../assets/voice/mo_chats.m4a'), key: 'mo_chats' },
  "Live shows who's free right now nearby. Perfect for last-minute plans.": { asset: require('../assets/voice/mo_tour3.m4a'), key: 'mo_tour3' },
  'Tap the plus to host a plan in about 30 seconds. You approve who joins.': { asset: require('../assets/voice/mo_tour4.m4a'), key: 'mo_tour4' },
  'Circles are recurring groups, like a Sunday run club or a weekly board-game night.': { asset: require('../assets/voice/mo_tour5.m4a'), key: 'mo_tour5' },
  'Your progress, quests, settings and premium live in Profile. Have fun out there!': { asset: require('../assets/voice/mo_tour6.m4a'), key: 'mo_tour6' },
};

// → { asset, key } (key = file name, used for the lip-sync envelope) or null
export const clipFor = (text) => CLIPS[String(text || '').trim()] || null;
