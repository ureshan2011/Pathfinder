# PathFinder

PathFinder helps Sri Lankan students discover PhD opportunities in New Zealand — compare pathways, find supervisors and scholarships, generate a personalized roadmap, walk the visa process step by step, plan the move, and track applications from first email to enrollment.

**Fully static. Zero build step. Cloud-first on Firebase (free Spark plan) — or runs 100% locally when Firebase is left unconfigured.**

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Landing page with the portal hero, feature overview, and email lead capture |
| `app.html` | The application — hash-routed SPA with nine views |

### App views (`app.html#<view>`)

- `#assessment` — 7-question pathway assessment (< 5 min) → readiness score + recommended entry route
- `#roadmap` — interactive month-by-month roadmap, personalized from the assessment, with contextual mentor hooks
- `#research` — **Research Studio**: a free, no-backend topic & proposal generator with a **New Zealand lean**. The student answers a few questions (field, topic in their own words, motivating problem, methodology, keywords), then PathFinder searches **real, recent academic literature** via free, no-key, browser-callable scholarly APIs (**OpenAlex**, with **Crossref** as a resilient fallback, then a degraded offline scaffold). It retrieves **by relevance, not just citations** (the old citation-only sort hid relevant niche work), running **two OpenAlex passes — a global one and one filtered to NZ-based authors** (`authorships.institutions.country_code:NZ`) — and reads each author's institutional affiliation straight from the API. For the *best-published NZ authors on the topic* it uses OpenAlex's native **`group_by=authorships.author.id` analytics** (an accurate ranked author facet, not a guess from a small page of papers), then blends that with the retrieved papers' authors and a **precomputed per-field NZ-author index** (top authors by total citations, shipped in the corpus index) — so leading NZ researchers surface with their campus and citation impact even from a thin result set or fully offline. It produces (1) a **literature map** — top recent papers (NZ-authored ones chipped), most-active authors (their NZ campus shown), trending sub-themes, a year histogram — plus a warm **"Research happening in New Zealand"** panel that surfaces those NZ researchers *indirectly, as the authors of the work the student is reading* (never labelled "your supervisor"), alongside the honest case for a NZ PhD (domestic fees, work rights, post-study visa) and links into Explore / the Starter Kit; **3–5 candidate research directions**; and **matched NZ research groups** from the dataset. Then (2) it expands any chosen direction into a **full structured proposal draft** (working title, abstract, background with inline citations **prioritising NZ-authored work**, research gap, research questions, methodology, indicative 3-year timeline, a "the people behind your citations — in New Zealand" section, NZ research groups, formatted references). The NZ side is anchored to a **large pre-scraped corpus of 10,000+ recent NZ-authored papers** (`scripts/scrape-nz-corpus.js` → a tiny index `assets/js/research-corpus.js` + per-field shards in `assets/js/corpus/`). The corpus is **sharded by field and lazy-loaded one shard at a time** — when a student searches, only that field's ~1 MB shard is fetched, never all 10k — so it stays fast on mobile and works fully offline. On top of that it's a **hybrid**: the live NZ-filtered OpenAlex queries still run for freshness/global context, and if both the corpus and the live calls are unavailable, a **curated seed** derived from `PF_LABS` (with `PF_UNI_MATCH` / `PF_NZ_INSTITUTES` in `data.js` mapping institution names to campuses) keeps the NZ panel populated. Rebuild the corpus any time with `node scripts/scrape-nz-corpus.js` (resumable, polite-pool). Copy / download `.md`/`.txt`, auto-saved to the account (one debounced `kv` write), and a one-click "send to a mentor for review" hook. No API key, no Cloud Function, no paid services — the literature calls hit external servers, not Firestore, so it stays well inside the free Spark plan.
- `#explore` — all 8 NZ universities, 12 flagship research labs, named supervisors, field filters
- `#funding` — doctoral scholarships (value, deadlines, eligibility) + immigration/visa updates
- `#visa` — **Visa Hub**: the 7-stage NZ student-visa process with Sri Lanka-specific "where to go" guidance and a persistent checklist + progress bar
- `#settlement` — **Settle In**: first 48 hours, banking/IRD, transport, flat-hunting, family & schools, apps — plus a three-tool **Settlement & Cost-of-Living** module: a 90-day **First-months simulator** (stepper + draining balance gauge), an editable **Funds planner** (monthly living cost, total pre-departure funds to arrange, INZ-minimum and doctoral-stipend benchmarks, partner-income scenario, weekly/monthly toggle, saved scenarios), and a **"What can NZ$20 buy?"** purchasing-power explorer. The planner/simulator visualisations use Three.js (lazy-loaded via importmap) with a guaranteed 2D table/bar fallback for reduced-motion and low-end devices.
- `#mentors` — **Mentors**: the public, two-tab marketplace view — **Ask a mentor** (one general request form, aggregate mentor stats) and **My requests** (the student's own requests with live status + payment chips). No named individual mentors are listed; requests join a shared claim queue. **Connecting with a mentor requires a free account** — explorers can browse the network and read everything, but the "Ask a mentor" form (and the inline "Stuck at this step?" hooks everywhere) is account-gated, so each request is tied to a real, signed-in person and trackable across devices; anonymous device sessions are nudged to `#account` first. Likewise **every purchase requires an account** (`PFPay.startSession` / `startOrder` both gate on `PFCloud.isSignedIn()`). There is **no public "become a mentor" CTA** — mentoring is invite-only (see `#mentor`). Topic pre-fill via `#mentors?topic=<slug>`
- `#mentor` — **Mentor Dashboard** (invite code → sign-up → pending review → admin-approved): the open-requests queue with first-come-first-served **claim**, your claimed requests, an at-a-glance insights strip (open / active / completed / earned), the 15-min-free → paid lifecycle, and **Generate payment link** (PayHere). Becoming a mentor is **invite-only**: a vetted person must enter the mentor invite code (`PF_ROLE_CODES.mentor`) before they can create a mentor account, and the account stays pending until an admin approves it. Sidebar link appears only for approved mentors.
- `#account` — **Account**: the unified front door for the three login roles. Clients/students can create a free account (no code) or sign in to sync across devices — **login is optional for explorer basics** (assessment, roadmap, explorer, funding, Research Studio, templates), and anonymous browsing always works for those. It becomes **required only to connect with a mentor or to make any purchase**. Vetted mentors are routed to the invite-only mentor sign-up, and admins to the admin sign-in.
- `#dashboard` — the **client/student dashboard**: a metrics grid, a derived **insights** card (readiness, application funnel, active mentor requests, visa progress, next-step nudge, sync status), application tracker, visa progress, and your mentor requests
- `#kit` — PhD Starter Kit: 19 templates across emails, application documents, research & career, and logistics
- `#admin` — **Admin panel** (access-code + password-gated): overview analytics with a **pending-approvals** callout, email leads, **Mentors** (approve / reject / deactivate), **Requests** (all mentor requests with status, claimed-by, payment status/amount + CSV export), and synced user records. The sign-in asks for the admin access code (`PF_ROLE_CODES.admin`) then the Firebase admin password. Visible only to the admin account; ordinary visitors are blocked by Firestore rules. Reachable from the "Admin" link in the sidebar footer.

## Architecture

```
index.html                 landing (portal hero, lead capture, visa route teaser)
app.html                   SPA shell (sidebar nav + #view container + auth slot)
firebase.json              Firebase Hosting + Firestore deploy config
firestore.rules            security rules (per-user data, create-only inboxes)
assets/
  css/site.css             design tokens + shared components
  css/settlement.css       Settle In tools styling (extends site.css tokens only)
  js/data.js               static dataset (universities, labs, scholarships, visa stages,
                           settlement guide, city costs, price reference, mentors,
                           partners, templates, questions; PF_CONFIG benchmarks)
  js/store.js              PFStore — storage layer (localStorage, change events, merge metadata)
  js/payhere.js            PFPayHere — pure PayHere checkout-link builder (Tier 1, no backend)
  js/firebase-config.js    paste your Firebase web config here (null = pure local mode)
  js/firebase.js           optional sync layer (Auth + roles + Firestore mirror + queue + inboxes)
  js/app.js                router + view renderers
functions/                 OPTIONAL Tier-2 Cloud Functions (require Blaze plan):
  payhere-notify.js        PayHere notify_url webhook → auto-marks payments paid (MD5-verified)
  js/settlement/           Settle In tools (classic scripts, global scope):
    scene3d.js             shared Three.js helpers (lazy import) + 2D-fallback gating + dispose registry
    funds-planner.js       Part B — computePlan() model, benchmarks, saved scenarios
    buying-power.js        Part C — "What can NZ$20 buy?" explorer
    first-months.js        Part A — 90-day simulator, reads the planner's plan
```

## Firebase (free Spark plan) — setup

The site is **cloud-first**: on load, every visitor without a session is signed in **anonymously** (a persistent uid), so all their data is saved to Firestore — not just the device. `localStorage` is kept **only as a synchronous read cache** (instant reads, offline support); Firestore is the durable system of record. When a student later signs in with Google/email, their anonymous account is **linked in place**, so their data carries over instead of being orphaned. With `firebase-config.js` left as `null`, no Firebase code runs at all and the app falls back to pure localStorage.

### What the free tier gives you here

| Service | Used for | Spark-plan limit (ample for launch) |
|---|---|---|
| Authentication | Google + anonymous (students) · Email/Password or Google (mentors) · one Email/Password admin | Unlimited sign-ins |
| Cloud Firestore | `users/{uid}/kv/*` data sync · `inbox_leads` · `mentors` · `mentor_requests` | 1 GiB storage, 50k reads / 20k writes per day |
| Hosting | Deploying the site | 10 GB storage, 360 MB/day transfer |

### Staying inside the free tier

The design keeps reads/writes far below the daily caps (50k reads / 20k writes / day):

- **Cache-served reads.** The UI reads from the localStorage cache, never Firestore, so navigating the app costs **zero reads** beyond the one pull below.
- **One pull per session.** Each load does a single `getDocs` of the user's `kv` to merge remote keys (newer-wins) — not one per view. Daily reads ≈ visitors × kv-docs-per-user (single digits), comfortably under the cap.
- **Debounced writes.** Edits to user data are coalesced (1.5 s) and flushed for every signed-in visitor *except the admin session* — typing in the tracker is a handful of writes, not one per keystroke.
- **Deduplicated inbox.** Each lead / consultation is written **once** (tracked in `__inboxSynced`).
- **Admin reads are on-demand.** Leads, mentors, requests and user records are fetched only when *you* open the admin panel and press Refresh — never on a normal visitor's page load.
- **No live listeners.** All reads are one-shot `getDocs` behind explicit actions; nothing uses `onSnapshot` (which would bill continuous reads).

Cloud Functions require the paid (Blaze) plan, so the core marketplace is built **Tier 1** (no server code): the claim race is enforced purely by Firestore rules + an atomic `runTransaction`, and payment confirmation is a manual mentor/admin click. The **optional Tier-2** webhook (`functions/payhere-notify.js`) automates payment confirmation if you upgrade to Blaze — the app runs correctly with or without it.

### Steps

1. [console.firebase.google.com](https://console.firebase.google.com) → Add project (Analytics optional).
2. **Build → Authentication → Sign-in method**: enable **Google**, **Anonymous**, and **Email/Password**.
3. **Build → Authentication → Users → Add user** — create the admin account:
   - **Email**: must match `window.PF_ADMIN_EMAIL` in `assets/js/firebase-config.js` (default `admin@pathfinder.app`) **and** the `isAdmin()` email in `firestore.rules`.
   - **Password**: `adminadmin` to start — **change it** here after your first login (the in-app gate just signs into this account).
4. **Build → Firestore Database**: create database (production mode).
5. **Project settings → Your apps → Web app** (`</>`): register, copy the config object into `assets/js/firebase-config.js`.
6. Deploy rules + site:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use <your-project-id>
   firebase deploy            # deploys hosting + firestore.rules
   ```
   (Or keep hosting on GitHub Pages and run only `firebase deploy --only firestore:rules` — just add your Pages domain under Authentication → Settings → Authorized domains.)
7. Set `PF_CONFIG.contactEmail` in `assets/js/data.js` to the real consultation inbox.

### Admin panel

Open `app.html#admin` (or the **Admin** link in the sidebar footer) and enter the admin password. The password box signs into the Firebase **Email/Password** admin account from step 3 — so the leads, consultation requests, and user records you see are released by Firestore rules **only** to that account. Nothing sensitive is stored in the client JS; the password is typed at runtime.

> ⚠️ **Security note.** A purely client-side password (a string compared in JavaScript) cannot protect Firestore data — to read leads/users a client-side gate would force the rules open to *every* visitor, exposing all students' emails and contacts. That's why the gate authenticates against a real Firebase account instead. To change who is admin, update the email in **both** `firebase-config.js` and `firestore.rules`, then redeploy the rules.

To rotate the admin password: Firebase console → Authentication → Users → ⋮ → Reset password (or delete and recreate the user).

### How the sync works

- On load, `firebase.js` ensures a session: it reuses the restored uid, or mints a **persistent anonymous** one if there's none. Every visitor therefore has a uid and syncs.
- `store.js` fires a change event on every write and keeps a per-key timestamp map (`__meta`).
- `firebase.js` subscribes: writes are debounced into `users/{uid}/kv/{key}` docs (`{v: json, t: timestamp}`) for every visitor except the admin session.
- Once per session it pulls the remote keys and merges **newer-wins per key**, then re-renders.
- Signing in with Google/email **links** the anonymous account in place (`linkWithPopup` / `linkWithCredential`), keeping the same uid and its data; it falls back to a plain sign-in only if that credential already belongs to another account.
- Leads and consultation requests are *also* pushed (deduplicated) to top-level `inbox_leads` / `inbox_consultations` collections, with **create-only** rules for visitors — only the admin account can read them back (in the Firebase console *or* the in-app admin panel).
- The admin panel reads via `window.PFCloud` (exposed by `firebase.js`): `inbox_leads`, `inbox_consultations`, and a `collectionGroup('kv')` query across all users for the Users tab — every read gated to the admin email by the rules.

## Mentorship marketplace

PathFinder is a lightweight two-sided marketplace: **students** ask, **mentors** (current Sri Lankan postgrads in NZ) answer. There is no public directory of named individuals — students ask one general question and the first suitable mentor claims it.

### Roles (Firebase Auth)

The three login roles share one front door (`#account`) and one helper,
`PFCloud.role()` → `admin · mentor · mentor_pending · client · anon`.

| Role | Sign-in | Secret code | Marker | Sees |
|---|---|---|---|---|
| **Client / Student** | **Optional** — Google / email-password (no code), or anonymous | none | — | Full app + `#dashboard` insights + `#mentors` (Ask / My requests) |
| **Mentor** | Email-password or Google, **invite-only** | `PF_ROLE_CODES.mentor` (`MNTR`) at sign-up | `mentors/{uid}` doc, `approved` flag | `#mentor` dashboard once **approved** |
| **Admin** | single Email/Password account | `PF_ROLE_CODES.admin` (`ADMN`) before the password | `PF_ADMIN_EMAIL` | `#admin` — incl. mentor approval |

The secret codes live in `assets/js/firebase-config.js` (`PF_ROLE_CODES`).
They are a **soft client-side gate only** — the real security is server-side
in `firestore.rules`: a mentor can do nothing privileged until an admin sets
`approved:true`, and admin reads are granted only to the admin email's
authenticated session. Rotate codes by editing that file.

A signed-in user can be both a client and a mentor — their `users/{uid}/kv/*`
data and their `mentors/{uid}` profile are independent. The **Mentor
Dashboard** sidebar link shows only when `PFCloud.isMentor()` (approved) is
true; the **Account** link is always present.

### Request lifecycle

```
open ──claim──▶ claimed ──intro──▶ intro_done ──gen link──▶ awaiting_payment ──paid──▶ paid ──done──▶ completed
  (any state before `paid` can go to ─▶ cancelled)
```

- **open** — student submitted (free; joins the shared queue).
- **claimed** — a mentor took it (atomic, first-come-first-served via a Firestore `runTransaction` gated by rules — two mentors can't claim the same request).
- **intro_done** — the free 15-minute intro (off-platform, phone/video) is finished.
- **awaiting_payment** — mentor agreed a follow-on price and generated a PayHere link.
- **paid** — payment confirmed (Tier 1: mentor/admin marks it; Tier 2: the webhook does).
- **completed** — paid session delivered.

### Payments — PayHere (HelaPay-enabled)

The first 15 minutes are always free. Paid follow-on sessions go through **PayHere's hosted checkout**. For LKR, PayHere automatically offers every local method — **Visa/Mastercard, HelaPay, eZ Cash, mCash, Genie, online banking** — so there is no separate "HelaPay API"; the pay button is labelled accordingly.

- **Tier 1 (this repo, free Spark plan, no backend):** `assets/js/payhere.js` builds an unsigned checkout form (sandbox/live driven by `PF_CONFIG.payhere.sandbox`). After the student pays, the mentor or admin confirms receipt in the PayHere merchant console and clicks **Mark payment received** — exactly the manual-reconciliation spirit of the old `mailto:` fallback. **No `hash` is computed client-side** (it needs the merchant secret).
- **Tier 2 (optional, requires Blaze plan):** `functions/payhere-notify.js` receives PayHere's server-to-server `notify_url` callback, verifies its MD5 signature with the merchant secret, and flips `payment.paymentStatus = 'paid'` automatically. The app works correctly without it; deploying it just stops the manual step. Both tiers write the **same field**, so every payment-status read in the UI works either way.

Configure `PF_CONFIG.payhere` (`data.js`): `merchantId` (public — safe in client), `sandbox`, `currency`. The merchant **secret** is never in client code — only in the Tier-2 function's config.

## Data model (Firestore)

```
users/{uid}/kv/{key}        mirrored PFStore keys: assessment, saved, applications,
                            checklist.visa, mentorRequests, calcPrefs, firstMonths,
                            fundsPlans, leads
inbox_leads/{id}            { email, source, at, uid, ts }          create (visitors) · read (admin)
mentors/{uid}               { displayName, fields[], city, bio, langs, availability,
                              approved, active, createdAt }
                            create (self, approved:false) · read (any signed-in) ·
                            update (self: descriptive fields / admin: approved+active)
mentor_requests/{id}        { topic, note, name, contact, studentUid, status, mentorId,
                              introDoneAt, payment{amountLKR, payhereLink, paymentStatus,
                              paidAt}, at, createdAt, updatedAt, ts }
                            create (any signed-in, status:'open') · read (admin / approved
                            mentor / owning student) · update (admin / claiming or owning
                            mentor / student-cancel) — claim race closed in rules
inbox_consultations/{id}    LEGACY (pre-marketplace) — read-only for admin, no new writes
```

> **Breaking change:** the old `inbox_consultations` create flow is replaced by `mentor_requests`. Existing `inbox_consultations` docs remain readable by the admin (kept read-only in the rules) but new requests go to `mentor_requests`. The local `PFStore` key `consultations` is superseded by `mentorRequests` (`addConsultation` is kept as a thin alias).

Static reference data (`PF_UNIVERSITIES`, `PF_LABS`, `PF_SCHOLARSHIPS`, `PF_VISA_STAGES`, `PF_SETTLEMENT`, `PF_CITY_COSTS`, `PF_PARTNERS`, `PF_TEMPLATES`) ships in `data.js`. `PF_MENTORS` is now **local-only fallback/demo seed data** (powers the aggregate "X mentors across Y fields" stat when Firebase is off) — mentor identities live in the `mentors/` collection in the live flow.

## Monetization

**Live in the product:**

1. **Mentor marketplace** (anchor) — every "Ask a mentor" request opens with a free 15-minute intro, then an optional **paid follow-on session** billed through PayHere (Cards/HelaPay/eZ Cash/Genie). Inline "Stuck at this step? Ask a mentor" hooks on every visa stage, settlement card, roadmap phase, lab card and scholarship pre-fill the request topic and create the request in place. Requests land in the shared `mentor_requests` queue; the platform takes its cut on the paid sessions.
2. **Partner placements (affiliate)** — `PF_PARTNERS` rows rendered contextually and clearly labelled: IELTS prep (assessment results when English score is low), forex (cost calculator), insurance + flights (visa pre-departure stage). Replace the placeholder `url` fields with your affiliate links.
3. **Sponsored listings** — add `sponsored: true` to any university/lab/scholarship entry to flag it (chip rendering hook reserved in the explorer).

**Roadmap (needs Blaze plan or external services):**

- **Automated payment confirmation**: deploy `functions/payhere-notify.js` (Tier 2) so paid sessions flip to `paid` without a manual click.
- **Cohort webinars**: paid group sessions ("November intake visa workshop") — Zoom + payment link is enough to start; later a `webinars` collection with seat counts.
- **Paid community**: WhatsApp/Discord membership for applicants in the same intake cycle, bundled with one consultation.
- **University referral commissions**: agency-style referral agreements with NZ universities (they pay per enrolled student; students pay nothing) — the explorer becomes the funnel.
- **Email automation**: leads currently land in `inbox_leads`; connect Mailchimp/Brevo (free tiers) for the deadline-alert newsletter promised on the landing page.

## Deploying

- **GitHub Pages**: Settings → Pages → deploy from branch root. No build required. (Add the Pages domain to Firebase authorized domains if sync is enabled.)
- **Firebase Hosting**: `firebase deploy` — see Firebase setup above.

## Launch checklist

- [ ] Set your own secret codes in `PF_ROLE_CODES` (`assets/js/firebase-config.js`) — change the defaults `MNTR` / `ADMN` before launch
- [ ] Recruit real mentors: share the **mentor invite code** privately, have them sign up at `#mentor`, then approve them in the admin **Mentors** tab (`PF_MENTORS` is now just local demo/fallback seed — no need to edit it for launch)
- [ ] Set `PF_CONFIG.payhere.merchantId` and flip `PF_CONFIG.payhere.sandbox` to `false` for live LKR payments; adjust `defaultSessionPriceLKR`
- [ ] (Optional, Blaze) deploy `functions/payhere-notify.js` for automatic payment confirmation
- [ ] Set `PF_CONFIG.contactEmail` in `data.js`
- [ ] Replace `PF_PARTNERS` placeholder `url:'#'` entries with real affiliate links (or remove the rows)
- [ ] Paste Firebase config into `assets/js/firebase-config.js`, deploy `firestore.rules`
- [ ] Verify all costs/figures (visa fees, rents, stipends) are current
- [ ] **Re-verify the Settle In benchmarks periodically** — all live in `PF_CONFIG` (`data.js`) with source notes:
  - `visaFundsPerYear`/`visaFundsPerMonth` — INZ minimum living-cost requirement (NZ$20,000/yr as of 2026; confirm on immigration.govt.nz, it changes periodically)
  - `minWageHourly` — NZ adult minimum wage (NZ$23.95/hr from 1 Apr 2026; reviewed every April on employment.govt.nz)
  - `stipendLo`/`stipendHi` — doctoral stipend band (NZ$28k–33k/yr)
  - `nzdToLkr` — indicative FX rate (hand-maintained, not a live feed)
  - `PF_CITY_COSTS[*].rentWeekly`/`monthly` + `lastVerified` — per-city rents/living costs; `PF_PRICE_REFERENCE` everyday prices. Bump `PF_CONFIG.dataVerified` after each review.

## Disclaimer

Scholarship values, fees, rankings, visa rules, and living costs are indicative — always verify with universities and Immigration New Zealand.
