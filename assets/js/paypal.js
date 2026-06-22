/* ════════════════════════════════════════════════════════════
   PathFinder — PayPal checkout link builder (Tier 1, no backend)

   The PayPal sibling of payhere.js. PayHere handles local LKR methods
   (cards, HelaPay, eZ Cash, Genie…); PayPal handles INTERNATIONAL card /
   PayPal-balance payments — useful now that Sri Lankan accounts can
   receive PayPal. A mentor picks the method when generating the link.

   ── Why "Website Payments Standard" (no API key) ─────────────────────
   Like payhere.js this is a PURE link/form builder with NO secret. We use
   PayPal's classic hosted "Buy Now" (_xclick) flow: a pre-filled form
   POSTed to PayPal's hosted checkout. It needs only the PUBLIC receiving
   identity (a business email or merchant id) — never an API secret — so
   it ships safely in the browser and stays on the free Spark plan (no
   Cloud Function). As a simpler fallback we also support a PayPal.Me
   handle (a plain GET link).

   ── Currency note ────────────────────────────────────────────────────
   PayPal does NOT transact in LKR, so PayPal amounts are billed in a
   PayPal-supported currency (default USD, set in PF_CONFIG.paypal). The
   payment object therefore carries an explicit {amount, currency, method}
   alongside the legacy amountLKR — see assets/js/app.js.

   ── Reconciliation (Tier 1) ──────────────────────────────────────────
   Manual, exactly like PayHere: after the student pays, the mentor/admin
   confirms receipt in the PayPal dashboard and marks paymentStatus:'paid'.
   `custom`/`item_number` carry the request id so a future Tier-2 IPN
   handler (Blaze) could flip it automatically. Both tiers write the same
   field, so every payment-status read in the UI works either way.
   ════════════════════════════════════════════════════════════ */

const PFPayPal = (() => {

  const ENDPOINT = {
    sandbox: 'https://www.sandbox.paypal.com/cgi-bin/webscr',
    live:    'https://www.paypal.com/cgi-bin/webscr',
  };

  /* The amount/currency PayPal should charge. The caller passes the already-
     converted foreign-currency amount on payment.amount (PayPal cannot
     transact in LKR — see PFPay.paypalAmountFor), with payment.currency. */
  function paypalAmount(request, paypal) {
    const p = (request && request.payment) || {};
    return {
      amount: Number(p.amount || 0),
      currency: p.currency || paypal.currency || 'USD',
    };
  }

  /* Build the PayPal checkout for a mentor_requests doc + PF_CONFIG.paypal.
     Returns null if PayPal isn't configured or there's no amount yet.
     mode:'form' uses the hosted _xclick POST; mode:'link' uses PayPal.Me. */
  function paypalLinkBuilder(request, paypal = (typeof PF_CONFIG !== 'undefined' && PF_CONFIG.paypal) || {}) {
    const { amount, currency } = paypalAmount(request, paypal);
    if (!amount || amount <= 0) return null;

    const origin = (typeof location !== 'undefined' && location.origin) || '';
    const back   = origin + (origin ? '/app.html#mentors' : '');

    // Preferred: hosted Website Payments Standard form (carries order id +
    // return urls). Needs the public receiving email/merchant id.
    if (paypal.business) {
      const fields = {
        cmd:           '_xclick',
        business:      String(paypal.business),
        item_name:     'PathFinder mentoring session',
        item_number:   'mentor_requests/' + (request.id || ''),
        custom:        'mentor_requests/' + (request.id || ''),
        amount:        Number(amount).toFixed(2),
        currency_code: currency,
        no_shipping:   '1',
        no_note:       '1',
        return:        back,
        cancel_return: back,
        notify_url:    origin ? origin + '/paypal-notify' : '', // optional Tier-2 IPN target
      };
      return {
        mode: 'form',
        endpoint: paypal.sandbox ? ENDPOINT.sandbox : ENDPOINT.live,
        fields, amount: Number(amount), currency,
      };
    }

    // Fallback: PayPal.Me link (no order metadata; purely manual reconcile).
    if (paypal.meHandle) {
      const handle = String(paypal.meHandle).replace(/^.*paypal\.me\//i, '').replace(/^\/+|\/+$/g, '');
      return {
        mode: 'link',
        url: `https://www.paypal.com/paypalme/${handle}/${Number(amount).toFixed(2)}${currency}`,
        amount: Number(amount), currency,
      };
    }

    return null;
  }

  /* Open PayPal checkout in a new tab. Builds a transient form for the
     hosted flow, or opens the PayPal.Me link. No-op (false) if unpayable. */
  function openCheckout(request, paypal) {
    const built = paypalLinkBuilder(request, paypal);
    if (!built) return false;

    if (built.mode === 'link') {
      window.open(built.url, '_blank', 'noopener');
      return true;
    }
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

  return { paypalLinkBuilder, openCheckout };
})();
