# Project IRL — mobile (React Native CLI)

"Less scrolling. More living." A platonic, activity-first network for finding people to do real things with, nearby, soon.

- **Stack:** React Native 0.76.5 (CLI, New Architecture), JavaScript, React Navigation 7, Reanimated 3, Gesture Handler, react-native-svg, zustand + AsyncStorage.
- **Status:** Every inventory screen in `03_screen_inventory.json` is registered as a route and deep link. The app has **no mock or demo mode**: it talks only to the deployed backend (`../backend`) and real third-party services.

## Real services used

| Concern | Service | Client code |
|---|---|---|
| Sign-in (phone OTP) | [Slide](https://slide.synquic.com) OTP over WhatsApp or SMS, called by the API (the Slide key stays on the server). The API issues its own JWT access tokens and rotating refresh tokens. | `src/api/auth.js`, tokens in Keychain/Keystore via `react-native-keychain` (`src/api/session.js`) |
| REST API | Node.js + Express + MongoDB (`../backend`) | `src/api/client.js`, `src/api/endpoints.js` |
| Realtime | WebSocket on the same server (`wss://<host>/ws`; `activity:`, `conversation:`, `user:` channels) | `src/services/realtime.js` |
| Push | Firebase Cloud Messaging (APNs via FCM on iOS) | `src/services/push.js` |
| Maps | Google Maps SDK (Android) / Apple Maps (iOS) via `react-native-maps` | discover map, live radar |
| Location | Device GPS, rounded to ~1 km before leaving the device | `src/services/location.js` |
| Media | S3 presigned PUT (avatars, bills, venue proofs) | `src/services/upload.js` |
| Subscriptions | StoreKit / Google Play Billing via `react-native-iap` 12, server receipt verification | `src/services/billing.js` |
| Venue/Club plans | Razorpay Checkout (order created server-side, signed webhook confirms) | `src/services/razorpay.js` |
| IRL Guide | `POST /assistant/suggest` (Claude API on the backend, grounded on real nearby plans) | `src/api/assistant.js` |
| UPI settlement | Hand-off to the user's UPI app (`upi://pay`). No custody. | SplitMate |

## Run it

Prerequisites: Node ≥ 18, JDK 17 and the Android SDK (Android), or Xcode 15+ with CocoaPods (iOS, macOS only). The API must be running first (see `../backend/README.md`; `docker compose up` locally).

```bash
cd mobile
npm install

# 1. Point the app at your API (writes src/config.env.json; WS_URL defaults to wss://<host>/ws)
npm run configure -- --api https://api.your-domain.com/v1
#    Android emulator against a local API: npm run configure -- --api http://10.0.2.2:8080/v1

# 2. Google Maps key (Android)
echo MAPS_API_KEY=your_key >> android/local.properties

# 3. Push (optional): add Firebase config files, then rebuild
#    android/app/google-services.json, ios/ProjectIRL/GoogleService-Info.plist (add to the Xcode target)

npm run android
# iOS (macOS)
bundle install && npm run pods && npm run ios
```

Without `src/config.env.json` values the app shows a "Connect a backend" screen. There's no offline demo.

### One-time store and console setup

- **App Store Connect / Play Console:** create the auto-renewing subscriptions `irl_plus_monthly` and `irl_pro_monthly` (ids are configurable in `config.env.json → IAP_PRODUCTS`). Add sandbox testers.
- **Xcode → Signing & Capabilities:** add Push Notifications, Background Modes → Remote notifications, and In-App Purchase.
- **Firebase:** upload the APNs auth key so FCM can deliver to iOS.
- **Razorpay:** keys live only on the backend. The app receives the public key id with each order.

## Checks

```bash
npm test                     # unit tests (privacy formatting, taxonomy, id mapping, JWT, split maths)
npm run lint
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/irl.bundle
```

## Structure

```
src/
  theme/tokens.js        ← 02_design_tokens.json (colours, type, spacing, radii, elevation)
  theme/motion.js        ← 04_motion_system.json (durations, spring, reduced-motion aware entrances)
  illustrations/         original SVG assets: Mo the mascot, activity pictograms, avatars, guide orb
  components/            shared library (Button, Chip, Card/HeroCard, QuestRow, WeekStrip, ActivityCard,
                         JoinButton, Sheet, Segmented, TextField/ListRow, Empty/Error/Skeleton states…)
  navigation/            inventory.js (screen ids ↔ deep-link paths), registry, tab bar, root stack
  store/useAppStore.js   single zustand store; every action calls the API (load* actions track
                         status/errors for loading, empty and error UI)
  api/                   OTP auth (Slide via API), session/refresh, REST client (Bearer + Idempotency-Key), endpoints
  services/              realtime, push, billing, razorpay, upload, location
  data/catalog.js        server taxonomy (categories, levels, city areas) with an offline fallback;
                         personById backed by the store's user cache
  hooks/useLoader.js     load-on-focus helper used by every data screen
  features/<module>/     screens per module; each index.js maps inventory ids → components
```

Screens that aren't built yet fall back to a placeholder automatically, so every route stays navigable.

## The three anchor screens

| Reference phone | Screen id | File |
|---|---|---|
| Left: learning roadmap | `social_roadmap` | `src/features/progress/SocialRoadmapScreen.js` |
| Middle: course dashboard | `discover_home` (tab) | `src/features/discover/DiscoverHomeScreen.js` |
| Right: AI assistant | `plan_assistant` | `src/features/assistant/PlanAssistantScreen.js` |

## Product rules enforced in the client (and required server-side)

- Only coarse distances and areas are shown for other users (`utils/format.coarseDistance`). The exact venue is revealed only after a join is accepted.
- 18+ gate before joining or publishing (`hooks/useQuickJoin`).
- Group chat opens only after an accepted join. Report and block are reachable from every person, plan and chat surface, and are never paywalled.
- XP comes only from mutually confirmed completion, deduplicated per activity. There's no XP for swipes or messages. Rest days and a streak freeze are included.
- SplitMate is a ledger plus a UPI app handoff (`upi://pay`). No wallet, no custody, and user-marked payments are never treated as bank-confirmed.
- Motion respects the OS Reduce Motion setting. Sound is off by default and haptics are optional.

## Native configuration already applied

- **Android:** location, camera, notification and vibrate permissions; `<queries>` for UPI, dialer and SMS; `projectirl://` deep links; Maps key placeholder; Feather font via `fonts.gradle`; react-native-screens `onCreate`.
- **iOS:** usage descriptions, `UIAppFonts` (Poppins and Feather), `LSApplicationQueriesSchemes` (upi, tel, sms), URL scheme, `RCTLinkingManager` handlers, react-native-permissions `setup_permissions`.

## Version notes

The project is pinned to React Native 0.76.5. The native SDKs are pinned to the last releases that support it: react-native-iap 12.16 (13+ needs Nitro), react-native-keychain 9.2 (11 needs RN 0.82), and @react-native-firebase 21.14. Upgrade them together with React Native.
