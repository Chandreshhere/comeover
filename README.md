# Project IRL

**Less scrolling. More living.** Project IRL is a platonic, activity-first network for finding people to do real things with, nearby, soon. It isn't a dating app, a paid-companion marketplace or a social feed.

| Folder | What it is | Stack |
|---|---|---|
| [`mobile/`](mobile/README.md) | iOS and Android app (77 screens from the screen inventory) | React Native 0.76 CLI, JavaScript, React Navigation, Reanimated, zustand |
| [`backend/`](backend/README.md) | API, auth, realtime and jobs | Node.js + Express + MongoDB (Mongoose), WebSocket (`ws`), phone OTP via [Slide](https://slide.synquic.com), S3-compatible storage, Docker |
| [`admin/`](admin/README.md) | Moderation and operations console | Next.js (App Router), phone OTP sign-in with server-assigned roles |

The product spec lives in the root `0x_*.json`/`.sql`/`.csv` files, `11_Product_Research_and_Implementation_Blueprint.docx` and `prompt.md`.

## Getting started

1. **Backend:** `cd backend && cp .env.example .env` (MongoDB, Slide OTP widget and key, JWT secret…), then `docker compose up -d`, `npm run seed`, and `npm run grant-role -- <your phone> admin` (`backend/README.md`).
2. **Mobile:** `cd mobile && npm install && npm run configure -- --api https://<api-host>/v1`, then `npm run android` or `npm run ios`.
3. **Admin:** copy `admin/.env.example` to `.env.local`, set `NEXT_PUBLIC_API_URL`, then `npm install && npm run dev`.

Every client talks only to real services. There are no mock or demo modes.

## Principles carried through the code

- Other users only ever see coarse areas and distances. The exact venue is revealed after a join is accepted.
- The app is 18+. Host approval is the default, and chat opens only after a join is accepted.
- Report and block are reachable everywhere and are never paywalled.
- XP is awarded only for mutually verified meetups, server-side and idempotently, with a daily cap.
- SplitMate is a ledger plus a hand-off to the user's UPI app. There is no wallet and no custody of money.
- Digital subscriptions go through App Store / Play billing. Venue plans go through Razorpay with a signed webhook.
- Original art throughout: the mascot, pictograms and avatars are all hand-made SVG.
