---
name: firebase-firestore
description: >-
  PathFinder's Firebase Firestore model, security rules, and free-tier
  discipline. Use when adding or changing any cloud-persisted feature —
  new collections, kv keys, security rules, auth flows, or anything that
  reads/writes Firestore — so changes stay consistent with the existing
  cloud-first design and inside the free (Spark) plan limits.
---

# Firebase Firestore — PathFinder

PathFinder is **cloud-first for every visitor**. On load, anyone without a
session is signed in **anonymously** (a persistent uid), so all their data
lives in Firestore. `localStorage` (`PFStore`) is kept **only as a
synchronous read cache** — never the system of record. Firestore is the
durable store.

## Where the pieces live

| File | Role |
|---|---|
| `assets/js/firebase-config.js` | Web config + `PF_ADMIN_EMAIL`. `null` apiKey → 100% local, no Firebase calls. |
| `assets/js/firebase.js` | The whole sync layer: auth, anon-account linking, kv mirror, inboxes, mentor queue, `window.PFCloud` API. |
| `assets/js/store.js` | `PFStore` — localStorage cache + change events + `__meta` per-key timestamps. |
| `firestore.rules` | Security rules. **Deploy after every change:** `firebase deploy --only firestore:rules`. |

## Data model

```
users/{uid}/kv/{key}     { v: <json string>, t: <epochMs> }
                         mirrored PFStore keys: assessment, saved, applications,
                         checklist.visa, mentorRequests, calcPrefs, firstMonths,
                         fundsPlans, leads
                         read: owner or admin · write: owner
inbox_leads/{id}         { email, source, at, uid, ts }   create: any auth · read: admin
mentors/{uid}            { displayName, fields[], city, bio, langs, availability,
                           approved, active, createdAt }
                         create: self (approved:false) · read: any auth ·
                         update: self (descriptive fields) / admin (approved+active)
mentor_requests/{id}     { topic, note, name, contact, studentUid, status, mentorId,
                           introDoneAt, payment{...}, at, createdAt, updatedAt }
                         create: any auth (status:'open') · read: admin / approved
                         mentor / owning student · update: claim race + lifecycle
inbox_consultations/{id} LEGACY — admin read-only, no new writes
```

## How sync works (do not break these invariants)

- **Every visitor has a uid.** The first `onAuthStateChanged` carries the
  restored session or `null`; only on `null` do we `signInAnonymously`.
  Never call `signInAnonymously` eagerly at module load — it duplicates
  accounts before the stored uid rehydrates.
- **All UI reads are synchronous from `PFStore`.** New features must write
  through `PFStore.set(...)` (or a domain helper in `store.js`). That fires a
  change event which `firebase.js` debounces (1.5s) into `users/{uid}/kv/{key}`.
  **Do not write Firestore directly from feature code** — go through `PFStore`
  so the cache, the merge metadata, and the mirror all stay in step.
- **Merge is newer-wins per key** via the `__meta` timestamp map.
- **Anonymous → named is a LINK, not a re-login.** Use `googleSignIn` /
  `emailSignUp` in `firebase.js` (they `linkWithPopup` / `linkWithCredential`
  the anon account, preserving the uid and its data; fall back to plain
  sign-in only on `credential-already-in-use`).
- **The admin session never mirrors device data** (`isAdminUser` guard in
  the change listener and `flush`).

## Adding a new cloud-persisted feature

1. Add a domain helper in `store.js` that calls `set('<key>', value)`.
2. The feature is now auto-mirrored to `users/{uid}/kv/<key>` — no
   `firebase.js` change needed for per-user data.
3. For a **new top-level collection**, add a `match` block in
   `firestore.rules` (default-deny `match /{document=**}` is last — anything
   without an explicit rule is blocked) and a method on `window.PFCloud`.
4. Redeploy rules.

## Staying inside the free (Spark) tier

Limits: **50k reads / 20k writes / 1 GiB / day**, unlimited auth.

- **One pull per session.** kv is pulled once on the load `onAuthStateChanged`,
  not per navigation. Don't add per-view `getDocs` of user data.
- **Debounced writes.** Coalesce edits through `PFStore`; never write per
  keystroke. Batch related fields into one doc.
- **Deduplicate create-only pushes** (see `__inboxSynced`) so leads/requests
  write once.
- **Admin & mentor reads are on-demand** (only when the panel opens / Refresh),
  never on a visitor's page load.
- **No `onSnapshot` listeners** for ambient data — they bill continuous reads.
  Use one-shot `getDocs` behind an explicit action.
- **Cloud Functions need Blaze.** Keep the core Tier-1 (no backend); the
  PayHere webhook in `functions/` is optional Tier-2.

When estimating cost: reads/day ≈ daily visitors × kv-docs-per-user (single
digits). That stays well under 50k for a launching platform.
