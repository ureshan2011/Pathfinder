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

  /* Catalogue of one-time platform products, priced from PF_CONFIG. */
  function items() {
    const p = cfg().pricing || {};
    return {
      toolkit: { label: 'Premium Toolkit', amount: p.toolkit },
      sprint:  { label: 'PhD Application Sprint', amount: p.sprint },
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

  function methodOptions() {
    const m = cfg().manualPay || {};
    const opts = ['Bank transfer'];
    (m.wallets || []).forEach(w => { if (w.number) opts.push(w.name); });
    return opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  }

  /* The bank/wallet instructions panel shared by both flows. */
  function instructionsHTML(amountLKR, reference) {
    const m = cfg().manualPay || {};
    const wallets = (m.wallets || []).filter(w => w.number);
    const row = (label, val, mono) => val
      ? `<div class="pay-row"><span>${esc(label)}</span><strong class="${mono ? 'mono' : ''}">${esc(val)}</strong></div>` : '';
    const anyDetails = m.bankName || m.accountNo || wallets.length;
    return `
      <p style="font-size:14.5px;margin:0 0 14px">Amount to pay: <strong>${money(amountLKR)}</strong></p>
      <div class="pay-box">
        ${row('Bank', m.bankName)}
        ${row('Account name', m.accountName)}
        ${row('Account no.', m.accountNo, true)}
        ${row('Branch', m.branch)}
        ${wallets.map(w => row(w.name, w.number, true)).join('')}
        <div class="pay-row"><span>Reference</span><strong class="mono">${esc(reference)}</strong></div>
      </div>
      ${anyDetails ? '' : `<p class="muted" style="font-size:12.5px;margin:12px 0 0;color:var(--route)">Payment details aren’t configured yet — set <code>PF_CONFIG.manualPay</code> in <code>assets/js/data.js</code>.</p>`}
      <p class="muted" style="font-size:12.5px;margin:12px 0 0">${esc(m.instructions || 'Transfer the amount, quote the reference, then tap “I’ve paid”. We confirm within 24 hours.')}</p>`;
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
    if (isPayHereLive()) {
      if (!PFPayHere.openCheckout(request)) toast('Payment isn’t set up yet — your mentor will share a link.');
      return;
    }
    const amount = request.payment && request.payment.amountLKR;
    const reference = refFor((request.id || '').replace('mr_', '').slice(-6));
    const m = modal('Pay for your session',
      instructionsHTML(amount, reference) + reportFormHTML('I’ve paid — notify my mentor'));

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
      instructionsHTML(meta.amount, reference) + reportFormHTML('I’ve paid — unlock my account'));

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

  return { isPayHereLive, items, money, startSession, startOrder };
})();
