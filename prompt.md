# PROJECT IRL — MASTER PRODUCT & DEVELOPMENT PROMPT

Act as a world-class product designer, senior mobile application architect, React Native engineer, UX researcher and startup product strategist.

Your task is to design and build a production-ready, highly animated, Gen-Z-focused social activity discovery platform.

The working product name is PROJECT IRL.

The platform helps people discover other people who want to participate in the same real-world activities at the same time and location.

This is NOT a dating app.
This is NOT a paid companionship platform.
This is NOT a traditional social media application.

It is a peer-to-peer, real-time activity discovery network.

CORE POSITIONING:

"Less scrolling. More living."

"Find someone for whatever you're doing."

---

# 1. FIRST: STUDY THE PROVIDED FILES

Before writing code, inspect the following resources:

- reference_image_user_supplied.jpg
- 01_reference_ui_mapping.json
- 02_design_tokens.json
- 03_screen_inventory.json
- 04_motion_system.json
- 05_monetization_model.json
- 06_ui_generation_prompt.json
- 07_postgres_schema.sql
- 08_api_contract.json
- 09_implementation_backlog.csv
- 11_Product_Research_and_Implementation_Blueprint.docx

Treat these documents as the initial product specification.

Do not ignore the reference image.

Do not arbitrarily redesign the visual direction.

First understand the complete application architecture, screen inventory, design system and user journeys.

---

# 2. VISUAL DESIGN — FOLLOW THE REFERENCE

The uploaded reference image is the primary visual direction.

Recreate its visual language as closely as possible while adapting its components to Project IRL.

DESIGN CHARACTERISTICS:

- Soft periwinkle and lavender backgrounds.
- Rounded mobile device-like cards.
- Large playful typography.
- Black pill-shaped buttons.
- White floating cards.
- Pastel accent colours.
- Illustrated characters.
- Minimal iconography.
- Large visual elements.
- Subtle gradients.
- Friendly interface.
- Clean spacing.
- Modern Gen-Z aesthetic.

DESIGN TOKENS:

Use the provided design_tokens.json as the initial source of truth.

Maintain consistent:
- Typography.
- Border radius.
- Spacing.
- Shadows.
- Colours.
- Icon sizes.
- Button dimensions.
- Component behaviour.
- Animation timings.

Do not use generic dashboard templates.

Do not make every screen look like a conventional social networking application.

The result should look like a carefully art-directed consumer product.

Create original illustrations, icons and mascot assets. Do not copy another company's protected characters, logos or brand identity.

---

# 3. THREE MAIN VISUAL ANCHORS

The first three primary screens must establish the product identity.

SCREEN A — SOCIAL ROADMAP

Follow the leftmost reference screen.

Adapt it into a personal social progression roadmap.

Display:
- Social journey.
- Current level.
- Completed activities.
- Upcoming challenges.
- Daily progress.
- Weekly streak.
- Achievements.
- Activity categories.
- Unlockable milestones.

SCREEN B — DISCOVER / HOME

Follow the middle reference screen.

Display:
- Personal greeting.
- Profile avatar.
- Notification button.
- Search.
- Live activities.
- Nearby people.
- Activity categories.
- Featured activity cards.
- Available groups.
- Quick join buttons.

SCREEN C — IRL GUIDE

Follow the rightmost reference screen.

Create an intelligent activity discovery assistant.

Users can ask:
- What can I do nearby?
- Find someone for chai.
- I have 20 minutes free.
- Find a gym partner.
- Suggest something for tonight.
- Find a group for badminton.
- Help me organise a weekend plan.

Display contextual recommendations, activity cards and social roadmap information.

These three screens must establish the complete design language for the rest of the application.

---

# 4. APPLICATION ARCHITECTURE

Build using:

MOBILE:
- React Native.
- Expo.
- JavaScript.
- Expo Router.
- Reusable component architecture.

ANIMATION:
- React Native Reanimated.
- Gesture Handler.
- Lottie where appropriate.
- Rive for interactive mascot animations where appropriate.

BACKEND:
Follow the architecture documented in the implementation blueprint and database schema.

Use PostgreSQL for relational application data.

Use appropriate cloud infrastructure for:
- Authentication.
- User profiles.
- Activities.
- Matching.
- Real-time messaging.
- Notifications.
- File storage.
- Analytics.
- Moderation.

Use the existing AWS infrastructure where appropriate.

Do not introduce multiple services that duplicate the same functionality.

MAPS:
- Google Maps or an equivalent supported map provider.
- Location permissions.
- Nearby activity discovery.
- Configurable geographic radius.

PAYMENTS:
- Use an appropriate Indian payment provider.
- Support eligible UPI payment flows.
- Support Apple and Google in-app purchases for digital subscriptions.
- Do not implement an unlicensed wallet or hold customer funds without the required regulatory arrangements.

---

# 5. COMPLETE APPLICATION MODULES

Implement the screens listed in the supplied screen inventory.

The following modules define the product.

A. AUTHENTICATION
- Welcome.
- Registration.
- Login.
- OTP verification.
- Interest selection.
- Profile creation.
- Location permissions.
- Availability preferences.
- Onboarding roadmap.

B. DISCOVER
- Personalised home.
- Activity feed.
- Nearby activities.
- Categories.
- Search.
- Filters.
- Activity details.
- Quick join.
- Suggested people.
- Trending activities.

C. LIVE ACTIVITY RADAR
- Nearby activity radar.
- Live map.
- Available-now status.
- Activity pins.
- Distance filters.
- List/map toggle.
- Availability indicators