# PathFinder — Pricing Strategy & Payment Setup

This document explains **how PathFinder makes money**, **what to charge**, and
**how to get paid in Sri Lanka without a merchant ID or business registration**.
It also describes the in-app system that implements all of this.

---

## 1. The model: Freemium + transactional (not subscription)

PathFinder is for a **new, low-trust brand** serving a **price-sensitive Sri
Lankan audience** working toward a **once-in-a-lifetime** goal (a funded PhD in
New Zealand). That shapes everything:

- **Why not subscription as the primary model.** The journey is *episodic* —
  intense for a few months, then the student leaves for ~3 years. Recurring
  billing fights that behaviour and churns hard. A brand nobody knows yet also
  can't ask for upfront recurring money.
- **Why freemium works.** A generous free tier builds the audience and *proves
  value before charging*. Willingness-to-pay is concentrated on concrete,
  high-stakes help — talking to someone who actually did it, and a toolkit that
  sharpens the application — not on "access".

**The five revenue layers**

1. **Free tier (the funnel)** — assessment, roadmap, explorer, scholarships,
   visa hub, Research Studio, and 12 starter templates. Drives volume + trust.
2. **Mentor marketplace (anchor, already built)** — free 15-min intro, then paid
   follow-on sessions. Platform take-rate **20%**, mentor keeps **80%**.
3. **One-time premium unlocks** — Premium Toolkit, Application Sprint. High
   willingness-to-pay, no recurring commitment.
4. **Affiliate (frictionless)** — IELTS, Wise, insurance, flights. Free to the
   student; commission to the platform.
5. **Subscription — *Phase 2 only*** ("PathFinder Plus": deadline alerts,
   community, priority matching). Deliberately deferred.

---

## 2. Pricing (LKR, 2026)

| Item | Price (LKR) | Notes |
|------|-------------|-------|
| Free **Explorer** tier | 0 | Discovery + 12 templates + Research Studio |
| Mentor **intro** call (15 min) | Free | Builds trust, qualifies the lead |
| Mentor **follow-on** session | 2,500 (quick) / 4,000 (standard) | Mentor-editable. Platform 20% |
| **Premium Toolkit** (one-time) | **1,990** | All 7 advanced templates + guides |
| **Application Audit** | 6,000 (SOP-only) / 10,000 (full) | A mentor service |
| **Application Sprint** bundle | **12,900** | Toolkit + 2 sessions + 1 proposal review |
| Affiliate placements | 0 to student | Commission revenue |
| *(Phase 2)* PathFinder Plus | 990/mo or 7,900/yr | Deferred |

**Anchoring:** migration agents in Sri Lanka charge LKR 50k–200k+, so a LKR
12,900 Sprint reads as a steal; LKR 990/mo sits in the Netflix/data-package
comfort band. These live in `PF_CONFIG.pricing` / `PF_CONFIG.sessionTiers`
(`assets/js/data.js`) and can be changed in one place.

**Unit economics (illustration).** 25 mentors × ~3 paid sessions/month ×
LKR 4,000 ≈ LKR 300k gross → ~LKR 60k/month platform take at 20%, on top of
one-time Toolkit/Sprint sales — all on ~LKR 0/month infrastructure (Firebase
Spark).

---

## 3. Getting paid with **no merchant ID / no business registration**

### Primary rail now — manual transfer + confirmation

The student transfers to your **personal** bank account or mobile wallet,
quotes the reference PathFinder shows them, and taps **"I've paid"**. You verify
the transfer in your banking app and mark it **paid** in the admin/mentor
dashboard. No gateway, no registration, stays inside the Firebase free tier.

**Set this up before launch** (all personal, no business reg required):

1. A personal **bank account** (any Sri Lankan bank).
2. A **mobile wallet** for P2P top-ups — **eZ Cash** (Dialog) and/or **FriMi**
   (NDB) are the easiest.
3. Fill `PF_CONFIG.manualPay` in `assets/js/data.js`:
   ```js
   manualPay: {
     enabled: true,
     bankName: 'Commercial Bank',
     accountName: 'Your Name',
     accountNo: '8001234567',
     branch: 'Colombo 03',
     wallets: [{ name: 'eZ Cash', number: '07XXXXXXXX' },
               { name: 'FriMi',   number: '07XXXXXXXX' }],
     instructions: '…',
   }
   ```

### International rail now — PayPal (no business registration)

Sri Lankan accounts can now **receive** PayPal, so PathFinder offers PayPal
alongside the local manual rail for students paying with an international card
or a PayPal balance. It's still **Tier 1** (no backend, no API secret): the
student pays on PayPal's hosted page, then taps **"I've paid"** to report it,
and you confirm receipt in your PayPal account and mark it paid — exactly like
the manual rail. Set **one** of these in `PF_CONFIG.paypal` (`assets/js/data.js`):

