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

  /* ---------- Nova Poshta: city + warehouse (custom combobox, public API) ---------- */
  // Для продакшну: вказати власний ключ (window.NP_API_KEY) або проксі (window.NP_ENDPOINT), щоб не залежати від ліміту анонімних запитів.
  const NP_URL = window.NP_ENDPOINT || 'https://api.novaposhta.ua/v2.0/json/';
  const np = async (modelName, calledMethod, methodProperties) => {
    const r = await fetch(NP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: window.NP_API_KEY || '', modelName, calledMethod, methodProperties }) });
    const j = await r.json();
    if (!j.success) throw new Error((j.errors || []).join('; ') || 'NP error');
    return j;
  };
  /* accessible combobox: list opens at once and filters as the user types */
  function combo(input, listEl, onPick) {
    let items = [], active = -1;
    const show = on => { listEl.hidden = !on; input.setAttribute('aria-expanded', String(on)); if (!on) { active = -1; input.removeAttribute('aria-activedescendant'); } };
    const setActive = i => {
      active = i;
      [...listEl.children].forEach((li, k) => { li.setAttribute('aria-selected', String(k === i)); li.classList.toggle('is-active', k === i); });
      if (i >= 0) { const li = listEl.children[i]; input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    };
    const pick = k => { const v = items[k]; input.value = v; show(false); onPick(v); };
    const render = labels => {
      items = labels; active = -1;
      listEl.replaceChildren(...labels.map((v, k) => {
        const li = document.createElement('li'); li.id = `${listEl.id}-${k}`; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false'); li.textContent = v;
        li.addEventListener('mousedown', e => { e.preventDefault(); pick(k); });
        return li;
      }));
      show(labels.length > 0);
    };
    const status = text => {
      items = []; active = -1;
      const li = document.createElement('li'); li.className = 'is-status'; li.setAttribute('role', 'presentation'); li.textContent = text;
      listEl.replaceChildren(li); show(true);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (listEl.hidden && items.length) show(true); if (items.length) setActive(Math.min(active + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) setActive(Math.max(active - 1, 0)); }
      else if (e.key === 'Enter' && !listEl.hidden && active >= 0) { e.preventDefault(); pick(active); }
      else if (e.key === 'Escape' && !listEl.hidden) { e.preventDefault(); show(false); }
    });
    input.addEventListener('blur', () => show(false));
    return { render, status, close: () => show(false), reopen: () => { if (items.length) show(true); } };
  }

  const cityIn = $('#f-city'), whIn = $('#f-wh');
  const state = { cities: new Map(), city: null, whs: new Map(), npDown: false };
  let cityTimer = 0, cityReq = 0, whReq = 0;
  const cityBox = combo(cityIn, $('#dl-city'), v => cityIn.dispatchEvent(new Event('input')));
  const whBox = combo(whIn, $('#dl-wh'), () => { setErr(whIn, $('#e-wh'), ''); });

  cityIn.addEventListener('focus', () => { if (!state.city) cityBox.reopen(); });
  cityIn.addEventListener('input', () => {
    const v = cityIn.value.trim();
    if (state.cities.has(v)) { cityBox.close(); selectCity(state.cities.get(v)); return; }
    resetWarehouse(); state.city = null;
    clearTimeout(cityTimer);
    if (v.length < 2) { cityBox.close(); return; }
    cityBox.status('Шукаємо…');
    cityTimer = setTimeout(async () => {
      const req = ++cityReq;
      try {
        const j = await np('Address', 'searchSettlements', { CityName: v, Limit: '20' });
        if (req !== cityReq) return;
        const list = ((j.data[0] || {}).Addresses || []).filter(a => a.Warehouses > 0 && a.DeliveryCity);
        state.cities = new Map(list.map(a => [a.Present, { label: a.Present, ref: a.DeliveryCity }]));
        state.npDown = false;
        if (list.length) cityBox.render([...state.cities.keys()]); else cityBox.status('Нічого не знайдено. Перевірте назву.');
      } catch (_) { state.npDown = true; cityBox.close(); setHint('h-city', 'Не вдалося завантажити список. Введіть населений пункт вручну.'); }
    }, 150);
  });

  const whMatches = q => {
    q = q.trim().toLowerCase();
    const all = [...state.whs.keys()];
    if (!q) return all.slice(0, 60);
    const hit = all.filter(l => l.toLowerCase().includes(q));
    const num = /^\d+$/.test(q), rank = l => num && (l.toLowerCase().includes(`№${q}:`) || l.toLowerCase().includes(`№${q} `)) ? 0 : 1;
    return hit.sort((x, y) => rank(x) - rank(y)).slice(0, 60);
  };
  const showWh = () => {
    if (whIn.disabled || !state.whs.size) return;
    const m = whMatches(whIn.value);
    if (state.whs.has(whIn.value.trim())) { whBox.close(); return; }
    if (m.length) whBox.render(m); else whBox.status('Нічого не знайдено. Спробуйте номер відділення.');
  };
  whIn.addEventListener('input', showWh);
  whIn.addEventListener('focus', showWh);

  function resetWarehouse() {
    whReq++; state.whs = new Map(); whBox.close();
    whIn.value = ''; whIn.disabled = true; whIn.placeholder = 'Спершу оберіть населений пункт';
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
      whIn.disabled = false; whIn.placeholder = 'Номер відділення або вулиця';
      setHint('h-wh', `Знайдено ${all.length} ${plural(all.length, 'відділення', 'відділення', 'відділень')} (відділення та поштомати). Введіть номер чи вулицю.`);
      whIn.focus();
    } catch (_) {
      state.npDown = true; whIn.disabled = false; whIn.placeholder = 'Номер відділення';
      setHint('h-wh', 'Не вдалося завантажити відділення. Введіть номер відділення вручну.');
    }
  }
  const setHint = (id, t) => { $('#' + id).textContent = t; };

  /* phone: "+380 " is always there; the rest is formatted as +380 XX XXX XX XX */
  const phoneIn = $('#f-phone');
  const fmtPhone = v => {
    let d = v.replace(/\D/g, '');
    if (d.startsWith('380')) d = d.slice(3); else if (d.startsWith('38')) d = d.slice(2); else if (d.startsWith('0')) d = d.slice(1);
    d = d.slice(0, 9);
    const g = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
    return '+380 ' + g;
  };
  phoneIn.addEventListener('input', () => {
    const atEnd = phoneIn.selectionStart >= phoneIn.value.length - 1;
    const f = fmtPhone(phoneIn.value);
    if (f !== phoneIn.value) { phoneIn.value = f; if (atEnd) phoneIn.setSelectionRange(f.length, f.length); }
  });
  phoneIn.addEventListener('focus', () => { const n = phoneIn.value.length; requestAnimationFrame(() => phoneIn.setSelectionRange(n, n)); });
  phoneIn.addEventListener('keydown', e => { if ((e.key === 'Backspace' || e.key === 'Delete') && phoneIn.value.length <= 5 && phoneIn.selectionStart <= 5) e.preventDefault(); });

  /* ---------- validation + submit ---------- */
  const fields = [
    ['name', '#f-name', '#e-name', v => v.trim() ? '' : 'Вкажіть ім’я'],
    ['phone', '#f-phone', '#e-phone', v => v.replace(/\D/g, '').length >= 12 ? '' : 'Введіть повний номер телефону'],
    ['city', '#f-city', '#e-city', v => (state.cities.has(v.trim()) || (state.npDown && v.trim())) ? '' : 'Оберіть населений пункт зі списку підказок'],
    ['warehouse', '#f-wh', '#e-wh', v => (state.whs.has(v.trim()) || (state.npDown && v.trim())) ? '' : 'Оберіть відділення зі списку підказок'],
  ];
  const setErr = (inp, err, msg) => {
    err.hidden = !msg; err.textContent = msg;
    inp.setAttribute('aria-invalid', msg ? 'true' : 'false'); inp.classList.toggle('is-error', !!msg);
  };
  fields.forEach(([, i, e, rule]) => { const inp = $(i); inp.addEventListener('blur', () => { if (inp.value || inp.getAttribute('aria-invalid') === 'true') setErr(inp, $(e), rule(inp.value)); }); });

  const ORDER_URL = window.ORDER_ENDPOINT || 'https://abrgippumkwgraisdgui.supabase.co/functions/v1/luxwaffle-order';
  let sending = false;
  $('#form').addEventListener('submit', async ev => {
    ev.preventDefault();
    if (sending) return;
    const msgBox = $('#form-msg'), btn = $('#submit'); msgBox.className = 'form-msg'; let first = null;
    fields.forEach(([, i, e, rule]) => { const inp = $(i), m = inp.disabled ? 'Спершу оберіть населений пункт' : rule(inp.value); setErr(inp, $(e), m); if (m && !first) first = inp; });
    const noItems = !sets();
    msgBox.hidden = !noItems; msgBox.textContent = noItems ? 'Оберіть хоча б один колір вище.' : '';
    if (noItems && !first) { $('#swatches').scrollIntoView(); return; }
    if (first) { first.focus(); return; }
    const order = {
      name: $('#f-name').value.trim(), phone: $('#f-phone').value.trim(),
      city: state.city && state.city.label || cityIn.value.trim(),
      warehouse: whIn.value.trim(),
      items: COLORS.map((n, i) => [n, qty[i]]).filter(x => x[1]),
      website: $('#f-website').value,
    };
    sending = true; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); const label = btn.textContent; btn.textContent = 'Надсилаємо…';
    try {
      const r = await fetch(ORDER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok || !res.ok) throw new Error(res.error || r.status);
      msgBox.hidden = false; msgBox.className = 'form-ok'; msgBox.setAttribute('role', 'status');
      msgBox.textContent = 'Дякуємо! Заявку отримано. Ми зв’яжемося з Вами, щоб підтвердити деталі замовлення.';
      btn.textContent = 'Заявку надіслано ✓'; btn.removeAttribute('aria-busy');
      $('#form').reset(); qty.fill(0); document.querySelectorAll('.swatch').forEach(c => { c.classList.remove('is-selected'); c.querySelector('output').textContent = '0'; }); render();
      resetWarehouse(); state.city = null; btn.textContent = 'Заявку надіслано ✓';
      return;
    } catch (_) {
      msgBox.hidden = false; msgBox.className = 'form-msg'; msgBox.setAttribute('role', 'alert');
      msgBox.textContent = 'Не вдалося надіслати заявку. Спробуйте ще раз або зателефонуйте: +380 67 431 82 02.';
      btn.textContent = label;
    } finally { sending = false; btn.disabled = false; btn.removeAttribute('aria-busy'); }
  });

  /* ---------- sticky CTA on mobile (IntersectionObserver, no scroll listener) ---------- */
  const sticky = $('#sticky'), vis = { hero: true, order: false, final: false };
  const upd = () => sticky.classList.toggle('is-visible', !vis.hero && !vis.order && !vis.final);
  const io2 = new IntersectionObserver(es => { es.forEach(e => { vis[e.target.dataset.k] = e.isIntersecting; }); upd(); });
  [['#top', 'hero'], ['#order', 'order'], ['#faq', 'final']].forEach(([s, k]) => { const el = $(s); if (!el) return; el.dataset.k = k; io2.observe(el); });

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
