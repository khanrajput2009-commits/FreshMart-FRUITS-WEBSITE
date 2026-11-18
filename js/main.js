/* ==========================================================================
   FreshMart Fruits – main.js
   UI behaviour: preloader, header, mobile menu, scroll reveals, counters,
   catalogue search/filter/sort, seasonal highlighting, forms, newsletter.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const FM = window.FMCart;
  const CFG = window.FM_CONFIG || {};
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* ---------- preloader (skipped for 30 minutes after it has played; flag kept in LocalStorage) ---------- */
  function initPreloader() {
    const pre = $('#preloader'); if (!pre) return;
    let done = false;
    const hide = () => {
      if (done) return; done = true;
      try { localStorage.setItem('fm_preloader', String(Date.now())); } catch (e) { /* ignore */ }
      pre.classList.add('hide'); setTimeout(() => pre.remove(), 700);
    };
    if (document.documentElement.classList.contains('no-pre')) { pre.remove(); return; }
    const minTime = reduceMotion ? 0 : 900;
    const started = performance.now();
    const finish = () => setTimeout(hide, Math.max(0, minTime - (performance.now() - started)));
    if (document.readyState === 'complete') finish(); else window.addEventListener('load', finish, { once: true });
    setTimeout(hide, 3500); // safety net
  }

  /* ---------- header & navigation ---------- */
  function initHeader() {
    const header = $('.site-header');
    const onScroll = () => header && header.classList.toggle('scrolled', window.scrollY > 8);
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

    const toggle = $('.nav-toggle'), nav = $('#main-nav'); if (!toggle || !nav) return;
    const setOpen = (open) => {
      nav.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    toggle.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!nav.classList.contains('open')); });
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('click', (e) => { if (!nav.contains(e.target) && !toggle.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    window.addEventListener('resize', () => { if (window.innerWidth > 900) setOpen(false); });
  }

  /* ---------- scroll-triggered reveals & counters ---------- */
  function initReveal() {
    const items = $$('.reveal');
    if (!('IntersectionObserver' in window) || reduceMotion) { items.forEach((el) => el.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach((el) => io.observe(el));
  }
  function initCounters() {
    const els = $$('[data-count]'); if (!els.length) return;
    const run = (el) => {
      const end = parseInt(el.dataset.count, 10); if (reduceMotion) { el.textContent = end; return; }
      const dur = 1400, t0 = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(end * eased); if (p < 1) requestAnimationFrame(tick);
      };
      el.textContent = 0; requestAnimationFrame(tick);
    };
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { run(en.target); io.unobserve(en.target); } }), { threshold: 0.6 });
    els.forEach((el) => io.observe(el));
  }

  /* ---------- small site-wide bits ---------- */
  function initMisc() {
    $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
    // configurable WhatsApp number (see js/products.js → FM_CONFIG.whatsappNumber)
    if (CFG.whatsappNumber) {
      $$('[data-whatsapp]').forEach((a) => {
        try { const u = new URL(a.href); u.pathname = '/' + CFG.whatsappNumber; a.href = u.toString(); } catch (e) { /* ignore */ }
      });
    }
  }

  /* ---------- newsletter (state stored in LocalStorage) ---------- */
  function initNewsletter() {
    const forms = $$('.newsletter-form'); if (!forms.length) return;
    const state = FM.newsletter.get();
    forms.forEach((form) => {
      const msg = form.parentElement.querySelector('.news-msg'), input = $('input', form);
      const showSubscribed = (email) => {
        msg.classList.remove('error');
        msg.textContent = `You're subscribed as ${email}. Your 10% welcome discount applies automatically at checkout.`;
        input.value = email; const btn = $('button', form); btn.textContent = 'Subscribed'; btn.disabled = true;
      };
      if (state.subscribed && state.email) showSubscribed(state.email);
      form.addEventListener('submit', (e) => {
        e.preventDefault(); const email = input.value.trim();
        if (!EMAIL_RE.test(email)) { msg.classList.add('error'); msg.textContent = 'Please enter a valid email address.'; input.focus(); return; }
        FM.newsletter.subscribe(email);
        $$('.newsletter-form').forEach((f) => { const m = f.parentElement.querySelector('.news-msg'), i = $('input', f), b = $('button', f); m.classList.remove('error'); m.textContent = `Welcome to the club! Your 10% welcome discount applies automatically at checkout.`; i.value = email; b.textContent = 'Subscribed'; b.disabled = true; });
        FM.toast('Subscribed! 10% off your first order');
      });
    });
  }

  /* ---------- fruits page: search, filter, sort ---------- */
  function initCatalog() {
    const grid = $('#product-grid[data-catalog]'); if (!grid) return;
    const cards = $$('.product-card', grid);
    const search = $('#fruit-search'), clearBtn = $('#search-clear'), sortSel = $('#fruit-sort');
    const chips = $$('.chip'), countEl = $('#result-count'), empty = $('#empty-state'), resetBtn = $('#reset-filters');
    const validCats = chips.map((c) => c.dataset.cat);
    const params = new URLSearchParams(location.search);
    const savedSort = FM.prefs.get().sort;
    const state = {
      q: params.get('q') || '',
      cat: params.get('fav') ? 'fav' : (validCats.includes(params.get('category')) ? params.get('category') : 'all'),
      sort: ['featured', 'price-asc', 'price-desc', 'name-asc'].includes(savedSort) ? savedSort : 'featured',
    };
    search.value = state.q; sortSel.value = state.sort;

    const sorters = {
      featured: (a, b) => a.dataset.order - b.dataset.order,
      'price-asc': (a, b) => a.dataset.price - b.dataset.price || a.dataset.order - b.dataset.order,
      'price-desc': (a, b) => b.dataset.price - a.dataset.price || a.dataset.order - b.dataset.order,
      'name-asc': (a, b) => a.dataset.name.localeCompare(b.dataset.name),
    };

    function apply() {
      const q = state.q.trim().toLowerCase();
      let shown = 0;
      cards.forEach((c) => {
        const okCat = state.cat === 'all' || (state.cat === 'fav' ? FM.wishlist.has(c.dataset.id) : c.dataset.category === state.cat);
        const okQ = !q || c.dataset.name.includes(q) || c.dataset.category.toLowerCase().includes(q) || c.dataset.keywords.includes(q) || c.dataset.season === q;
        const show = okCat && okQ; c.hidden = !show;
        if (show) { c.style.setProperty('--d', Math.min(shown, 12) * 40 + 'ms'); shown++; c.classList.add('in'); }
      });
      cards.slice().sort(sorters[state.sort]).forEach((c) => grid.appendChild(c));
      countEl.textContent = shown === 0 ? 'No fruits match your search' : `Showing ${shown} fruit${shown === 1 ? '' : 's'}${state.cat !== 'all' && state.cat !== 'fav' ? ' in ' + state.cat : ''}`;
      empty.hidden = shown !== 0; grid.hidden = shown === 0;
      const favOnly = state.cat === 'fav' && !q;
      $('h3', empty).textContent = favOnly ? 'No favourites yet' : 'No fruits found';
      $('p', empty).textContent = favOnly ? 'Tap the heart on any fruit to save it here for next time.' : "We couldn't find a match for your search or filters. Try another name, or browse all our fresh fruits.";
      resetBtn.textContent = favOnly ? 'Browse all fruits' : 'Clear search & filters';
      chips.forEach((c) => { const on = c.dataset.cat === state.cat; c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', String(on)); });
      clearBtn.hidden = !state.q;
      FM.prefs.set({ sort: state.sort });
      const u = new URL(location.href);
      state.q ? u.searchParams.set('q', state.q) : u.searchParams.delete('q');
      u.searchParams.delete('fav');
      state.cat !== 'all' ? u.searchParams.set(state.cat === 'fav' ? 'fav' : 'category', state.cat === 'fav' ? '1' : state.cat) : u.searchParams.delete('category');
      if (state.cat === 'fav') u.searchParams.delete('category');
      history.replaceState(null, '', u);
    }

    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value; apply(); }, 120); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; state.q = ''; apply(); } });
    clearBtn.addEventListener('click', () => { search.value = ''; state.q = ''; apply(); search.focus(); });
    sortSel.addEventListener('change', () => { state.sort = sortSel.value; apply(); });
    chips.forEach((c) => c.addEventListener('click', () => { state.cat = c.dataset.cat; apply(); }));
    resetBtn.addEventListener('click', () => { state.q = ''; state.cat = 'all'; search.value = ''; apply(); });
    document.addEventListener('fm:wishlist', () => { if (state.cat === 'fav') apply(); });
    apply();
  }

  /* ---------- seasonal page: flag the season that is in harvest right now ---------- */
  function initSeasonal() {
    const blocks = $$('.season-block'); if (!blocks.length) return;
    const m = new Date().getMonth() + 1;
    const cur = m >= 11 || m <= 3 ? 'winter' : 'summer'; // Karachi: winter Nov–Mar, summer Apr–Oct
    blocks.forEach((b) => {
      const on = b.dataset.season === cur; b.classList.toggle('is-current', on);
      const chip = $('.now-chip', b); if (chip) chip.hidden = !on;
    });
    const chip = $('#season-now-chip');
    if (chip) chip.innerHTML = '<span class="dot"></span> ' + (cur === 'winter' ? 'Winter harvest is in season now' : 'Summer harvest is in season now');
  }

  /* ---------- contact page ---------- */
  function initContact() {
    const form = $('#contact-form'); if (!form) return;
    const rules = {
      name: (v) => (v.length < 2 ? 'Please enter your name.' : ''),
      email: (v) => (EMAIL_RE.test(v) ? '' : 'Please enter a valid email address.'),
      subject: (v) => (v.length < 3 ? 'Please add a short subject.' : ''),
      message: (v) => (v.length < 10 ? 'Your message should be at least 10 characters.' : ''),
    };
    FM.liveValidate(form, rules);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!FM.validateForm(form, rules)) return;
      const d = Object.fromEntries(new FormData(form).entries());
      // No backend in this static build: keep a local copy and offer a WhatsApp hand-off.
      const sent = FM.store.get('fm_messages', []);
      FM.store.set('fm_messages', [{ ...d, date: new Date().toISOString() }].concat(Array.isArray(sent) ? sent : []).slice(0, 5));
      const wa = $('#wa-from-form');
      if (wa) {
        const text = `Hello FreshMart Fruits, I'm ${d.name}. ${d.subject}: ${d.message}`;
        const u = new URL(wa.href); u.pathname = '/' + (CFG.whatsappNumber || u.pathname.slice(1)); u.searchParams.set('text', text); wa.href = u.toString();
      }
      form.hidden = true; $('#form-success').hidden = false; $('#form-success').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      FM.toast('Message ready: thank you!');
    });
  }

  /* ---------- scroll UI: progress bar & back-to-top ---------- */
  function initScrollUI() {
    const bar = $('.scroll-progress span'), top = $('.to-top');
    let ticking = false;
    const update = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight, y = window.scrollY;
      if (bar) bar.style.setProperty('--p', h > 0 ? Math.min(1, y / h).toFixed(4) : '0');
      if (top) top.classList.toggle('show', y > 700);
      ticking = false;
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
    if (top) top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
  }

  /* ---------- pointer parallax on hero fruit (desktop only) ---------- */
  function initPointerParallax() {
    if (reduceMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    $$('.hero, .page-hero').forEach((sec) => {
      const targets = $$('.hero-visual, .page-hero-art', sec); if (!targets.length) return;
      sec.addEventListener('pointermove', (e) => {
        const r = sec.getBoundingClientRect();
        const mx = ((e.clientX - r.left) / r.width - 0.5) * 2, my = ((e.clientY - r.top) / r.height - 0.5) * 2;
        targets.forEach((t) => { t.style.setProperty('--mx', mx.toFixed(3)); t.style.setProperty('--my', my.toFixed(3)); });
      });
      sec.addEventListener('pointerleave', () => targets.forEach((t) => { t.style.setProperty('--mx', 0); t.style.setProperty('--my', 0); }));
    });
  }

  /* ---------- parallax background band ---------- */
  function initBandParallax() {
    const imgs = $$('[data-parallax]'); if (!imgs.length || reduceMotion) return;
    let ticking = false;
    const update = () => {
      const vh = window.innerHeight;
      imgs.forEach((img) => {
        const box = img.parentElement.getBoundingClientRect(); if (box.bottom < 0 || box.top > vh) return;
        const p = (box.top + box.height / 2 - vh / 2) / vh;
        img.style.setProperty('--py', (p * -40).toFixed(1) + 'px');
      });
      ticking = false;
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update); update();
  }

  /* ---------- 3D tilt + light sweep on product cards (mouse only) ---------- */
  function initTilt() {
    if (reduceMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    $$('.product-card').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        card.style.setProperty('--ry', ((x - 0.5) * 6).toFixed(2) + 'deg');
        card.style.setProperty('--rx', ((0.5 - y) * 6).toFixed(2) + 'deg');
        card.style.setProperty('--gx', (x * 100).toFixed(0) + '%'); card.style.setProperty('--gy', (y * 100).toFixed(0) + '%');
        card.classList.add('tilting');
      });
      card.addEventListener('pointerleave', () => card.classList.remove('tilting'));
    });
  }

  /* ---------- button ripple ---------- */
  function initRipple() {
    if (reduceMotion) return;
    document.addEventListener('pointerdown', (e) => {
      const b = e.target.closest && e.target.closest('.btn'); if (!b) return;
      const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 1.2;
      const s = document.createElement('span'); s.className = 'ripple';
      s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
      b.appendChild(s); setTimeout(() => s.remove(), 700);
    });
  }

  /* ---------- product images fade in once loaded ---------- */
  function initImages() {
    $$('.pc-media img').forEach((img) => {
      const done = () => img.classList.add('loaded');
      if (img.complete) done(); else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
    });
  }

  /* ---------- quick view modal ---------- */
  function initQuickView() {
    const modal = $('#quick-modal'); if (!modal || !FM) return;
    const P = Object.fromEntries((window.FM_PRODUCTS || []).map((p) => [p.id, p]));
    const el = (id) => document.getElementById(id);
    const SEASON = { winter: 'In season: November to March', summer: 'In season: April to October', all: 'Available all year round' };
    let current = null, lastFocus = null;
    function open(id, trigger) {
      const p = P[id]; if (!p) return;
      current = id; lastFocus = trigger || document.activeElement;
      const img = el('qv-img'); img.src = p.image; img.alt = p.alt; img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
      el('qv-cat').textContent = p.category; el('qv-name').textContent = p.name;
      el('qv-price').textContent = FM.fmt(p.price); el('qv-unit').textContent = '/ ' + p.unit; el('qv-desc').textContent = p.desc;
      const ul = el('qv-benefits'); ul.textContent = '';
      p.benefits.forEach((b) => { const li = document.createElement('li'); li.textContent = b; ul.appendChild(li); });
      el('qv-season').textContent = SEASON[p.season] || '';
      const badge = el('qv-badge'); badge.hidden = !p.badge; badge.textContent = p.badge || '';
      const w = el('qv-wish'), on = FM.wishlist.has(id);
      w.dataset.wish = id; w.classList.toggle('is-active', on); w.setAttribute('aria-pressed', String(on));
      w.setAttribute('aria-label', (on ? 'Remove ' : 'Add ') + p.name + (on ? ' from favourites' : ' to favourites'));
      el('qv-qty').value = 1;
      modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); document.body.classList.add('no-scroll');
      setTimeout(() => el('qv-add').focus(), 80);
    }
    function close() {
      if (!modal.classList.contains('open')) return;
      modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); document.body.classList.remove('no-scroll');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    document.addEventListener('click', (e) => {
      const q = e.target.closest('[data-quick]');
      if (q) { open(q.dataset.quick, q); return; }
      const media = e.target.closest('.product-card .pc-media img');
      if (media) { open(media.closest('.product-card').dataset.id, media); return; }
      if (e.target.closest('[data-close-quick]') || e.target === modal) close();
    });
    el('qv-add').addEventListener('click', () => {
      const qty = Math.max(1, Math.min(20, parseInt(el('qv-qty').value, 10) || 1));
      FM.add(current, qty, { from: el('qv-img') }); close();
    });
    el('qv-qty').addEventListener('change', (e) => { e.target.value = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)); });
    document.addEventListener('keydown', (e) => {
      if (!modal.classList.contains('open')) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key === 'Tab') {
        const f = $$('a[href],button:not([disabled]),input:not([disabled])', modal).filter((n) => n.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }, true);
  }

  /* ---------- boot ---------- */
  initPreloader(); initHeader(); initMisc(); initReveal(); initCounters();
  initNewsletter(); initCatalog(); initSeasonal(); initContact();
  initScrollUI(); initPointerParallax(); initBandParallax(); initTilt(); initRipple(); initImages(); initQuickView();
})();
