# PathFinder

PathFinder helps Sri Lankan students get into a **master's or a PhD** in New Zealand — compare pathways, browse the full NZQA postgraduate course catalogue, find supervisors and scholarships, generate a personalized roadmap, walk the visa process step by step, plan the move, and track applications from first email to enrollment.

### Study tracks

The product serves **two journeys on one platform**, chosen by the student on the landing page (`app.html?track=masters|phd`) and switchable any time from the sidebar. The track is stored as the `track` key in `PFStore` (so it syncs like any other user data) and read everywhere through `trackCfg()` / `isMasters()` in `app.js`.

**Nobody is put on a track without being asked.** `PFStore.getTrack()` degrades an unset value to PhD — the right thing to do with a stored value that can't be parsed, and the wrong thing to apply to a student who was never asked. So `route()` puts the track question in front of the **first view of any kind** (`needsTrackChoice()` in `app.js`), not just in front of `#assessment`: `index.html` links directly into `#dashboard`, `#courses`, `#funding`, `#visa`, `#kit` and eleven subject tiles, and every one of those entry points would otherwise pick PhD silently — showing a master's applicant domestic fees, a doctoral stipend, unlimited work rights, and a visa-funds figure understated by tens of thousands of dollars a year. The hash is left untouched, so answering the question drops the student on the view they actually asked for. Exempt: the role/system views (`account`, `admin`, `mentor`, `billing`, `pricing`), where a study track is meaningless, and any session that is already a mentor or an admin.

Nearly everything that differs between the two lives in one object, **`PF_TRACK` in `assets/js/data.js`** — the fee model, the entry bar, the timeline shape, the work rights, and the words. Add a difference there rather than branching in a view. Where a single fact in a longer data record differs (a visa step, a Settle In card), the record carries a `masters_<field>` alternate and the renderer reads it through `tv(obj, field)`.

The differences that matter most are financial and legal, not cosmetic:

| | PhD | Master's |
|---|---|---|
| Tuition | **Domestic** rate, ~NZ$8,500/yr | **Full international** rate, ~NZ$32–48k/yr |
| Stipend | NZ$28–33k/yr, usually automatic with admission | None — awards discount fees, and have hard deadlines |
| Work rights | Unlimited hours | 20 hrs/week in semester, full-time in breaks |
| Admission | Supervisor-led, enrol any month | Programme-led, February and July intakes |
| NZQF levels | 10 | 8 (PGDip/PGCert/GradDip/Hons) and 9 |

Getting the first row wrong understates a master's applicant's visa-funds requirement by **tens of thousands of dollars a year**, which is why `computeFunds()` branches on the track rather than sharing one tuition line.

**Fully static. Zero build step. Cloud-first on Firebase (free Spark plan) — or runs 100% locally when Firebase is left unconfigured.**

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Landing page with the portal hero, feature overview, and email lead capture |
| `app.html` | The application — hash-routed SPA, track-aware |

### App views (`app.html#<view>`)

