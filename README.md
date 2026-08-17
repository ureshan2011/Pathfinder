# PathFinder

PathFinder helps Sri Lankan students get into a **master's or a PhD** in New Zealand — compare pathways, browse the full NZQA postgraduate course catalogue, find supervisors and scholarships, generate a personalized roadmap, walk the visa process step by step, plan the move, and track applications from first email to enrollment.

### Study tracks

The product serves **two journeys on one platform**, chosen by the student on the landing page (`app.html?track=masters|phd`) and switchable any time from the sidebar. The track is stored as the `track` key in `PFStore` (so it syncs like any other user data) and read everywhere through `trackCfg()` / `isMasters()` in `app.js`.

**Nobody is put on a track without being asked.** `PFStore.getTrack()` degrades an unset value to PhD — the right thing to do with a stored value that can't be parsed, and the wrong thing to apply to a student who was never asked. So `route()` puts the track question in front of the **first view of any kind** (`needsTrackChoice()` in `app.js`), not just in front of `#assessment`: `index.html` links directly into `#assessment`, `#courses`, `#cost`, `#funding`, `#kit`, `#visa`, `#settlement`, `#mentors`, `#dashboard` and twelve subject tiles, and every one of those entry points would otherwise pick PhD silently — showing a master's applicant domestic fees, a doctoral stipend, and a visa-funds figure understated by tens of thousands of dollars a year. The hash is left untouched, so answering the question drops the student on the view they actually asked for. Exempt: the role/system views (`account`, `admin`, `mentor`, `billing`, `pricing`), where a study track is meaningless, and any session that is already a mentor or an admin.

Nearly everything that differs between the two lives in one object, **`PF_TRACK` in `assets/js/data.js`** — the fee model, the entry bar, the timeline shape, and the words. Add a difference there rather than branching in a view. Where a single fact in a longer data record differs, the record may carry a `masters_<field>` alternate that the renderer reads through `tv(obj, field)`.

**One thing never varies by track: immigration content.** `PF_TRACK` carries no work rights, post-study or dependants fields, and no visa, work-condition or family record carries a `masters_` alternate. Selecting an immigration rule for someone on the basis of something we know about them is applying that rule to their circumstances, which under the Immigration Advisers Licensing Act 2007 is licensed work — an offence to provide unlicensed, whether or not money changes hands, and work-rights content sits outside the offshore education-agent exemption in any case. Published immigration settings live in **`PF_VISA_NOTICES`**: one unbranched list, each item labelled with the group INZ publishes it for and linked to the INZ page, so the reader matches it against their own visa. The boundary is enforced in code by **`PF_IMMIGRATION_TOPICS`** / `isImmigrationTopic()` in `app.js`: any topic in that set renders `adviserReferral()` — INZ and the licensed-adviser register — instead of a mentor request form, is filtered out of every mentor picker by `mentorTopicEntries()`, and is rejected again on submit. See `docs/NZ_ACCREDITATION.md` §0.

The differences that matter most are financial and legal, not cosmetic:

| | PhD | Master's |
|---|---|---|
| Tuition | **Domestic** rate, ~NZ$8,500/yr | **Full international** rate, ~NZ$33–58k/yr |
| Stipend | NZ$28–33k/yr, usually automatic with admission | None — awards discount fees, and have hard deadlines |
| Work rights | Unlimited hours | 25 hrs/week in semester, full-time in breaks |
| Admission | Supervisor-led, enrol any month | Programme-led, February and July intakes |
| NZQF levels | 10 | 8 (PGDip/PGCert/GradDip/Hons) and 9 |

Getting the first row wrong understates a master's applicant's visa-funds requirement by **tens of thousands of dollars a year**, which is why `computeFunds()` branches on the track rather than sharing one tuition line.

**Fully static. Zero build step. Cloud-first on Firebase (free Spark plan) — or runs 100% locally when Firebase is left unconfigured.**

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Landing page — portal hero, the seven-stage journey, the register, mentors, and the assessment CTA |
| `app.html` | The application — hash-routed SPA, track-aware |

### The landing page

Four chapters and a close, in that order, because the page has exactly two things to say and neither of them is a feature list:

1. **The journey** — seven stages on a dashed rail: *where you stand · what to study · what it costs · how to pay for it · the application · the visa · landing*. Each stop links into the view that handles it. This is the "end to end" claim made checkable — a student can see which stage they are standing on and click it, rather than being told the platform "does everything". On reveal a vermilion route **draws along the rail** with a lit head running ahead of it, lighting each stop as it arrives and bringing that stop's words up behind it. The lighting is driven by the *same* progress value that moves the line, against node positions measured from the DOM — not by parallel `setTimeout`s — so a stop can never light before the light reaches it, at any frame rate or in either orientation (the rail flips vertical under 920px). Reduced motion gets the finished state with no travel.
2. **Courses & cost** — the NZQA register (1,716 qualifications, 51 providers, 281 scholarships), then the PhD/master's fee split. The counts are the credibility; the fee split is the one fact that changes a family's plan, so it is stated for **both** tracks rather than the flattering one.
3. **People** — mentors as the half a document cannot do. No named individuals, no counts, no testimonials: there is no public directory in the app, and this audience has been oversold by agents. It promises only what the request lifecycle actually delivers — one question into a shared queue, first 15 minutes free, fee agreed before anything paid starts, mentors invited and reviewed.
4. **Straight answers** — what PathFinder does and, in as many words, that it cannot get anyone admitted.

The close is the **first question of the assessment, live on the page** — answering it *is* the entry point, not a step before it — with the master's/PhD choice as the two buttons beside it and the email capture demoted to a quiet row underneath, where someone who is not ready to start belongs.

Things the page deliberately does not carry: invented testimonials, provider logos, success rates, counts of anything that isn't in a committed dataset, and any figure the app cannot show a source for. Every number on it (`1,716`, `51`, `281`, the fee ranges) is baked in from `assets/js/catalogue.js` or `PF_TRACK` — when the catalogue is rebuilt, check them.

### App views (`app.html#<view>`)

