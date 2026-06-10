# PathFinder

PathFinder helps Sri Lankan students discover PhD opportunities in New Zealand — compare pathways, find supervisors and scholarships, generate a personalized roadmap, and track applications from first email to enrollment.

**Fully static. Zero build step. Deploys straight to GitHub Pages.**

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Landing page with the portal hero, feature overview, and email lead capture |
| `app.html` | The application — hash-routed SPA with six views |

### App views (`app.html#<view>`)

- `#assessment` — 7-question pathway assessment (< 5 min) → readiness score + recommended entry route
- `#roadmap` — interactive month-by-month roadmap, personalized from the assessment
- `#explore` — all 8 NZ universities, 12 flagship research labs, named supervisors, field filters
- `#funding` — doctoral scholarships (value, deadlines, eligibility) + immigration/visa updates
- `#dashboard` — saved opportunities + application tracker (7-stage pipeline with progress bars)
- `#kit` — PhD Starter Kit: supervisor email, proposal outline, academic CV, SOP framework (copy / download)

## Architecture

```
index.html            landing (portal hero, lead capture)
app.html              SPA shell (sidebar nav + #view container)
assets/
  css/site.css        design tokens + shared components
  js/data.js          static dataset (universities, labs, scholarships, visa updates, templates, questions)
  js/store.js         PFStore — storage layer (localStorage adapter)
  js/app.js           router + view renderers
```

### Firebase migration path

The app is architected so Firebase drops in without touching UI code:

1. **`store.js` is the only persistence boundary.** `PFStore` exposes document-style getters/setters (`getAssessment`, `toggleSaved`, `upsertApp`, `addLead`…). Swap the localStorage internals for Firestore calls (`users/{uid}/assessment`, `users/{uid}/saved`, `users/{uid}/applications`, `leads`).
2. **`data.js` maps 1:1 to Firestore collections** (`universities`, `labs`, `scholarships`, `visaUpdates`, `templates`) — flat, ID-keyed objects.
3. **Auth:** add Firebase Auth, gate `app.html`, and key PFStore by `uid` instead of the `pathfinder.v1.` namespace.
4. **Analytics / AI recommendations:** assessment answers are stored as a structured document, ready to feed a recommendation function (Cloud Functions + Claude API).
5. **Leads:** `PFStore.addLead()` currently queues emails locally; point it at a Firestore `leads` collection or a Cloud Function.

## Deploying

GitHub Pages → Settings → Pages → deploy from branch root. No build required.

## Disclaimer

Scholarship values, fees, rankings, and visa rules are indicative — always verify with universities and Immigration New Zealand.