- `#assessment` — 7-question pathway assessment (< 5 min) → readiness score + recommended entry route
- `#roadmap` — interactive month-by-month roadmap, personalized from the assessment, with contextual mentor hooks
- `#research` — **Research Studio**: a free, no-backend topic & proposal generator with a **New Zealand lean**. The student answers a few questions (field, topic in their own words, motivating problem, methodology, keywords), then PathFinder searches **real, recent academic literature** via free, no-key, browser-callable scholarly APIs (**OpenAlex**, with **Crossref** as a resilient fallback, then a degraded offline scaffold). It retrieves **by relevance, not just citations** (the old citation-only sort hid relevant niche work), running **two OpenAlex passes — a global one and one filtered to NZ-based authors** (`authorships.institutions.country_code:NZ`) — and reads each author's institutional affiliation straight from the API. For the *best-published NZ authors on the topic* it uses OpenAlex's native **`group_by=authorships.author.id` analytics** (an accurate ranked author facet, not a guess from a small page of papers), then blends that with the retrieved papers' authors and a **precomputed per-field NZ-author index** (top authors by total citations, shipped in the corpus index) — so leading NZ researchers surface with their campus and citation impact even from a thin result set or fully offline. It produces (1) a **literature map** — top recent papers (NZ-authored ones chipped), most-active authors (their NZ campus shown), trending sub-themes, a year histogram — plus a warm **"Research happening in New Zealand"** panel that surfaces those NZ researchers *indirectly, as the authors of the work the student is reading* (never labelled "your supervisor"), alongside the honest case for a NZ PhD (domestic fees, work rights, post-study visa) and links into Explore / the Starter Kit; **3–5 candidate research directions**; and **matched NZ research groups** from the dataset. Then (2) it expands any chosen direction into a **full structured proposal draft** (working title, abstract, background with inline citations **prioritising NZ-authored work**, research gap, research questions, methodology, indicative 3-year timeline, a "the people behind your citations — in New Zealand" section, NZ research groups, formatted references). The NZ side is anchored to a **large pre-scraped corpus of 10,000+ recent NZ-authored papers** (`scripts/scrape-nz-corpus.js` → a tiny index `assets/js/research-corpus.js` + per-field shards in `assets/js/corpus/`). The corpus is **sharded by field and lazy-loaded one shard at a time** — when a student searches, only that field's ~1 MB shard is fetched, never all 10k — so it stays fast on mobile and works fully offline. On top of that it's a **hybrid**: the live NZ-filtered OpenAlex queries still run for freshness/global context, and if both the corpus and the live calls are unavailable, a **curated seed** derived from `PF_LABS` (with `PF_UNI_MATCH` / `PF_NZ_INSTITUTES` in `data.js` mapping institution names to campuses) keeps the NZ panel populated. Rebuild the corpus any time with `node scripts/scrape-nz-corpus.js` (resumable, polite-pool). Copy / download `.md`/`.txt`, auto-saved to the account (one debounced `kv` write), and a one-click "send to a mentor for review" hook. No API key, no Cloud Function, no paid services — the literature calls hit external servers, not Firestore, so it stays well inside the free Spark plan.
- `#courses` — **Course Catalogue**: the NZQA postgraduate register, browsable. **1,716 current qualifications** (951 at level 8, 700 at level 9, 64 doctorates) across the **51 providers** that teach them — 8 universities, 14 polytechnics and 29 private colleges — indexed by the **NZQA subject-area taxonomy** (461 nodes / 11 subject roots with postgraduate study). Drill down subject → sub-area, filter by level, qualification type and provider, search by title or provider, and open any qualification for its entry requirements, purpose, graduate profile, further-study pathway, offering providers with real contact details, published fees where they exist, and a link to its NZQA record. Defaults to the active track's levels and to the subject area the student's assessment pointed at. Generated by `scripts/sync-astra-catalogue.js` — see *Course catalogue* below.
- `#explore` — the 8 NZ universities with their 12 flagship research labs and named supervisors (PhD track), plus the other **43 providers** from the catalogue — polytechnics and private colleges — with live per-provider qualification counts and contact details, ranked by how much postgraduate study each teaches
- `#funding` — **281 real scholarships** from the provider register, filtered to the active track's study levels, with an international-students-only filter and domestic-only awards excluded; falls back to the 8 curated doctoral awards in `PF_SCHOLARSHIPS` if the shard fails to load. Plus track-appropriate immigration/visa updates
- `#visa` — **Visa Hub**: the 7-stage NZ student-visa process with Sri Lanka-specific "where to go" guidance and a persistent checklist + progress bar
- `#settlement` — **Settle In**: first 48 hours, banking/IRD, transport, flat-hunting, family & schools, apps — plus a three-tool **Settlement & Cost-of-Living** module: a 90-day **First-months simulator** (stepper + draining balance gauge), an editable **Funds planner** (monthly living cost, total pre-departure funds to arrange, INZ-minimum and doctoral-stipend benchmarks, partner-income scenario, weekly/monthly toggle, saved scenarios), and a **"What can NZ$20 buy?"** purchasing-power explorer. The planner/simulator visualisations use Three.js (lazy-loaded via importmap) with a guaranteed 2D table/bar fallback for reduced-motion and low-end devices.
- `#mentors` — **Mentors**: the public, two-tab marketplace view — **Ask a mentor** (one general request form, aggregate mentor stats) and **My requests** (the student's own requests with live status + payment chips). No named individual mentors are listed; requests join a shared claim queue. A student holding a paid plan sees their **remaining credits** on the form and can spend one on the request they're about to send (see *Plans, credits and what they actually unlock*); with no plan, or no balance left, the form is exactly as it was. **Connecting with a mentor requires a free account** — explorers can browse the network and read everything, but the "Ask a mentor" form (and the inline "Stuck at this step?" hooks everywhere) is account-gated, so each request is tied to a real, signed-in person and trackable across devices; anonymous device sessions are nudged to `#account` first. Likewise **every purchase requires an account** (`PFPay.startSession` / `startOrder` both gate on `PFCloud.isSignedIn()`). There is **no public "become a mentor" CTA** — mentoring is invite-only (see `#mentor`). Topic pre-fill via `#mentors?topic=<slug>`
- `#mentor` — **Mentor Dashboard** (invite code → sign-up → pending review → admin-approved): the open-requests queue with first-come-first-served **claim**, your claimed requests, a **Session log**, a **People** client book, an at-a-glance insights strip (open / active / delivered / earned / invoiced-unpaid), the 15-min-free → paid lifecycle, and **Generate payment link** (PayHere). The **Session log** records every session you actually deliver — including the many that arrive over **WhatsApp or a phone call** and never touch the request queue — with who, when, how long, over which channel, what you covered, private notes, agreed next steps, the fee and its payment state; each record generates a **PDF invoice or receipt** in one click ("Save & invoice" issues it as you write the record up). Claimed requests get a **Log session** button that pre-fills the form from the request. Becoming a mentor is **invite-only**: a vetted person must enter the mentor invite code (`PF_ROLE_CODES.mentor`) before they can create a mentor account, and the account stays pending until an admin approves it. Sidebar link appears only for approved mentors.
- `#billing` — **Billing**: an **Included in your plan** card (mentor sessions and document audits still unspent, plus the toolkit/priority/interview-prep flags), then the student's own one-time unlocks and every mentoring session logged against their account, each with a downloadable **PDF invoice/receipt**. A one-time unlock is easy to buy and then forget — an order row reading "Premium · LKR 24,990 · Paid" doesn't tell anyone they still hold two sessions and an audit — so the balance card leads, and links to where the credits are spent. Private mentor notes are never shown here.
- `#account` — **Account**: the unified front door for the three login roles. Clients/students can create a free account (no code) or sign in to sync across devices — **login is optional for explorer basics** (assessment, roadmap, explorer, funding, Research Studio, templates), and anonymous browsing always works for those. It becomes **required only to connect with a mentor or to make any purchase**. Vetted mentors are routed to the invite-only mentor sign-up, and admins to the admin sign-in. See *The account model* below for where the app asks, and why it never asks at the door.
- `#dashboard` — the **client/student dashboard**: a metrics grid, a derived **insights** card (readiness, application funnel, active mentor requests, visa progress, next-step nudge, sync status), application tracker, visa progress, and your mentor requests. On a **cold start** — nothing assessed, saved, tracked or checked — it renders `renderFirstRun()` instead: one action and an honest account of what the assessment produces. `#dashboard` is both the app's default route and the landing page's "Open the dashboard" CTA, so it is the first screen a large share of visitors ever see, and rendered in full on an empty account it is four zeroes, a "—%" readiness figure and an empty application form competing with the invitation. The full dashboard returns the moment there is anything real to put on it (the test is "is there anything to show?", not "did they take the assessment?", so a student who shortlisted a course but skipped the assessment still gets the real thing).
- `#kit` — Starter Kit: 21 templates across emails, application documents, research & career, and logistics. Templates tagged `track:'masters'` (statement of purpose, programme comparison sheet) or `track:'phd'` (supervisor emails, 3-year research plan) show only on that track; the rest serve both
- `#admin` — **Admin panel** (access-code + password-gated): overview analytics with a **pending-approvals** callout, **Accounting** (a unified ledger across every revenue source, with one-click PDF invoices/receipts), email leads, **Mentors** (approve / reject / deactivate), **Requests** (all mentor requests with status, claimed-by, payment status/amount + CSV export), **People** (every person on record across all mentors — searchable, with each one's full consultation history and how much they still owe; CSV export), **Sessions** (every mentoring session logged by any mentor — filter by mentor and payment state, log one on a mentor's behalf, CSV export, PDF invoices), **Orders**, and synced user records. A **Someone called** button sits above the tabs for the phone and walk-in enquiries that arrive with no account behind them. The sign-in asks for the admin access code (`PF_ROLE_CODES.admin`) then the Firebase admin password. Visible only to the admin account; ordinary visitors are blocked by Firestore rules. Reachable from the "Admin" link in the sidebar footer.

## Architecture

```
index.html                 landing (portal hero, lead capture, visa route teaser)
app.html                   SPA shell (sidebar nav + #view container + auth slot)
firebase.json              Firebase Hosting + Firestore deploy config
firestore.rules            security rules (per-user data, create-only inboxes)
assets/
  css/site.css             design tokens + shared components
  css/settlement.css       Settle In tools styling (extends site.css tokens only)
  js/data.js               static dataset (PF_TRACK study tracks, universities, labs,
                           scholarships, visa stages, settlement guide, city costs,
                           price reference, mentors, partners, templates, questions;
                           PF_CONFIG benchmarks)
  js/catalogue.js          GENERATED — NZQA catalogue index (taxonomy + 1,716 quals + 51 providers)
  js/catalogue/            GENERATED — lazy-loaded detail shards, one per subject area,
                           plus scholarships.js and programmes.js
data/subject_areas.json    NZQA subject-area taxonomy (source input to the sync script)
scripts/
  sync-astra-catalogue.js  rebuilds the catalogue from AstraDB (see below)
  scrape-nz-corpus.js      rebuilds the NZ research corpus from OpenAlex
  build-corpus-index.js    rebuilds the corpus index from existing shards
  js/store.js              PFStore — storage layer (localStorage, change events, merge metadata)
  js/payhere.js            PFPayHere — pure PayHere checkout-link builder (Tier 1, no backend)
  js/invoice.js            PFInvoice — zero-dependency PDF invoice/receipt writer + print preview
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

## Course catalogue (NZQA data)

The catalogue is **generated at build time** and committed, exactly like the research corpus. `scripts/sync-astra-catalogue.js` reads the NZQA dataset out of AstraDB and writes:

```
assets/js/catalogue.js                  index — taxonomy, 1,716 qualification rows, 51 providers  (~40 KB gz)
assets/js/catalogue/<subject-slug>.js   detail shard per subject area, lazy-loaded  (10–65 KB gz each)
assets/js/catalogue/scholarships.js     281 postgraduate-relevant scholarships
assets/js/catalogue/programmes.js       132 level-8+ programme rows (published fees where they exist)
```

Rebuild when the database is updated:

```bash
ASTRA_DB_TOKEN=AstraCS:... node scripts/sync-astra-catalogue.js
```

Use a **read-only** token — the script only reads. The token is never committed and never reaches the browser.

**Why a build step rather than querying AstraDB live from the app:**

1. **The Astra Data API sends no CORS headers.** A browser blocks every direct call, on the preflight and on the response alike. Verified against the live endpoint; OpenAlex and Crossref return `access-control-allow-origin` through the same network path, so it is the API, not the network. Serving live data would need a proxy (a Cloudflare Worker or a Blaze-plan Cloud Function) holding the token.
2. **Shipping the token to the browser is not an option** even if CORS allowed it — an Astra token grants write access to the whole database.
3. **Semantic search is unavailable on this data anyway.** The collections are configured with NVIDIA embeddings, lexical indexing and reranking, but **no document has `$vector` populated** — `$vectorize`, `$lexical` and `findAndRerank` all return empty. Search is therefore client-side substring matching over the generated index, which is instant at 1,716 rows and works offline.

Loading is lazy and mirrors `ensureCorpusIndex()` / `ensureField()`: `ensureCatalogue()`, `ensureSubjectArea(rootId)`, `ensureScholarships()` and `ensureProgrammes()` in `app.js` reuse the same `_loadScript()` helper. The dashboard's first paint downloads no catalogue files at all; opening `#courses` pulls the index plus at most one subject shard.

> **Never write catalogue data through `PFStore`.** Every `PFStore` key is mirrored to `users/{uid}/kv/{key}` with no allowlist (`assets/js/firebase.js`), so pushing megabytes of catalogue there would blow the Spark free tier immediately. Catalogue data lives in module-scope globals only. Saved courses and scholarships store just an id plus a short label, so the dashboard can list them without loading any shard.

### What the sync script keeps

- **Levels 8, 9 and 10** — postgraduate only. Level 8 matters because it carries the PGDip/PGCert/GradDip/Honours qualifications that bridge an under-qualified applicant into a master's.
- **Every provider that teaches at least one of them** — 51, derived from the data rather than from NZQA's provider category. Category is a poor proxy: most private training establishments teach only level 1–5 certificates, but **29 of them award master's degrees** (Yoobee has three, Whitecliffe ten postgraduate qualifications, Media Design School six). Filtering by `type` dropped all of those along with the certificates. Providers teaching nothing above level 7 fall out on their own.
- **Scholarships tagged** `Masters`, `Postgraduate`, `PhD / Doctorate` or `General`, from an in-scope provider.
- `employmentPathway` is **dropped**: all 1,716 postgraduate rows carry the same CareersNZ boilerplate sentence and nothing else, so rendering it would show a heading with no content. Placeholder values (`.`, `null`, `Not available`) are stripped everywhere else.

Joins are clean — `offering_org` → providers resolves 100%, as does `scholarships.offeringOrg`. `programmes.qualificationID` matches a qualification only ~40% of the time, so programme rows (the only source of real fee figures) attach opportunistically and are never a required join. Fees are sparse by nature: universities publish no programme-level rows at all, and only 17 of the 132 programme rows carry a numeric international fee — so `PF_CONFIG.mastersFeesIntlPerYear` supplies the hand-maintained band, and real per-course fees show only where they genuinely exist.

## Firebase (free Spark plan) — setup

The site is **cloud-first**: on load, every visitor without a session is signed in **anonymously** (a persistent uid), so all their data is saved to Firestore — not just the device. `localStorage` is kept **only as a synchronous read cache** (instant reads, offline support); Firestore is the durable system of record. When a student later signs in with Google/email, their anonymous account is **linked in place**, so their data carries over instead of being orphaned. With `firebase-config.js` left as `null`, no Firebase code runs at all and the app falls back to pure localStorage.

### What the free tier gives you here

| Service | Used for | Spark-plan limit (ample for launch) |
|---|---|---|
| Authentication | Google + anonymous (students) · Email/Password or Google (mentors) · one Email/Password admin | Unlimited sign-ins |
| Cloud Firestore | `users/{uid}/kv/*` data sync · `inbox_leads` · `mentors` · `mentor_requests` · `mentor_sessions` · `orders` | 1 GiB storage, 50k reads / 20k writes per day |
| Hosting | Deploying the site | 10 GB storage, 360 MB/day transfer |

### Staying inside the free tier

The design keeps reads/writes far below the daily caps (50k reads / 20k writes / day):

- **Cache-served reads.** The UI reads from the localStorage cache, never Firestore, so navigating the app costs **zero reads** beyond the one pull below.
- **One pull per session.** Each load does a single `getDocs` of the user's `kv` to merge remote keys (newer-wins) — not one per view. Daily reads ≈ visitors × kv-docs-per-user (single digits), comfortably under the cap.
- **Debounced writes.** Edits to user data are coalesced (1.5 s) and flushed for every signed-in visitor *except the admin session* — typing in the tracker is a handful of writes, not one per keystroke.
- **Deduplicated inbox.** Each lead / consultation is written **once** (tracked in `__inboxSynced`).
- **Admin reads are on-demand.** Leads, mentors, requests and user records are fetched only when *you* open the admin panel and press Refresh — never on a normal visitor's page load.
- **No live listeners.** All reads are one-shot `getDocs` behind explicit actions; nothing uses `onSnapshot` (which would bill continuous reads).
- **Derived views cost nothing.** The Accounting ledger and the People / client book are folded client-side out of records the dashboard already holds — no `people` collection, no second query, no new rules. Phone intake adds **one write per call actually taken** (plus the single `mentors/{uid}` read the rules do to check the mentor is approved), and sending an invoice adds none at all: the PDF is generated in the browser and WhatsApp/email are external. Answering a hundred calls a day would use 0.5% of the daily write budget.

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

### Someone rings who isn't on the system

Most enquiries in Sri Lanka arrive as a phone call or a WhatsApp message, long before anyone signs up for anything. The platform is built to absorb that rather than route around it.

Whoever picks up — the admin (`#admin` → **Someone called**) or the mentor whose number was passed on (`#mentor` → **Someone called**) — opens a short form and writes down four things: **who they are, how to reach them, what they need, and when to call back**. Saving it creates an ordinary `mentor_requests` doc, the *same* record a request typed on the site produces. From that moment the caller is in the queue, on a dashboard, in the client book, and eventually on an invoice — there is no separate off-platform path to maintain.

- The doc carries `source` (phone call · WhatsApp · walked in · referred · email), `callback` (their preferred time) and `takenBy`/`takenByName` (who answered), so a queue card shows a **"Rang us"** chip and the call-back time. A mentor picking one up knows to ring rather than wait.
- The admin can hand the caller to a mentor on the spot, or leave it open for whoever is free. A mentor taking their own call assigns it to themselves in the same write — enforced in the rules, where a mentor may create a `claimed` request **only** with `mentorId == their own uid`.
- `studentUid` stays empty, which is exactly what `namedStudentIsOwn()` in the rules expects: an off-platform person has no account, so the invoice is addressed by name and number instead.
- Because these people have no `#billing` page, request and person cards carry one-tap **WhatsApp / Call / Email** links straight off the contact field.

### People — the client book

Someone rings in March, WhatsApps in May, and books a paid session in June. To a mentor that is one person; to Firestore it is a request doc and two session docs with the phone number typed three different ways.

**People** (`#mentor` → *People*, `#admin` → *People*) folds them back together. Open anyone's **history** before the next call and you see every earlier consultation — what was covered, what was agreed, what is still owed — so the second session starts where the first one ended instead of repeating it. The session form does the same inline: type a number that matches someone already on record and a strip appears above the fields — *"You've already worked with Nimali Perera — 2 sessions, LKR 2,500 still due. Last time: Visa documents on 12 June."*

Matching is on the **last nine digits** of the phone number, so `0771234567`, `+94 77 123 4567` and `94771234567` are one person; then email; then, if neither was written down, the name.

> There is **no `people` collection**. The whole client book is derived client-side (`buildPeople()` in `app.js`) from the `mentor_sessions` and `mentor_requests` the dashboard has already loaded — so it costs **zero extra reads**, needs no new security rules, and can never drift out of step with the records it summarises. Same principle as the Accounting ledger.

### Session records & invoicing

Not every mentoring session starts in the app. A student messages a mentor on **WhatsApp**, or rings them, and the whole consultation happens off-platform. Those sessions still need a written record and the student still wants an invoice — so the platform records them first-class.

The **session log** (`#mentor` → *Session log*, `#admin` → *Sessions*) captures one record per delivered session:

| Field | What it holds |
|---|---|
| `studentName` · `studentContact` · `studentUid` | Who it was for. `studentUid` is set automatically when the session came from a platform request, which is what makes the invoice appear in that student's `#billing`. |
| `channel` | How it happened — WhatsApp, phone call, video call, in person, email, or a PathFinder request (`PF_SESSION_CHANNELS`). |
| `topic` · `title` · `date` · `durationMin` | What and when. |
| `summary` · `followUp` | What was covered and the agreed next steps — **both print on the invoice**. |
| `notes` | The mentor's private notes: never printed, never shown to the student. |
| `amountLKR` · `paymentStatus` · `method` · `ref` | The fee and where it stands (`unpaid` · `reported` · `paid` · `waived`). A free intro is logged as `waived`, so it is recorded as delivered work without entering the money ledger. |
| `invoiceNo` | Minted once at creation (`PF-INV-M-<yymm>-<tail>`) so the number a student is quoted never changes. |

**Invoices are real PDFs, generated in the browser.** `assets/js/invoice.js` (`PFInvoice`) is a self-contained ~500-line PDF 1.4 writer — no library, no CDN, no backend, no Blaze plan. It bundles the Helvetica advance-width tables so line wrapping and right-aligned money columns are exact, folds smart typography to WinAnsi, and flows long write-ups across as many pages as they need. Two outputs from one model:

- **Invoice PDF** — downloads `<invoiceNo>.pdf` straight away.
- **Preview** — opens a print-ready page in a new tab with both a *Download PDF* button and *Print*.

The document is a **receipt** when paid, an **invoice** when not, and a **session record** when the fee was waived — same layout, honest label. Until `PF_CONFIG.org.legalName` is filled in, the footer says plainly that it is a payment confirmation and not a tax invoice.

**Getting it to the client.** Someone who rang the platform has no account and will never open `#billing` to find their receipt, so every session card carries **Send it** — a two-step hand-off that is honest about what a browser can and cannot do: *download the PDF*, then *send the message with it attached*. The message is written out in full and editable, and opens in **WhatsApp** (`wa.me`, with the number normalised to `947…`), email, or the clipboard. When the fee is unpaid it appends the bank and wallet lines from `PF_CONFIG.manualPay` and asks them to quote the invoice number — and simply omits that block while those fields are still blank, rather than printing placeholders at a paying customer.

Session records also feed the admin **Accounting** ledger. A logged session **supersedes** the request that spawned it (matched on `requestId`), so money is never counted twice; off-platform sessions appear in the ledger for the first time there.

### Payments — PayHere (HelaPay-enabled)

The first 15 minutes are always free. Paid follow-on sessions go through **PayHere's hosted checkout**. For LKR, PayHere automatically offers every local method — **Visa/Mastercard, HelaPay, eZ Cash, mCash, Genie, online banking** — so there is no separate "HelaPay API"; the pay button is labelled accordingly.

- **Tier 1 (this repo, free Spark plan, no backend):** `assets/js/payhere.js` builds an unsigned checkout form (sandbox/live driven by `PF_CONFIG.payhere.sandbox`). After the student pays, the mentor or admin confirms receipt in the PayHere merchant console and clicks **Mark payment received** — exactly the manual-reconciliation spirit of the old `mailto:` fallback. **No `hash` is computed client-side** (it needs the merchant secret).
- **Tier 2 (optional, requires Blaze plan):** `functions/payhere-notify.js` receives PayHere's server-to-server `notify_url` callback, verifies its MD5 signature with the merchant secret, and flips `payment.paymentStatus = 'paid'` automatically. The app works correctly without it; deploying it just stops the manual step. Both tiers write the **same field**, so every payment-status read in the UI works either way.

Configure `PF_CONFIG.payhere` (`data.js`): `merchantId` (public — safe in client), `sandbox`, `currency`. The merchant **secret** is never in client code — only in the Tier-2 function's config.

## Data model (Firestore)

```
users/{uid}/kv/{key}        mirrored PFStore keys: track, assessment, saved, applications,
                            checklist.visa, mentorRequests, calcPrefs, firstMonths,
                            fundsPlans, leads
inbox_leads/{id}            { email, source, at, uid, ts }          create (visitors) · read (admin)
mentors/{uid}               { displayName, fields[], city, bio, langs, availability,
                              approved, active, createdAt }
                            create (self, approved:false) · read (any signed-in) ·
                            update (self: descriptive fields / admin: approved+active)
mentor_requests/{id}        { topic, note, name, contact, studentUid, status, mentorId,
                              introDoneAt, redeem, priority,
                              payment{amountLKR, payhereLink, paymentStatus,
                              paidAt}, at, createdAt, updatedAt, ts,
                              source, callback, takenBy, takenByName }
                            `redeem` ('session'|'audit'|null) marks a plan credit
                            spent and is the ONLY record of that spend —
                            creditsUsed() counts it to derive the balance, so it
                            must survive the round trip. `priority` sorts the
                            open queue. Both are plain extra fields; the create
                            rule constrains name/contact/note and status only.
                            create (any signed-in, status:'open'; OR admin/approved mentor
                            with status:'claimed' for phone & walk-in intake — a mentor may
                            only assign to themselves) · read (admin / approved mentor /
                            owning student) · update (admin / claiming or owning mentor /
                            student-cancel) — claim race closed in rules
mentor_sessions/{id}        { mentorId, mentorName, studentName, studentContact, studentUid,
                              channel, topic, title, date, durationMin, summary, notes,
                              followUp, amountLKR, paymentStatus, method, ref, payerTxn,
                              paidAt, requestId, invoiceNo, createdBy, createdAt,
                              updatedAt, ts }
                            create (approved mentor for themselves / admin for anyone) ·
                            read (owning mentor / named student / admin) ·
                            update (owning mentor — never reassignable / admin) ·
                            delete (never — a cancelled session is marked, not erased)
inbox_consultations/{id}    LEGACY (pre-marketplace) — read-only for admin, no new writes
```

> **Breaking change:** the old `inbox_consultations` create flow is replaced by `mentor_requests`. Existing `inbox_consultations` docs remain readable by the admin (kept read-only in the rules) but new requests go to `mentor_requests`. The local `PFStore` key `consultations` is superseded by `mentorRequests` (`addConsultation` is kept as a thin alias).

Static reference data (`PF_UNIVERSITIES`, `PF_LABS`, `PF_SCHOLARSHIPS`, `PF_VISA_STAGES`, `PF_SETTLEMENT`, `PF_CITY_COSTS`, `PF_PARTNERS`, `PF_TEMPLATES`) ships in `data.js`. `PF_MENTORS` is now **local-only fallback/demo seed data** (powers the aggregate "X mentors across Y fields" stat when Firebase is off) — mentor identities live in the `mentors/` collection in the live flow.

## The account model

Every visitor is signed in **anonymously** on load and is already syncing to Firestore, and signing up later **links** that anonymous account in place rather than orphaning it. So an account wall at the front door would protect nothing a student can feel, while costing the assessment funnel the whole product runs on — the landing page's primary CTA is "Start assessment", aimed at mobile-first students on metered data arriving from search and shared links. What an account actually buys them is *the second device*, and that is only worth explaining once they own something that would be stranded on the first one.

The app therefore asks in three tiers:

| Tier | Where | What happens |
|---|---|---|
| **Never gated** | Assessment, course catalogue, funding, visa hub, Research Studio, templates | The SEO surface and the credibility. Anonymous browsing always works, and the work is saved either way. |
| **Soft prompt** | `softAccountPrompt()` — the roadmap, the third saved item, the first tracked application, a downloaded proposal | Never blocks. An inline modal offering one-tap Google (or email), with a working *"Not now — keep working without an account"*. Fires **at most once per moment, ever**; the record lives in `__softGate`, a `__`-prefixed key the sync layer skips, so remembering a dismissal costs no write quota. |
| **Hard gate** | `requireAccount()` — connecting with a mentor, any purchase | Stops the action and routes to `#account` carrying `?next=`, so signing up resumes exactly where they were instead of stranding them on the dashboard. |

The soft prompt is deliberately **not** on the assessment result screen — a modal there would cover the result the student just earned before they had a chance to read it. It fires on `#roadmap` instead, which is the thing the result produced. The result screen keeps its passive inline nudge.

## Plans, credits and what they actually unlock

`PF_CONFIG.planGrants` (`data.js`) is the single machine-readable statement of what each paid plan gives:

```js
planGrants: {
  explorer: { toolkit: true, sessions: 1, audits: 1 },
  premium:  { toolkit: true, sessions: 3, audits: 1, fullAudit: true, interview: true, priority: true },
}
```

Both the **sales copy** (`#pricing` generates its paid feature rows from this table) and the **redemption flow** read it, so what a student is sold and what lands in their account cannot drift apart. `#kit`'s locked-template card reads it too.

- **Granted** — `grantsFrom(orders)` sums every order with `status:'paid'`. An order only reaches `paid` when the admin marks it so (`firestore.rules` lets nobody else write that field), which is what makes this a real entitlement rather than a client-side claim. Buying both plans stacks.
- **Spent** — `creditsUsed(requests)` counts the student's own `mentor_requests` carrying `redeem:'session'|'audit'`. A cancelled request gives the credit back.
- **Remaining** — granted minus spent, derived on read. **There is no `credits` document**: no second query, nothing new to secure, and no way for a balance to drift out of step with the requests it counts — the same principle as the Accounting ledger and the client book.

A request raised against a credit is prepaid, and the mentor's queue card says so in as many words, so nobody quotes a fee for work the student has already been promised. `priority` (Premium) sorts a request above the rest of the open queue — done in `fetchOpenRequests()`'s client-side sort rather than a Firestore `orderBy`, so the query keeps its single equality filter and needs no composite index.

> Credit *consumption* is derived client-side, like the Starter Kit's template gate. The root of trust is the admin-only `paid` flag on the order; the spend accounting is a soft gate on top of it. Worst case is a queue-position or an extra session, never data access — the rules never widen.

## Monetization

**Live in the product:**

1. **Mentor marketplace** (anchor) — every "Ask a mentor" request opens with a free 15-minute intro, then an optional **paid follow-on session** billed through PayHere (Cards/HelaPay/eZ Cash/Genie). Inline "Stuck at this step? Ask a mentor" hooks on every visa stage, settlement card, roadmap phase, lab card and scholarship pre-fill the request topic and create the request in place. Requests land in the shared `mentor_requests` queue; the platform takes its cut on the paid sessions.
2. **One-time plans** — Explorer and Premium, sold by the platform, delivering the credits above. See *Plans, credits and what they actually unlock*.
3. **Partner placements (affiliate)** — `PF_PARTNERS` rows rendered contextually and clearly labelled: IELTS prep (assessment results when English score is low), forex (cost calculator), insurance + flights (visa pre-departure stage). Replace the placeholder `url` fields with your affiliate links.
4. **Sponsored listings** — add `sponsored: true` to any university/lab/scholarship entry to flag it (chip rendering hook reserved in the explorer).

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
- [ ] Fill `PF_CONFIG.manualPay` (bank account + eZ Cash / FriMi numbers) — these are the "you can pay to" lines in the WhatsApp invoice message a mentor sends an off-platform client; the block is silently omitted while they're blank
- [ ] Fill `PF_CONFIG.org.legalName` once registered, so invoices stop printing as informal payment confirmations
- [ ] Publish the number people should ring, and tell mentors and the admin to use **Someone called** for every enquiry that arrives by phone or WhatsApp — that is what puts a caller with no account into the queue, the client book and the invoice trail
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