- `#assessment` — 7-question pathway assessment (< 5 min) → readiness score + recommended entry route
- `#roadmap` — interactive month-by-month roadmap, personalized from the assessment, with contextual mentor hooks
- `#research` — **Research Studio**: a free, no-backend topic & proposal generator with a **New Zealand lean**. The student answers a few questions (field, topic in their own words, motivating problem, methodology, keywords), then PathFinder searches **real, recent academic literature** via free, no-key, browser-callable scholarly APIs (**OpenAlex**, with **Crossref** as a resilient fallback, then a degraded offline scaffold). It retrieves **by relevance, not just citations** (the old citation-only sort hid relevant niche work), running **two OpenAlex passes — a global one and one filtered to NZ-based authors** (`authorships.institutions.country_code:NZ`) — and reads each author's institutional affiliation straight from the API. For the *best-published NZ authors on the topic* it uses OpenAlex's native **`group_by=authorships.author.id` analytics** (an accurate ranked author facet, not a guess from a small page of papers), then blends that with the retrieved papers' authors and a **precomputed per-field NZ-author index** (top authors by total citations, shipped in the corpus index) — so leading NZ researchers surface with their campus and citation impact even from a thin result set or fully offline. It produces (1) a **literature map** — top recent papers (NZ-authored ones chipped), most-active authors (their NZ campus shown), trending sub-themes, a year histogram — plus a warm **"Research happening in New Zealand"** panel that surfaces those NZ researchers *indirectly, as the authors of the work the student is reading* (never labelled "your supervisor"), alongside the honest case for a NZ PhD (domestic fees, work rights, post-study visa) and links into Explore / the Starter Kit; **3–5 candidate research directions**; and **matched NZ research groups** from the dataset. Then (2) it expands any chosen direction into a **full structured proposal draft** (working title, abstract, background with inline citations **prioritising NZ-authored work**, research gap, research questions, methodology, indicative 3-year timeline, a "the people behind your citations — in New Zealand" section, NZ research groups, formatted references). The NZ side is anchored to a **large pre-scraped corpus of 10,000+ recent NZ-authored papers** (`scripts/scrape-nz-corpus.js` → a tiny index `assets/js/research-corpus.js` + per-field shards in `assets/js/corpus/`). The corpus is **sharded by field and lazy-loaded one shard at a time** — when a student searches, only that field's ~1 MB shard is fetched, never all 10k — so it stays fast on mobile and works fully offline. On top of that it's a **hybrid**: the live NZ-filtered OpenAlex queries still run for freshness/global context, and if both the corpus and the live calls are unavailable, a **curated seed** derived from `PF_LABS` (with `PF_UNI_MATCH` / `PF_NZ_INSTITUTES` in `data.js` mapping institution names to campuses) keeps the NZ panel populated. Rebuild the corpus any time with `node scripts/scrape-nz-corpus.js` (resumable, polite-pool). Copy / download `.md`/`.txt`, auto-saved to the account (one debounced `kv` write), and a one-click "send to a mentor for review" hook. No API key, no Cloud Function, no paid services — the literature calls hit external servers, not Firestore, so it stays well inside the free Spark plan.
- `#courses` — **Course Catalogue**: the NZQA postgraduate register, browsable. **1,716 current qualifications** (951 at level 8, 700 at level 9, 64 doctorates) across the **51 providers** that teach them — 8 universities, 14 polytechnics and 29 private colleges — indexed by the **NZQA subject-area taxonomy** (461 nodes / 11 subject roots with postgraduate study). Drill down subject → sub-area, filter by level, qualification type and provider, search by title or provider, and open any qualification for its entry requirements, purpose, graduate profile, further-study pathway, offering providers with real contact details, published fees where they exist, and a link to its NZQA record. Defaults to the active track's levels and to the subject area the student's assessment pointed at. Generated by `scripts/sync-astra-catalogue.js` — see *Course catalogue* below.
- `#explore` — the 8 NZ universities with their 12 flagship research labs and named supervisors (PhD track), plus the other **43 providers** from the catalogue — polytechnics and private colleges — with live per-provider qualification counts and contact details, ranked by how much postgraduate study each teaches
- `#cost` — **Cost & payback**: the master's track's own high-stakes screen — what a New Zealand master's *actually* costs a Sri Lankan family, end to end, and how long it takes to earn back, built from the courses they have already shortlisted. Needs a **named account and Explorer or above**. See *Cost & payback* below.
- `#funding` — **281 real scholarships** from the provider register, filtered to the active track's study levels, with an international-students-only filter and domestic-only awards excluded; falls back to the 8 curated doctoral awards in `PF_SCHOLARSHIPS` if the shard fails to load. Plus track-appropriate immigration/visa updates
- `#visa` — **Visa Hub**: the 7-stage NZ student-visa process with Sri Lanka-specific "where to go" guidance and a persistent checklist + progress bar — led by **What happens to Sri Lankan applications**, Immigration New Zealand's own decision record: the approval rate for Sri Lankan student visa applicants, the decline count beside it, and the ten-year trend. Free. Premium adds the breakdown by application criteria and the comparison against five peer nationalities. See *Government data* below.
- `#settlement` — **Settle In**: first 48 hours, banking/IRD, transport, flat-hunting, family & schools, apps — plus a three-tool **Settlement & Cost-of-Living** module: a 90-day **First-months simulator** (stepper + draining balance gauge), an editable **Funds planner** (monthly living cost, total pre-departure funds to arrange, INZ-minimum and doctoral-stipend benchmarks, partner-income scenario, weekly/monthly toggle, saved scenarios), and a **"What can NZ$20 buy?"** purchasing-power explorer. The planner/simulator visualisations use Three.js (lazy-loaded via importmap) with a guaranteed 2D table/bar fallback for reduced-motion and low-end devices.
- `#mentors` — **Mentors**: the public, two-tab marketplace view — **Ask a mentor** (one general request form, aggregate mentor stats) and **My requests** (the student's own requests with live status + payment chips). No named individual mentors are listed; requests join a shared claim queue. A student holding a paid plan sees their **remaining credits** on the form and can spend one on the request they're about to send (see *Plans, credits and what they actually unlock*); with no plan, or no balance left, the form is exactly as it was. **Connecting with a mentor requires a free account** — explorers can browse the network and read everything, but the "Ask a mentor" form (and the inline "Stuck at this step?" hooks everywhere) is account-gated, so each request is tied to a real, signed-in person and trackable across devices; anonymous device sessions are nudged to `#account` first. Likewise **every purchase requires an account** (`PFPay.startSession` / `startOrder` both gate on `PFCloud.isSignedIn()`). There is **no public "become a mentor" CTA** — mentoring is invite-only (see `#mentor`). Topic pre-fill via `#mentors?topic=<slug>`
- `#mentor` — **Mentor Dashboard** (invite code → sign-up → pending review → admin-approved): the open-requests queue with first-come-first-served **claim**, your claimed requests, a **Session log**, a **People** client book, an at-a-glance insights strip (open / active / delivered / earned / invoiced-unpaid), the 15-min-free → paid lifecycle, and **Generate payment link** (PayHere). The **Session log** records every session you actually deliver — including the many that arrive over **WhatsApp or a phone call** and never touch the request queue — with who, when, how long, over which channel, what you covered, private notes, agreed next steps, the fee and its payment state; each record generates a **PDF invoice or receipt** in one click ("Save & invoice" issues it as you write the record up). Claimed requests get a **Log session** button that pre-fills the form from the request. Becoming a mentor is **invite-only**: a vetted person must enter the mentor invite code (`PF_ROLE_CODES.mentor`) before they can create a mentor account, and the account stays pending until an admin approves it. Sidebar link appears only for approved mentors.
- `#billing` — **Billing**: an **Included in your plan** card (mentor sessions and document audits still unspent, plus the toolkit/priority/interview-prep flags), then the student's own one-time unlocks and every mentoring session logged against their account, each with a downloadable **PDF invoice/receipt**. A one-time unlock is easy to buy and then forget — an order row reading "Premium · LKR 24,990 · Paid" doesn't tell anyone they still hold two sessions and an audit — so the balance card leads, and links to where the credits are spent. Private mentor notes are never shown here.
- `#account` — **Account**: the unified front door for the three login roles. Clients/students can create a free account (no code) or sign in to sync across devices — **login is optional for explorer basics** (assessment, roadmap, explorer, funding, Research Studio, templates), and anonymous browsing always works for those. It becomes **required only to connect with a mentor or to make any purchase**. Vetted mentors are routed to the invite-only mentor sign-up, and admins to the admin sign-in. See *The account model* below for where the app asks, and why it never asks at the door.
- `#dashboard` — the **client/student dashboard**, and the first tab of the **profile strip** (see below): a metrics grid, a derived **insights** card (readiness, application funnel, active mentor requests, visa progress, next-step nudge, sync status), application tracker, visa progress, and your mentor requests. On a **cold start** — nothing assessed, saved, tracked or checked — it renders `renderFirstRun()` instead: one action and an honest account of what the assessment produces. `#dashboard` is both the app's default route and the landing page's "open the board" CTA, so it is the first screen a large share of visitors ever see, and rendered in full on an empty account it is four zeroes, a "—%" readiness figure and an empty application form competing with the invitation. The full dashboard returns the moment there is anything real to put on it (the test is "is there anything to show?", not "did they take the assessment?", so a student who shortlisted a course but skipped the assessment still gets the real thing).
- `#kit` — Starter Kit: 21 templates across emails, application documents, research & career, and logistics. Templates tagged `track:'masters'` (statement of purpose, programme comparison sheet) or `track:'phd'` (supervisor emails, 3-year research plan) show only on that track; the rest serve both
- `#admin` — **Admin panel** (access-code + password-gated): overview analytics with a **pending-approvals** callout, **Accounting** (a unified ledger across every revenue source, with one-click PDF invoices/receipts), email leads, **Mentors** (approve / reject / deactivate), **Requests** (all mentor requests with status, claimed-by, payment status/amount + CSV export), **People** (every person on record across all mentors — searchable, with each one's full consultation history and how much they still owe; CSV export), **Sessions** (every mentoring session logged by any mentor — filter by mentor and payment state, log one on a mentor's behalf, CSV export, PDF invoices), **Orders**, and synced user records. A **Someone called** button sits above the tabs for the phone and walk-in enquiries that arrive with no account behind them. The sign-in asks for the admin access code (`PF_ROLE_CODES.admin`) then the Firebase admin password. Visible only to the admin account; ordinary visitors are blocked by Firestore rules. Reachable from the "Admin" link in the sidebar footer.

## Architecture

```
index.html                 landing (portal hero, seven-stage journey, mentors, assessment CTA)
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
  scrape-provider-quality.js  rebuilds provider-quality.js from NZQA organisation pages
  sync-govt-data.js        rebuilds govt-data.js from Immigration NZ and MBIE
  build-corpus-index.js    rebuilds the corpus index from existing shards
  js/store.js              PFStore — storage layer (localStorage, change events, merge metadata)
  js/contact.js            PFContact — pure builder for the platform's WhatsApp / tel links,
                           with the context and ref each message carries (see below)
  js/payhere.js            PFPayHere — pure PayHere checkout-link builder (Tier 1, no backend)
  js/invoice.js            PFInvoice — zero-dependency PDF writer: invoices, receipts,
                           and the family decision sheet (#cost)
  js/roi-data.js           hand-verified, DATED cost & earnings dataset — tuition by
                           provider tier and subject, wages, tax, graduate salaries
  js/roi.js                PFRoi — pure cost-to-payback model + cheaper-route comparison
  js/provider-quality.js   GENERATED — NZQA's published record per provider (category,
                           confidence statements, report links, Code of Practice status)
  js/govt-data.js          GENERATED — Immigration NZ visa decisions + MBIE rent medians,
                           each block carrying its own attribution and licence
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

## Government data (Immigration NZ · MBIE)

Three published New Zealand government datasets are generated into `assets/js/govt-data.js` (~17 KB) and committed, the same way the catalogue and the research corpus are. They are lazy-loaded — `#visa`, `#cost` and the Settle In housing tab pull them; nothing else does, and the dashboard's first paint fetches none of them.

```bash
node scripts/sync-govt-data.js     # no key, no token, no account
```

| Dataset | Publisher | What PathFinder shows |
|---|---|---|
| Student visa applications decided | Immigration New Zealand | Approvals and declines for Sri Lankan applicants over ten financial years, plus the same by application criteria and for five peer nationalities |
| Work visa applications decided | Immigration New Zealand | The **Post-study — Open** series — the visa the payback model on `#cost` is scored against |
| Rental bond data by territorial authority | MBIE / Tenancy Services | Median and quartile weekly rent for the six PathFinder cities, refreshed monthly |

### Why only these three

Ten government datasets were reviewed. The most valuable ones after these — **Education Counts** (graduate earnings by field of study; international enrolments by country of citizenship) and the **TEC Educational Performance Indicators** (per-provider completion and retention) — are free, but **unreachable from a server**: `educationcounts.govt.nz` and `catalogue.data.govt.nz` both sit behind bot protection that returns **403 to any datacentre IP**, regardless of user agent. A browser downloads them fine. So those become a *download once a year by hand, commit the file, parse the committed file* pipeline — the pattern `data/subject_areas.json` already follows — rather than anything this script can do. The **Tahatū occupations API** (TEC, 800+ occupations with IRD-derived pay data) needs a key requested by email. None of that is implemented; it is written down so the next person does not re-derive it.

### Parsing PDFs safely

Immigration NZ publishes tables, not data — 50-page PDFs — so extraction is positional, and positional parsing of a document that can be re-laid-out at any time is exactly how a wrong number reaches a family deciding whether to spend LKR 25 million. Three defences, all in `sync-govt-data.js`:

- **A wide table splits across pages.** One row's ten years arrive as nine triples in one place and the tenth somewhere later. The parser walks every occurrence of a row label in document order and keeps filling years until the row is complete.
- **Every table is rendered twice**, the second time with zero cells collapsed to blanks, which would parse into garbage. The parser stops as soon as a row is full, which is always inside the first copy.
- **The publisher prints a grand total on every row.** That is a checksum handed over for free: if our ten yearly totals do not sum to their printed total, our column alignment is wrong. It is *required* to match. Any failure drops the row, reports it, and **exits non-zero without writing a file** — a missing panel is recoverable, a confidently wrong percentage is not.

### Licence and attribution

Both publishers permit reuse **on condition of attribution**, and neither permits implying endorsement:

- **Tenancy Services** states **CC BY 3.0 NZ** on its rental bond page and requires credit to *"The Ministry of Business, Innovation and Employment"*.
- **Immigration NZ** statistics are Crown copyright released under **NZGOAL**, which defaults to CC BY.

So attribution is treated as a licence term rather than a footnote. Every block in `govt-data.js` carries `src`, `srcUrl`, `attribution` and `licence`; `govtSourceLine()` in `app.js` prints them directly beneath the figures on every panel, together with the date the source file was prepared; and `disclaimer.html` §05 carries the full attribution list and an explicit no-endorsement statement. **Do not strip those fields** — the generated file is not licence-compliant without them.

We reduce, we do not restate: only the rows PathFinder displays are kept, values are copied unchanged, and the one derived number — the approval percentage — is computed in the browser from the published approved/declined pair.

### Where the paywall falls, and why

The **headline figures are free**. What share of Sri Lankan student visa applications were approved last year, with the decline count next to it, sits on `#visa` for anyone — signed in or not, paying or not. A family deciding whether to spend their savings should not have to pay to read a public statistic about their own odds, and charging for one would be a poor reading of a CC BY licence besides.

`#cost` draws its line in a different place, because what it sells is not a published fact but a costed personal plan — see *Cost & payback → Who can open it* below.

`officialData` (Premium, in `PF_CONFIG.planGrants`) buys the **analysis built on top**: which application route declines most, how Sri Lanka sits against the five nationalities an agent will have name-dropped, and the decade of post-study work visa decisions the `#cost` payback model quietly depends on.

### The rent figures are not a drop-in replacement

A bond is lodged against a **whole tenancy**, so MBIE's median is what an entire house or flat costs. `PF_CITY_COSTS` budgets **a room in a shared one**. Substituting the first for the second would roughly double every living-cost figure in the app and break the funds planner, the 90-day simulator and the payback model at once. So the bond median is shown *beside* the app's figure as a market reference, with the difference stated in words — on `#cost` and in Settle In → *Finding a home* — and never written into `PF_CITY_COSTS`.

### Keeping it current

Immigration NZ regenerates its files roughly monthly and Tenancy Services releases monthly. Re-run the script and commit; every panel prints the source date, so a stale dataset says so on screen rather than quietly misleading someone.

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

### The platform's own WhatsApp line

The number lives in **one place** — `contactPhone` / `contactPhoneE164` / `whatsapp` in `PF_CONFIG` (`data.js`), written three ways because display, `tel:` and `wa.me` each need a different format and a hand-typed variant in any one of them is a dead link nobody notices. Every link on the site is built from those by **`PFContact`** (`assets/js/contact.js`), a pure string builder in the same spirit as `payhere.js`. Nothing hard-codes the number except the four legal pages' contact blocks, which are static documents by nature.

Two things the links do that a bare `wa.me` link does not:

- **They carry context.** A message that says only "hi" costs a round trip to work out who it is and what they want. Every link prefills a sentence naming where the person was — the view, the study track, the topic they had selected — so the first message already says it. The **raw** stored track is used, never `PFStore.getTrack()`: that degrades an unset value to PhD, which is right for a stored value that won't parse and wrong for a visitor who has never been asked, and `#account`/`#pricing` are both track-free views someone can reach before choosing. A message claiming the wrong degree is worse than one that names none.
- **They carry a reference.** On `#mentors`, "Open WhatsApp" opens the chat *and* — when the student is signed in, so the record has an owner — writes what they typed into the same `mentor_requests` queue with `source:'whatsapp'`. The message quotes a short ref (base 36 of the record's own id — no second field to store, and unlike the last six digits of a millisecond clock it doesn't repeat every 17 minutes), and the mentor and admin cards print the same ref beside a **WhatsApp** chip. That is what ties a chat on a phone to a row on a dashboard.

The button is deliberately **not** account-gated. The gate on in-app requests exists so a request is tied to a real person across devices; a phone number is a phone number, and hiding it until someone signs up would be theatre. Signed out it opens the chat and writes nothing. When no contact was typed, the request's `contact` field is the digit-free string `via WhatsApp` — writing *our* number there would key every WhatsApp enquiry to the same person in the client book, since `contactKey()` matches on the last nine digits.

**What this is not: inbound.** Messages do not flow back into PathFinder by themselves, and no amount of client-side code can make them. That needs the WhatsApp Business Cloud API — a Meta business account, a verified display name, a message template review, and a public HTTPS webhook to receive `messages` events, which on Firebase means a Cloud Function and therefore the **Blaze plan** this project deliberately stays off. The design above is the honest free-tier answer: the *outbound* half is automated and pre-filled, and the *inbound* half is the existing "Someone called" form, which takes about fifteen seconds and already produces the identical record. If the project ever moves to Blaze, the shape to add is `functions/whatsapp-webhook.js` alongside `payhere-notify.js`, calling the same `createIntakeRequest()` path — the data model needs no change at all, because a WhatsApp enquiry is already a first-class `source`.

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

## Cost & payback (`#cost`)

A PhD student is walking toward money — domestic fees and a stipend. A master's student is walking toward a bill: full international tuition, no stipend, one to two years. On the University of Auckland's own published 2026 rates an IT master's in Auckland comes to **NZ$180,394 all in**, or **NZ$127,926** after part-time earnings — about **LKR 25 million**. For a family in Colombo that is not a tuition figure. It is a house.

Nobody in that market does this arithmetic honestly, for a structural reason: every education agent is paid a percentage of tuition, so recommending the cheaper qualification costs them money, and the cheaper qualification therefore never gets mentioned. **PathFinder takes no provider commission**, which is the only reason this screen can exist — and it says so, on the screen and on the printed sheet.

### Who can open it

**Signed in with a named account, on Explorer or above.** Two reasons, and they are really the same reason twice.

The screen is only worth anything if the plan is genuinely the student's own — seeded from the courses they shortlisted, the funds check they took and the assessment they sat, saved, and still there when they open it again on the laptop of whoever is paying. None of that survives an anonymous browser session, so the account is not a toll booth; it is the feature working. And the calculator is the one place on the platform that answers with a *costed personal plan* rather than a published fact — which is exactly the piece an agent is paid a percentage of tuition to fudge, and exactly what a platform taking no provider commission has to be paid for instead.

`roiAccessWall()` paints three distinct screens rather than one generic upgrade box, because the three states need different things said to them:

| State | Screen |
|---|---|
| Not signed in | What the calculator does, why an account (not a toll — the plan has to survive the conversation at home), and what stays free regardless |
| Signed in, entitlements not yet resolved | A one-line "opening your plan", then a repaint |
| Signed in, no `costModel` | What Explorer opens, the one-time price, **why this one is paid at all**, and what a student can still do for nothing |

Two things sit deliberately *in front of* the wall: the **PhD note** (nobody should be asked to pay to be told there is nothing here for them), and the `#cost` **profile tab's own status chip**, which reads `Sign in` or `Explorer` so a student can see the wall coming instead of tapping into it.

What has **not** moved behind it: the international fee bands on the landing page, the published fees in the catalogue, the visa-funds figure and the Funds Check, the scholarship register, and the headline government statistics on `#visa`. A student can still work out roughly what they are facing without paying anything.

> **Deviation from the original design.** This screen used to be free, on the stated principle that "telling someone the truth about what they are about to spend should never sit behind a paywall". Charging for it is an explicit owner decision, recorded in `DEVIATIONS.md`. The mitigation is the free tier above, and copy on the wall that says plainly what it costs and why.

### What it is built from

Every input on this screen is something the student has already answered somewhere else, so `roiSeed()` reads it back rather than asking twice:

| Seeded | From | Storage |
|---|---|---|
| Subject area | The assessment's NZQA subject-area root | `assessment.result.subjectArea` |
| Provider, subject, programme length | The **newest shortlisted course**, resolved against the register (240 points → 2 years, 180 → 18 months, 120 → 1 year) | `saved[kind:'course']` → `PF_CATALOGUE.quals` |
| City, who is coming | The Funds Planner's saved preferences | `calcPrefs` |
| Who is coming, funds already arranged | The visa Funds Check | `fundsCheck` |

A plan the student has **edited always wins** — their saved `roiPlan` is merged last — so a course saved later never silently overwrites a number they typed. The state is rebuilt on every entry to the view rather than memoised, so work done elsewhere since the last visit is picked up.

The *Built from your own answers* card makes all of this visible: it names the screen each figure came from, marks what is and is not currently in the plan, offers one tap to adopt anything that is not, and lists the shortlist so any saved course can be costed in a single click. Where a student has done none of it yet, every row becomes the invitation to go and do it — which is a better use of the space than an empty state. It is a **live comparison**, recomputed on paint, never a record of what was seeded, so it cannot claim a figure is in the plan after the student has changed it.

Published programme fees from the register are shown beside a shortlisted course but **never written into the model**: the register does not say whether its figure is per year or for the whole programme, and guessing wrong moves the total by a year's tuition. The screen asks the student to check and type it in.

### Keeping your place while you change it

Every field on this screen used to call `route()`, which rebuilds the entire view. On a desktop that was merely wasteful. On a phone it was the bug people actually reported, three times over: the plan card is a `<details>` whose open state was recomputed from `window.innerWidth`, so a full re-render **slammed the form shut mid-entry**; the input being typed into was destroyed and rebuilt, so **focus and the cursor went with it**; and `route()` ends in `window.scrollTo(0, 0)`, so the student was **thrown back to the top of the page** after every single change.

So a change now repaints exactly two regions — `#roi-hero` and `#roi-results` — plus the two summary lines above the form, and never touches the form, the plan card's open state or the scroll position (`roiRepaint()`). The plan card's open/closed state belongs to the student (`roiPlanOpen`), falling back to the viewport width only until they have expressed a preference. Number fields update as they are typed, debounced. Every button that changes the plan is **delegated** from the document rather than bound per render, which is what lets the results be replaced wholesale without re-wiring anything — and `roiSyncFields()` pushes state back into the form when a change comes from outside it (a shortlisted course, a cheaper route, an "adopt this" button).

### What it computes

`PFRoi.compute()` (`assets/js/roi.js`) is pure — no DOM, no storage, no network — because these numbers get printed on a document a student hands to their father, so they have to be testable.

1. **Total cost, not the sticker fee.** Tuition is the number providers publish; airfares, the visa, medicals, police certificates, insurance, a rental bond and a first set of furniture are the ones families discover afterwards. Living costs come from the same `PF_CITY_COSTS` the Funds Planner uses, so the two tools can never quote a family two different rents for one city.
2. **The income side.** Master's students may work **25 hours a week in semester** (raised from 20 on 3 November 2025) and full-time in breaks, at the adult minimum wage — deliberately the floor, not an average. Note the asymmetry the UI keeps repeating: this money reduces what the family spends, but INZ will not count it toward the visa funds requirement.
3. **Payback against the visa.** Take-home pay after PAYE and the ACC earner levy, less the cost of living in the same city, gives the annual surplus that actually repays the investment — and it is scored against the **3-year post-study work visa**, not an open-ended career. A payback longer than three years is a plan that depends on residence, which is a separate decision and never guaranteed.
4. **Cheaper routes to the same NZQF level.** The register holds **700 level-9 master's qualifications, and 111 of those offerings are at polytechnics (70) and private colleges (41)** rather than universities — the same level on the same framework, typically at close to half the fee. `cheaperRoutes()` compares the student's plan against **named providers** teaching the same subject at the same level, each with its own published fee and the saving, **and the trade-off stated**. Named beats abstract here: "University of Waikato, saves NZ$21,026" is a claim a family can check; "a polytechnic" is not.

### The provider picker

Tuition is resolved **per provider**, most-specific source first, and every branch reports where its number came from so the screen can always answer the only question that matters when a family is reading it — *where did you get that?*

1. **The fee you were quoted.** Always wins, and the UI pushes for it.
2. **That provider's published figure for that subject.** Auckland, AUT and Waikato are transcribed per subject from their own 2026 schedules.
3. **That provider's own published range**, where they set fees per programme rather than publishing one schedule.
4. **The tier band**, for any of the other 51 register providers — clearly labelled an estimate.

Only three providers are transcribed in full, and that is deliberate rather than lazy: an invented per-subject figure for a provider that does not publish one would look identical to a real one on screen, and a family would act on it. Where the number is not known, it is a band, it says so, and it asks for the real quote.

### The family decision sheet

The student doesn't hold the money. A parent or an uncle does — someone who has never been to New Zealand, will never open the app, and is being asked to liquidate savings or borrow against property. So the deliverable is a **printable sheet addressed to them**: total cost, the offsets, what is still to arrange, what happens after graduation, and the cheaper routes that were considered and rejected — led in **LKR**, with NZ$ alongside for anyone checking against a provider's website.

`PFInvoice.downloadSheet()` writes it with the same zero-dependency PDF writer that issues invoices — no library, no CDN, no backend, no Blaze plan.

### Where the numbers come from

`assets/js/roi-data.js` is hand-maintained on purpose: the sources are published schedules that move once a year on a known cadence, and a wrong figure here is worse than a missing one. Every entry carries its own `src` and `asOf`, the module carries a `verified` date, and the UI prints it — so a stale dataset says so out loud instead of quietly misleading someone.

| What | Source | As of |
|---|---|---|
| Tuition — Auckland, AUT, Waikato | Each provider's own published international fee schedule, transcribed per subject | 2026 |
| Tuition — Massey, Victoria, Canterbury, Lincoln, Otago | Whole-provider range; they publish per programme, so the UI asks for the quoted fee | 2026 |
| Tuition — polytechnics | Published 2026 international schedules (Wintec, Ara, Otago Polytechnic) | 2026 |
| Graduate earnings | Education Counts, *What young graduates earn when they leave study* | 2024 |
| Master's premium | Ministry of Education, *Moving on up* — master's +86% vs bachelor's +53% over the national median wage | — |
| Minimum wage | employment.govt.nz — NZ$23.95/hr | 1 Apr 2026 |
| Student visa fee | immigration.govt.nz — Fee Paying Student Visa, "from NZD $850" | 2026 |
| PAYE + ACC earner levy | ird.govt.nz — brackets unchanged, levy 1.75% | 2026–27 |
| Work rights, post-study work visa | immigration.govt.nz | 2026 |
| NZ$ → LKR | mid-market, 196.7 — a reading anchor, never used to decide anything | 2 Aug 2026 |

**Re-verify every January, and again each April** when the minimum wage and the ACC levy reset. Bump `PF_ROI.verified` when you finish a pass.

> **The honesty constraint.** The published earnings figures are for **domestic** New Zealand graduates. An international graduate holds a 3-year work visa and no guarantee of residence, so they are not the same population and the numbers are an upper reference, not a forecast. This is stated on the screen that shows them and printed on the sheet. Where a field has no published figure (`PF_ROI_NO_FIELD_EARNINGS`), the model says so and falls back to the all-graduate median rather than inventing one; creative arts is published as the lowest-earning group with no quotable figure, so it is flagged rather than guessed.

### Who you'd be handing the money to

The cheaper-routes comparison is the most dangerous thing on this screen: it is very good at finding a lower number, and a lower number is not the same as a better decision. So the quality evidence sits **before** the savings, and a compressed version of it rides on every comparison row — the regulator's finding and the saving have to be legible in the same glance, or the comparison is just an argument for the cheapest option.

`assets/js/provider-quality.js` (generated by `scripts/scrape-provider-quality.js`) holds **NZQA's own published record for all 51 providers**: provider category, the dated statements of confidence behind it, the external quality assurance report history with direct PDF links, and Code of Practice signatory status. Nothing is scored, ranked or editorialised by PathFinder — we put the regulator's evidence in front of the student with a link and let them read it.

> **The External Evaluation and Review system has ENDED.** The Quality Assurance of Tertiary Education Providers Rules 2026 came into force on **19 January 2026** and revoked the EER Rules 2022. NZQA requires that a quoted provider category is shown **with the year it was received and a statement that the system no longer operates** — `PF_ROI_QA.systemNote` carries that wording and the UI prints it next to every category. Never render a bare "Category 1" badge.

Two things the scraper is careful about, because getting either wrong would be worse than showing nothing:

- **Universities carry no category by design.** They are audited by the Academic Quality Agency and CUAP, not evaluated by NZQA, so a blank is recorded as `naReason` and displayed as an explanation — never as a bad score.
- **Code of Practice status is `true` or unknown, never `false`.** University pages use a thinner layout with no Code section at all; recording that absence as `false` would print "not a Code of Practice signatory" under the University of Auckland, which is both wrong and damaging.

`qualityDelta()` warns when a cheaper route means accepting a materially worse regulatory record, and returns `null` when either side has no category — comparing a number to a blank would manufacture a warning out of nothing.

**Why there are no Google or Glassdoor ratings.** They are a handful of self-selected reviews, frequently from people who never studied at the provider (and on Glassdoor, from staff rather than students). Republishing them would mean presenting opinion as evidence, and neither platform permits it. For what a place is actually like to study at, the product's answer is to ask someone who did — which is what the mentor network is for. The reasoning lives in `PF_ROI_QA.noReviewsNote` so it survives a redesign.

### What's free and what isn't

**Explorer** (`costModel`) opens the screen: the plan editor, the total, the breakdown and the payback, for a student signed in with a named account. **Premium** (`costCompare`) adds what to *do* about it — the cheaper-route comparison and the family decision sheet — and `officialData` adds the decade of post-study work visa decisions the payback is measured against. See *Who can open it* above for what stays free, and `DEVIATIONS.md` for the change of position.

### Saying what it is before saying what it costs

The commonest reaction to this screen was *"I don't know what I'm looking at"* — fairly, since it opened on a five-figure number in a currency the reader is converting in their head, under a heading about payback, above nine unexplained form fields. The audience is mostly meeting the New Zealand system for the first time: they have never seen a fee schedule here, do not know that student work is legal (let alone capped at 25 hours), and do not know that it is the *qualification level* rather than the university's name that earns the visa.

So the screen now leads with **How to read this page** — three numbered steps, in the order the page is read, before anything numeric. It is deliberately not a `<details>`; a collapsed explanation is an explanation nobody reads. Every form field carries one plain sentence under its label saying what it is for, and the plan card's summary carries a **Change** control rather than a bare chevron, because a heading with a caret beside it reads as a heading and students were not finding the fields underneath it.

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
  explorer: { toolkit: true, costModel: true, sessions: 1, audits: 1 },
  premium:  { toolkit: true, costModel: true, sessions: 3, audits: 1, fullAudit: true,
              interview: true, priority: true, costCompare: true, officialData: true },
}
```

Three of those flags gate screens and analysis rather than credits:

- **`costModel`** (Explorer and up) — the Cost & payback calculator itself: the plan editor, the total, the breakdown and the payback. It also requires a **named account**, not the anonymous session. See *Cost & payback → Who can open it*.
- **`costCompare`** (Premium) — what to *do* about that number: the cheaper routes to the same NZQF level, and the family decision sheet.
- **`officialData`** (Premium) — the headline government figures stay free on `#visa`; the by-route and by-nationality breakdowns, and the post-study work visa record on `#cost`, are paid. See *Government data* above.

