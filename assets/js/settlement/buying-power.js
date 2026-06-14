/* ════════════════════════════════════════════════════════════
   PathFinder — "What can NZD$20 buy?" (Settlement Part C)

   Turns abstract NZD amounts into felt intuition for a student
   budgeting from Sri Lanka. Reads the city selected in the Funds
   Planner so bus fares etc. stay consistent. 2D by design — quick
   to scan, no 3D clutter.

   Classic script — exposes window.PFBuying (see app.js header note).
   ════════════════════════════════════════════════════════════ */

window.PFBuying = (() => {
  const STEPS = [5, 10, 20, 50, 100];

  const priceOf = (item, cityId) =>
    (item.perCity && item.perCity[cityId] != null) ? item.perCity[cityId] : item.nzd;

  function render(container) {
    const prefs = PFStore.getCalcPrefs() || {};
    const cityId = prefs.city || 'chc';
    const city = PF_CITY_COSTS.find(c => c.id === cityId) || PF_CITY_COSTS[0];
    let amount = 20;

    container.innerHTML = `
      <div class="card bp-card">
        <p class="muted" style="font-size:14px;max-width:560px">
          NZ prices are hard to picture from Colombo. Slide to an amount and see what it actually gets you in
          <strong>${city.city}</strong> — change the city in the Funds planner tab to compare.
        </p>

        <div class="bp-slider-wrap">
          <label class="faint fp-lbl" for="bp-slider">Amount in NZD</label>
          <div class="bp-amount" id="bp-amount">NZ$20</div>
          <input type="range" id="bp-slider" class="bp-slider" min="0" max="${STEPS.length - 1}" step="1" value="2"
            aria-label="Amount in New Zealand dollars" aria-valuetext="NZ$20">
          <div class="bp-ticks" aria-hidden="true">${STEPS.map(s => `<span>$${s}</span>`).join('')}</div>
        </div>

        <div class="bp-grid" id="bp-grid"></div>

        <p class="fp-disclaimer">Everyday prices last verified ${PF_CONFIG.dataVerified} — indicative only. Minimum wage NZ$${PF_CONFIG.minWageHourly}/hr (from 1 April 2026). LKR at an indicative 1 NZD ≈ ${PF_CONFIG.nzdToLkr} LKR.</p>
      </div>`;

    const $a = sel => container.querySelector(sel);

    function card(icon, big, sub) {
      return `<div class="bp-item">
        <span class="material-symbols-outlined bp-ic">${icon}</span>
        <div class="bp-big">${big}</div>
        <div class="faint bp-sub">${sub}</div>
      </div>`;
    }

    function paint() {
      const cards = [];
      // 1 · minutes of work at minimum wage
      const mins = Math.round(amount / PF_CONFIG.minWageHourly * 60);
      cards.push(card('schedule', `≈ ${mins} min`, `of work at minimum wage (NZ$${PF_CONFIG.minWageHourly}/hr)`));
      // 2 · supermarket lunches
      const lunch = PF_PRICE_REFERENCE.find(p => p.id === 'lunch');
      cards.push(card(lunch.icon, `≈ ${Math.floor(amount / lunch.nzd)}`, `basic supermarket lunches (NZ$${lunch.nzd} each)`));
      // 3 · bus rides (city-aware)
      const bus = PF_PRICE_REFERENCE.find(p => p.id === 'bus');
      const fare = priceOf(bus, cityId);
      cards.push(card(bus.icon, `≈ ${Math.floor(amount / fare)}`, `student bus rides in ${city.city} (NZ$${fare.toFixed(2)} each)`));
      // 4 · café coffees
      const coffee = PF_PRICE_REFERENCE.find(p => p.id === 'coffee');
      cards.push(card(coffee.icon, `≈ ${Math.floor(amount / coffee.nzd)}`, `café flat whites (NZ$${coffee.nzd} each)`));
      // 5 · mobile data
      const data = PF_PRICE_REFERENCE.find(p => p.id === 'data');
      cards.push(card(data.icon, `≈ ${Math.floor(amount / data.nzd)} GB`, `of prepay mobile data (NZ$${data.nzd}/GB)`));
      // 6 · LKR home anchor
      cards.push(card('currency_exchange', `≈ LKR ${Math.round(amount * PF_CONFIG.nzdToLkr).toLocaleString()}`, 'at an indicative transfer rate'));

      $a('#bp-grid').innerHTML = cards.join('');
    }

    function setAmount(idx) {
      amount = STEPS[idx];
      $a('#bp-amount').textContent = 'NZ$' + amount;
      $a('#bp-slider').setAttribute('aria-valuetext', 'NZ$' + amount);
      paint();
    }

    $a('#bp-slider').addEventListener('input', e => setAmount(+e.target.value));
    paint();
  }

  return { render };
})();
