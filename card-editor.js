// Business card editor — framework-stage script. Draws the ruler tick
// marks around the canvas, handles switching between the front and back
// side thumbnails, and lets the toolbar buttons be selected. No design/
// canvas functionality (what a selected tool actually does) yet.

const PX_PER_MM = 9; // matches the fixed sizing in card-editor.css
const MM_PER_IN = 25.4;
// The display unit for every user-facing measurement field (position,
// size, stroke width, corner radius, the ruler) — purely a display/input
// concern. Internally, everything is still stored and computed in px
// (via PX_PER_MM), same as always; only reading from/writing to the UI
// goes through pxPerUnit() so a field shows/accepts the chosen unit.
// Which card type (color + thickness, see CARD_TYPES / the card-type
// picker in card-editor.js further down, populated from card-types/
// card-types-data.js) is currently selected — declared at the very top
// because pushHistory (called as early as the initial baseline snapshot,
// well before the picker's own section of the script runs) triggers a
// Mockup repaint that reads this on every render. Defaults to Black at
// 0.016" (0.4mm), CARD_TYPES' own first entry, rather than no selection —
// a fresh page load should show a real card, not the "choose one" state.
let selectedCardTypeId = 'black-016';
function getSelectedCardTypeColor() {
  const entry = (window.CARD_TYPES || []).find((t) => t.id === selectedCardTypeId);
  return entry ? entry.swatch : null;
}
let unitSystem = 'mm';
function pxPerUnit() { return unitSystem === 'in' ? PX_PER_MM * MM_PER_IN : PX_PER_MM; }
function unitLabel() { return unitSystem === 'in' ? 'in' : 'mm'; }
function unitDecimals() { return unitSystem === 'in' ? 3 : 2; }

// ---- Pasteboard / artboard geometry ----
// The Fabric canvas is a large "pasteboard" (matching the existing
// .editor-canvas-pan-area size, so panning already has room for it) —
// the 86x54mm card is just a small artboard region within it, centered,
// not the whole canvas. Anything that used to treat "the canvas" as "the
// card" (position readouts, snapping, alignment, import centering) needs
// this offset folded in.
const PASTEBOARD_W = 2400;
const PASTEBOARD_H = 1600;
const CARD_W_PX = 86 * PX_PER_MM; // 774
const CARD_H_PX = 54 * PX_PER_MM; // 486
const CARD_OFFSET_X = (PASTEBOARD_W - CARD_W_PX) / 2;
const CARD_OFFSET_Y = (PASTEBOARD_H - CARD_H_PX) / 2;
// Matches .editor-safe-zone's own `inset: 9px` in card-editor.css — 1mm
// at PX_PER_MM=9 — so the safe-zone-overflow check below lines up with
// the exact same boundary the user actually sees drawn on the card.
const SAFE_ZONE_INSET_PX = 9;

// ---- Live price estimate constants ----
// Calibrated against a real timed run: 6 double-sided cards (a logo side
// plus a fairly full info side, White finish plus a Stroke portrait) took
// ~10 minutes total at a $95/hr shop rate. That reference card's actual
// weighted coverage, measured the same pixel-based way the live estimate
// uses (see weightedCoveragePx2ForSnapshot/updatePriceEstimate further
// down), comes out to ~7.13% — which pins the two cost constants below.
const PRICING_SHOP_RATE_PER_MIN = 95 / 60;
const PRICING_MATERIAL_COST = 0.2;
const PRICING_FIXED_SEC_PER_CARD = 30; // handling/setup, both sides
const PRICING_VARIABLE_SEC_PER_CARD = (10 / 6) * 60 - PRICING_FIXED_SEC_PER_CARD; // 70s
const PRICING_CALIBRATION_WEIGHTED_PCT = 7.13;
const PRICING_FIXED_COST = (PRICING_FIXED_SEC_PER_CARD / 60) * PRICING_SHOP_RATE_PER_MIN + PRICING_MATERIAL_COST;
const PRICING_VARIABLE_COST_PER_PCT = ((PRICING_VARIABLE_SEC_PER_CARD / 60) * PRICING_SHOP_RATE_PER_MIN)
  / PRICING_CALIBRATION_WEIGHTED_PCT;
// Ratio of the 100–149-card tier price to direct cost, from the
// quantity-tier pricing table this was built against.
const PRICING_QTY100_MARKUP = 1.228;
// Quantity-tier markup table (mid-market positioning — see the
// pricing-strategy notes this was built from), reframed as ratio
// anchors at specific quantities rather than flat step tiers — a step
// table gives every quantity inside the same bucket (say, 150 and 200,
// both "150–200") the exact same ratio, and therefore the exact same
// per-card price, which reads as a bug even though it isn't one.
// Interpolating linearly between these anchor points instead means
// every distinct quantity gets a distinct (and still monotonically
// decreasing, i.e. real bulk-discount) price. The anchor ratios
// themselves are exactly the table's own reference values at each
// tier's starting quantity; 200's own ratio isn't in that table (the
// last row just covers "150–200" as one bucket) so it's extrapolated
// continuing the same decelerating step-down pattern as the ratios
// before it (-0.35, -0.18, -0.17, -0.09, -0.05, then -0.03).
const PRICING_MIN_ORDER_FLAT = 95;
const PRICING_QTY_RATIO_ANCHORS = [
  { qty: 11, ratio: 2.02 },
  { qty: 25, ratio: 1.67 },
  { qty: 50, ratio: 1.49 },
  { qty: 75, ratio: 1.32 },
  { qty: 100, ratio: 1.23 },
  { qty: 150, ratio: 1.18 },
  { qty: 200, ratio: 1.15 },
];
// One representative order size per tier above, offered as the Next
// modal's dropdown options — round numbers a customer would actually
// type into a quantity field, not the tier's raw bounds.
const PRICING_QTY_OPTIONS = [10, 20, 25, 50, 75, 100, 150, 200];
// Text color for the "Estimated total" figure in the Next modal, keyed by
// CARD_TYPES color name -- picked to read clearly against the modal's
// black background rather than reusing each card type's own (often much
// darker/anodized-muted) swatch hex directly. Black and Silver both use
// red rather than a "readable black"/"readable silver": Black's actual
// swatch (#0d0d0d) is all but invisible on black, and Silver reads too
// close to the modal's own plain white/gray body text to stand out.
const NEXT_MODAL_TOTAL_COLORS = {
  Black: '#ef4444',
  Silver: '#ef4444',
  Yellow: '#facc15',
  Red: '#f87171',
  Blue: '#60a5fa',
  Orange: '#fb923c',
  Violet: '#c084fc',
  Green: '#4ade80',
};
function ratioForQty(qty) {
  const anchors = PRICING_QTY_RATIO_ANCHORS;
  if (qty <= anchors[0].qty) return anchors[0].ratio;
  if (qty >= anchors[anchors.length - 1].qty) return anchors[anchors.length - 1].ratio;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (qty >= a.qty && qty <= b.qty) {
      const t = (qty - a.qty) / (b.qty - a.qty);
      return a.ratio + (b.ratio - a.ratio) * t;
    }
  }
  return anchors[anchors.length - 1].ratio;
}
// $95 is a standing order minimum, not just the 1–10 tier's own rate —
// any quantity/design combination whose real cost-plus-markup total
// would fall under that (a simple design at a low-but-not-tiny
// quantity, e.g. 20 plain cards) still gets charged the $95 floor
// instead of a misleadingly cheap total. `each`/`total` are null while
// isMinCharge is true since there's no real meaningful per-card rate at
// the order-minimum price — the UI shows "$95 min charge" instead of an
// "ea." figure in that case, only switching to a real per-card price
// once the computed total actually clears $95.
function getNextModalPricing(directCost, qty) {
  if (qty <= 10) return { total: PRICING_MIN_ORDER_FLAT, each: null, isMinCharge: true };
  const total = directCost * ratioForQty(qty) * qty;
  if (total < PRICING_MIN_ORDER_FLAT) return { total: PRICING_MIN_ORDER_FLAT, each: null, isMinCharge: true };
  return { total, each: total / qty, isMinCharge: false };
}
// Relative engrave-time weight per finish, from the swatch reference
// card's own $ tiers — Metallic or Frosted White takes longer per mm^2
// than a plain White fill or a thin Stroke outline.
const FINISH_TIME_WEIGHT = { stroke: 0.7, white: 1.0, metallic: 1.7, 'frosted-white': 2.0 };
// Resolution the price estimate renders each finish pass at (see
// weightedCoveragePx2ForSnapshot) — higher catches fine Texture/grain
// spacing more accurately, at the cost of a bigger pixel buffer to sum.
const COVERAGE_RESOLUTION_SCALE = 3;

// ---- Toolbar tool selection ----
// Panel-toggle (Layers) and standalone-toggle (Guides) buttons are
// excluded — neither selects a drawing tool, so they're not part of
// this mutually-exclusive group.
const toolButtons = document.querySelectorAll('.editor-tool:not(.editor-panel-toggle):not(.editor-standalone-toggle):not(.editor-file-trigger)');
toolButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    toolButtons.forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
  });
});

// ---- Layers side panel ----
const sidePanel = document.getElementById('side-panel');
const panelToggles = document.querySelectorAll('.editor-panel-toggle');
if (sidePanel && panelToggles.length) {
  panelToggles.forEach((btn) => {
    btn.addEventListener('click', () => {
      const panelName = btn.dataset.panel;
      const alreadyOpen = btn.classList.contains('is-active');

      panelToggles.forEach((b) => b.classList.remove('is-active'));
      sidePanel.querySelectorAll('.editor-side-panel-section').forEach((s) => s.classList.remove('is-active'));

      if (alreadyOpen) {
        // Clicking the open panel's own button closes it.
        sidePanel.classList.remove('is-open');
        return;
      }
      btn.classList.add('is-active');
      sidePanel.classList.add('is-open');
      const section = sidePanel.querySelector(`[data-panel-content="${panelName}"]`);
      if (section) section.classList.add('is-active');
    });
  });
}

// ---- Rulers ----
// lengthMm is always the card's real physical size in mm — unitSystem only
// changes how the ticks are divided up and labeled. Clears its own
// previous contents first so it can be re-run when the unit changes.
function buildRuler(el, lengthMm, isVertical) {
  el.innerHTML = '';
  function addTick(pos, isMajor, labelText) {
    const tick = document.createElement('span');
    tick.className = 'ruler-tick ' + (isMajor ? 'major' : 'minor');
    if (isVertical) tick.style.top = `${pos}px`;
    else tick.style.left = `${pos}px`;
    el.appendChild(tick);
    if (isMajor) {
      const label = document.createElement('span');
      label.className = 'ruler-label';
      label.textContent = labelText;
      if (isVertical) label.style.top = `${pos}px`;
      else label.style.left = `${pos}px`;
      el.appendChild(label);
    }
  }
  if (unitSystem === 'in') {
    const MINOR_EVERY_IN = 0.125; // 1/8"
    const MAJOR_EVERY_STEPS = 8; // every 8th minor tick = 1"
    const lengthIn = lengthMm / MM_PER_IN;
    const steps = Math.round(lengthIn / MINOR_EVERY_IN);
    for (let i = 0; i <= steps; i++) {
      const inch = i * MINOR_EVERY_IN;
      const isMajor = i % MAJOR_EVERY_STEPS === 0;
      addTick(inch * MM_PER_IN * PX_PER_MM, isMajor, inch);
    }
    return;
  }
  const MAJOR_EVERY = 10; // mm
  const MINOR_EVERY = 2; // mm
  for (let mm = 0; mm <= lengthMm; mm += MINOR_EVERY) {
    addTick(mm * PX_PER_MM, mm % MAJOR_EVERY === 0, mm);
  }
}

const rulerTop = document.getElementById('ruler-top');
const rulerLeft = document.getElementById('ruler-left');
function rebuildRulers() {
  if (rulerTop) buildRuler(rulerTop, 86, false);
  if (rulerLeft) buildRuler(rulerLeft, 54, true);
}
rebuildRulers();

// ---- Zoom ----
// `transform: scale`, not the CSS `zoom` property this used to run on —
// `zoom` has a real, documented history of inconsistent mouse-event
// coordinate handling in Safari specifically (clicks/drags landing off
// from the actual cursor position, worse the further from 100%), where
// `transform` is fully standardized and behaves identically everywhere.
// `transform` alone doesn't affect layout size though, so
// .editor-canvas-scroll would have nothing new to scroll toward once
// zoomed content no longer fits — .editor-canvas-frame-sizer (see
// card-editor.css) is a real, in-flow box that applyZoom() below resizes
// by hand to the frame's own natural size × the zoom factor, giving the
// scroll container the same "something real changed size" signal `zoom`
// used to provide, while the frame itself (transform-scaled, absolutely
// positioned inside that sizer) is what actually renders at that size.
const ZOOM_MIN = 25;
const ZOOM_MAX = 300;
const ZOOM_STEP = 10; // per button click — a deliberate, discrete action
const ZOOM_WHEEL_STEP = 5; // per wheel/trackpad tick
const DEFAULT_ZOOM = 100;
// The old default was a true 90% (the card sitting slightly smaller than
// its native size, so it fits comfortably in the canvas area) — rather
// than hardcode that look as a one-off "100% happens to render at 90%"
// special case, every displayed zoom percentage is scaled by this factor
// before being applied, so 100% now *is* that size, and the whole
// min/max range shifts proportionally along with it.
const ZOOM_CALIBRATION = 0.9;
let zoomLevel = DEFAULT_ZOOM;

const canvasFrame = document.querySelector('.editor-canvas-frame');
const canvasFrameSizer = document.getElementById('canvas-frame-sizer');
const zoomValueEl = document.getElementById('zoom-value');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomInBtn = document.getElementById('zoom-in');
// Matches .editor-canvas-frame's own fixed grid-template-columns/rows
// sums (34+16+774 / 18+34+16+486) in card-editor.css — hardcoded rather
// than measured via offsetWidth/Height because that measurement isn't
// reliable at every point setup could run: .editor-shell is display:none
// below the mobile breakpoint, and a one-time DOM read taken while that's
// true (e.g. a real user starting in a narrow window, or this file's own
// initial script execution landing before layout has settled) would
// permanently cache 0 — silently breaking the zoom sizer's math forever,
// even after the window is later resized wide enough to show the editor.
const FRAME_NATURAL_W = 824;
const FRAME_NATURAL_H = 554;

function applyZoom() {
  const factor = (zoomLevel / 100) * ZOOM_CALIBRATION;
  if (canvasFrame) canvasFrame.style.transform = `scale(${factor})`;
  if (canvasFrameSizer) {
    canvasFrameSizer.style.width = `${FRAME_NATURAL_W * factor}px`;
    canvasFrameSizer.style.height = `${FRAME_NATURAL_H * factor}px`;
  }
  if (zoomValueEl) zoomValueEl.textContent = `${zoomLevel}%`;
  if (zoomOutBtn) zoomOutBtn.disabled = zoomLevel <= ZOOM_MIN;
  if (zoomInBtn) zoomInBtn.disabled = zoomLevel >= ZOOM_MAX;
}

if (zoomOutBtn) {
  zoomOutBtn.addEventListener('click', () => {
    zoomLevel = Math.max(ZOOM_MIN, zoomLevel - ZOOM_STEP);
    applyZoom();
  });
}
if (zoomInBtn) {
  zoomInBtn.addEventListener('click', () => {
    zoomLevel = Math.min(ZOOM_MAX, zoomLevel + ZOOM_STEP);
    applyZoom();
  });
}

// A trackpad pinch gesture (or Ctrl/Cmd+scroll on a mouse) fires as a
// wheel event with ctrlKey set — that's the standard, universal way
// browsers signal "this is a zoom gesture," distinct from a plain
// two-finger scroll. Alt/Option+scroll is an additional manual shortcut
// for the same thing. So: pinch/Ctrl+scroll/Alt+scroll zooms; everything
// else (a plain two-finger trackpad pan, or a normal mouse wheel) is left
// alone entirely so the browser's native scrolling pans the canvas — no
// manual scrollLeft/scrollTop math needed for that case.
const canvasScroll = document.querySelector('.editor-canvas-scroll');
if (canvasScroll) {
  canvasScroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey && !e.altKey) return; // plain scroll — let it pan natively
    e.preventDefault();
    zoomLevel = e.deltaY < 0
      ? Math.min(ZOOM_MAX, zoomLevel + ZOOM_WHEEL_STEP)
      : Math.max(ZOOM_MIN, zoomLevel - ZOOM_WHEEL_STEP);
    applyZoom();
  }, { passive: false });
}

// Middle-mouse-button hold-and-drag panning ("hand tool"). Uses Pointer
// Events + setPointerCapture rather than plain mousedown/mousemove:
// preventDefault on a plain mousedown doesn't reliably stop Chrome's own
// middle-click autoscroll feature from also activating, which then
// fights with a live drag-tracking approach (autoscroll is a "click
// once, steer, click again" model, not "hold and drag"). Capturing the
// pointer on the target element sidesteps that.
if (canvasScroll) {
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartScrollLeft = 0;
  let panStartScrollTop = 0;

  canvasScroll.addEventListener('pointerdown', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartScrollLeft = canvasScroll.scrollLeft;
    panStartScrollTop = canvasScroll.scrollTop;
    canvasScroll.classList.add('is-panning');
    canvasScroll.setPointerCapture(e.pointerId);
  });

  canvasScroll.addEventListener('pointermove', (e) => {
    if (!isPanning) return;
    canvasScroll.scrollLeft = panStartScrollLeft - (e.clientX - panStartX);
    canvasScroll.scrollTop = panStartScrollTop - (e.clientY - panStartY);
  });

  const stopPanning = (e) => {
    if (!isPanning) return;
    isPanning = false;
    canvasScroll.classList.remove('is-panning');
    if (canvasScroll.hasPointerCapture(e.pointerId)) canvasScroll.releasePointerCapture(e.pointerId);
  };
  canvasScroll.addEventListener('pointerup', stopPanning);
  canvasScroll.addEventListener('pointercancel', stopPanning);

  // Belt-and-suspenders: explicitly block the middle-click auxclick
  // default too, in case it fires after the drag.
  canvasScroll.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  // The pan area is much bigger than the frame so there's always room to
  // pan — start scrolled to its center so the frame is actually in view
  // on load, instead of scrolled to the pan area's top-left corner.
  const panArea = canvasScroll.querySelector('.editor-canvas-pan-area');
  function centerPanArea() {
    if (!panArea) return;
    canvasScroll.scrollLeft = (panArea.offsetWidth - canvasScroll.clientWidth) / 2;
    canvasScroll.scrollTop = (panArea.offsetHeight - canvasScroll.clientHeight) / 2;
  }
  centerPanArea();

  const recenterBtn = document.getElementById('recenter-view');
  if (recenterBtn) {
    recenterBtn.addEventListener('click', () => {
      zoomLevel = DEFAULT_ZOOM;
      applyZoom();
      centerPanArea();
    });
  }

  // Clicking anywhere in this viewport that isn't the fabric canvas
  // itself — the rulers, or the black margin around the card — deselects
  // whatever's currently selected. A click on the canvas but off any
  // object is already handled by Fabric's own selection logic; this just
  // covers everywhere else in view that Fabric never sees.
  canvasScroll.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.tagName === 'CANVAS' || !fabricCanvas) return;
    if (fabricCanvas.getActiveObject()) {
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
    }
  });
}

// Match the initial zoom (and its label/button states) to the same
// DEFAULT_ZOOM used above — the HTML's own static "100%" text is just a
// placeholder until this runs.
applyZoom();

// ---- Non-Chrome browser warning + Chrome-only feature toast ----
// 'queryLocalFonts' in window is the same real feature-detect the actual
// Chrome-only feature (Load System Fonts, further down) already gates
// itself on — reused here as the practical "is this a Chrome-family
// browser" signal, rather than a separate UA-sniffed guess, since it's
// the one thing in this app that's actually Chromium-exclusive today.
const IS_CHROME_FAMILY = 'queryLocalFonts' in window;
const BROWSER_WARNING_DISMISSED_KEY = 'plmBrowserWarningDismissed';
const browserWarningEl = document.getElementById('editor-browser-warning');
const browserWarningDismissBtn = document.getElementById('editor-browser-warning-dismiss');
if (browserWarningEl && !IS_CHROME_FAMILY) {
  let alreadyDismissed = false;
  try {
    alreadyDismissed = sessionStorage.getItem(BROWSER_WARNING_DISMISSED_KEY) === '1';
  } catch (err) {
    alreadyDismissed = false;
  }
  if (!alreadyDismissed) browserWarningEl.hidden = false;
}
if (browserWarningDismissBtn) {
  browserWarningDismissBtn.addEventListener('click', () => {
    if (browserWarningEl) browserWarningEl.hidden = true;
    try {
      sessionStorage.setItem(BROWSER_WARNING_DISMISSED_KEY, '1');
    } catch (err) {
      // sessionStorage unavailable — the banner will just show again
      // next load, which is a fine fallback.
    }
  });
}
// Generic, reusable — call whenever a Chrome-only feature is actually
// attempted somewhere that isn't Chrome (see the Load System Fonts
// button further down for the first user of this).
let toastHideTimer = null;
function showChromeOnlyToast(featureName) {
  const toastEl = document.getElementById('editor-toast');
  if (!toastEl) return;
  toastEl.textContent = `${featureName} is only available in Chrome.`;
  toastEl.hidden = false;
  // Two rAFs (not one) so the hidden->visible attribute change and the
  // opacity transition's starting state both actually paint first —
  // otherwise the browser can coalesce them into one frame and the
  // fade-in never visibly happens, same class of issue as the loading
  // overlay's own entrance animation elsewhere in this file.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toastEl.classList.add('is-visible'));
  });
  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => {
    toastEl.classList.remove('is-visible');
    setTimeout(() => {
      toastEl.hidden = true;
    }, 250); // matches the CSS opacity transition duration
  }, 3000);
}