Both the **sales copy** (`#pricing` generates its paid feature rows from this table) and the **redemption flow** read it, so what a student is sold and what lands in their account cannot drift apart. `#kit`'s locked-template card reads it too.

- **Granted** — `grantsFrom(orders)` sums every order with `status:'paid'`. An order only reaches `paid` when the admin marks it so (`firestore.rules` lets nobody else write that field), which is what makes this a real entitlement rather than a client-side claim. Buying both plans stacks.
- **Spent** — `creditsUsed(requests)` counts the student's own `mentor_requests` carrying `redeem:'session'|'audit'`. A cancelled request gives the credit back.
- **Remaining** — granted minus spent, derived on read. **There is no `credits` document**: no second query, nothing new to secure, and no way for a balance to drift out of step with the requests it counts — the same principle as the Accounting ledger and the client book.

A request raised against a credit is prepaid, and the mentor's queue card says so in as many words, so nobody quotes a fee for work the student has already been promised. `priority` (Premium) sorts a request above the rest of the open queue — done in `fetchOpenRequests()`'s client-side sort rather than a Firestore `orderBy`, so the query keeps its single equality filter and needs no composite index.

> Credit *consumption* is derived client-side, like the Starter Kit's template gate. The root of trust is the admin-only `paid` flag on the order; the spend accounting is a soft gate on top of it. Worst case is a queue-position or an extra session, never data access — the rules never widen.

