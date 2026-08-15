/* ════════════════════════════════════════════════════════════
   PathFinder — unified payment entry point (manual now, PayHere later)

   One abstraction, two backends, one `paymentStatus` field:

     · MANUAL  (default, no merchant ID / no business registration)
       The student transfers to a personal bank account or mobile wallet
       (PF_CONFIG.manualPay), quotes the shown reference, and taps "I've
       paid". That writes paymentStatus:'reported' (mentor sessions) or
       creates a `orders` doc with status:'reported' (premium unlocks).
       The owner/mentor verifies in their banking app and marks it paid in
       the admin/mentor dashboard.

     · PAYHERE (after a sole-proprietor registration sets
       PF_CONFIG.payhere.merchantId) — mentor-session checkout switches to
       the existing PayHere hosted page (assets/js/payhere.js) with no UI
       rework, because both rails write the same paymentStatus field.

   Relies on globals defined by sibling classic scripts (resolved at
   call-time, after app.js has loaded): PF_CONFIG (data.js), esc / modal /
   toast / route (app.js), PFPayHere (payhere.js), PFCloud (firebase.js).
   ════════════════════════════════════════════════════════════ */

const PFPay = (() => {

  const cfg = () => (typeof PF_CONFIG !== 'undefined' && PF_CONFIG) || {};
  const isPayHereLive = () => !!(cfg().payhere && cfg().payhere.merchantId);
  const money = n => 'LKR ' + Number(n || 0).toLocaleString();

  /* PayPal is offered when configured with a receiving identity. */
  function payPalOn() {
    const pp = cfg().paypal || {};
    return !!(pp.enabled && (pp.business || pp.meHandle) && typeof PFPayPal !== 'undefined');
  }
  /* Convert an LKR price into the PayPal settlement currency for display +
     checkout. PayPal cannot transact in LKR, so we use the hand-maintained
     PF_CONFIG.paypal.usdRate (LKR per 1 unit). Returns { amount, currency }. */
  function paypalAmountFor(amountLKR) {
    const pp = cfg().paypal || {};
    const rate = Number(pp.usdRate) || 300;
    return { amount: Math.max(1, Math.round((Number(amountLKR) || 0) / rate)), currency: pp.currency || 'USD' };
  }

  /* Catalogue of one-time platform plans, priced from PF_CONFIG. */
  function items() {
    const p = cfg().pricing || {};
    return {
      explorer: { label: 'Explorer plan', amount: p.explorer },
      premium:  { label: 'Premium plan', amount: p.premium },
    };
  }

  /* A short, human reference the student writes on their bank transfer so
     the owner can match it. Derived from their email (or 'guest'). */
  function refFor(suffix) {
    let who = '';
    try { who = (window.PFCloud && PFCloud.currentEmail && PFCloud.currentEmail()) || ''; } catch {}
    const base = (who.split('@')[0] || 'guest').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || 'GUEST';
    return 'PF-' + base + '-' + String(suffix || '').toUpperCase();
  }

  /* Ordered cheapest-and-easiest first, which is also the order the panel
     above presents them in, so the dropdown never contradicts the page. */
  function methodOptions() {
    const m = cfg().manualPay || {};
    const opts = [];
    if (lankaQROn()) opts.push('LankaQR');
    opts.push('Bank transfer');
    (m.wallets || []).forEach(w => { if (w.number) opts.push(w.name); });
    if (payPalOn()) opts.push('PayPal');
    return opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  }

  function lankaQROn() {
    const q = (cfg().manualPay || {}).lankaQR || {};
    return !!q.image;
  }

  /* ── LankaQR panel ────────────────────────────────────────────────────
     Leads the modal because it is both the cheapest rail for the business
     (no merchant fee at all under Rs 5,000 — which covers both session
     tiers) and the shortest path for the student: open any bank app,
     scan, confirm. Nothing to type means nothing to mistype.

     The amount is shown beside the code rather than encoded in it: a
     static merchant QR carries the merchant, not the sum, so the payer
     keys the amount in their own app and we must tell them what it is. */
  function lankaQRHTML(amountLKR, reference) {
    if (!lankaQROn()) return '';
    const q = (cfg().manualPay || {}).lankaQR || {};
    const free = Number(amountLKR) <= 5000;
    return `<div class="pay-qr">
      <div class="pay-qr-head">
        <strong>Scan with any bank app</strong>
        <span class="chip chip-ok">Fastest</span>
      </div>
      <img class="pay-qr-img" src="${esc(q.image)}" alt="LankaQR code for ${esc(q.merchantName || 'PathFinder')}" loading="lazy" width="200" height="200">
      <div class="pay-qr-side">
        ${q.merchantName ? `<p class="pay-qr-name">Pays to <strong>${esc(q.merchantName)}</strong> — check this matches before you confirm.</p>` : ''}
        <p class="pay-qr-name">A static merchant code carries no amount, so type <strong>${money(amountLKR)}</strong> into your app yourself.</p>
        <p class="muted" style="font-size:11.5px;margin:0">Works from any Sri Lankan banking app or wallet.${
          free ? ' Under Rs 5,000, neither of us pays a fee.' : ''}</p>
      </div>
    </div>`;
  }

  /* Account numbers and payment references get typed into a banking app by
     hand, and a single wrong digit means the money lands somewhere else or
     arrives unmatchable. One tap to copy removes the whole class of error —
     which matters more here than anywhere else in the product. */
  function copyBtn(value, label) {
    if (!value) return '';
    return `<button type="button" class="pay-copy" data-copy="${esc(value)}"
      aria-label="Copy ${esc(label)}" title="Copy ${esc(label)}">
      <span class="material-symbols-outlined" aria-hidden="true">content_copy</span></button>`;
  }

  function bindCopy(root) {
    root.querySelectorAll('.pay-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        const v = btn.dataset.copy;
        try {
          await navigator.clipboard.writeText(v);
        } catch {
          // Clipboard API needs a secure context and permission; fall back
          // to the old execCommand path so this still works on http and in
          // the in-app browsers a lot of this audience arrives through.
          const t = document.createElement('textarea');
          t.value = v; t.setAttribute('readonly', '');
          t.style.cssText = 'position:absolute;left:-9999px';
          document.body.appendChild(t); t.select();
          try { document.execCommand('copy'); } catch {}
          t.remove();
        }
        btn.classList.add('is-copied');
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = 'check';
        setTimeout(() => {
          btn.classList.remove('is-copied');
          if (icon) icon.textContent = 'content_copy';
        }, 1600);
      });
    });
  }

  /* "Pay with PayPal" button (international rail). Opens PayPal's hosted
     checkout in a new tab for the converted foreign-currency amount; the
     student then still reports the payment below, exactly like the manual
     rail, so the owner confirms receipt before it counts as paid. */
  function paypalButtonHTML(amountLKR) {
    if (!payPalOn()) return '';
    const { amount, currency } = paypalAmountFor(amountLKR);
    return `<div class="pay-paypal" style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)">
      <button type="button" class="btn btn-ghost pp-go" data-amount="${amountLKR}" style="width:100%;justify-content:center">
        <span class="material-symbols-outlined" style="font-size:16px">account_balance_wallet</span>
        Pay with PayPal (international cards) · ~${currency} ${amount}
      </button>
      <p class="muted" style="font-size:11.5px;margin:8px 0 0">Pays in ${currency} (PayPal has no LKR). After paying, choose <strong>PayPal</strong> below and tap “I’ve paid”.</p>
    </div>`;
  }

  /* Wire the PayPal button inside a payment modal to open checkout. `ref`
     becomes the order id on the PayPal-side so manual reconciliation can
     match it; for a mentor request we pass the real request id. */
  function bindPayPal(modalEl, id) {
    const btn = modalEl.querySelector('.pp-go');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const { amount, currency } = paypalAmountFor(btn.dataset.amount);
      const ok = PFPayPal.openCheckout({ id: id || 'order', payment: { method: 'paypal', amount, currency } });
      if (!ok) toast('PayPal isn’t configured — set PF_CONFIG.paypal.business or meHandle.');
    });
  }

  /* The bank/wallet instructions panel shared by both flows. */
  function instructionsHTML(amountLKR, reference) {
    const m = cfg().manualPay || {};
    const wallets = (m.wallets || []).filter(w => w.number);
    // `copy` marks the fields a person actually retypes into a banking app.
    const row = (label, val, copy) => val
      ? `<div class="pay-row"><span>${esc(label)}</span>
           <strong class="${copy ? 'mono' : ''}">${esc(val)}${copy ? copyBtn(val, label) : ''}</strong>
         </div>` : '';
    const anyDetails = m.bankName || m.accountNo || wallets.length || lankaQROn();
    const qr = lankaQRHTML(amountLKR, reference);

    // The amount leads and is stated ONCE. Repeating it beside every rail
    // reads as two different charges to someone scanning quickly, which is
    // the last impression a payment screen should give.
    return `
      <div class="pay-amt pay-amt-lead">
        <span>Amount to pay</span>
        <strong>${money(amountLKR)}</strong>
        ${copyBtn(String(amountLKR), 'amount')}
      </div>
      ${qr}
      ${qr ? '<p class="pay-or"><span>or transfer it</span></p>' : ''}
      <div class="pay-box">
        ${row('Bank', m.bankName)}
        ${row('Account name', m.accountName)}
        ${row('Account no.', m.accountNo, true)}
        ${row('Branch', m.branch)}
        ${wallets.map(w => row(w.name, w.number, true)).join('')}
        <div class="pay-row"><span>Reference</span><strong class="mono">${esc(reference)}${copyBtn(reference, 'reference')}</strong></div>
      </div>
      ${anyDetails ? '' : `<p class="muted" style="font-size:12.5px;margin:12px 0 0;color:var(--route)">Payment details aren’t configured yet — set <code>PF_CONFIG.manualPay</code> in <code>assets/js/data.js</code>.</p>`}
      <p class="pay-ref-why">Put the reference <strong class="mono">${esc(reference)}</strong> in the payment note. It is how we match your payment to your account — without it, confirming takes days instead of hours.</p>
      <p class="muted" style="font-size:12.5px;margin:10px 0 0">${esc(m.instructions || 'Transfer the amount, quote the reference, then tap “I’ve paid”. We confirm within 24 hours.')}</p>`;
  }

  function reportFormHTML(cta) {
    return `<form class="pay-report" style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
      <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">How did you pay?</label>
      <select class="field pr-method">${methodOptions()}</select>
      <input class="field pr-txn" placeholder="Your transfer reference / txn id (optional)">
      <button class="btn btn-primary pr-go" type="submit" style="justify-content:center">${cta}</button>
    </form>`;
  }

  /* ── Mentor-session payment (student) ───────────────────────────────── */
  function startSession(request) {
    // Every purchase requires a real account first, so the payment is tied to
    // the student and reachable across devices (mirrors startOrder below).
    if (!(window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn())) {
      toast('Create a free account first so your session and payment stay with you.');
      location.hash = '#account';
      return;
    }
    if (isPayHereLive()) {
      if (!PFPayHere.openCheckout(request)) toast('Payment isn’t set up yet — your mentor will share a link.');
      return;
    }
    const amount = request.payment && request.payment.amountLKR;
    const reference = refFor((request.id || '').replace('mr_', '').slice(-6));
    const m = modal('Pay for your session',
      instructionsHTML(amount, reference) + paypalButtonHTML(amount) + reportFormHTML('I’ve paid — notify my mentor'));
    bindPayPal(m.el, request.id);
    bindCopy(m.el);

    m.el.querySelector('.pay-report').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = m.el.querySelector('.pr-go'); btn.disabled = true;
      const payment = Object.assign({}, request.payment, {
        paymentStatus: 'reported',
        method: m.el.querySelector('.pr-method').value,
        payerRef: reference,
        payerTxn: m.el.querySelector('.pr-txn').value.trim(),
        reportedAt: Date.now(),
      });
      try {
        await PFCloud.reportMyPayment(request.id, payment);
        request.payment = payment;
        toast('Thanks — your mentor will confirm and book the session.');
        m.close(); route();
      } catch (err) { btn.disabled = false; toast('Could not send — please try again.'); }
    });
  }

  /* ── One-time premium unlock (platform order) ───────────────────────── */
  async function startOrder(itemKey, onDone) {
    const meta = items()[itemKey];
    if (!meta || !meta.amount) return;
    if (!(window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn())) {
      toast('Create a free account first so your unlock is saved across devices.');
      location.hash = '#account';
      return;
    }
    const reference = refFor(itemKey);
    // PayHere order checkout (signed order_id + webhook) is a Tier-2 concern;
    // until then premium unlocks always use the manual rail.
    const m = modal('Unlock ' + meta.label,
      `<p class="muted" style="font-size:13.5px;margin:0 0 14px">One-time payment — unlocks ${esc(meta.label)} on your account for good.</p>` +
      instructionsHTML(meta.amount, reference) + paypalButtonHTML(meta.amount) + reportFormHTML('I’ve paid — unlock my account'));
    bindPayPal(m.el, 'order:' + itemKey);
    bindCopy(m.el);

    m.el.querySelector('.pay-report').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = m.el.querySelector('.pr-go'); btn.disabled = true;
      try {
        await PFCloud.createOrder({
          item: itemKey, amountLKR: meta.amount, ref: reference,
          method: m.el.querySelector('.pr-method').value,
          payerTxn: m.el.querySelector('.pr-txn').value.trim(),
          status: 'reported',
        });
        toast('Thanks — we’ll confirm within 24 hours and your unlock goes live.');
        m.close();
        if (typeof onDone === 'function') onDone();
      } catch (err) { btn.disabled = false; toast('Could not record your order — please try again.'); }
    });
  }

  return { isPayHereLive, payPalOn, lankaQROn, paypalAmountFor, items, money, startSession, startOrder };
})();
