# PathFinder

PathFinder helps Sri Lankan students discover PhD opportunities in New Zealand — compare pathways, find supervisors and scholarships, generate a personalized roadmap, walk the visa process step by step, plan the move, and track applications from first email to enrollment.

**Fully static. Zero build step. Runs 100% locally — or syncs to Firebase (free Spark plan) when configured.**

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Landing page with the portal hero, feature overview, and email lead capture |
| `app.html` | The application — hash-routed SPA with nine views |

### App views (`app.html#<view>`)

- `#assessment` — 7-question pathway assessment (< 5 min) → readiness score + recommended entry route
- `#roadmap` — interactive month-by-month roadmap, personalized from the assessment, with contextual mentor hooks
- `#explore` — all 8 NZ universities, 12 flagship research labs, named supervisors, field filters
- `#funding` — doctoral scholarships (value, deadlines, eligibility) + immigration/visa updates
- `#visa` — **Visa Hub**: the 7-stage NZ student-visa process with Sri Lanka-specific "where to go" guidance and a persistent checklist + progress bar
- `#settlement` — **Settle In**: first 48 hours, banking/IRD, transport, flat-hunting, family & schools, apps — plus an editable per-city cost-of-living calculator
- `#mentors` — **Mentors**: Sri Lankan PhD students already in NZ; consultation request flow (form → stored + emailed), topic filtering via `#mentors?topic=<slug>`
- `#dashboard` — saved opportunities, application tracker, visa progress, and consultation requests
- `#kit` — PhD Starter Kit: 19 templates across emails, application documents, research & career, and logistics

## Architecture

```
index.html                 landing (portal hero, lead capture, visa route teaser)
app.html                   SPA shell (sidebar nav + #view container + auth slot)
firebase.json              Firebase Hosting + Firestore deploy config
firestore.rules            security rules (per-user data, create-only inboxes)
assets/
  css/site.css             design tokens + shared components
  js/data.js               static dataset (universities, labs, scholarships, visa stages,
                           settlement guide, city costs, mentors, partners, templates, questions)
  js/store.js              PFStore — storage layer (localStorage, change events, merge metadata)
  js/firebase-config.js    paste your Firebase web config here (null = pure local mode)
  js/firebase.js           optional sync layer (Auth + Firestore mirror + inboxes)
  js/app.js                router + view renderers
```

## Firebase (free Spark plan) — setup

The site is **local-first**: localStorage is always the synchronous source of truth the UI reads, and Firebase mirrors it in the background. With `firebase-config.js` left as `null`, no Firebase code runs at all.

### What the free tier gives you here

| Service | Used for | Spark-plan limit (ample for launch) |
|---|---|---|
| Authentication | Google sign-in (cross-device sync) + anonymous (inbox writes) | Unlimited Google sign-ins |
| Cloud Firestore | `users/{uid}/kv/*` data sync · `inbox_leads` · `inbox_consultations` | 1 GiB storage, 50k reads / 20k writes per day |
| Hosting | Deploying the site | 10 GB storage, 360 MB/day transfer |

Cloud Functions require the paid (Blaze) plan, so there is **no server-side email sending** — consultation requests land in Firestore (read them in the console) *and* open a pre-filled `mailto:` as a fallback channel.

### Steps