## Briefing (`#news`)

### Where the headlines come from

Three kinds of source, mixed on purpose:

| Source | Why |
|---|---|
| **beehive.govt.nz** RSS | The government's own release feed — where an immigration or education-export change is *announced*, before any newsroom writes it up. Items from it carry an **Official** badge. |
| **RNZ** national + political | Clean titles, real URLs, no publisher-suffix mangling. |
| **Google News** search (4 queries) | Coverage the two above don't carry — the Indian and sector press that follows NZ student-visa policy closely. |

Beehive's feed is all-of-government, so most of it is irrelevant here and gets scored away. That is the intent: what survives is a real policy release rather than a write-up of one.

### Relevance is scored, not filtered

The old test was *"does this contain any of ~20 words"*, which let "university rugby" and "student loan rates" through and then ranked everything by publication date — so an incidental mention published this morning sat above a visa rule change from Tuesday.

Now every item earns points: a core topic word scores **4 in the headline, 2 in the body**; supporting words score 2 and 1; the source's own `boost` is added. Items below `minScore` are dropped, and the sort key is **relevance first, recency second**, with scores decaying about a point a week.

> **A core word in the body alone is not enough — it needs two.** A single one is almost always incidental: a district-plan consultation mentions "residents", a trade release mentions "visas" in passing, and both ranked on page one until this rule went in. A core word in the *headline* is a different signal and counts on its own.

