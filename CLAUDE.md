# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

This repo contains **two independent products** under one directory:

| Product | Location | Stack |
|---|---|---|
| **CryptoGuideCenter** | `Final code/` | WordPress custom theme (PHP) |
| **Spin & Win** | `spinandwin-backend/`, `src/` (mobile), `spinandwin-contracts/`, `spinandwin-mobile/` | Node/TypeScript backend, React Native mobile app |

There is also a standalone `robinhoodedu/` HTML project and a `blog/` folder containing `.docx` source files for page content.

---

## CryptoGuideCenter WordPress Theme

**Theme directory:** `Final code/`  
**Text domain:** `cryptoguidecenter`  
**Active version:** `1.0.5` (bump in `functions.php` `cgc_enqueue_assets` when changing CSS/JS)

### File roles

- `style.css` — Theme metadata header + all CSS. CSS variables defined in `:root` use a fintech dark palette (`--bg-primary: #0A192F`, `--accent: #00D4FF`).
- `functions.php` — Enqueue assets, fallback nav (dropdown with Wallet Hub sub-pages), async Google Fonts, theme setup.
- `header.php` — `<head>` with dns-prefetch/preload tags, desktop nav, mobile hamburger menu (5 Wallet Hub sub-links).
- `footer.php`, `index.php`, `page.php` — Standard WordPress template hierarchy files.
- `front-page.php` — Homepage with DeFi Wallets section and Hardware Wallets section (wallet cards).
- `page-{slug}.php` — One file per support page template.
- `js/main.js` — Theme JavaScript (footer-loaded, deferred).
- `images/` — All images referenced by templates must be placed here as local files.

### Page templates

Each `page-{slug}.php` starts with:
```php
<?php /* Template Name: <Human Readable Name> */ get_header(); ?>
```

All templates follow this content structure:
1. `.page-hero` with `.page-hero-img` (local image) + `.page-hero-overlay` + H1
2. `.blog-intro-grid` (two columns: text + image)
3. `.support-table-wrap` / `.support-table` (issues table)
4. `.step-card` workflow or `.grid-2`/`.grid-3` pillar sections
5. `.notice-box .notice-warning` or `.notice-box .notice-info` for callouts
6. `.faq-list` with Schema.org FAQPage markup
7. `.cta-band` with `.cta-btns`
8. `.trust-strip` social proof row

### WordPress conventions enforced in this theme

- Images: always `<?php echo esc_url( get_template_directory_uri() ); ?>/images/filename.ext` — never external URLs.
- Links: always `<?php echo esc_url( home_url( '/slug/' ) ); ?>`.
- Strings: `esc_html_e( 'Text', 'cryptoguidecenter' )` and `esc_attr_e()` for i18n.
- Google Fonts are **non-blocking**: loaded via `cgc_async_fonts()` (`wp_head` priority 2) using `rel="preload" as="style" onload` pattern — do NOT switch back to `wp_enqueue_style` for fonts.
- Main stylesheet has `rel="preload"` tag in `header.php` for speed (in addition to WordPress enqueue).

### Wallet Hub pages (nav + mobile menu already wired)

| Slug | Template file |
|---|---|
| `/ledger-hardware-wallet-technical-support/` | `page-ledger-hardware-wallet-technical-support.php` |
| `/trezor-hardware-wallet-technical-support/` | `page-trezor-hardware-wallet-technical-support.php` |
| `/metamask-extension-technical-support/` | `page-metamask-extension-technical-support.php` |
| `/trust-wallet-technical-support/` | `page-trust-wallet-technical-support.php` |
| `/coinbase-wallet-technical-support/` | `page-coinbase-wallet-technical-support.php` |

After adding a new template file, create the WordPress page in Admin → Pages with the matching slug and assign the template under Page Attributes.

---

## Spin & Win Backend

**Location:** `spinandwin-backend/`  
**Runtime:** Node.js + TypeScript, Fastify framework  
**Start:** `cd spinandwin-backend && npm run dev` (or `npm start` for prod)  
**Type check:** `npm run typecheck` (tsc --noEmit)

