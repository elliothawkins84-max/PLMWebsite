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

// Product listing videos (products.html): same autoplay/reduced-motion
// handling as the hero video above, just generalized to however many of
// these show up on a page instead of one specific element by id.
const productVideos = [...document.querySelectorAll('.product-row-video')];
if (productVideos.length) {
  if (reduceMotion) {
    productVideos.forEach((video) => {
      video.removeAttribute('autoplay');
      video.pause();
    });
  } else {
    const tryPlayAll = () => productVideos.forEach((video) => video.play().catch(() => {}));
    productVideos.forEach((video) => {
      video.muted = true;
      video.setAttribute('muted', '');
      const tryPlay = () => video.play().catch(() => {});
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => { if (entry.isIntersecting) tryPlay(); });
      }, { threshold: 0.2 });
      io.observe(video);
      video.addEventListener('loadeddata', tryPlay);
      video.addEventListener('canplay', tryPlay);
    });
    window.addEventListener('touchstart', tryPlayAll, { passive: true });
    window.addEventListener('scroll', tryPlayAll, { passive: true });
    window.addEventListener('click', tryPlayAll);
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
// scrollbar. The tick nearest the current scroll position gets .active,
// with immediate neighbors tapering shorter via .near-1/.near-2 — a
// static peak shape (fixed width per distance, same color throughout),
// not an animated glow. It just slides between ticks as you scroll, with
// no brightness variation over time.
const rulerEl = document.querySelector('.scroll-ruler');
if (rulerEl) {
  const TICK_COUNT = 40;
  const NEAR_CLASSES = ['active', 'near-1', 'near-2']; // index = distance from center
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
    const index = Math.round(frac * (TICK_COUNT - 1));
    const radius = NEAR_CLASSES.length - 1;
    const lo = Math.max(0, index - radius);
    const hi = Math.min(TICK_COUNT - 1, index + radius);

    for (let i = litFrom; i <= litTo; i++) {
      if (i < lo || i > hi) ticks[i].classList.remove(...NEAR_CLASSES);
    }
    for (let i = lo; i <= hi; i++) {
      ticks[i].classList.remove(...NEAR_CLASSES);
      ticks[i].classList.add(NEAR_CLASSES[Math.abs(i - index)]);
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
  // Scoped to [data-target] so a plain nav-link chip (e.g. the "Laser
  // Engraving" services link) never gets wired into the material/wavelength
  // selection logic below -- it's a real link, not an explorer filter.
  const chips = Array.from(document.querySelectorAll('.chip[data-target]'));
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
    // Only hint the browser to promote .mat-inner to its own compositor
    // layer while this clip-path animation is actually running — see the
    // CSS comment above for why leaving it on permanently is a problem.
    inner.style.willChange = 'clip-path';
    inner.classList.add('heating');
    const start = performance.now();

    const stopHeating = () => {
      inner.style.willChange = '';
      inner.classList.remove('heating');
      card.style.setProperty('--heat', '0');
    };

    const tick = () => {
      if (token !== engraveToken) {
        if (bar) { bar.style.transition = ''; bar.style.opacity = '0'; }
        stopHeating();
        return;
      }
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / DURATION);
      const p = easeInOutCubic(t);
      // Reaches 0 exactly as the sweep finishes (p -> 1), so the glow fades
      // out smoothly instead of jumping back up for a separate fade-out phase.
      const heat = Math.pow(1 - p, 0.20);
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
        stopHeating();
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

// Quote form — submits to our own Cloudflare Worker, which relays the
// request to Resend as an email (with attachment) to info@precisionlasermark.com.
const RFQ_ENDPOINT = 'https://plm-rfq.precisionlasermark.workers.dev';
const rfqForm = document.getElementById('rfq-form');
if (rfqForm) {
  const status = document.getElementById('form-status');
  const submitBtn = rfqForm.querySelector('button[type="submit"]');
  const submitLabel = submitBtn.innerHTML;

  rfqForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    status.className = 'form-status';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    try {
      const res = await fetch(RFQ_ENDPOINT, {
        method: 'POST',
        body: new FormData(rfqForm),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        rfqForm.reset();
        const fileField = rfqForm.querySelector('.file-field');
        if (fileField) {
          fileField.classList.remove('has-file');
          const nameEl = fileField.querySelector('.file-name');
          if (nameEl) nameEl.textContent = nameEl.dataset.empty;
        }
        status.textContent = "Request sent — we'll be in touch shortly.";
        status.className = 'form-status success';
      } else {
        status.textContent = data.message || 'Something went wrong — please try again.';
        status.className = 'form-status error';
      }
    } catch (err) {
      status.textContent = 'Network error — please try again.';
      status.className = 'form-status error';
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitLabel;
    }
  });
}

// Footer year + "last updated" timestamp
const now = new Date();
const yearEl = document.getElementById('year');
const updatedEl = document.getElementById('updated');
if (yearEl) yearEl.textContent = now.getFullYear();
if (updatedEl) {
  updatedEl.textContent = now
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .toUpperCase();
}

// FAQ accordion: animates open/close instead of the instant show/hide native
// <details> gives you. We intercept the summary click, drive the height via
// inline styles (transitioning from/to a measured pixel value, since CSS
// can't transition to/from "auto"), and only then flip the `open` attribute
// -- so the +/- indicator (styled off `[open]` in CSS) still stays in sync.
document.querySelectorAll('.faq-item').forEach((item) => {
  const summary = item.querySelector('summary');
  const answer = item.querySelector('.faq-answer');
  if (!summary || !answer) return;

  answer.style.height = item.hasAttribute('open') ? 'auto' : '0px';

  summary.addEventListener('click', (e) => {
    e.preventDefault();
    if (reduceMotion) {
      item.toggleAttribute('open');
      answer.style.height = item.hasAttribute('open') ? 'auto' : '0px';
      return;
    }

    const closing = item.hasAttribute('open');
    if (closing) {
      answer.style.height = `${answer.scrollHeight}px`;
      requestAnimationFrame(() => {
        answer.style.height = '0px';
      });
      answer.addEventListener('transitionend', function onEnd(ev) {
        if (ev.propertyName !== 'height') return;
        item.removeAttribute('open');
        answer.removeEventListener('transitionend', onEnd);
      });
    } else {
      item.setAttribute('open', '');
      answer.style.height = '0px';
      requestAnimationFrame(() => {
        answer.style.height = `${answer.scrollHeight}px`;
      });
      answer.addEventListener('transitionend', function onEnd(ev) {
        if (ev.propertyName !== 'height') return;
        answer.style.height = 'auto';
        answer.removeEventListener('transitionend', onEnd);
      });
    }
  });
});

// API RP Tags configurator: line-count chips drive how many text fields show,
// and typing live-updates a text overlay positioned on the tag photo.
const tagLineChips = document.getElementById('tagLineChips');
if (tagLineChips) {
  const overlay = document.getElementById('tagOverlay');
  const photoWrap = document.querySelector('.tag-photo-wrap');
  const boundsBox = document.getElementById('tagBoundsBox');
  const inputRows = [...document.querySelectorAll('.tag-input-row')];
  const chips = [...tagLineChips.querySelectorAll('.chip')];
  const placeholders = ['ONE', 'TWO', 'THREE'];

  const fontChipsWrap = document.getElementById('tagFontChips');
  const fontChips = fontChipsWrap ? [...fontChipsWrap.querySelectorAll('.chip')] : [];
  const activeFontChip = () => fontChips.find((c) => c.classList.contains('is-on')) || fontChips[1];
  let appliedPt = 0; // the actual point size last rendered, after fitting to the boundary
  const TAG_DIAMETER_PT = 2 * 72; // the tag is a fixed 2in diameter, in points
  const SAFE_MARGIN_MM = 3; // text must stay this far in from the tag's edge
  const MIN_PT = 4; // never shrink a line into illegibility

  const colorChipsWrap = document.getElementById('tagColorChips');
  const colorChips = colorChipsWrap ? [...colorChipsWrap.querySelectorAll('.chip')] : [];
  const tagBody = document.getElementById('tagBody');
  const tagHoleRing = document.getElementById('tagHoleRing');
  const activeColorChip = () => colorChips.find((c) => c.classList.contains('is-on')) || colorChips[0];
  const setTagColor = (color) => {
    colorChips.forEach((c) => c.classList.toggle('is-on', c.dataset.color === color));
    const chip = activeColorChip();
    if (!chip || !tagBody) return;
    tagBody.setAttribute('fill', `url(#tagFill${color.charAt(0).toUpperCase()}${color.slice(1)})`);
    tagBody.setAttribute('stroke', chip.dataset.stroke);
    if (tagHoleRing) tagHoleRing.setAttribute('stroke', chip.dataset.stroke);
  };

  const activeChip = () => chips.find((c) => c.classList.contains('is-on'));

  // Converts a point size to on-screen pixels, scaled to however large the
  // 2in tag is actually being rendered right now (it's a responsive grid).
  const ptToPx = (pt) => {
    const wrapWidth = photoWrap.getBoundingClientRect().width || 420;
    return (pt / TAG_DIAMETER_PT) * wrapWidth;
  };

  // The safe area is a circle inset SAFE_MARGIN_MM from the tag's edge. A
  // horizontal line of text can only be as wide as that circle's chord at
  // the line's own vertical offset from the tag's center.
  const safeChordWidth = (dyPx) => {
    const tagRect = photoWrap.getBoundingClientRect();
    const pxPerMm = tagRect.width / (2 * 25.4);
    const safeRadius = tagRect.width / 2 - SAFE_MARGIN_MM * pxPerMm;
    const inside = safeRadius * safeRadius - dyPx * dyPx;
    return inside > 0 ? 2 * Math.sqrt(inside) : 0;
  };

  // The region text is allowed to occupy at all: from the keyring hole's
  // bottom edge (SVG circle cy=21.654 r=5.906 in its 0-200 viewBox — sized
  // so the full viewBox width represents the tag's actual 2in diameter
  // exactly, same as ptToPx/safeChordWidth below — a real 3mm-diameter
  // hole positioned so its own top sits exactly 4mm below the tag's top
  // edge; bottom edge at y=27.560, i.e. 13.780% down) to near the tag's
  // own bottom edge — matches .tag-text-overlay's own top/bottom in
  // styles.css exactly. Each size tier gets this SAME region scaled down
  // by its own fill fraction, in BOTH width and height, centered on the
  // same point — so the four tiers are just four nested nested boxes,
  // entirely independent of whatever text is actually typed.
  const REGION_TOP_FRAC = 0.13780;
  const REGION_BOTTOM_FRAC = 0.90;
  const DEFAULT_GAP_FACTOR = 0.35;

  // The fixed region's geometry in on-screen pixels, recomputed fresh
  // each call since the tag can resize (responsive layout).
  const regionGeometry = () => {
    const tagRect = photoWrap.getBoundingClientRect();
    const top = tagRect.top + REGION_TOP_FRAC * tagRect.height;
    const bottom = tagRect.top + REGION_BOTTOM_FRAC * tagRect.height;
    const centerY = (top + bottom) / 2;
    const tagCenterY = tagRect.top + tagRect.height / 2;
    return { tagRect, top, bottom, centerY, height: bottom - top, dyFromTagCenter: centerY - tagCenterY };
  };

  // Applies a single uniform point size to every line, and a line gap
  // that's some fraction of that size (tightened independently of font
  // size when the block needs to shrink vertically — see fitUniformPt).
  const applyUniformPt = (pt, gapFactor = DEFAULT_GAP_FACTOR) => {
    const px = ptToPx(pt);
    overlay.style.gap = `${px * gapFactor}px`;
    overlay.querySelectorAll('span').forEach((span) => {
      span.style.fontSize = `${px}px`;
    });
  };

  // A generous upper-bound guess: the point size that would make the
  // widest line exactly fill the region's full width at its vertical
  // center. fitUniformPt below always searches down from this same
  // reference regardless of tier — the tier itself is what actually
  // constrains the result (see allLinesFit) — so a bigger tier can never
  // request less room than a smaller one already found workable.
  const REFERENCE_PT = 20;
  const estimateRequestedPt = () => {
    const spans = [...overlay.querySelectorAll('span')];
    if (!spans.length) return MIN_PT;
    const refPx = ptToPx(REFERENCE_PT);
    spans.forEach((span) => { span.style.fontSize = `${refPx}px`; });
    const widestPx = Math.max(...spans.map((span) => span.getBoundingClientRect().width));
    if (widestPx <= 0) return MIN_PT;
    const targetPx = safeChordWidth(regionGeometry().dyFromTagCenter);
    return REFERENCE_PT * (targetPx / widestPx);
  };

  // True only if every line's rendered width is within fillFraction of
  // the safe-area chord at its own current vertical position — i.e. within
  // that tier's own share of the boundary, not the full boundary.
  const allLinesFitWidth = (fillFraction) => {
    const tagRect = photoWrap.getBoundingClientRect();
    const tagCenterY = tagRect.top + tagRect.height / 2;
    return [...overlay.querySelectorAll('span')].every((span) => {
      const spanRect = span.getBoundingClientRect();
      const dy = spanRect.top + spanRect.height / 2 - tagCenterY;
      return spanRect.width <= fillFraction * safeChordWidth(dy) + 0.5;
    });
  };

  // True only if the whole text block's height fits within fillFraction of
  // the region's own height — this is what actually keeps text clear of
  // the hole (the region itself starts right at the hole's bottom edge),
  // scaled down per tier just like width is.
  const blockFitsHeight = (fillFraction) => {
    const spans = [...overlay.querySelectorAll('span')];
    if (!spans.length) return true;
    const rects = spans.map((span) => span.getBoundingClientRect());
    const blockHeight = Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top));
    return blockHeight <= fillFraction * regionGeometry().height + 0.5;
  };

  const allLinesFit = (fillFraction) => allLinesFitWidth(fillFraction) && blockFitsHeight(fillFraction);

  // True if SOME gap between 0 and the default (comfortable) spacing lets
  // this point size fit within the given tier's own box — tried at full
  // spacing first, since that's what applyBestGapForPt will actually
  // render if this returns true. This is the single source of truth for
  // whether a size "works", so the search below and the final render can
  // never disagree with each other.
  const fitsAtPt = (pt, fillFraction) => {
    applyUniformPt(pt, DEFAULT_GAP_FACTOR);
    if (allLinesFit(fillFraction)) return true;
    if (!allLinesFitWidth(fillFraction)) return false; // tightening the gap can't fix a width overflow
    applyUniformPt(pt, 0);
    return allLinesFit(fillFraction);
  };

  // Renders the given point size at the loosest gap that still fits —
  // full comfortable spacing if that already works, tightened only as
  // far as actually needed to fit the tier's own box.
  const applyBestGapForPt = (pt, fillFraction) => {
    applyUniformPt(pt, DEFAULT_GAP_FACTOR);
    if (allLinesFit(fillFraction)) return;
    let gLo = 0;
    let gHi = DEFAULT_GAP_FACTOR;
    applyUniformPt(pt, gLo);
    if (!allLinesFit(fillFraction)) return; // fitsAtPt(pt, fillFraction) was false; caller shouldn't reach here
    for (let i = 0; i < 12; i++) {
      const mid = (gLo + gHi) / 2;
      applyUniformPt(pt, mid);
      if (allLinesFit(fillFraction)) gLo = mid; else gHi = mid;
    }
    applyUniformPt(pt, gLo);
  };

  // Finds the largest point size (up to the requested one) that fits
  // within the given tier's own box, via binary search on fitsAtPt —
  // which folds gap-tightening into the fit test itself, so the search is
  // monotonic in pt (a bigger request can never end up smaller than a
  // smaller one already known to fit) and still prefers shrinking the gap
  // over shrinking the customer's chosen text size. Searching directly for
  // the fixed point — rather than iteratively nudging the requested size
  // down — means the result only depends on the text and geometry, never
  // on how far the requested size overshot the boundary.
  const fitUniformPt = (requestedPt, fillFraction) => {
    if (fitsAtPt(requestedPt, fillFraction)) {
      applyBestGapForPt(requestedPt, fillFraction);
      return requestedPt;
    }

    if (!fitsAtPt(MIN_PT, fillFraction)) {
      applyBestGapForPt(MIN_PT, fillFraction);
      return MIN_PT;
    }

    let lo = MIN_PT;
    let hi = requestedPt;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (fitsAtPt(mid, fillFraction)) lo = mid; else hi = mid;
    }
    applyBestGapForPt(lo, fillFraction);
    return lo;
  };

  const renderOverlay = () => {
    const count = Number(activeChip().dataset.lines);
    const fillFraction = Number(activeFontChip().dataset.fillPct) / 100;
    overlay.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const value = inputRows[i].querySelector('input').value.trim();
      const span = document.createElement('span');
      span.textContent = value || placeholders[i];
      span.classList.toggle('is-placeholder', !value);
      overlay.appendChild(span);
    }

    const requestedPt = estimateRequestedPt();
    appliedPt = fitUniformPt(requestedPt, fillFraction);
    updateBoundsBox(fillFraction);
  };

  // Draws the purple dashed box for the CURRENTLY SELECTED tier — purely
  // geometric (the region scaled by fillFraction in both width and
  // height, centered on the same point every tier shares), so it never
  // moves or resizes as the customer types; only picking a different tier
  // changes it. The text itself grows to fill this box and shrinks back
  // inside it once it would otherwise cross the edge.
  const updateBoundsBox = (fillFraction) => {
    if (!boundsBox) return;
    const g = regionGeometry();
    const fullWidth = safeChordWidth(g.dyFromTagCenter);
    const boxWidth = fillFraction * fullWidth;
    const boxHeight = fillFraction * g.height;
    const tagCenterX = g.tagRect.left + g.tagRect.width / 2;

    boundsBox.hidden = false;
    boundsBox.style.left = `${tagCenterX - boxWidth / 2 - g.tagRect.left}px`;
    boundsBox.style.top = `${g.centerY - boxHeight / 2 - g.tagRect.top}px`;
    boundsBox.style.width = `${boxWidth}px`;
    boundsBox.style.height = `${boxHeight}px`;
  };

  const setLineCount = (count) => {
    chips.forEach((c) => c.classList.toggle('is-on', Number(c.dataset.lines) === count));
    inputRows.forEach((row, i) => { row.classList.toggle('is-hidden', i >= count); });
    renderOverlay();
    updateQuoteLink();
  };

  const setFontSize = (chip) => {
    fontChips.forEach((c) => c.classList.toggle('is-on', c === chip));
    renderOverlay();
    updateQuoteLink();
  };

  const quoteBtn = document.getElementById('tagQuoteBtn');
  const layoutNames = { 1: 'Single Line', 2: 'Double Line', 3: 'Triple Line' };
  const updateQuoteLink = () => {
    if (!quoteBtn) return;
    const count = Number(activeChip().dataset.lines);
    const lines = inputRows
      .slice(0, count)
      .map((row, i) => `Line ${i + 1}: ${row.querySelector('input').value.trim() || '(blank)'}`)
      .join('\n');
    const colorName = activeColorChip() ? activeColorChip().dataset.color : 'blue';
    const sizeName = activeFontChip().textContent.trim();
    const body = `API RP Tag quote request\n\nTag size: 2in diameter\nColor: ${colorName.charAt(0).toUpperCase()}${colorName.slice(1)}\nLayout: ${layoutNames[count]}\nText size: ${sizeName} (~${Math.round(appliedPt)}pt)\n${lines}\n\nQuantity needed:`;
    quoteBtn.href = `mailto:info@precisionlasermark.com?subject=${encodeURIComponent('API RP Tag Quote Request')}&body=${encodeURIComponent(body)}`;
  };

  chips.forEach((c) => c.addEventListener('click', () => setLineCount(Number(c.dataset.lines))));
  inputRows.forEach((row) => {
    row.querySelector('input').addEventListener('input', () => {
      renderOverlay();
      updateQuoteLink();
    });
  });

  fontChips.forEach((c) => c.addEventListener('click', () => setFontSize(c)));

  colorChips.forEach((c) => c.addEventListener('click', () => {
    setTagColor(c.dataset.color);
    updateQuoteLink();
  }));

  window.addEventListener('resize', renderOverlay);

  setTagColor('blue');
  setLineCount(1);
}