Duplicates are collapsed on the normalised title — the same story genuinely arrives from a ministerial release, RNZ *and* two Google searches — keeping the best copy, where official beats unofficial and an item with an image beats one without.

### About the pictures

**None of the feeds that cover this topic publish images.** Google News RSS carries none at all; neither RNZ's nor Beehive's feeds do either. Real per-article photos would mean fetching every article's HTML through a free CORS proxy to scrape one `og:image` tag — twenty-odd full page loads to decorate a list, for an audience mostly paying for mobile data. That is the wrong trade, so it isn't made.

Instead each card's cover is **built from what we genuinely have**:

- **The publisher's real logo.** Google News hands us the publisher's *domain* in `<source url>` even though its own `<link>` is an opaque redirect — so the masthead is the real one, at about 1.5 KB. Two logo services are tried (Google, then DuckDuckGo) because some networks block one; a second failure removes the element, so the chip is just the name and never a broken-image icon.
- **The subject**, as an icon and a label read off the headline (`Student visa`, `Fees & costs`, `Residence`, `Policy change`…), so a card is legible as a subject before a word of the headline is read.
- **A colour and a motif** derived from the publisher's name, so the same source always looks the same and the wall reads as a designed set.

Where a feed *does* provide an image (`media:thumbnail`, `media:content`, `<enclosure>`, or the first `<img>` in the description), it is used and simply sits on top of the cover — so a dead image URL reveals the cover underneath rather than leaving a hole.