### Required environment variables (server will exit on missing)

```
JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY,
UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN,
FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,
ALCHEMY_API_KEY, POLYGON_CONTRACT_ADDRESS, FRONTEND_URL
```

### Architecture

```
server.ts
├── Fastify + fastifyHelmet / fastifyCors / fastifyRateLimit / fastifyJwt
├── Socket.IO attached to raw HTTP server (not Fastify's adapter)
├── Routes: /api/v1/auth  /api/v1/games  /api/v1/wallet  /api/v1/admin
└── Agent system (src/agents/) — 5 background agents
```

**Data layer:**
- **Supabase** — persistent storage (users, game_sessions, game_spins, rooms, matches, rewards, fairness_audits)
- **Upstash Redis** — session state, provably-fair seeds, matchmaking queue, pub/sub for real-time events. Uses REST client (`@upstash/redis`), not ioredis — rate-limit counters are in-memory only.
- **Firebase Admin** — push notifications

**Blockchain:** Polygon network via Alchemy. `blockchainService.ts` wraps an ethers.js `JsonRpcProvider` singleton. Production = `polygon-mainnet`, development = `polygon-amoy`. Contract ABI is inline-minimal (only called functions).

**Provably fair RNG:** `HMAC-SHA256(serverSeed, clientSeed + ":" + nonce)` → weighted wheel segment index. Server seed revealed after spin for client verification.

**Wheel:** 12 segments, total weight 1000, RTP ≈ 92%. Configuration is the `WHEEL` const in `routes/games.ts`.

**Rooms:** 9 tiers (`[5, 25, 50, 100, 200, 500, 1000, 5000, 10000]` USD), minimum 5 players before spinning unlocks. Prize pool split 30% house / 70% distributed.

### Agent system (`src/agents/`)

Five autonomous agents managed by `AgentManager` (`agents/index.ts`):

| Agent | Loop interval | Purpose |
|---|---|---|
| `GameLogicAgent` | on-demand | Provably fair spin processing |
| `MatchmakingAgent` | 5s | Player queue grouping |
| `RewardDistributionAgent` | 10s | On-chain payout queue |
| `FairnessMonitoringAgent` | 60s | Anomaly detection + audit reports |
| `AIBotAgent` | 10s | Automated bot players (Martingale / standard strategies) |

Agents publish events via Redis pub/sub (`user:{id}:match`, `user:{id}:reward`, `alerts:suspicious_activity`). Socket.IO in `socket/gameSocket.ts` relays these to connected clients.

Agent API routes are registered separately via `routes/agentRoutes.ts` (not yet wired in `server.ts` — see `agents/README.md`).

---

## Spin & Win Mobile App

**Location:** `src/` (screens/components) + root `package.json` / `App.tsx`  
**Framework:** Expo ~51 + React Native 0.74  
**Start:** `npm start` (Expo dev server), `npm run android` / `npm run ios`  
**Type check:** `npm run typecheck`

**State management:** Zustand stores in `src/store/`:
- `authStore.ts` — user auth state
- `gameStore.ts` — session, spin result, room state, live leaderboard, jackpot history

**Services:**
- `src/services/api.ts` — REST calls to backend
- `src/services/socket.ts` — Socket.IO client (jackpot events, leaderboard)
- `src/services/firebase.ts` — Firebase push notification setup

**Key screens:** `GameScreen` (spin wheel), `RoomsScreen` (tier selection), `WalletScreen` (crypto deposit/withdraw), `FairnessScreen` (provably fair verification), `LeaderboardScreen`, `HistoryScreen`.

**Spin wheel:** Rendered with `@shopify/react-native-skia` (`SpinWheel.tsx`). Animation uses `react-native-reanimated`.

---

## Content source files

`blog/` contains `.docx` files that are the source content for WordPress page templates. When a docx exists for a page, extract its content and adapt it to the PHP template structure. If no docx exists, write original expert content matching the page topic.