```js
paypal: {
  enabled: true,
  business: 'you@example.com',   // hosted Buy-Now checkout (carries the order id), OR
  meHandle: 'yourhandle',        // a simpler PayPal.Me link
  sandbox: false,                // true while testing
  currency: 'USD',               // PayPal has no LKR — settle in USD (or another supported currency)
  usdRate: 300,                  // indicative LKR per 1 USD, for the amount shown — hand-maintained
}
```

PayPal **cannot transact in LKR**, so the LKR price is converted with `usdRate`
for display and checkout; the student sees the foreign-currency figure and
PayPal sets the exact amount at checkout. Leave both `business` and `meHandle`
blank to hide the PayPal option. (`assets/js/paypal.js` builds the link;
`assets/js/pay.js` shows the button and records the report.)

### Upgrade path — PayHere (after a cheap sole-proprietor registration)

Once revenue is steady, register a **sole-proprietor business name** at your
Divisional Secretariat (~LKR 1,000–2,000). That unlocks a **PayHere** merchant
account (cards, HelaPay, eZ Cash, Genie) and **LankaQR**. Then set:

```js
payhere: { merchantId: 'YOUR_ID', sandbox: false, currency: 'LKR' }
```

The app **automatically switches** mentor-session checkout to PayHere's hosted
page — no other change — because both rails write the same `paymentStatus`
field. (Automated, signed, server-verified confirmation is the Tier-2 Cloud
Function in `functions/payhere-notify.js`, which needs the Blaze plan.)

### Phase-2 option — Merchant of Record

For **automated card subscriptions** or non-SL buyers without your own company,
use **Lemon Squeezy / Paddle** (they are the legal seller and handle tax), with
payout via **Payoneer / Wise**. Not needed for the LKR-only launch.

> **Honest caveat — tax.** Routing recurring business income through a personal
> account has tax and volume implications, and banks may query high P2P volumes.
> Register the sole proprietorship once revenue is steady; it's cheap and also
> what unlocks PayHere/LankaQR above.

---

## 4. How it works in the app

One payment abstraction, two backends, one `paymentStatus` field — all on the
free Spark plan (few docs, cached reads, debounced writes).

- **`assets/js/pay.js` (`PFPay`)** — the single entry point. `startSession()`
  for mentor payments and `startOrder()` for premium unlocks. Uses PayHere when
  `merchantId` is set, otherwise shows the manual bank/wallet instructions in a
  modal and records what the student reports.
- **Mentor sessions** — student taps Pay → reports the transfer
  (`paymentStatus: 'reported'`, with reference/method). The mentor sees the
  reference on their card and taps **"Mark payment received"** (`'paid'`).
- **Premium unlocks** — student buys the Toolkit/Sprint → an `orders` doc is
  created (`status: 'reported'`). The admin verifies and taps **"Mark paid &
  unlock"** in the **Orders** tab. Entitlements are then derived from paid
  orders (the Sprint also grants the Toolkit) and gate the premium templates in
  the Starter Kit. Offline/static deploys (no Firebase) keep everything free.
- **Views** — `#pricing` (plans), `#billing` (your purchases), admin **Orders**
  tab (confirm payments, see revenue, export CSV).
- **Accounting (admin)** — the admin **Accounting** tab is a single ledger
  reconstructed from both revenue sources already loaded (`mentor_requests`
  payments + `orders`) — no new collection, no extra reads. It shows **total
  received**, **pending confirmation**, **platform earnings** (premium orders
  at 100% + the `PF_CONFIG.platformTakeRate` cut of paid sessions) and mentor
  payouts, a **received-by-method** breakdown, and a transaction ledger with
  **per-payment receipts/invoices** (a print-ready / save-as-PDF document with
  the `PF_CONFIG.org` issuer identity) and a **ledger CSV export** for your
  records. Treat it as a management ledger — reconcile against your bank /
  PayHere / PayPal statements for statutory accounting.
- **Security** — `firestore.rules` lets a student only *report* their own
  payment / create their own order; only the admin can flip anything to `paid`.

### Pre-launch checklist

- [ ] Fill `PF_CONFIG.manualPay` (bank + wallet details).
- [ ] (Optional) Set `PF_CONFIG.paypal.business` **or** `meHandle`, flip
      `sandbox: false`, and check `usdRate` to enable the PayPal rail.
- [ ] Fill `PF_CONFIG.org` (legal name, email, address, tax id) so the
      Accounting-tab receipts print as proper invoices.
- [ ] Confirm `PF_CONFIG.pricing` / `sessionTiers` / `platformTakeRate` are
      the values you want.
- [ ] Deploy the updated `firestore.rules` (adds the `orders` collection +
      student payment-report rule). *(No rules change is needed for PayPal or
      the Accounting tab — both reuse existing data.)*
- [ ] (Later) Register a sole proprietorship → set `payhere.merchantId`,
      `sandbox: false`.