> The big cover motif is **drawn in CSS, not set in the icon font**. It was briefly a 118px Material Symbols glyph, which is the worst possible place to depend on that font: the icons are ligatures, so while the async font was still in flight every card rendered the literal word "takeoff" or "gavel" in 118px type across its cover. A decorative element must not be able to fail that loudly.

### Sourcing, always

Every card names its publisher twice — once on the cover chip, once in the meta line — shows the age of the item, and links straight to the original with `rel="noopener"`. The footer states exactly which feeds are aggregated, that PathFinder does not write, host, edit or endorse any of it, what the **Official** badge means, and that visa rules should be confirmed with Immigration New Zealand before acting on a headline.

### Known fragility

The browser cannot read cross-origin RSS, so feeds are fetched through free public CORS relays (`PF_NEWS.proxies`, three of them, tried in order). They are free services and they do go down or rate-limit. When all three fail the view says so plainly rather than showing an empty page. If the Briefing is persistently empty, that relay list is the first thing to check.

## The profile strip

The dashboard is the student's own page — what they have saved, applied for, checked, and been told. But three of the five things that belong on that page were behind the three-dot overflow menu (**Assessment**, **Cost & payback**, **Briefing**), and a fourth — the **visa Funds Check**, a whole feature with its own questions, score and saved result — had **no nav entry anywhere**. It was reachable only if a contextual nudge happened to catch you.

