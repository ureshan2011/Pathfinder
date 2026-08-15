/* ════════════════════════════════════════════════════════════
   PathFinder — invoices & receipts (PDF, zero dependencies)

   Generates a real, downloadable PDF file in the browser: no
   library, no CDN, no backend. A minimal PDF 1.4 writer draws the
   document with the base-14 Helvetica fonts (bundled advance-width
   tables keep wrapping and right-alignment exact), so the whole
   thing stays inside the Tier-1 / Spark-plan constraints.

   Two outputs from one model:
     · PFInvoice.download(inv)  → saves <invoiceNo>.pdf
     · PFInvoice.open(inv)      → print-ready preview in a new tab,
                                  with Download-PDF and Print buttons

   Two builders turn app records into that model:
     · PFInvoice.fromSession(s)     — a mentoring session record
                                      (assets/js/app.js → session log)
     · PFInvoice.fromTx(tx)         — an accounting-ledger row
                                      (admin → Accounting tab)

   Issuer identity comes from PF_CONFIG.org (assets/js/data.js).
   ════════════════════════════════════════════════════════════ */

const PFInvoice = (() => {
  'use strict';

  const PAGE = { w: 595, h: 842, m: 52 };          // A4 in points
  const CW = PAGE.w - PAGE.m * 2;                  // content width

  /* Palette mirrors site.css so a printed invoice reads as PathFinder. */
  const INK   = [0.11, 0.10, 0.08];
  const SOFT  = [0.36, 0.35, 0.32];
  const FAINT = [0.56, 0.55, 0.52];
  const LINE  = [0.84, 0.83, 0.79];
  const ROUTE = [0.76, 0.25, 0.11];
  const PINE  = [0.18, 0.35, 0.25];
  const WASH  = [0.96, 0.95, 0.92];

  /* ── 1 · Text metrics ──────────────────────────────────────────────
     Helvetica / Helvetica-Bold advance widths in 1/1000 em for chars
     32–126, straight from the Adobe AFMs. Bundling them (95 numbers
     each) is what lets us wrap paragraphs and right-align money
     columns precisely without shipping a font library. */
  const W_REG = [
    278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
    667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    278,278,278,469,556,333,
    556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
    334,260,334,584];
  const W_BOLD = [
    278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,
    722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    333,278,333,584,556,333,
    556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,
    389,280,389,584];

  /* WinAnsi has no room for smart typography — fold it to ASCII so the
     bytes we emit are always encodable and always measurable. */
  const SUBS = { '—': '-', '–': '-', '‘': "'", '’': "'",
    '“': '"', '”': '"', '…': '...', '·': '-', '•': '-',
    '→': '->', ' ': ' ', '‑': '-' };

  function ascii(s) {
    return String(s == null ? '' : s)
      .replace(/[—–‘’“”…·•→ ‑]/g, c => SUBS[c])
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, '  ')
      .replace(/[^\n\x20-\xFF]/g, '?');
  }

  function charW(code, bold) {
    if (code >= 32 && code <= 126) return (bold ? W_BOLD : W_REG)[code - 32];
    return bold ? 611 : 556;      // Latin-1 accented letters ≈ average
  }
  function textW(s, size, bold) {
    let t = 0;
    for (let i = 0; i < s.length; i++) t += charW(s.charCodeAt(i), bold);
    return t * size / 1000;
  }

  function wrap(str, size, bold, maxW) {
    const out = [];
    ascii(str).split('\n').forEach(para => {
      let line = '';
      para.split(/ +/).forEach(word => {
        let w = word;
        // hard-break a token wider than the column (long refs, URLs)
        while (textW(w, size, bold) > maxW && w.length > 1) {
          let cut = w.length;
          while (cut > 1 && textW(w.slice(0, cut), size, bold) > maxW) cut--;
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        if (!w) return;
        const test = line ? line + ' ' + w : w;
        if (!line || textW(test, size, bold) <= maxW) line = test;
        else { out.push(line); line = w; }
      });
      out.push(line);
    });
    return out;
  }

  /* ── 2 · Painter — page ops in "distance from top" coordinates ────── */
  const pdfStr = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const rgb = c => c.map(n => n.toFixed(3)).join(' ');

  function painter() {
    const pages = [];
    let ops = null, cur = 0;

    function newPage() { ops = []; pages.push(ops); cur = PAGE.m; }
    newPage();

    /* Reserve `h` points below the cursor; break to a new page if the
       block would run into the bottom margin. */
    function need(h) {
      if (cur + h > PAGE.h - PAGE.m) { newPage(); return true; }
      return false;
    }

    function text(str, x, top, size, o) {
      o = o || {};
      const bold = !!o.bold, s = ascii(str);
      let px = x;
      if (o.align === 'right') px = x - textW(s, size, bold);
      else if (o.align === 'center') px = x - textW(s, size, bold) / 2;
      const baseline = PAGE.h - (top + size * 0.82);
      ops.push(`BT ${rgb(o.color || INK)} rg /${bold ? 'F2' : 'F1'} ${size} Tf ` +
        `1 0 0 1 ${px.toFixed(2)} ${baseline.toFixed(2)} Tm (${pdfStr(s)}) Tj ET`);
      return size * 1.34;
    }

    /* Fixed-position paragraph — for blocks the caller has already
       measured and reserved room for (table cells, the footer note). */
    function para(str, x, top, size, o) {
      o = o || {};
      const lh = o.lh || size * 1.45;
      const lines = wrap(str, size, !!o.bold, o.maxW || CW);
      lines.forEach((ln, i) => text(ln, x, top + i * lh, size, o));
      return lines.length * lh;
    }

    /* Flowing paragraph — advances the cursor and breaks to a new page
       line by line. A mentor's session write-up has no length limit, so
       it must be able to run past the bottom of the page. */
    function flow(str, x, size, o) {
      o = o || {};
      const lh = o.lh || size * 1.45;
      wrap(str, size, !!o.bold, o.maxW || CW).forEach(ln => {
        need(lh);
        text(ln, x, cur, size, o);
        cur += lh;
      });
    }

    function rect(x, top, w, h, color) {
      ops.push(`${rgb(color)} rg ${x.toFixed(2)} ${(PAGE.h - top - h).toFixed(2)} ` +
        `${w.toFixed(2)} ${h.toFixed(2)} re f`);
    }

    return {
      M: PAGE.m, CW, W: PAGE.w,
      get y() { return cur; },
      set y(v) { cur = v; },
      need, newPage, text, para, flow, rect,
      hr(top, color, thick) { rect(PAGE.m, top, CW, thick || 0.7, color || LINE); },
      // measure without drawing — used to keep a block on one page
      height: (str, size, bold, maxW, lh) =>
        wrap(str, size, !!bold, maxW || CW).length * (lh || size * 1.45),
      pages: () => pages,
    };
  }

  /* ── 3 · PDF serialiser ────────────────────────────────────────────
     Everything is Latin-1, so string index == byte offset and the xref
     table can be built straight from the accumulated string length. */
  function toPDF(pages, title) {
    const objs = [];
    const pageIds = [], contentIds = [];
    let next = 5;                              // 1 catalog · 2 pages · 3–4 fonts
    for (let i = 0; i < pages.length; i++) { pageIds.push(next++); contentIds.push(next++); }

    objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objs[2] = `<< /Type /Pages /Kids [${pageIds.map(id => id + ' 0 R').join(' ')}] /Count ${pages.length} >>`;
    objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
    objs[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
    pages.forEach((ops, i) => {
      const stream = ops.join('\n');
      objs[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentIds[i]} 0 R >>`;
      objs[contentIds[i]] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });

    let out = '%PDF-1.4\n';
    const offsets = [];
    for (let i = 1; i < next; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${next}\n0000000000 65535 f \n`;
    for (let i = 1; i < next; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    out += `trailer\n<< /Size ${next} /Root 1 0 R /Info << /Title (${pdfStr(ascii(title || 'Invoice'))}) ` +
      `/Producer (PathFinder) >> >>\nstartxref\n${xref}\n%%EOF`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /* ── 4 · Shared formatting ─────────────────────────────────────────── */
  const cfg = () => (typeof PF_CONFIG !== 'undefined' && PF_CONFIG) || {};
  const org = () => cfg().org || {};
  const money = n => 'LKR ' + Number(n || 0).toLocaleString('en-US');
  const dateOf = d => {
    if (!d) return '';
    const t = typeof d === 'number' ? d : Date.parse(d);
    return isNaN(t) ? String(d) : new Date(t).toLocaleDateString('en-GB',
      { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const topicLabel = slug =>
    (typeof PF_CONSULT_TOPICS !== 'undefined' && PF_CONSULT_TOPICS[slug]) || slug || 'General guidance';
  const channelLabel = c =>
    (typeof PF_SESSION_CHANNELS !== 'undefined' && PF_SESSION_CHANNELS[c]) || c || 'Not recorded';

  /* A stable, human-quotable invoice number. Sessions carry their own
     (assigned when the record is created); ledger rows derive one from
     the source doc id so re-opening a receipt always prints the same
     number. */
  function invoiceNoFor(kindCode, id) {
    const prefix = org().invoicePrefix || 'PF';
    const tail = String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase() || '------';
    return `${prefix}-INV-${kindCode}-${tail}`;
  }

  /* ── 5 · Model builders ────────────────────────────────────────────
     Both produce the same shape, so the PDF and the print preview never
     need to know where the record came from:

       { invoiceNo, title, paid, statusLabel, date, billTo, deliveredBy,
         lines[], totalLKR, details[], sections[], footnote }            */

  function fromSession(s) {
    const paid = s.paymentStatus === 'paid';
    const waived = s.paymentStatus === 'waived' || !Number(s.amountLKR);
    const mins = Number(s.durationMin) || 0;
    const desc = (s.title || topicLabel(s.topic)) + ' - mentoring session';

    const details = [
      ['Session date', dateOf(s.date) || dateOf(s.createdAt)],
      ['Delivered via', channelLabel(s.channel)],
      mins ? ['Duration', mins + ' min'] : null,
      s.mentorName ? ['Mentor', s.mentorName] : null,
      s.method ? ['Payment method', s.method] : null,
      s.ref ? ['Reference', s.ref] : null,
      s.payerTxn ? ['Transaction', s.payerTxn] : null,
      paid && s.paidAt ? ['Paid on', dateOf(s.paidAt)] : null,
    ].filter(Boolean);

    const sections = [
      s.summary ? { h: 'What we covered', body: s.summary } : null,
      s.followUp ? { h: 'Agreed next steps', body: s.followUp } : null,
    ].filter(Boolean);

    return {
      invoiceNo: s.invoiceNo || invoiceNoFor('M', s.id),
      title: waived ? 'SESSION RECORD' : (paid ? 'RECEIPT' : 'INVOICE'),
      paid, waived,
      statusLabel: waived ? 'NO CHARGE' : paid ? 'PAID'
        : s.paymentStatus === 'reported' ? 'PAYMENT REPORTED - AWAITING CONFIRMATION' : 'UNPAID - DUE ON RECEIPT',
      date: s.paidAt || s.date || s.createdAt || Date.now(),
      billTo: { name: s.studentName || 'PathFinder student', contact: s.studentContact || '', uid: s.studentUid || '' },
      deliveredBy: s.mentorName || '',
      lines: [{ desc, detail: mins ? `${mins} minutes - ${channelLabel(s.channel)}` : channelLabel(s.channel),
                qty: 1, unit: Number(s.amountLKR) || 0, amount: Number(s.amountLKR) || 0 }],
      totalLKR: Number(s.amountLKR) || 0,
      details, sections,
    };
  }

  /* An accounting-ledger row (admin → Accounting): premium unlocks and
     platform-side payments that have no session record behind them. */
  function fromTx(tx) {
    const paid = tx.status === 'paid';
    return {
      invoiceNo: tx.invoiceNo || invoiceNoFor('X', tx.srcId),
      title: paid ? 'RECEIPT' : 'INVOICE',
      paid, waived: false,
      statusLabel: paid ? 'PAID'
        : tx.status === 'reported' ? 'PAYMENT REPORTED - AWAITING CONFIRMATION' : 'UNPAID - DUE ON RECEIPT',
      date: tx.date || Date.now(),
      billTo: { name: tx.payer || 'PathFinder student', contact: tx.payerContact || '', uid: tx.payerUid || '' },
      deliveredBy: tx.mentorName || '',
      lines: [{ desc: tx.item || 'PathFinder service', detail: '', qty: 1,
                unit: Number(tx.amountLKR) || 0, amount: Number(tx.amountLKR) || 0 }],
      totalLKR: Number(tx.amountLKR) || 0,
      details: [
        ['Date', dateOf(tx.date)],
        tx.method ? ['Payment method', tx.method] : null,
        tx.ref ? ['Reference', tx.ref] : null,
        tx.txn ? ['Transaction', tx.txn] : null,
      ].filter(Boolean),
      sections: tx.notes ? [{ h: 'Notes', body: tx.notes }] : [],
    };
  }

  /* ── 6 · Layout ────────────────────────────────────────────────────── */
  function layout(inv) {
    const p = painter();
    const o = org();
    const M = p.M, R = M + p.CW;               // left / right content edges

    /* Masthead — the wordmark, then the issuer block underneath. */
    p.text('Path', M, p.y, 22, { bold: true });
    p.text('finder', M + textW('Path', 22, true), p.y, 22, { bold: true, color: ROUTE });
    let idTop = p.y + 30;
    const issuer = [
      o.legalName || o.name || 'PathFinder',
      o.address || '',
      o.email || '',
      o.taxId ? 'Tax ID: ' + o.taxId : '',
    ].filter(Boolean);
    issuer.forEach(l => { idTop += p.text(l, M, idTop, 8.5, { color: FAINT }); });

    /* Document type + number, right-aligned against the masthead. */
    p.text(inv.title, R, p.y + 4, 11, { bold: true, color: ROUTE, align: 'right' });
    p.text(inv.invoiceNo, R, p.y + 20, 11, { align: 'right' });
    p.text('Issued ' + dateOf(Date.now()), R, p.y + 36, 8.5, { color: FAINT, align: 'right' });

    p.y = Math.max(idTop, p.y + 52) + 8;
    p.hr(p.y, INK, 1.4);
    p.y += 22;

    /* Billed-to / details, two columns. */
    const colW = (p.CW - 28) / 2;
    const top = p.y;
    p.text('BILLED TO', M, top, 8, { bold: true, color: FAINT });
    let ly = top + 15;
    ly += p.para(inv.billTo.name || 'PathFinder student', M, ly, 11, { bold: true, maxW: colW });
    if (inv.billTo.contact) ly += p.para(inv.billTo.contact, M, ly, 9.5, { color: SOFT, maxW: colW });
    if (inv.billTo.uid) ly += p.text('Account ' + String(inv.billTo.uid).slice(0, 16), M, ly, 8.5, { color: FAINT });

    /* Details sit in the right column as label/value pairs. The value gets
       the wider half so bank references and txn ids stay on one line. */
    p.text('DETAILS', R, top, 8, { bold: true, color: FAINT, align: 'right' });
    const valW = colW - 78;
    let ry = top + 15;
    inv.details.forEach(([k, v]) => {
      p.text(k, R - valW - 10, ry, 8.5, { color: FAINT, align: 'right' });
      const lines = wrap(String(v), 9.5, false, valW);
      lines.forEach((ln, i) => p.text(ln, R, ry + i * 12, 9.5, { align: 'right' }));
      ry += Math.max(14, lines.length * 12);
    });

    p.y = Math.max(ly, ry) + 24;

    /* Line items. */
    p.need(90);
    const colQty = R - 190, colUnit = R - 95;
    p.hr(p.y, LINE, 0.7);
    p.y += 8;
    p.text('DESCRIPTION', M, p.y, 8, { bold: true, color: FAINT });
    p.text('QTY', colQty, p.y, 8, { bold: true, color: FAINT, align: 'right' });
    p.text('UNIT', colUnit, p.y, 8, { bold: true, color: FAINT, align: 'right' });
    p.text('AMOUNT', R, p.y, 8, { bold: true, color: FAINT, align: 'right' });
    p.y += 14;
    p.hr(p.y, LINE, 0.7);
    p.y += 10;

    inv.lines.forEach(l => {
      const descW = colQty - M - 24;
      const h = p.height(l.desc, 10.5, false, descW) + (l.detail ? p.height(l.detail, 8.5, false, descW) : 0);
      p.need(h + 16);
      const rowTop = p.y;
      let dy = p.para(l.desc, M, rowTop, 10.5, { maxW: descW });
      if (l.detail) dy += p.para(l.detail, M, rowTop + dy, 8.5, { color: FAINT, maxW: descW });
      p.text(String(l.qty), colQty, rowTop, 10.5, { align: 'right', color: SOFT });
      p.text(money(l.unit), colUnit, rowTop, 10.5, { align: 'right', color: SOFT });
      p.text(money(l.amount), R, rowTop, 10.5, { align: 'right' });
      p.y = rowTop + Math.max(dy, 16) + 10;
      p.hr(p.y, LINE, 0.5);
      p.y += 10;
    });

    /* Total + status stamp. */
    p.need(60);
    p.text('Total', colUnit, p.y + 2, 11, { bold: true, align: 'right' });
    p.text(money(inv.totalLKR), R, p.y, 15, { bold: true, align: 'right' });
    p.y += 30;

    const stampW = textW(ascii(inv.statusLabel), 8.5, true) + 20;
    p.rect(M, p.y, stampW, 19, inv.paid ? [0.90, 0.94, 0.91] : WASH);
    p.text(inv.statusLabel, M + 10, p.y + 5.5, 8.5, { bold: true, color: inv.paid ? PINE : SOFT });
    p.y += 34;

    /* Session record — the part that makes this more than a receipt. */
    if (inv.sections.length) {
      p.need(50);
      p.hr(p.y, LINE, 0.7);
      p.y += 16;
      inv.sections.forEach(sec => {
        p.need(40);        // never orphan a heading at the foot of a page
        p.y += p.text(sec.h.toUpperCase(), M, p.y, 8, { bold: true, color: FAINT }) + 4;
        p.flow(sec.body, M, 10, { color: SOFT, lh: 14 });
        p.y += 12;
      });
    }

    /* Footer note — honest about registration status until org.legalName
       is filled in (see PF_CONFIG.org). */
    p.need(46);
    p.y = Math.max(p.y, PAGE.h - PAGE.m - 42);
    p.hr(p.y, LINE, 0.7);
    p.y += 9;
    const note = (o.legalName ? '' :
      'Issued by an unregistered sole trader - this is a payment confirmation, not a tax invoice. ') +
      'Amounts in Sri Lankan Rupees (LKR). Generated by PathFinder on ' + new Date().toLocaleString('en-GB') + '.';
    p.para(note, M, p.y, 7.5, { color: FAINT, lh: 10 });

    return p.pages();
  }

  /* ── 7 · Outputs ───────────────────────────────────────────────────── */
  function blobFor(inv) { return toPDF(layout(inv), inv.invoiceNo); }

  function download(inv) {
    const url = URL.createObjectURL(blobFor(inv));
    const a = Object.assign(document.createElement('a'), { href: url, download: inv.invoiceNo + '.pdf' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return inv.invoiceNo + '.pdf';
  }

  /* Print-ready preview in a new tab. Carries a Download-PDF link (a blob
     URL minted here, in the opener) alongside the browser Print button, so
     one action covers "give me the file" and "sign it and hand it over". */
  function open(inv) {
    const e = s => String(s == null ? '' : s).replace(/[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const o = org();
    const url = URL.createObjectURL(blobFor(inv));
    setTimeout(() => URL.revokeObjectURL(url), 600000);

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${e(inv.invoiceNo)}</title><style>
      *{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1C1A15;max-width:760px;margin:32px auto;padding:0 28px;line-height:1.5}
      .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #1C1A15;padding-bottom:18px;margin-bottom:24px}
      .brand{font-size:24px;font-weight:700;letter-spacing:-.02em}.brand i{color:#C2401C;font-style:italic}
      .doc{font-size:13px;text-transform:uppercase;letter-spacing:.16em;color:#C2401C;font-weight:600;text-align:right}
      .muted{color:#666;font-size:12.5px}h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:0 0 6px}
      .cols{display:flex;gap:40px;flex-wrap:wrap;margin-bottom:28px}.cols>div{flex:1;min-width:220px}
      table{width:100%;border-collapse:collapse;margin:8px 0 18px}th,td{text-align:left;padding:11px 8px;border-bottom:1px solid #ddd;font-size:14px}
      th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#888}.r{text-align:right}
      .total{font-size:20px;font-weight:700}
      .status{display:inline-block;margin-top:8px;padding:4px 12px;border-radius:3px;font-size:12px;font-weight:600;background:${inv.paid ? '#e7f0ea' : '#f7efda'};color:${inv.paid ? '#2D5A41' : '#8A6A2F'}}
      .sec{margin-top:26px}.sec p{white-space:pre-wrap;font-size:13.5px;color:#444;margin:6px 0 0}
      .foot{margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:11.5px;color:#888}
      .noprint{margin:26px 0;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
      .noprint a,.noprint button{font:inherit;padding:10px 22px;border:1px solid #1C1A15;background:#1C1A15;color:#fff;border-radius:3px;cursor:pointer;text-decoration:none}
      .noprint a.ghost{background:none;color:#1C1A15}
      @media print{.noprint{display:none}}
    </style></head><body>
      <div class="top">
        <div><div class="brand">Path<i>finder</i></div><div class="muted">${e(o.legalName || o.name || 'PathFinder')}${o.email ? ' &middot; ' + e(o.email) : ''}${o.address ? '<br>' + e(o.address) : ''}${o.taxId ? '<br>Tax ID: ' + e(o.taxId) : ''}</div></div>
        <div class="doc">${e(inv.title)}<div class="muted" style="text-transform:none;letter-spacing:0;color:#1C1A15;font-weight:400;margin-top:6px">${e(inv.invoiceNo)}</div></div>
      </div>
      <div class="cols">
        <div><h2>Billed to</h2>${e(inv.billTo.name || 'PathFinder student')}${inv.billTo.contact ? '<br>' + e(inv.billTo.contact) : ''}${inv.billTo.uid ? '<br><span class="muted">acct ' + e(String(inv.billTo.uid).slice(0, 16)) + '</span>' : ''}</div>
        <div class="r"><h2>Details</h2>${inv.details.map(([k, v]) => `<span class="muted">${e(k)}:</span> ${e(v)}`).join('<br>')}</div>
      </div>
      <table>
        <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
        <tbody>${inv.lines.map(l => `<tr><td>${e(l.desc)}${l.detail ? `<br><span class="muted">${e(l.detail)}</span>` : ''}</td><td class="r">${e(l.qty)}</td><td class="r">${e(money(l.amount))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td class="total">Total</td><td></td><td class="r total">${e(money(inv.totalLKR))}</td></tr></tfoot>
      </table>
      <span class="status">${e(inv.statusLabel)}</span>
      ${inv.sections.map(s => `<div class="sec"><h2>${e(s.h)}</h2><p>${e(s.body)}</p></div>`).join('')}
      <div class="foot">${o.legalName ? '' : 'Issued by an unregistered sole trader &mdash; this is a payment confirmation, not a tax invoice. '}Amounts in Sri Lankan Rupees (LKR). Generated by PathFinder on ${e(new Date().toLocaleString())}.</div>
      <div class="noprint">
        <a href="${url}" download="${e(inv.invoiceNo)}.pdf">Download PDF</a>
        <a class="ghost" href="#" onclick="window.print();return false">Print</a>
      </div>
    </body></html>`;

    const w = window.open('', '_blank');
    if (!w) { URL.revokeObjectURL(url); return false; }
    w.document.write(html);
    w.document.close();
    return true;
  }

  /* ════════════════════════════════════════════════════════════
     The family decision sheet.

     Everything else this file writes is a record of something that
     already happened. This is the opposite: a one-page case for a
     decision that has not been made yet, addressed to the person who
     will actually make it.

     That person is usually not the student. It is a parent or an uncle
     who has never been to New Zealand, will never open the app, and is
     being asked to commit a sum that in Colombo buys a house. So the
     sheet leads in LKR, keeps NZ$ alongside for anyone checking against
     a provider's website, states the alternatives that were considered
     and rejected, and ends by saying plainly which figures are estimates
     and where they came from. A sheet that oversells is worse than no
     sheet: this document has to survive being read by a sceptic.
     ════════════════════════════════════════════════════════════ */

  /* Sign goes in front of the currency, not between it and the digits:
     "-NZ$52,468", never "NZ$-52,468". The offset lines on the sheet are
     the only negatives it prints, and they are read by someone checking
     the arithmetic by hand. */
  const signed = (v, body) => (v < 0 ? '-' : '') + body(Math.abs(v));
  const nz = n => signed(Number(n) || 0, v => 'NZ$' + Math.round(v).toLocaleString('en-US'));
  const lk = (n, rate) => signed(Number(n) || 0,
    v => 'LKR ' + Math.round(v * (rate || 0)).toLocaleString('en-US'));

  function sheetLayout(s) {
    const p = painter();
    const o = org();
    const M = p.M, R = M + p.CW;
    const rate = (s.fx && s.fx.nzdToLkr) || 0;

    /* Masthead */
    p.text('Path', M, p.y, 22, { bold: true });
    p.text('finder', M + textW('Path', 22, true), p.y, 22, { bold: true, color: ROUTE });
    p.text('FAMILY DECISION SHEET', R, p.y + 4, 11, { bold: true, color: ROUTE, align: 'right' });
    p.text(dateOf(s.date || Date.now()), R, p.y + 20, 9.5, { align: 'right' });
    p.y += 40;
    p.hr(p.y, INK, 1.4);
    p.y += 20;

    /* Who and what */
    p.y += p.para(s.student || 'A PathFinder student', M, p.y, 13, { bold: true });
    p.y += 2;
    p.y += p.para(s.plan || '', M, p.y, 10.5, { color: SOFT });
    p.y += 16;

    /* THE NUMBER — in the currency the reader thinks in. */
    p.need(96);
    p.rect(M, p.y, p.CW, 74, WASH);
    p.text('WHAT THIS WILL COST, ALL IN', M + 14, p.y + 12, 8, { bold: true, color: FAINT });
    p.text(lk(s.netNZD, rate), M + 14, p.y + 27, 20, { bold: true });
    p.text(nz(s.netNZD) + '  ' + (s.years || 2) + '-year total, after money earned from part-time work',
      M + 14, p.y + 54, 9, { color: SOFT });
    p.y += 90;

    /* Where it goes */
    p.need(70);
    p.text('WHERE IT GOES', M, p.y, 8, { bold: true, color: FAINT });
    p.text('NZ$', R - 110, p.y, 8, { bold: true, color: FAINT, align: 'right' });
    p.text('LKR', R, p.y, 8, { bold: true, color: FAINT, align: 'right' });
    p.y += 14;
    p.hr(p.y, LINE, 0.7);
    p.y += 9;

    (s.lines || []).forEach(l => {
      const w = R - 240 - M;
      const h = p.height(l.label, 10.5, false, w) + (l.detail ? p.height(l.detail, 8.5, false, w) : 0);
      p.need(h + 14);
      const top = p.y;
      let dy = p.para(l.label, M, top, 10.5, { maxW: w });
      if (l.detail) dy += p.para(l.detail, M, top + dy, 8.5, { color: FAINT, maxW: w });
      p.text(nz(l.nzd), R - 110, top, 10.5, { align: 'right', color: SOFT });
      p.text(lk(l.nzd, rate), R, top, 10.5, { align: 'right' });
      p.y = top + Math.max(dy, 15) + 8;
      p.hr(p.y, LINE, 0.4);
      p.y += 8;
    });

    /* Offsets and the gap — the three lines a parent actually scans for. */
    const totals = [
      ['Total cost', s.totalNZD, false],
      ['Less: earned from part-time work while studying', -Math.abs(s.studyIncomeNZD || 0), false],
      ['What the family has to find', s.netNZD, true],
      s.ownFundsNZD ? ['Already arranged', -Math.abs(s.ownFundsNZD), false] : null,
      s.ownFundsNZD ? ['Still to arrange', s.gapNZD, true] : null,
    ].filter(Boolean);

    /* Three fixed columns, same geometry as the table above: label, then
       NZ$ ending at R-110, then LKR ending at R. The label is RIGHT-
       aligned to the start of the NZ$ column minus a gutter, and wrapped
       to the space actually left over.

       The previous version right-aligned the label at R-122 while the
       NZ$ value also extended left from R-110 — so a long label like
       "Less: earned from part-time work while studying" ran back
       underneath the number and printed on top of it. */
    const COL_NZ = R - 110;             // right edge of the NZ$ column
    const GUTTER = 16;
    const labelRight = COL_NZ - 95 - GUTTER;   // 95pt reserved for the widest NZ$ figure
    const labelMaxW = labelRight - M;

    p.y += 4;
    totals.forEach(([label, val, strong]) => {
      const size = strong ? 11 : 10;
      const lines = wrap(String(label), size, !!strong, labelMaxW);
      const h = Math.max(lines.length * (size * 1.35), 16);
      p.need(h + 8);
      const top = p.y;
      lines.forEach((ln, i) => p.text(ln, labelRight, top + i * (size * 1.35), size,
        { bold: strong, align: 'right', color: strong ? INK : SOFT }));
      p.text(nz(val), COL_NZ, top, size, { align: 'right', bold: strong, color: strong ? INK : SOFT });
      p.text(lk(val, rate), R, top, strong ? 12 : 10, { align: 'right', bold: strong });
      p.y = top + h + (strong ? 6 : 3);
    });
    p.y += 10;

    /* Afterwards */
    p.need(96);
    p.hr(p.y, LINE, 0.7);
    p.y += 16;
    p.text('AFTER GRADUATION', M, p.y, 8, { bold: true, color: FAINT });
    p.y += 16;
    const stampW = textW(ascii(s.band || ''), 9, true) + 20;
    p.rect(M, p.y, stampW, 20, s.bandOk ? [0.90, 0.94, 0.91] : WASH);
    p.text(s.band || '', M + 10, p.y + 6, 9, { bold: true, color: s.bandOk ? PINE : SOFT });
    p.y += 30;
    (s.afterLines || []).forEach(([k, v]) => {
      p.text(k, M, p.y, 9.5, { color: SOFT });
      p.text(v, R, p.y, 9.5, { align: 'right' });
      p.y += 16;
    });
    p.y += 6;
    if (s.verdict) { p.flow(s.verdict, M, 10, { color: SOFT, lh: 14 }); p.y += 10; }

    /* The regulator's record on the provider. On paper this matters more
       than on screen: the sheet is what gets read by the person paying,
       and "it costs less" is a much easier sentence to accept than "it
       costs less AND here is who says they're any good". */
    if (s.quality) {
      const q = s.quality;
      p.need(78);
      p.hr(p.y, LINE, 0.7);
      p.y += 16;
      p.text('WHO WE\'D BE PAYING', M, p.y, 8, { bold: true, color: FAINT });
      p.y += 16;
      p.y += p.para(q.name, M, p.y, 11, { bold: true, maxW: p.CW });
      p.y += 4;
      if (q.verdict) p.y += p.para(q.verdict, M, p.y, 9.5, { color: SOFT, maxW: p.CW, lh: 13 });
      (q.lines || []).forEach(l => { p.need(16); p.y += p.para(l, M, p.y, 9, { color: SOFT, maxW: p.CW, lh: 12.5 }) + 3; });
      if (q.note) { p.y += 4; p.y += p.para(q.note, M, p.y, 8, { color: FAINT, maxW: p.CW, lh: 11 }); }
      p.y += 12;
    }

    /* Alternatives — the part that proves this was a decision, not a wish. */
    if ((s.alternatives || []).length) {
      p.need(60);
      p.hr(p.y, LINE, 0.7);
      p.y += 16;
      p.text('CHEAPER ROUTES WE LOOKED AT', M, p.y, 8, { bold: true, color: FAINT });
      p.y += 16;
      s.alternatives.forEach(a => {
        p.need(46);
        const top = p.y;
        let dy = p.para(a.title, M, top, 10.5, { bold: true, maxW: p.CW - 150 });
        if (a.tradeoff) dy += p.para(a.tradeoff, M, top + dy, 8.5, { color: FAINT, maxW: p.CW - 150 });
        p.text(a.saving > 0 ? 'saves ' + lk(a.saving, rate) : '', R, top, 10, { align: 'right', color: PINE });
        if (a.saving > 0) p.text(nz(a.saving), R, top + 14, 8.5, { align: 'right', color: FAINT });
        p.y = top + Math.max(dy, 30) + 10;
      });
    }

    /* Footer — sources and honest limits. Printed, not buried. */
    p.need(76);
    p.y = Math.max(p.y + 6, PAGE.h - PAGE.m - 72);
    p.hr(p.y, LINE, 0.7);
    p.y += 9;
    const foot = (s.notes || []).join('  ');
    p.para(foot, M, p.y, 7.5, { color: FAINT, lh: 10.5, maxW: p.CW });
    return p.pages();
  }

  function sheetBlob(s) { return toPDF(sheetLayout(s), s.ref || 'decision-sheet'); }

  function downloadSheet(s) {
    const name = (s.ref || 'PathFinder-decision-sheet') + '.pdf';
    const url = URL.createObjectURL(sheetBlob(s));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return name;
  }

  function openSheet(s) {
    const url = URL.createObjectURL(sheetBlob(s));
    setTimeout(() => URL.revokeObjectURL(url), 600000);
    const w = window.open(url, '_blank');
    return !!w;
  }

  return { fromSession, fromTx, invoiceNoFor, layout, blobFor, download, open,
           sheetLayout, sheetBlob, downloadSheet, openSheet,
           money, dateOf, topicLabel, channelLabel };
})();