// ---- Fabric.js canvas — the first real (non-placeholder) tool: Text ----
const fabricCanvasEl = document.getElementById('fabric-canvas');
let fabricCanvas = null;
if (fabricCanvasEl && window.fabric) {
  // Lets Fabric's own hit-testing look inside a group instead of stopping
  // at its outer bounding box — needed so double-click-to-edit-a-member
  // (see the mouse:dblclick handler below) can find out which actual
  // member was clicked. Doesn't change single-click selection at all:
  // that still always resolves to the outermost group, same as before —
  // this only adds the extra (otherwise unused) subTargets data alongside it.
  fabric.Group.prototype.subTargetCheck = true;
  fabricCanvas = new fabric.Canvas('fabric-canvas', {
    width: PASTEBOARD_W,
    height: PASTEBOARD_H,
    // Transparent — the CSS grid pattern behind the canvas (see
    // .editor-canvas-scroll) shows through everywhere now, pasteboard and
    // card region alike, rather than painting either an opaque pasteboard
    // color or a separate card-shaped fill on top of it.
    selection: true,
    // Fabric's default (false) always draws the active object on top of
    // everything else while it's selected, regardless of its real
    // position in the stack — which was silently burying the edge
    // indicator (added right after, and after every other object) under
    // whatever shape it was supposed to outline the instant that shape
    // became the selection. True makes objects render in their actual
    // z-order always, active or not, so the indicator stays on top of
    // the shape it belongs to like any other later-added object would.
    preserveObjectStacking: true,
  });

  // The canvas is now the whole pasteboard, much bigger than the card
  // window (.editor-canvas-wrap, still 774x486) it sits inside — shift
  // Fabric's own wrapper element (the div it wraps the lower/upper
  // canvas pair in) up/left by the card's offset so the wrap's own
  // (0,0)-to-(774,486) box shows exactly the card region of the
  // pasteboard, matching where the ruler/ mm scale expect it.
  if (fabricCanvas.wrapperEl) {
    fabricCanvas.wrapperEl.style.position = 'absolute';
    fabricCanvas.wrapperEl.style.left = `${-CARD_OFFSET_X}px`;
    fabricCanvas.wrapperEl.style.top = `${-CARD_OFFSET_Y}px`;
  }

  const textBtn = document.getElementById('tool-text');
  const shapesBtn = document.getElementById('tool-shapes');
  const isTextToolActive = () => !!(textBtn && textBtn.classList.contains('is-active'));
  const isShapesToolActive = () => !!(shapesBtn && shapesBtn.classList.contains('is-active'));

  // ---- Shape type (which shape the Shapes tool draws next) ----
  let currentShapeType = 'line';
  const shapeTypeButtons = document.querySelectorAll('.editor-shape-type-btn');
  shapeTypeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      currentShapeType = btn.dataset.shape;
      shapeTypeButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      // Reflect the new shape's fill/stroke applicability (e.g. Line has
      // no fill/stroke toggle) immediately, not just once one is placed.
      if (!fabricCanvas.getActiveObject()) {
        refreshFillModeUI({ type: currentShapeType });
        refreshLineStyleUI({ type: currentShapeType });
      }
    });
  });

  // Update the canvas cursor whenever the active tool changes, and show
  // the object toolbar as soon as Text or Shapes is selected (reflecting
  // the defaults a new object will use), not only once one is actually
  // placed. Switching to another tool hides it again, unless an object
  // is still selected.
  toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      // Picking a drawing tool implies leaving Finish mode — its toolbar
      // would otherwise sit on screen at the same time as this one.
      if (finishModeActive) setFinishMode(false);
      fabricCanvas.defaultCursor = btn.id === 'tool-text' ? 'text' : 'default';
      // Fabric's own click-drag-on-empty-canvas group-selection marquee
      // would otherwise fight with the Shapes tool's click-drag-to-draw.
      fabricCanvas.selection = btn.id !== 'tool-shapes';
      if (btn.id === 'tool-text') {
        showObjectToolbarFor({ type: 'i-text', fontFamily: 'Arial', fontSize: 24, textAlign: 'left' });
      } else if (btn.id === 'tool-shapes') {
        showObjectToolbarFor({ type: currentShapeType });
      } else if (!fabricCanvas.getActiveObject()) {
        hideObjectToolbar();
      }
    });
  });

  // Clicking the canvas with the Text tool active places a new editable
  // text object right there (unless the click landed on an existing
  // object — then leave it to Fabric's normal selection/editing).
  // Fill is a plain placeholder white for now; real finish colors (the
  // white/frosted/metallic/stroke/texture system from the editor plan)
  // aren't wired up to actual object rendering yet.
  fabricCanvas.on('mouse:down', (opt) => {
    if (!isTextToolActive() || opt.target) return;
    const pointer = fabricCanvas.getPointer(opt.e);
    const text = new fabric.IText('', {
      left: pointer.x,
      top: pointer.y,
      fontFamily: 'Arial',
      fontSize: 24,
      fill: '#ffffff',
      textAlign: 'left',
      // Default anchor is top-left (matches the default originX/Y below,
      // and the click point becoming the box's top-left as you type).
      // centeredRotation:false so a never-touched object's rotation
      // pivot is consistent with that anchor, not fabric's own default
      // (which rotates around center regardless of origin).
      originX: 'left',
      originY: 'top',
      centeredRotation: false,
    });
    fabricCanvas.add(text);
    fabricCanvas.setActiveObject(text);
    applyScalingControlsVisibility(text);
    text.enterEditing();
    fabricCanvas.requestRenderAll();
  });

  // Click-drag with the Shapes tool active draws a shape of the
  // currently-picked type from the press point to wherever the pointer
  // is now, with a live W/H readout tracking the pointer — releasing
  // finalizes it (selected, ready to move on, same as text/a click-
  // placed shape used to work). A drag too small to call a real drag
  // (basically just a click) falls back to a sensible default size
  // centered on the click point, so a quick click still works.
  const shapeDrawLabel = document.getElementById('shape-draw-label');
  function showShapeDrawLabel(nearX, nearY, wPx, hPx) {
    if (!shapeDrawLabel) return;
    shapeDrawLabel.textContent = `${(wPx / pxPerUnit()).toFixed(unitDecimals())} × ${(hPx / pxPerUnit()).toFixed(unitDecimals())} ${unitLabel()}`;
    // nearX/nearY are raw pasteboard-space canvas coordinates; this label
    // is CSS-positioned relative to .editor-card (the card window), so
    // the card's own offset into the pasteboard needs subtracting first.
    shapeDrawLabel.style.left = `${nearX - CARD_OFFSET_X + 10}px`;
    shapeDrawLabel.style.top = `${nearY - CARD_OFFSET_Y + 10}px`;
    shapeDrawLabel.classList.add('is-visible');
  }
  function hideShapeDrawLabel() {
    if (shapeDrawLabel) shapeDrawLabel.classList.remove('is-visible');
  }

  function makeLine(x1, y1, x2, y2) {
    return new fabric.Line([x1, y1, x2, y2], {
      originX: 'left', originY: 'top', centeredRotation: false,
      // A line has no fillable area, so Stroke is the only finish that
      // actually makes physical sense for it — default to that instead
      // of the usual White fallback (see getFinish), which would render
      // as nothing at all (a Line ignores fill, and White clears stroke).
      // Its visual color starts at Stroke's own proofing color (rather
      // than plain white) since that's what it's already set to.
      stroke: FINISH_COLORS.stroke, strokeWidth: 2,
      cardFinish: 'stroke',
    });
  }
  function makeBoxShape(type) {
    // Fill mode by default (fill set, no stroke) — matches the Fill/Stroke
    // toggle's default in the toolbar below.
    const base = {
      originX: 'left', originY: 'top', centeredRotation: false, fill: '#ffffff', strokeWidth: 0, left: 0, top: 0,
    };
    if (type === 'circle') return new fabric.Circle({ ...base, radius: 1 });
    if (type === 'triangle') return new fabric.Triangle({ ...base, width: 1, height: 1 });
    return new fabric.Rect({ ...base, width: 1, height: 1 });
  }
  // A triangle's three corners, top-left-origin like fabric.Triangle's own
  // default layout, so a rounded version built from these lines up exactly
  // where the plain triangle it's replacing was.
  function triangleVertices(width, height) {
    return [
      { x: width / 2, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
  }
  // Rounds every corner of a closed polygon by `radius`, returning an SVG
  // path 'd' string: at each vertex, retreat along both adjacent edges by
  // the radius and join those two points with a quadratic curve using the
  // original vertex as the control point (the standard construction for a
  // rounded polygon corner). Per-vertex radius is clamped to half the
  // shorter of its two adjacent edges so corners can never overlap or
  // invert the shape, however large a radius is requested.
  function roundedPolygonPathD(points, radius) {
    const n = points.length;
    const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const corners = points.map((p, i) => {
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];
      const dPrev = dist(p, prev);
      const dNext = dist(p, next);
      const r = Math.min(radius, dPrev / 2, dNext / 2);
      return {
        start: { x: p.x + ((prev.x - p.x) / dPrev) * r, y: p.y + ((prev.y - p.y) / dPrev) * r },
        end: { x: p.x + ((next.x - p.x) / dNext) * r, y: p.y + ((next.y - p.y) / dNext) * r },
        control: p,
      };
    });
    let d = `M ${corners[0].start.x} ${corners[0].start.y} `;
    for (let i = 0; i < n; i++) {
      const c = corners[i];
      const nextStart = corners[(i + 1) % n].start;
      d += `Q ${c.control.x} ${c.control.y} ${c.end.x} ${c.end.y} L ${nextStart.x} ${nextStart.y} `;
    }
    return `${d}Z`;
  }
  // Builds (or rebuilds) a rounded-corner triangle as a fabric.Path — the
  // only way to get rounded corners, since fabric.Triangle has no native
  // radius. _shapeBaseType/_triWidth/_triHeight/_cornerRadiusPx ride along
  // in HISTORY_PROPS so undo/redo and a later radius edit can find their
  // way back to this same geometry.
  function makeRoundedTrianglePath(width, height, radiusPx, props) {
    const d = roundedPolygonPathD(triangleVertices(width, height), radiusPx);
    const path = new fabric.Path(d, { ...props, originX: 'left', originY: 'top' });
    path._shapeBaseType = 'triangle';
    path._triWidth = width;
    path._triHeight = height;
    path._cornerRadiusPx = radiusPx;
    return path;
  }
  // Rect/triangle size directly via width/height; a circle drawn from a
  // (possibly non-square) drag box becomes an ellipse — radius from the
  // horizontal span, scaleY stretching it to match the vertical span.
  function fitBoxShape(shape, type, x0, y0, x1, y1) {
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const w = Math.max(1, Math.abs(x1 - x0));
    const h = Math.max(1, Math.abs(y1 - y0));
    if (type === 'circle') shape.set({ left, top, radius: w / 2, scaleX: 1, scaleY: h / w });
    else shape.set({ left, top, width: w, height: h });
    shape.setCoords();
  }
  // Holding Shift while drawing constrains the drag: a line snaps to the
  // nearest horizontal/vertical (whichever the drag is closer to, i.e.
  // effectively 0/90/180/270°); rect/circle/triangle get an equal
  // width/height (a square, or a perfect circle) — same idea for both,
  // just picking the larger of the two spans and applying it to both
  // axes, sign-preserved so the shape still grows toward the pointer.
  function constrainDragPoint(type, x0, y0, x1, y1, shiftKey) {
    if (!shiftKey) return { x1, y1 };
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (type === 'line') {
      if (Math.abs(dx) > Math.abs(dy)) return { x1: x0 + dx, y1: y0 };
      return { x1: x0, y1: y0 + dy };
    }
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return { x1: x0 + (dx < 0 ? -size : size), y1: y0 + (dy < 0 ? -size : size) };
  }

  function finalizeShape(shape) {
    fabricCanvas.setActiveObject(shape);
    setObjectAnchor(shape, 'c');
    applyScalingControlsVisibility(shape);
    fabricCanvas.requestRenderAll();
    showObjectToolbarFor(shape);
    // The shape was already added at drag-start (with a placeholder
    // size) which pushed its own history step — this captures the drag's
    // real, settled size/position, since nothing else does once drawing
    // ends.
    pushHistory();
  }

  let shapeDraw = null; // { type, x0, y0, shape }

  fabricCanvas.on('mouse:down', (opt) => {
    if (!isShapesToolActive() || opt.target) return;
    const pointer = fabricCanvas.getPointer(opt.e);
    const type = currentShapeType;
    const shape = type === 'line' ? makeLine(pointer.x, pointer.y, pointer.x, pointer.y) : makeBoxShape(type);
    if (type !== 'line') fitBoxShape(shape, type, pointer.x, pointer.y, pointer.x, pointer.y);
    // Set before add() (not after) so the object:added history listener
    // below can see a draw is in progress and skip it — the shape's real
    // size isn't known until the drag ends, so only finalizeShape's own
    // pushHistory() call should record this as a single undo step.
    shapeDraw = { type, x0: pointer.x, y0: pointer.y, shape };
    fabricCanvas.add(shape);
    fabricCanvas.requestRenderAll();
    showShapeDrawLabel(pointer.x, pointer.y, 0, 0);
  });

  fabricCanvas.on('mouse:move', (opt) => {
    if (!shapeDraw) return;
    const rawPointer = fabricCanvas.getPointer(opt.e);
    const { type, x0, y0 } = shapeDraw;
    const { x1, y1 } = constrainDragPoint(type, x0, y0, rawPointer.x, rawPointer.y, opt.e.shiftKey);
    if (type === 'line') {
      // A Line's width/height are baked in at construction, not
      // recomputed from x1/y1/x2/y2 afterward — simplest correct way
      // to redraw it live is a fresh object each frame.
      fabricCanvas.remove(shapeDraw.shape);
      shapeDraw.shape = makeLine(x0, y0, x1, y1);
      fabricCanvas.add(shapeDraw.shape);
    } else {
      fitBoxShape(shapeDraw.shape, type, x0, y0, x1, y1);
    }
    fabricCanvas.requestRenderAll();
    showShapeDrawLabel(Math.max(x0, x1), Math.max(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  });

  // ---- Shape-size modal ----
  // A plain click (no drag) with the Shapes tool used to just drop a
  // fixed-size default shape at the click point — now it opens this
  // dialog instead, so the exact size can be typed in. `shape` is the
  // placeholder Fabric already added at mouse:down (1x1, invisible);
  // Cancel removes it, Done resizes/repositions it (or, for a Line,
  // rebuilds it, since a Line's endpoints are baked in at construction)
  // and centers it on the original click point (x0, y0).
  const shapeSizeModal = document.getElementById('shape-size-modal');
  const shapeSizeModalWField = document.getElementById('shape-size-modal-w-field');
  const shapeSizeModalHField = document.getElementById('shape-size-modal-h-field');
  const shapeSizeModalWLabel = document.getElementById('shape-size-modal-w-label');
  const shapeSizeModalW = document.getElementById('shape-size-modal-w');
  const shapeSizeModalH = document.getElementById('shape-size-modal-h');
  const shapeSizeModalCancel = document.getElementById('shape-size-modal-cancel');
  const shapeSizeModalDone = document.getElementById('shape-size-modal-done');
  const SHAPE_SIZE_MODAL_DEFAULT_PX = 20 * PX_PER_MM;
  let pendingShapeSize = null; // { shape, type, x0, y0 }
  function isShapeSizeModalOpen() {
    return !!(shapeSizeModal && shapeSizeModal.classList.contains('is-open'));
  }
  function openShapeSizeModal(shape, type, x0, y0) {
    if (!shapeSizeModal) {
      // No modal in the DOM (shouldn't happen) — fall back to the old
      // fixed default so drawing still works.
      const SIZE = 60;
      fitBoxShape(shape, type, x0 - SIZE / 2, y0 - SIZE / 2, x0 + SIZE / 2, y0 + SIZE / 2);
      finalizeShape(shape);
      return;
    }
    pendingShapeSize = { shape, type, x0, y0 };
    const isLine = type === 'line';
    if (shapeSizeModalWLabel) shapeSizeModalWLabel.textContent = isLine ? 'L' : 'W';
    if (shapeSizeModalHField) shapeSizeModalHField.classList.toggle('is-hidden', isLine);
    if (shapeSizeModalWField) shapeSizeModalWField.title = isLine ? 'Length' : 'Width';
    const defaultVal = (SHAPE_SIZE_MODAL_DEFAULT_PX / pxPerUnit()).toFixed(unitDecimals());
    if (shapeSizeModalW) shapeSizeModalW.value = defaultVal;
    if (shapeSizeModalH) shapeSizeModalH.value = defaultVal;
    shapeSizeModal.classList.add('is-open');
    shapeSizeModal.setAttribute('aria-hidden', 'false');
    if (shapeSizeModalW) {
      shapeSizeModalW.focus();
      shapeSizeModalW.select();
    }
  }
  function closeShapeSizeModal() {
    if (!shapeSizeModal) return;
    shapeSizeModal.classList.remove('is-open');
    shapeSizeModal.setAttribute('aria-hidden', 'true');
    pendingShapeSize = null;
  }
  function cancelShapeSizeModal() {
    if (!pendingShapeSize) return;
    fabricCanvas.remove(pendingShapeSize.shape);
    fabricCanvas.requestRenderAll();
    closeShapeSizeModal();
  }
  function commitShapeSizeModal() {
    if (!pendingShapeSize) return;
    const { shape, type, x0, y0 } = pendingShapeSize;
    const wVal = parseFloat(shapeSizeModalW ? shapeSizeModalW.value : '');
    const hVal = parseFloat(shapeSizeModalH ? shapeSizeModalH.value : '');
    if (!(wVal > 0) || (type !== 'line' && !(hVal > 0))) return; // leave the dialog open to fix it
    const wPx = wVal * pxPerUnit();
    if (type === 'line') {
      // Same reason as the live drag preview: a Line's endpoints are
      // fixed at construction, so redrawing it means a fresh object.
      suppressHistoryEvents = true;
      fabricCanvas.remove(shape);
      const line = makeLine(x0 - wPx / 2, y0, x0 + wPx / 2, y0);
      fabricCanvas.add(line);
      suppressHistoryEvents = false;
      closeShapeSizeModal();
      finalizeShape(line);
      return;
    }
    const hPx = hVal * pxPerUnit();
    fitBoxShape(shape, type, x0 - wPx / 2, y0 - hPx / 2, x0 + wPx / 2, y0 + hPx / 2);
    closeShapeSizeModal();
    finalizeShape(shape);
  }
  if (shapeSizeModalCancel) shapeSizeModalCancel.addEventListener('click', cancelShapeSizeModal);
  if (shapeSizeModalDone) shapeSizeModalDone.addEventListener('click', commitShapeSizeModal);
  // Click on the dark overlay (outside the dialog box) cancels too.
  if (shapeSizeModal) {
    shapeSizeModal.addEventListener('mousedown', (e) => {
      if (e.target === shapeSizeModal) cancelShapeSizeModal();
    });
  }
  [shapeSizeModalW, shapeSizeModalH].forEach((input) => {
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitShapeSizeModal();
      }
    });
  });

  function finishShapeDraw() {
    if (!shapeDraw) return;
    const { shape, type, x0, y0 } = shapeDraw;
    shapeDraw = null;
    hideShapeDrawLabel();
    const rect = shape.getBoundingRect(true, true);
    if (rect.width < 4 && rect.height < 4) {
      openShapeSizeModal(shape, type, x0, y0);
      return;
    }
    finalizeShape(shape);
  }
  fabricCanvas.on('mouse:up', finishShapeDraw);
  // In case the pointer is released outside the canvas element.
  document.addEventListener('pointerup', () => {
    if (shapeDraw) finishShapeDraw();
  });

  // ---- SVG import ----
  // Fabric's own SVG parser handles the file; every imported piece is
  // wrapped in a fabric.Group — even a single-shape SVG — so imported
  // artwork always shows up as one unit with its pieces nested under it
  // in the Layers panel, rather than sometimes being a group and
  // sometimes a bare shape depending on what was in the file.
  const uploadBtn = document.getElementById('tool-upload');
  const importFileInput = document.getElementById('import-file-input');
  // CSS px is defined as 1/96in; our canvas uses PX_PER_MM px per mm instead,
  // so a value declared in real-world units (mm/cm/in/pt/pc) needs converting
  // from the 96dpi space Fabric's SVG parser assumes into our own scale —
  // otherwise a design authored at a known physical size comes in shrunk.
  const MM_PER_UNIT = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 };
  function parseSvgLengthToMm(str) {
    if (!str) return null;
    const match = String(str).trim().match(/^([\d.]+)\s*(mm|cm|in|pt|pc|px)?$/i);
    if (!match) return null;
    const value = parseFloat(match[1]);
    if (!isFinite(value)) return null;
    const unit = (match[2] || 'px').toLowerCase();
    return value * MM_PER_UNIT[unit];
  }
  // Centers the imported group on the card and finishes the import —
  // shared by both the fits-fine path and the confirmed-oversize path.
  function placeImportedGroup(group) {
    group.set({
      left: CARD_OFFSET_X + (CARD_W_PX - group.getScaledWidth()) / 2,
      top: CARD_OFFSET_Y + (CARD_H_PX - group.getScaledHeight()) / 2,
    });
    fabricCanvas.add(group);
    finalizeShape(group);
  }
  // Confirms before doing anything with an import that's larger than the
  // card, rather than silently scaling it — Cancel just drops the import
  // (the group was only ever built in memory, never added to the
  // canvas, so there's nothing to undo); Scale shrinks it to fit; Keep
  // True Size places it at its real, unscaled size — now that the
  // canvas is a pasteboard bigger than the card, that's a legitimate
  // choice rather than something that would just get clipped.
  const svgOversizeModal = document.getElementById('svg-oversize-modal');
  const svgOversizeModalCancel = document.getElementById('svg-oversize-modal-cancel');
  const svgOversizeModalYes = document.getElementById('svg-oversize-modal-yes');
  const svgOversizeModalTrueSize = document.getElementById('svg-oversize-modal-true-size');
  let pendingOversizeScale = null;
  let pendingOversizeTrueSize = null;
  function confirmOversizeImport(onScale, onTrueSize) {
    if (!svgOversizeModal) {
      // No modal in the DOM (shouldn't happen) — fall back to importing
      // scaled, same as before this feature existed.
      onScale();
      return;
    }
    pendingOversizeScale = onScale;
    pendingOversizeTrueSize = onTrueSize;
    svgOversizeModal.classList.add('is-open');
    svgOversizeModal.setAttribute('aria-hidden', 'false');
  }
  function closeOversizeModal() {
    if (!svgOversizeModal) return;
    svgOversizeModal.classList.remove('is-open');
    svgOversizeModal.setAttribute('aria-hidden', 'true');
    pendingOversizeScale = null;
    pendingOversizeTrueSize = null;
  }
  if (svgOversizeModalCancel) svgOversizeModalCancel.addEventListener('click', closeOversizeModal);
  if (svgOversizeModalTrueSize) {
    svgOversizeModalTrueSize.addEventListener('click', () => {
      const onTrueSize = pendingOversizeTrueSize;
      closeOversizeModal();
      if (onTrueSize) onTrueSize();
    });
  }
  if (svgOversizeModalYes) {
    svgOversizeModalYes.addEventListener('click', () => {
      const onConfirm = pendingOversizeScale;
      closeOversizeModal();
      if (onConfirm) onConfirm();
    });
  }
  if (svgOversizeModal) {
    svgOversizeModal.addEventListener('mousedown', (e) => {
      if (e.target === svgOversizeModal) closeOversizeModal();
    });
  }
  function isOversizeModalOpen() {
    return !!(svgOversizeModal && svgOversizeModal.classList.contains('is-open'));
  }

  // ---- PLM dialog (alert()/confirm() replacement) ----
  // Native alert()/confirm() carry a title/domain label the browser
  // controls entirely — no page can relabel it — so every use of either
  // anywhere in this file goes through here instead: same visual language
  // as every other modal in the app, headed "PLM". Both return a Promise
  // (there's no way to block script execution for a custom dialog the way
  // the native ones do), so every call site awaits it.
  const plmDialogOverlay = document.getElementById('plm-dialog-overlay');
  const plmDialogMessage = document.getElementById('plm-dialog-message');
  const plmDialogCancelBtn = document.getElementById('plm-dialog-cancel');
  const plmDialogOkBtn = document.getElementById('plm-dialog-ok');
  let plmDialogResolve = null;
  function closePlmDialog(result) {
    if (!plmDialogOverlay) return;
    plmDialogOverlay.classList.remove('is-open');
    plmDialogOverlay.setAttribute('aria-hidden', 'true');
    const resolve = plmDialogResolve;
    plmDialogResolve = null;
    if (resolve) resolve(result);
  }
  // showCancel true => confirm()-style (Cancel resolves false, OK
  // resolves true); false => alert()-style (Cancel hidden, only OK,
  // always resolves true once dismissed).
  function openPlmDialog(message, showCancel) {
    return new Promise((resolve) => {
      if (!plmDialogOverlay || !plmDialogMessage || !plmDialogOkBtn) {
        // No dialog in the DOM (shouldn't happen) — fall back to the
        // native ones rather than silently doing nothing.
        resolve(showCancel ? window.confirm(message) : (window.alert(message), true));
        return;
      }
      plmDialogResolve = resolve;
      plmDialogMessage.textContent = message;
      if (plmDialogCancelBtn) plmDialogCancelBtn.hidden = !showCancel;
      plmDialogOverlay.classList.add('is-open');
      plmDialogOverlay.setAttribute('aria-hidden', 'false');
      plmDialogOkBtn.focus();
    });
  }
  function plmAlert(message) {
    return openPlmDialog(message, false);
  }
  function plmConfirm(message) {
    return openPlmDialog(message, true);
  }
  if (plmDialogOkBtn) plmDialogOkBtn.addEventListener('click', () => closePlmDialog(true));
  if (plmDialogCancelBtn) plmDialogCancelBtn.addEventListener('click', () => closePlmDialog(false));
  if (plmDialogOverlay) {
    plmDialogOverlay.addEventListener('mousedown', (e) => {
      if (e.target === plmDialogOverlay) closePlmDialog(false);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && plmDialogOverlay && plmDialogOverlay.classList.contains('is-open')) closePlmDialog(false);
  });

  function importSvgFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const svgText = String(reader.result);
      fabric.loadSVGFromString(svgText, (objects, options) => {
        const valid = (objects || []).filter(Boolean);
        if (!valid.length) {
          plmAlert('Could not import that file — no supported shapes were found in it.');
          return;
        }
        // Fabric objects default to strokeWidth:1 even with no stroke paint,
        // which pads their bounding box and throws off the physical scale
        // computed below — zero it out wherever there's no visible stroke.
        valid.forEach((o) => {
          if (!o.stroke) o.strokeWidth = 0;
        });
        // Finish (defaulting to White) is what drives an object's color
        // now, not whatever the source file happened to use — otherwise
        // an imported design would keep its original artwork colors
        // instead of reading as "not yet assigned a finish" like
        // everything else. Checks each shape's own fill/stroke first
        // (done above), so this only touches whichever channel it
        // actually paints with.
        valid.forEach((o) => applyFinishColor(o, FINISH_COLORS.white));
        const group = new fabric.Group(valid, { originX: 'left', originY: 'top', centeredRotation: false });

        // If the SVG declares a real-world width/height (e.g. width="40mm"),
        // rescale so the import lands on the card at that exact physical
        // size, converting from Fabric's 96dpi assumption to our PX_PER_MM.
        const rootTag = (svgText.match(/<svg\b[^>]*>/i) || [''])[0];
        let declaredWmm = parseSvgLengthToMm((rootTag.match(/\bwidth="([^"]+)"/i) || [])[1]);
        let declaredHmm = parseSvgLengthToMm((rootTag.match(/\bheight="([^"]+)"/i) || [])[1]);
        const viewBoxParts = ((rootTag.match(/\bviewBox="([^"]+)"/i) || [])[1] || '')
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        const [, , viewBoxW, viewBoxH] = viewBoxParts.length === 4 ? viewBoxParts : [];
        // Many design tools (e.g. Illustrator) export with no width/height
        // attribute at all — just a viewBox — using PostScript points
        // (72/inch) as the coordinate system. Fall back to that only when
        // there's truly no other sizing info, since it's the standard
        // default unit for print-oriented SVG/PDF tooling.
        if (!declaredWmm && !declaredHmm && viewBoxW && viewBoxH) {
          declaredWmm = viewBoxW * MM_PER_UNIT.pt;
          declaredHmm = viewBoxH * MM_PER_UNIT.pt;
        }
        const refW = (options && options.width) || viewBoxW;
        const refH = (options && options.height) || viewBoxH;
        if (declaredWmm && refW) {
          group.scale((declaredWmm * PX_PER_MM) / refW);
        } else if (declaredHmm && refH) {
          group.scale((declaredHmm * PX_PER_MM) / refH);
        }

        // Only shrink further if the (now true-to-life) import doesn't
        // actually fit on the card — never scale up, and don't touch the
        // size otherwise. If it doesn't fit, confirm with the user first
        // rather than silently shrinking their import.
        const maxW = CARD_W_PX;
        const maxH = CARD_H_PX;
        // A single ratio — the tighter of the two axes — applied through
        // .scale() (which sets scaleX and scaleY to the same value), so
        // the import always shrinks proportionally and never stretches.
        const overflowScale = Math.min(1, maxW / group.getScaledWidth(), maxH / group.getScaledHeight());
        if (overflowScale < 1) {
          confirmOversizeImport(
            () => {
              group.scale(group.scaleX * overflowScale);
              placeImportedGroup(group);
            },
            () => placeImportedGroup(group),
          );
        } else {
          placeImportedGroup(group);
        }
      });
    };
    reader.onerror = () => plmAlert('Could not read that file.');
    reader.readAsText(file);
  }
  if (uploadBtn && importFileInput) {
    uploadBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', () => {
      const file = importFileInput.files[0];
      importFileInput.value = ''; // allow re-importing the same file later
      if (file) importSvgFile(file);
    });
  }

  // ---- Text formatting toolbar: font, size, alignment ----
  const textToolbar = document.getElementById('text-toolbar');
  const fontFamilySelect = document.getElementById('text-font-family');
  const fontSizeInput = document.getElementById('text-font-size');
  const alignButtons = document.querySelectorAll('.editor-align-btn[data-align]');
  const rotationInput = document.getElementById('text-rotation');
  const anchorDots = document.querySelectorAll('#anchor-icon .anchor-dot');
  const anchorPanelButtons = document.querySelectorAll('.editor-anchor-btn');
  const posXInput = document.getElementById('text-pos-x');
  const posYInput = document.getElementById('text-pos-y');
  const sizeWInput = document.getElementById('text-size-w');
  const sizeHInput = document.getElementById('text-size-h');
  const nonUniformCheckbox = document.getElementById('text-nonuniform-scale');
  const shapeNonUniformCheckbox = document.getElementById('shape-nonuniform-scale');
  // 'path' covers the result of a Union/Subtract (see the boolean-ops
  // section below); 'group' is a plain Fabric group from the Group
  // context-menu action — both just need the shared transform toolbar
  // (position/rotation/size), not the shape-type or fill/stroke controls.
  const SHAPE_TYPES = ['line', 'rect', 'circle', 'ellipse', 'triangle', 'path', 'polygon', 'polyline', 'group'];
  // Fabric's getScaledWidth()/Height() fold strokeWidth into the bounding
  // box (assuming it's always centered on the path) — fine for text
  // (never stroked) but wrong for a stroked shape, doubly so once
  // inside/outside placement doubles the real strokeWidth internally
  // (see applyStrokeRender below). Shapes' W/H fields instead reflect the
  // path's own size, independent of stroke — same convention as
  // Illustrator/Figma's size panel.
  function displayWidthOf(obj) {
    return SHAPE_TYPES.includes(obj.type) ? obj.width * obj.scaleX : obj.getScaledWidth();
  }
  function displayHeightOf(obj) {
    return SHAPE_TYPES.includes(obj.type) ? obj.height * obj.scaleY : obj.getScaledHeight();
  }

  // ---- Line dash style (solid/dashed/dotted) ----
  // Dash/gap lengths scale off the line's own strokeWidth so the pattern
  // stays proportionally correct regardless of thickness. Dotted uses a
  // near-zero dash with a round cap — the standard canvas/SVG trick for
  // actual round dots rather than tiny rectangles.
  const lineStyleGroup = document.getElementById('line-style-group');
  const lineStyleButtons = document.querySelectorAll('.editor-line-style-btn');
  function lineDashPropsFor(style, strokeWidth) {
    const w = strokeWidth || 2;
    if (style === 'dashed') return { strokeDashArray: [w * 3, w * 2], strokeLineCap: 'butt' };
    if (style === 'dotted') return { strokeDashArray: [0.001, w * 2], strokeLineCap: 'round' };
    return { strokeDashArray: null, strokeLineCap: 'butt' };
  }
  function setLineDashStyle(obj, style) {
    obj.lineDashStyle = style;
    obj.set(lineDashPropsFor(style, obj.strokeWidth));
  }
  function refreshLineStyleUI(obj) {
    const applicable = obj.type === 'line';
    if (lineStyleGroup) lineStyleGroup.classList.toggle('is-hidden', !applicable);
    if (!applicable) return;
    const style = obj.lineDashStyle || 'solid';
    lineStyleButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.lineStyle === style));
  }
  lineStyleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj || obj.type !== 'line') return;
      setLineDashStyle(obj, btn.dataset.lineStyle);
      refreshLineStyleUI(obj);
      fabricCanvas.requestRenderAll();
      pushHistory();
    });
  });

  // ---- Shape fill vs. stroke, and stroke placement ----
  // Line is always a stroke already (it has no fill concept). A Group
  // (manual, or an imported SVG) has no single path of its own, but its
  // fill/stroke toggle still applies — recursively — to every fillable
  // shape nested inside it, so an imported design can be switched to
  // outline-only as a whole.
  const SHAPE_FILL_TYPES = ['rect', 'circle', 'ellipse', 'triangle', 'path', 'polygon', 'polyline'];
  const fillModeGroup = document.getElementById('shape-fill-mode-group');
  const fillModeButtons = document.querySelectorAll('.editor-shape-fill-btn');
  const strokeSettingsDropdown = document.getElementById('stroke-settings-dropdown');
  const strokeWidthInput = document.getElementById('shape-stroke-width');
  const strokeAlignButtons = document.querySelectorAll('.editor-stroke-align-btn');
  const cornerRadiusField = document.getElementById('corner-radius-field');
  const cornerRadiusInput = document.getElementById('shape-corner-radius');
  // Line has no fill area to round — "rounded edge" there means rounded
  // end caps instead, so it's included even though the mechanism differs.
  const ROUNDABLE_SHAPE_TYPES = ['rect', 'triangle', 'line'];
  // A rounded triangle is a plain fabric.Triangle up until the first time
  // a nonzero radius is applied, at which point it's rebuilt as a Path
  // (Fabric has no native triangle corner-radius) — _shapeBaseType is how
  // it's still recognized as "a roundable triangle" afterward.
  function isRoundableShape(obj) {
    if (!obj) return false;
    if (ROUNDABLE_SHAPE_TYPES.includes(obj.type)) return true;
    return obj.type === 'path' && obj._shapeBaseType === 'triangle';
  }
  function refreshCornerRadiusUI(obj) {
    const applicable = isRoundableShape(obj);
    if (cornerRadiusField) cornerRadiusField.classList.toggle('is-hidden', !applicable);
    if (!applicable) return;
    const px = obj._cornerRadiusPx || 0;
    if (cornerRadiusInput) cornerRadiusInput.value = (px / pxPerUnit()).toFixed(unitDecimals());
  }
  function fillEligible(obj) {
    return SHAPE_FILL_TYPES.includes(obj.type) || obj.type === 'group';
  }
  // First fillable shape found inside obj (obj itself, if it's already
  // one) — used as the representative whose fill/stroke/width/align the
  // toolbar reads and writes when a whole group is selected.
  function firstFillableDescendant(obj) {
    if (SHAPE_FILL_TYPES.includes(obj.type)) return obj;
    if (obj.type === 'group') {
      for (const child of obj.getObjects()) {
        const found = firstFillableDescendant(child);
        if (found) return found;
      }
    }
    return null;
  }
  function eachFillableDescendant(obj, fn) {
    if (SHAPE_FILL_TYPES.includes(obj.type)) {
      fn(obj);
    } else if (obj.type === 'group') {
      obj.getObjects().forEach((child) => eachFillableDescendant(child, fn));
    }
  }
  function shapeFillModeFor(obj) {
    const rep = firstFillableDescendant(obj) || obj;
    return rep.stroke && !rep.fill ? 'stroke' : 'fill';
  }
  // Fabric always renders a stroke straddling the path, half in/half out
  // (that's "center" placement, and needs no special handling). To fake
  // "inside"/"outside" on top of that, the path's stroke is drawn at
  // double the desired width, then a clipPath — a fresh copy of the same
  // shape at its true (unstroked) size — cuts away the half that
  // shouldn't be visible: normal clipping keeps only what's inside the
  // path (leaving the inward half, i.e. "inside"), while `inverted` flips
  // that to keep only what's outside (leaving the outward half). The
  // clip's own geometry is unscaled/unpositioned (centered at the
  // object's local origin) because Fabric applies the object's full
  // transform (position, rotation, scale) to its clipPath automatically.
  // Fabric's Path stores its parsed 'd' commands as an array (e.g.
  // ['M', x, y]) on obj.path — turning that back into a 'd' string lets a
  // fresh fabric.Path be built with the exact same geometry (it
  // recomputes its own pathOffset from those commands, so centering it
  // the same way as the other shape types below reproduces the original
  // exactly).
  function pathCommandsToString(commands) {
    return commands.map((seg) => seg.join(' ')).join(' ');
  }
  function makeStrokeClipShapeFor(obj) {
    const common = { left: 0, top: 0, originX: 'center', originY: 'center' };
    if (obj.type === 'circle') return new fabric.Circle({ ...common, radius: obj.radius });
    if (obj.type === 'ellipse') return new fabric.Ellipse({ ...common, rx: obj.rx, ry: obj.ry });
    if (obj.type === 'triangle') return new fabric.Triangle({ ...common, width: obj.width, height: obj.height });
    if (obj.type === 'polygon' || obj.type === 'polyline') return new fabric.Polygon(obj.points, { ...common });
    if (obj.type === 'path') return new fabric.Path(pathCommandsToString(obj.path), { ...common, fillRule: obj.fillRule });
    return new fabric.Rect({ ...common, width: obj.width, height: obj.height });
  }
  // Applies obj._strokeWidthPx (the width the user actually asked for)
  // and obj.strokeAlign to the object's real, renderable strokeWidth/
  // clipPath. Called whenever either of those, or fill/stroke mode,
  // changes — never needs re-running on a plain resize, since the clip
  // shares the object's own transform and scales/rotates/moves with it
  // automatically.
  function applyStrokeRender(obj) {
    if (obj.type === 'group') {
      eachFillableDescendant(obj, applyStrokeRender);
      return;
    }
    if (shapeFillModeFor(obj) !== 'stroke') {
      obj.set({ clipPath: null });
      return;
    }
    const align = obj.strokeAlign || 'center';
    // _strokeWidthPx is a real physical width the user dialed in (mm, via
    // the Stroke settings field) — it must render at that width regardless
    // of the object's own scale, so strokeUniform is required here. Without
    // it, an object with a large baked-in scale (e.g. an imported SVG whose
    // tiny viewBox gets scaled way up to its real-world card size) turns
    // this into a wildly oversized stroke, since Fabric otherwise multiplies
    // strokeWidth by the object's full accumulated scale.
    const desired = obj._strokeWidthPx || 0.5 * PX_PER_MM;
    if (align === 'center') {
      obj.set({ strokeWidth: desired, strokeUniform: true, clipPath: null });
    } else {
      const clip = makeStrokeClipShapeFor(obj);
      clip.set({ inverted: align === 'outside' });
      obj.set({ strokeWidth: desired * 2, strokeUniform: true, clipPath: clip });
    }
    obj.setCoords();
  }
  // Stroke mode clears the fill entirely (not fill+stroke together) —
  // "stroke" here means an outline only. NOTE for whenever SVG export is
  // built: the laser software doesn't handle plain SVG strokes reliably
  // (stroke width doesn't come through correctly), so export needs to
  // convert a stroked shape's outline into its own filled path rather
  // than emitting stroke/stroke-width attributes — including baking in
  // whichever of inside/center/outside placement was chosen here.
  function setShapeFillMode(obj, mode) {
    if (obj.type === 'group') {
      // Each nested shape keeps its own original color as its outline
      // color (there's no single color to apply across a whole imported
      // design), just switching every one of them between fill/stroke.
      eachFillableDescendant(obj, (child) => setShapeFillMode(child, mode));
      return;
    }
    const color = obj.fill || obj.stroke || '#ffffff';
    if (mode === 'stroke') {
      const widthMm = strokeWidthInput ? parseFloat(strokeWidthInput.value) || 0.5 : 0.5;
      obj._strokeWidthPx = widthMm * PX_PER_MM;
      obj.set({ fill: null, stroke: color });
      applyStrokeRender(obj);
    } else {
      obj.set({ fill: color, stroke: null, strokeWidth: 0, clipPath: null });
    }
    obj.setCoords();
  }
  function refreshFillModeUI(obj) {
    const rep = firstFillableDescendant(obj);
    const applicable = !!rep;
    if (fillModeGroup) fillModeGroup.classList.toggle('is-hidden', !applicable);
    if (!applicable) {
      if (strokeSettingsDropdown) strokeSettingsDropdown.classList.remove('is-visible');
      return;
    }
    const mode = shapeFillModeFor(obj);
    fillModeButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.fillMode === mode));
    if (strokeSettingsDropdown) strokeSettingsDropdown.classList.toggle('is-visible', mode === 'stroke');
    if (mode !== 'stroke') return;
    const widthPx = rep._strokeWidthPx || rep.strokeWidth || 0.5 * PX_PER_MM;
    if (strokeWidthInput) strokeWidthInput.value = (widthPx / pxPerUnit()).toFixed(unitDecimals());
    const align = rep.strokeAlign || 'center';
    strokeAlignButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.strokeAlign === align));
  }
  fillModeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj || !fillEligible(obj)) return;
      setShapeFillMode(obj, btn.dataset.fillMode);
      refreshFillModeUI(obj);
      fabricCanvas.requestRenderAll();
      pushHistory();
    });
  });
  strokeAlignButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj || shapeFillModeFor(obj) !== 'stroke') return;
      if (obj.type === 'group') {
        eachFillableDescendant(obj, (child) => { child.strokeAlign = btn.dataset.strokeAlign; });
      } else {
        obj.strokeAlign = btn.dataset.strokeAlign;
      }
      applyStrokeRender(obj);
      refreshFillModeUI(obj);
      fabricCanvas.requestRenderAll();
      pushHistory();
    });
  });

  // ---- Shape edge indicator ----
  // A bright outline, in the same blue family as Fabric's own selection
  // border (just bolder and more saturated, so it reads clearly against
  // either a white shape or the dark canvas), traced exactly along a
  // shape's true nominal path — the boundary the W/H fields measure.
  // Needed because Fabric's own selection handles aren't a reliable
  // stand-in for that anymore: they're sized off the object's actual
  // strokeWidth, which for inside/outside placement is doubled internally
  // (see applyStrokeRender above), so the handles no longer trace the
  // real edge once a shape is in stroke mode. Shown only while a
  // rect/circle/triangle is selected, gone as soon as selection moves
  // elsewhere.
  const EDGE_INDICATOR_COLOR = '#1e90ff';
  let edgeIndicator = null;
  // Positioned by the object's true center point, always under a plain
  // 'center' origin of its own — deliberately ignoring the real object's
  // own left/top/originX/originY. Fabric's non-center origins (the anchor
  // feature) convert between "left/top" and the object's actual center
  // using its own strokeWidth as padding, so copying left/top verbatim
  // onto an indicator with a *different* strokeWidth (it's always thin,
  // while the real shape's is doubled for inside/outside placement) lands
  // it in the wrong place for any anchor but center. Center-origin math
  // has no such padding, so it's immune to that mismatch regardless of
  // either object's strokeWidth.
  function makeEdgeIndicatorFor(obj) {
    const center = obj.getCenterPoint();
    const common = {
      left: center.x, top: center.y, originX: 'center', originY: 'center',
      angle: obj.angle, scaleX: obj.scaleX, scaleY: obj.scaleY,
      fill: null, stroke: EDGE_INDICATOR_COLOR, strokeWidth: 2, strokeUniform: true,
      // A dark halo behind the line so it stays readable even when it
      // crosses a white shape, not just the dark card background.
      shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.65)', blur: 3, offsetX: 0, offsetY: 0 }),
      selectable: false, evented: false, excludeFromExport: true, hoverCursor: 'default',
    };
    let indicator;
    if (obj.type === 'circle') indicator = new fabric.Circle({ ...common, radius: obj.radius });
    else if (obj.type === 'ellipse') indicator = new fabric.Ellipse({ ...common, rx: obj.rx, ry: obj.ry });
    else if (obj.type === 'triangle') indicator = new fabric.Triangle({ ...common, width: obj.width, height: obj.height });
    else if (obj.type === 'polygon' || obj.type === 'polyline') indicator = new fabric.Polygon(obj.points, { ...common });
    else if (obj.type === 'path') indicator = new fabric.Path(pathCommandsToString(obj.path), { ...common, fillRule: obj.fillRule });
    else indicator = new fabric.Rect({ ...common, width: obj.width, height: obj.height });
    const shrink = edgeIndicatorShrinkFor(obj);
    indicator.set({ scaleX: indicator.scaleX * shrink, scaleY: indicator.scaleY * shrink });
    return indicator;
  }
  // When a shape spans the entire card, its true edge sits exactly on
  // the canvas's own pixel boundary — half the indicator's stroke (and
  // its shadow) would fall outside the canvas and get clipped there,
  // leaving a sliver too thin to see (a single canvas pixel, often
  // subpixel on screen at anything under 100% zoom). Shrinking the whole
  // indicator slightly toward its own center — the same trick regardless
  // of shape type, since it's just a uniform scale around a 'center'
  // origin — keeps the full stroke safely inside the card's own bounds
  // no matter where the shape sits, at an inset far too small to notice
  // on any shape that wasn't already touching the edge.
  const INDICATOR_INSET_PX = 1.5;
  function edgeIndicatorShrinkFor(obj) {
    const minDim = Math.max(1, Math.min(obj.getScaledWidth(), obj.getScaledHeight()));
    return Math.max(0, (minDim - INDICATOR_INSET_PX * 2) / minDim);
  }
  function showEdgeIndicatorFor(obj) {
    hideEdgeIndicator();
    edgeIndicator = makeEdgeIndicatorFor(obj);
    fabricCanvas.add(edgeIndicator);
    fabricCanvas.requestRenderAll();
  }
  function hideEdgeIndicator() {
    if (!edgeIndicator) return;
    fabricCanvas.remove(edgeIndicator);
    edgeIndicator = null;
    fabricCanvas.requestRenderAll();
  }
  function syncEdgeIndicator(obj) {
    if (!edgeIndicator) return;
    const center = obj.getCenterPoint();
    const shrink = edgeIndicatorShrinkFor(obj);
    const props = {
      left: center.x, top: center.y, originX: 'center', originY: 'center',
      angle: obj.angle, scaleX: obj.scaleX * shrink, scaleY: obj.scaleY * shrink,
      width: obj.width, height: obj.height,
    };
    if (obj.type === 'circle') props.radius = obj.radius;
    if (obj.type === 'ellipse') {
      props.rx = obj.rx;
      props.ry = obj.ry;
    }
    edgeIndicator.set(props);
    edgeIndicator.setCoords();
  }

  // ---- Grouping ----
  function groupActiveSelection() {
    const active = fabricCanvas.getActiveObject();
    if (!active || active.type !== 'activeSelection') return;
    hideEdgeIndicator();
    suppressHistoryEvents = true;
    const group = active.toGroup();
    suppressHistoryEvents = false;
    applyScalingControlsVisibility(group);
    fabricCanvas.requestRenderAll();
    showObjectToolbarFor(group);
    pushHistory();
  }
  function ungroupActiveObject() {
    const active = fabricCanvas.getActiveObject();
    if (!active || active.type !== 'group') return;
    hideEdgeIndicator();
    suppressHistoryEvents = true;
    active.toActiveSelection();
    suppressHistoryEvents = false;
    fabricCanvas.requestRenderAll();
    hideObjectToolbar();
    pushHistory();
  }

  // ---- Z-order ----
  // Z-order changes don't add or remove any object, so (unlike everything
  // else that touches the layers list) these need their own explicit
  // refresh call.
  function bringActiveToFront() {
    const active = fabricCanvas.getActiveObject();
    if (!active) return;
    fabricCanvas.bringToFront(active);
    fabricCanvas.requestRenderAll();
    refreshLayersList();
    pushHistory();
  }
  function sendActiveToBack() {
    const active = fabricCanvas.getActiveObject();
    if (!active) return;
    fabricCanvas.sendToBack(active);
    fabricCanvas.requestRenderAll();
    refreshLayersList();
    pushHistory();
  }
  // Shared by the Delete keyboard shortcut and the context menu's Delete
  // item — handles a single selected object or a whole multi-selection.
  function deleteActiveObjects() {
    const active = fabricCanvas.getActiveObject();
    if (!active || active.isEditing) return;
    hideEdgeIndicator();
    const objects = active.type === 'activeSelection' ? active.getObjects() : [active];
    // Remove the object(s) BEFORE discarding the selection, not after.
    // discardActiveObject() fires 'selection:cleared' synchronously, which
    // (while editing a member of a group — see selectNestedObject) closes
    // out that session and silently re-absorbs whatever's still on the
    // canvas back into a rebuilt group. Discarding first meant the object
    // was still present at that moment, so it got reabsorbed, and the
    // fabricCanvas.remove() below then found nothing to remove (it was no
    // longer a top-level object) — the object never actually got deleted.
    // Removing first means it's already gone by the time the group
    // reforms, so the rebuild's own filter for missing members correctly
    // leaves it out.
    suppressHistoryEvents = true;
    objects.forEach((o) => fabricCanvas.remove(o));
    fabricCanvas.discardActiveObject();
    suppressHistoryEvents = false;
    fabricCanvas.requestRenderAll();
    hideObjectToolbar();
    pushHistory();
  }

  // ---- Copy / Paste ----
  // In-memory only (no OS clipboard access needed) — stores plain object
  // data via toObject(), the same serialization undo/redo snapshots use,
  // so custom props (cardFinish, etc.) and whole groups round-trip
  // correctly. Re-cloning from that stored data on every paste (rather
  // than cloning the live object once) means the same copy can be pasted
  // repeatedly, each one independent of the others.
  let clipboardObjects = null;
  let pasteOffsetStep = 0;
  const PASTE_OFFSET_PX = 24;
  function copyActiveObjects() {
    const active = fabricCanvas.getActiveObject();
    if (!active || active.isEditing) return;
    const objects = active.type === 'activeSelection' ? active.getObjects() : [active];
    clipboardObjects = objects.map((o) => o.toObject(HISTORY_PROPS));
    pasteOffsetStep = 0;
  }
  function pasteClipboard() {
    if (!clipboardObjects || !clipboardObjects.length) return;
    pasteOffsetStep += 1;
    const offset = PASTE_OFFSET_PX * pasteOffsetStep;
    // Deep-clone the stored data first — enlivenObjects mutates/consumes
    // it in ways that make the stored copy unsafe to reuse a second time
    // otherwise.
    const data = JSON.parse(JSON.stringify(clipboardObjects));
    fabric.util.enlivenObjects(data, (enlivened) => {
      if (!enlivened.length) return;
      suppressHistoryEvents = true;
      enlivened.forEach((obj) => {
        obj.set({ left: (obj.left || 0) + offset, top: (obj.top || 0) + offset });
        obj.setCoords();
        fabricCanvas.add(obj);
      });
      suppressHistoryEvents = false;
      if (enlivened.length === 1) {
        fabricCanvas.setActiveObject(enlivened[0]);
      } else {
        fabricCanvas.setActiveObject(new fabric.ActiveSelection(enlivened, { canvas: fabricCanvas }));
      }
      fabricCanvas.requestRenderAll();
      refreshLayersList();
      pushHistory();
    });
  }

  // ---- Undo / Redo ----
  // Whole-canvas JSON snapshots rather than a diff/command log — simplest
  // way to cover every kind of edit in this file (drags, field commits,
  // fill/stroke/anchor/dash changes, group/union/subtract, delete...)
  // without having to hand-write an inverse for each one. Custom
  // properties that aren't native Fabric ones (strokeAlign, the real
  // stroke width behind inside/outside placement, the line dash choice)
  // are passed to toJSON explicitly so they round-trip too; clipPath and
  // everything else standard already serializes on its own. Helper
  // overlays (the edge indicator, snap guide lines) are excluded
  // automatically since they're marked excludeFromExport.
  const HISTORY_PROPS = [
    'strokeAlign', '_strokeWidthPx', 'lineDashStyle', 'cardFinish', 'cardFinishTexture', 'cardFinishOutline', 'cardFinishAngle',
    '_cornerRadiusPx', '_shapeBaseType', '_triWidth', '_triHeight',
  ];
  const HISTORY_LIMIT = 50;
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  let undoStack = [];
  let redoStack = [];
  let isRestoringHistory = false;
  // Drives the reload/close warning below — true from the first real edit
  // until the next successful Save (or a fresh Import, which itself
  // becomes the new "saved" baseline). Deliberately simple (any edit at
  // all vs. none since the last save) rather than a precise diff against
  // the last-saved snapshot, same tradeoff most web apps make here.
  let hasUnsavedChanges = false;
  // Some single "logical" edits do their work as several separate
  // canvas.add()/remove() calls under the hood (toGroup/toActiveSelection,
  // and this file's own boolean-op/delete helpers removing multiple
  // objects) — each of those fires its own object:added/removed event.
  // Left unguarded, that records a run of broken intermediate snapshots
  // instead of one clean before/after step; the functions that do this
  // set this flag for the duration and call pushHistory() themselves once
  // finished instead.
  let suppressHistoryEvents = false;
  function updateUndoRedoButtons() {
    if (undoBtn) undoBtn.disabled = undoStack.length < 2;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }
  // Declared here, ahead of pushHistory() below, specifically because
  // its very first call happens synchronously during setup (the
  // baseline snapshot, a few lines down) — a `let` referenced before
  // this point in the file would still be in its temporal dead zone and
  // throw, even though pushHistory itself is only actually invoked
  // later. The rest of the front/back side-switching machinery that
  // uses these is further down, unchanged.
  const renderingsBody = document.getElementById('renderings-body');
  const renderModal = document.getElementById('render-modal');
  const renderModalCanvas = document.getElementById('render-modal-canvas');
  const renderModalClose = document.getElementById('render-modal-close');
  let renderModalSide = null;
  let currentSide = 'front';
  const sideHistories = {};
  // Several distinct actions (adding an object, then assigning it a
  // finish, for instance) can each trigger a rendering-preview render in
  // quick succession — since drawing the traced-outline image back in is
  // async (loading a group through Fabric, then decoding the resulting
  // PNG), an earlier call's callback can still be pending when a newer
  // one starts. Without tracking which call is actually the latest per
  // canvas, a stale callback can paint its (now outdated) image on top of
  // a newer call's freshly-drawn background after the fact. Each call
  // (see paintCardPreview below) stamps its own generation number per
  // target canvas; a callback that finds it's no longer current just
  // discards its result. Keyed by canvas element (not side) since the
  // same side's snapshot can paint into both its small thumbnail and the
  // full-size modal at once.
  const renderGenerationByCanvas = new WeakMap();
  // Called after every discrete edit settles (never mid-drag) — see the
  // individual call sites throughout this file. Harmless to call more
  // than once for the same edit: identical-to-the-top-of-stack snapshots
  // are skipped, so a Fabric event and an explicit call for the same
  // action don't create a duplicate undo step.
  function pushHistory() {
    if (isRestoringHistory) return;
    const snapshot = JSON.stringify(fabricCanvas.toJSON(HISTORY_PROPS));
    if (undoStack.length && undoStack[undoStack.length - 1] === snapshot) return;
    hasUnsavedChanges = true;
    undoStack.push(snapshot);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
    renderCardPreview(currentSide);
    updatePriceEstimate();
  }
  function restoreHistorySnapshot(snapshot) {
    isRestoringHistory = true;
    // Whatever's loose from a group-edit session is about to be wiped
    // out by loadFromJSON below anyway — drop it now so the
    // discardActiveObject() cascade below doesn't do the (harmless but
    // pointless) work of re-grouping members that are seconds from being
    // replaced wholesale.
    groupEditSession = null;
    fabricCanvas.discardActiveObject();
    hideEdgeIndicator();
    clearSnapGuides();
    fabricCanvas.loadFromJSON(snapshot, () => {
      fabricCanvas.requestRenderAll();
      isRestoringHistory = false;
      hideObjectToolbar();
      refreshLayersList();
      updateUndoRedoButtons();
      renderCardPreview(currentSide);
      updatePriceEstimate();
    });
  }
  function undo() {
    if (undoStack.length < 2) return;
    redoStack.push(undoStack.pop());
    restoreHistorySnapshot(undoStack[undoStack.length - 1]);
  }
  function redo() {
    if (!redoStack.length) return;
    const snapshot = redoStack.pop();
    undoStack.push(snapshot);
    restoreHistorySnapshot(snapshot);
  }
  if (undoBtn) undoBtn.addEventListener('click', undo);
  if (redoBtn) redoBtn.addEventListener('click', redo);
  // Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z — skipped while actually typing (a
  // text input's own native undo, or Fabric's in-progress text editing,
  // should win instead).
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const active = fabricCanvas.getActiveObject();
      if (active && active.isEditing) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
  });
  // Catches interactive drag/scale/rotate (fires once when the drag
  // ends) plus most add/remove — but not helper overlays, and not the
  // rapid-fire add/remove of a live drag's snap guide lines.
  function isHistoryWorthy(target) {
    if (suppressHistoryEvents) return false;
    return !target || target.evented !== false;
  }
  fabricCanvas.on('object:modified', (opt) => {
    if (isHistoryWorthy(opt.target)) pushHistory();
  });
  fabricCanvas.on('object:added', (opt) => {
    // A shape mid-drag was just added with a placeholder size — skip it,
    // finalizeShape() records the real, settled result as one step once
    // the drag ends.
    if (shapeDraw) return;
    if (isHistoryWorthy(opt.target)) pushHistory();
  });
  fabricCanvas.on('object:removed', (opt) => {
    if (isHistoryWorthy(opt.target)) pushHistory();
  });
  // Baseline snapshot so undo from the very first edit returns to a
  // truly empty card, instead of having nothing before it to land on —
  // not a real edit, so it shouldn't count as "unsaved work" on its own.
  pushHistory();
  hasUnsavedChanges = false;
  // Captured now, before anything real can have been drawn — reused
  // below as the starting content for a side the first time it's ever
  // switched to, since a plain fabricCanvas.clear() wouldn't restore any
  // of Fabric's own baseline canvas state the way loadFromJSON does.
  const blankCanvasSnapshot = JSON.stringify(fabricCanvas.toJSON(HISTORY_PROPS));

  // ---- Front/back side switcher ----
  // Each side is its own design — switching sides swaps in that side's
  // own canvas content (blank the first time) and its own undo/redo
  // history, so an edit made on one side, or an undo, never bleeds into
  // the other. Reuses the exact same whole-canvas-JSON approach as
  // undo/redo above: undoStack/redoStack are the *current* side's
  // history, and switching sides just saves them under the outgoing
  // side's key and swaps in the incoming side's (or a fresh blank one).
  const sidesEl = document.getElementById('editor-sides');
  const addBackBtn = document.getElementById('add-back-side');
  const cardLabel = document.getElementById('editor-card-label');

  function cardSizeLabelText() {
    if (unitSystem === 'in') return `${(86 / MM_PER_IN).toFixed(2)} × ${(54 / MM_PER_IN).toFixed(2)}in`;
    return '86 × 54mm';
  }
  let currentSideName = 'front';
  function setActiveSideUI(sideName) {
    currentSideName = sideName;
    if (sidesEl) {
      sidesEl.querySelectorAll('.editor-side-thumb').forEach((thumb) => {
        thumb.classList.toggle('is-active', thumb.dataset.side === sideName);
      });
    }
    if (cardLabel) {
      const name = sideName === 'front' ? 'Front' : 'Back';
      cardLabel.textContent = `${name} — ${cardSizeLabelText()}`;
    }
  }

  // Swaps in a side's own undo/redo history and restores its content —
  // shared by switchToSide below and by project import, which needs to
  // force-load a side without switchToSide's "already there" early return
  // (import is populating sideHistories itself, not reacting to a click).
  function loadSideAndSwitch(sideName) {
    currentSide = sideName;
    const stored = sideHistories[sideName];
    undoStack = stored ? stored.undo : [blankCanvasSnapshot];
    redoStack = stored ? stored.redo : [];
    setActiveSideUI(sideName);
    restoreHistorySnapshot(undoStack[undoStack.length - 1]);
  }
  function switchToSide(sideName) {
    if (sideName === currentSide) return;
    sideHistories[currentSide] = { undo: undoStack, redo: redoStack };
    loadSideAndSwitch(sideName);
  }

  if (sidesEl) {
    sidesEl.addEventListener('click', (e) => {
      const thumb = e.target.closest('.editor-side-thumb');
      if (thumb) switchToSide(thumb.dataset.side);
    });
  }
  // The card label starts as plain static text in the HTML ("Front", no
  // dimensions) — run the same update used when switching sides once at
  // load so it matches from the start instead of only after the first
  // front/back click.
  setActiveSideUI('front');

  // Creates the "Back" side thumbnail and its renderings-panel card box —
  // shared by the Add Back Side button and project import (which needs a
  // back side to exist in the DOM before it can load content into it, but
  // shouldn't switch to it or touch its content the way a fresh click
  // would). Safe to call more than once — does nothing once both already
  // exist.
  function ensureBackSideUI() {
    if (!document.querySelector('.editor-side-thumb[data-side="back"]')) {
      const backThumb = document.createElement('button');
      backThumb.type = 'button';
      backThumb.className = 'editor-side-thumb';
      backThumb.dataset.side = 'back';
      backThumb.innerHTML = `
        <canvas class="editor-side-thumb-card" width="108" height="68"></canvas>
        <span class="editor-side-thumb-label">Back</span>
      `;
      if (addBackBtn && addBackBtn.isConnected) addBackBtn.replaceWith(backThumb);
      else if (sidesEl) sidesEl.appendChild(backThumb);
    }
    // A back side now exists, so the renderings panel should preview both
    // sides — add a second card box alongside the front one.
    if (renderingsBody && !renderingsBody.querySelector('[data-side="back"]')) {
      const backPreview = document.createElement('canvas');
      backPreview.className = 'editor-renderings-canvas';
      backPreview.dataset.side = 'back';
      backPreview.width = 860;
      backPreview.height = 540;
      renderingsBody.appendChild(backPreview);
    }
  }
  // The other direction from ensureBackSideUI — needed when importing a
  // .plm file that has no back side while the currently open project does:
  // without this, the old Back thumbnail/renderings-panel canvas would
  // just sit there frozen on the previous design until clicked (which
  // forces loadSideAndSwitch to notice sideHistories.back is gone and
  // reload it blank). Re-inserting the original addBackBtn node keeps its
  // already-attached click listener working.
  function removeBackSideUI() {
    const backThumb = document.querySelector('.editor-side-thumb[data-side="back"]');
    if (backThumb) {
      if (addBackBtn) backThumb.replaceWith(addBackBtn);
      else backThumb.remove();
    }
    const backPreview = renderingsBody && renderingsBody.querySelector('.editor-renderings-canvas[data-side="back"]');
    if (backPreview) backPreview.remove();
  }
  if (addBackBtn) {
    addBackBtn.addEventListener('click', () => {
      ensureBackSideUI();
      switchToSide('back');
      renderCardPreview('back');
    });
  }

  // ---- Save to / Import from a local file ----
  // The whole project (both sides' full designs) as one file — not the
  // print-ready SVG export (the Next button's quantity/info/request flow,
  // still unbuilt), just
  // enough to reconstruct the editable project exactly as it was, the
  // same way "Save" and "Open" work in a desktop app.
  //
  // Saved as our own ".plm" format rather than plain ".json": still just
  // JSON underneath (there's no server or license key to actually
  // enforce "only our editor can open this" — see the save-format
  // conversation this came out of), but gzip-compressed into opaque
  // binary behind a small magic-header/version prefix, so double-
  // clicking it or peeking in a text editor shows gibberish instead of a
  // readable, hand-editable design file. That's a deterrent for casual
  // tampering, not real DRM. `PLM_FORMAT_RAW`/`PLM_FORMAT_GZIP` let
  // decodeProjectFile understand either an older/uncompressed save (or a
  // browser without CompressionStream) or a normal gzip one.
  const PLM_MAGIC = 'PLM1';
  const PLM_FORMAT_RAW = 0;
  const PLM_FORMAT_GZIP = 1;
  async function encodeProjectFile(payloadObj) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
    let bodyBytes = jsonBytes;
    let format = PLM_FORMAT_RAW;
    if (typeof CompressionStream !== 'undefined') {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(jsonBytes);
      writer.close();
      bodyBytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
      format = PLM_FORMAT_GZIP;
    }
    const header = new TextEncoder().encode(PLM_MAGIC);
    const out = new Uint8Array(header.length + 1 + bodyBytes.length);
    out.set(header, 0);
    out[header.length] = format;
    out.set(bodyBytes, header.length + 1);
    return out;
  }
  async function decodeProjectFile(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const header = new TextDecoder().decode(bytes.slice(0, PLM_MAGIC.length));
    if (header !== PLM_MAGIC) throw new Error('Not a .plm file');
    const format = bytes[PLM_MAGIC.length];
    const body = bytes.slice(PLM_MAGIC.length + 1);
    let jsonBytes = body;
    if (format === PLM_FORMAT_GZIP) {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser can\'t open compressed .plm files');
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(body);
      writer.close();
      jsonBytes = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(jsonBytes));
  }
  // A small branded "cover" rendering (same wood + aluminum-card look as
  // the Mockup panel) embedded into the saved file as a data URL — not
  // used anywhere yet (there's no custom "Open" file-picker in the
  // editor to show it in), but the file format carries it now so that UI
  // can just read it out later instead of needing a format change.
  const PLM_THUMB_W = 320;
  const PLM_THUMB_H = Math.round(PLM_THUMB_W * (CARD_H_PX / CARD_W_PX) * 1.25);
  function generateCardCoverThumbnail(snapshotJSON) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = PLM_THUMB_W;
      canvas.height = PLM_THUMB_H;
      const ctx = canvas.getContext('2d');
      drawWoodBackground(ctx, canvas.width, canvas.height);
      const rect = drawAluminumCard(ctx, canvas.width, canvas.height, getSelectedCardTypeColor());
      const resolutionScale = rect.w / CARD_W_PX;
      renderStrokeOutlinesToDataURL(snapshotJSON, resolutionScale, (dataUrl) => {
        const img = new Image();
        img.onload = () => {
          ctx.save();
          roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
          ctx.clip();
          ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
          ctx.restore();
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(canvas.toDataURL('image/png'));
        img.src = dataUrl;
      });
    });
  }
  function getSideSnapshotJSON(side) {
    if (side === currentSide) return undoStack[undoStack.length - 1];
    const stored = sideHistories[side];
    return stored ? stored.undo[stored.undo.length - 1] : null;
  }
  function projectHasBackSide() {
    return currentSide === 'back' || !!sideHistories.back || !!document.querySelector('.editor-side-thumb[data-side="back"]');
  }
  // Whether there's anything on the canvas actually worth warning about
  // losing -- checked directly against current content (front side's
  // real object count, or any back side at all) rather than the shape of
  // the undo stack. undoStack.length alone used to gate this (>1 meaning
  // "at least one edit"), but that resets to a fresh 1-entry stack on
  // every import/template load (see importProjectData), so loading a
  // template right after importing a file -- or right after loading a
  // previous template -- would silently skip the warning even though
  // there was a real design sitting on the canvas.
  function projectHasExistingWork() {
    if (projectHasBackSide()) return true;
    try {
      const data = JSON.parse(getSideSnapshotJSON('front') || blankCanvasSnapshot);
      return Array.isArray(data.objects) && data.objects.length > 0;
    } catch (e) {
      return false;
    }
  }
  async function downloadProjectFile(filename) {
    const hasBack = projectHasBackSide();
    const frontJSON = getSideSnapshotJSON('front') || blankCanvasSnapshot;
    const backJSON = hasBack ? (getSideSnapshotJSON('back') || blankCanvasSnapshot) : null;
    const thumbnail = await generateCardCoverThumbnail(frontJSON).catch(() => null);
    const payload = {
      app: 'business-card-editor',
      version: 1,
      currentSide,
      front: JSON.parse(frontJSON),
      back: backJSON ? JSON.parse(backJSON) : null,
      thumbnail,
      cardTypeId: selectedCardTypeId,
    };
    const bytes = await encodeProjectFile(payload);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    hasUnsavedChanges = false;
  }
  // ---- Save As modal ----
  // Most browsers only prompt for a filename/location on download if the
  // user has "ask where to save each file" turned on in their own browser
  // settings — with that off, a plain <a download> save would silently
  // always use the same fixed name. Asking here first means the file
  // always gets the name typed here regardless of that setting.
  const saveBtn = document.getElementById('save-btn');
  const saveAsModal = document.getElementById('save-as-modal');
  const saveAsFilenameInput = document.getElementById('save-as-filename');
  const saveAsCancelBtn = document.getElementById('save-as-modal-cancel');
  const saveAsDoneBtn = document.getElementById('save-as-modal-done');
  function isSaveAsModalOpen() {
    return !!(saveAsModal && saveAsModal.classList.contains('is-open'));
  }
  function openSaveAsModal() {
    if (!saveAsModal) {
      downloadProjectFile('business-card.plm');
      return;
    }
    if (saveAsFilenameInput) saveAsFilenameInput.value = 'business-card';
    saveAsModal.classList.add('is-open');
    saveAsModal.setAttribute('aria-hidden', 'false');
    if (saveAsFilenameInput) {
      saveAsFilenameInput.focus();
      saveAsFilenameInput.select();
    }
  }
  function closeSaveAsModal() {
    if (!saveAsModal) return;
    saveAsModal.classList.remove('is-open');
    saveAsModal.setAttribute('aria-hidden', 'true');
  }
  function commitSaveAsModal() {
    const raw = (saveAsFilenameInput ? saveAsFilenameInput.value : '').trim();
    // Strips characters that aren't valid in a filename on Windows/macOS —
    // typing them wouldn't crash anything, but could silently produce a
    // file the OS itself refuses to save, or a confusingly mangled name.
    const cleaned = (raw || 'business-card').replace(/[\\/:*?"<>|]+/g, '').trim() || 'business-card';
    const filename = /\.plm$/i.test(cleaned) ? cleaned : `${cleaned}.plm`;
    closeSaveAsModal();
    downloadProjectFile(filename);
  }
  if (saveBtn) saveBtn.addEventListener('click', openSaveAsModal);
  if (saveAsCancelBtn) saveAsCancelBtn.addEventListener('click', closeSaveAsModal);
  if (saveAsDoneBtn) saveAsDoneBtn.addEventListener('click', commitSaveAsModal);
  if (saveAsModal) {
    saveAsModal.addEventListener('mousedown', (e) => {
      if (e.target === saveAsModal) closeSaveAsModal();
    });
  }
  if (saveAsFilenameInput) {
    saveAsFilenameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitSaveAsModal();
      }
    });
  }
  const importBtn = document.getElementById('import-btn');
  const importProjectInput = document.getElementById('import-project-input');
  // Replaces the whole project with what's in the file — same as "Open"
  // in a desktop app, not a merge. Undo/redo history resets to just this
  // loaded state, on both sides; there's nothing meaningful to undo back
  // to from a freshly opened file.
  function importProjectData(payload) {
    if (!payload || typeof payload !== 'object' || !payload.front) {
      plmAlert("That file doesn't look like a valid business card design.");
      return;
    }
    groupEditSession = null;
    fabricCanvas.discardActiveObject();
    hideEdgeIndicator();
    clearSnapGuides();
    hideObjectToolbar();
    Object.keys(sideHistories).forEach((key) => delete sideHistories[key]);
    sideHistories.front = { undo: [JSON.stringify(payload.front)], redo: [] };
    if (payload.back) {
      ensureBackSideUI();
      sideHistories.back = { undo: [JSON.stringify(payload.back)], redo: [] };
    } else {
      removeBackSideUI();
    }
    // Only a real saved .plm project carries its own card type — a
    // template load (see buildTemplateCard's own importProjectData call)
    // has no `cardTypeId` key at all, and should leave whatever's
    // currently selected alone rather than resetting it to "none".
    // Setting it before loadSideAndSwitch below means the Mockup re-paint
    // that load triggers already picks up the right color on its first
    // render, not a flash of the old one.
    if (Object.prototype.hasOwnProperty.call(payload, 'cardTypeId')) {
      selectedCardTypeId = payload.cardTypeId;
      updateCardTypeButton();
      updateFinishAvailability();
    }
    const targetSide = payload.currentSide === 'back' && payload.back ? 'back' : 'front';
    loadSideAndSwitch(targetSide);
    // Whichever side just became active gets its preview repainted for
    // free, asynchronously, once restoreHistorySnapshot's loadFromJSON
    // finishes (see loadSideAndSwitch/restoreHistorySnapshot above) — but
    // the *other* side never goes through that path at all, so it has to
    // be rendered explicitly here or its thumbnail/Mockup preview is
    // stuck on stale content until clicked. When the file's active side
    // was Back, that stale side was Front — exactly what was reported.
    renderCardPreview('front');
    if (payload.back) renderCardPreview('back');
    // The just-loaded file is now what's on screen — nothing to warn
    // about losing until it's actually edited again.
    hasUnsavedChanges = false;
  }
  if (importBtn && importProjectInput) {
    importBtn.addEventListener('click', async () => {
      const hasExistingWork = projectHasExistingWork();
      if (hasExistingWork && !(await plmConfirm('Importing a file will replace your current design. Continue?'))) return;
      importProjectInput.value = '';
      importProjectInput.click();
    });
    importProjectInput.addEventListener('change', () => {
      const file = importProjectInput.files && importProjectInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        let payload;
        try {
          payload = await decodeProjectFile(reader.result);
        } catch (err) {
          plmAlert("That file couldn't be read as a business card design.");
          return;
        }
        importProjectData(payload);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // ---- Warn before leaving with unsaved changes ----
  // Browsers ignore any custom text here and show their own fixed wording
  // (a security measure, not something this file can control) — setting
  // returnValue/calling preventDefault is just what actually triggers that
  // built-in "leave site?" prompt at all, for a reload, tab close, or
  // navigating away.
  window.addEventListener('beforeunload', (e) => {
    if (!hasUnsavedChanges) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // ---- Renderings preview ----
  // A rough "what the laser will actually produce" preview per side — a
  // black anodized-aluminum card on a wood backdrop, with each finish
  // eventually drawn as its own real engraving pattern rather than a
  // flat proofing color. Starting with just Stroke: no density involved
  // (it's a traced outline, not a fill), rendered as a near-white line —
  // everything else is left blank for now until its own pattern is
  // built. Real line-density values (mm) will replace RENDER_LINE_WIDTH_MM
  // and friends once provided. Every representative/traced line drawn into
  // the preview — a fixed-width Stroke fallback, texture's hatch, texture's
  // own outline — shares this one width, since the laser cuts the same
  // physical line regardless of which finish it's tracing.
  const RENDER_LINE_WIDTH_MM = 0.08;
  const RENDER_LINE_WIDTH_PX = RENDER_LINE_WIDTH_MM * PX_PER_MM;
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawWoodBackground(ctx, w, h) {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#5a3d26');
    grad.addColorStop(0.5, '#6b4a2e');
    grad.addColorStop(1, '#4a3220');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // A handful of soft, gently curved grain lines rather than a tiled
    // texture — cheap, and reads fine at this small a preview size.
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#2e1d10';
    for (let i = 0; i < 7; i++) {
      const y = (h / 7) * i + h / 14;
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + 10, w * 0.6, y - 10, w, y + 4);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Returns the card's own rect (in preview-canvas px) so the caller can
  // composite the actual engraved artwork into exactly that area. `color`
  // is the anodized aluminum's own base color (see the card-type picker's
  // CARD_TYPES swatches further down) — defaults to the original fixed
  // black so any caller that hasn't been given a selected card type still
  // renders exactly as before.
  function drawAluminumCard(ctx, w, h, color) {
    const margin = Math.min(w, h) * 0.08;
    const cardW = w - margin * 2;
    const cardH = cardW * (CARD_H_PX / CARD_W_PX);
    const rect = { x: margin, y: (h - cardH) / 2, w: cardW, h: cardH, r: cardW * (27 / CARD_W_PX) };

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
    ctx.fillStyle = color || '#0c0c0c';
    ctx.fill();
    ctx.restore();

    // Brushed-aluminum sheen — a soft diagonal highlight band, clipped to
    // the card's own rounded shape.
    ctx.save();
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
    ctx.clip();
    const sheen = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    sheen.addColorStop(0.55, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    return rect;
  }
  // A small standalone rendering of a bare (un-engraved) aluminum blank in
  // a given anodized color — same brushed-metal sheen treatment as
  // drawAluminumCard above (diagonal highlight band + a faint edge
  // stroke), just without the wood backdrop/shadow, since this paints
  // directly into a preview box that already has its own container
  // styling. Used by the card-type picker so each color/thickness swatch
  // reads as an actual rendered card rather than a flat color chip.
  function paintCardTypeSwatch(canvasEl, color) {
    const ctx = canvasEl.getContext('2d');
    const w = canvasEl.width;
    const h = canvasEl.height;
    ctx.clearRect(0, 0, w, h);
    const r = h * (27 / CARD_H_PX);
    roundRectPath(ctx, 0, 0, w, h, r);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.save();
    roundRectPath(ctx, 0, 0, w, h, r);
    ctx.clip();
    const sheen = ctx.createLinearGradient(0, 0, w, h);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.28)');
    sheen.addColorStop(0.55, 'rgba(255,255,255,0.12)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    roundRectPath(ctx, 0, 0, w, h, r);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // Texture density (from the Finish toolbar's slider) is a real physical
  // value — lines per centimeter, cross-hatched at 45 degrees both ways —
  // so spacing converts directly, no representative curve needed here.
  function textureSpacingPx(linesPerCm) {
    const lpc = Math.max(1, linesPerCm || 25);
    const mm = 10 / lpc;
    return mm * PX_PER_MM;
  }
  // Builds a small repeatable tile carrying Texture's cross-hatch, in
  // either of two angles the Finish toolbar's dropdown offers:
  // `crossed === true` (45°, the default) draws both diagonals corner to
  // corner, crossing in an X — repeating that tile is the standard trick
  // for a continuous diagonal hatch, since each tile's line meets its
  // neighbors'. `crossed === 90` instead draws one horizontal and one
  // vertical line through the tile's center, giving a plain square
  // checkerboard grid aligned with the shape's own edges rather than
  // diagonal to them. `crossed === false` (used only by White's own
  // single-direction grain, not Texture) draws just the one "/" diagonal.
  function makeHatchPatternCanvas(tileSizePx, lineColor, lineWidthPx, crossed) {
    const size = Math.max(1, tileSizePx);
    const pc = document.createElement('canvas');
    pc.width = size;
    pc.height = size;
    const pctx = pc.getContext('2d');
    pctx.strokeStyle = lineColor;
    pctx.lineWidth = lineWidthPx;
    pctx.beginPath();
    if (crossed === 90) {
      pctx.moveTo(0, size / 2);
      pctx.lineTo(size, size / 2);
      pctx.moveTo(size / 2, 0);
      pctx.lineTo(size / 2, size);
    } else {
      pctx.moveTo(0, size);
      pctx.lineTo(size, 0);
      if (crossed) {
        pctx.moveTo(0, 0);
        pctx.lineTo(size, size);
      }
    }
    pctx.stroke();
    return pc;
  }
  // Renders just this side's Stroke-finish objects (recursing into
  // groups — each leaf's own cardFinish is authoritative, cascaded there
  // already by the Finish toolbar) onto an offscreen, non-interactive
  // Fabric canvas sized to the card's real px dimensions, restyled to a
  // near-white traced outline with no fill. Everything else is hidden
  // for now. Fabric handles all the real shape/group/transform math —
  // far simpler than re-deriving each shape type's outline path by hand.
  // resolutionScale renders at a higher (or lower) pixel density than the
  // card's native 774x486 — e.g. 2x for the fullscreen modal, which is
  // displayed roughly twice as large as the thumbnail. Without this, the
  // thumbnail's fixed-resolution output gets upscaled to fill the much
  // bigger modal canvas and everything reads soft/blurry. setZoom scales
  // the whole scene through Fabric's own viewport transform, the same
  // mechanism objects/patternTransform already scale through, so stroke
  // widths and hatch spacing stay physically correct at any resolution.
  // The pattern tile's own pixel resolution never changes (always a
  // crisp, fixed HATCH_TILE_SOURCE_PX square) — the real spacing is
  // controlled entirely through patternTransform's scale instead. Sizing
  // the tile bitmap itself to the spacing (the previous approach) rounds
  // to a whole pixel, and every spacing under ~4px (any Texture density
  // past ~22 L/cm, and all of White's fixed 200 L/cm) rounded to the
  // exact same 4px floor — collapsing every one of those densities into
  // an identical, indistinguishable pattern. A fixed-resolution tile
  // scaled by an arbitrary, unrounded factor has no such floor, so it
  // keeps distinguishing densities right down to sub-pixel spacing
  // (visually converging into a near-solid fill as spacing shrinks below
  // the line width, which is physically correct — tightly-packed lines
  // really do read as solid). patternTransform also carries the same
  // avgScale correction as before, canceling out the object's (and its
  // ancestor groups') own accumulated scale.
  //
  // This whole render-styling block used to live only inside
  // renderStrokeOutlinesToDataURL below — it's shared scope now because
  // the price estimate (further down) reuses it too, rendering the exact
  // same pixels the Mockup preview shows rather than recomputing
  // coverage from separate vector geometry.
  const HATCH_TILE_SOURCE_PX = 64;
  function buildHatchFillPattern(obj, linesPerCm, crossed, lineColor) {
    const { scaleX, scaleY } = fabric.util.qrDecompose(obj.calcTransformMatrix());
    const avgScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2 || 1;
    const spacing = textureSpacingPx(linesPerCm);
    const tileScale = spacing / HATCH_TILE_SOURCE_PX;
    const lineWidthInTile = RENDER_LINE_WIDTH_PX / tileScale;
    const patternCanvas = makeHatchPatternCanvas(HATCH_TILE_SOURCE_PX, lineColor || 'rgb(250,250,250)', lineWidthInTile, crossed);
    const pattern = new fabric.Pattern({ source: patternCanvas, repeat: 'repeat' });
    const finalScale = tileScale / avgScale;
    pattern.patternTransform = [finalScale, 0, 0, finalScale, 0, 0];
    return pattern;
  }
  // White's own fixed single-direction grain — a subtle brushed look,
  // distinct at a glance from Frosted White's perfectly flat fill.
  // Reuses the hatch tile mechanics above, just with the tile's own
  // background painted first (so gaps between grain lines show white,
  // not the card underneath) and a low-contrast line color instead of
  // the Texture finish's bright trace lines. The grain line color
  // follows the selected card type's own color (falling back to the
  // original near-black default when none is selected yet) — White
  // finish means "leave the aluminum bare", so the grain should read as
  // that same aluminum's color showing through, not a fixed black/gray
  // regardless of which card is picked.
  //
  // Packed tight (200 L/cm) and barely-there (thin lines, low opacity) —
  // individual lines this close together aren't separately resolvable at
  // a glance, so the whole thing reads as a soft, even brushed sheen
  // rather than a visible hatch.
  const WHITE_GRAIN_LINES_PER_CM = 200;
  // Safari's canvas rasterizer renders very thin, very-low-opacity
  // strokes noticeably fainter than Chrome's does for the identical
  // values (a real, documented cross-engine anti-aliasing difference,
  // not a bug in either) — the grain line below needs more opacity
  // headroom there to actually be visible. `chrome`/`crios`/`android`
  // etc. all include "safari" in their UA too (a legacy compatibility
  // token), so those are explicitly excluded rather than just checking
  // for the word "safari".
  const IS_SAFARI = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
  const WHITE_GRAIN_ALPHA = IS_SAFARI ? 0.05 : 0.03;
  // "#rrggbb" -> "rgba(r,g,b,alpha)", so the grain line can ride at a
  // fixed low opacity over a color that changes per card type.
  function hexToRgba(hex, alpha) {
    const h = (hex || '#0c0c0c').replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function buildWhiteFillPattern(obj) {
    const { scaleX, scaleY } = fabric.util.qrDecompose(obj.calcTransformMatrix());
    const avgScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2 || 1;
    const spacing = textureSpacingPx(WHITE_GRAIN_LINES_PER_CM);
    const tileScale = spacing / HATCH_TILE_SOURCE_PX;
    const lineWidthInTile = (RENDER_LINE_WIDTH_PX * 0.15) / tileScale;
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = HATCH_TILE_SOURCE_PX;
    patternCanvas.height = HATCH_TILE_SOURCE_PX;
    const pctx = patternCanvas.getContext('2d');
    pctx.fillStyle = 'rgb(253,253,253)';
    pctx.fillRect(0, 0, HATCH_TILE_SOURCE_PX, HATCH_TILE_SOURCE_PX);
    // The card's own color, at low opacity — same idea as fading a
    // watermark, so the grain reads as a faint hint of the card's own
    // color rather than a wash toward gray/black. See WHITE_GRAIN_ALPHA
    // above for why this differs by browser.
    pctx.strokeStyle = hexToRgba(getSelectedCardTypeColor(), WHITE_GRAIN_ALPHA);
    pctx.lineWidth = lineWidthInTile;
    pctx.beginPath();
    pctx.moveTo(0, HATCH_TILE_SOURCE_PX);
    pctx.lineTo(HATCH_TILE_SOURCE_PX, 0);
    pctx.stroke();
    const pattern = new fabric.Pattern({ source: patternCanvas, repeat: 'repeat' });
    const finalScale = tileScale / avgScale;
    pattern.patternTransform = [finalScale, 0, 0, finalScale, 0, 0];
    return pattern;
  }
  // A diagonal gunmetal-gray sheen with a few separate highlight bands
  // moving across it, rather than one single clean peak — reads more
  // like brushed metal catching light at a few different points than a
  // polished mirror with one streak. Fixed to the card's own absolute
  // coordinate space (0,0 to CARD_W_PX,CARD_H_PX), not each shape's own
  // bounding box — every Metallic object across the whole card reads
  // this same coordinate space, so styleForRender below can align each
  // one's local coordinates back to it (via gradientTransform) and the
  // whole banded sheen reads as one continuous pattern crossing the
  // card, the same way the aluminum background's own sheen does, rather
  // than a separate disconnected streak per letter.
  function buildMetallicFill() {
    return new fabric.Gradient({
      type: 'linear',
      gradientUnits: 'pixels',
      coords: { x1: 0, y1: 0, x2: CARD_W_PX, y2: CARD_H_PX },
      colorStops: [
        { offset: 0, color: '#35373a' },
        { offset: 0.08, color: '#4c4f52' },
        { offset: 0.16, color: '#6e7174' },
        { offset: 0.21, color: '#9a9d9f' },
        { offset: 0.26, color: '#6e7174' },
        { offset: 0.34, color: '#505356' },
        { offset: 0.42, color: '#6c6f72' },
        { offset: 0.49, color: '#d8d9da' },
        { offset: 0.54, color: '#f2f2f2' },
        { offset: 0.59, color: '#c2c3c5' },
        { offset: 0.66, color: '#6c6f72' },
        { offset: 0.73, color: '#454749' },
        { offset: 0.8, color: '#7d8083' },
        { offset: 0.85, color: '#a3a5a7' },
        { offset: 0.9, color: '#6e7174' },
        { offset: 0.96, color: '#4c4f52' },
        { offset: 1, color: '#35373a' },
      ],
    });
  }
  function styleForRender(obj) {
    // NOTE: this used to force obj.objectCaching = false here, as a
    // speculative fix for a "line goes missing when enlarged" report
    // that a synthetic test was never actually able to reproduce.
    // Disabling caching turned out to have a real, confirmed cost
    // instead: small, thin, densely-packed shapes (e.g. Diamond
    // Lattice's repeated diamond pattern) render as broken/speckled
    // noise at small preview sizes without it — Fabric's own per-object
    // cache is what smooths that out. Reverted; if the original missing-
    // line report resurfaces, reproduce it first before reaching for
    // this again.
    if (obj.type === 'group') {
      obj.getObjects().forEach(styleForRender);
      return;
    }
    const finish = getFinish(obj);
    if (finish === 'metallic') {
      const fill = buildMetallicFill();
      // The gradient's own coords are in absolute card space, but Fabric
      // paints a fill in the object's local (pre-transform) space — so
      // without correction, each object would still just show its own
      // little 0..CARD_W_PX-sized slice of the gradient starting at its
      // own local origin, not the slice that actually belongs at its
      // real position on the card. Canceling out the object's full
      // transform (including any parent group, which calcTransformMatrix
      // already accounts for) via its inverse as the gradient's own
      // transform makes the two compose back to identity, so the
      // gradient ends up reading in true card-absolute coordinates
      // regardless of this object's own position/scale/rotation — every
      // Metallic object on the card ends up sampling the exact same
      // underlying gradient at the exact same real spot.
      fill.gradientTransform = fabric.util.invertTransform(obj.calcTransformMatrix());
      obj.set({ fill, stroke: null, opacity: 1 });
      return;
    }
    if (finish === 'texture') {
      // Outline traces the shape's own edge on top of the hatch fill —
      // deliberately overriding strokeWidth (obj's real one is the
      // Outline checkbox's own editor-visibility width, wider than the
      // shared render line width) so every line in this preview reads
      // as the same physical thickness, texture hatch included.
      obj.set({
        fill: buildHatchFillPattern(obj, obj.cardFinishTexture, obj.cardFinishAngle === 90 ? 90 : true),
        stroke: obj.cardFinishOutline ? 'rgb(250,250,250)' : null,
        strokeWidth: RENDER_LINE_WIDTH_PX,
        strokeUniform: true,
        opacity: 1,
      });
      return;
    }
    if (finish === 'white') {
      // A fine brushed grain, not a flat fill — subtle enough to still
      // read as plain white, but gives Frosted White (the perfectly
      // smooth, brighter finish) an obvious step up rather than the
      // two looking identical.
      obj.set({ fill: buildWhiteFillPattern(obj), stroke: null, opacity: 1 });
      return;
    }
    if (finish === 'frosted-white') {
      // The brightest, fully smooth finish — plain full white, no line
      // texture at all.
      obj.set({ fill: '#ffffff', stroke: null, opacity: 1 });
      return;
    }
    if (finish !== 'stroke') {
      obj.set({ opacity: 0 });
      return;
    }
    // A real laser always cuts the same fine hairline regardless of
    // whatever width a source SVG's stroke happened to be authored
    // at (a vector "stroke-width" is a screen-display concept, not
    // a kerf width) — so every Stroke-finish shape traces at the
    // same representative line width here, not its own real one.
    obj.set({ fill: null, stroke: 'rgb(250,250,250)', strokeWidth: RENDER_LINE_WIDTH_PX, strokeUniform: true, opacity: 1 });
  }
  function renderStrokeOutlinesToDataURL(snapshotJson, resolutionScale, callback) {
    const off = document.createElement('canvas');
    off.width = Math.round(CARD_W_PX * resolutionScale);
    off.height = Math.round(CARD_H_PX * resolutionScale);
    const staticCanvas = new fabric.StaticCanvas(off);
    staticCanvas.setZoom(resolutionScale);
    staticCanvas.loadFromJSON(snapshotJson, () => {
      staticCanvas.getObjects().forEach((obj) => {
        // Snapshots store pasteboard-absolute coordinates; this canvas
        // is sized to just the card, so shift back to card-relative.
        obj.set({ left: obj.left - CARD_OFFSET_X, top: obj.top - CARD_OFFSET_Y });
        obj.setCoords();
        styleForRender(obj);
      });
      staticCanvas.renderAll();
      callback(staticCanvas.toDataURL({ format: 'png' }));
      staticCanvas.dispose();
    });
  }
  // Paints one full preview (wood backdrop, aluminum card, traced artwork)
  // into whichever canvas element is passed in — the small thumbnail, the
  // full-size modal view, or both, at whatever resolution that particular
  // canvas happens to be. See renderGenerationByCanvas above for why the
  // async callback re-checks staleness per canvas rather than per side.
  function paintCardPreview(canvasEl, snapshot) {
    const myGeneration = (renderGenerationByCanvas.get(canvasEl) || 0) + 1;
    renderGenerationByCanvas.set(canvasEl, myGeneration);
    const ctx = canvasEl.getContext('2d');
    const w = canvasEl.width;
    const h = canvasEl.height;
    ctx.clearRect(0, 0, w, h);
    drawWoodBackground(ctx, w, h);
    const rect = drawAluminumCard(ctx, w, h, getSelectedCardTypeColor());
    const resolutionScale = rect.w / CARD_W_PX;
    renderStrokeOutlinesToDataURL(snapshot, resolutionScale, (dataUrl) => {
      if (renderGenerationByCanvas.get(canvasEl) !== myGeneration) return;
      const img = new Image();
      img.onload = () => {
        if (renderGenerationByCanvas.get(canvasEl) !== myGeneration) return;
        ctx.save();
        roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
        ctx.clip();
        ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
      };
      img.src = dataUrl;
    });
  }
  function renderCardPreview(side) {
    const snapshot = side === currentSide
      ? undoStack[undoStack.length - 1]
      : (sideHistories[side] ? sideHistories[side].undo[sideHistories[side].undo.length - 1] : blankCanvasSnapshot);
    const canvasEl = renderingsBody && renderingsBody.querySelector(`.editor-renderings-canvas[data-side="${side}"]`);
    if (canvasEl) {
      paintCardPreview(canvasEl, snapshot);
      // Keep the fullscreen modal live too, if it's open and showing this
      // same side, so an edit made without closing it doesn't go stale.
      if (renderModal && renderModal.classList.contains('is-open') && renderModalSide === side) {
        paintCardPreview(renderModalCanvas, snapshot);
      }
    }
    // Front/Back thumbnails down in the bottom bar get the same live
    // preview, just tiny.
    const thumbCanvas = document.querySelector(`.editor-side-thumb[data-side="${side}"] .editor-side-thumb-card`);
    if (thumbCanvas) paintCardPreview(thumbCanvas, snapshot);
  }
  renderCardPreview('front');

  // ---- Fullscreen renderings modal ----
  // Clicking a thumbnail preview opens the same rendering, redrawn at a
  // much larger fixed resolution so it stays crisp blown up to fill most
  // of the screen, rather than just CSS-stretching the small canvas.
  // (Element lookups and renderModalSide live earlier, alongside
  // renderingsBody — paintCardPreview/renderCardPreview above reference
  // them, and those run before this point in the file.)
  function openRenderModal(side) {
    if (!renderModal || !renderModalCanvas) return;
    renderModalSide = side;
    renderModal.classList.add('is-open');
    renderModal.setAttribute('aria-hidden', 'false');
    renderCardPreview(side);
  }
  function closeRenderModal() {
    if (!renderModal) return;
    renderModal.classList.remove('is-open');
    renderModal.setAttribute('aria-hidden', 'true');
    renderModalSide = null;
  }
  if (renderingsBody) {
    renderingsBody.addEventListener('click', (e) => {
      const canvasEl = e.target.closest('.editor-renderings-canvas');
      if (!canvasEl) return;
      openRenderModal(canvasEl.dataset.side);
    });
  }
  if (renderModalClose) renderModalClose.addEventListener('click', closeRenderModal);
  if (renderModal) {
    renderModal.addEventListener('mousedown', (e) => {
      if (e.target === renderModal) closeRenderModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && renderModal && renderModal.classList.contains('is-open')) closeRenderModal();
  });

  // ---- Boolean shape operations (Union / Subtract) ----
  // PolyBool's default epsilon (1e-10) assumes near-integer input; ours is
  // built from trig and Bezier-flattening arithmetic on canvas-pixel-scale
  // coordinates (hundreds of units), where that's tighter than floating
  // point rounding itself — enough near-but-not-quite-identical points
  // trip its "zero-length segment" guard on any real, curve-heavy SVG
  // import. A looser epsilon, still far below anything visually
  // meaningful, avoids that without affecting simple shapes.
  if (typeof PolyBool !== 'undefined' && PolyBool.epsilon) PolyBool.epsilon(1e-4);
  // Approximates each source object as a flat polygon in absolute canvas
  // coordinates, runs it through PolyBool (loaded via CDN — see
  // card-editor.html) and rebuilds the result as a single fabric.Path.
  // Line has no fillable area of its own, so it's represented as the thin
  // rectangle its stroke actually renders as. A Group (manual, or an
  // imported SVG) is eligible too — its children are flattened into one
  // combined set of regions, recursively, so an imported design can be
  // unioned/subtracted as a whole. Text has no polygon data of its own
  // either — this uses the real font file's own glyph curves when one is
  // available (see exactTextOutlineRingsFor/getOpentypeFontFor), and
  // falls back to tracing its own rendered pixels otherwise (see
  // tracedTextOutlineRingsFor) — a browser only ever hands a page the
  // actual font file bytes for a locally-installed font that the user
  // explicitly loaded via "Load system fonts" (Local Font Access API,
  // Chrome/Edge only); every other font (the default list, or any font
  // in Safari/Firefox) can only ever be traced.
  const BOOLEAN_ELIGIBLE_TYPES = ['rect', 'circle', 'ellipse', 'triangle', 'path', 'polygon', 'polyline', 'line', 'group', 'i-text'];
  // ---- Text -> outline rings (for Union/Subtract) ----
  // There's no font-outline parser here, so instead of real glyph curves
  // this rasterizes the text using the same canvas 2D text renderer that
  // draws it on screen (so multi-line layout, alignment, and font all
  // match what's visible), then traces the antialiased shape into
  // polygon rings: Moore-neighbor boundary tracing per foreground blob
  // for the outer contour of each glyph, plus the same tracing applied to
  // any fully-enclosed background pocket (found by flood-filling in from
  // the raster's own edges and taking whatever's left unreached) for
  // letter counters like the hole in "e"/"o"/"8". Rendered at several
  // pixels per local unit and then Douglas-Peucker-simplified and
  // Chaikin-smoothed, which turns the raw pixel-grid staircase into a
  // reasonably smooth curve without needing real glyph math. Known
  // limitations, both acceptable for a "turn this into a shape so it can
  // be combined" action rather than a typographic tool: per-character
  // style overrides aren't reflected (one font/weight/style for the
  // whole object, matching how these templates actually use text), and
  // letter-spacing (charSpacing) isn't applied.
  const TEXT_OUTLINE_SUPERSAMPLE = 6; // raster px per local unit
  const TEXT_OUTLINE_SIMPLIFY_EPS = TEXT_OUTLINE_SUPERSAMPLE * 0.6;
  // Deliberately just 1 pass, not 2+: each Chaikin pass doubles the point
  // count, and a densely-pointed evenodd path (like a Union/Subtract
  // result with a letter-shaped hole) renders visibly warped wherever the
  // Mockup preview's texture finish applies its hatch pattern as a
  // fabric.Pattern fill — confirmed by comparing rendered output at 0/1/2
  // iterations at real preview resolution; a plain solid fill of the same
  // path never showed it, so it's specific to pattern-fill rendering of
  // a dense point cloud, not the traced geometry itself. 1 iteration
  // still rounds off the pixel-grid staircase without tripping this.
  const TEXT_OUTLINE_SMOOTH_ITERATIONS = 1;
  const TEXT_OUTLINE_DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  function rasterizeTextMask(obj) {
    const scale = TEXT_OUTLINE_SUPERSAMPLE;
    const w = Math.max(2, Math.round(obj.width * scale));
    const h = Math.max(2, Math.round(obj.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';
    const weight = obj.fontWeight && obj.fontWeight !== 'normal' ? `${obj.fontWeight} ` : '';
    const style = obj.fontStyle === 'italic' ? 'italic ' : '';
    ctx.font = `${style}${weight}${obj.fontSize * scale}px ${obj.fontFamily || 'Arial'}`;
    ctx.textAlign = obj.textAlign === 'right' ? 'right' : (obj.textAlign === 'center' ? 'center' : 'left');
    const lines = String(obj.text || '').split('\n');
    const lineHeightPx = h / Math.max(1, lines.length);
    lines.forEach((line, i) => {
      const x = ctx.textAlign === 'center' ? w / 2 : (ctx.textAlign === 'right' ? w : 0);
      ctx.fillText(line, x, lineHeightPx * i + lineHeightPx * 0.8);
    });
    const { data } = ctx.getImageData(0, 0, w, h);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 128 ? 1 : 0;
    return { mask, w, h };
  }
  // Traces one closed boundary starting at (sx,sy) — a pixel where
  // `inside` first becomes true when scanning a row left-to-right — by
  // walking its 8-neighborhood clockwise, always resuming the scan just
  // past the direction it arrived from. Works identically for an outer
  // glyph edge (inside = ink) and a hole edge (inside = enclosed
  // background), so the same function traces both.
  function traceOutlineBoundary(inside, w, h, sx, sy) {
    const points = [];
    let cx = sx;
    let cy = sy;
    let enterDir = 0;
    const first = [cx, cy];
    let guard = 0;
    while (guard++ < w * h * 2 + 8) {
      points.push([cx, cy]);
      const backDir = (enterDir + 4) % 8;
      let found = null;
      let foundDir = null;
      for (let k = 1; k <= 8; k++) {
        const dIdx = (backDir + k) % 8;
        const [dx, dy] = TEXT_OUTLINE_DIRS[dIdx];
        const nx = cx + dx;
        const ny = cy + dy;
        if (inside(nx, ny)) {
          found = [nx, ny];
          foundDir = dIdx;
          break;
        }
      }
      if (!found) break;
      [cx, cy] = found;
      enterDir = foundDir;
      if (cx === first[0] && cy === first[1]) break;
    }
    return points;
  }
  function floodFillPred(w, h, sx, sy, pred, visited) {
    const stack = [[sx, sy]];
    visited[sy * w + sx] = 1;
    while (stack.length) {
      const [x, y] = stack.pop();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const idx = ny * w + nx;
        if (visited[idx] || !pred(nx, ny)) return;
        visited[idx] = 1;
        stack.push([nx, ny]);
      });
    }
  }
  // Standard Ramer-Douglas-Peucker simplification of an open point chain.
  function simplifyPoints(points, eps) {
    if (points.length < 3) return points;
    function rdp(pts) {
      let dmax = 0;
      let idx = 0;
      const [x1, y1] = pts[0];
      const [x2, y2] = pts[pts.length - 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      for (let i = 1; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i];
        const d = Math.abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / len;
        if (d > dmax) { dmax = d; idx = i; }
      }
      if (dmax > eps) {
        const left = rdp(pts.slice(0, idx + 1));
        const right = rdp(pts.slice(idx));
        return left.slice(0, -1).concat(right);
      }
      return [pts[0], pts[pts.length - 1]];
    }
    return rdp(points);
  }
  // Chaikin corner-cutting on a closed ring — rounds the pixel-grid
  // staircase left over from tracing into a smooth curve.
  function smoothRing(points, iterations) {
    let pts = points;
    for (let it = 0; it < iterations; it++) {
      const next = [];
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % n];
        next.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
        next.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
      }
      pts = next;
    }
    return pts;
  }
  // Full pipeline: rasterize -> trace every glyph's outer contour and
  // every enclosed counter (hole) -> simplify -> smooth -> convert from
  // raster-pixel space into the same object-local, origin-centered
  // coordinate space every other shape in localPolygonsFor below uses.
  // This is the fallback path — an approximation from pixels, used
  // whenever real glyph curves aren't available (see
  // exactTextOutlineRingsFor/getOpentypeFontFor below for when they are).
  function tracedTextOutlineRingsFor(obj) {
    const { mask, w, h } = rasterizeTextMask(obj);
    const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
    const fgVisited = new Uint8Array(w * h);
    const outerRings = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (get(x, y) === 1 && get(x - 1, y) === 0 && !fgVisited[y * w + x]) {
          outerRings.push(traceOutlineBoundary((nx, ny) => get(nx, ny) === 1, w, h, x, y));
          floodFillPred(w, h, x, y, (nx, ny) => get(nx, ny) === 1, fgVisited);
        }
      }
    }
    const outsideVisited = new Uint8Array(w * h);
    const isBg = (x, y) => get(x, y) === 0;
    for (let x = 0; x < w; x++) {
      if (isBg(x, 0) && !outsideVisited[x]) floodFillPred(w, h, x, 0, isBg, outsideVisited);
      if (isBg(x, h - 1) && !outsideVisited[(h - 1) * w + x]) floodFillPred(w, h, x, h - 1, isBg, outsideVisited);
    }
    for (let y = 0; y < h; y++) {
      if (isBg(0, y) && !outsideVisited[y * w]) floodFillPred(w, h, 0, y, isBg, outsideVisited);
      if (isBg(w - 1, y) && !outsideVisited[y * w + w - 1]) floodFillPred(w, h, w - 1, y, isBg, outsideVisited);
    }
    const isHole = (x, y) => get(x, y) === 0 && !outsideVisited[y * w + x];
    const holeVisited = new Uint8Array(w * h);
    const holeRings = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isHole(x, y) && !isHole(x - 1, y) && !holeVisited[y * w + x]) {
          holeRings.push(traceOutlineBoundary(isHole, w, h, x, y));
          floodFillPred(w, h, x, y, isHole, holeVisited);
        }
      }
    }
    const toLocal = (ring) => smoothRing(simplifyPoints(ring, TEXT_OUTLINE_SIMPLIFY_EPS), TEXT_OUTLINE_SMOOTH_ITERATIONS)
      .map(([px, py]) => [px / TEXT_OUTLINE_SUPERSAMPLE - obj.width / 2, py / TEXT_OUTLINE_SUPERSAMPLE - obj.height / 2]);
    return outerRings.map(toLocal).concat(holeRings.map(toLocal));
  }
  // ---- Text -> outline rings, exact path (real font file available) ----
  // The Local Font Access API (see "Load system fonts" below) can hand
  // back the actual font file bytes for a locally-installed font, not
  // just permission to display it — opentype.js (CDN, see
  // card-editor.html) parses those bytes and returns real glyph curves
  // straight from the font's own outline data. When that's available,
  // this replaces the raster-trace approximation above with exact
  // bezier curves, reusing the same cubic/quadratic flattening already
  // used for imported SVG paths (pushCubicBezier/pushQuadraticBezier
  // below) so the output is a normal set of polygon rings PolyBool can
  // consume, just like every other shape. This can't cover bold/italic
  // run-in mid-string (one font file = one style) or per-character
  // style overrides — the same limitation the traced fallback has.
  function ringsFromOpentypePath(path) {
    const rings = [];
    let current = null;
    let cx = 0;
    let cy = 0;
    path.commands.forEach((cmd) => {
      if (cmd.type === 'M') {
        current = [];
        rings.push(current);
        cx = cmd.x; cy = cmd.y;
        current.push([cx, cy]);
      } else if (cmd.type === 'L' && current) {
        cx = cmd.x; cy = cmd.y;
        current.push([cx, cy]);
      } else if (cmd.type === 'C' && current) {
        pushCubicBezier(current, [cx, cy], [cmd.x1, cmd.y1], [cmd.x2, cmd.y2], [cmd.x, cmd.y]);
        cx = cmd.x; cy = cmd.y;
      } else if (cmd.type === 'Q' && current) {
        pushQuadraticBezier(current, [cx, cy], [cmd.x1, cmd.y1], [cmd.x, cmd.y]);
        cx = cmd.x; cy = cmd.y;
      }
    });
    return rings;
  }
  function exactTextOutlineRingsFor(obj, otFont) {
    const fontSize = obj.fontSize;
    const lines = String(obj.text || '').split('\n');
    const lineHeightPx = obj.height / Math.max(1, lines.length);
    const align = obj.textAlign === 'right' ? 'right' : (obj.textAlign === 'center' ? 'center' : 'left');
    let rings = [];
    lines.forEach((line, i) => {
      if (!line) return;
      const advance = otFont.getAdvanceWidth(line, fontSize);
      let x = 0;
      if (align === 'center') x = (obj.width - advance) / 2;
      else if (align === 'right') x = obj.width - advance;
      const baselineY = lineHeightPx * i + lineHeightPx * 0.8;
      rings = rings.concat(ringsFromOpentypePath(otFont.getPath(line, x, baselineY, fontSize)));
    });
    return rings.map((ring) => ring.map(([x, y]) => [x - obj.width / 2, y - obj.height / 2]));
  }
  // Single entry point localPolygonsFor calls for any i-text object.
  // `otFont`, when present, is an already-resolved opentype.Font — see
  // getOpentypeFontFor/resolveTextFonts below for how callers get one
  // (it requires an async font-file fetch, so it's always resolved
  // ahead of time, never inside this synchronous function). Falls back
  // to the raster trace if there's no real font, or if the exact path
  // throws for some reason (e.g. a character the font doesn't cover).
  function textOutlineRingsFor(obj, otFont) {
    if (otFont) {
      try {
        return exactTextOutlineRingsFor(obj, otFont);
      } catch (err) {
        console.warn('Exact font outline failed, falling back to traced approximation:', err);
      }
    }
    return tracedTextOutlineRingsFor(obj);
  }
  // ---- Local font file access (for exact text outlines above) ----
  // Populated by the "Load system fonts" button below, which is the only
  // moment this page has permission to ask for real font files rather
  // than just display names. Keyed by family, since a family can have
  // several installed styles (Regular/Bold/Italic/...) each as its own
  // FontData with its own real file.
  const localFontDataByFamily = new Map();
  // FontData -> Promise<opentype.Font|null>, so the same font file is
  // only ever fetched and parsed once no matter how many text objects
  // or repeated Union/Subtract calls use it.
  const parsedOpentypeFontCache = new Map();
  function pickBestFontData(family, weight, style) {
    const candidates = localFontDataByFamily.get(family);
    if (!candidates || !candidates.length) return null;
    const wantBold = weight === 'bold' || (typeof weight === 'number' && weight >= 600) || parseInt(weight, 10) >= 600;
    const wantItalic = style === 'italic';
    const match = candidates.find((f) => {
      const s = (f.style || '').toLowerCase();
      return Boolean(wantBold) === s.includes('bold') && Boolean(wantItalic) === s.includes('italic');
    });
    return match || candidates.find((f) => (f.style || '').toLowerCase() === 'regular') || candidates[0];
  }
  async function getOpentypeFontFor(obj) {
    if (typeof opentype === 'undefined') return null;
    const fontData = pickBestFontData(obj.fontFamily, obj.fontWeight, obj.fontStyle);
    if (!fontData) return null;
    if (parsedOpentypeFontCache.has(fontData)) return parsedOpentypeFontCache.get(fontData);
    const promise = (async () => {
      try {
        const blob = await fontData.blob();
        const buffer = await blob.arrayBuffer();
        return opentype.parse(buffer);
      } catch (err) {
        console.warn('Could not read local font file, falling back to traced outline:', err);
        return null;
      }
    })();
    parsedOpentypeFontCache.set(fontData, promise);
    return promise;
  }
  // Every i-text object anywhere in the selection, including nested
  // inside a group — mirrors how absolutePolygonsFor recurses into
  // groups below, so nothing gets missed just because it's grouped.
  function collectTextObjects(objs) {
    const result = [];
    objs.forEach((o) => {
      if (o.type === 'i-text') result.push(o);
      else if (o.type === 'group') result.push(...collectTextObjects(o.getObjects()));
    });
    return result;
  }
  // Resolves an opentype.Font for every text object in the selection up
  // front (the only async step in the whole Union/Subtract pipeline),
  // returning a plain Map the rest of the — synchronous — pipeline reads
  // from instead of ever awaiting anything itself.
  async function resolveTextFonts(objs) {
    const textObjs = collectTextObjects(objs);
    const fontCache = new Map();
    await Promise.all(textObjs.map(async (obj) => {
      fontCache.set(obj, await getOpentypeFontFor(obj));
    }));
    return fontCache;
  }
  const CIRCLE_APPROXIMATION_SEGMENTS = 90;
  const CURVE_APPROXIMATION_SEGMENTS = 16;
  function pushCubicBezier(out, p0, p1, p2, p3) {
    for (let i = 1; i <= CURVE_APPROXIMATION_SEGMENTS; i++) {
      const t = i / CURVE_APPROXIMATION_SEGMENTS;
      const mt = 1 - t;
      out.push([
        mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
        mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
  }
  function pushQuadraticBezier(out, p0, p1, p2) {
    for (let i = 1; i <= CURVE_APPROXIMATION_SEGMENTS; i++) {
      const t = i / CURVE_APPROXIMATION_SEGMENTS;
      const mt = 1 - t;
      out.push([
        mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
        mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
      ]);
    }
  }
  function localPolygonsFor(obj, fontCache) {
    if (obj.type === 'i-text') {
      return textOutlineRingsFor(obj, fontCache && fontCache.get(obj));
    }
    if (obj.type === 'circle') {
      const pts = [];
      for (let i = 0; i < CIRCLE_APPROXIMATION_SEGMENTS; i++) {
        const theta = (i / CIRCLE_APPROXIMATION_SEGMENTS) * Math.PI * 2;
        pts.push([obj.radius * Math.cos(theta), obj.radius * Math.sin(theta)]);
      }
      return [pts];
    }
    if (obj.type === 'ellipse') {
      const pts = [];
      for (let i = 0; i < CIRCLE_APPROXIMATION_SEGMENTS; i++) {
        const theta = (i / CIRCLE_APPROXIMATION_SEGMENTS) * Math.PI * 2;
        pts.push([obj.rx * Math.cos(theta), obj.ry * Math.sin(theta)]);
      }
      return [pts];
    }
    if (obj.type === 'triangle') {
      const w = obj.width / 2;
      const h = obj.height / 2;
      return [[[-w, h], [0, -h], [w, h]]];
    }
    if (obj.type === 'polygon' || obj.type === 'polyline') {
      // Same pathOffset convention as Path below — Fabric centers a
      // Polygon/Polyline's own local origin the same way.
      const offsetX = obj.pathOffset.x;
      const offsetY = obj.pathOffset.y;
      return [obj.points.map((p) => [p.x - offsetX, p.y - offsetY])];
    }
    if (obj.type === 'path') {
      // A Path built by this same feature is straight-line-only (M/L/Z
      // commands), but an imported SVG's paths commonly have curves too —
      // both are handled here by flattening any C/Q segment into short
      // line segments. Fabric renders each point offset by -pathOffset,
      // i.e. pathOffset is where local (0,0) falls in the raw command
      // coordinates, so subtracting it recovers local space.
      const offsetX = obj.pathOffset.x;
      const offsetY = obj.pathOffset.y;
      const rings = [];
      let current = null;
      let cx = 0;
      let cy = 0;
      obj.path.forEach((cmd) => {
        const type = cmd[0];
        if (type === 'M') {
          current = [];
          rings.push(current);
          cx = cmd[1] - offsetX;
          cy = cmd[2] - offsetY;
          current.push([cx, cy]);
        } else if (type === 'L' && current) {
          cx = cmd[1] - offsetX;
          cy = cmd[2] - offsetY;
          current.push([cx, cy]);
        } else if (type === 'C' && current) {
          const p1 = [cmd[1] - offsetX, cmd[2] - offsetY];
          const p2 = [cmd[3] - offsetX, cmd[4] - offsetY];
          const p3 = [cmd[5] - offsetX, cmd[6] - offsetY];
          pushCubicBezier(current, [cx, cy], p1, p2, p3);
          [cx, cy] = p3;
        } else if (type === 'Q' && current) {
          const p1 = [cmd[1] - offsetX, cmd[2] - offsetY];
          const p2 = [cmd[3] - offsetX, cmd[4] - offsetY];
          pushQuadraticBezier(current, [cx, cy], p1, p2);
          [cx, cy] = p2;
        }
      });
      return rings;
    }
    if (obj.type === 'line') {
      // Fabric draws a Line symmetric about the object's own center, half
      // the (x1,y1)-(x2,y2) span each direction — reproduced locally here,
      // then thickened into the rectangle its stroke actually renders as
      // (a bare segment has no area of its own to union/subtract).
      const x1 = (obj.x1 - obj.x2) / 2;
      const y1 = (obj.y1 - obj.y2) / 2;
      const x2 = (obj.x2 - obj.x1) / 2;
      const y2 = (obj.y2 - obj.y1) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const hw = (obj.strokeWidth || 1) / 2;
      const nx = (-dy / len) * hw;
      const ny = (dx / len) * hw;
      return [[[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]];
    }
    // rect (default)
    const w = obj.width / 2;
    const h = obj.height / 2;
    return [[[-w, -h], [w, -h], [w, h], [-w, h]]];
  }
  // Real-world SVGs (especially text outlines) often carry degenerate
  // sub-paths — a moveto with no segments after it, or a curve flattened
  // into coincident points — which PolyBool rejects outright as a
  // zero-length segment. Drop points that don't move, and any ring left
  // too short to bound an area.
  function sanitizeRing(ring) {
    const out = [];
    ring.forEach((p) => {
      const last = out[out.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
    });
    if (out.length > 1) {
      const first = out[0];
      const last = out[out.length - 1];
      if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) out.pop();
    }
    return out;
  }
  // A Group's children carry their own transform matrix already composed
  // with their parent's (Fabric bakes that in via calcTransformMatrix), so
  // each child's absolute polygons can be computed independently and just
  // concatenated — recursing naturally handles nested groups too.
  function absolutePolygonsFor(obj, fontCache) {
    if (obj.type === 'group') {
      return obj.getObjects().flatMap((child) => absolutePolygonsFor(child, fontCache));
    }
    const matrix = obj.calcTransformMatrix();
    return localPolygonsFor(obj, fontCache)
      .map(sanitizeRing)
      .filter((ring) => ring.length >= 3)
      .map((ring) => ring.map(([x, y]) => {
        const p = fabric.util.transformPoint({ x, y }, matrix);
        return [p.x, p.y];
      }));
  }
  function polyBoolInputFor(obj, fontCache) {
    return { regions: absolutePolygonsFor(obj, fontCache), inverted: false };
  }
  function pathDataFromRegions(regions) {
    return regions.map((ring) => {
      if (!ring.length) return '';
      const [first, ...rest] = ring;
      return `M ${first[0]} ${first[1]} ${rest.map((p) => `L ${p[0]} ${p[1]}`).join(' ')} Z`;
    }).join(' ');
  }
  // Replaces the given source objects with one new Path tracing the given
  // regions, carrying over the style (fill/stroke/placement) of
  // styleSource so the result keeps working with the fill/stroke toolbar
  // like any other shape. Takes the lowest source object's z-position so
  // the result doesn't jump to the front of unrelated objects.
  function replaceWithBooleanResult(sourceObjects, regions, styleSource) {
    const canvasObjects = fabricCanvas.getObjects();
    const insertIndex = Math.min(...sourceObjects.map((o) => canvasObjects.indexOf(o)));
    // A Line has no real fill (Fabric gives every object a default black
    // fill even though Line's own rendering ignores it) — once turned
    // into a filled ribbon polygon, that inert default would suddenly
    // render as solid black. Use its stroke color as the result's fill
    // instead, with no extra stroke on top of the already-outlined shape.
    // A Group has no fill/stroke of its own either — borrow whichever of
    // its nested shapes the fill/stroke toolbar would already treat as
    // the representative one.
    let style = styleSource;
    if (styleSource.type === 'line') {
      style = {
        fill: styleSource.stroke, stroke: null, strokeWidth: 0,
        cardFinish: styleSource.cardFinish, cardFinishTexture: styleSource.cardFinishTexture,
        cardFinishOutline: styleSource.cardFinishOutline, cardFinishAngle: styleSource.cardFinishAngle,
      };
    } else if (styleSource.type === 'group') {
      style = firstFillableDescendant(styleSource) || { fill: '#000000', stroke: null, strokeWidth: 0 };
    }
    const path = new fabric.Path(pathDataFromRegions(regions), {
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      fillRule: 'evenodd',
    });
    path.strokeAlign = style.strokeAlign;
    path._strokeWidthPx = style._strokeWidthPx;
    // Carries the finish along too (fill/stroke above already match it,
    // same as any other property copied from styleSource) — otherwise
    // the merged shape would silently read back as White/default the
    // next time it's selected, even though it's still colored as
    // whatever finish it actually has.
    path.cardFinish = style.cardFinish;
    path.cardFinishTexture = style.cardFinishTexture;
    path.cardFinishOutline = style.cardFinishOutline;
    path.cardFinishAngle = style.cardFinishAngle;
    fabricCanvas.discardActiveObject();
    suppressHistoryEvents = true;
    sourceObjects.forEach((o) => fabricCanvas.remove(o));
    fabricCanvas.add(path);
    suppressHistoryEvents = false;
    fabricCanvas.moveTo(path, Math.min(insertIndex, fabricCanvas.getObjects().length - 1));
    applyStrokeRender(path);
    finalizeShape(path);
  }
  // Union folds left-to-right through the whole selection (2+ objects),
  // so it isn't limited to exactly two — the resulting appearance is the
  // front-most source object's.
  // A very complex import (dozens of nested/overlapping sub-paths, as
  // real-world logos with text outlines often are) can trip PolyBool's
  // own sweep-line algorithm regardless of epsilon tuning — nothing to
  // recover from geometrically, so just fail loudly instead of silently
  // (a console-only throw) or leaving the canvas half-changed. Nothing
  // has been mutated yet at the point this can throw in either function.
  async function runUnion() {
    const active = fabricCanvas.getActiveObject();
    if (!active) return;
    const selected = active.type === 'activeSelection' ? active.getObjects() : [active];
    const ordered = fabricCanvas.getObjects().filter((o) => selected.includes(o) && BOOLEAN_ELIGIBLE_TYPES.includes(o.type));
    if (ordered.length < 2) return;
    const fontCache = await resolveTextFonts(ordered);
    let result;
    try {
      result = polyBoolInputFor(ordered[0], fontCache);
      for (let i = 1; i < ordered.length; i++) {
        result = PolyBool.union(result, polyBoolInputFor(ordered[i], fontCache));
      }
    } catch (e) {
      plmAlert('Could not combine these shapes — the artwork is too complex for Union to resolve.');
      return;
    }
    if (!result.regions.length) return;
    replaceWithBooleanResult(ordered, result.regions, ordered[ordered.length - 1]);
  }
  // Subtract needs exactly two objects: the front (top) one's overlap is
  // removed from the back (bottom) one, which is what's left afterward
  // (keeping the bottom object's appearance).
  async function runSubtract() {
    const active = fabricCanvas.getActiveObject();
    if (!active || active.type !== 'activeSelection') return;
    const selected = active.getObjects();
    const ordered = fabricCanvas.getObjects().filter((o) => selected.includes(o) && BOOLEAN_ELIGIBLE_TYPES.includes(o.type));
    if (ordered.length !== 2) return;
    const [bottom, top] = ordered;
    const fontCache = await resolveTextFonts(ordered);
    let result;
    try {
      result = PolyBool.difference(polyBoolInputFor(bottom, fontCache), polyBoolInputFor(top, fontCache));
    } catch (e) {
      plmAlert('Could not subtract these shapes — the artwork is too complex for Subtract to resolve.');
      return;
    }
    if (!result.regions.length) {
      // The top shape fully covered the bottom one — nothing left of it.
      fabricCanvas.discardActiveObject();
      suppressHistoryEvents = true;
      ordered.forEach((o) => fabricCanvas.remove(o));
      suppressHistoryEvents = false;
      fabricCanvas.requestRenderAll();
      hideObjectToolbar();
      pushHistory();
      return;
    }
    replaceWithBooleanResult(ordered, result.regions, bottom);
  }

  // ---- Live price estimate (surface-area based) ----
  // Approximates shop cost from whatever's actually on the card, reusing
  // the same geometry-flattening machinery as Boolean Union/Subtract
  // above (localPolygonsFor et al.) to measure real engraved ink area
  // instead of bounding boxes. Cost constants (PRICING_*, FINISH_TIME_WEIGHT)
  // live near the top of the file, alongside PX_PER_MM — they're needed by
  // the very first pushHistory() call during setup, well before this point.
  function textureTimeWeight(linesPerCm) {
    const clamped = Math.max(10, Math.min(50, linesPerCm || 25));
    const t = (clamped - 10) / (50 - 10);
    return 0.5 + t * (0.7 - 0.5);
  }
  function finishTimeWeightFor(obj) {
    const finish = getFinish(obj);
    if (finish === 'texture') return textureTimeWeight(obj.cardFinishTexture);
    return FINISH_TIME_WEIGHT[finish] || 0;
  }
  // Coverage now comes straight from the same rendered pixels the Mockup
  // preview shows, rather than a separately-computed vector area — reads
  // the alpha channel (not brightness/color) since a real laser either
  // engraves a pixel or doesn't, and alpha stays 1 across a whole shape
  // even where a finish's own look (Metallic's shine gradient, for
  // instance) happens to render dark there. A part-covered edge pixel
  // from anti-aliasing contributes its fractional alpha rather than an
  // all-or-nothing count, so edges/curves measure accurately too. This
  // sidesteps the geometry bugs a hand-rolled vector-area calculation is
  // prone to (a filled-vs-stroked mixup was exactly that kind of bug) —
  // if the render is right, the price is right, because they're reading
  // the same source of truth.
  //
  // Only one finish can be isolated at a time (rendering everything at
  // once loses which pixel belongs to which finish, and different
  // finishes take different real engrave time per mm^2), so this makes
  // one full render pass per distinct finish/density actually present —
  // e.g. two Texture objects at different densities are two separate
  // passes, each with its own correct time weight.
  function finishGroupKeyFor(obj) {
    const finish = getFinish(obj);
    if (finish === 'texture') return `texture:${obj.cardFinishTexture || 25}`;
    return finish;
  }
  function finishGroupWeight(key) {
    if (key.indexOf('texture:') === 0) return textureTimeWeight(parseFloat(key.slice(8)));
    return FINISH_TIME_WEIGHT[key] || 0;
  }
  function collectFinishGroupKeys(objects, keys) {
    objects.forEach((obj) => {
      if (obj.excludeFromExport) return;
      if (obj.type === 'group') { collectFinishGroupKeys(obj.getObjects(), keys); return; }
      keys.add(finishGroupKeyFor(obj));
    });
  }
  // Same per-finish styling as the real render (styleForRender), plus:
  // anything not matching this pass's target finish/density is forced
  // invisible, so only that one group's pixels end up lit.
  function styleForRenderIsolated(obj, targetKey) {
    if (obj.type === 'group') {
      obj.getObjects().forEach((o) => styleForRenderIsolated(o, targetKey));
      return;
    }
    styleForRender(obj);
    if (finishGroupKeyFor(obj) !== targetKey) obj.set({ opacity: 0 });
  }
  // Weighted "ink" area for one side's snapshot, in native (both-sides-
  // denominator) px^2 — one offscreen render pass per finish/density
  // group present, each measured by summing that pass's alpha channel
  // (self-canceling back down from the render's own resolution).
  function weightedCoveragePx2ForSnapshot(snapshotJson, callback) {
    if (!snapshotJson) { callback(0); return; }
    const off = document.createElement('canvas');
    off.width = Math.round(CARD_W_PX * COVERAGE_RESOLUTION_SCALE);
    off.height = Math.round(CARD_H_PX * COVERAGE_RESOLUTION_SCALE);
    // Retina scaling would silently double (or more) the canvas's actual
    // backing-store pixel dimensions on a high-DPI display, throwing off
    // every pixel-count math below by that factor squared — off entirely
    // so off.width/off.height stay exactly what's set above.
    const staticCanvas = new fabric.StaticCanvas(off, { enableRetinaScaling: false });
    staticCanvas.setZoom(COVERAGE_RESOLUTION_SCALE);
    staticCanvas.loadFromJSON(snapshotJson, () => {
      const ctx = off.getContext('2d');
      const objects = staticCanvas.getObjects();
      objects.forEach((obj) => {
        obj.set({ left: obj.left - CARD_OFFSET_X, top: obj.top - CARD_OFFSET_Y });
        obj.setCoords();
      });
      const keys = new Set();
      collectFinishGroupKeys(objects, keys);
      let weightedPx2 = 0;
      keys.forEach((key) => {
        const weight = finishGroupWeight(key);
        if (!weight) return; // "Don't engrave" and the like never light a pixel
        objects.forEach((obj) => styleForRenderIsolated(obj, key));
        staticCanvas.renderAll();
        const { data } = ctx.getImageData(0, 0, off.width, off.height);
        let alphaSum = 0;
        for (let i = 3; i < data.length; i += 4) alphaSum += data[i];
        weightedPx2 += (alphaSum / 255) * weight;
      });
      staticCanvas.dispose();
      // Back down from this render's resolution to native card px^2.
      callback(weightedPx2 / (COVERAGE_RESOLUTION_SCALE * COVERAGE_RESOLUTION_SCALE));
    });
  }
  function snapshotForSide(side) {
    if (side === currentSide) return undoStack[undoStack.length - 1];
    return sideHistories[side] ? sideHistories[side].undo[sideHistories[side].undo.length - 1] : null;
  }
  // A snapshot with zero real objects — excludeFromExport helpers (edge
  // indicator, snap guides) never make it into the saved JSON in the
  // first place, so any object present here is real content.
  function snapshotHasObjects(snapshotJson) {
    if (!snapshotJson) return false;
    try {
      const parsed = JSON.parse(snapshotJson);
      return !!(parsed.objects && parsed.objects.length);
    } catch (e) {
      return false;
    }
  }
  function safeZoneBoundsPx() {
    return {
      left: CARD_OFFSET_X + SAFE_ZONE_INSET_PX,
      top: CARD_OFFSET_Y + SAFE_ZONE_INSET_PX,
      right: CARD_OFFSET_X + CARD_W_PX - SAFE_ZONE_INSET_PX,
      bottom: CARD_OFFSET_Y + CARD_H_PX - SAFE_ZONE_INSET_PX,
    };
  }
  // A tiny epsilon so an object landing exactly on the safe-zone line
  // (a common, deliberate "align to safe zone" outcome) doesn't flag as
  // overflowing due to sub-pixel float rounding.
  function objectExceedsSafeZone(obj, bounds) {
    const box = obj.getBoundingRect(true, true);
    const EPS = 0.5;
    return box.left < bounds.left - EPS
      || box.top < bounds.top - EPS
      || box.left + box.width > bounds.right + EPS
      || box.top + box.height > bounds.bottom + EPS;
  }
  // Mirrors computeDirectCostForCurrentDesign's own "check both sides"
  // shape — a snapshot's objects are enlivened into real (but detached,
  // never added to any canvas) Fabric instances purely to read their
  // bounding boxes, same trick pasteClipboard uses elsewhere in this
  // file. Group bounding rects already account for all their members, so
  // there's no need to recurse into group contents separately.
  function checkSafeZoneOverflow(callback) {
    const bounds = safeZoneBoundsPx();
    function checkSide(side, cb) {
      const snap = snapshotForSide(side);
      if (!snapshotHasObjects(snap)) {
        cb(false);
        return;
      }
      const parsed = JSON.parse(snap);
      const data = JSON.parse(JSON.stringify(parsed.objects));
      fabric.util.enlivenObjects(data, (enlivened) => {
        cb(enlivened.some((o) => objectExceedsSafeZone(o, bounds)));
      });
    }
    checkSide('front', (frontOver) => {
      checkSide('back', (backOver) => {
        callback(frontOver || backOver);
      });
    });
  }
  // Shared by the toolbar's live /100 estimate and the Next modal's
  // per-quantity pricing — both need this same weighted-coverage-based
  // direct cost, just multiplied by a different markup afterward.
  // `callback(null)` when there's nothing on either side to price yet.
  function computeDirectCostForCurrentDesign(callback) {
    const frontSnapshot = snapshotForSide('front');
    const backSnapshot = snapshotForSide('back');
    if (!snapshotHasObjects(frontSnapshot) && !snapshotHasObjects(backSnapshot)) {
      callback(null);
      return;
    }
    weightedCoveragePx2ForSnapshot(frontSnapshot, (frontWeighted) => {
      weightedCoveragePx2ForSnapshot(backSnapshot, (backWeighted) => {
        const totalWeightedPx2 = frontWeighted + backWeighted;
        const totalCardAreaPx2 = CARD_W_PX * CARD_H_PX * 2; // both sides, always
        const weightedPct = (totalWeightedPx2 / totalCardAreaPx2) * 100;
        callback(PRICING_FIXED_COST + PRICING_VARIABLE_COST_PER_PCT * weightedPct);
      });
    });
  }
  function updatePriceEstimate() {
    const priceEl = document.getElementById('editor-price');
    if (!priceEl) return;
    const warningEl = document.getElementById('editor-safe-zone-warning');
    if (warningEl) {
      checkSafeZoneOverflow((overflows) => {
        warningEl.hidden = !overflows;
      });
    }
    computeDirectCostForCurrentDesign((directCost) => {
      if (directCost === null) {
        priceEl.innerHTML = 'Estimated Price: n/a';
        return;
      }
      const pricePerCard = directCost * PRICING_QTY100_MARKUP;
      priceEl.innerHTML = `Estimated Price: $${pricePerCard.toFixed(2)} ea. <span class="editor-price-qty">/100</span>`;
    });
  }

  // ---- Next modal (quantity + pricing + request-a-quote) ----
  // Opened by the top bar's Next button — an overlay on top of the
  // editor, not a page navigation, so closing it (×, clicking outside,
  // or Escape) always returns to the design exactly as it was. The form
  // half reuses the exact same field names and Worker endpoint as the
  // marketing site's own #rfq-form (index.html/script.js) — same
  // framework, just submitted from inside the editor with the design's
  // own quantity/price context folded into the message and both sides'
  // renderings auto-attached alongside whatever reference files the
  // customer adds themselves.
  const RFQ_ENDPOINT = 'https://plm-rfq.precisionlasermark.workers.dev';
  const nextBtn = document.getElementById('next-btn');
  const nextModal = document.getElementById('next-modal');
  const nextModalClose = document.getElementById('next-modal-close');
  const nextModalCanvasFront = document.getElementById('next-modal-canvas-front');
  const nextModalCanvasBack = document.getElementById('next-modal-canvas-back');
  const nextModalQuantity = document.getElementById('next-modal-quantity');
  const nextModalSummary = document.getElementById('next-modal-summary');
  const nextModalCardTypeSwatch = document.getElementById('next-modal-cardtype-swatch');
  const nextModalCardTypeLabel = document.getElementById('next-modal-cardtype-label');
  const nextModalForm = document.getElementById('next-modal-rfq-form');
  const nextModalStatus = document.getElementById('next-modal-status');
  const nextModalRequestBtn = document.getElementById('next-modal-request');
  // Cached from the most recent computeDirectCostForCurrentDesign call
  // this modal triggered, so switching the quantity dropdown re-prices
  // instantly instead of re-running the coverage render on every change.
  let nextModalDirectCost = null;
  function updateNextModalSummary() {
    if (!nextModalQuantity || !nextModalSummary) return;
    const qty = parseInt(nextModalQuantity.value, 10) || 0;
    const cardTypeEntry = (window.CARD_TYPES || []).find((t) => t.id === selectedCardTypeId);
    const totalColor = cardTypeEntry ? NEXT_MODAL_TOTAL_COLORS[cardTypeEntry.color] : null;
    if (nextModalDirectCost === null || !qty) {
      nextModalSummary.textContent = 'Estimated total: n/a';
      return;
    }
    const pricing = getNextModalPricing(nextModalDirectCost, qty);
    const rest = pricing.isMinCharge
      ? `$${pricing.total.toFixed(2)} min charge (${qty} cards)`
      : `$${pricing.total.toFixed(2)} (${qty} × $${pricing.each.toFixed(2)} ea.)`;
    nextModalSummary.innerHTML = totalColor
      ? `Estimated total: <span style="color:${totalColor}">${rest}</span>`
      : `Estimated total: ${rest}`;
  }
  function populateNextModalQuantityOptions() {
    if (!nextModalQuantity) return;
    const previousValue = nextModalQuantity.value;
    nextModalQuantity.innerHTML = '';
    PRICING_QTY_OPTIONS.forEach((qty) => {
      const option = document.createElement('option');
      option.value = String(qty);
      const pricing = nextModalDirectCost === null ? null : getNextModalPricing(nextModalDirectCost, qty);
      option.textContent = !pricing
        ? `${qty}`
        : pricing.isMinCharge
          ? `${qty} — $${pricing.total.toFixed(2)} min charge`
          : `${qty} — $${pricing.each.toFixed(2)} ea. — $${pricing.total.toFixed(2)} total`;
      nextModalQuantity.appendChild(option);
    });
    // Keep whatever was selected across a re-price (design edited while
    // the modal happened to already be open) rather than always
    // snapping back to the first option. On a genuinely fresh open
    // (previousValue is '') a plain <select> would otherwise default to
    // PRICING_QTY_OPTIONS[0] (10) just because it's listed first --
    // 100 is the more realistic starting quantity for most orders.
    if (previousValue && PRICING_QTY_OPTIONS.some((q) => String(q) === previousValue)) {
      nextModalQuantity.value = previousValue;
    } else if (PRICING_QTY_OPTIONS.includes(100)) {
      nextModalQuantity.value = '100';
    }
  }
  function updateNextModalCardType() {
    if (!nextModalCardTypeLabel) return;
    const entry = (window.CARD_TYPES || []).find((t) => t.id === selectedCardTypeId);
    if (!entry) {
      nextModalCardTypeLabel.textContent = 'Card type: none selected';
      if (nextModalCardTypeSwatch) nextModalCardTypeSwatch.style.background = '#3a3a3a';
      return;
    }
    nextModalCardTypeLabel.textContent = `Card type: ${entry.color} · ${entry.thicknessIn} (${entry.thicknessMm})`;
    if (nextModalCardTypeSwatch) nextModalCardTypeSwatch.style.background = entry.swatch;
  }
  function openNextModal() {
    if (!nextModal) return;
    nextModal.classList.add('is-open');
    nextModal.setAttribute('aria-hidden', 'false');
    updateNextModalCardType();
    const hasBack = projectHasBackSide();
    if (nextModalCanvasFront) paintCardPreview(nextModalCanvasFront, snapshotForSide('front') || blankCanvasSnapshot);
    if (nextModalCanvasBack) {
      nextModalCanvasBack.classList.toggle('is-hidden', !hasBack);
      if (hasBack) paintCardPreview(nextModalCanvasBack, snapshotForSide('back') || blankCanvasSnapshot);
    }
    populateNextModalQuantityOptions();
    updateNextModalSummary();
    computeDirectCostForCurrentDesign((directCost) => {
      nextModalDirectCost = directCost;
      populateNextModalQuantityOptions();
      updateNextModalSummary();
    });
  }
  function closeNextModal() {
    if (!nextModal) return;
    nextModal.classList.remove('is-open');
    nextModal.setAttribute('aria-hidden', 'true');
  }
  if (nextBtn) nextBtn.addEventListener('click', openNextModal);
  if (nextModalClose) nextModalClose.addEventListener('click', closeNextModal);
  if (nextModal) {
    nextModal.addEventListener('mousedown', (e) => {
      if (e.target === nextModal) closeNextModal();
    });
  }
  if (nextModalQuantity) nextModalQuantity.addEventListener('change', updateNextModalSummary);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nextModal && nextModal.classList.contains('is-open')) closeNextModal();
  });

  // ---- RFQ success modal ----
  // Replaces the Next modal entirely once a request actually goes through
  // — closing that one and opening this one, rather than just swapping
  // the status text in place, so it reads as "the request is done, here's
  // what to do next" instead of a small inline confirmation easy to miss.
  const rfqSuccessModal = document.getElementById('rfq-success-modal');
  const rfqSuccessEditorBtn = document.getElementById('rfq-success-editor-btn');
  const rfqSuccessSaveBtn = document.getElementById('rfq-success-save-btn');
  const rfqSuccessHomeBtn = document.getElementById('rfq-success-home-btn');
  function closeRfqSuccessModal() {
    if (!rfqSuccessModal) return;
    rfqSuccessModal.classList.remove('is-open');
    rfqSuccessModal.setAttribute('aria-hidden', 'true');
  }
  function showRfqSuccessModal() {
    closeNextModal();
    if (!rfqSuccessModal) return;
    // Waits out the Next modal's own close transition (0.2s, see
    // .editor-modal-overlay) before opening this one, rather than both
    // firing in the same tick — popping a second modal in on top of the
    // first one still visibly fading out read as an abrupt, jarring cut.
    setTimeout(() => {
      // Re-triggers the checkmark's draw-on animation every time this
      // modal opens, not just the first — restarting a CSS animation
      // needs the element actually removed from the document and
      // reinserted (a class toggle alone is a no-op the second time
      // around).
      const check = rfqSuccessModal.querySelector('.editor-rfq-success-check');
      if (check) {
        const parent = check.parentNode;
        const next = check.nextSibling;
        parent.removeChild(check);
        // eslint-disable-next-line no-unused-expressions
        check.offsetWidth; // force layout so the reinsertion below is a genuine restart, not coalesced with the removal
        parent.insertBefore(check, next);
      }
      rfqSuccessModal.classList.add('is-open');
      rfqSuccessModal.setAttribute('aria-hidden', 'false');
    }, 300);
  }
  // Does exactly what it says and nothing else — the design already sits
  // untouched on the canvas underneath both modals the whole time, so
  // "going back" is just closing this one.
  if (rfqSuccessEditorBtn) rfqSuccessEditorBtn.addEventListener('click', closeRfqSuccessModal);
  // Same real save flow as the top bar's own Save button — a named
  // .plm download, not a placeholder.
  if (rfqSuccessSaveBtn) {
    rfqSuccessSaveBtn.addEventListener('click', () => {
      closeRfqSuccessModal();
      openSaveAsModal();
    });
  }
  // A real navigation, not a placeholder — leaves the editor (and, if
  // there's anything unsaved, still trips the existing beforeunload
  // warning first, same as any other way of leaving this page).
  if (rfqSuccessHomeBtn) {
    rfqSuccessHomeBtn.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }
  if (rfqSuccessModal) {
    rfqSuccessModal.addEventListener('mousedown', (e) => {
      if (e.target === rfqSuccessModal) closeRfqSuccessModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && rfqSuccessModal && rfqSuccessModal.classList.contains('is-open')) closeRfqSuccessModal();
  });

  // Wraps HTMLCanvasElement#toBlob (callback-based) in a Promise so the
  // two renderings can be awaited alongside the fetch call below.
  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
  }
  function canvasToDataURL(canvas) {
    return canvas.toDataURL('image/png');
  }

  // ---- RFQ file bundle (mockup, proofing canvas, SVGs, order info) ----
  // Built for every real request the Next modal sends — see
  // buildRfqFileBundle/sendRealRfqRequest further down.
  // Same wood+aluminum+artwork look as the Mockup panel (paintCardPreview),
  // just resolved as a Promise instead of writing straight to a live
  // canvas element, so a batch of these can be awaited in sequence.
  function renderMockupCanvasAsync(canvasEl, snapshot) {
    return new Promise((resolve) => {
      const ctx = canvasEl.getContext('2d');
      const w = canvasEl.width;
      const h = canvasEl.height;
      ctx.clearRect(0, 0, w, h);
      drawWoodBackground(ctx, w, h);
      const rect = drawAluminumCard(ctx, w, h, getSelectedCardTypeColor());
      const resolutionScale = rect.w / CARD_W_PX;
      renderStrokeOutlinesToDataURL(snapshot, resolutionScale, (dataUrl) => {
        const img = new Image();
        img.onload = () => {
          ctx.save();
          roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
          ctx.clip();
          ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
          ctx.restore();
          resolve();
        };
        img.onerror = () => resolve();
        img.src = dataUrl;
      });
    });
  }
  // Unlike styleForRender (built for the photoreal mockup, where every
  // engraved line reads as bright metal against the card), this keeps
  // each finish's own proofing color from FINISH_COLORS — the exact
  // color-coding already used live while editing — so the color legend
  // stays meaningful. The one addition: Texture gets its real hatch
  // pattern (at its real L/cm density and angle) instead of a flat fill,
  // since "shows texture density" is the whole point of this file.
  // Everything else already carries the right proofing fill/stroke
  // straight from the snapshot, untouched.
  function styleForProofingRender(obj) {
    if (obj.type === 'group') {
      obj.getObjects().forEach(styleForProofingRender);
      return;
    }
    if (getFinish(obj) !== 'texture') return;
    const color = obj.cardFinishOutline ? FINISH_COLORS['texture-outline'] : FINISH_COLORS.texture;
    obj.set({
      fill: buildHatchFillPattern(obj, obj.cardFinishTexture, obj.cardFinishAngle === 90 ? 90 : true, color),
      stroke: obj.cardFinishOutline ? color : null,
      strokeWidth: RENDER_LINE_WIDTH_PX,
      strokeUniform: true,
      opacity: 1,
    });
  }
  // Renders one side's proofing view at the given pixel size, returning
  // the offscreen canvas it painted into (so the caller can composite
  // front/back together) rather than a data URL.
  function renderProofingCanvasAsync(width, height, snapshotJson) {
    return new Promise((resolve) => {
      const off = document.createElement('canvas');
      off.width = width;
      off.height = height;
      // Retina scaling would silently double (or more) this canvas's own
      // backing-store pixel dimensions on a high-DPI display, while
      // getWidth()/getHeight() keep reporting the logical (unscaled)
      // size — so the later drawImage(proofFront, 0, 0) that composites
      // this into the final stacked PNG (drawn without an explicit
      // destination size, so it paints at the SOURCE's native pixel
      // size) would only show the top-left quarter of the actual design,
      // cropping the rest. Off entirely, same reasoning as
      // weightedCoveragePx2ForSnapshot's own offscreen canvas.
      const staticCanvas = new fabric.StaticCanvas(off, { backgroundColor: '#202020', enableRetinaScaling: false });
      staticCanvas.setZoom(width / CARD_W_PX);
      staticCanvas.loadFromJSON(snapshotJson, () => {
        staticCanvas.getObjects().forEach((obj) => {
          obj.set({ left: obj.left - CARD_OFFSET_X, top: obj.top - CARD_OFFSET_Y });
          obj.setCoords();
          styleForProofingRender(obj);
        });
        staticCanvas.renderAll();
        drawSafeZoneAndBorder(off, width, height);
        drawTextureDensityLabels(off, staticCanvas);
        resolve(off);
      });
    });
  }
  // Same card outline + dashed safe-zone inset the editor itself always
  // shows (see .editor-card/.editor-safe-zone in card-editor.css) — drawn
  // straight onto the 2D context after Fabric's own render, so this
  // reads as "what you see in the editor" rather than just the bare
  // artwork. `width` is assumed to be the card's own full width in
  // pixels, so the scale factor back to real mm (PX_PER_MM) is just
  // width / CARD_W_PX, the same resolutionScale used everywhere else.
  function drawSafeZoneAndBorder(canvasEl, width, height) {
    const ctx = canvasEl.getContext('2d');
    const scale = width / CARD_W_PX;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, 0.75, 0.75, width - 1.5, height - 1.5, 27 * scale);
    ctx.stroke();
    const inset = 9 * scale;
    ctx.strokeStyle = '#ff3b3b';
    ctx.setLineDash([20 * scale, 12 * scale]);
    roundRectPath(ctx, inset, inset, width - inset * 2, height - inset * 2, 27 * scale);
    ctx.stroke();
    ctx.restore();
  }
  // "N L/cm" next to every Texture-finish object — the color alone
  // (from styleForProofingRender's real hatch pattern) shows *that*
  // something's textured and roughly how dense, but not the exact
  // number, which the shop needs. getCenterPoint()/viewportTransform
  // together resolve each object's true position even nested inside a
  // group and even with the static canvas's own zoom applied — plain
  // obj.left/top wouldn't account for either.
  function drawTextureDensityLabels(canvasEl, staticCanvas) {
    const ctx = canvasEl.getContext('2d');
    ctx.save();
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    function labelOne(obj) {
      if (obj.type === 'group') {
        obj.getObjects().forEach(labelOne);
        return;
      }
      if (getFinish(obj) !== 'texture' || !obj.cardFinishTexture) return;
      const center = fabric.util.transformPoint(obj.getCenterPoint(), staticCanvas.viewportTransform);
      const text = `${obj.cardFinishTexture} L/cm`;
      const metrics = ctx.measureText(text);
      const padX = 4;
      const boxW = metrics.width + padX * 2;
      const boxH = 16;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(center.x - boxW / 2, center.y - boxH / 2, boxW, boxH);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, center.x, center.y + 1);
    }
    staticCanvas.getObjects().forEach(labelOne);
    ctx.restore();
  }
  // The editor's own top/left mm rulers (see buildRuler) plus a
  // "Front — 86 × 54mm"-style label under the card, drawn into the
  // margin reserved around each side's card image — same major-every-
  // 10mm/minor-every-2mm convention as the real ruler, just on a canvas
  // instead of DOM ticks.
  function drawRulerAndLabel(ctx, marginLeft, marginTop, cardW, cardH, scale, sideLabel) {
    const pxPerMm = PX_PER_MM * scale;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '10px monospace';
    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let mm = 0; mm <= 86; mm += 2) {
      const x = marginLeft + mm * pxPerMm;
      const isMajor = mm % 10 === 0;
      const tickLen = isMajor ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(x, marginTop - tickLen);
      ctx.lineTo(x, marginTop);
      ctx.stroke();
      if (isMajor) ctx.fillText(String(mm), x, marginTop - tickLen - 2);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let mm = 0; mm <= 54; mm += 2) {
      const y = marginTop + mm * pxPerMm;
      const isMajor = mm % 10 === 0;
      const tickLen = isMajor ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(marginLeft - tickLen, y);
      ctx.lineTo(marginLeft, y);
      ctx.stroke();
      if (isMajor) ctx.fillText(String(mm), marginLeft - tickLen - 4, y);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '11px monospace';
    ctx.fillText(`${sideLabel} — 86 × 54mm`, marginLeft, marginTop + cardH + 8);
    ctx.restore();
  }
  // Real Fabric vector output (StaticCanvas#toSVG) plus two extra shapes
  // marking the physical card's own cut outline: a solid dark background
  // rect (behind everything, so White-finish — and any other light-
  // colored — artwork doesn't just disappear against whatever blank-page
  // color the SVG happens to get viewed on) and a stroke-only outline on
  // top (so the cut line still reads clearly over dark artwork too).
  // Neither is part of the actual design, hence their own labeled groups
  // rather than merging into Fabric's own output.
  function buildCardSvgAsync(snapshotJson) {
    return new Promise((resolve) => {
      const off = document.createElement('canvas');
      const staticCanvas = new fabric.StaticCanvas(off, { width: CARD_W_PX, height: CARD_H_PX });
      staticCanvas.loadFromJSON(snapshotJson, () => {
        staticCanvas.getObjects().forEach((obj) => {
          obj.set({ left: obj.left - CARD_OFFSET_X, top: obj.top - CARD_OFFSET_Y });
          obj.setCoords();
        });
        staticCanvas.renderAll();
        // No filled background rect here (there used to be one, solid
        // #1a1a1a) — this SVG is the vector file the laser actually reads,
        // and a filled background is at best dead weight and at worst
        // something a laser operator has to remember to delete before
        // cutting/engraving. Just the outline, as a reference guide for
        // the card's edge, stays.
        // Full CARD_W_PX x CARD_H_PX, not inset by half the stroke width --
        // an inset rect's own width/height attribute reads as slightly
        // less than the true card size (772.5 x 484.5 px, i.e. 85.83mm x
        // 53.83mm instead of 86mm x 54mm) to any tool that measures the
        // shape's geometry rather than its rendered/stroke-inclusive
        // bounds. The 1.5px stroke now centers on the true edge and bleeds
        // ~0.04mm outside the nominal card size on each side, which is
        // negligible next to getting the geometry itself exactly right.
        const outline = `<g id="card-outline"><rect x="0" y="0" width="${CARD_W_PX}" height="${CARD_H_PX}" rx="27" ry="27" fill="none" stroke="#ffffff" stroke-width="1.5"/></g>`;
        // Fabric's own width/height on the <svg> tag are unitless (just
        // "774"/"486"), which every SVG consumer treats as pixels -- at a
        // typical 96dpi that's ~205mm x ~129mm, more than double the real
        // 86mm x 54mm card. Swapping in physical "mm" units here (keeping
        // a viewBox in the same 774x486 px space so every path/shape
        // coordinate inside stays exactly where it already was) is what
        // makes the file open true-to-size in Illustrator or the laser
        // software instead of needing a manual rescale every time.
        const svg = staticCanvas.toSVG()
          .replace(/^(<\?xml[^>]*\?>\s*)?(<!DOCTYPE[^>]*>\s*)?<svg([^>]*)>/, (_match, xmlDecl, doctype, attrs) => {
            let rest = attrs.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '');
            if (!/\sviewBox=/.test(rest)) rest += ` viewBox="0 0 ${CARD_W_PX} ${CARD_H_PX}"`;
            return `${xmlDecl || ''}${doctype || ''}<svg width="86mm" height="54mm"${rest}>`;
          })
          .replace('</svg>', `${outline}</svg>`);
        staticCanvas.dispose();
        resolve(svg);
      });
    });
  }
  // Walks a snapshot's plain (unparsed-into-Fabric) object list, same
  // recursive-into-groups shape as the JSON the JS elsewhere in this file
  // already works with, collecting which finish `keys` (matching
  // FINISH_LEGEND_ORDER's own key strings) actually appear anywhere on
  // this side — mirrors getFinish's own default-to-White/Line-defaults-
  // to-Stroke logic since these are plain objects without that helper's
  // live-Fabric-object access.
  function collectUsedFinishKeys(snapshotJson, keys) {
    if (!snapshotJson) return;
    let data;
    try {
      data = JSON.parse(snapshotJson);
    } catch (e) {
      return;
    }
    function walk(objs) {
      if (!Array.isArray(objs)) return;
      objs.forEach((o) => {
        if (!o) return;
        const finish = o.cardFinish || (o.type === 'line' ? 'stroke' : 'white');
        keys.add(finish === 'texture' && o.cardFinishOutline ? 'texture-outline' : finish);
        if (Array.isArray(o.objects)) walk(o.objects);
      });
    }
    walk(data.objects);
  }
  // Builds the same five files the local-download test bundle used to
  // (mockup PNG, proofing/canvas PNG with ruler+safe zone+density labels,
  // Front.svg, Back.svg, order-info.txt) but returns them as {filename,
  // blob} pairs instead of downloading them — this is what actually gets
  // attached to the real request in sendRealRfqRequest below.
  async function buildRfqFileBundle() {
    const hasBack = projectHasBackSide();
    const frontSnap = snapshotForSide('front') || blankCanvasSnapshot;
    const backSnap = hasBack ? (snapshotForSide('back') || blankCanvasSnapshot) : null;
    const w = 860;
    const h = 540;
    const gap = 24;
    const files = [];

    // 1) Photoreal mockup, front + back stacked vertically in one PNG.
    const frontMockup = document.createElement('canvas');
    frontMockup.width = w;
    frontMockup.height = h;
    await renderMockupCanvasAsync(frontMockup, frontSnap);
    let backMockup = null;
    if (hasBack) {
      backMockup = document.createElement('canvas');
      backMockup.width = w;
      backMockup.height = h;
      await renderMockupCanvasAsync(backMockup, backSnap);
    }
    const mockupOut = document.createElement('canvas');
    mockupOut.width = w;
    mockupOut.height = hasBack ? h * 2 + gap : h;
    const mctx = mockupOut.getContext('2d');
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, mockupOut.width, mockupOut.height);
    mctx.drawImage(frontMockup, 0, 0);
    if (backMockup) mctx.drawImage(backMockup, 0, h + gap);
    files.push({ filename: 'mockup-front-back.png', blob: await canvasToBlob(mockupOut) });

    // 2) Proofing colors + texture density, front + back stacked — this
    // one's meant to read like the editor's own canvas (card border,
    // safe zone, ruler included, see drawSafeZoneAndBorder/
    // drawRulerAndLabel/drawTextureDensityLabels above), not just the
    // bare artwork, so extra margin is reserved around each card for the
    // ruler and its own "Front — 86 × 54mm" label underneath.
    const rulerLeftW = 44;
    const rulerTopH = 34;
    const labelH = 22;
    const sideW = rulerLeftW + w;
    const sideH = rulerTopH + h + labelH;
    const proofFront = await renderProofingCanvasAsync(w, h, frontSnap);
    const proofBack = hasBack ? await renderProofingCanvasAsync(w, h, backSnap) : null;
    const proofOut = document.createElement('canvas');
    proofOut.width = sideW;
    proofOut.height = hasBack ? sideH * 2 + gap : sideH;
    const pctx = proofOut.getContext('2d');
    pctx.fillStyle = '#000';
    pctx.fillRect(0, 0, proofOut.width, proofOut.height);
    // Explicit destination size (not just x/y) so this always scales down
    // to fit its slot even if the source canvas's own backing store ever
    // ends up larger than w×h for any reason — belt-and-suspenders on
    // top of disabling retina scaling above.
    pctx.drawImage(proofFront, rulerLeftW, rulerTopH, w, h);
    drawRulerAndLabel(pctx, rulerLeftW, rulerTopH, w, h, w / CARD_W_PX, 'Front');
    if (proofBack) {
      const backTop = sideH + gap;
      pctx.drawImage(proofBack, rulerLeftW, backTop + rulerTopH, w, h);
      drawRulerAndLabel(pctx, rulerLeftW, backTop + rulerTopH, w, h, w / CARD_W_PX, 'Back');
    }
    files.push({ filename: 'canvas.png', blob: await canvasToBlob(proofOut) });

    // 3) + 4) Front.svg / Back.svg — vector design + card outline.
    files.push({
      filename: 'Front.svg',
      blob: new Blob([await buildCardSvgAsync(frontSnap)], { type: 'image/svg+xml' }),
    });
    if (hasBack) {
      files.push({
        filename: 'Back.svg',
        blob: new Blob([await buildCardSvgAsync(backSnap)], { type: 'image/svg+xml' }),
      });
    }

    // 5) Plain-text order info + color legend — the same quantity/card
    // type/price/shipping context that goes into the real request's own
    // message body (see sendRealRfqRequest below), plus the same
    // name/color key as the Finish toolbar and the proofing PNG above,
    // all in one file so the shop has everything about this order
    // without needing to cross-reference the email itself.
    const order = computeOrderContext();
    const usedFinishKeys = new Set();
    collectUsedFinishKeys(frontSnap, usedFinishKeys);
    if (hasBack) collectUsedFinishKeys(backSnap, usedFinishKeys);
    const usedFinishLegendLines = FINISH_LEGEND_ORDER
      .filter(([key]) => usedFinishKeys.has(key))
      .map(([key, label]) => `${label}: ${FINISH_COLOR_NAMES[key]}`);
    const infoLines = [
      'Order info',
      '==========',
      `Name: ${order.name || 'n/a'}`,
      `Email: ${order.email || 'n/a'}`,
      `Quantity: ${order.quantity || 'n/a'}`,
      `Card type: ${order.cardTypeLabel}`,
      `Estimated total: ${order.estimatedTotal}`,
      `Shipping address: ${order.address || 'n/a'}, ${order.city || 'n/a'}, ${order.state || 'n/a'} ${order.zip || 'n/a'}`,
      `Message: ${order.message || 'n/a'}`,
      '',
      'Card finish color legend',
      '(matches the Finish toolbar and canvas.png — only finishes actually used on this card are listed)',
      '',
      ...(usedFinishLegendLines.length ? usedFinishLegendLines : ['(no finishes assigned yet)']),
    ].join('\n');
    files.push({ filename: 'order-info.txt', blob: new Blob([infoLines], { type: 'text/plain' }) });

    return files;
  }
  // Shared by buildRfqFileBundle's order-info.txt and buildPlmjFile's
  // structured `order` field below (and could replace sendRealRfqRequest's
  // own inline copy of this same computation too, if that ever gets
  // un-mothballed) — one place that turns the Next modal's form + pricing
  // state into plain, already-formatted fields.
  function computeOrderContext() {
    const formData = nextModalForm ? new FormData(nextModalForm) : new FormData();
    const qty = nextModalQuantity ? parseInt(nextModalQuantity.value, 10) || 0 : 0;
    const pricing = nextModalDirectCost !== null && qty ? getNextModalPricing(nextModalDirectCost, qty) : null;
    const cardTypeEntry = (window.CARD_TYPES || []).find((t) => t.id === selectedCardTypeId);
    return {
      name: String(formData.get('name') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      quantity: qty,
      cardTypeId: selectedCardTypeId,
      cardTypeLabel: cardTypeEntry ? `${cardTypeEntry.color} · ${cardTypeEntry.thicknessIn} (${cardTypeEntry.thicknessMm})` : 'n/a',
      estimatedTotal: !pricing
        ? 'n/a'
        : pricing.isMinCharge
          ? `$${pricing.total.toFixed(2)} min charge`
          : `$${pricing.total.toFixed(2)} (${qty} × $${pricing.each.toFixed(2)} ea.)`,
      address: String(formData.get('address') || '').trim(),
      city: String(formData.get('city') || '').trim(),
      state: String(formData.get('state') || '').trim(),
      zip: String(formData.get('zip') || '').trim(),
      message: String(formData.get('message') || '').trim(),
    };
  }
  // ---- Single-file .plmj job bundle ----
  // Same five things buildRfqFileBundle above produces (mockup, proofing
  // canvas, both SVGs, order info) but as one gzip-compressed JSON
  // container (mirrors the .plm project format's own PLM1 magic-header
  // approach — see encodeProjectFile) instead of five loose files, so
  // "Request a Quote" downloads one thing and PLMJobViewer has one file
  // to open. Kept as its own render pass rather than reusing
  // buildRfqFileBundle's stacked/composited canvases: PLMJobViewer wants
  // front and back as separate images it can lay out itself, not a single
  // pre-stacked PNG with its own black page-margin background.
  const PLMJ_MAGIC = 'PLMJ';
  async function encodePlmjFile(payloadObj) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
    let bodyBytes = jsonBytes;
    let format = PLM_FORMAT_RAW;
    if (typeof CompressionStream !== 'undefined') {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(jsonBytes);
      writer.close();
      bodyBytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
      format = PLM_FORMAT_GZIP;
    }
    const header = new TextEncoder().encode(PLMJ_MAGIC);
    const out = new Uint8Array(header.length + 1 + bodyBytes.length);
    out.set(header, 0);
    out[header.length] = format;
    out.set(bodyBytes, header.length + 1);
    return out;
  }
  async function buildPlmjFile() {
    const hasBack = projectHasBackSide();
    const frontSnap = snapshotForSide('front') || blankCanvasSnapshot;
    const backSnap = hasBack ? (snapshotForSide('back') || blankCanvasSnapshot) : null;
    const w = 860;
    const h = 540;
    const rulerLeftW = 44;
    const rulerTopH = 34;
    const labelH = 22;

    async function sideMockupDataURL(snap) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      await renderMockupCanvasAsync(c, snap);
      return canvasToDataURL(c);
    }
    async function sideCanvasDataURL(snap, label) {
      const out = document.createElement('canvas');
      out.width = rulerLeftW + w;
      out.height = rulerTopH + h + labelH;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, out.width, out.height);
      const proof = await renderProofingCanvasAsync(w, h, snap);
      ctx.drawImage(proof, rulerLeftW, rulerTopH, w, h);
      drawRulerAndLabel(ctx, rulerLeftW, rulerTopH, w, h, w / CARD_W_PX, label);
      return canvasToDataURL(out);
    }

    const [frontMockup, backMockup, frontCanvas, backCanvas, frontSvg, backSvg] = await Promise.all([
      sideMockupDataURL(frontSnap),
      hasBack ? sideMockupDataURL(backSnap) : Promise.resolve(null),
      sideCanvasDataURL(frontSnap, 'Front'),
      hasBack ? sideCanvasDataURL(backSnap, 'Back') : Promise.resolve(null),
      buildCardSvgAsync(frontSnap),
      hasBack ? buildCardSvgAsync(backSnap) : Promise.resolve(null),
    ]);

    const usedFinishKeys = new Set();
    collectUsedFinishKeys(frontSnap, usedFinishKeys);
    if (hasBack) collectUsedFinishKeys(backSnap, usedFinishKeys);
    const finishLegend = FINISH_LEGEND_ORDER
      .filter(([key]) => usedFinishKeys.has(key))
      .map(([key, label]) => ({ key, label, colorName: FINISH_COLOR_NAMES[key], colorHex: FINISH_COLORS[key] }));

    const cardTypeEntry = (window.CARD_TYPES || []).find((t) => t.id === selectedCardTypeId);

    return {
      app: 'business-card-editor',
      kind: 'plmj',
      version: 1,
      createdAt: new Date().toISOString(),
      order: computeOrderContext(),
      cardType: cardTypeEntry
        ? { id: cardTypeEntry.id, color: cardTypeEntry.color, thicknessIn: cardTypeEntry.thicknessIn, thicknessMm: cardTypeEntry.thicknessMm, swatch: cardTypeEntry.swatch }
        : null,
      hasBack,
      finishLegend,
      mockup: { front: frontMockup, back: backMockup },
      canvas: { front: frontCanvas, back: backCanvas },
      svg: { front: frontSvg, back: backSvg },
    };
  }
  async function downloadPlmjFile() {
    const payload = await buildPlmjFile();
    const bytes = await encodePlmjFile(payload);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const base = (payload.order.name || 'business-card').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'business-card';
    triggerDownload(blob, `${base}-order.plmj`);
  }

  // Sends the real request — the button used to just download this same
  // five-file bundle locally for review; now that it's been checked over,
  // this attaches it to the actual POST instead.
  async function sendRealRfqRequest(e) {
    e.preventDefault();
    if (!nextModalStatus || !nextModalRequestBtn) return;
    nextModalStatus.textContent = '';
    nextModalStatus.className = 'form-status';
    nextModalRequestBtn.disabled = true;
    const submitLabel = nextModalRequestBtn.innerHTML;
    nextModalRequestBtn.textContent = 'Sending…';
    try {
      const formData = new FormData(nextModalForm);
      // The design's own context (quantity/card type/price), folded
      // into the message body rather than added as new form fields —
      // the Worker only knows about the marketing form's fields, and
      // this way it doesn't need to change to understand a request
      // that came from the editor instead.
      const qty = nextModalQuantity ? parseInt(nextModalQuantity.value, 10) || 0 : 0;
      const pricing = nextModalDirectCost !== null && qty ? getNextModalPricing(nextModalDirectCost, qty) : null;
      const cardTypeEntry = (window.CARD_TYPES || []).find((t) => t.id === selectedCardTypeId);
      const address = String(formData.get('address') || '').trim();
      const city = String(formData.get('city') || '').trim();
      const state = String(formData.get('state') || '').trim();
      const zip = String(formData.get('zip') || '').trim();
      const contextLines = [
        `Quantity: ${qty || 'n/a'}`,
        `Card type: ${cardTypeEntry ? `${cardTypeEntry.color} · ${cardTypeEntry.thicknessIn} (${cardTypeEntry.thicknessMm})` : 'n/a'}`,
        !pricing
          ? 'Estimated total: n/a'
          : pricing.isMinCharge
            ? `Estimated total: $${pricing.total.toFixed(2)} min charge`
            : `Estimated total: $${pricing.total.toFixed(2)} ($${pricing.each.toFixed(2)} ea.)`,
        `Shipping address: ${address || 'n/a'}, ${city || 'n/a'}, ${state || 'n/a'} ${zip || 'n/a'}`,
      ];
      const userMessage = String(formData.get('message') || '').trim();
      formData.set('message', `${contextLines.join('\n')}${userMessage ? `\n\n${userMessage}` : ''}`);
      // The full five-file bundle (mockup PNG, proofing/canvas PNG,
      // Front.svg, Back.svg, order-info.txt — see buildRfqFileBundle)
      // rather than just the two raw renderings, all sharing the
      // 'attachment' field name same as a real multi-file input would.
      const bundle = await buildRfqFileBundle();
      bundle.forEach(({ filename, blob }) => formData.append('attachment', blob, filename));
      const res = await fetch(RFQ_ENDPOINT, { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok && data.success) {
        nextModalForm.reset();
        showRfqSuccessModal();
      } else {
        nextModalStatus.textContent = data.message || 'Something went wrong — please try again.';
        nextModalStatus.className = 'form-status error';
      }
    } catch (err) {
      nextModalStatus.textContent = 'Network error — please try again.';
      nextModalStatus.className = 'form-status error';
    } finally {
      nextModalRequestBtn.disabled = false;
      nextModalRequestBtn.innerHTML = submitLabel;
    }
  }
  // Temporarily back to local-download instead of the real POST (see
  // sendRealRfqRequest above) — swap the listener below back to
  // sendRealRfqRequest once the bundle's been re-confirmed good.
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  async function downloadRfqTestFiles(e) {
    e.preventDefault();
    if (!nextModalStatus || !nextModalRequestBtn) return;
    nextModalStatus.textContent = '';
    nextModalStatus.className = 'form-status';
    nextModalRequestBtn.disabled = true;
    const submitLabel = nextModalRequestBtn.innerHTML;
    nextModalRequestBtn.textContent = 'Building…';
    try {
      await downloadPlmjFile();
      showRfqSuccessModal();
    } catch (err) {
      nextModalStatus.textContent = 'Could not build the order file — please try again.';
      nextModalStatus.className = 'form-status error';
    } finally {
      nextModalRequestBtn.disabled = false;
      nextModalRequestBtn.innerHTML = submitLabel;
    }
  }
  if (nextModalForm) nextModalForm.addEventListener('submit', downloadRfqTestFiles);

  // Both default to uniform scaling — both checkboxes are "Non-uniform
  // scale", unchecked by default, so either has to be deliberately
  // opted into non-uniform/free stretching.
  function isNonUniformAllowed(obj) {
    if (!obj) return false;
    if (obj.type === 'i-text') return !!(nonUniformCheckbox && nonUniformCheckbox.checked);
    return !!(shapeNonUniformCheckbox && shapeNonUniformCheckbox.checked);
  }

  // When non-uniform scaling isn't allowed, only corner handles are shown
  // (locking to proportional resize); when it is, the edge-midpoint
  // handles are exposed too, since those only ever move one axis.
  function applyScalingControlsVisibility(obj) {
    if (!obj) return;
    const nonUniform = isNonUniformAllowed(obj);
    obj.setControlsVisibility({ ml: nonUniform, mt: nonUniform, mr: nonUniform, mb: nonUniform });
  }

  // The anchor point drives both where X/Y is measured from and where
  // rotation pivots — both are native Fabric concepts tied to an object's
  // originX/originY (the point that render, and interactive rotation
  // with centeredRotation:false, both pivot around). So switching anchor
  // just changes originX/Y, repositioning to keep the object visually in
  // place. Once that's set, obj.left/obj.top directly *are* the anchor
  // point's canvas coordinates — invariant to the object's own rotation,
  // since a pivot point doesn't move when the thing pivoting around it
  // rotates — so no separate bounding-box math is needed to read them.
  const ANCHORS = {
    tl: { originX: 'left', originY: 'top' },
    tr: { originX: 'right', originY: 'top' },
    bl: { originX: 'left', originY: 'bottom' },
    br: { originX: 'right', originY: 'bottom' },
    c: { originX: 'center', originY: 'center' },
  };
  function anchorKeyFor(obj) {
    const key = Object.keys(ANCHORS).find(
      (k) => ANCHORS[k].originX === obj.originX && ANCHORS[k].originY === obj.originY
    );
    return key || 'tl';
  }
  function setObjectAnchor(obj, key) {
    const anchor = ANCHORS[key];
    if (!anchor || (obj.originX === anchor.originX && obj.originY === anchor.originY)) return;
    const center = obj.getCenterPoint();
    obj.set({ originX: anchor.originX, originY: anchor.originY, centeredRotation: false });
    obj.setPositionByOrigin(center, 'center', 'center');
    obj.setCoords();
  }
  // Updates both the toggle icon's highlighted dot and the panel's
  // highlighted button to reflect the given anchor key.
  function updateAnchorIcon(key) {
    anchorDots.forEach((dot) => dot.classList.toggle('is-active', dot.dataset.dot === key));
    anchorPanelButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.anchor === key));
  }

  // Rotation reads straight off the object's angle. Position is the
  // anchor point relative to the card's top-left corner (0,0), in mm to
  // match the ruler. Size is the object's own un-rotated width/height
  // (not the rotated axis-aligned bounding box), so spinning an object
  // doesn't make its W/H climb.
  function refreshTransformFields(obj) {
    if (rotationInput) rotationInput.value = Math.round(((obj.angle % 360) + 360) % 360);
    updateAnchorIcon(anchorKeyFor(obj));
    if (posXInput) posXInput.value = ((obj.left - CARD_OFFSET_X) / pxPerUnit()).toFixed(unitDecimals());
    if (posYInput) posYInput.value = ((obj.top - CARD_OFFSET_Y) / pxPerUnit()).toFixed(unitDecimals());
    if (sizeWInput) sizeWInput.value = (displayWidthOf(obj) / pxPerUnit()).toFixed(unitDecimals());
    if (sizeHInput) sizeHInput.value = (displayHeightOf(obj) / pxPerUnit()).toFixed(unitDecimals());
    syncEdgeIndicator(obj);
  }
  function clearTransformFields() {
    if (rotationInput) rotationInput.value = 0;
    updateAnchorIcon('c');
    if (posXInput) posXInput.value = '';
    if (posYInput) posYInput.value = '';
    if (sizeWInput) sizeWInput.value = '';
    if (sizeHInput) sizeHInput.value = '';
  }

  // The toolbar serves both Text and Shapes objects — shared controls
  // (align, rotate, anchor, position, size, and now which scaling
  // checkbox applies) always populate; font/text-align only for text,
  // and the shape-type picker's active icon only for shapes.
  function showObjectToolbarFor(obj) {
    if (!textToolbar) return;
    textToolbar.classList.add('is-visible');
    // A multi-selection is text mode only if every member is text — one
    // shape (or group) mixed in among text members bumps the whole
    // selection to shape mode, same as if a lone shape were selected.
    const members = obj.type === 'activeSelection' ? obj.getObjects() : [obj];
    const isText = members.length > 0 && members.every((m) => m.type === 'i-text');
    textToolbar.classList.toggle('mode-text', isText);
    textToolbar.classList.toggle('mode-shape', !isText);
    if (isText) {
      const rep = members.find((m) => m.type === 'i-text') || obj;
      if (fontFamilySelect) fontFamilySelect.value = rep.fontFamily || 'Arial';
      if (fontSizeInput) fontSizeInput.value = Math.round(rep.fontSize || 24);
      alignButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.align === (rep.textAlign || 'left')));
    } else {
      const rep = members.find((m) => SHAPE_TYPES.includes(m.type)) || obj;
      shapeTypeButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.shape === rep.type));
      refreshFillModeUI(rep);
      refreshLineStyleUI(rep);
      refreshCornerRadiusUI(rep);
    }
    const isRealObject = typeof obj.getCenterPoint === 'function';
    if (isRealObject) refreshTransformFields(obj);
    else clearTransformFields();
    if (isRealObject && (SHAPE_FILL_TYPES.includes(obj.type) || obj.type === 'group')) showEdgeIndicatorFor(obj);
    else hideEdgeIndicator();
  }
  // The toolbar should stay up for as long as Text or Shapes is
  // selected, even once there's no object to reflect (e.g. the
  // selection was cleared, or the object got deleted) — falls back to
  // showing that tool's defaults instead of hiding.
  function hideObjectToolbar() {
    if (!textToolbar) return;
    if (isTextToolActive()) {
      showObjectToolbarFor({ type: 'i-text', fontFamily: 'Arial', fontSize: 24, textAlign: 'left' });
      return;
    }
    if (isShapesToolActive()) {
      showObjectToolbarFor({ type: currentShapeType });
      return;
    }
    textToolbar.classList.remove('is-visible');
    hideEdgeIndicator();
  }
  // Shift-click toggling individual objects in/out of a selection is
  // Fabric's own native behavior already. Shift-*dragging* a new marquee
  // is not, though — Fabric always discards whatever was selected before
  // and replaces it with exactly what the new box encloses. To match
  // shift-click's toggle behavior for drag too, capture whatever was
  // selected right before a shift+drag starts (before Fabric's own
  // mousedown handling discards it), then once Fabric finishes building
  // its own (box-only) result, replace it with the symmetric difference:
  // objects that were selected before and aren't in the new box stay
  // selected; objects newly enclosed that weren't selected get added;
  // objects enclosed that were already selected get deselected.
  let dragSelectPreState = null;
  fabricCanvas.on('mouse:down:before', (opt) => {
    dragSelectPreState = (fabricCanvas.selection && !opt.target && opt.e.shiftKey)
      ? fabricCanvas.getActiveObjects().slice()
      : null;
  });
  fabricCanvas.on('mouse:up', (opt) => {
    const pre = dragSelectPreState;
    dragSelectPreState = null;
    if (!pre || !pre.length || opt.isClick) return;
    const active = fabricCanvas.getActiveObject();
    const boxed = active ? (active.type === 'activeSelection' ? active.getObjects() : [active]) : [];
    const preSet = new Set(pre);
    const boxedSet = new Set(boxed);
    const merged = [...pre.filter((o) => !boxedSet.has(o)), ...boxed.filter((o) => !preSet.has(o))];
    suppressHistoryEvents = true;
    fabricCanvas.discardActiveObject();
    if (merged.length === 1) {
      fabricCanvas.setActiveObject(merged[0]);
    } else if (merged.length > 1) {
      fabricCanvas.setActiveObject(new fabric.ActiveSelection(merged, { canvas: fabricCanvas }));
    }
    suppressHistoryEvents = false;
    fabricCanvas.requestRenderAll();
  });
  // ---- Finish mode ----
  // A persistent mode (toggled on/off, not per-tool) rather than a
  // regular side panel: turning it on forces the sidebar open on Layers
  // (so a group/object can be picked while in this mode) and swaps the
  // usual text/shape toolbar for the finish-options toolbar below —
  // selecting something while this mode is active reflects/updates that
  // object's own finish instead of opening the normal object toolbar.
  let finishModeActive = false;
  const finishToggleBtn = document.getElementById('toggle-finish');
  const layersToggleBtn = document.getElementById('toggle-layers');
  const finishToolbar = document.getElementById('finish-toolbar');
  const finishButtons = document.querySelectorAll('.editor-finish-btn');
  const finishTextureSlider = document.getElementById('finish-texture-slider');
  const finishTextureRange = document.getElementById('finish-texture-range');
  const finishTextureValue = document.getElementById('finish-texture-value');
  const finishTextureOutline = document.getElementById('finish-texture-outline');
  const finishTextureAngle = document.getElementById('finish-texture-angle');
  // Every object/group defaults to White until a finish is explicitly
  // chosen for it — reading through this one helper (instead of a raw
  // `obj.cardFinish`) everywhere means new objects never need to have
  // the default written onto them at creation time. A Line is the one
  // exception: it has no fillable area, so Stroke is the only finish
  // that's physically possible for it (White would just render as
  // nothing) — makeLine already writes 'stroke' onto new ones, but this
  // covers any line that somehow reaches here without it.
  function getFinish(obj) {
    if (obj && obj.cardFinish) return obj.cardFinish;
    if (obj && obj.type === 'line') return 'stroke';
    return 'white';
  }
  // A proofing color per finish, so it's obvious at a glance what's been
  // assigned to what — these aren't the real engraved appearance (that's
  // what the Renderings panel is for eventually), just a legend.
  const FINISH_COLORS = {
    none: '#ef4444',
    stroke: '#22c55e',
    texture: '#3b82f6',
    'texture-outline': '#38bdf8',
    white: '#ffffff',
    metallic: '#9ca3af',
    'frosted-white': '#a855f7',
  };
  // Plain-language names for the same swatches, keyed identically —
  // used by the color-legend.txt export so it reads as "Stroke: Green"
  // rather than a hex code the shop floor has to look up.
  const FINISH_COLOR_NAMES = {
    none: 'Red',
    stroke: 'Green',
    texture: 'Blue',
    'texture-outline': 'Light Blue',
    white: 'White',
    metallic: 'Gray',
    'frosted-white': 'Purple',
  };
  // [finish key, display label] pairs, in the same order the Finish
  // toolbar itself lists them — used to filter order-info.txt's color
  // legend down to only the finishes actually present on this card (see
  // collectUsedFinishKeys/buildRfqFileBundle), not the full fixed set.
  const FINISH_LEGEND_ORDER = [
    ['none', "Don't Engrave"],
    ['stroke', 'Stroke'],
    ['texture', 'Texture'],
    ['texture-outline', 'Texture (Outline)'],
    ['white', 'White'],
    ['metallic', 'Metallic'],
    ['frosted-white', 'Frosted White'],
  ];
  // Paints the finish color onto whichever channel a shape actually
  // renders with — a plain shape/text uses fill, but one already in
  // Stroke fill-mode (see setShapeFillMode) has fill:null and paints via
  // stroke instead, and a Line never has a real fill at all (same
  // reasoning as replaceWithBooleanResult below) — get either of those
  // wrong and the color-coding would just silently not show up.
  function applyFinishColor(obj, color) {
    if (obj.type === 'line') {
      obj.set({ stroke: color });
      return;
    }
    if (!SHAPE_FILL_TYPES.includes(obj.type) && obj.type !== 'i-text') return;
    // Whichever of fill/stroke is actually painting something gets the
    // finish color — a shape can have both (a filled shape with its own
    // outline), just one, or in principle neither, in which case fill is
    // the sensible one to give it. Truthy checks, not `!= null`: an
    // imported SVG's `fill="none"`/`stroke="none"` comes through from
    // Fabric's own SVG parser as an empty string, not null, and `!=
    // null` doesn't catch that — silently painting a fill onto a path
    // that was meant to be stroke-only.
    const hasFill = !!obj.fill && obj.fill !== 'none';
    const hasStroke = !!obj.stroke && obj.stroke !== 'none';
    const next = {};
    if (hasFill) next.fill = color;
    if (hasStroke) next.stroke = color;
    if (!hasFill && !hasStroke) next.fill = color;
    obj.set(next);
  }
  function applyFinishToOne(obj, finish, textureAmount, outline, angle) {
    obj.cardFinish = finish;
    obj.cardFinishTexture = finish === 'texture' ? textureAmount : undefined;
    obj.cardFinishOutline = finish === 'texture' ? !!outline : undefined;
    obj.cardFinishAngle = finish === 'texture' ? (angle === 90 || angle === '90' ? 90 : 45) : undefined;
    const color = finish === 'texture' && obj.cardFinishOutline
      ? FINISH_COLORS['texture-outline']
      : (FINISH_COLORS[finish] || FINISH_COLORS.white);
    applyFinishColor(obj, color);
    // Outline is conveyed purely through the fill color (texture-outline's
    // own proofing color vs. plain texture's) — not by adding a real
    // stroke to the canvas object itself, which would leave a visible
    // border sitting on top of the hatch fill in the editor. The actual
    // traced outline line is drawn separately for the Mockup/Renderings
    // preview (see styleForRender's own `obj.cardFinishOutline` check),
    // so nothing here needs the object's own stroke channel to convey it.
    if (finish === 'texture' && obj.type !== 'line') {
      obj.set({ stroke: null });
    }
  }
  // Applying a finish to a group (or a multi-object selection) sets it on
  // every object inside too, recursively — overriding whatever finish
  // those members had — same as picking Fill/Stroke mode for a whole
  // group already works elsewhere in this file. Selecting one member on
  // its own (via the Layers panel — see selectNestedObject) and changing
  // it only ever reaches this with that one object, so it stays scoped
  // to just that object, same as any plain shape.
  function applyFinishCascade(obj, finish, textureAmount, outline, angle) {
    if (obj.type === 'activeSelection') {
      obj.getObjects().forEach((child) => applyFinishCascade(child, finish, textureAmount, outline, angle));
      return;
    }
    applyFinishToOne(obj, finish, textureAmount, outline, angle);
    if (obj.type === 'group') {
      obj.getObjects().forEach((child) => applyFinishCascade(child, finish, textureAmount, outline, angle));
    }
  }
  // ---- Metallic finish vs. a Clear (bare aluminum) card blank ----
  // Metallic finish is a proofing stand-in for "leave the aluminum bare"
  // — on a Clear-anodized blank that's the card's own native color
  // already, so engraving it "Metallic" would be a no-op (metal on
  // identical metal, invisible). Disabled outright in the toolbar while
  // Silver is selected (see updateFinishAvailability, wired up by the
  // card-type picker below), and any object already set to Metallic —
  // whether already on the canvas or baked into a template about to
  // load — falls back to White instead, the same default everything
  // else starts at.
  function isSilverCardTypeSelected() {
    const entry = (window.CARD_TYPES || []).find((t) => t.id === selectedCardTypeId);
    return !!entry && entry.color === 'Silver';
  }
  function updateFinishAvailability() {
    const metallicBtn = document.querySelector('.editor-finish-btn[data-finish="metallic"]');
    if (metallicBtn) metallicBtn.disabled = isSilverCardTypeSelected();
  }
  // Walks a plain (already-parsed, not live Fabric) object list — as
  // found in a JSON snapshot's `objects` array, recursing into any
  // group's own nested `objects` — demoting every Metallic entry to
  // White in place, mirroring applyFinishColor's fill-vs-stroke channel
  // logic by hand since these are plain data objects, not real Fabric
  // instances with a `.set()`. Returns whether anything changed.
  function recolorMetallicToWhiteInObjectList(objs) {
    if (!Array.isArray(objs)) return false;
    let changed = false;
    objs.forEach((o) => {
      if (o && o.cardFinish === 'metallic') {
        o.cardFinish = 'white';
        const color = FINISH_COLORS.white;
        const hasFill = !!o.fill && o.fill !== 'none';
        const hasStroke = !!o.stroke && o.stroke !== 'none';
        if (hasFill) o.fill = color;
        if (hasStroke) o.stroke = color;
        if (!hasFill && !hasStroke) o.fill = color;
        changed = true;
      }
      if (o && Array.isArray(o.objects) && recolorMetallicToWhiteInObjectList(o.objects)) changed = true;
    });
    return changed;
  }
  // Deep-clones a template/import side snapshot (a plain object, e.g.
  // window.CARD_TEMPLATES[i].front) with Metallic demoted to White —
  // cloned so the shared template data itself is never mutated, since a
  // later load under a non-Silver card type should still offer Metallic
  // as that template originally intended.
  function demoteMetallicFinishesInSnapshot(snapshot) {
    if (!snapshot) return snapshot;
    const clone = JSON.parse(JSON.stringify(snapshot));
    recolorMetallicToWhiteInObjectList(clone.objects);
    return clone;
  }
  // Demotes Metallic->White on whatever's live on the canvas right now
  // (the current side), pushing one history step if anything actually
  // changed.
  function demoteMetallicToWhiteOnCurrentCanvas() {
    let changed = false;
    function walk(obj) {
      if (obj.cardFinish === 'metallic') {
        applyFinishToOne(obj, 'white');
        changed = true;
      }
      if (obj.type === 'group' && obj.getObjects) obj.getObjects().forEach(walk);
    }
    fabricCanvas.getObjects().forEach(walk);
    if (changed) {
      fabricCanvas.requestRenderAll();
      refreshLayersList();
      refreshFinishUI(fabricCanvas.getActiveObject());
      pushHistory();
    }
    return changed;
  }
  // Same demotion, but for whichever side(s) *aren't* currently loaded
  // into the live canvas — their last snapshot just sits as a JSON string
  // in sideHistories until switched to, so it's patched directly there.
  function demoteMetallicToWhiteInOtherSides() {
    Object.keys(sideHistories).forEach((side) => {
      if (side === currentSide) return;
      const hist = sideHistories[side];
      if (!hist || !hist.undo.length) return;
      const lastStr = hist.undo[hist.undo.length - 1];
      let data;
      try { data = JSON.parse(lastStr); } catch (e) { return; }
      if (recolorMetallicToWhiteInObjectList(data.objects)) {
        hist.undo[hist.undo.length - 1] = JSON.stringify(data);
      }
    });
  }
  function refreshFinishUI(obj) {
    const finish = getFinish(obj);
    finishButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.finish === finish));
    if (finishTextureSlider) finishTextureSlider.classList.toggle('is-visible', finish === 'texture');
    const textureAmount = (obj && obj.cardFinishTexture) || 25;
    if (finishTextureRange) finishTextureRange.value = textureAmount;
    if (finishTextureValue) finishTextureValue.value = textureAmount;
    if (finishTextureOutline) finishTextureOutline.checked = !!(obj && obj.cardFinishOutline);
    if (finishTextureAngle) finishTextureAngle.value = String((obj && obj.cardFinishAngle) || 45);
  }
  // Shared by the slider and the typed number box, which stay in sync
  // with each other. `commit` pushes history — used once dragging/typing
  // actually finishes (slider `change`, number box blur/Enter), not on
  // every intermediate `input` tick.
  function setTextureAmount(rawValue, commit) {
    const clamped = Math.min(50, Math.max(1, parseInt(rawValue, 10) || 1));
    if (finishTextureRange) finishTextureRange.value = clamped;
    if (finishTextureValue) finishTextureValue.value = clamped;
    const obj = fabricCanvas.getActiveObject();
    if (!obj || obj.cardFinish !== 'texture') return;
    applyFinishCascade(obj, 'texture', clamped, obj.cardFinishOutline, obj.cardFinishAngle);
    fabricCanvas.requestRenderAll();
    refreshLayersList();
    if (commit) pushHistory();
  }
  function setTextureOutline(checked) {
    const obj = fabricCanvas.getActiveObject();
    if (!obj || obj.cardFinish !== 'texture') return;
    applyFinishCascade(obj, 'texture', obj.cardFinishTexture, checked, obj.cardFinishAngle);
    fabricCanvas.requestRenderAll();
    refreshLayersList();
    pushHistory();
  }
  function setTextureAngle(rawValue) {
    const angle = parseInt(rawValue, 10) === 90 ? 90 : 45;
    const obj = fabricCanvas.getActiveObject();
    if (!obj || obj.cardFinish !== 'texture') return;
    applyFinishCascade(obj, 'texture', obj.cardFinishTexture, obj.cardFinishOutline, angle);
    fabricCanvas.requestRenderAll();
    refreshLayersList();
    pushHistory();
  }
  function setFinishMode(active) {
    finishModeActive = active;
    if (finishToggleBtn) finishToggleBtn.classList.toggle('is-active', active);
    if (finishToolbar) finishToolbar.classList.toggle('is-visible', active);
    if (!active) {
      // Finish mode is what forced the Layers panel open in the first
      // place — leaving the mode closes it back up again.
      if (sidePanel) sidePanel.classList.remove('is-open');
      if (layersToggleBtn) layersToggleBtn.classList.remove('is-active');
      return;
    }
    // Force the sidebar open on Layers, same as clicking that button
    // directly — this is how an object/group gets picked in this mode.
    if (sidePanel && layersToggleBtn) {
      panelToggles.forEach((b) => b.classList.remove('is-active'));
      sidePanel.querySelectorAll('.editor-side-panel-section').forEach((s) => s.classList.remove('is-active'));
      layersToggleBtn.classList.add('is-active');
      sidePanel.classList.add('is-open');
      const section = sidePanel.querySelector('[data-panel-content="layers"]');
      if (section) section.classList.add('is-active');
    }
    textToolbar.classList.remove('is-visible');
    hideEdgeIndicator();
    // Drawing/typing doesn't make sense while assigning finishes — force
    // the Select tool so its toolbar can't come back up over this one.
    toolButtons.forEach((b) => b.classList.toggle('is-active', b.id === 'tool-select'));
    fabricCanvas.defaultCursor = 'default';
    fabricCanvas.selection = true;
    refreshFinishUI(fabricCanvas.getActiveObject());
  }
  if (finishToggleBtn) {
    finishToggleBtn.addEventListener('click', () => setFinishMode(!finishModeActive));
  }

  // ---- Settings pop-up (left toolbar, below Finish) ----
  // Empty shell for now — positioned next to its trigger button, same
  // fixed-position + JS-placement mechanism as the right-click context menu.
  const settingsToggleBtn = document.getElementById('toggle-settings');
  const settingsPopup = document.getElementById('settings-popup');
  if (settingsToggleBtn && settingsPopup) {
    function closeSettingsPopup() {
      settingsPopup.classList.remove('is-open');
      settingsToggleBtn.classList.remove('is-active');
      settingsToggleBtn.setAttribute('aria-expanded', 'false');
    }
    function openSettingsPopup() {
      settingsPopup.classList.add('is-open');
      settingsToggleBtn.classList.add('is-active');
      settingsToggleBtn.setAttribute('aria-expanded', 'true');
      const btnRect = settingsToggleBtn.getBoundingClientRect();
      const popupRect = settingsPopup.getBoundingClientRect();
      const left = Math.min(btnRect.right + 6, window.innerWidth - popupRect.width - 4);
      const top = Math.min(btnRect.top, window.innerHeight - popupRect.height - 4);
      settingsPopup.style.left = `${Math.max(4, left)}px`;
      settingsPopup.style.top = `${Math.max(4, top)}px`;
    }
    settingsToggleBtn.addEventListener('click', () => {
      if (settingsPopup.classList.contains('is-open')) closeSettingsPopup();
      else openSettingsPopup();
    });
    document.addEventListener('click', (e) => {
      if (!settingsPopup.classList.contains('is-open')) return;
      if (settingsPopup.contains(e.target) || settingsToggleBtn.contains(e.target)) return;
      closeSettingsPopup();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSettingsPopup();
    });

    // ---- Units (mm / in) ----
    const unitButtons = settingsPopup.querySelectorAll('.editor-settings-unit-btn');
    const UNIT_LABEL_IDS = ['corner-radius-unit', 'stroke-width-unit', 'pos-x-unit', 'pos-y-unit', 'size-w-unit', 'size-h-unit', 'shape-modal-w-unit', 'shape-modal-h-unit'];
    function refreshUnitLabels() {
      UNIT_LABEL_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = unitLabel();
      });
    }
    function setUnitSystem(next) {
      if (next === unitSystem) return;
      unitSystem = next;
      unitButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.unit === unitSystem));
      refreshUnitLabels();
      rebuildRulers();
      setActiveSideUI(currentSideName);
      // Re-populate every currently-visible numeric field in the new unit
      // — otherwise a field keeps showing its old number until the next
      // selection change happens to refresh it.
      const active = fabricCanvas.getActiveObject();
      if (active) {
        refreshTransformFields(active);
        refreshCornerRadiusUI(active);
        refreshFillModeUI(active);
      }
    }
    unitButtons.forEach((btn) => {
      btn.addEventListener('click', () => setUnitSystem(btn.dataset.unit));
    });
  }

  // ---- Help mode ----
  // Darkens the whole editor and shows a few callouts pointing at the
  // left toolbar, the top-right file actions, and the bottom side-
  // switcher bar — positions are computed from those elements' actual
  // on-screen location each time it opens, rather than hardcoded, so it
  // stays correct regardless of window size.
  const helpBtn = document.getElementById('help-btn');
  const helpOverlay = document.getElementById('help-overlay');
  const helpCalloutLeft = document.getElementById('help-callout-left');
  const helpCalloutTopRight = document.getElementById('help-callout-top-right');
  const helpCalloutBottom = document.getElementById('help-callout-bottom');
  const helpCalloutPrice = document.getElementById('help-callout-price');
  const helpCalloutCardType = document.getElementById('help-callout-cardtype');
  function positionHelpCallouts() {
    const toolbarEl = document.querySelector('.editor-toolbar');
    const toolGroups = document.querySelectorAll('.editor-toolbar .editor-tool-group');
    const topbarActionsEl = document.querySelector('.editor-topbar-actions');
    const sidesEl = document.getElementById('editor-sides');
    const priceEl = document.getElementById('editor-price');
    if (toolbarEl && helpCalloutLeft) {
      const toolbarRect = toolbarEl.getBoundingClientRect();
      // Centered on just the actual tool buttons (both groups: Select
      // through Upload, then Layers through Settings) rather than the
      // toolbar's full height, which includes a lot of empty space plus
      // the zoom controls near the bottom — centering on the whole thing
      // put this callout much lower than the tools it's explaining.
      let anchorTop = toolbarRect.top + toolbarRect.height / 2;
      if (toolGroups.length) {
        const firstRect = toolGroups[0].getBoundingClientRect();
        const lastRect = toolGroups[toolGroups.length - 1].getBoundingClientRect();
        anchorTop = (firstRect.top + lastRect.bottom) / 2;
      }
      helpCalloutLeft.style.left = `${toolbarRect.right + 16}px`;
      helpCalloutLeft.style.top = `${anchorTop}px`;
    }
    if (topbarActionsEl && helpCalloutTopRight) {
      const r = topbarActionsEl.getBoundingClientRect();
      helpCalloutTopRight.style.left = `${r.left + r.width / 2}px`;
      helpCalloutTopRight.style.top = `${r.bottom + 12}px`;
    }
    if (sidesEl && helpCalloutBottom) {
      // Anchored to the Front/Back thumbnail row specifically, not the
      // whole bottom bar (which also spans the Estimated Price area on
      // the right) — keeps this callout above the buttons it explains.
      const r = sidesEl.getBoundingClientRect();
      helpCalloutBottom.style.left = `${r.left + r.width / 2}px`;
      helpCalloutBottom.style.bottom = `${window.innerHeight - r.top + 12}px`;
    }
    if (priceEl && helpCalloutPrice) {
      const r = priceEl.getBoundingClientRect();
      helpCalloutPrice.style.left = `${r.right - 240}px`;
      helpCalloutPrice.style.bottom = `${window.innerHeight - r.top + 12}px`;
    }
    if (cardTypeToggleBtn && helpCalloutCardType) {
      const r = cardTypeToggleBtn.getBoundingClientRect();
      helpCalloutCardType.style.left = `${r.left + r.width / 2}px`;
      helpCalloutCardType.style.bottom = `${window.innerHeight - r.top + 12}px`;
    }
  }
  function isHelpModeOpen() {
    return !!(helpOverlay && helpOverlay.classList.contains('is-open'));
  }
  function openHelpMode() {
    if (!helpOverlay) return;
    positionHelpCallouts();
    helpOverlay.classList.add('is-open');
    helpOverlay.setAttribute('aria-hidden', 'false');
    if (helpBtn) helpBtn.setAttribute('aria-expanded', 'true');
  }
  function closeHelpMode() {
    if (!helpOverlay) return;
    helpOverlay.classList.remove('is-open');
    helpOverlay.setAttribute('aria-hidden', 'true');
    if (helpBtn) helpBtn.setAttribute('aria-expanded', 'false');
  }
  if (helpBtn) helpBtn.addEventListener('click', openHelpMode);
  if (helpOverlay) helpOverlay.addEventListener('click', closeHelpMode);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isHelpModeOpen()) closeHelpMode();
  });
  finishButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      // Always respond, even with nothing selected — there's just
      // nothing to actually apply the choice to yet in that case.
      const finish = btn.dataset.finish;
      finishButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      if (finishTextureSlider) finishTextureSlider.classList.toggle('is-visible', finish === 'texture');
      const obj = fabricCanvas.getActiveObject();
      if (!obj) return;
      const textureAmount = finish === 'texture' ? (finishTextureRange ? parseInt(finishTextureRange.value, 10) : 25) : undefined;
      const outline = finish === 'texture' && finishTextureOutline ? finishTextureOutline.checked : false;
      const angle = finish === 'texture' && finishTextureAngle ? parseInt(finishTextureAngle.value, 10) : undefined;
      applyFinishCascade(obj, finish, textureAmount, outline, angle);
      fabricCanvas.requestRenderAll();
      refreshLayersList();
      pushHistory();
    });
  });
  if (finishTextureRange) {
    finishTextureRange.addEventListener('input', () => setTextureAmount(finishTextureRange.value, false));
    finishTextureRange.addEventListener('change', () => setTextureAmount(finishTextureRange.value, true));
  }
  if (finishTextureValue) {
    finishTextureValue.addEventListener('input', () => setTextureAmount(finishTextureValue.value, false));
    finishTextureValue.addEventListener('change', () => setTextureAmount(finishTextureValue.value, true));
    finishTextureValue.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finishTextureValue.blur();
    });
  }
  if (finishTextureOutline) {
    finishTextureOutline.addEventListener('change', () => setTextureOutline(finishTextureOutline.checked));
  }
  if (finishTextureAngle) {
    finishTextureAngle.addEventListener('change', () => setTextureAngle(finishTextureAngle.value));
  }
  // "What are these?" — placeholder popup until a real reference image
  // is dropped in.
  const finishHelpBtn = document.getElementById('finish-help-btn');
  const finishHelpModal = document.getElementById('finish-help-modal');
  const finishHelpModalClose = document.getElementById('finish-help-modal-close');
  if (finishHelpBtn && finishHelpModal) {
    finishHelpBtn.addEventListener('click', () => {
      finishHelpModal.classList.add('is-open');
      finishHelpModal.setAttribute('aria-hidden', 'false');
    });
    finishHelpModal.addEventListener('mousedown', (e) => {
      if (e.target === finishHelpModal) {
        finishHelpModal.classList.remove('is-open');
        finishHelpModal.setAttribute('aria-hidden', 'true');
      }
    });
  }
  if (finishHelpModalClose && finishHelpModal) {
    finishHelpModalClose.addEventListener('click', () => {
      finishHelpModal.classList.remove('is-open');
      finishHelpModal.setAttribute('aria-hidden', 'true');
    });
  }

  // "How we calculate price" — same popup pattern as "What are these?"
  // above, just a plain-language explanation next to the price readout.
  const priceHelpBtn = document.getElementById('price-help-btn');
  const priceHelpModal = document.getElementById('price-help-modal');
  const priceHelpModalClose = document.getElementById('price-help-modal-close');
  if (priceHelpBtn && priceHelpModal) {
    priceHelpBtn.addEventListener('click', () => {
      priceHelpModal.classList.add('is-open');
      priceHelpModal.setAttribute('aria-hidden', 'false');
    });
    priceHelpModal.addEventListener('mousedown', (e) => {
      if (e.target === priceHelpModal) {
        priceHelpModal.classList.remove('is-open');
        priceHelpModal.setAttribute('aria-hidden', 'true');
      }
    });
  }
  if (priceHelpModalClose && priceHelpModal) {
    priceHelpModalClose.addEventListener('click', () => {
      priceHelpModal.classList.remove('is-open');
      priceHelpModal.setAttribute('aria-hidden', 'true');
    });
  }

  // ---- Templates gallery ----
  // Entries come from window.CARD_TEMPLATES (templates/templates-data.js)
  // — plain data baked into a normal <script> tag rather than fetched as
  // JSON, since fetch() is blocked outright on a page opened straight
  // from disk (file://...), a very plausible way this editor gets
  // tested, while a script tag loads there exactly like it would from a
  // real server or GitHub Pages. Each entry's front/back is the same
  // Fabric canvas JSON the Save button produces. Loading one runs it
  // through importProjectData, same as Import. Previews are painted with
  // the same paintCardPreview the Mockup panel uses, so a row shows
  // exactly what the template actually looks like, both sides where it
  // has two, not just a name.
  const templatesToggleBtn = document.getElementById('toggle-templates');
  const templatesModal = document.getElementById('templates-modal');
  const templatesModalClose = document.getElementById('templates-modal-close');
  const templatesGrid = document.getElementById('templates-grid');
  function isTemplatesModalOpen() {
    return !!(templatesModal && templatesModal.classList.contains('is-open'));
  }
  function closeTemplatesModal() {
    if (!templatesModal) return;
    templatesModal.classList.remove('is-open');
    templatesModal.setAttribute('aria-hidden', 'true');
  }
  function buildTemplateSidePreview(snapshot, sideLabel) {
    const wrap = document.createElement('div');
    wrap.className = 'editor-template-card-side';
    const canvas = document.createElement('canvas');
    canvas.className = 'editor-template-card-preview';
    canvas.width = 258;
    canvas.height = 162;
    wrap.appendChild(canvas);
    if (sideLabel) {
      const label = document.createElement('span');
      label.className = 'editor-template-card-side-label';
      label.textContent = sideLabel;
      wrap.appendChild(label);
    }
    // Same demotion as an actual load (see the card click handler below)
    // — a Metallic accent would already read as White the instant this
    // template's loaded onto a Silver card, so the gallery thumbnail
    // should show that up front rather than a metallic preview that's
    // about to change color the moment it's picked.
    paintCardPreview(canvas, isSilverCardTypeSelected() ? demoteMetallicFinishesInSnapshot(snapshot) : snapshot);
    return wrap;
  }
  function buildTemplateCard(entry) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'editor-template-card';
    const previews = document.createElement('div');
    previews.className = 'editor-template-card-previews';
    previews.appendChild(buildTemplateSidePreview(entry.front, entry.back ? 'Front' : null));
    if (entry.back) previews.appendChild(buildTemplateSidePreview(entry.back, 'Back'));
    const info = document.createElement('div');
    info.className = 'editor-template-card-info';
    const label = document.createElement('span');
    label.className = 'editor-template-card-label';
    label.textContent = entry.name;
    info.appendChild(label);
    card.appendChild(previews);
    card.appendChild(info);
    card.addEventListener('click', async () => {
      const hasExistingWork = projectHasExistingWork();
      if (hasExistingWork && !(await plmConfirm('Loading this template will replace your current design. Continue?'))) return;
      // A template's own baked-in Metallic finishes (several use it as a
      // default) would be invisible metal-on-metal on a Silver card, same
      // as a manually-applied one — demote to White on the way in rather
      // than loading it and immediately having to fix it.
      const silver = isSilverCardTypeSelected();
      const front = silver ? demoteMetallicFinishesInSnapshot(entry.front) : entry.front;
      const back = silver ? demoteMetallicFinishesInSnapshot(entry.back) : entry.back;
      importProjectData({ app: 'business-card-editor', version: 1, currentSide: 'front', front, back });
      closeTemplatesModal();
    });
    return card;
  }
  function openTemplatesModal() {
    if (!templatesModal || !templatesGrid) return;
    templatesModal.classList.add('is-open');
    templatesModal.setAttribute('aria-hidden', 'false');
    templatesGrid.innerHTML = '';
    const templates = window.CARD_TEMPLATES || [];
    if (!templates.length) {
      templatesGrid.innerHTML = '<p class="editor-side-panel-empty">No templates available.</p>';
      return;
    }
    templates.forEach((entry) => templatesGrid.appendChild(buildTemplateCard(entry)));
  }
  if (templatesToggleBtn) templatesToggleBtn.addEventListener('click', openTemplatesModal);
  if (templatesModalClose) templatesModalClose.addEventListener('click', closeTemplatesModal);
  if (templatesModal) {
    templatesModal.addEventListener('mousedown', (e) => {
      if (e.target === templatesModal) closeTemplatesModal();
    });
  }

  // ---- Card type picker ----
  // Entries come from window.CARD_TYPES (card-types/card-types-data.js)
  // — the physical aluminum blank (color + thickness), chosen separately
  // from the design template above it. Purely a selection UI for now:
  // picking one just updates the bottom-bar button, it doesn't touch the
  // canvas or feed into pricing yet.
  const cardTypeToggleBtn = document.getElementById('toggle-card-type');
  const cardTypeModal = document.getElementById('card-type-modal');
  const cardTypeModalClose = document.getElementById('card-type-modal-close');
  const cardTypeGrid = document.getElementById('card-type-grid');
  const cardTypeBtnSwatch = document.getElementById('card-type-btn-swatch');
  const cardTypeBtnValue = document.getElementById('card-type-btn-value');
  function closeCardTypeModal() {
    if (!cardTypeModal) return;
    cardTypeModal.classList.remove('is-open');
    cardTypeModal.setAttribute('aria-hidden', 'true');
  }
  function updateCardTypeButton() {
    if (!cardTypeBtnValue) return;
    const entry = (window.CARD_TYPES || []).find((t) => t.id === selectedCardTypeId);
    if (!entry) {
      cardTypeBtnValue.textContent = 'Choose color & thickness';
      if (cardTypeBtnSwatch) cardTypeBtnSwatch.style.background = '#3a3a3a';
      return;
    }
    cardTypeBtnValue.textContent = `${entry.color} · ${entry.thicknessIn} (${entry.thicknessMm})`;
    if (cardTypeBtnSwatch) cardTypeBtnSwatch.style.background = entry.swatch;
  }
  // One row per color, with its two thickness options (0.4mm, 0.8mm)
  // shown side by side within that row — same left/right pairing as the
  // templates gallery's front/back preview, but here the pair is the
  // two thicknesses of the same color rather than two sides of one design.
  function buildCardTypeOption(entry) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'editor-cardtype-option';
    if (entry.id === selectedCardTypeId) option.classList.add('is-selected');
    const preview = document.createElement('div');
    preview.className = 'editor-cardtype-option-preview';
    if (entry.photo) {
      preview.style.backgroundImage = `url(${entry.photo})`;
    } else {
      // No product photo yet -- render a brushed-aluminum swatch in the
      // real anodized color instead of a flat placeholder chip.
      const canvas = document.createElement('canvas');
      canvas.className = 'editor-cardtype-option-preview-canvas';
      canvas.width = 680;
      canvas.height = Math.round(680 * (CARD_H_PX / CARD_W_PX));
      preview.appendChild(canvas);
      paintCardTypeSwatch(canvas, entry.swatch);
    }
    const thickness = document.createElement('span');
    thickness.className = 'editor-cardtype-option-thickness';
    thickness.textContent = `${entry.thicknessIn} (${entry.thicknessMm})`;
    option.appendChild(preview);
    option.appendChild(thickness);
    option.addEventListener('click', () => {
      selectedCardTypeId = entry.id;
      updateCardTypeButton();
      cardTypeGrid.querySelectorAll('.editor-cardtype-option.is-selected').forEach((el) => el.classList.remove('is-selected'));
      option.classList.add('is-selected');
      closeCardTypeModal();
      updateFinishAvailability();
      // Silver is the same color as the Metallic finish itself, so any
      // Metallic object already on the card (either side) falls back to
      // White the moment Silver becomes the selected card type.
      if (isSilverCardTypeSelected()) {
        demoteMetallicToWhiteOnCurrentCanvas();
        demoteMetallicToWhiteInOtherSides();
      }
      // The Mockup panel's aluminum-card color needs to match the newly
      // picked type right away — re-paint whichever side(s) currently
      // exist (renderCardPreview no-ops harmlessly on a side with no
      // canvas yet, i.e. before Back has been added).
      renderCardPreview('front');
      renderCardPreview('back');
    });
    return option;
  }
  function buildCardTypeRow(colorGroup) {
    const row = document.createElement('div');
    row.className = 'editor-cardtype-row';
    const label = document.createElement('span');
    label.className = 'editor-cardtype-row-color';
    label.textContent = colorGroup.color;
    const options = document.createElement('div');
    options.className = 'editor-cardtype-row-options';
    colorGroup.entries.forEach((entry) => options.appendChild(buildCardTypeOption(entry)));
    row.appendChild(label);
    row.appendChild(options);
    return row;
  }
  function groupCardTypesByColor(types) {
    const groups = [];
    const byColor = new Map();
    types.forEach((entry) => {
      if (!byColor.has(entry.color)) {
        const group = { color: entry.color, entries: [] };
        byColor.set(entry.color, group);
        groups.push(group);
      }
      byColor.get(entry.color).entries.push(entry);
    });
    return groups;
  }
  function openCardTypeModal() {
    if (!cardTypeModal || !cardTypeGrid) return;
    cardTypeModal.classList.add('is-open');
    cardTypeModal.setAttribute('aria-hidden', 'false');
    cardTypeGrid.innerHTML = '';
    const types = window.CARD_TYPES || [];
    if (!types.length) {
      cardTypeGrid.innerHTML = '<p class="editor-side-panel-empty">No card types available.</p>';
      cardTypeGrid.scrollTop = 0;
      return;
    }
    groupCardTypesByColor(types).forEach((group) => cardTypeGrid.appendChild(buildCardTypeRow(group)));
    cardTypeGrid.scrollTop = 0;
  }
  if (cardTypeToggleBtn) cardTypeToggleBtn.addEventListener('click', openCardTypeModal);
  if (cardTypeModalClose) cardTypeModalClose.addEventListener('click', closeCardTypeModal);
  if (cardTypeModal) {
    cardTypeModal.addEventListener('mousedown', (e) => {
      if (e.target === cardTypeModal) closeCardTypeModal();
    });
  }
  updateCardTypeButton();
  updateFinishAvailability();

  function handleSelection(e) {
    // getActiveObject() first, not e.selected[0]: for a multi-selection,
    // e.selected[0] is just one of the newly-selected members, which
    // would wrongly show that single object's toolbar/edge indicator
    // instead of recognizing the real active object is the whole
    // ActiveSelection.
    const obj = fabricCanvas.getActiveObject() || (e.selected && e.selected[0]);
    // Selection moved to something outside the currently-loose group
    // piece(s) — re-form the group before handling whatever's newly
    // selected (which stays selected; see endGroupEditSession).
    if (groupEditSession && !isWithinGroupEditSession(obj)) endGroupEditSession();
    if (finishModeActive) {
      refreshFinishUI(obj);
      return;
    }
    // A multi-selection (activeSelection) is eligible too, as long as at
    // least one member is text or a shape — showObjectToolbarFor decides
    // text vs. shape mode from the actual mix (shape wins on a tie).
    const isEligible = obj && (
      obj.type === 'i-text'
      || SHAPE_TYPES.includes(obj.type)
      || (obj.type === 'activeSelection' && obj.getObjects().some((m) => m.type === 'i-text' || SHAPE_TYPES.includes(m.type)))
    );
    if (isEligible) {
      showObjectToolbarFor(obj);
      applyScalingControlsVisibility(obj);
    } else {
      hideObjectToolbar();
    }
  }
  fabricCanvas.on('selection:created', handleSelection);
  fabricCanvas.on('selection:updated', handleSelection);
  fabricCanvas.on('selection:cleared', () => {
    if (suppressGroupSessionEnd) return;
    endGroupEditSession();
    if (finishModeActive) {
      refreshFinishUI(null);
      return;
    }
    hideObjectToolbar();
  });

  // Clean up a text box left empty (placed, then clicked away from
  // without typing anything) instead of leaving a stray empty object.
  // Otherwise, refresh the transform fields — Fabric only settles an
  // IText's real width/height once editing ends, so a box created and
  // immediately typed into needs a refresh here (the one taken at
  // placement time was measured against the still-empty text).
  fabricCanvas.on('text:editing:exited', (opt) => {
    const obj = opt.target;
    if (!obj || obj.type !== 'i-text') return;
    if (!obj.text.trim()) {
      fabricCanvas.remove(obj);
      fabricCanvas.requestRenderAll();
      return;
    }
    // New text is created with a top-left origin (so it grows naturally
    // rightward/downward from the click point while typing), then once
    // there's real content the anchor auto-aligns to center — the
    // sensible default for a just-placed object, without disturbing the
    // typing experience itself.
    setObjectAnchor(obj, 'c');
    fabricCanvas.requestRenderAll();
    refreshTransformFields(obj);
    refreshLayersList();
    pushHistory();
  });
  // Keeps a text layer's row showing its actual content live while typing,
  // not just once editing ends.
  fabricCanvas.on('text:changed', refreshLayersList);

  // Dragging a corner handle on a text object should change its font size,
  // not stretch it. Folding scale into fontSize on every drag frame forces
  // a full text re-layout each frame — laggy, and it fights with Fabric's
  // own live transform controller (causing the box to clip/distort mid-
  // drag). So: let Fabric's native scaling run smoothly while dragging
  // (just keep the size field's readout live), and only convert scale
  // into a real fontSize once, when the drag ends.
  fabricCanvas.on('object:scaling', (opt) => {
    const obj = opt.target;
    if (!obj) return;
    if (obj.type === 'i-text') {
      // In uniform mode, keep the font-size readout live during the drag
      // (the actual fontSize/scale reset happens once, on object:modified).
      // In non-uniform mode there's no fontSize equivalent to preview —
      // scaleX/scaleY themselves are the result — so just leave it be.
      if (!isNonUniformAllowed(obj)) {
        if (fontSizeInput) fontSizeInput.value = Math.max(1, Math.round(obj.fontSize * ((obj.scaleX + obj.scaleY) / 2)));
      }
    } else if (!isNonUniformAllowed(obj)) {
      // Shapes: Fabric's own corner-drag already scales scaleX/scaleY
      // independently by default (free stretch) — that's exactly the
      // non-uniform default we want. Uniform mode instead needs an
      // active constraint during the drag: mirror the larger axis onto
      // the smaller one so the shape can't be dragged into a distortion.
      const s = Math.max(Math.abs(obj.scaleX), Math.abs(obj.scaleY));
      obj.set({ scaleX: s, scaleY: s });
    }
    refreshTransformFields(obj);
  });
  fabricCanvas.on('object:modified', (opt) => {
    const obj = opt.target;
    if (!obj) return;
    if (obj.type === 'i-text' && !isNonUniformAllowed(obj) && (obj.scaleX !== 1 || obj.scaleY !== 1)) {
      // Uniform: fold scale into fontSize and reset scale to 1, same
      // anti-distortion approach as before.
      const newSize = Math.max(1, Math.round(obj.fontSize * ((obj.scaleX + obj.scaleY) / 2)));
      obj.set({ fontSize: newSize, scaleX: 1, scaleY: 1 });
      fabricCanvas.requestRenderAll();
      if (fontSizeInput) fontSizeInput.value = newSize;
    }
    // Non-uniform text: leave scaleX/scaleY exactly as dragged — that
    // stretch *is* the result. Shapes: scaleX/scaleY themselves already
    // *are* the shape's size in both modes — nothing to fold anywhere.
    refreshTransformFields(obj);
  });
  // ---- Smart alignment guides while dragging ----
  // A moving object's edges/center snap to the card's edges/center and to
  // other objects' edges/centers (Figma/Illustrator-style "smart
  // guides"), drawing a thin green line for whichever axis just snapped.
  // The lines are plain temporary Fabric objects, redrawn fresh each drag
  // frame and cleared once the drag ends.
  const SNAP_THRESHOLD = 6; // canvas px — scales with the app's own CSS zoom automatically, since that zooms the whole canvas uniformly
  const SNAP_LINE_COLOR = '#3ddc71';
  let snapLines = [];
  function clearSnapGuides() {
    if (!snapLines.length) return;
    snapLines.forEach((l) => fabricCanvas.remove(l));
    snapLines = [];
    fabricCanvas.requestRenderAll();
  }
  function drawSnapLine(isVertical, pos) {
    const w = fabricCanvas.getWidth();
    const h = fabricCanvas.getHeight();
    const coords = isVertical ? [pos, -50, pos, h + 50] : [-50, pos, w + 50, pos];
    const line = new fabric.Line(coords, {
      stroke: SNAP_LINE_COLOR, strokeWidth: 1, selectable: false, evented: false,
      excludeFromExport: true, hoverCursor: 'default',
    });
    fabricCanvas.add(line);
    fabricCanvas.bringToFront(line);
    snapLines.push(line);
  }
  // Left/center/right (or top/center/bottom) of an object's axis-aligned
  // bounding box — translation shifts this box by the same delta as the
  // object itself regardless of rotation, so snapping math stays valid
  // even for a rotated shape.
  function snapBoundsOf(obj) {
    const r = obj.getBoundingRect(true, true);
    return {
      xs: [r.left, r.left + r.width / 2, r.left + r.width],
      ys: [r.top, r.top + r.height / 2, r.top + r.height],
    };
  }
  function applySnapping(obj) {
    // A multi-object drag snaps as one block, against everything else.
    const moving = obj.type === 'activeSelection' ? obj.getObjects() : [obj];
    const others = fabricCanvas.getObjects().filter((o) => o.evented !== false && !moving.includes(o));
    const targetXs = [CARD_OFFSET_X, CARD_OFFSET_X + CARD_W_PX / 2, CARD_OFFSET_X + CARD_W_PX];
    const targetYs = [CARD_OFFSET_Y, CARD_OFFSET_Y + CARD_H_PX / 2, CARD_OFFSET_Y + CARD_H_PX];
    others.forEach((o) => {
      const b = snapBoundsOf(o);
      targetXs.push(...b.xs);
      targetYs.push(...b.ys);
    });
    const own = snapBoundsOf(obj);
    let bestX = null;
    own.xs.forEach((x) => {
      targetXs.forEach((tx) => {
        const d = tx - x;
        if (Math.abs(d) <= SNAP_THRESHOLD && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, tx };
      });
    });
    let bestY = null;
    own.ys.forEach((y) => {
      targetYs.forEach((ty) => {
        const d = ty - y;
        if (Math.abs(d) <= SNAP_THRESHOLD && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, ty };
      });
    });
    if (bestX) {
      obj.left += bestX.d;
      drawSnapLine(true, bestX.tx);
    }
    if (bestY) {
      obj.top += bestY.d;
      drawSnapLine(false, bestY.ty);
    }
    if (bestX || bestY) obj.setCoords();
    return { x: !!bestX, y: !!bestY };
  }

  // ---- Equal-spacing ("same gap") snap guides ----
  // Beyond plain edge/center alignment above, this also checks whether
  // the object being dragged sits the exact same distance from its
  // nearest neighbor on each side — another object, or the card's own
  // edge — as that neighbor is on its own far side. That's the "equal
  // gap"/smart-spacing guide most design tools show, distinct from
  // (and drawn differently than) an alignment snap line: a short
  // measuring segment with end caps, spanning just the two gaps being
  // compared, rather than a line all the way across the canvas. Only
  // checked per axis when applySnapping above didn't already snap that
  // same axis, so the two features never fight over one move.
  const SPACING_TICK_LEN = 5; // px, the little perpendicular caps at each end of a spacing line
  function rectOf(obj) {
    const r = obj.getBoundingRect(true, true);
    return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height, width: r.width, height: r.height };
  }
  // isRow: true draws a horizontal measuring segment (spacing along X, at
  // a fixed Y); false draws a vertical one (spacing along Y, at a fixed X).
  function drawSpacingLine(isRow, fixedPos, from, to) {
    const coords = isRow ? [from, fixedPos, to, fixedPos] : [fixedPos, from, fixedPos, to];
    const line = new fabric.Line(coords, {
      stroke: SNAP_LINE_COLOR, strokeWidth: 1, selectable: false, evented: false,
      excludeFromExport: true, hoverCursor: 'default',
    });
    fabricCanvas.add(line);
    fabricCanvas.bringToFront(line);
    snapLines.push(line);
    [from, to].forEach((pos) => {
      const capCoords = isRow
        ? [pos, fixedPos - SPACING_TICK_LEN, pos, fixedPos + SPACING_TICK_LEN]
        : [fixedPos - SPACING_TICK_LEN, pos, fixedPos + SPACING_TICK_LEN, pos];
      const cap = new fabric.Line(capCoords, {
        stroke: SNAP_LINE_COLOR, strokeWidth: 1, selectable: false, evented: false,
        excludeFromExport: true, hoverCursor: 'default',
      });
      fabricCanvas.add(cap);
      fabricCanvas.bringToFront(cap);
      snapLines.push(cap);
    });
  }
  function applySpacingSnap(obj, skipX, skipY) {
    const moving = obj.type === 'activeSelection' ? obj.getObjects() : [obj];
    const others = fabricCanvas.getObjects().filter((o) => o.evented !== false && !moving.includes(o));
    const rects = others.map(rectOf);
    const cardLeft = { left: CARD_OFFSET_X, right: CARD_OFFSET_X, top: CARD_OFFSET_Y, bottom: CARD_OFFSET_Y + CARD_H_PX };
    const cardRight = { left: CARD_OFFSET_X + CARD_W_PX, right: CARD_OFFSET_X + CARD_W_PX, top: CARD_OFFSET_Y, bottom: CARD_OFFSET_Y + CARD_H_PX };
    const cardTop = { top: CARD_OFFSET_Y, bottom: CARD_OFFSET_Y, left: CARD_OFFSET_X, right: CARD_OFFSET_X + CARD_W_PX };
    const cardBottom = { top: CARD_OFFSET_Y + CARD_H_PX, bottom: CARD_OFFSET_Y + CARD_H_PX, left: CARD_OFFSET_X, right: CARD_OFFSET_X + CARD_W_PX };
    if (!skipX) {
      const own = rectOf(obj);
      let leftN = null;
      let rightN = null;
      rects.concat([cardLeft, cardRight]).forEach((c) => {
        if (c.right <= own.left + 0.01 && (!leftN || c.right > leftN.right)) leftN = c;
        if (c.left >= own.right - 0.01 && (!rightN || c.left < rightN.left)) rightN = c;
      });
      if (leftN && rightN) {
        const gapLeft = own.left - leftN.right;
        const gapRight = rightN.left - own.right;
        if (gapLeft >= 0 && gapRight >= 0 && Math.abs(gapLeft - gapRight) <= SNAP_THRESHOLD) {
          const newLeft = (leftN.right + rightN.left - own.width) / 2;
          obj.left += newLeft - own.left;
          obj.setCoords();
          const lineY = own.top + own.height / 2;
          drawSpacingLine(true, lineY, leftN.right, newLeft);
          drawSpacingLine(true, lineY, newLeft + own.width, rightN.left);
        }
      }
    }
    if (!skipY) {
      const own = rectOf(obj);
      let topN = null;
      let bottomN = null;
      rects.concat([cardTop, cardBottom]).forEach((c) => {
        if (c.bottom <= own.top + 0.01 && (!topN || c.bottom > topN.bottom)) topN = c;
        if (c.top >= own.bottom - 0.01 && (!bottomN || c.top < bottomN.top)) bottomN = c;
      });
      if (topN && bottomN) {
        const gapTop = own.top - topN.bottom;
        const gapBottom = bottomN.top - own.bottom;
        if (gapTop >= 0 && gapBottom >= 0 && Math.abs(gapTop - gapBottom) <= SNAP_THRESHOLD) {
          const newTop = (topN.bottom + bottomN.top - own.height) / 2;
          obj.top += newTop - own.top;
          obj.setCoords();
          const lineX = own.left + own.width / 2;
          drawSpacingLine(false, lineX, topN.bottom, newTop);
          drawSpacingLine(false, lineX, newTop + own.height, bottomN.top);
        }
      }
    }
  }
  fabricCanvas.on('mouse:up', clearSnapGuides);

  // Live readouts while dragging the move handle or the rotate handle.
  fabricCanvas.on('object:moving', (opt) => {
    if (!opt.target) return;
    clearSnapGuides();
    const snapped = applySnapping(opt.target);
    applySpacingSnap(opt.target, snapped.x, snapped.y);
    refreshTransformFields(opt.target);
  });
  fabricCanvas.on('object:rotating', (opt) => {
    if (!opt.target) return;
    // Shift snaps to the nearest 45deg increment, same modifier
    // convention as most design tools — checked on the original mouse
    // event, not a tracked keydown/up pair, so it's live-toggleable
    // mid-drag with no extra state to keep in sync.
    if (opt.e && opt.e.shiftKey) {
      opt.target.angle = Math.round(opt.target.angle / 45) * 45;
      opt.target.setCoords();
    }
    refreshTransformFields(opt.target);
  });

  if (fontFamilySelect) {
    fontFamilySelect.addEventListener('change', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj) return;
      obj.set('fontFamily', fontFamilySelect.value);
      fabricCanvas.requestRenderAll();
      pushHistory();
    });
  }

  // ---- Load system fonts ----
  // The Local Font Access API (window.queryLocalFonts) lets a page list
  // every font actually installed on the user's computer — but it's
  // permission-gated (needs a user gesture, like this button click) and
  // only supported in Chromium browsers (Chrome/Edge), not Firefox/
  // Safari, so it's an opt-in enhancement over the small built-in list
  // rather than something that can just run on page load.
  const loadFontsBtn = document.getElementById('load-system-fonts-btn');
  if (loadFontsBtn) {
    if (!('queryLocalFonts' in window)) {
      // Stays clickable (not the native `disabled`, which would silently
      // swallow the click instead of explaining anything) — styled as
      // muted instead, and clicking it surfaces the same "Chrome only"
      // toast every other Chrome-exclusive feature would use.
      loadFontsBtn.classList.add('is-unavailable');
      loadFontsBtn.title = 'Loading system fonts needs Chrome or Edge — not supported in this browser';
      loadFontsBtn.addEventListener('click', () => {
        showChromeOnlyToast('Loading system fonts');
      });
    } else {
      loadFontsBtn.addEventListener('click', async () => {
        try {
          const fonts = await window.queryLocalFonts();
          // Keep the actual FontData objects too (not just names) — each
          // one's .blob() is the only way this page can ever get the real
          // font file bytes, which is what lets Union/Subtract trace an
          // exact glyph outline instead of the raster-trace fallback. See
          // getOpentypeFontFor.
          localFontDataByFamily.clear();
          fonts.forEach((f) => {
            if (!localFontDataByFamily.has(f.family)) localFontDataByFamily.set(f.family, []);
            localFontDataByFamily.get(f.family).push(f);
          });
          const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
          if (!families.length || !fontFamilySelect) return;
          const current = fontFamilySelect.value;
          fontFamilySelect.innerHTML = '';
          families.forEach((family) => {
            const opt = document.createElement('option');
            opt.value = family;
            opt.textContent = family;
            fontFamilySelect.appendChild(opt);
          });
          fontFamilySelect.value = families.includes(current) ? current : families[0];
          fontFamilySelect.dispatchEvent(new Event('change'));
        } catch (err) {
          // User declined the permission prompt, or it's unavailable for
          // some other reason — leave the existing font list as-is.
          console.warn('Could not load system fonts:', err);
        }
      });
    }
  }
  if (fontSizeInput) {
    fontSizeInput.addEventListener('input', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj) return;
      const size = parseInt(fontSizeInput.value, 10);
      if (!Number.isNaN(size) && size > 0) {
        obj.set('fontSize', size);
        fabricCanvas.requestRenderAll();
        refreshTransformFields(obj);
      }
    });
    // History is recorded on 'change' (fires once the field is left),
    // not on every 'input' keystroke above — otherwise typing a font
    // size would flood the undo stack with one step per digit.
    fontSizeInput.addEventListener('change', () => pushHistory());
  }
  alignButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj) return;
      obj.set('textAlign', btn.dataset.align);
      alignButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      fabricCanvas.requestRenderAll();
      pushHistory();
    });
  });

  // ---- Align dropdowns: text-align and position-on-card each get their
  // own toggle (rather than one combined menu) so each stays a quick,
  // single-purpose pick.
  const allAlignDropdowns = document.querySelectorAll('.editor-align-dropdown');
  function closeAlignDropdowns(except) {
    allAlignDropdowns.forEach((d) => {
      if (d === except) return;
      d.classList.remove('is-open');
      const btn = d.querySelector('.editor-align-dropdown-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }
  function setupAlignDropdown(dropdownId, btnId) {
    const dropdown = document.getElementById(dropdownId);
    const btn = document.getElementById(btnId);
    if (!dropdown || !btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) closeAlignDropdowns(dropdown);
    });
    // Close the panel once a choice is made, for a snappier feel.
    dropdown.querySelectorAll('.editor-align-btn').forEach((alignBtn) => {
      alignBtn.addEventListener('click', () => {
        dropdown.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  }
  setupAlignDropdown('text-align-dropdown', 'text-align-dropdown-btn');
  setupAlignDropdown('position-align-dropdown', 'position-align-dropdown-btn');
  setupAlignDropdown('anchor-dropdown', 'anchor-dropdown-btn');
  setupAlignDropdown('stroke-settings-dropdown', 'stroke-settings-dropdown-btn');
  document.addEventListener('click', (e) => {
    if (![...allAlignDropdowns].some((d) => d.contains(e.target))) closeAlignDropdowns();
  });

  // Transform fields (rotation, position, size) commit their value on
  // Enter or on blur — NOT on every keystroke. Applying live on 'input'
  // meant a field that also refreshes itself afterward (size, notably)
  // rewrote its own value mid-typing, fighting the cursor and making it
  // feel like you couldn't type or delete in it. Committing once, after
  // the user is done, avoids that entirely.
  function commitOnEnterOrBlur(input, applyFn) {
    if (!input) return;
    const commit = () => {
      const val = parseFloat(input.value);
      if (!Number.isNaN(val)) applyFn(val);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      commit();
      input.blur();
    });
    input.addEventListener('blur', commit);
  }

  // ---- Rotation field ----
  commitOnEnterOrBlur(rotationInput, (angle) => {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    obj.set('angle', angle);
    obj.setCoords();
    fabricCanvas.requestRenderAll();
    refreshTransformFields(obj);
    pushHistory();
  });

  // ---- Anchor picker: clicking a point in the dropdown grid sets it ----
  anchorPanelButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj) return;
      setObjectAnchor(obj, btn.dataset.anchor);
      fabricCanvas.requestRenderAll();
      refreshTransformFields(obj);
      pushHistory();
    });
  });

  // ---- Position fields (anchor point, in the current display unit from
  // the card's top-left) ----
  // obj.left/top already *are* the anchor point's coordinates once
  // originX/Y is set to match it, so this is a direct set — no delta
  // math needed.
  function moveActiveObjectAnchorTo(axis, value) {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    if (axis === 'x') obj.set({ left: CARD_OFFSET_X + value * pxPerUnit() });
    else obj.set({ top: CARD_OFFSET_Y + value * pxPerUnit() });
    obj.setCoords();
    fabricCanvas.requestRenderAll();
    refreshTransformFields(obj);
    pushHistory();
  }
  commitOnEnterOrBlur(posXInput, (val) => moveActiveObjectAnchorTo('x', val));
  commitOnEnterOrBlur(posYInput, (val) => moveActiveObjectAnchorTo('y', val));

  // ---- Size fields (width/height, in the current display unit) ----
  // Text, uniform (default): folds into fontSize so both dimensions move
  // together, same anti-distortion approach as corner-drag scaling.
  // Text, non-uniform: only the edited axis's scale changes.
  // Shapes: there's no fontSize equivalent, so it's always scaleX/scaleY
  // directly — uniform mode scales both by the edited axis's ratio,
  // non-uniform mode only touches the one axis.
  function applySizeMm(axis, value) {
    const obj = fabricCanvas.getActiveObject();
    if (!obj || value <= 0) return;
    const targetPx = value * pxPerUnit();
    const nonUniform = isNonUniformAllowed(obj);
    if (obj.type === 'i-text') {
      if (nonUniform) {
        if (axis === 'w') obj.set({ scaleX: targetPx / obj.width });
        else obj.set({ scaleY: targetPx / obj.height });
      } else {
        const current = axis === 'w' ? obj.getScaledWidth() : obj.getScaledHeight();
        if (!current) return;
        const ratio = targetPx / current;
        const newSize = Math.max(1, Math.round(obj.fontSize * ratio));
        obj.set({ fontSize: newSize, scaleX: 1, scaleY: 1 });
        if (fontSizeInput) fontSizeInput.value = newSize;
      }
    } else if (nonUniform) {
      if (axis === 'w') obj.set({ scaleX: targetPx / obj.width });
      else obj.set({ scaleY: targetPx / obj.height });
    } else {
      const current = axis === 'w' ? displayWidthOf(obj) : displayHeightOf(obj);
      if (!current) return;
      const ratio = targetPx / current;
      obj.set({ scaleX: obj.scaleX * ratio, scaleY: obj.scaleY * ratio });
    }
    obj.setCoords();
    fabricCanvas.requestRenderAll();
    refreshTransformFields(obj);
    pushHistory();
  }
  commitOnEnterOrBlur(sizeWInput, (val) => applySizeMm('w', val));
  commitOnEnterOrBlur(sizeHInput, (val) => applySizeMm('h', val));

  // ---- Stroke width (only meaningful while a shape is in stroke mode) ----
  commitOnEnterOrBlur(strokeWidthInput, (val) => {
    const obj = fabricCanvas.getActiveObject();
    if (!obj || shapeFillModeFor(obj) !== 'stroke') return;
    const px = Math.max(0.01, val) * pxPerUnit();
    if (obj.type === 'group') {
      eachFillableDescendant(obj, (child) => { child._strokeWidthPx = px; });
    } else {
      obj._strokeWidthPx = px;
    }
    applyStrokeRender(obj);
    fabricCanvas.requestRenderAll();
    refreshTransformFields(obj);
    pushHistory();
  });

  // ---- Corner radius (rect/triangle corners, or a line's end caps) ----
  // Rect and Line round in place via their own native properties. A
  // triangle has no native radius in Fabric, so rounding it (past the
  // first, still-square state) rebuilds it as a Path with the rounded
  // geometry baked in — same object identity concerns as the boolean-op
  // result swap elsewhere in this file: remove the old object, insert the
  // replacement at the same z-index, carry selection over.
  function applyCornerRadius(obj, px) {
    const clamped = Math.max(0, px);
    if (obj.type === 'rect') {
      const maxR = Math.min(obj.width, obj.height) / 2;
      obj.set({ rx: Math.min(clamped, maxR), ry: Math.min(clamped, maxR) });
      obj._cornerRadiusPx = clamped;
      obj.setCoords();
      fabricCanvas.requestRenderAll();
      refreshCornerRadiusUI(obj);
      pushHistory();
      return;
    }
    if (obj.type === 'line') {
      obj.set({ strokeLineCap: clamped > 0 ? 'round' : 'butt' });
      obj._cornerRadiusPx = clamped;
      fabricCanvas.requestRenderAll();
      refreshCornerRadiusUI(obj);
      pushHistory();
      return;
    }
    if (obj.type === 'triangle' && clamped <= 0) {
      // Already square-cornered and staying that way — no need to
      // convert it into a Path at all.
      obj._cornerRadiusPx = 0;
      refreshCornerRadiusUI(obj);
      return;
    }
    const width = obj.type === 'triangle' ? obj.width : obj._triWidth;
    const height = obj.type === 'triangle' ? obj.height : obj._triHeight;
    const newPath = makeRoundedTrianglePath(width, height, clamped, {
      left: obj.left, top: obj.top, scaleX: obj.scaleX, scaleY: obj.scaleY, angle: obj.angle,
      fill: obj.fill, stroke: obj.stroke, strokeWidth: obj.strokeWidth,
      strokeAlign: obj.strokeAlign, _strokeWidthPx: obj._strokeWidthPx,
      strokeDashArray: obj.strokeDashArray,
      cardFinish: obj.cardFinish, cardFinishTexture: obj.cardFinishTexture, cardFinishOutline: obj.cardFinishOutline,
      cardFinishAngle: obj.cardFinishAngle,
    });
    const index = fabricCanvas.getObjects().indexOf(obj);
    fabricCanvas.remove(obj);
    fabricCanvas.insertAt(newPath, index, false);
    // Rebuilds the stroke-mode clip (if any) against the new rounded
    // geometry — the old clip was shaped for the old, square corners.
    if (shapeFillModeFor(newPath) === 'stroke') applyStrokeRender(newPath);
    newPath.setCoords();
    fabricCanvas.setActiveObject(newPath);
    fabricCanvas.requestRenderAll();
    refreshCornerRadiusUI(newPath);
    refreshFillModeUI(newPath);
    refreshTransformFields(newPath);
    refreshLayersList();
    pushHistory();
  }
  commitOnEnterOrBlur(cornerRadiusInput, (val) => {
    const obj = fabricCanvas.getActiveObject();
    if (!isRoundableShape(obj)) return;
    applyCornerRadius(obj, val * pxPerUnit());
  });

  // ---- Scaling checkboxes ("Non-uniform scale" for both text and
  // shapes) — only ever one is visible at a time, but both just need to
  // refresh the active object's handle visibility when toggled. ----
  [nonUniformCheckbox, shapeNonUniformCheckbox].forEach((checkbox) => {
    if (!checkbox) return;
    checkbox.addEventListener('change', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj) return;
      applyScalingControlsVisibility(obj);
      fabricCanvas.requestRenderAll();
    });
  });

  // ---- Object-position aligns — move the selected object's bounding box
  // against the card's edges/center (distinct from the text-align buttons
  // above, which align text within its own box). Works off each object's
  // absolute bounding rect rather than its raw left/top, so it's correct
  // regardless of the object's origin, scale, or rotation.
  const objAlignButtons = document.querySelectorAll('.editor-align-btn[data-align-op]');
  // Shifts obj so its bounding box aligns to `target` ({left, top, width,
  // height}, in absolute canvas coordinates) per op — shared by both a
  // single object aligning to the card and a multi-selection's other
  // members aligning to the first one selected.
  function alignRectTo(obj, op, target) {
    const rect = obj.getBoundingRect(true, true);
    let dx = 0;
    let dy = 0;
    if (op === 'left' || op === 'center' || op === 'center-h') {
      const targetLeft = op === 'left' ? target.left : target.left + (target.width - rect.width) / 2;
      dx = targetLeft - rect.left;
    } else if (op === 'right') {
      dx = (target.left + target.width) - (rect.left + rect.width);
    }
    if (op === 'top' || op === 'center' || op === 'center-v') {
      const targetTop = op === 'top' ? target.top : target.top + (target.height - rect.height) / 2;
      dy = targetTop - rect.top;
    } else if (op === 'bottom') {
      dy = (target.top + target.height) - (rect.top + rect.height);
    }
    obj.set({ left: obj.left + dx, top: obj.top + dy });
    obj.setCoords();
  }
  function alignActiveObject(op) {
    const active = fabricCanvas.getActiveObject();
    if (!active) return;
    if (active.type === 'activeSelection' && active.getObjects().length > 1) {
      // Align every other selected object to the first one selected —
      // picking an anchor and lining the rest up against it — rather
      // than moving the whole selection as a block against the card.
      const members = active.getObjects();
      const target = members[0].getBoundingRect(true, true);
      members.slice(1).forEach((obj) => alignRectTo(obj, op, target));
      fabricCanvas.requestRenderAll();
      refreshTransformFields(active);
      pushHistory();
      return;
    }
    const target = { left: CARD_OFFSET_X, top: CARD_OFFSET_Y, width: CARD_W_PX, height: CARD_H_PX };
    alignRectTo(active, op, target);
    fabricCanvas.requestRenderAll();
    refreshTransformFields(active);
    pushHistory();
  }
  objAlignButtons.forEach((btn) => {
    btn.addEventListener('click', () => alignActiveObject(btn.dataset.alignOp));
  });

  // ---- Escape exits text editing, deselects, or backs out a step at a
  // time ----
  // Fabric doesn't bind any of this itself (only clicking away or Enter
  // exits editing), but it's all the expected shortcut, so wired up
  // explicitly, each step only reached once the one before it doesn't
  // apply: leave text-editing first (matching how Enter/click-away
  // already behave) or deselect a selected object outright; with nothing
  // selected, close the Layers/Finish panel if one's open; with neither
  // an object nor a panel, fall back to the Select tool (leaving
  // whichever other tool was active).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isShapeSizeModalOpen()) {
      cancelShapeSizeModal();
      return;
    }
    if (isOversizeModalOpen()) {
      closeOversizeModal();
      return;
    }
    if (isSaveAsModalOpen()) {
      closeSaveAsModal();
      return;
    }
    if (isTemplatesModalOpen()) {
      closeTemplatesModal();
      return;
    }
    const obj = fabricCanvas.getActiveObject();
    if (obj) {
      if (obj.isEditing) {
        obj.exitEditing();
        return;
      }
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
      return;
    }
    if (finishModeActive) {
      setFinishMode(false);
      return;
    }
    if (sidePanel && sidePanel.classList.contains('is-open')) {
      panelToggles.forEach((b) => b.classList.remove('is-active'));
      sidePanel.classList.remove('is-open');
      return;
    }
    const selectBtn = document.getElementById('tool-select');
    if (selectBtn && !selectBtn.classList.contains('is-active')) selectBtn.click();
  });

  // ---- Delete the selected object(s) ----
  // Skip it while a text object is actively being edited (Backspace/Delete
  // there should just edit the text, which Fabric already handles) and
  // while focus is in one of the toolbar's own inputs.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const active = fabricCanvas.getActiveObject();
    if (!active || active.isEditing) return;
    e.preventDefault();
    deleteActiveObjects();
  });

  // ---- Copy/Paste keyboard shortcuts ----
  // Skipped in the same cases as Delete above: an input/textarea/select
  // has focus (native copy/paste should win there), or a text object is
  // actively being edited (Fabric's own hidden textarea has focus then,
  // which reports as tag === 'TEXTAREA' too, so it's already covered).
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key !== 'c' && key !== 'v') return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (key === 'c') {
      const active = fabricCanvas.getActiveObject();
      if (!active) return;
      e.preventDefault();
      copyActiveObjects();
    } else {
      if (!clipboardObjects || !clipboardObjects.length) return;
      e.preventDefault();
      pasteClipboard();
    }
  });

  // ---- Right-click context menu ----
  // Reflects whatever is selected at the moment it's opened: right-
  // clicking an object that isn't already part of the current selection
  // selects it first (so the menu always acts on what you just clicked,
  // matching how this works in most other apps), while right-clicking
  // within an existing multi-selection leaves it alone so Group/Union/
  // Subtract can still see the whole thing.
  const contextMenu = document.getElementById('context-menu');
  if (contextMenu) {
    const menuActions = {
      'bring-front': bringActiveToFront,
      'send-back': sendActiveToBack,
      copy: copyActiveObjects,
      paste: pasteClipboard,
      group: groupActiveSelection,
      ungroup: ungroupActiveObject,
      'remove-from-group': () => {
        const active = fabricCanvas.getActiveObject();
        removeFromGroup(active ? (active.type === 'activeSelection' ? active.getObjects() : [active]) : []);
      },
      union: runUnion,
      subtract: runSubtract,
      delete: deleteActiveObjects,
    };
    function closeContextMenu() {
      contextMenu.classList.remove('is-open');
    }
    function openContextMenuAt(clientX, clientY) {
      const active = fabricCanvas.getActiveObject();
      const selected = active ? (active.type === 'activeSelection' ? active.getObjects() : [active]) : [];
      const eligible = selected.filter((o) => BOOLEAN_ELIGIBLE_TYPES.includes(o.type));
      const enabled = {
        'bring-front': !!active,
        'send-back': !!active,
        copy: !!active,
        paste: !!clipboardObjects && !!clipboardObjects.length,
        group: !!active && active.type === 'activeSelection',
        ungroup: !!active && active.type === 'group',
        'remove-from-group': !!active && isWithinGroupEditSession(active),
        union: eligible.length >= 2,
        subtract: eligible.length === 2,
        delete: !!active,
      };
      contextMenu.querySelectorAll('.editor-context-menu-item').forEach((btn) => {
        btn.disabled = !enabled[btn.dataset.action];
      });
      contextMenu.classList.add('is-open');
      // Clamp so the menu never renders partly off-screen.
      const rect = contextMenu.getBoundingClientRect();
      const left = Math.min(clientX, window.innerWidth - rect.width - 4);
      const top = Math.min(clientY, window.innerHeight - rect.height - 4);
      contextMenu.style.left = `${Math.max(4, left)}px`;
      contextMenu.style.top = `${Math.max(4, top)}px`;
    }
    // Anywhere on the page, not just the canvas — right-clicking a text
    // field/etc. still gets the browser's own menu (cut/copy/paste is
    // more useful there), but everywhere else this menu shows instead,
    // acting on whatever's currently selected on the card. Only an
    // actual right-click ON the canvas re-picks the target under the
    // cursor first, exactly as before.
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      if (e.target === fabricCanvas.upperCanvasEl) {
        const target = fabricCanvas.findTarget(e, false);
        const active = fabricCanvas.getActiveObject();
        const alreadySelected = active && (active === target || (active.type === 'activeSelection' && active.getObjects().includes(target)));
        if (target && !alreadySelected) {
          fabricCanvas.setActiveObject(target);
          handleSelection({ selected: [target] });
        } else if (!target) {
          fabricCanvas.discardActiveObject();
          hideObjectToolbar();
        }
        fabricCanvas.requestRenderAll();
      }
      openContextMenuAt(e.clientX, e.clientY);
    });
    contextMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('.editor-context-menu-item');
      if (!btn || btn.disabled) return;
      closeContextMenu();
      const action = menuActions[btn.dataset.action];
      if (action) action();
    });
    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) closeContextMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeContextMenu();
    });
    fabricCanvas.on('mouse:down', closeContextMenu);
  }

  // ---- Layers panel — a live, z-ordered list of everything on the card ----
  // Internal helper objects (just the edge indicator) are evented:false,
  // unlike every piece of real content, so that's what filters them out
  // here rather than checking against a type list.
  const layersList = document.getElementById('layers-list');
  const layersEmpty = document.getElementById('layers-empty');
  const LAYER_ICONS = {
    line: '<svg class="editor-layer-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4" y1="20" x2="20" y2="4"/></svg>',
    rect: '<svg class="editor-layer-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="4" y="6" width="16" height="12"/></svg>',
    circle: '<svg class="editor-layer-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/></svg>',
    triangle: '<svg class="editor-layer-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><polygon points="12,4 20,20 4,20"/></svg>',
    path: '<svg class="editor-layer-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 18 Q4 6 12 6 T20 10"/><circle cx="4" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="20" cy="10" r="1.4" fill="currentColor" stroke="none"/></svg>',
    'i-text': '<svg class="editor-layer-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 6h14"/><path d="M12 6v12"/><path d="M9 18h6"/></svg>',
    group: '<svg class="editor-layer-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="12" height="12"/><rect x="9" y="9" width="12" height="12"/></svg>',
  };
  // Same glyphs as the Finish toolbar's own buttons (see card-editor.html)
  // — shown on the right of each Layers row so an object/group's current
  // finish is visible without selecting it.
  const FINISH_ICONS = {
    none: '<svg class="editor-layer-item-finish-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><line x1="6" y1="18" x2="18" y2="6"/></svg>',
    stroke: '<svg class="editor-layer-item-finish-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16"/></svg>',
    texture: '<svg class="editor-layer-item-finish-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="4" width="16" height="16"/><line x1="4" y1="14" x2="14" y2="4"/><line x1="4" y1="20" x2="20" y2="4"/><line x1="10" y1="20" x2="20" y2="10"/></svg>',
    white: '<svg class="editor-layer-item-finish-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="4" width="16" height="16" fill="currentColor"/></svg>',
    metallic: '<svg class="editor-layer-item-finish-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16"/><line x1="8" y1="20" x2="20" y2="8" stroke-width="2.4"/></svg>',
    'frosted-white': '<svg class="editor-layer-item-finish-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r="0.9" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="0.9" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="0.9" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="0.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/></svg>',
    // A group whose members don't all share one finish — four distinct
    // little swatches instead of one, since no single finish icon would
    // be accurate.
    multiple: '<svg class="editor-layer-item-finish-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/></svg>',
  };
  function layerLabelFor(obj) {
    if (obj.type === 'i-text' || obj.type === 'text') return (obj.text && obj.text.trim()) || 'Text';
    const names = {
      rect: 'Rectangle', circle: 'Circle', triangle: 'Triangle', line: 'Line', path: 'Path', group: 'Group',
      ellipse: 'Ellipse', polygon: 'Polygon', polyline: 'Polyline', image: 'Image',
    };
    return names[obj.type] || obj.type.charAt(0).toUpperCase() + obj.type.slice(1);
  }
  // ---- Layers panel row thumbnails ----
  // A little rendered snapshot of the actual object (shape, color,
  // rotation and all) instead of a generic per-type icon. Fabric objects
  // (groups included) can render themselves to a small PNG via their own
  // toDataURL() — but that's real canvas work, so it's cached on the
  // object itself and only regenerated when something about how it
  // actually looks has changed, not every time the list is rebuilt
  // (which happens on most selection changes, not just edits).
  const LAYER_THUMB_SIZE = 20; // px — the rendered image is fit inside this box, not stretched to it
  // A cheap fingerprint of everything that affects how obj is drawn.
  // Comparing this against what's cached is far cheaper than re-rendering
  // a thumbnail on every list rebuild, and self-heals — nothing has to
  // remember to invalidate the cache at each of this file's many places
  // that can change a shape's appearance.
  function thumbSignatureFor(obj) {
    if (obj.type === 'group') {
      return `group@${obj.angle}:` + obj.getObjects().map(thumbSignatureFor).join('|');
    }
    return [
      obj.type, obj.fill, obj.stroke, obj.strokeWidth, obj.strokeDashArray && obj.strokeDashArray.join(','),
      obj.angle, obj.flipX, obj.flipY, obj.opacity,
      obj.width, obj.height, obj.radius, obj.rx, obj.ry,
      obj.points && JSON.stringify(obj.points), obj.path && obj.path.length,
      obj.text, obj.fontFamily, obj.fontSize, obj.fontWeight, obj.fontStyle, obj.textAlign, obj.underline,
    ].join('|');
  }
  function renderLayerThumbnail(obj) {
    const box = obj.getBoundingRect(true, true);
    const maxDim = Math.max(box.width, box.height, 1);
    let multiplier = LAYER_THUMB_SIZE / maxDim;
    // A very thin object (a horizontal/vertical Line, a flattened shape)
    // has a near-zero minor dimension — scaled down by the same multiplier
    // as the major one, it rounds to 0 actual pixels, which makes
    // toDataURL hand back an empty, unusable "data:," image (a Line always
    // hit this, since its bounding box is only ever as tall as its own
    // stroke width). Bumping the multiplier up so the minor dimension
    // clears 1px fixes that; the thumbnail <img> is a fixed, object-fit:
    // contain box (see .editor-layer-item-thumb), so a larger raw render
    // just gets scaled back down with no visual difference.
    const minDim = Math.min(box.width, box.height);
    if (minDim > 0 && minDim * multiplier < 1) multiplier = 1 / minDim;
    try {
      return obj.toDataURL({ format: 'png', multiplier });
    } catch (e) {
      return null;
    }
  }
  function getLayerThumbDataUrl(obj) {
    const sig = thumbSignatureFor(obj);
    if (!obj.__layerThumb || obj.__layerThumb.sig !== sig) {
      obj.__layerThumb = { sig, dataUrl: renderLayerThumbnail(obj) };
    }
    return obj.__layerThumb.dataUrl;
  }
  // Groups (from the context menu's Group action, or an imported SVG —
  // see importSvgFile below) default to expanded, showing their own
  // members nested underneath; collapsed state is remembered here across
  // rebuilds since the list itself is rebuilt from scratch every time.
  const collapsedGroups = new Set();
  // ---- Multi-selecting rows from the Layers panel ----
  // Shift-click selects the visual range between this row and the last
  // one clicked (like a file browser); Cmd/Ctrl-click toggles just this
  // row in or out of whatever's currently selected, stacking freely.
  // Nested rows get the same treatment, but only among siblings already
  // loose within the currently-open group-edit session (see the click
  // handler below) — there's no sensible way to combine a dissolved
  // group's member with some unrelated object outside the session, so
  // that case still just falls back to entering/re-entering the row
  // clicked.
  let layersRangeAnchor = null;
  function selectLayerObjects(arr) {
    suppressHistoryEvents = true;
    fabricCanvas.discardActiveObject();
    if (arr.length === 1) {
      fabricCanvas.setActiveObject(arr[0]);
    } else if (arr.length > 1) {
      fabricCanvas.setActiveObject(new fabric.ActiveSelection(arr, { canvas: fabricCanvas }));
    }
    suppressHistoryEvents = false;
    handleSelection({ selected: arr });
    fabricCanvas.requestRenderAll();
  }
  // ---- Reordering/grouping rows by dragging in the Layers panel ----
  // Any real row can be dragged or dropped on, at any depth — a nested
  // object can be reordered against a sibling, dragged out to the top
  // level (removing it from its group), or dragged into a different
  // group entirely. A "container" below is either the top-level canvas
  // or a fabric.Group; every object lives in exactly one. Disabled
  // outright while a group-edit session is open (see below) — that
  // temporarily dissolves a group's real structure on the canvas, and
  // reading a dissolved object's true container mid-drag would be
  // unreliable, so the simple rule is: close the session first (click
  // elsewhere), then drag.
  // Each row is split into three drop zones by vertical position: the
  // top and bottom quarters mean "reorder to sit right there" (shown
  // with a white line on that edge); the middle half means "group with
  // this" (shown with a white outline around the whole row).
  let draggedLayerObject = null;
  function getLayerDropZone(li, clientY) {
    const rect = li.getBoundingClientRect();
    const rel = (clientY - rect.top) / rect.height;
    if (rel < 0.25) return 'above';
    if (rel > 0.75) return 'below';
    return 'group';
  }
  function clearLayerDropIndicators() {
    layersList.querySelectorAll('.is-drop-above, .is-drop-below, .is-drop-group').forEach((el) => {
      el.classList.remove('is-drop-above', 'is-drop-below', 'is-drop-group');
    });
  }
  function containerObjectsOf(container) {
    return container === fabricCanvas ? fabricCanvas.getObjects() : container._objects;
  }
  // Pulls obj out of whatever container it's actually in right now. If
  // that was a group and removing obj leaves it with fewer than 2
  // members, the group doesn't earn its keep anymore either — it's
  // dissolved the same way, promoting its lone survivor up into ITS OWN
  // container at the group's old spot, recursively (a group nested
  // inside a group that also shrinks to one member keeps unwinding).
  // After this, obj belongs to nothing; the caller reinserts it.
  function detachLayerObject(obj) {
    const group = obj.group;
    if (!group) {
      if (fabricCanvas.getObjects().includes(obj)) fabricCanvas.remove(obj);
      return;
    }
    group.removeWithUpdate(obj);
    let dying = group;
    while (dying && dying.type === 'group' && dying._objects.length < 2) {
      const survivor = dying._objects[0] || null;
      const parent = dying.group || null;
      const parentObjs = parent ? parent._objects : fabricCanvas.getObjects();
      const idx = parentObjs.indexOf(dying);
      if (survivor) dying.removeWithUpdate(survivor);
      if (parent) parent.removeWithUpdate(dying);
      else fabricCanvas.remove(dying);
      if (survivor) insertLayerObjectAt(survivor, parent || fabricCanvas, idx);
      dying = parent;
    }
  }
  // Inserts obj into a group at a specific index — the exact same
  // transform-safe dance Fabric's own addWithUpdate uses (un-bake every
  // current member back to absolute canvas coordinates, reset the
  // group's own transform to identity, splice the new member in, then
  // recompute the group's bounds and re-bake everything relative to
  // that), just with splice(index, ...) in place of addWithUpdate's
  // always-append push(...). Skipping that dance and only calling
  // _calcBounds()/_updateObjectsCoords() on top of a splice — which is
  // what this used to do — computes bounds from children still baked
  // relative to the OLD transform, corrupting the group's position
  // (confirmed while building this: it left the group at some nonsense
  // coordinate like -55,-15 instead of its real spot on the card).
  function groupInsertAt(group, obj, index) {
    const nested = !!group.group;
    group._restoreObjectsState();
    fabric.util.resetObjectTransform(group);
    if (nested) {
      fabric.util.removeTransformFromObject(obj, group.group.calcTransformMatrix());
    }
    const clamped = Math.max(0, Math.min(index, group._objects.length));
    group._objects.splice(clamped, 0, obj);
    obj.group = group;
    obj._set('canvas', group.canvas);
    group._calcBounds();
    group._updateObjectsCoords();
    group.dirty = true;
    if (nested) group.group.addWithUpdate();
    else group.setCoords();
  }
  // Inserts an already-detached object into a container at a specific
  // index within that container's own member order.
  function insertLayerObjectAt(obj, container, index) {
    if (container === fabricCanvas) {
      fabricCanvas.add(obj);
      fabricCanvas.moveTo(obj, Math.max(0, Math.min(index, fabricCanvas.getObjects().length - 1)));
      return;
    }
    groupInsertAt(container, obj, index);
  }
  // Fabric's own object array is back-to-front, but the panel lists
  // front-most first — "above" in the list (closer to the top row) means
  // closer to the front (a higher index) than the target, and "below"
  // means sharing the target's own index once it's out of the way.
  // Reordering within the SAME container is a pure reposition (dragged
  // never actually leaves, so there's no risk of collapsing anything
  // along the way); moving into a DIFFERENT container detaches first,
  // then reads the target's freshly-current index right before
  // inserting, since detaching can itself have just reshuffled that
  // very container (a dissolving group promoting a survivor into it).
  function moveLayerObjectRelativeTo(dragged, target, position) {
    const draggedContainer = dragged.group || fabricCanvas;
    const targetContainer = target.group || fabricCanvas;
    if (draggedContainer === targetContainer) {
      const objs = containerObjectsOf(targetContainer);
      const targetIndex = objs.indexOf(target);
      const draggedIndex = objs.indexOf(dragged);
      let newIndex = position === 'above' ? targetIndex + 1 : targetIndex;
      if (draggedIndex < targetIndex) newIndex -= 1;
      if (targetContainer === fabricCanvas) {
        fabricCanvas.moveTo(dragged, newIndex);
      } else {
        // Not detachLayerObject() — that also checks whether removing
        // dragged leaves the group too small to keep existing, which
        // would be wrong here: dragged is about to go right back into
        // this very group, not leave it.
        targetContainer.removeWithUpdate(dragged);
        groupInsertAt(targetContainer, dragged, Math.max(0, Math.min(newIndex, targetContainer._objects.length)));
      }
      return;
    }
    detachLayerObject(dragged);
    const liveObjs = containerObjectsOf(targetContainer);
    const liveTargetIndex = liveObjs.indexOf(target);
    insertLayerObjectAt(dragged, targetContainer, position === 'above' ? liveTargetIndex + 1 : liveTargetIndex);
  }
  // Dropping "on" a group joins it as a new direct member (in front of
  // its current ones); dropping on a plain object wraps the two of them
  // in a brand new group, taking the lower of their two original spots
  // in the stack so it doesn't jump to the front of unrelated objects.
  // Target's index is read fresh, after dragged is already detached,
  // for the same reason as above.
  function groupLayerObjectsTogether(dragged, target) {
    if (target.type === 'group') {
      detachLayerObject(dragged);
      target.addWithUpdate(dragged);
      fabricCanvas.setActiveObject(target);
      return;
    }
    const targetContainer = target.group || fabricCanvas;
    detachLayerObject(dragged);
    const insertIndex = containerObjectsOf(targetContainer).indexOf(target);
    detachLayerObject(target);
    const newGroup = new fabric.Group([target, dragged]);
    insertLayerObjectAt(newGroup, targetContainer, insertIndex);
    fabricCanvas.setActiveObject(newGroup);
  }
  function handleLayerDrop(dragged, target, zone) {
    if (!dragged || !target || dragged === target) return;
    // Already directly grouped together — nothing meaningful for
    // "group with this" to do (and attempting it risks pulling the
    // rug out from under target's own position mid-operation).
    if (zone === 'group' && (dragged.group === target || (dragged.group && dragged.group === target.group))) return;
    hideEdgeIndicator();
    suppressHistoryEvents = true;
    if (zone === 'group') {
      groupLayerObjectsTogether(dragged, target);
    } else {
      moveLayerObjectRelativeTo(dragged, target, zone);
    }
    suppressHistoryEvents = false;
    fabricCanvas.requestRenderAll();
    refreshLayersList();
    pushHistory();
  }
  // ---- Editing a member nested inside a group, without breaking it up ----
  // Fabric has no way to make a group's child independently selectable
  // while it stays a member, so selecting one from the Layers panel
  // dissolves each ancestor group in turn (same mechanism as Ungroup),
  // outermost first, until the clicked object is a plain top-level
  // canvas object — then, the moment focus moves away from that
  // temporarily-loose set (a different object gets selected, or
  // selection is cleared entirely), the exact same groups are silently
  // rebuilt, innermost first, from whatever's left of their original
  // members. From the outside this reads as "edit a piece in place,
  // still part of the group once you're done" — nothing here is a
  // permanent Ungroup.
  let groupEditSession = null; // { ancestors, levels } — see selectNestedObject
  // Dissolving/rebuilding a group during a group-edit session fires a
  // burst of Fabric selection/add/remove events, each of which would
  // otherwise trigger its own Layers panel rebuild — several redundant
  // renders for what's really one logical step. Set around those
  // sequences; the deliberate refreshLayersList() call at the end of
  // each one still runs directly (unaffected by this), so the panel
  // still always ends up in sync — it just skips the churn in between.
  let suppressLayersRefresh = false;
  // selectLayerObjects (used for multi-selecting siblings within an open
  // session — see the Layers panel click handler below) calls
  // discardActiveObject() before setting the new multi-selection, same as
  // deleteActiveObjects has to work around elsewhere: that fires
  // 'selection:cleared' synchronously, which would otherwise end the
  // session and rebuild the group mid-call, out from under the new
  // ActiveSelection about to be built from its (no-longer-loose) members.
  // Set around that one call so the momentary discard doesn't end a
  // session that's still legitimately in use.
  let suppressGroupSessionEnd = false;
  function isWithinGroupEditSession(obj) {
    if (!groupEditSession || !obj) return false;
    const { ancestors, levels } = groupEditSession;
    const loose = new Set();
    levels.forEach((members) => members.forEach((m) => {
      if (!ancestors.includes(m)) loose.add(m);
    }));
    if (obj.type === 'activeSelection') return obj.getObjects().every((o) => loose.has(o));
    return loose.has(obj);
  }
  // Rebuilds every dissolved ancestor level, innermost first, from
  // whichever of its original members are still around (one could've
  // been deleted while loose, or itself be the group rebuilt one level
  // in) — without disturbing whatever's actually selected right now, so
  // ending the session doesn't hijack a selection made by clicking a
  // completely different object while a piece was still loose.
  function endGroupEditSession(skipHistory) {
    if (!groupEditSession) return null;
    const { ancestors, levels } = groupEditSession;
    groupEditSession = null;
    const keepActive = fabricCanvas.getActiveObject();
    suppressHistoryEvents = true;
    suppressLayersRefresh = true;
    let rebuilt = null;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const nestedChild = ancestors[i + 1] || null;
      const members = levels[i]
        .map((o) => (o === nestedChild ? rebuilt : o))
        .filter((o) => o && fabricCanvas.getObjects().includes(o));
      if (members.length < 2) {
        rebuilt = members[0] || null;
        continue;
      }
      const insertIndex = Math.min(...members.map((o) => fabricCanvas.getObjects().indexOf(o)));
      members.forEach((o) => fabricCanvas.remove(o));
      rebuilt = new fabric.Group(members);
      fabricCanvas.add(rebuilt);
      fabricCanvas.moveTo(rebuilt, Math.min(insertIndex, fabricCanvas.getObjects().length - 1));
    }
    suppressHistoryEvents = false;
    if (keepActive && keepActive !== rebuilt && fabricCanvas.getObjects().includes(keepActive)) {
      fabricCanvas.setActiveObject(keepActive);
    }
    suppressLayersRefresh = false;
    fabricCanvas.requestRenderAll();
    refreshLayersList();
    if (!skipHistory) pushHistory();
    return rebuilt;
  }
  // Pulls one or more members permanently out of the group they're
  // currently loose from (see the group-edit session above) — unlike
  // ending the session normally, these members never get folded back in.
  // Removing them from the session's own bookkeeping before the rebuild
  // runs means the rebuild's own "is this member still around" filter
  // naturally leaves them out, same trick deleteActiveObjects relies on.
  // Takes an array so a multi-selection (several members loose within
  // the same session) can be pulled out together as one undo step, not
  // one per member — lands them all directly above the reformed group,
  // still selected as a group if there's more than one (skipHistory on
  // the rebuild itself so the whole thing — rebuild + reposition — stays
  // one step, not two).
  function removeFromGroup(objs) {
    const list = (Array.isArray(objs) ? objs : [objs]).filter(Boolean);
    if (!groupEditSession || !list.length) return;
    list.forEach((obj) => {
      const levelIdx = groupEditSession.levels.findIndex((members) => members.includes(obj));
      if (levelIdx !== -1) {
        groupEditSession.levels[levelIdx] = groupEditSession.levels[levelIdx].filter((o) => o !== obj);
      }
    });
    const rebuilt = endGroupEditSession(true);
    if (rebuilt && fabricCanvas.getObjects().includes(rebuilt)) {
      const insertAt = fabricCanvas.getObjects().indexOf(rebuilt) + 1;
      list.forEach((obj, i) => {
        if (fabricCanvas.getObjects().includes(obj)) fabricCanvas.moveTo(obj, insertAt + i);
      });
    }
    const stillPresent = list.filter((obj) => fabricCanvas.getObjects().includes(obj));
    if (stillPresent.length === 1) {
      fabricCanvas.setActiveObject(stillPresent[0]);
    } else if (stillPresent.length > 1) {
      fabricCanvas.setActiveObject(new fabric.ActiveSelection(stillPresent, { canvas: fabricCanvas }));
    }
    handleSelection({ selected: stillPresent });
    fabricCanvas.requestRenderAll();
    refreshLayersList();
    pushHistory();
  }
  function selectNestedObject(obj) {
    endGroupEditSession(); // close out any previous loose piece first
    const ancestors = [];
    let cur = obj;
    while (cur.group) {
      ancestors.unshift(cur.group);
      cur = cur.group;
    }
    if (!ancestors.length) return;
    const levels = ancestors.map((group) => group.getObjects().slice());
    hideEdgeIndicator();
    suppressHistoryEvents = true;
    suppressLayersRefresh = true;
    ancestors.forEach((group) => {
      fabricCanvas.setActiveObject(group);
      group.toActiveSelection();
    });
    suppressHistoryEvents = false;
    groupEditSession = { ancestors, levels };
    fabricCanvas.setActiveObject(obj);
    suppressLayersRefresh = false;
    fabricCanvas.requestRenderAll();
    if (finishModeActive) {
      refreshFinishUI(obj);
    } else {
      showObjectToolbarFor(obj);
      applyScalingControlsVisibility(obj);
    }
    refreshLayersList();
    // No pushHistory here, deliberately — ending the session pushes once
    // for the whole enter/edit/exit cycle, and if nothing was actually
    // edited in between, that snapshot is identical to the one before
    // selecting and gets deduped away entirely.
  }
  // Double-clicking a member inside a group selects just that member —
  // same entry point the Layers panel uses (selectNestedObject), so it
  // gets the same "still grouped once you deselect" behavior for free.
  // opt.target is always the outermost group hit (subTargetCheck doesn't
  // change that); opt.subTargets — populated because of subTargetCheck
  // above — is ordered innermost-first, so [0] is the actual member
  // under the cursor, however deep it's nested.
  fabricCanvas.on('mouse:dblclick', (opt) => {
    if (!opt.target || opt.target.type !== 'group') return;
    const leaf = opt.subTargets && opt.subTargets[0];
    if (!leaf) return;
    selectNestedObject(leaf);
  });
  function refreshLayersList() {
    if (!layersList) return;
    const active = fabricCanvas.getActiveObject();
    const activeMembers = active ? (active.type === 'activeSelection' ? active.getObjects() : [active]) : [];
    const session = groupEditSession;
    // While a member inside a group is being edited, its ancestor
    // group(s) are genuinely dissolved on the canvas — Fabric has no
    // other way to make a member directly selectable while it stays in
    // the group — but the Layers panel doesn't have to show that churn.
    // Render the tree as if nothing had been dissolved: for whichever
    // level(s) are currently loose, use the pre-dissolve snapshot
    // captured in the session instead of each group's (now empty/gone)
    // live children, so it looks exactly like it did before selecting
    // in, and exactly like it will again once the session ends.
    function childrenOf(obj) {
      if (session) {
        const idx = session.ancestors.indexOf(obj);
        if (idx !== -1) return session.levels[idx];
      }
      return obj.getObjects();
    }
    // A group's own row shows its members' finish only while they all
    // agree — the moment one member's finish diverges from the rest
    // (via selectNestedObject overriding just that one), the group's own
    // cardFinish is stale (still whatever it was cascaded to last), so
    // this derives the real answer directly from the current leaves
    // instead of trusting that property. Uses childrenOf(), not
    // obj.getObjects(), so it stays correct for a group that's currently
    // mid-edit-session (see above).
    function finishIconKeyFor(obj) {
      if (obj.type !== 'group') return getFinish(obj);
      const finishes = new Set();
      (function walk(o) {
        if (o.type === 'group') childrenOf(o).forEach(walk);
        else finishes.add(getFinish(o));
      })(obj);
      if (finishes.size > 1) return 'multiple';
      const [only] = finishes;
      return only || getFinish(obj);
    }
    let objects = fabricCanvas.getObjects().filter((o) => o.evented !== false);
    if (session) {
      // Every dissolved level's members are, right now, sitting as real
      // top-level canvas objects (not just the outermost one's) — all of
      // them need hiding from the top-level list, since they're each
      // shown nested instead via childrenOf(). Only the outermost
      // ancestor gets a placeholder row put back among the real
      // top-level objects, in the same spot, so the row structure
      // doesn't change shape; the inner ancestor(s) only ever appear as
      // some other row's child, never at the top level.
      const outerMembers = new Set(session.levels[0]);
      const allLooseMembers = new Set();
      session.levels.forEach((members) => members.forEach((m) => allLooseMembers.add(m)));
      const firstMemberIndex = objects.findIndex((o) => outerMembers.has(o));
      let insertAt = 0;
      for (let i = 0; i < firstMemberIndex; i++) {
        if (!allLooseMembers.has(objects[i])) insertAt++;
      }
      objects = objects.filter((o) => !allLooseMembers.has(o));
      objects.splice(insertAt, 0, session.ancestors[0]);
    }
    if (layersEmpty) layersEmpty.style.display = objects.length ? 'none' : '';
    // The list is rebuilt from scratch below (innerHTML wipe + re-append)
    // on most selection changes, which would otherwise reset scroll to
    // the top every time — jarring when selecting something further down
    // a long list. Restore whatever it was right after.
    const scrollTop = layersList.scrollTop;
    layersList.innerHTML = '';
    function renderRow(obj, depth) {
      const li = document.createElement('li');
      li.className = 'editor-layer-item';
      li.style.paddingLeft = `${8 + depth * 16}px`;
      const isGroup = obj.type === 'group';
      const children = isGroup ? childrenOf(obj) : [];
      const collapsed = collapsedGroups.has(obj);
      if (activeMembers.includes(obj)) li.classList.add('is-active');
      if (depth > 0) li.classList.add('is-child');
      const toggle = isGroup && children.length
        ? `<button type="button" class="editor-layer-toggle" aria-label="${collapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!collapsed}">${collapsed ? '▸' : '▾'}</button>`
        : '<span class="editor-layer-toggle-spacer"></span>';
      // A dissolved ancestor has no live children of its own right now to
      // render a thumbnail from — its plain type icon instead of a
      // stale/empty render.
      const isDissolvedAncestor = !!(session && session.ancestors.includes(obj));
      const thumbUrl = isDissolvedAncestor ? null : getLayerThumbDataUrl(obj);
      const thumbHtml = thumbUrl
        ? `<img class="editor-layer-item-thumb" src="${thumbUrl}" alt="" draggable="false" />`
        : (LAYER_ICONS[obj.type] || '');
      li.innerHTML = `${toggle}${thumbHtml}<span class="editor-layer-item-label"></span>${FINISH_ICONS[finishIconKeyFor(obj)] || ''}`;
      li.querySelector('.editor-layer-item-label').textContent = layerLabelFor(obj);
      li.addEventListener('click', (e) => {
        if (e.target.closest('.editor-layer-toggle')) return;
        // This row only shows as a group because it's mid-edit — there's
        // no real object behind it to select. End the session (which
        // rebuilds it for real) and select whatever comes out of that.
        if (isDissolvedAncestor) {
          const rebuilt = endGroupEditSession();
          if (rebuilt) selectLayerObjects([rebuilt]);
          return;
        }
        if (depth > 0) {
          // A modifier-click on a row that's already loose within the
          // currently-open group-edit session multi-selects among those
          // siblings — same shift-range/cmd-toggle behavior as top-level
          // rows, just scoped to this one dissolved group instead of the
          // whole canvas (there's no sensible way to combine it with an
          // unrelated object outside the session). Anything else (no
          // session open yet, or this row belongs to a different group)
          // falls back to entering/re-entering it for just this object.
          const withinSession = groupEditSession && isWithinGroupEditSession(obj);
          if (withinSession && (e.shiftKey || e.metaKey || e.ctrlKey)) {
            const current = fabricCanvas.getActiveObject();
            const currentMembers = current ? (current.type === 'activeSelection' ? current.getObjects() : [current]) : [];
            suppressGroupSessionEnd = true;
            if (e.shiftKey && layersRangeAnchor && isWithinGroupEditSession(layersRangeAnchor)) {
              const level = groupEditSession.levels.find((members) => members.includes(obj) && members.includes(layersRangeAnchor));
              if (level) {
                const iA = level.indexOf(layersRangeAnchor);
                const iB = level.indexOf(obj);
                const [lo, hi] = iA < iB ? [iA, iB] : [iB, iA];
                selectLayerObjects(level.slice(lo, hi + 1));
              } else {
                selectLayerObjects([obj]);
              }
            } else {
              const next = currentMembers.includes(obj) ? currentMembers.filter((o) => o !== obj) : [...currentMembers, obj];
              selectLayerObjects(next);
            }
            suppressGroupSessionEnd = false;
            layersRangeAnchor = obj;
            return;
          }
          selectNestedObject(obj);
          layersRangeAnchor = obj;
          return;
        }
        // Top-of-stack first, matching the row order actually rendered.
        const displayOrder = objects.slice().reverse();
        if (e.shiftKey && layersRangeAnchor && displayOrder.includes(layersRangeAnchor)) {
          const iA = displayOrder.indexOf(layersRangeAnchor);
          const iB = displayOrder.indexOf(obj);
          const [lo, hi] = iA < iB ? [iA, iB] : [iB, iA];
          selectLayerObjects(displayOrder.slice(lo, hi + 1));
        } else if (e.metaKey || e.ctrlKey) {
          const current = fabricCanvas.getActiveObject();
          const currentMembers = current ? (current.type === 'activeSelection' ? current.getObjects() : [current]) : [];
          const next = currentMembers.includes(obj) ? currentMembers.filter((o) => o !== obj) : [...currentMembers, obj];
          selectLayerObjects(next);
          layersRangeAnchor = obj;
        } else {
          selectLayerObjects([obj]);
          layersRangeAnchor = obj;
        }
      });
      // Drag-reorder/group — any real row, any depth; only a dissolved
      // (virtual) ancestor row sits out, since there's no real object
      // behind it to drag or drop onto. A drag is also refused outright
      // while a group-edit session is open elsewhere — see the note
      // above moveLayerObjectRelativeTo.
      if (!isDissolvedAncestor) {
        li.draggable = true;
        li.addEventListener('dragstart', (e) => {
          if (groupEditSession) {
            e.preventDefault();
            return;
          }
          draggedLayerObject = obj;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', '');
        });
        li.addEventListener('dragover', (e) => {
          if (!draggedLayerObject || draggedLayerObject === obj) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const zone = getLayerDropZone(li, e.clientY);
          clearLayerDropIndicators();
          li.classList.add(zone === 'above' ? 'is-drop-above' : zone === 'below' ? 'is-drop-below' : 'is-drop-group');
        });
        li.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const zone = getLayerDropZone(li, e.clientY);
          clearLayerDropIndicators();
          handleLayerDrop(draggedLayerObject, obj, zone);
          draggedLayerObject = null;
        });
        li.addEventListener('dragend', () => {
          clearLayerDropIndicators();
          draggedLayerObject = null;
        });
      }
      layersList.appendChild(li);
      const toggleBtn = li.querySelector('.editor-layer-toggle');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (collapsed) collapsedGroups.delete(obj);
          else collapsedGroups.add(obj);
          refreshLayersList();
        });
      }
      if (isGroup && children.length && !collapsed) {
        children.slice().reverse().forEach((child) => renderRow(child, depth + 1));
      }
    }
    // Front-most (top of the visual stack) listed first.
    objects.slice().reverse().forEach((obj) => renderRow(obj, 0));
    layersList.scrollTop = scrollTop;
  }
  // Helper overlays (the edge indicator, snap guide lines) are
  // evented:false and never shown in the list anyway, so skip the
  // rebuild for those — otherwise every drag frame's snap-line add/
  // remove would needlessly rebuild this list too.
  function refreshLayersListIfNeeded() {
    if (!suppressLayersRefresh) refreshLayersList();
  }
  fabricCanvas.on('object:added', (opt) => {
    if (opt.target && opt.target.evented === false) return;
    refreshLayersListIfNeeded();
  });
  fabricCanvas.on('object:removed', (opt) => {
    if (opt.target && opt.target.evented === false) return;
    refreshLayersListIfNeeded();
  });
  fabricCanvas.on('selection:created', refreshLayersListIfNeeded);
  fabricCanvas.on('selection:updated', refreshLayersListIfNeeded);
  fabricCanvas.on('selection:cleared', refreshLayersListIfNeeded);
  refreshLayersList();

  // ---- Signal ready to the loading overlay ----
  // Runs last, after everything above — the canvas, previews, and (if
  // this load just resumed one) the imported design are all already
  // painted. The overlay itself (an inline script in card-editor.html,
  // since it has to start tracking script load progress before
  // card-editor.js even begins downloading) owns the actual cross-hatch
  // engrave animation and reveal timing — this just tells it setup is
  // done on this end; it still waits for its own progress to reach 100%
  // before actually revealing, so a slow resource load can't get cut off
  // mid-engrave. Falls back to revealing immediately itself only if that
  // hook is somehow missing (e.g. this file loaded standalone, outside
  // card-editor.html).
  if (window.__plmMarkAppReady) {
    window.__plmMarkAppReady();
  } else {
    const shell = document.querySelector('.editor-shell');
    if (shell) {
      shell.classList.remove('is-entering');
      shell.classList.add('is-ready');
    }
    const overlay = document.getElementById('editor-loading-overlay');
    if (overlay) overlay.remove();
  }
}