Those five now share one strip, rendered above the hero on each:

```
Overview | Assessment | Funds check | Cost & payback | Briefing
#dashboard  #assessment   #funds       #cost            #news
```

**They keep their own routes.** Roughly forty inline CTAs across the Visa Hub, the Funding page and the dashboard sidecards point at `#funds`, `#assessment` and `#cost`; every one still works. The strip is navigation drawn on top, not a new home for those screens, so there is no new state, no redirects, and no rewritten links.

**Each tab carries its own status** — `62% ready`, `74% ready`, `Your plan`, `2 applications`, or an honest `Not taken` / `Not checked`. That is the difference between a menu and a profile: a menu tells you where you can go, a profile tells you where you are. `profileTabState()` reads local storage only — it renders on five views, so it never touches the network or Firestore.

**It is inserted in `route()`, not in the five renderers.** Several of them return early — a completed assessment, a saved funds result, the cost model still loading, the cold-start dashboard — and every one of those paths needs the strip. Doing it once after render catches them all and keeps the renderers unaware of it.

The overflow menu is now only what it should have been: **Billing, Account, Plans, Admin** (+ the mentor dashboard for approved mentors).

> Surfacing the funds check immediately exposed a bug it had been hiding: the dashboard's cold-start test counted assessments, saved courses, applications, visa steps and mentor requests — but not the funds check or a saved cost plan. So the strip could read "74% ready" directly above a hero saying "nothing here is filled in yet". Both now count as state.

## Performance — what loads, and when

The audience browses on mid-range Android phones over Sri Lankan mobile data, so the loading strategy is a product decision, not a build-tool one. There is still no bundler and no build step; the discipline is entirely in what is on the critical path.

### The one that mattered: fonts were blocking first paint

Every page linked Google Fonts as a plain `<link rel="stylesheet">`. That is **render-blocking** — the browser paints nothing at all until `fonts.googleapis.com` answers. Measured with that host unreachable:

| | First contentful paint |
|---|---|
| Before | **12,732 ms** — a blank white screen |
| After | **72 ms** |

Every page now loads it with `media="print"` and promotes it on `onload`, with a `<noscript>` fallback. Two further details, both deliberate:

- **Material Symbols uses `display=block`, not `swap`.** These icons are ligatures, so a `swap` fallback briefly renders the *literal words* — "location_on", "space_dashboard" — across the page. `block` keeps the glyph invisible for ~3s instead.
- **The icon box is reserved in CSS** (`brand.css` for the app, `site.css` for the landing and legal pages), so an async arrival does not shift the layout, and an outright failure leaves a blank square rather than English text mid-sentence.

### Three bundles now load on demand

`app.html` used to load everything for every visitor. These are fetched by the view that needs them, through `ensureRoi()` / `ensureInvoice()` / `ensureSettlementTools()` in `app.js` — the same cached-promise pattern as `ensureCatalogue()`:

| Bundle | Size (gz) | Needed by |
|---|---|---|
| `roi-data.js` + `roi.js` | ~15 KB | `#cost` only |
| `invoice.js` | ~11 KB | `#cost`, `#billing`, `#mentor`, `#admin` |
| `settlement/*.js` (×4) | ~17 KB | the Settle In tool tabs |

That is **~43 KB gzipped off the landing → dashboard → courses funnel**, where nearly all the traffic is: 21 requests → 14, and `DOMContentLoaded` from 12,830 ms → 84 ms.