// API RP Tags order table: a list of tag line-items the customer builds up
// before submitting the whole order at once. Defaults to 2 rows.
const tagOrderBody = document.getElementById('tagOrderBody');
if (tagOrderBody) {
  const addRowBtn = document.getElementById('tagOrderAddRow');
  const lineLabelsByType = {
    1: ['Text'],
    2: ['Top', 'Bottom'],
    3: ['Top', 'Middle', 'Bottom'],
  };
  const rowAccentByColor = { blue: '#2479de', red: '#d32f2f', green: '#2e8b47' };
  const setRowAccent = (row, color) => {
    const hex = rowAccentByColor[color] || rowAccentByColor.blue;
    row.querySelectorAll('select, .tag-order-text-row input').forEach((el) => {
      el.style.borderColor = hex;
    });
  };

  const renumberRows = () => {
    [...tagOrderBody.querySelectorAll('.tag-order-row')].forEach((row, i) => {
      row.querySelector('.tag-order-num').textContent = i + 1;
    });
  };

  const updateRowTextFields = (row) => {
    const lineType = Number(row.querySelector('.tag-order-linetype-select').value);
    const textRows = [...row.querySelectorAll('.tag-order-text-row')];
    textRows.forEach((textRow, i) => {
      textRow.classList.toggle('is-hidden', i >= lineType);
    });
    // Forces the browser to flush layout immediately, so the row's border
    // repaints at its new (shorter) height instead of leaving a stale line
    // behind from the taller pre-toggle layout.
    void row.offsetHeight;
  };

  const createOrderRow = () => {
    const row = document.createElement('tr');
    row.className = 'tag-order-row';

    const numCell = document.createElement('td');
    numCell.className = 'tag-order-num';
    row.appendChild(numCell);

    const colorCell = document.createElement('td');
    const colorSelect = document.createElement('select');
    colorSelect.className = 'tag-order-color-select';
    [['blue', 'Blue'], ['red', 'Red'], ['green', 'Green']].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      colorSelect.appendChild(opt);
    });
    colorSelect.addEventListener('change', () => setRowAccent(row, colorSelect.value));
    colorCell.appendChild(colorSelect);
    row.appendChild(colorCell);

    const sizeCell = document.createElement('td');
    const sizeSelect = document.createElement('select');
    sizeSelect.className = 'tag-order-size-select';
    [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['x-large', 'X-Large']].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === 'medium') opt.selected = true;
      sizeSelect.appendChild(opt);
    });
    sizeCell.appendChild(sizeSelect);
    row.appendChild(sizeCell);

    const lineTypeCell = document.createElement('td');
    const lineTypeSelect = document.createElement('select');
    lineTypeSelect.className = 'tag-order-linetype-select';
    [['1', 'Single Line'], ['2', 'Double Line'], ['3', 'Triple Line']].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      lineTypeSelect.appendChild(opt);
    });
    lineTypeCell.appendChild(lineTypeSelect);
    row.appendChild(lineTypeCell);

    const textCell = document.createElement('td');
    textCell.className = 'tag-order-text-cell';
    // The flex layout lives on this inner wrapper, not the <td> itself —
    // display:flex directly on a table cell breaks its normal row-stretch
    // sizing, which desyncs its border from the rest of the row.
    const textStack = document.createElement('div');
    textStack.className = 'tag-order-text-stack';
    ['Text', 'Middle', 'Bottom'].forEach((_, i) => {
      const textRow = document.createElement('div');
      textRow.className = 'tag-order-text-row';
      if (i > 0) textRow.classList.add('is-hidden');
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 18;
      input.dataset.line = i;
      input.placeholder = lineLabelsByType[3][i];
      textRow.appendChild(input);
      textStack.appendChild(textRow);
    });
    textCell.appendChild(textStack);
    row.appendChild(textCell);

    const actionsCell = document.createElement('td');
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'tag-order-actions';

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'tag-order-view';
    viewBtn.setAttribute('aria-label', 'View this tag in the builder above');
    viewBtn.textContent = 'View';
    actionsWrap.appendChild(viewBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'tag-order-remove';
    removeBtn.setAttribute('aria-label', 'Remove this tag');
    removeBtn.textContent = '✕';
    actionsWrap.appendChild(removeBtn);

    actionsCell.appendChild(actionsWrap);
    row.appendChild(actionsCell);

    // Relabel Top/Middle/Bottom (or just "Text" for a single line) to match
    // whichever line type is currently selected for this row.
    const relabelTextRows = () => {
      const lineType = Number(lineTypeSelect.value);
      const labels = lineLabelsByType[lineType];
      [...textCell.querySelectorAll('.tag-order-text-row input')].forEach((input, i) => {
        if (labels[i]) input.placeholder = labels[i];
      });
    };

    lineTypeSelect.addEventListener('change', () => {
      updateRowTextFields(row);
      relabelTextRows();
    });
    removeBtn.addEventListener('click', () => {
      if (tagOrderBody.querySelectorAll('.tag-order-row').length <= 1) return;
      row.remove();
      renumberRows();
    });
    viewBtn.addEventListener('click', () => {
      // Drives the sample configurator above through its own real chip
      // clicks and input events — same as a customer using it by hand —
      // rather than reaching into that section's own script block, so it
      // stays a normal DOM consumer just like "Add to Order List" is in
      // reverse.
      document.querySelector(`.tag-color-chips .chip[data-color="${colorSelect.value}"]`)?.click();
      document.querySelector(`#tagLineChips .chip[data-lines="${lineTypeSelect.value}"]`)?.click();
      [...document.querySelectorAll('#tagFontChips .chip')]
        .find((c) => c.textContent.trim().toLowerCase().replace(/\s+/g, '-') === sizeSelect.value)
        ?.click();

      const lineCount = Number(lineTypeSelect.value);
      const rowLines = [...row.querySelectorAll('.tag-order-text-row input')].map((i) => i.value);
      [...document.querySelectorAll('.tag-input-row input')].forEach((input, i) => {
        input.value = i < lineCount ? (rowLines[i] || '') : '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const scrollTarget = document.querySelector('.tag-configurator');
      if (scrollTarget) {
        // A plain scrollIntoView(start) either lands flush with the
        // configurator (no context above it) or flush with the whole hero
        // section (the full title, more than needed) — this splits the
        // difference, leaving just the tail end of the lead paragraph
        // visible above it.
        const targetY = scrollTarget.getBoundingClientRect().top + window.scrollY - 160;
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      }
    });

    updateRowTextFields(row);
    relabelTextRows();
    setRowAccent(row, colorSelect.value);
    return row;
  };

  // Fills an existing row's fields (color/size/line type/text) in place —
  // shared by a freshly created row and by overriding an already-blank
  // row (see the "Add to Order List" handler below).
  const applyRowValues = (row, initial) => {
    const colorSelect = row.querySelector('.tag-order-color-select');
    const sizeSelect = row.querySelector('.tag-order-size-select');
    const lineTypeSelect = row.querySelector('.tag-order-linetype-select');
    colorSelect.value = initial.color;
    colorSelect.dispatchEvent(new Event('change', { bubbles: true }));
    sizeSelect.value = initial.sizeTier;
    lineTypeSelect.value = String(initial.lineType);
    lineTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const inputs = [...row.querySelectorAll('.tag-order-text-row input')];
    inputs.forEach((input, i) => { input.value = (initial.lines && initial.lines[i]) || ''; });
  };

  // True if every text line in this row is blank — an "empty" row that a
  // new tag from the sample configurator can safely take over instead of
  // adding a whole new one.
  const rowHasNoText = (row) => [...row.querySelectorAll('.tag-order-text-row input')].every((input) => !input.value.trim());

  // `initial`, when given, pre-fills the new row (color/size/line type/
  // text) instead of leaving it at the row's own defaults — used by the
  // "Add to Order List" button on the sample tag configurator above.
  const addOrderRow = (initial) => {
    const row = createOrderRow();
    if (initial) applyRowValues(row, initial);
    tagOrderBody.appendChild(row);
    renumberRows();
    return row;
  };

  if (addRowBtn) addRowBtn.addEventListener('click', () => addOrderRow());

  // "Add to Order List" on the sample tag configurator above — reads
  // whatever's currently configured there (color/size/line count/text)
  // straight off its own DOM, independent of that section's own script
  // block, and drops it in as a new row here.
  const addToOrderListBtn = document.getElementById('addToOrderListBtn');
  if (addToOrderListBtn) {
    const addToOrderListLabel = addToOrderListBtn.textContent;
    let addToOrderListTimer = null;
    addToOrderListBtn.addEventListener('click', () => {
      const color = document.querySelector('.tag-color-chips .chip.is-on')?.dataset.color || 'blue';
      const sizeChip = document.querySelector('#tagFontChips .chip.is-on');
      const sizeTier = sizeChip ? sizeChip.textContent.trim().toLowerCase().replace(/\s+/g, '-') : 'medium';
      const lineType = Number(document.querySelector('#tagLineChips .chip.is-on')?.dataset.lines || 1);
      const lines = [...document.querySelectorAll('.tag-input-row input')]
        .slice(0, lineType)
        .map((input) => input.value.trim());

      // Reuse the first row with no text entered yet, if there is one,
      // rather than always tacking on a new one — keeps the table from
      // filling up with untouched blank rows every time someone clicks.
      const emptyRow = [...tagOrderBody.querySelectorAll('.tag-order-row')].find(rowHasNoText);
      if (emptyRow) {
        applyRowValues(emptyRow, { color, sizeTier, lineType, lines });
      } else {
        addOrderRow({ color, sizeTier, lineType, lines });
      }

      // Swap the button to a confirmation state instead of scrolling the
      // page down to the table — the row is added either way, this just
      // avoids yanking the customer away from what they were doing.
      // Disabled for the same stretch so a second click can't sneak the
      // same tag in twice while it's still showing "Added".
      clearTimeout(addToOrderListTimer);
      addToOrderListBtn.classList.add('is-added');
      addToOrderListBtn.textContent = 'Added ✓';
      addToOrderListBtn.disabled = true;
      addToOrderListTimer = setTimeout(() => {
        addToOrderListBtn.classList.remove('is-added');
        addToOrderListBtn.textContent = addToOrderListLabel;
        addToOrderListBtn.disabled = false;
      }, 1800);
    });
  }

  addOrderRow();
}

// .plmj container encode: "PLMJ" magic + 1 format byte (0=raw, 1=gzip) + a
// JSON body — mirrors encodePlmjFile() in card-editor.js exactly, so
// PLMJobViewer's existing decoder (which only checks the magic bytes and
// payload.kind, not payload.app) opens this without any change on its end.
async function encodePlmjFile(payloadObj) {
  const PLMJ_MAGIC = 'PLMJ';
  const FORMAT_RAW = 0;
  const FORMAT_GZIP = 1;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  let bodyBytes = jsonBytes;
  let format = FORMAT_RAW;
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(jsonBytes);
    writer.close();
    bodyBytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    format = FORMAT_GZIP;
  }
  const header = new TextEncoder().encode(PLMJ_MAGIC);
  const out = new Uint8Array(header.length + 1 + bodyBytes.length);
  out.set(header, 0);
  out[header.length] = format;
  out.set(bodyBytes, header.length + 1);
  return out;
}