1. [console.firebase.google.com](https://console.firebase.google.com) → Add project (Analytics optional).
2. **Build → Authentication → Sign-in method**: enable **Google** and **Anonymous**.
3. **Build → Firestore Database**: create database (production mode).
4. **Project settings → Your apps → Web app** (`</>`): register, copy the config object into `assets/js/firebase-config.js`.
5. Deploy rules + site:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use <your-project-id>
   firebase deploy            # deploys hosting + firestore.rules
   ```
   (Or keep hosting on GitHub Pages and run only `firebase deploy --only firestore:rules` — just add your Pages domain under Authentication → Settings → Authorized domains.)
6. Set `PF_CONFIG.contactEmail` in `assets/js/data.js` to the real consultation inbox.

### How the sync works

- `store.js` fires a change event on every write and keeps a per-key timestamp map (`__meta`).
- `firebase.js` subscribes: writes are debounced into `users/{uid}/kv/{key}` docs (`{v: json, t: timestamp}`).
- On Google sign-in it pulls the remote keys and merges **newer-wins per key**, then re-renders.
- Leads and consultation requests are *also* pushed (deduplicated) to top-level `inbox_leads` / `inbox_consultations` collections under anonymous auth, with **create-only** security rules — the platform owner reads them in the Firebase console; clients can never read them back.

## Data model (Firestore)

```
users/{uid}/kv/{key}        mirrored PFStore keys: assessment, saved, applications,
                            checklist.visa, consultations, calcPrefs, leads
inbox_leads/{id}            { email, source, at, uid, ts }          create-only
inbox_consultations/{id}    { mentorId, topic, note, name, contact, status, at, uid, ts }   create-only
```

Static reference data (`PF_UNIVERSITIES`, `PF_LABS`, `PF_SCHOLARSHIPS`, `PF_VISA_STAGES`, `PF_SETTLEMENT`, `PF_CITY_COSTS`, `PF_MENTORS`, `PF_PARTNERS`, `PF_TEMPLATES`) ships in `data.js`; each constant maps 1:1 to a future Firestore collection if you later want to edit content without redeploying.

## Monetization

**Live in the product:**

1. **Mentor consultations** (anchor) — packaged sessions on mentor profiles, priced in LKR with NZD hints. Contextual "Stuck at this step?" hooks on every visa stage, settlement card, and roadmap phase pre-fill the request topic. Requests are stored locally, mirrored to `inbox_consultations`, and emailed via `mailto:`.
2. **Premium services** — packaged on mentor profiles (visa file review, proposal review, mock interview, flat viewing by proxy, family relocation planning).
3. **Partner placements (affiliate)** — `PF_PARTNERS` rows rendered contextually and clearly labelled: IELTS prep (assessment results when English score is low), forex (cost calculator), insurance + flights (visa pre-departure stage). Replace the placeholder `url` fields with your affiliate links.
4. **Sponsored listings** — add `sponsored: true` to any university/lab/scholarship entry to flag it (chip rendering hook reserved in the explorer).

**Roadmap (needs Blaze plan or external services):**

- **Payments**: PayHere (LKR) or Stripe checkout links per mentor package; later, server-verified bookings via Cloud Functions.
- **Cohort webinars**: paid group sessions ("November intake visa workshop") — Zoom + payment link is enough to start; later a `webinars` collection with seat counts.
- **Paid community**: WhatsApp/Discord membership for applicants in the same intake cycle, bundled with one consultation.
- **University referral commissions**: agency-style referral agreements with NZ universities (they pay per enrolled student; students pay nothing) — the explorer becomes the funnel.
- **Email automation**: leads currently land in `inbox_leads`; connect Mailchimp/Brevo (free tiers) for the deadline-alert newsletter promised on the landing page.

## Deploying

- **GitHub Pages**: Settings → Pages → deploy from branch root. No build required. (Add the Pages domain to Firebase authorized domains if sync is enabled.)
- **Firebase Hosting**: `firebase deploy` — see Firebase setup above.

## Launch checklist

- [ ] Replace placeholder mentors in `PF_MENTORS` (`data.js`) with real people, packages, prices, and (optionally) `email`/`whatsapp`/`calendly` per mentor
- [ ] Set `PF_CONFIG.contactEmail` in `data.js`
- [ ] Replace `PF_PARTNERS` placeholder `url:'#'` entries with real affiliate links (or remove the rows)
- [ ] Paste Firebase config into `assets/js/firebase-config.js`, deploy `firestore.rules`
- [ ] Verify all costs/figures (visa fees, rents, stipends) are current

## Disclaimer

Scholarship values, fees, rankings, visa rules, and living costs are indicative — always verify with universities and Immigration New Zealand.