> **`const` at the top of a classic script is script-scoped, not `window`.** `PFRoi`, `PF_ROI` and `PFInvoice` are all declared that way, so an `ensure` helper must test the *binding* (`typeof PFInvoice !== 'undefined'`), never `window.PFInvoice` — which is always `undefined` and makes the guard silently fail open. `PFFunds` and friends do attach to `window`; both styles are in the tree, so check before adding a fourth bundle.

The checkout rails (`pay.js`, `payhere.js`, `paypal.js`, ~8 KB gz) stay eager on purpose: several views call `PFPay` *during render* to label buttons and name plans, so deferring them would trade 8 KB for a flash of missing prices.

On `index.html` the same rule applies to the biggest download on the site. **three.js (1.27 MB raw, ~252 KB gzipped) is imported dynamically and only where the 3D doorway earns its place** — `(min-width: 981px) and (min-height: 561px)`, and never under `prefers-reduced-motion`. Below either bar the doorway ends up *behind* the hero copy rather than beside it, which costs readability on precisely the mobile connections this audience browses on; those screens get a flat CSS hero (a warm bloom under the canvas layer, `.stage::before/::after`) and issue no request for three.js at all. The `@media` query in `index.html`'s style block and `GL_QUERY` in its hero module are the same line written twice — change them together.

### The course list renders a page at a time

`#courses` rendered every match — 1,716 qualifications on "All subjects", measured at **18,383 DOM nodes** against Chrome's ~1,500 guidance. Worse, the whole list was re-rendered on every filter change and every debounced keystroke, which on the phones this audience uses is a visible freeze per character.

It now renders `COURSES_PAGE` (60) rows with a **Show 60 more** button: **870 nodes, 7 ms** instead of 18,383 nodes and 120 ms. Deliberately not virtualisation — rows already shown stay shown, because a student who has scrolled and opened a few courses should never have them vanish. `coursesState.shown` resets on any filter, sub-area, provider or search change, which is the only time the result set means something different.

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

## Taking money as a Sri Lankan sole trader

This section is the practical answer to "how do I actually get paid, legally, with the least friction for me and for the student". Figures are as at **August 2026** — re-check before acting, and treat this as engineering notes, not professional tax or legal advice.

### The rails, cheapest first

| Rail | Cost to you | Student's effort | Use it for |
|---|---|---|---|
| **LankaQR** | **0%** up to Rs 5,000; 1% cap above (CBSL) | Open bank app → scan → confirm | **The default.** Both session tiers (2,500 / 4,000) are under the free cap |
| Bank transfer / eZ Cash / FriMi | 0% | Type an account number and a reference | Fallback, and off-platform WhatsApp clients |
| **PayHere** | ~3.3% cards · **1.99% HelaPay** · +1% FX | Card checkout, no app needed | Premium (LKR 24,990), where cards are expected |
| PayPal | PayPal's own rate + FX spread | Overseas card | Parents or relatives paying from abroad |

**LankaQR is the finding worth acting on.** Under the National QR Payment Promotion Programme (CBSL, Ministry of Digital Economy and LankaPay, from **6 April 2026**) the merchant fee on LankaQR transactions **up to Rs 5,000 is zero**. `PF_CONFIG.sessionTiers` is `{ quick: 2500, standard: 4000 }` — so the most common transaction on this platform costs **nothing** to collect, versus roughly LKR 132 lost to a card fee on the same LKR 4,000 session. It is also the least work for the student: one code, accepted by 20+ banks and wallets, nothing to type.

Get your code from your own bank once you are onboarded as a merchant — a sole trader can be, with an NIC and a personal bank account — then drop the image in `assets/img/` and point `PF_CONFIG.manualPay.lankaQR.image` at it. Leave it blank and the whole block simply does not render.

### What the payment screen now does

- **The amount leads, and is stated once.** It used to be one bold word inside a sentence above the account box — the most important number in the modal, styled as the least important thing on it.
- **LankaQR sits first**, chipped *Fastest*, with the merchant name printed so a student paying a stranger's QR can check it matches before confirming.
- **One-tap copy** on the amount, the account number and the reference. These get retyped into a banking app by hand, and one wrong digit means the money lands somewhere else or arrives unmatchable. Falls back to `execCommand` where the clipboard API is unavailable — which includes the in-app browsers a lot of this audience arrives through.
- **The reference is explained, not just displayed**: *"without it, confirming takes days instead of hours."*
- The method dropdown is ordered to match the panel above it, so the two can never contradict each other.

Every rail still writes the same `paymentStatus` field, so switching one on changes no UI anywhere else.

### Registering the business

You are trading under a name that is not your own full name, so:

1. **Business Name Registration** at your **Divisional Secretariat** — within **14 days** of starting (extendable to 30). Bring the application form, a certified copy of your NIC, a Grama Niladhari report, proof of the business address, and an affidavit of initial capital. Certificate usually issues in 1–2 weeks. Put the number in `PF_CONFIG.org.regNo`; it prints on every invoice.
2. **TIN from the IRD** — within 30 days of registering.
3. **A business bank account** in the registered name. PayHere will settle to a personal account for a sole trader, but a separate account is what keeps the bookkeeping honest once the Accounting tab is producing real numbers.
4. **VAT: almost certainly not yet.** Registration is mandatory only above **LKR 9M in a taxable period** or **LKR 36M in any 12 months** (the annual threshold dropped from 60M to 36M on 1 April 2026). A launching consultancy is nowhere near it — but the Accounting ledger is where you will see it coming.
5. **Income tax** is on you as an individual: personal relief **LKR 1.8M** (Y/A 2025-26), then 6% / 18% / 24% / 30% / 36% bands.

### What the gateways will ask for

PayHere approves sole traders on **NIC + a Sri Lankan bank account** (no BR strictly required, though having one helps), typically in 3–7 working days, with no setup fee and T+2 settlement. What it *does* check is the site: a live domain with visible **privacy**, **refund** and **contact** information. PathFinder has `privacy.html`, `terms.html` and `cookies.html`; `terms.html#refunds` now carries a complete cancellation-and-refund policy with real timelines, and both footers link to it directly.

### Until a gateway is live

The manual rail is not a stopgap to be embarrassed about — at 0% it is cheaper than any gateway, and the app already closes the loop properly: the student taps *"I've paid"*, which writes `status:'reported'`; you confirm against your banking app and mark it paid in the admin panel; `firestore.rules` lets nobody but the admin flip that field, which is what makes an entitlement real rather than a client-side claim. Set `PF_CONFIG.payhere.merchantId` whenever you are ready and the mentor-session flow switches to hosted checkout with no other change.

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
- [ ] **Register the business name** at your Divisional Secretariat, then fill `PF_CONFIG.org.legalName` and `org.regNo` — invoices print as informal payment confirmations until `legalName` is set, and carry the registration number once `regNo` is
- [ ] **Get a LankaQR code from your bank** and set `PF_CONFIG.manualPay.lankaQR.image` + `.merchantName` — zero merchant fee under Rs 5,000, which covers both session tiers (see *Taking money as a Sri Lankan sole trader*)
- [ ] Get a TIN from the IRD within 30 days of registering
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