// API RP Tags RFQ modal: shows a per-color tally of the order table on the
// left, and the same request-a-quote fields/framework as the business card
// editor's own Next modal on the right (same field names, same
// .contact-form styling, same open/close/Escape/backdrop pattern).
const tagRfqModal = document.getElementById('tag-rfq-modal');
if (tagRfqModal) {
  const openBtn = document.getElementById('tagQuoteBtn');
  const closeBtn = document.getElementById('tag-rfq-modal-close');
  const summaryList = document.getElementById('tagRfqSummaryList');
  const form = document.getElementById('tagRfqForm');
  const statusEl = document.getElementById('tagRfqStatus');
  const successModal = document.getElementById('tag-rfq-success-modal');
  const successCloseBtn = document.getElementById('tag-rfq-success-close-btn');

  const colorLabels = [['blue', 'Blue'], ['red', 'Red'], ['green', 'Green']];

  const renderSummary = () => {
    const orderBody = document.getElementById('tagOrderBody');
    const counts = { blue: 0, red: 0, green: 0 };
    if (orderBody) {
      orderBody.querySelectorAll('.tag-order-row').forEach((row) => {
        const color = row.querySelector('.tag-order-color-select').value;
        if (counts[color] !== undefined) counts[color] += 1;
      });
    }
    summaryList.innerHTML = '';
    colorLabels.forEach(([value, label]) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'tag-rfq-summary-row';

      const swatch = document.createElement('span');
      swatch.className = `tag-color-swatch tag-color-swatch--${value}`;

      const count = document.createElement('span');
      count.className = 'tag-rfq-summary-count';
      count.textContent = counts[value];

      const dash = document.createElement('span');
      dash.className = 'tag-rfq-summary-dash';
      dash.textContent = '-';

      const labelEl = document.createElement('span');
      labelEl.textContent = label;

      rowEl.appendChild(swatch);
      rowEl.appendChild(count);
      rowEl.appendChild(dash);
      rowEl.appendChild(labelEl);
      summaryList.appendChild(rowEl);
    });
  };

  const openModal = () => {
    renderSummary();
    tagRfqModal.classList.add('is-open');
    tagRfqModal.setAttribute('aria-hidden', 'false');
  };
  const closeModal = () => {
    tagRfqModal.classList.remove('is-open');
    tagRfqModal.setAttribute('aria-hidden', 'true');
  };

  const openSuccessModal = () => {
    closeModal();
    if (!successModal) return;
    // Waits out the RFQ modal's own close transition (0.2s) before opening
    // this one, rather than both firing in the same tick.
    setTimeout(() => {
      // Forces the checkmark SVG's draw-on animation to restart by
      // removing/reinserting it (a class toggle alone is a no-op the 2nd
      // time since the animation already ran once).
      const check = successModal.querySelector('.editor-rfq-success-check');
      if (check) {
        const parent = check.parentNode;
        const next = check.nextSibling;
        parent.removeChild(check);
        void check.offsetWidth;
        parent.insertBefore(check, next);
      }
      successModal.classList.add('is-open');
      successModal.setAttribute('aria-hidden', 'false');
    }, 300);
  };
  const closeSuccessModal = () => {
    if (!successModal) return;
    successModal.classList.remove('is-open');
    successModal.setAttribute('aria-hidden', 'true');
  };

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  tagRfqModal.addEventListener('mousedown', (e) => {
    if (e.target === tagRfqModal) closeModal();
  });
  if (successModal) {
    successModal.addEventListener('mousedown', (e) => {
      if (e.target === successModal) closeSuccessModal();
    });
  }
  if (successCloseBtn) successCloseBtn.addEventListener('click', closeSuccessModal);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (tagRfqModal.classList.contains('is-open')) closeModal();
    if (successModal && successModal.classList.contains('is-open')) closeSuccessModal();
  });

  // Reads every row of the order table into a flat, machine-shaped list —
  // only as many lines as the row's own line type calls for, same as what
  // actually renders on the tag (no blank trailing slots).
  const collectOrderItems = () => {
    const orderBody = document.getElementById('tagOrderBody');
    if (!orderBody) return [];
    return [...orderBody.querySelectorAll('.tag-order-row')].map((row) => {
      const color = row.querySelector('.tag-order-color-select').value;
      const sizeTier = row.querySelector('.tag-order-size-select').value;
      const lineType = Number(row.querySelector('.tag-order-linetype-select').value);
      const lines = [...row.querySelectorAll('.tag-order-text-row input')]
        .slice(0, lineType)
        .map((input) => input.value.trim());
      return { color, sizeTier, lineType, lines };
    });
  };

  // Builds the full .plmj payload for a tag order — same container format
  // as the business card editor's own .plmj, but flat order-table data
  // instead of a Fabric.js canvas project, and its own `app` value so
  // PLMJobViewer can tell the two kinds apart and render each correctly.
  const buildTagOrderPayload = () => {
    const formData = new FormData(form);
    return {
      app: 'api-rp-tag-order',
      kind: 'plmj',
      version: 1,
      createdAt: new Date().toISOString(),
      specs: { diameterIn: 2, holeMm: 3, thicknessMm: 0.71, material: 'aluminum' },
      order: {
        name: formData.get('name') || '',
        email: formData.get('email') || '',
        address: formData.get('address') || '',
        city: formData.get('city') || '',
        state: formData.get('state') || '',
        zip: formData.get('zip') || '',
        message: formData.get('message') || '',
      },
      items: collectOrderItems(),
    };
  };

  // Turns the order-table rows into a plain-text summary for the email
  // body, since the Worker only understands name/email/message/attachment
  // — same approach as the business card editor's own RFQ request.
  const summarizeOrderItems = (items) => {
    if (!items.length) return 'No tags added to the order table.';
    return items.map((item, i) => {
      const colorLabel = colorLabels.find(([key]) => key === item.color)?.[1] || item.color;
      const text = item.lines.filter(Boolean).join(' / ') || '(no text)';
      return `${i + 1}. ${colorLabel}, ${item.sizeTier} — ${text}`;
    }).join('\n');
  };

  if (form) {
    const submitBtn = form.querySelector('button[type="submit"]');
    const submitLabel = submitBtn ? submitBtn.innerHTML : '';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (statusEl) { statusEl.textContent = ''; statusEl.className = 'form-status'; }
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

      try {
        const payload = buildTagOrderPayload();
        const formData = new FormData(form);
        const contextLines = [
          `${payload.items.length} tag${payload.items.length === 1 ? '' : 's'} requested:`,
          summarizeOrderItems(payload.items),
          `Shipping address: ${payload.order.address || 'n/a'}, ${payload.order.city || 'n/a'}, ${payload.order.state || 'n/a'} ${payload.order.zip || 'n/a'}`,
        ];
        const userMessage = String(formData.get('message') || '').trim();
        formData.set('message', `${contextLines.join('\n')}${userMessage ? `\n\n${userMessage}` : ''}`);

        const bytes = await encodePlmjFile(payload);
        const base = (payload.order.name || 'api-rp-tag').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'api-rp-tag';
        formData.append('attachment', new Blob([bytes], { type: 'application/octet-stream' }), `${base}-order.plmj`);

        const res = await fetch(RFQ_ENDPOINT, { method: 'POST', body: formData });
        const data = await res.json();

        if (res.ok && data.success) {
          form.reset();
          openSuccessModal();
        } else if (statusEl) {
          statusEl.textContent = data.message || 'Something went wrong — please try again.';
          statusEl.className = 'form-status error';
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = 'Network error — please try again.';
          statusEl.className = 'form-status error';
        }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitLabel; }
      }
    });
  }
}
