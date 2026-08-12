// Mobile nav toggle
const toggle = document.querySelector('.nav-toggle');
const links = document.querySelector('.nav-links');

toggle.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
});

// Close menu after clicking a link (mobile)
links.querySelectorAll('a').forEach((a) => {
  a.addEventListener('click', () => {
    links.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  });
});

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Hero background video: the `autoplay muted loop playsinline` attributes
// on the <video> tag handle normal playback in most browsers. Under
// reduced-motion we stop it from playing at all (the first frame still
// shows as a static image).
const heroVideoFrame = document.getElementById('hero-video-frame');
if (heroVideoFrame) {
  if (reduceMotion) {
    heroVideoFrame.removeAttribute('autoplay');
    heroVideoFrame.pause();
  } else {
    // The `autoplay` attribute alone is unreliable on some mobile
    // browsers (iOS Low Power Mode, data-saver modes, some Android
    // WebViews) — force the property and call play() explicitly.
    //
    // Critically, browsers also refuse to (re)start autoplay for a video
    // that isn't actually visible in the viewport — e.g. if the page
    // loads scrolled straight to a URL hash like #contact, the hero
    // never appears on screen and autoplay never gets a chance to start,
    // even if the visitor later scrolls up to it. An IntersectionObserver
    // makes sure we only (and always) attempt play() once the video is
    // actually on screen, rather than a handful of one-shot attempts
    // clustered around page load.
    heroVideoFrame.muted = true;
    heroVideoFrame.setAttribute('muted', ''); // some WebKit versions only honor the attribute, not just the property
    const tryPlay = () => heroVideoFrame.play().catch(() => {});

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) tryPlay();
      });
    }, { threshold: 0.2 });
    io.observe(heroVideoFrame);

    heroVideoFrame.addEventListener('loadeddata', tryPlay);
    heroVideoFrame.addEventListener('canplay', tryPlay);

    // A real user gesture anywhere on the page is always allowed to
    // start playback, regardless of visibility rules — kept as a
    // permanent (not one-shot) listener, since the first gesture might
    // happen before the video has scrolled into view.
    window.addEventListener('touchstart', tryPlay, { passive: true });
    window.addEventListener('scroll', tryPlay, { passive: true });
    window.addEventListener('click', tryPlay);
  }
}

