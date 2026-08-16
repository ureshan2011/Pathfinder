/* ══════════════════════════════════════════════════════════════════════
   PFContact — the platform's phone line, and the WhatsApp links into it

   Most enquiries in Sri Lanka start as a WhatsApp message, long before
   anyone signs up for anything. The app already absorbs that on the far
   side (a mentor or the admin writes the caller down through "Someone
   called", and the record joins the same queue as a request typed on the
   site). This file is the near side: every WhatsApp and phone link on
   the site, built from ONE number in PF_CONFIG.

   Two things it does that a plain `wa.me` link does not:

   · IT CARRIES CONTEXT. A message that arrives saying only "hi" costs a
     round trip to work out who it is and what they want. Every link here
     prefills a sentence naming where the person was — the view, the
     study track, the topic — so the first message already says it.

   · IT CARRIES A REFERENCE. When the site has written a record for the
     enquiry, the message quotes its short ref, and the mentor and admin
     queues show the same ref on the card. That is what ties a chat on a
     phone to a row in the dashboard without any inbound API.

   Pure: no DOM, no storage, no network — it builds strings. Loaded as a
   classic script, so `PFContact` is a script-scoped const like PFStore
   and PFRoi; test the binding (`typeof PFContact !== 'undefined'`),
   never `window.PFContact`.
   ══════════════════════════════════════════════════════════════════════ */

const PFContact = (() => {
  const cfg = () => (typeof PF_CONFIG !== 'undefined' && PF_CONFIG) || {};

  /* wa.me wants digits only, with the country code and no plus. Anything
     a human might have typed into the config — spaces, a leading +, a
     local 0 — is normalised here rather than at each call site. */
  function waDigits() {
    let d = String(cfg().whatsapp || '').replace(/\D/g, '');
    if (!d) {
      d = String(cfg().contactPhoneE164 || cfg().contactPhone || '').replace(/\D/g, '');
      if (d.length === 9) d = '94' + d;              // 71 270 7074
      else if (d.startsWith('0')) d = '94' + d.slice(1);   // 071 270 7074
    }
    return d;
  }

  const has = () => !!waDigits();
  const display = () => cfg().contactPhone || cfg().contactPhoneE164 || '';
  const dial = () => cfg().contactPhoneE164 || cfg().contactPhone || '';

  /* A short, stable, sayable reference derived from the record's own id —
     no second field to store, nothing that can drift out of step with the
     request it names. Local ids are 'mr_' + Date.now(), and the last six
     DIGITS of a millisecond clock repeat every ~17 minutes; base 36 of the
     whole timestamp does not, and reads better out loud besides. */
  function ref(id) {
    const s = String(id || '');
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 9) return Number(digits).toString(36).slice(-6).toUpperCase();
    const a = s.replace(/[^a-z0-9]/gi, '');
    return a ? a.slice(-6).toUpperCase() : '';
  }

  /* The opening message. Deliberately written in the student's voice, not
     ours — they are the one sending it, and a message that reads like a
     form submission gets answered like one. */
  function compose(o) {
    const opts = o || {};
    const bits = ['Hi PathFinder —'];
    if (opts.intent) bits.push(opts.intent);
    else bits.push('I have a question about studying in New Zealand.');
    if (opts.note) bits.push('\n\n' + String(opts.note).trim());

    const tags = [];
    if (opts.track) tags.push(opts.track === 'masters' ? "Master's" : 'PhD');
    if (opts.topic) tags.push(opts.topic);
    if (opts.from) tags.push(opts.from);
    if (tags.length) bits.push('\n\n(' + tags.join(' · ') + ')');
    if (opts.ref) bits.push('\nRef ' + opts.ref);
    return bits.join(' ').replace(/ \n/g, '\n');
  }

  /* wa.me over api.whatsapp.com: it is the short form Meta documents for
     click-to-chat, and it resolves to the app on a phone and to WhatsApp
     Web on a desktop without us having to detect which. */
  function waHref(messageOrOpts) {
    const d = waDigits();
    if (!d) return '';
    const msg = typeof messageOrOpts === 'string' ? messageOrOpts
              : messageOrOpts ? compose(messageOrOpts) : '';
    return 'https://wa.me/' + d + (msg ? '?text=' + encodeURIComponent(msg) : '');
  }

  const telHref = () => (dial() ? 'tel:' + String(dial()).replace(/[^\d+]/g, '') : '');

  return { has, display, dial, waDigits, ref, compose, waHref, telHref };
})();
