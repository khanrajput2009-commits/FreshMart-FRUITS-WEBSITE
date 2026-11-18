/* ==========================================================================
   FreshMart Fruits – cart.js
   Shopping cart, wishlist, newsletter & preferences, all persisted in LocalStorage.
   Exposes window.FMCart for main.js. The cart works on every page.

   LocalStorage keys
     fm_cart        { items:[{id,qty}], totals:{…}, updatedAt }
     fm_wishlist    ["apple","mango", …]
     fm_newsletter  { subscribed, email, date }
     fm_prefs       { sort, checkout:{ name, phone, area, … } }
     fm_orders      last 10 demo orders
   ========================================================================== */
(() => {
  'use strict';

  const CFG = window.FM_CONFIG || {};
  const PRODUCTS = window.FM_PRODUCTS || [];
  const BY = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
  const KEY = { cart: 'fm_cart', wish: 'fm_wishlist', news: 'fm_newsletter', prefs: 'fm_prefs', orders: 'fm_orders' };
  const FREE_OVER = CFG.freeDeliveryOver ?? 3000;
  const FEE = CFG.deliveryFee ?? 250;
  const WELCOME_PCT = 0.1;
  const MAX_QTY = 20;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => 'PKR ' + Math.round(n).toLocaleString('en-PK');
  const clamp = (q) => Math.max(1, Math.min(MAX_QTY, parseInt(q, 10) || 1));

  const ICON = {
    check: '<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    minus: '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
    cart: '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.5L20.5 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>',
  };

  /* ---------- storage (falls back to memory if LocalStorage is blocked) ---------- */
  const mem = {};
  const store = {
    get(k, fallback) {
      try { const v = localStorage.getItem(k); if (v !== null) return JSON.parse(v); } catch (e) { /* ignore */ }
      return k in mem ? mem[k] : fallback;
    },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  /* ---------- state ---------- */
  let cart = { items: [] };
  let wish = [];
  let lastAddedId = null;

  function loadState() {
    const raw = store.get(KEY.cart, { items: [] });
    const items = [];
    (raw && Array.isArray(raw.items) ? raw.items : []).forEach((i) => {
      if (i && BY[i.id] && !items.some((x) => x.id === i.id)) items.push({ id: i.id, qty: clamp(i.qty) });
    });
    cart = { items };
    const w = store.get(KEY.wish, []);
    wish = Array.isArray(w) ? w.filter((id) => BY[id]) : [];
  }

  const orders = () => { const o = store.get(KEY.orders, []); return Array.isArray(o) ? o : []; };
  const newsletter = {
    get: () => store.get(KEY.news, { subscribed: false }),
    subscribe(email) { const v = { subscribed: true, email, date: new Date().toISOString() }; store.set(KEY.news, v); render(); return v; },
  };
  const prefs = {
    get: () => store.get(KEY.prefs, {}) || {},
    set(patch) { store.set(KEY.prefs, Object.assign({}, prefs.get(), patch)); },
  };
  const welcomeEligible = () => !!newsletter.get().subscribed && orders().length === 0;

  function totals() {
    const count = cart.items.reduce((s, i) => s + i.qty, 0);
    const subtotal = cart.items.reduce((s, i) => s + BY[i.id].price * i.qty, 0);
    const discount = welcomeEligible() ? Math.round(subtotal * WELCOME_PCT) : 0;
    const delivery = subtotal === 0 || subtotal >= FREE_OVER ? 0 : FEE;
    return { count, subtotal, discount, delivery, total: subtotal - discount + delivery };
  }

  function save() {
    store.set(KEY.cart, { items: cart.items, totals: totals(), updatedAt: Date.now() });
    render();
  }

  /* ---------- cart actions ---------- */
  function add(id, qty = 1, opts = {}) {
    const p = BY[id]; if (!p) return;
    const line = cart.items.find((i) => i.id === id);
    const wanted = (line ? line.qty : 0) + clamp(qty);
    if (line) line.qty = Math.min(MAX_QTY, wanted); else cart.items.push({ id, qty: clamp(qty) });
    lastAddedId = id;
    save();
    if (!opts.silent) {
      toast(wanted > MAX_QTY ? `Maximum ${MAX_QTY} per item. ${p.name} set to ${MAX_QTY}.` : `${p.name} added to your cart`);
      if (!opts.noFly) fly(opts.from);
    }
  }
  function setQty(id, qty) {
    const line = cart.items.find((i) => i.id === id); if (!line) return;
    line.qty = clamp(qty); save();
  }
  function remove(id) {
    cart.items = cart.items.filter((i) => i.id !== id); save();
  }
  function clear() { cart.items = []; save(); }

  /* ---------- wishlist ---------- */
  const wishlist = {
    has: (id) => wish.includes(id),
    all: () => wish.slice(),
    count: () => wish.length,
    toggle(id) {
      if (!BY[id]) return false;
      const on = !wish.includes(id);
      wish = on ? wish.concat(id) : wish.filter((x) => x !== id);
      store.set(KEY.wish, wish);
      syncWishUI(id);
      toast(on ? `${BY[id].name} saved to favourites` : `${BY[id].name} removed from favourites`);
      document.dispatchEvent(new CustomEvent('fm:wishlist', { detail: { id, on } }));
      return on;
    },
  };
  function syncWishUI(popId) {
    $$('[data-wish]').forEach((b) => {
      const on = wish.includes(b.dataset.wish);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
      const name = BY[b.dataset.wish] ? BY[b.dataset.wish].name : 'fruit';
      b.setAttribute('aria-label', (on ? 'Remove ' : 'Add ') + name + (on ? ' from favourites' : ' to favourites'));
      if (popId && b.dataset.wish === popId) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    });
    $$('[data-wish-count]').forEach((el) => {
      el.textContent = wish.length;
      if (el.classList.contains('badge')) el.dataset.zero = String(wish.length === 0);
    });
  }

  /* ---------- rendering ---------- */
  let prevCount = null;
  function render() {
    const t = totals();
    $$('[data-cart-count]').forEach((el) => {
      el.textContent = t.count; el.dataset.zero = String(t.count === 0);
      if (prevCount !== null && t.count > prevCount) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    });
    $$('[data-cart-count-text]').forEach((el) => { el.textContent = `(${t.count} item${t.count === 1 ? '' : 's'})`; });
    prevCount = t.count;

    const drawer = $('#cart-drawer'); if (!drawer) return;
    drawer.classList.toggle('is-empty', cart.items.length === 0);
    const list = $('#cart-items');
    list.innerHTML = cart.items.map((i) => {
      const p = BY[i.id];
      return `<li class="cart-item${i.id === lastAddedId ? ' new' : ''}" data-id="${i.id}">
        <img src="${p.image}" width="72" height="72" alt="${esc(p.alt)}" loading="lazy">
        <div><p class="ci-name">${esc(p.name)}</p><p class="ci-price">${fmt(p.price)} / ${esc(p.unit)}</p>
          <div class="qty"><button type="button" data-ci-minus="${i.id}" aria-label="Decrease quantity of ${esc(p.name)}">${ICON.minus}</button>
          <input type="number" min="1" max="${MAX_QTY}" value="${i.qty}" data-ci-input="${i.id}" inputmode="numeric" aria-label="Quantity of ${esc(p.name)}">
          <button type="button" data-ci-plus="${i.id}" aria-label="Increase quantity of ${esc(p.name)}">${ICON.plus}</button></div></div>
        <div class="ci-right"><span class="ci-line">${fmt(p.price * i.qty)}</span>
          <button type="button" class="ci-remove" data-ci-remove="${i.id}" aria-label="Remove ${esc(p.name)} from cart">${ICON.trash}</button></div></li>`;
    }).join('');
    lastAddedId = null;

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('cart-subtotal', fmt(t.subtotal));
    setText('cart-delivery', t.delivery === 0 ? (t.subtotal ? 'Free' : fmt(0)) : fmt(t.delivery));
    setText('cart-total', fmt(t.total));
    const dRow = $('#cart-discount-row'); if (dRow) { dRow.hidden = t.discount === 0; setText('cart-discount', '-' + fmt(t.discount)); }
    const remaining = FREE_OVER - t.subtotal;
    setText('ship-text', remaining > 0 ? `Add ${fmt(remaining)} more for free delivery` : 'You have unlocked free delivery!');
    const fill = $('#ship-fill'); if (fill) fill.style.width = Math.min(100, (t.subtotal / FREE_OVER) * 100) + '%';
    if ($('#checkout-modal') && $('#checkout-modal').classList.contains('open')) fillSummary();
  }

  function fillSummary() {
    const t = totals();
    $('#co-lines').innerHTML = cart.items.map((i) => `<li><span>${esc(BY[i.id].name)} × ${i.qty}</span><strong>${fmt(BY[i.id].price * i.qty)}</strong></li>`).join('');
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('co-subtotal', fmt(t.subtotal));
    setText('co-delivery', t.delivery === 0 ? 'Free' : fmt(t.delivery));
    setText('co-total', fmt(t.total));
    const dRow = $('#co-discount-row'); if (dRow) { dRow.hidden = t.discount === 0; setText('co-discount', '-' + fmt(t.discount)); }
  }

  /* ---------- toast & motion ---------- */
  function toast(msg) {
    const wrap = $('#toast-wrap'); if (!wrap) return;
    const t = document.createElement('div');
    t.className = 'toast'; t.innerHTML = ICON.check + '<span>' + esc(msg) + '</span>';
    wrap.appendChild(t);
    while (wrap.children.length > 3) wrap.firstElementChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 2600);
  }
  function ping() {
    const b = $('.cart-btn'); if (!b) return;
    b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping');
  }
  function fly(src) {
    const target = $('.cart-btn');
    if (reduceMotion || !src || !target || !src.animate) { ping(); return; }
    const a = src.getBoundingClientRect(), b = target.getBoundingClientRect();
    if (!a.width) { ping(); return; }
    const clone = src.cloneNode(true);
    clone.removeAttribute('loading'); clone.removeAttribute('id'); clone.className = '';
    Object.assign(clone.style, { position: 'fixed', left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px', margin: 0, zIndex: 600, borderRadius: '50%', objectFit: 'cover', pointerEvents: 'none', boxShadow: '0 12px 30px rgba(0,0,0,.25)' });
    document.body.appendChild(clone);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = clone.animate([
      { transform: 'translate(0,0) scale(.55)', opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 70}px) scale(.38)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(.06)`, opacity: .3 },
    ], { duration: 780, easing: 'cubic-bezier(.45,.05,.55,.95)' });
    anim.onfinish = () => { clone.remove(); ping(); };
  }

  /* ---------- drawer / modal ---------- */
  const drawer = $('#cart-drawer'), overlay = $('.overlay'), modal = $('#checkout-modal');
  let lastFocus = null;
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function trapTab(box, e) {
    if (e.key !== 'Tab') return;
    const f = $$(FOCUSABLE, box).filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function openCart() {
    if (!drawer) return;
    lastFocus = document.activeElement; render();
    drawer.classList.add('open'); overlay.classList.add('show'); drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll'); setTimeout(() => drawer.focus(), 60);
  }
  function closeCart(restore = true) {
    if (!drawer || !drawer.classList.contains('open')) return;
    drawer.classList.remove('open'); overlay.classList.remove('show'); drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    if (restore && lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function openCheckout() {
    if (!modal || !cart.items.length) return;
    closeCart(false);
    $('#checkout-form-view').hidden = false; $('#checkout-done-view').hidden = true;
    const saved = prefs.get().checkout || {}; const f = $('#checkout-form');
    ['name', 'phone', 'area', 'address', 'slot'].forEach((n) => { if (saved[n] && f.elements[n]) f.elements[n].value = saved[n]; });
    if (saved.payment) { const r = $$('input[name="payment"]', f).find((x) => x.value === saved.payment); if (r) r.checked = true; }
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); document.body.classList.add('no-scroll');
    fillSummary(); setTimeout(() => $('#co-name').focus(), 80);
  }
  function closeCheckout() {
    if (!modal || !modal.classList.contains('open')) return;
    modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); document.body.classList.remove('no-scroll');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---------- form validation helper (shared with main.js) ---------- */
  function setFieldError(input, msg) {
    const field = input.closest('.field'); if (!field) return;
    field.classList.toggle('invalid', !!msg);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    const err = $('.err', field); if (err) err.textContent = msg || '';
  }
  function validateForm(form, rules) {
    let firstBad = null;
    Object.keys(rules).forEach((name) => {
      const input = form.elements[name]; if (!input) return;
      const msg = rules[name](String(input.value).trim());
      setFieldError(input, msg);
      if (msg && !firstBad) firstBad = input;
    });
    if (firstBad) firstBad.focus();
    return !firstBad;
  }
  function liveValidate(form, rules) {
    Object.keys(rules).forEach((name) => {
      const input = form.elements[name]; if (!input) return;
      input.addEventListener('blur', () => setFieldError(input, rules[name](String(input.value).trim())));
      input.addEventListener('input', () => { if (input.closest('.field').classList.contains('invalid')) setFieldError(input, rules[name](String(input.value).trim())); });
    });
  }
  const checkoutRules = {
    name: (v) => (v.length < 2 ? 'Please enter your full name.' : ''),
    phone: (v) => (/^(?:\+92|0092|92|0)?3\d{9}$/.test(v.replace(/[\s-]/g, '')) ? '' : 'Enter a valid Pakistani mobile number, e.g. 0300 1234567.'),
    area: (v) => (v ? '' : 'Please choose your area in Karachi.'),
    address: (v) => (v.length < 8 ? 'Please enter your full delivery address.' : ''),
  };

  function placeOrder(form) {
    if (!validateForm(form, checkoutRules)) return;
    const d = Object.fromEntries(new FormData(form).entries());
    const t = totals();
    const id = 'FM-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.floor(Math.random() * 90 + 10);
    const order = { id, createdAt: new Date().toISOString(), customer: { name: d.name, phone: d.phone, area: d.area, address: d.address, slot: d.slot, payment: d.payment },
      items: cart.items.map((i) => ({ id: i.id, name: BY[i.id].name, qty: i.qty, price: BY[i.id].price })), totals: t };
    store.set(KEY.orders, [order].concat(orders()).slice(0, 10));
    prefs.set({ checkout: { name: d.name, phone: d.phone, area: d.area, address: d.address, slot: d.slot, payment: d.payment } });
    cart.items = []; save();
    $('#done-name').textContent = d.name.split(' ')[0]; $('#done-id').textContent = id;
    $('#done-area').textContent = d.area; $('#done-slot').textContent = d.slot; $('#done-total').textContent = fmt(t.total);
    $('#checkout-form-view').hidden = true; $('#checkout-done-view').hidden = false;
    modal.querySelector('.modal-panel').scrollTop = 0;
    document.dispatchEvent(new CustomEvent('fm:order', { detail: order }));
  }

  /* ---------- events ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target;
    const addBtn = t.closest('[data-add-to-cart]');
    if (addBtn) {
      const card = addBtn.closest('.product-card');
      const input = card && $('.qty input', card);
      const qty = input ? clamp(input.value) : 1;
      add(addBtn.dataset.addToCart, qty, { from: card && $('.pc-media img', card) });
      if (input) input.value = 1;
      const html = addBtn.innerHTML; addBtn.classList.add('is-added'); addBtn.innerHTML = ICON.check + ' Added';
      setTimeout(() => { addBtn.classList.remove('is-added'); addBtn.innerHTML = html; }, 1300);
      return;
    }
    const bundle = t.closest('[data-add-bundle]');
    if (bundle) {
      const ids = bundle.dataset.addBundle.split(',').filter((id) => BY[id]);
      ids.forEach((id) => add(id, 1, { silent: true }));
      toast(`Bundle added: ${ids.length} fruits in your cart`); ping(); openCart(); return;
    }
    const wishBtn = t.closest('[data-wish]'); if (wishBtn) { wishlist.toggle(wishBtn.dataset.wish); return; }

    const qMinus = t.closest('[data-qty-minus]'), qPlus = t.closest('[data-qty-plus]');
    if (qMinus || qPlus) {
      const input = $('input', (qMinus || qPlus).closest('[data-qty]'));
      input.value = clamp((parseInt(input.value, 10) || 1) + (qPlus ? 1 : -1)); return;
    }
    const cm = t.closest('[data-ci-minus]'), cp = t.closest('[data-ci-plus]'), cr = t.closest('[data-ci-remove]');
    if (cm || cp) {
      const id = (cm || cp).dataset.ciMinus || (cm || cp).dataset.ciPlus; const line = cart.items.find((i) => i.id === id);
      if (!line) return;
      if (cm && line.qty <= 1) { remove(id); return; }
      setQty(id, line.qty + (cp ? 1 : -1));
      const again = $(cp ? `[data-ci-plus="${id}"]` : `[data-ci-minus="${id}"]`); if (again) again.focus(); return;
    }
    if (cr) { remove(cr.dataset.ciRemove); toast('Item removed from cart'); return; }

    if (t.closest('[data-open-cart]')) { openCart(); return; }
    if (t.closest('[data-close-cart]')) { closeCart(); return; }
    if (t.closest('#checkout-open')) { openCheckout(); return; }
    if (t.closest('#cart-clear')) { clear(); toast('Cart cleared'); return; }
    if (t.closest('[data-close-checkout]') || t === modal) { closeCheckout(); }
  });
  document.addEventListener('change', (e) => {
    const ci = e.target.closest && e.target.closest('[data-ci-input]');
    if (ci) { setQty(ci.dataset.ciInput, ci.value); return; }
    const qi = e.target.closest && e.target.closest('.product-card .qty input');
    if (qi) qi.value = clamp(qi.value);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeCheckout(); closeCart(); return; }
    if (drawer && drawer.classList.contains('open')) trapTab(drawer, e);
    if (modal && modal.classList.contains('open')) trapTab(modal, e);
  });
  window.addEventListener('storage', (e) => { // keep several open tabs in sync
    if (!e.key || [KEY.cart, KEY.wish, KEY.news, KEY.orders].includes(e.key)) { loadState(); syncWishUI(); render(); }
  });

  /* ---------- init ---------- */
  loadState();
  const form = $('#checkout-form');
  if (form) {
    form.addEventListener('submit', (e) => { e.preventDefault(); placeOrder(form); });
    liveValidate(form, checkoutRules);
  }
  syncWishUI(); render(); prevCount = totals().count;

  window.FMCart = {
    config: CFG, products: BY, fmt, store, add, setQty, remove, clear, totals, toast,
    items: () => cart.items.map((i) => Object.assign({}, i)), open: openCart, close: closeCart,
    wishlist, newsletter, prefs, validateForm, liveValidate, setFieldError, keys: KEY,
  };
})();
