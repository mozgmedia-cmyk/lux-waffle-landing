(() => {
  const PRICE = 950, COLORS = window.COLORS, qty = COLORS.map(() => 0);
  const $ = s => document.querySelector(s);
  const fmt = n => n.toLocaleString('uk-UA').replace(/ /g, ' ') + ' грн';
  const sets = () => qty.reduce((s, q) => s + q, 0);
  const plural = (n, a, b, c) => n === 1 ? a : (n % 10 > 1 && n % 10 < 5 && (n < 10 || n > 20)) ? b : c;

  /* ---------- colour picker + summary ---------- */
  $('#swatches').addEventListener('click', e => {
    const b = e.target.closest('button[data-d]'); if (!b) return;
    const card = b.closest('.swatch'), i = +card.dataset.i;
    qty[i] = Math.max(0, Math.min(20, qty[i] + +b.dataset.d));
    card.querySelector('output').textContent = qty[i];
    card.classList.toggle('is-selected', qty[i] > 0);
    render();
  });

  function render() {
    const items = COLORS.map((n, i) => [n, qty[i]]).filter(x => x[1] > 0), n = sets();
    $('#lines').innerHTML = items.length
      ? items.map(([c, q]) => `<div class="summary__line"><span>${c} · ${q} ${plural(q, 'комплект', 'комплекти', 'комплектів')}</span><span>${fmt(q * PRICE)}</span></div>`).join('')
        + `<div class="summary__line"><span>Усього рушників</span><span>${n * 2}</span></div>`
      : '<p class="summary__empty">Ще нічого не обрано. <a href="#swatches">Обрати колір</a></p>';
    $('#total').textContent = fmt(n * PRICE);
    const label = n ? `Замовити за ${fmt(n * PRICE)} →` : 'Замовити';
    $('#submit').textContent = label; $('#stickyBtn').textContent = label;
  }
  render();

  /* ---------- Nova Poshta: city + warehouse (native <datalist>, public API) ---------- */
  // Для продакшну: вказати власний ключ (window.NP_API_KEY) або проксі (window.NP_ENDPOINT), щоб не залежати від ліміту анонімних запитів.
  const NP_URL = window.NP_ENDPOINT || 'https://api.novaposhta.ua/v2.0/json/';
  const np = async (modelName, calledMethod, methodProperties) => {
    const r = await fetch(NP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: window.NP_API_KEY || '', modelName, calledMethod, methodProperties }) });
    const j = await r.json();
    if (!j.success) throw new Error((j.errors || []).join('; ') || 'NP error');
    return j;
  };
  const cityIn = $('#f-city'), whIn = $('#f-wh'), dlCity = $('#dl-city'), dlWh = $('#dl-wh');
  const state = { cities: new Map(), city: null, whs: new Map(), npDown: false };
  let cityTimer = 0, cityReq = 0, whReq = 0;
  const fill = (dl, labels) => { dl.replaceChildren(...labels.map(v => Object.assign(document.createElement('option'), { value: v }))); };

  cityIn.addEventListener('input', () => {
    const v = cityIn.value.trim();
    if (state.cities.has(v)) { selectCity(state.cities.get(v)); return; }
    resetWarehouse(); state.city = null;
    clearTimeout(cityTimer);
    if (v.length < 2) { fill(dlCity, []); return; }
    cityTimer = setTimeout(async () => {
      const req = ++cityReq;
      try {
        const j = await np('Address', 'searchSettlements', { CityName: v, Limit: '20' });
        if (req !== cityReq) return;
        const list = ((j.data[0] || {}).Addresses || []).filter(a => a.Warehouses > 0 && a.DeliveryCity);
        state.cities = new Map(list.map(a => [a.Present, { label: a.Present, ref: a.DeliveryCity }]));
        fill(dlCity, [...state.cities.keys()]);
        state.npDown = false;
        if (state.cities.has(cityIn.value.trim())) selectCity(state.cities.get(cityIn.value.trim()));
      } catch (_) { state.npDown = true; setHint('h-city', 'Не вдалося завантажити список міст. Введіть місто вручну.'); }
    }, 250);
  });

  function resetWarehouse() {
    whReq++; state.whs = new Map(); fill(dlWh, []);
    whIn.value = ''; whIn.disabled = true; whIn.placeholder = 'Спершу оберіть місто';
  }
  async function selectCity(c) {
    if (state.city && state.city.ref === c.ref) return;
    state.city = c; resetWarehouse();
    whIn.placeholder = 'Завантажуємо відділення…';
    const req = whReq;
    try {
      let page = 1, total = Infinity, all = [];
      while (all.length < total && page <= 12) {
        const j = await np('Address', 'getWarehouses', { CityRef: c.ref, Limit: '500', Page: String(page), Language: 'UA' });
        if (req !== whReq) return;
        total = +((j.info || {}).totalCount ?? j.data.length); all = all.concat(j.data); if (!j.data.length) break; page++;
      }
      state.whs = new Map(all.map(w => [w.Description, { label: w.Description, ref: w.Ref, number: w.Number }]));
      fill(dlWh, [...state.whs.keys()]);
      whIn.disabled = false; whIn.placeholder = 'Номер відділення або вулиця';
      setHint('h-wh', `Знайдено ${all.length} ${plural(all.length, 'відділення', 'відділення', 'відділень')} (відділення та поштомати). Введіть номер чи вулицю.`);
    } catch (_) {
      state.npDown = true; whIn.disabled = false; whIn.placeholder = 'Номер відділення';
      setHint('h-wh', 'Не вдалося завантажити відділення. Введіть номер відділення вручну.');
    }
  }
  const setHint = (id, t) => { $('#' + id).textContent = t; };

  /* ---------- validation + submit ---------- */
  const fields = [
    ['name', '#f-name', '#e-name', v => v.trim() ? '' : 'Вкажіть ім’я'],
    ['phone', '#f-phone', '#e-phone', v => v.replace(/\D/g, '').length >= 10 ? '' : 'Введіть повний номер телефону'],
    ['city', '#f-city', '#e-city', v => (state.cities.has(v.trim()) || (state.npDown && v.trim())) ? '' : 'Оберіть місто зі списку підказок'],
    ['warehouse', '#f-wh', '#e-wh', v => (state.whs.has(v.trim()) || (state.npDown && v.trim())) ? '' : 'Оберіть відділення зі списку підказок'],
  ];
  const setErr = (inp, err, msg) => {
    err.hidden = !msg; err.textContent = msg;
    inp.setAttribute('aria-invalid', msg ? 'true' : 'false'); inp.classList.toggle('is-error', !!msg);
  };
  fields.forEach(([, i, e, rule]) => { const inp = $(i); inp.addEventListener('blur', () => { if (inp.value || inp.getAttribute('aria-invalid') === 'true') setErr(inp, $(e), rule(inp.value)); }); });

  $('#form').addEventListener('submit', ev => {
    ev.preventDefault();
    const msgBox = $('#form-msg'); msgBox.className = 'form-msg'; let first = null;
    fields.forEach(([, i, e, rule]) => { const inp = $(i), m = inp.disabled ? 'Спершу оберіть місто' : rule(inp.value); setErr(inp, $(e), m); if (m && !first) first = inp; });
    const noItems = !sets();
    msgBox.hidden = !noItems; msgBox.textContent = noItems ? 'Оберіть хоча б один колір вище.' : '';
    if (noItems && !first) { $('#swatches').scrollIntoView(); return; }
    if (first) { first.focus(); return; }
    const order = {
      name: $('#f-name').value.trim(), phone: $('#f-phone').value.trim(),
      city: state.city && state.city.label || cityIn.value.trim(), cityRef: state.city && state.city.ref,
      warehouse: whIn.value.trim(), warehouseRef: (state.whs.get(whIn.value.trim()) || {}).ref,
      items: COLORS.map((n, i) => [n, qty[i]]).filter(x => x[1]), total: sets() * PRICE,
    };
    // TODO: відправка заявки (Telegram-бот / CRM / Sheets) — чекаємо рішення власника
    console.log('order', order);
    msgBox.hidden = false; msgBox.className = 'form-ok'; msgBox.textContent = 'Дякуємо! Тестова заявка прийнята — ми зателефонуємо для підтвердження.';
  });

  /* ---------- sticky CTA on mobile (IntersectionObserver, no scroll listener) ---------- */
  const sticky = $('#sticky'), vis = { hero: true, order: false, final: false };
  const upd = () => sticky.classList.toggle('is-visible', !vis.hero && !vis.order && !vis.final);
  const io2 = new IntersectionObserver(es => { es.forEach(e => { vis[e.target.dataset.k] = e.isIntersecting; }); upd(); });
  [['#top', 'hero'], ['#order', 'order'], ['#final', 'final']].forEach(([s, k]) => { const el = $(s); el.dataset.k = k; io2.observe(el); });

  /* ---------- reviews carousel (native scroll-snap + prev/next) ---------- */
  const track = $('#rev-track'), prev = $('#rev-prev'), next = $('#rev-next');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stepPx = () => { const sl = track.querySelector('.slide'); return sl.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 16); };
  const sync = () => { prev.disabled = track.scrollLeft <= 4; next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4; };
  let ticking = false;
  track.addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { sync(); ticking = false; }); }, { passive: true });
  const go = dir => track.scrollBy({ left: dir * stepPx(), behavior: reducedMotion ? 'auto' : 'smooth' });
  prev.addEventListener('click', () => go(-1)); next.addEventListener('click', () => go(1));
  addEventListener('resize', sync); sync();

  /* ---------- videos: play only when visible, respect reduced motion ---------- */
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const io = new IntersectionObserver(es => es.forEach(en => {
    const v = en.target;
    if (en.isIntersecting && v.offsetParent !== null && !v._paused) v.play().catch(() => {}); else v.pause();
  }), { threshold: .25 });
  document.querySelectorAll('video[data-autoplay]').forEach(v => {
    const btn = v.parentElement.querySelector('[data-pp]');
    const sync = () => { btn.textContent = v._paused ? '▶' : '❚❚'; btn.setAttribute('aria-label', v._paused ? 'Відтворити відео' : 'Поставити відео на паузу'); };
    if (reduce) v._paused = true;
    sync();
    btn.addEventListener('click', () => { v._paused = !v._paused; if (v._paused) v.pause(); else v.play().catch(() => {}); sync(); });
    io.observe(v);
  });
})();