// Parallax: drift the hero video slower than the page scroll. Skipped on
// touch devices — applying a transform to the video's parent on scroll
// can interrupt/pause autoplay on mobile Safari, and a tiny scroll often
// fires immediately on load there as the address bar collapses.
const isTouchDevice = window.matchMedia('(hover: none), (pointer: coarse)').matches;
const heroVideo = document.querySelector('.hero-video');
if (heroVideo && !reduceMotion && !isTouchDevice) {
  let ticking = false;
  const update = () => {
    const y = window.scrollY;
    if (y <= window.innerHeight) {
      heroVideo.style.transform = `translate3d(0, ${y * 0.4}px, 0)`;
    }
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
}

// Scroll ruler: an evenly-spaced row of ticks stands in for the native
// scrollbar. Every tick's --t "intensity" (0-1) is recomputed each scroll
// frame from a Gaussian falloff centered on the exact (unrounded) scroll
// fraction, so the tick right at that position is longest/brightest and
// its neighbors taper off smoothly — one soft crest sliding down the
// ruler, rather than a single tick popping on/off between fixed steps.
const rulerEl = document.querySelector('.scroll-ruler');
if (rulerEl) {
  const TICK_COUNT = 40;
  const FALLOFF_SIGMA = 1.15; // spread of the crest, in tick-index units
  const FALLOFF_RADIUS = 4; // ticks beyond this distance are left at 0, skipped for cheapness
  const ticks = [];
  for (let i = 0; i < TICK_COUNT; i++) {
    const tick = document.createElement('span');
    tick.className = 'ruler-tick';
    tick.style.top = `${(i / (TICK_COUNT - 1)) * 100}%`;
    rulerEl.appendChild(tick);
    ticks.push(tick);
  }

  let litFrom = 0;
  let litTo = -1; // empty range initially
  let rulerTicking = false;
  const updateRuler = () => {
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - window.innerHeight;
    const frac = scrollable > 0 ? window.scrollY / scrollable : 0;
    const exactIndex = frac * (TICK_COUNT - 1);
    const lo = Math.max(0, Math.floor(exactIndex - FALLOFF_RADIUS));
    const hi = Math.min(TICK_COUNT - 1, Math.ceil(exactIndex + FALLOFF_RADIUS));

    // Clear ticks that were lit last frame but fall outside this frame's
    // range (cheaper than resetting all 40 every frame).
    for (let i = litFrom; i <= litTo; i++) {
      if (i < lo || i > hi) ticks[i].style.setProperty('--t', '0');
    }
    for (let i = lo; i <= hi; i++) {
      const d = i - exactIndex;
      const t = Math.exp(-(d * d) / (2 * FALLOFF_SIGMA * FALLOFF_SIGMA));
      ticks[i].style.setProperty('--t', t.toFixed(3));
    }
    litFrom = lo;
    litTo = hi;
    rulerTicking = false;
  };
  updateRuler();
  window.addEventListener('scroll', () => {
    if (!rulerTicking) { requestAnimationFrame(updateRuler); rulerTicking = true; }
  }, { passive: true });
}

// Specialties: material / wavelength explorer with laser-engrave reveal
const stage = document.getElementById('stage');
if (stage) {
  const chips = Array.from(document.querySelectorAll('.chip'));
  let engraveToken = 0;

  const prepare = (card) => {
    const inner = card.querySelector('.mat-inner');
    if (inner) inner.style.clipPath = 'inset(0 0 100% 0)'; // hidden until the bar sweeps past
    card.style.setProperty('--heat', '0');
    const bar = card.querySelector('.sweep-bar');
    if (bar) { bar.style.opacity = '0'; bar.style.transform = 'translateY(0px)'; }
  };

  const revealAll = (card) => {
    const inner = card.querySelector('.mat-inner');
    if (inner) inner.style.clipPath = '';
    card.style.setProperty('--heat', '0');
    const bar = card.querySelector('.sweep-bar');
    if (bar) bar.style.opacity = '0';
  };

  // A single bar swipes top-to-bottom over the card; the content (text +
  // icon) is masked and only becomes visible once the bar has passed that
  // point, so it reveals continuously rather than popping in.
  const DURATION = 500; // ms for the full top-to-bottom sweep

  // Cubic ease-in-out: slow start, fast middle, slow finish.
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

  const engrave = (card, token) => {
    const inner = card.querySelector('.mat-inner');
    const bar = card.querySelector('.sweep-bar');
    const H = inner.clientHeight;

    if (bar) {
      // Disable the opacity transition while sweeping so each flicker
      // value snaps instantly instead of blending into a smooth wobble;
      // restored below for a clean fade-out once the sweep finishes.
      bar.style.transition = 'none';
      bar.style.opacity = '1';
    }
    const start = performance.now();

    const tick = () => {
      if (token !== engraveToken) {
        if (bar) { bar.style.transition = ''; bar.style.opacity = '0'; }
        return;
      }
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / DURATION);
      const p = easeInOutCubic(t);
      const heat = Math.max(0.3, Math.pow(1 - p, 0.20));
      card.style.setProperty('--heat', heat.toFixed(3));

      inner.style.clipPath = `inset(0 0 ${((1 - p) * 100).toFixed(1)}% 0)`;
      if (bar) {
        bar.style.transform = `translateY(${(p * H).toFixed(1)}px)`;
        // Keep the beam mostly steady, with a subtle laser-like shimmer
        // instead of a frame-by-frame random flicker.
        const shimmer = 0.98 + Math.sin(elapsed * 0.03) * 0.02 + Math.sin(elapsed * 0.11) * 0.01;
        bar.style.opacity = Math.max(0.92, Math.min(1, shimmer)).toFixed(2);
      }

      if (t >= 1) {
        inner.style.clipPath = '';
        if (bar) { bar.style.transition = ''; bar.style.opacity = '0'; }
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const select = (id, initial) => {
    const card = document.getElementById(id);
    if (!card || card.classList.contains('active')) return;
    chips.forEach((c) => c.classList.toggle('is-on', c.dataset.target === id));

    const current = stage.querySelector('.mat-card.active');
    if (current) {
      current.classList.remove('active', 'tilting');
      const curTilt = current.querySelector('.mat-tilt');
      if (curTilt) { curTilt.style.transform = ''; curTilt.style.boxShadow = ''; }
      current.classList.add('leaving');
      const prev = current;
      setTimeout(() => prev.classList.remove('leaving'), 520);
    }

    card.classList.add('active');
    card.classList.remove('tilting');
    const inTilt = card.querySelector('.mat-tilt');
    if (inTilt) { inTilt.style.transform = ''; inTilt.style.boxShadow = ''; }
    prepare(card);

    if (reduceMotion) { revealAll(card); return; }
    if (initial) return; // first card waits for the section to scroll into view
    const token = ++engraveToken;
    setTimeout(() => engrave(card, token), 260); // let the card slide in first
  };

  chips.forEach((c) => c.addEventListener('click', () => select(c.dataset.target)));

  // Cursor-following 3D tilt on the active card
  if (!reduceMotion) {
    const MAX = 5; // degrees
    let tiltRaf = 0;
    const onMove = (e) => {
      const card = stage.querySelector('.mat-card.active');
      if (!card) return;
      const tilt = card.querySelector('.mat-tilt');
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(tiltRaf);
      tiltRaf = requestAnimationFrame(() => {
        const ry = (px - 0.5) * 2 * MAX;
        const rx = -(py - 0.5) * 2 * MAX;
        tilt.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
        // drop shadow shifts opposite the tilt, so the slab reads as lifted
        const shX = (0.5 - px) * 40;
        const shY = (0.5 - py) * 40 + 22;
        tilt.style.boxShadow = `${shX.toFixed(0)}px ${shY.toFixed(0)}px 48px rgba(0, 0, 0, 0.55)`;
        card.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        card.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
        card.classList.add('tilting');
      });
    };
    const onLeave = () => {
      const card = stage.querySelector('.mat-card.active');
      if (!card) return;
      cancelAnimationFrame(tiltRaf);
      const tilt = card.querySelector('.mat-tilt');
      if (tilt) { tilt.style.transform = ''; tilt.style.boxShadow = ''; }
      card.classList.remove('tilting');
    };
    stage.addEventListener('pointermove', onMove, { passive: true });
    stage.addEventListener('pointerleave', onLeave);
  }

  // Show the first material immediately; engrave it when the section is seen
  select('card-metal', true);
  if (reduceMotion) {
    // already revealed
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          const card = stage.querySelector('.mat-card.active');
          if (card && !card.dataset.engravedOnce) {
            engrave(card, ++engraveToken);
            card.dataset.engravedOnce = '1';
          }
          io.unobserve(stage);
        }
      });
    }, { threshold: 0.4 });
    io.observe(stage);
  }
}

// Quote form — artwork upload (click or drag & drop)
const fileField = document.querySelector('.file-field');
if (fileField) {
  const input = fileField.querySelector('.file-input');
  const nameEl = fileField.querySelector('.file-name');
  const drop = fileField.querySelector('.file-drop');

  const showFiles = () => {
    const files = input.files;
    if (!files || !files.length) {
      fileField.classList.remove('has-file');
      nameEl.textContent = nameEl.dataset.empty;
      return;
    }
    fileField.classList.add('has-file');
    nameEl.textContent = files.length === 1 ? files[0].name : `${files.length} files selected`;
  };

  input.addEventListener('change', showFiles);

  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); fileField.classList.add('dragover'); }));
  ['dragleave', 'dragend'].forEach((ev) =>
    drop.addEventListener(ev, () => fileField.classList.remove('dragover')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    fileField.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files; // assign dropped FileList to the input
      showFiles();
    }
  });
}

// Footer year + "last updated" timestamp
const now = new Date();
document.getElementById('year').textContent = now.getFullYear();
document.getElementById('updated').textContent = now
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  .toUpperCase();
