/* ════════════════════════════════════════════════════════════
   PathFinder — PayHere checkout link builder (Tier 1, no backend)

   PayHere is Sri Lanka's hosted-checkout gateway. For LKR payments its
   checkout automatically offers every local wallet — Visa/Mastercard,
   HelaPay, eZ Cash, mCash, Genie, online banking — so there is NO
   separate "HelaPay API" to integrate against. We just hand PayHere a
   pre-filled checkout form and let the student pick a method.

   This module is intentionally a PURE function: given a mentor_requests
   doc + PF_CONFIG.payhere, it returns the checkout endpoint and the form
   fields. The mentor's dashboard POSTs that form to PayHere.

   ── Why no `hash` field here ──────────────────────────────────────────
   PayHere's newer checkout supports a server-signed `hash` computed from
   the merchant SECRET. That secret must NEVER ship to the browser, so we
   deliberately do NOT compute a hash client-side. We use PayHere's
   Payment Page / basic checkout flow, which accepts an unsigned form for
   the sandbox and for merchants who have not enabled mandatory hashing.
   Automated, signed, server-verified confirmation is a Tier-2 concern —
   see functions/payhere-notify.js (requires the Blaze plan).

   Reconciliation in Tier 1 is manual: after the student pays, the mentor
   or admin confirms receipt in the PayHere merchant dashboard and marks
   payment.paymentStatus = 'paid' in PathFinder. Tier 2 flips that field
   automatically via the webhook — both write the same field, so every
   payment-status read in the UI works in either tier.
   ════════════════════════════════════════════════════════════ */

const PFPayHere = (() => {

  const ENDPOINT = {
    sandbox: 'https://sandbox.payhere.lk/pay/checkout',
    live:    'https://www.payhere.lk/pay/checkout',
  };

  /* Given a mentor_requests doc and the PF_CONFIG.payhere block, build the
     PayHere checkout endpoint + field map. Returns null if not payable yet
     (no merchant id configured, or no amount agreed). */
  function payhereLinkBuilder(request, payhere = (typeof PF_CONFIG !== 'undefined' && PF_CONFIG.payhere) || {}) {
    const amount = request && request.payment && request.payment.amountLKR;
    if (!payhere.merchantId || !amount || amount <= 0) return null;

    const origin = (typeof location !== 'undefined' && location.origin) || '';
    const back   = origin + (origin ? '/app.html#mentors' : '');

    const fields = {
      merchant_id: String(payhere.merchantId),
      // order_id ties the payment back to the request doc so the Tier-2
      // webhook (and manual reconciliation) can find the right record.
      order_id:    'mentor_requests/' + request.id,
      items:       'PathFinder mentoring session',
      currency:    payhere.currency || 'LKR',
      amount:      Number(amount).toFixed(2),
      return_url:  back,
      cancel_url:  back,
      notify_url:  origin ? origin + '/payhere-notify' : '', // Tier-2 webhook target
      // Student details prefilled from the request (PayHere requires these
      // fields; contact may be an email or a phone — we route accordingly).
      first_name:  (request.name || 'PathFinder').split(' ')[0],
      last_name:   (request.name || '').split(' ').slice(1).join(' ') || 'Student',
      email:       /@/.test(request.contact || '') ? request.contact : 'student@pathfinder.app',
      phone:       /@/.test(request.contact || '') ? '' : (request.contact || ''),
      address:     '',
      city:        '',
      country:     'Sri Lanka',
    };

    return { endpoint: payhere.sandbox ? ENDPOINT.sandbox : ENDPOINT.live, fields, amount };
  }

  /* Convenience: POST the checkout form to PayHere in a new tab. Builds a
     transient <form target="_blank"> so the student lands on PayHere's
     hosted page. No-op (returns false) if the request isn't payable. */
  function openCheckout(request, payhere) {
    const built = payhereLinkBuilder(request, payhere);
    if (!built) return false;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = built.endpoint;
    form.target = '_blank';
    form.rel = 'noopener';
    Object.entries(built.fields).forEach(([k, v]) => {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = k; input.value = v;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    form.remove();
    return true;
  }

  return { payhereLinkBuilder, openCheckout };
})();
