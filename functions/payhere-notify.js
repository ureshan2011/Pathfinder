/* ════════════════════════════════════════════════════════════
   PathFinder — Tier 2 (OPTIONAL) · PayHere webhook confirmation

   ⚠️  REQUIRES THE FIREBASE BLAZE PLAN. Cloud Functions are NOT available
       on the free Spark plan. The app works completely WITHOUT this file:
       in Tier 1 the mentor or admin marks payment.paymentStatus = 'paid'
       by hand in the dashboard after confirming receipt in the PayHere
       merchant console. Deploying this function simply automates that one
       step — it writes the SAME field, so no UI changes are needed.

   What it does
   ────────────
   PayHere calls this endpoint (the `notify_url` we send in the checkout
   form) server-to-server after a payment. PayHere signs the callback with
   an MD5 hash computed from the MERCHANT SECRET. That secret must never
   ship to the browser, which is exactly why this verification can only
   live here, server-side — and why Tier 1 cannot auto-confirm payments.

   On a verified, successful payment it flips the matching
   mentor_requests/{id} doc to:
       status: 'paid', payment.paymentStatus: 'paid', payment.paidAt: now

   Setup (once, on Blaze)
   ──────────────────────
     1. firebase init functions   (if you haven't already)
     2. Put your PayHere merchant secret in functions config:
          firebase functions:config:set payhere.merchant_id="XXXX" \
                                         payhere.secret="YOUR_SECRET"
        (or use environment variables / Secret Manager in 2nd-gen).
     3. firebase deploy --only functions:payhereNotify
     4. In assets/js/payhere.js the checkout form already sends
          notify_url = <your-site>/payhere-notify
        Point that path at this function via a Hosting rewrite, e.g. in
        firebase.json:
          "rewrites": [{ "source": "/payhere-notify",
                         "function": "payhereNotify" }]
   ════════════════════════════════════════════════════════════ */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex').toUpperCase();

exports.payhereNotify = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const cfg = functions.config().payhere || {};
  const merchantId = cfg.merchant_id;
  const merchantSecret = cfg.secret;
  if (!merchantId || !merchantSecret) {
    console.error('payhereNotify: merchant_id / secret not configured');
    return res.status(500).send('Not configured');
  }

  const {
    merchant_id, order_id, payhere_amount, payhere_currency,
    status_code, md5sig,
  } = req.body || {};

  // Verify PayHere's signature (see PayHere docs → "Checkout API → notify_url").
  // local_md5 = MD5( merchant_id + order_id + amount + currency +
  //                  status_code + MD5(merchant_secret) )
  const expected = md5(
    String(merchant_id) + String(order_id) + String(payhere_amount) +
    String(payhere_currency) + String(status_code) + md5(merchantSecret)
  );

  if (merchant_id !== merchantId || md5sig !== expected) {
    console.warn('payhereNotify: signature mismatch — ignoring');
    return res.status(400).send('Invalid signature');
  }

  // status_code === '2' means the payment succeeded.
  if (String(status_code) !== '2') {
    console.log('payhereNotify: non-success status', status_code, 'for', order_id);
    return res.status(200).send('OK'); // acknowledge so PayHere stops retrying
  }

  // order_id is "mentor_requests/{id}" (set in payhere.js). Extract the id.
  const docId = String(order_id || '').split('/').pop();
  if (!docId) return res.status(400).send('Bad order_id');

  try {
    await admin.firestore().doc('mentor_requests/' + docId).set({
      status: 'paid',
      payment: {
        paymentStatus: 'paid',
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        amountLKR: Number(payhere_amount) || null,
      },
      updatedAt: Date.now(),
    }, { merge: true });
    return res.status(200).send('OK');
  } catch (e) {
    console.error('payhereNotify: write failed', e);
    return res.status(500).send('Write failed');
  }
});
