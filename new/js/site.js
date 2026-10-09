/* Dodoleiro — site interactions */
(() => {
  'use strict';

  window.__ddReady = true;

  const d = document;
  const root = d.documentElement;
  const $ = (s, c = d) => c.querySelector(s);
  const $$ = (s, c = d) => Array.from(c.querySelectorAll(s));
  const matches = (q) => window.matchMedia(q).matches;

  const REDUCE = matches('(prefers-reduced-motion: reduce)');
  const FINE = matches('(hover: hover) and (pointer: fine)');
  const gsap = window.gsap;
  const ST = window.ScrollTrigger;
  const ANIM = !!(gsap && ST) && !REDUCE;

  const GALLERY_URL = '/gallery/gallery.json';
  const REEL_MAX = 12;
  const ARROW = 'M4 12h15M13 6l6 6-6 6';

  let lenis = null;
  let photos = [];
  const locks = new Set();

  const pad2 = (n) => String(n).padStart(2, '0');
  const icon = (path) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const ratio = (p) => (p.w > 0 && p.h > 0 ? p.w / p.h : 0.8);
  const isLqip = (v) => typeof v === 'string' && /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(v);
  const altFor = (p, i) => (p.caption ? `${p.caption} — Dodoleiro live` : `Dodoleiro live, photo ${i + 1}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  if (ANIM) {
    gsap.registerPlugin(ST);
    ST.config({ ignoreMobileResize: true });
  } else {
    root.classList.add('no-anim');
  }

  function lock(key, on) {
    if (on) locks.add(key); else locks.delete(key);
    const locked = locks.size > 0;
    root.classList.toggle('is-locked', locked);
    if (lenis) { if (locked) lenis.stop(); else lenis.start(); }
  }

  function scrollToTarget(target) {
    if (lenis) {
      lenis.scrollTo(target, { duration: 1.4 });
    } else if (target === 0) {
      window.scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' });
    } else {
      target.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'start' });
    }
  }

  // ---------------------------------------------------------------- data

  async function loadGallery() {
    const ctrl = 'AbortController' in window ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 3500) : 0;
    try {
      const res = await fetch(GALLERY_URL, { cache: 'no-cache', signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) return [];
      const data = await res.json();
      const list = Array.isArray(data.photos) ? data.photos : [];
      return list.filter((p) => p && typeof p.src === 'string' && p.src);
    } catch (e) {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  function fontsReady() {
    if (!d.fonts || !d.fonts.ready) return Promise.resolve();
    return Promise.race([d.fonts.ready, wait(2500)]);
  }

  function setImg(img, p, sizes) {
    if (p.thumb && p.tw > 0 && p.w > 0 && p.thumb !== p.src) {
      img.sizes = sizes;
      img.srcset = `${p.thumb} ${p.tw}w, ${p.src} ${p.w}w`;
    }
    img.src = p.thumb || p.src;
  }

  // ---------------------------------------------------------------- gallery reel

  function renderGallery() {
    const section = $('#gallery');
    const track = $('.reel__track');
    const n = photos.length;
    $$('.reel__count, .sheet__count').forEach((el) => { el.textContent = n ? `(${n})` : ''; });

    if (!n) {
      section.classList.add('is-empty');
      $('.gallery__empty').hidden = false;
      return;
    }

    const frag = d.createDocumentFragment();
    photos.slice(0, REEL_MAX).forEach((p, i) => {
      const fig = d.createElement('div');
      fig.className = 'shot';
      fig.setAttribute('role', 'listitem');
      fig.style.setProperty('--ar', ratio(p).toFixed(4));

      const btn = d.createElement('button');
      btn.type = 'button';
      btn.className = 'shot__btn';
      btn.dataset.index = String(i);
      btn.setAttribute('aria-label', `${pad2(i + 1)} / ${pad2(n)} — open photo${p.caption ? `: ${p.caption}` : ''}`);
      if (isLqip(p.lqip)) btn.style.backgroundImage = `url("${p.lqip}")`;

      const img = d.createElement('img');
      img.className = 'shot__img';
      img.alt = '';
      img.decoding = 'async';
      img.loading = i < 3 ? 'eager' : 'lazy';
      setImg(img, p, '(min-width: 900px) 50vw, 85vw');

      const num = d.createElement('span');
      num.className = 'shot__num';
      num.textContent = `${pad2(i + 1)} / ${pad2(n)}`;

      btn.append(img, num);
      fig.append(btn);
      if (p.caption) {
        const cap = d.createElement('p');
        cap.className = 'shot__cap';
        cap.textContent = p.caption;
        fig.append(cap);
      }
      frag.append(fig);
    });

    const end = d.createElement('div');
    end.className = 'shot shot--end';
    end.setAttribute('role', 'listitem');
    end.innerHTML =
      `<button type="button" class="endcard" data-open-all>` +
      `<span class="endcard__big">All<br>photos</span>` +
      `<span class="endcard__small"><span>${n} shots</span>${icon(ARROW)}</span></button>`;
    frag.append(end);
    track.append(frag);
  }

  function eagerReel() {
    $$('.shot__img').forEach((img) => { img.loading = 'eager'; });
  }

  // native (swipe) reel: phones, tablets, reduced motion
  function setupNativeReel() {
    const track = $('.reel__track');
    const bar = $('.reel__progress i');
    if (!track || !photos.length) return () => {};
    const onScroll = () => {
      const max = track.scrollWidth - track.clientWidth;
      if (bar) bar.style.transform = `scaleX(${max > 0 ? track.scrollLeft / max : 0})`;
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((e) => e.target.classList.toggle('is-active', e.intersectionRatio >= 0.6));
      }, { root: track, threshold: [0, 0.6, 1] });
      $$('.shot:not(.shot--end)', track).forEach((s) => io.observe(s));
    }
    return () => {
      track.removeEventListener('scroll', onScroll);
      if (io) io.disconnect();
      $$('.shot', track).forEach((s) => s.classList.remove('is-active'));
    };
  }

  // desktop: vertical scroll moves the reel sideways
  function setupPinnedReel() {
    const section = $('#gallery');
    const stage = $('.gallery__stage');
    const track = $('.reel__track');
    const bar = $('.reel__progress i');
    if (!photos.length) return () => {};
    section.classList.add('is-pinned');
    const distance = () => Math.max(0, track.scrollWidth - track.parentElement.clientWidth);
    const tween = gsap.to(track, { x: () => -distance(), ease: 'none' });
    ST.create({
      animation: tween,
      trigger: stage,
      start: 'top top',
      end: () => `+=${distance()}`,
      pin: true,
      scrub: 0.8,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => { if (bar) bar.style.transform = `scaleX(${self.progress})`; },
    });
    $$('.shot', track).forEach((shot) => {
      const img = $('.shot__img', shot);
      if (img) {
        gsap.fromTo(img, { xPercent: -7 }, {
          xPercent: 7,
          ease: 'none',
          scrollTrigger: { trigger: shot, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true },
        });
      }
      if (!shot.classList.contains('shot--end')) {
        ST.create({ trigger: shot, containerAnimation: tween, start: 'left 72%', end: 'right 28%', toggleClass: 'is-active' });
      }
    });
    return () => {
      section.classList.remove('is-pinned');
      gsap.set(track, { clearProps: 'x' });
      $$('.shot__img', track).forEach((img) => gsap.set(img, { clearProps: 'transform' }));
    };
  }

  // ---------------------------------------------------------------- all photos sheet

  let sheetBuilt = false;
  let sheetOpener = null;
  let tileObserver = null;

  function buildSheet() {
    const grid = $('.sheet__grid');
    const sheet = $('#all-photos');
    const n = photos.length;
    if ('IntersectionObserver' in window) {
      tileObserver = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const img = e.target;
          tileObserver.unobserve(img);
          setImg(img, photos[+img.dataset.index], '(min-width: 1100px) 25vw, (min-width: 640px) 33vw, 50vw');
        });
      }, { root: sheet, rootMargin: '800px 0px' });
    }
    photos.forEach((p, i) => {
      const b = d.createElement('button');
      b.type = 'button';
      b.className = 'tile';
      b.dataset.index = String(i);
      b.style.setProperty('--ar', ratio(p).toFixed(4));
      b.setAttribute('aria-label', `Open photo ${i + 1} of ${n}${p.caption ? `: ${p.caption}` : ''}`);
      if (isLqip(p.lqip)) b.style.backgroundImage = `url("${p.lqip}")`;
      const img = d.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.className = 'is-loading';
      img.dataset.index = String(i);
      img.addEventListener('load', () => img.classList.remove('is-loading'), { once: true });
      b.append(img);
      grid.append(b);
      if (tileObserver) tileObserver.observe(img);
      else setImg(img, p, '50vw');
    });
    sheetBuilt = true;
  }

  function openSheet(opener) {
    if (!photos.length) return;
    const sheet = $('#all-photos');
    if (!sheetBuilt) buildSheet();
    sheetOpener = opener || d.activeElement;
    sheet.hidden = false;
    sheet.scrollTop = 0;
    lock('sheet', true);
    $('.sheet__close', sheet).focus({ preventScroll: true });
    if (ANIM) {
      gsap.fromTo(sheet, { yPercent: 100 }, { yPercent: 0, duration: 0.8, ease: 'expo.out' });
      gsap.fromTo($$('.tile', sheet).slice(0, 12), { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', stagger: 0.04, delay: 0.15 });
    }
  }

  function closeSheet() {
    const sheet = $('#all-photos');
    if (sheet.hidden) return;
    const done = () => {
      sheet.hidden = true;
      lock('sheet', false);
      if (sheetOpener) sheetOpener.focus({ preventScroll: true });
    };
    if (ANIM) gsap.to(sheet, { yPercent: 100, duration: 0.55, ease: 'power3.in', onComplete: done });
    else done();
  }

  // ---------------------------------------------------------------- lightbox

  const lb = { el: null, img: null, index: 0, opener: null };

  function lbShow(i, dir) {
    const n = photos.length;
    lb.index = (i + n) % n;
    const p = photos[lb.index];
    const img = lb.img;
    const idx = lb.index;
    img.classList.add('is-loading');
    img.onload = () => {
      if (lb.index !== idx) return;
      img.classList.remove('is-loading');
      if (ANIM && dir) gsap.fromTo(img, { x: dir * 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out' });
    };
    img.removeAttribute('srcset');
    if (p.thumb && p.tw > 0 && p.w > 0 && p.thumb !== p.src) {
      img.sizes = '100vw';
      img.srcset = `${p.thumb} ${p.tw}w, ${p.src} ${p.w}w`;
    }
    img.src = p.src;
    img.alt = altFor(p, idx);
    if (ANIM) gsap.set(img, { x: 0, y: 0, opacity: 1 });
    $('.lb__count', lb.el).textContent = `${pad2(idx + 1)} / ${pad2(n)}`;
    $('.lb__cap', lb.el).textContent = p.caption || '';
    [photos[(idx + 1) % n], photos[(idx - 1 + n) % n]].forEach((q) => { if (q) new Image().src = q.src; });
  }

  function lbOpen(i, opener) {
    if (!photos.length) return;
    lb.opener = opener || d.activeElement;
    lb.el.hidden = false;
    lock('lb', true);
    lbShow(i, 0);
    $('.lb__close', lb.el).focus({ preventScroll: true });
    if (ANIM) gsap.fromTo(lb.el, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power2.out' });
  }

  function lbClose() {
    if (lb.el.hidden) return;
    const done = () => {
      lb.el.hidden = true;
      lb.img.removeAttribute('src');
      lb.img.removeAttribute('srcset');
      lock('lb', false);
      if (lb.opener) lb.opener.focus({ preventScroll: true });
    };
    if (ANIM) gsap.to(lb.el, { opacity: 0, duration: 0.25, onComplete: done });
    else done();
  }

  function setupLightbox() {
    lb.el = $('.lb');
    lb.img = $('.lb__img', lb.el);
    const stage = $('.lb__stage', lb.el);
    $('.lb__close', lb.el).addEventListener('click', lbClose);
    $('.lb__prev', lb.el).addEventListener('click', () => lbShow(lb.index - 1, -1));
    $('.lb__next', lb.el).addEventListener('click', () => lbShow(lb.index + 1, 1));

    let sx = 0; let sy = 0; let active = false; let moved = false;
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      active = true; moved = false; sx = e.clientX; sy = e.clientY;
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - sx; const dy = e.clientY - sy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (moved && ANIM) {
        const down = dy > 0 && Math.abs(dy) > Math.abs(dx);
        gsap.set(lb.img, { x: down ? 0 : dx * 0.7, y: down ? dy * 0.7 : 0, opacity: down ? Math.max(0.3, 1 - dy / 400) : 1 });
      }
    });
    const end = (e) => {
      if (!active) return;
      active = false;
      const dx = e.clientX - sx; const dy = e.clientY - sy;
      if (!moved) {
        if (e.target === stage) lbClose();
        return;
      }
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) lbShow(lb.index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
      else if (dy > 90) lbClose();
      else if (ANIM) gsap.to(lb.img, { x: 0, y: 0, opacity: 1, duration: 0.35, ease: 'power3.out' });
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', (e) => { active = false; if (ANIM) gsap.to(lb.img, { x: 0, y: 0, opacity: 1, duration: 0.3 }); end(e); });
  }

  // ---------------------------------------------------------------- menu, keyboard, clicks

  function setMenu(open) {
    const toggle = $('.nav__toggle');
    const menu = $('#menu');
    toggle.setAttribute('aria-expanded', String(open));
    $('.nav__toggle-text', toggle).textContent = open ? 'Close' : 'Menu';
    menu.hidden = !open;
    lock('menu', open);
    $('.nav').classList.remove('is-hidden');
    if (open && ANIM) {
      gsap.fromTo($$('.menu__links a', menu), { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.7, ease: 'expo.out', stagger: 0.05 });
    }
  }

  function trapFocus(e, container) {
    const items = $$('button, a[href], [tabindex]:not([tabindex="-1"])', container).filter((el) => el.offsetParent !== null || el === d.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function setupGlobalEvents() {
    $('.nav__toggle').addEventListener('click', (e) => setMenu(e.currentTarget.getAttribute('aria-expanded') !== 'true'));
    $('.sheet__close').addEventListener('click', closeSheet);

    d.addEventListener('click', (e) => {
      const shot = e.target.closest('.shot__btn, .tile');
      if (shot) { lbOpen(+shot.dataset.index, shot); return; }

      const all = e.target.closest('[data-open-all]');
      if (all) { openSheet(all); return; }

      const step = e.target.closest('[data-reel]');
      if (step) {
        const track = $('.reel__track');
        track.scrollBy({ left: +step.dataset.reel * track.clientWidth * 0.8, behavior: REDUCE ? 'auto' : 'smooth' });
        return;
      }

      const copy = e.target.closest('[data-copy]');
      if (copy) { copyText(copy); return; }

      const a = e.target.closest('a[href^="#"]');
      if (a) {
        const hash = a.getAttribute('href');
        const target = hash === '#top' ? 0 : $(hash);
        if (target === null) return;
        e.preventDefault();
        if (!$('#menu').hidden) setMenu(false);
        scrollToTarget(target);
        if (target !== 0) {
          target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
        }
      }
    });

    d.addEventListener('keydown', (e) => {
      const lbOpenNow = lb.el && !lb.el.hidden;
      const sheetOpen = !$('#all-photos').hidden;
      const menuOpen = !$('#menu').hidden;
      if (e.key === 'Escape') {
        if (lbOpenNow) lbClose();
        else if (sheetOpen) closeSheet();
        else if (menuOpen) { setMenu(false); $('.nav__toggle').focus(); }
      } else if (lbOpenNow && e.key === 'ArrowRight') {
        lbShow(lb.index + 1, 1);
      } else if (lbOpenNow && e.key === 'ArrowLeft') {
        lbShow(lb.index - 1, -1);
      } else if (e.key === 'Tab') {
        if (lbOpenNow) trapFocus(e, lb.el);
        else if (sheetOpen) trapFocus(e, $('#all-photos'));
      }
    });
  }

  function copyText(btn) {
    const text = btn.dataset.copy;
    const flash = (msg) => {
      const prev = btn.textContent;
      btn.textContent = msg;
      setTimeout(() => { btn.textContent = prev; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => flash('Copied'), () => flash('Press ⌘/Ctrl+C'));
    } else {
      const ta = d.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      d.body.append(ta); ta.select();
      try { d.execCommand('copy'); flash('Copied'); } catch (err) { flash('Copy failed'); }
      ta.remove();
    }
  }

  // nav state + current section (works with or without GSAP)
  function setupNavState() {
    const nav = $('.nav');
    let lastY = window.scrollY;
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY;
      nav.classList.toggle('is-scrolled', y > 40);
      if (!locks.size) {
        if (y > lastY + 4 && y > window.innerHeight * 0.8) nav.classList.add('is-hidden');
        else if (y < lastY - 4 || y < 80) nav.classList.remove('is-hidden');
      }
      lastY = y;
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();

    nav.addEventListener('focusin', () => nav.classList.remove('is-hidden'));

    if ('IntersectionObserver' in window) {
      const links = new Map($$('.nav__links a').map((a) => [a.getAttribute('href').slice(1), a]));
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          links.forEach((a, id) => a.classList.toggle('is-current', id === e.target.id));
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      $$('main > section[id]').forEach((s) => io.observe(s));
    }
  }

  // play loops only while visible (saves battery)
  function setupLoops() {
    const loops = [$('.eq'), $('.book__character')].filter(Boolean);
    if (REDUCE || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.target.classList.toggle('is-playing', e.isIntersecting));
    }, { rootMargin: '80px' });
    loops.forEach((el) => io.observe(el));
  }

  function setupVideo() {
    const video = $('.backdrop video');
    if (!video) return;
    if (REDUCE) { video.removeAttribute('autoplay'); video.pause(); return; }
    if (!ST) return;
    ST.create({
      trigger: '.hero',
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (self) => {
        if (self.isActive) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
        else video.pause();
      },
    });
  }

  // ---------------------------------------------------------------- motion

  const fx = { split: 1, target: 1, ts: 1 };
  let ticker = null;

  function setupLenis() {
    if (!ANIM || !FINE || !window.Lenis) return;
    lenis = new window.Lenis({ lerp: 0.11, smoothWheel: true, wheelMultiplier: 1 });
    lenis.on('scroll', ST.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  function setupCursor() {
    if (!ANIM || !FINE) return;
    root.classList.add('has-cursor');
    const cur = $('.cursor');
    const dot = $('.cursor__dot');
    const ring = $('.cursor__ring');
    gsap.set([dot, ring], { x: -100, y: -100 });
    const dx = gsap.quickTo(dot, 'x', { duration: 0.08 });
    const dy = gsap.quickTo(dot, 'y', { duration: 0.08 });
    const rx = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3' });
    const ry = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3' });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY);
      cur.classList.remove('is-hidden');
    }, { passive: true });
    d.addEventListener('pointerover', (e) => {
      const t = e.target.closest('a, button');
      const view = !!(t && t.matches('.shot__btn, .tile'));
      cur.classList.toggle('is-view', view);
      cur.classList.toggle('is-link', !!t && !view);
    });
    root.addEventListener('mouseleave', () => cur.classList.add('is-hidden'));
  }

  function splitWords(el) {
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    el.setAttribute('aria-label', text);
    el.textContent = '';
    text.split(' ').forEach((word) => {
      const s = d.createElement('span');
      s.className = 'w';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = word;
      el.append(s, ' ');
    });
    return $$('.w', el);
  }

  function fadeUp(targets, start = 'top 88%') {
    const list = targets.filter(Boolean);
    if (!list.length) return;
    gsap.set(list, { opacity: 0, y: 40 });
    const show = (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.08, overwrite: true });
    ST.batch(list, {
      start,
      once: true,
      onEnter: show,
      onLeave: show,
    });
  }

  function setupHeroScroll() {
    gsap.timeline({ scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } })
      .to('.hero__title', { yPercent: -40, ease: 'none' }, 0)
      .to('.hero__inner', { opacity: 0, ease: 'none' }, 0)
      .to('.backdrop__layer[data-key="hero"]', { scale: 1.18, ease: 'none' }, 0);
  }

  function setupBackdrop() {
    const layers = $$('.backdrop__layer');
    const shade = $('.backdrop__shade');
    const set = (key) => {
      layers.forEach((l) => l.classList.toggle('is-active', l.dataset.key === key));
      if (shade) shade.style.setProperty('--shade', key === 'hero' ? '0.85' : '1');
    };
    $$('[data-backdrop]').forEach((sec) => {
      ST.create({
        trigger: sec,
        start: 'top 55%',
        end: 'bottom 45%',
        onToggle: (self) => { if (self.isActive) set(sec.dataset.backdrop); },
      });
    });
  }

  function setupTicker() {
    const track = $('.ticker__track');
    if (!track) return null;
    const tween = gsap.to(track, { xPercent: -50, duration: 32, ease: 'none', repeat: -1 });
    tween.totalTime(tween.duration() * 400);
    return tween;
  }

  function setupVelocityFx(tickerTween) {
    let dir = 1;
    ST.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        const v = Math.abs(self.getVelocity());
        dir = self.direction || dir;
        fx.target = Math.max(fx.target, Math.min(1 + v / 260, 9));
        fx.boost = Math.min(v / 180, 6);
      },
    });
    fx.boost = 0;
    ticker = () => {
      fx.target += (1 - fx.target) * 0.06;
      fx.boost *= 0.92;
      const next = fx.split + (fx.target - fx.split) * 0.25;
      if (Math.abs(next - fx.split) > 0.01) {
        fx.split = next;
        root.style.setProperty('--split', next.toFixed(2));
      }
      if (tickerTween) {
        const ts = dir * (1 + fx.boost);
        fx.ts += (ts - fx.ts) * 0.12;
        tickerTween.timeScale(fx.ts);
      }
    };
    gsap.ticker.add(ticker);
  }

  function setupJourney() {
    const sec = $('#journey');
    fadeUp([$('.label', sec)]);
    const statement = $('[data-words]', sec);
    if (statement) {
      const words = splitWords(statement);
      gsap.fromTo(words, { opacity: 0.14 }, {
        opacity: 1,
        ease: 'none',
        stagger: 0.1,
        scrollTrigger: { trigger: statement, start: 'top 85%', end: 'bottom 40%', scrub: true },
      });
    }
    fadeUp($$('.stat', sec), 'top 92%');
    $$('[data-count]', sec).forEach((el) => {
      const end = +el.dataset.count;
      const o = { v: 0 };
      el.textContent = '0';
      ST.create({
        trigger: el,
        start: 'top 92%',
        once: true,
        onEnter: () => gsap.to(o, {
          v: end,
          duration: 2.2,
          ease: 'power3.out',
          onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString('en-US'); },
        }),
      });
    });
    fadeUp($$('.chapter', sec));
  }

  function setupSound() {
    const sec = $('#sound');
    fadeUp([$('.label', sec)]);
    $$('.row', sec).forEach((row) => {
      const dir = +row.dataset.dir || 1;
      const from = dir > 0 ? -30 : -6;
      const to = dir > 0 ? -6 : -30;
      gsap.fromTo(row, { xPercent: from }, {
        xPercent: to,
        ease: 'none',
        scrollTrigger: { trigger: $('.rows', sec), start: 'top bottom', end: 'bottom top', scrub: 0.6 },
      });
    });
    fadeUp([$('.sound__title', sec), $('.sound__text', sec), $('.eq', sec)]);
  }

  function setupOffer() {
    const sec = $('#offer');
    fadeUp([$('.label', sec), $('.big', sec)]);
    const cards = $$('.card', sec);
    cards.forEach((card, i) => {
      const img = $('.card__media img', card);
      if (img) {
        gsap.fromTo(img, { yPercent: -6, scale: 1.16 }, {
          yPercent: 6,
          scale: 1.16,
          ease: 'none',
          scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: true },
        });
      }
      const next = cards[i + 1];
      if (!next) return;
      gsap.to(card, {
        scale: 0.92,
        '--dim': 0.6,
        ease: 'none',
        scrollTrigger: {
          trigger: next,
          start: 'top bottom',
          end: () => `top ${parseFloat(getComputedStyle(next).top) + 2}px`,
          scrub: true,
          invalidateOnRefresh: true,
        },
      });
    });
  }

  function setupGalleryMotion() {
    const sec = $('#gallery');
    fadeUp([$('.label', sec), $('.big', sec), $('.gallery__sub', sec)], 'top 92%');
    ST.create({ trigger: sec, start: 'top 250%', once: true, onEnter: eagerReel });
    const mm = gsap.matchMedia();
    mm.add('(min-width: 900px)', () => setupPinnedReel());
    mm.add('(max-width: 899.98px)', () => setupNativeReel());
  }

  function setupCredits() {
    const sec = $('#credits');
    fadeUp([$('.label', sec), ...$$('.big', sec), ...$$('.cgroup__country', sec), ...$$('.ccity__name', sec)], 'top 92%');
    const rows = $$('.venues li, .artists li', sec);
    gsap.set(rows.map((li) => li.firstElementChild), { yPercent: 105 });
    const show = (batch) => gsap.to(batch.map((li) => li.firstElementChild), {
      yPercent: 0, duration: 0.9, ease: 'expo.out', stagger: 0.06, overwrite: true,
    });
    ST.batch(rows, { start: 'top 94%', once: true, onEnter: show, onLeave: show });
  }

  function setupBook() {
    const sec = $('#book');
    fadeUp([$('.label', sec), $('.book__title', sec), $('.book__sub', sec), $('.book__mail', sec), ...$$('.book__list li', sec)]);
    const art = $('.book__art', sec);
    gsap.fromTo(art, { yPercent: 18, opacity: 0 }, {
      yPercent: 0,
      opacity: 1,
      ease: 'none',
      scrollTrigger: { trigger: sec, start: 'top 85%', end: 'center center', scrub: true },
    });
  }

  function setupFooter() {
    gsap.fromTo('.footer__mark', { yPercent: 40, opacity: 0.2 }, {
      yPercent: 0,
      opacity: 1,
      ease: 'none',
      scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: true },
    });
  }

  // ---------------------------------------------------------------- loader + intro

  function playLoader() {
    if (!ANIM || !root.classList.contains('has-loader')) {
      root.classList.remove('has-loader');
      return Promise.resolve(false);
    }
    try { sessionStorage.setItem('dd-seen', '1'); } catch (e) { /* private mode */ }
    const mark = $('.loader__mark');
    const count = $('.loader__count');
    const o = { v: 0 };
    return new Promise((resolve) => {
      gsap.to(o, {
        v: 100,
        duration: 1.4,
        ease: 'power2.inOut',
        onUpdate: () => {
          count.textContent = String(Math.round(o.v)).padStart(3, '0');
          mark.style.clipPath = `inset(0 ${100 - o.v}% 0 0)`;
        },
        onComplete: () => resolve(true),
      });
    });
  }

  function reveal(hadLoader) {
    const letters = $$('.hero .wm .l');
    const tl = gsap.timeline({ delay: hadLoader ? 0 : 0.1 });
    if (hadLoader) {
      tl.to('.loader', { yPercent: -100, duration: 1, ease: 'expo.inOut', onComplete: () => root.classList.remove('has-loader') });
    }
    tl.fromTo(letters, { opacity: 0, yPercent: 45, scaleY: 1.4 }, {
      opacity: 1, yPercent: 0, scaleY: 1, transformOrigin: '50% 100%',
      duration: 1.2, ease: 'expo.out', stagger: 0.055,
    }, hadLoader ? 0.45 : 0)
      .fromTo(['.hero__meta', '.hero__bottom'], { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12 }, '<0.35')
      .add(() => { fx.target = 9; }, '<');
  }

  // ---------------------------------------------------------------- boot

  async function boot() {
    const yearEl = $('[data-year]');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    const loaderDone = playLoader();
    const [list] = await Promise.all([loadGallery(), fontsReady()]);
    photos = list;

    renderGallery();
    setupLightbox();
    setupGlobalEvents();
    setupNavState();
    setupLoops();
    setupVideo();

    if (!ANIM) {
      setupNativeReel();
      return;
    }

    try {
      setupLenis();
      setupCursor();
      setupHeroScroll();
      setupBackdrop();
      setupVelocityFx(setupTicker());
      setupJourney();
      setupSound();
      setupOffer();
      setupGalleryMotion();
      setupCredits();
      setupBook();
      setupFooter();
      ST.sort();
      ST.refresh();
    } catch (err) {
      root.classList.add('no-anim');
      if (window.console) console.error(err);
    }

    const hadLoader = await loaderDone;
    reveal(hadLoader);
    window.addEventListener('load', () => ST.refresh(), { once: true });
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
