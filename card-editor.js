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
// Uses the CSS `zoom` property (not `transform: scale`) specifically
// because it changes the frame's actual layout size, so the surrounding
// .editor-canvas-scroll container has something real to scroll once the
// zoomed frame no longer fits — transform doesn't affect layout size, so
// scrolling wouldn't pick up the change.
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
const zoomValueEl = document.getElementById('zoom-value');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomInBtn = document.getElementById('zoom-in');

function applyZoom() {
  if (canvasFrame) canvasFrame.style.zoom = (zoomLevel / 100) * ZOOM_CALIBRATION;
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
      originX: 'left', originY: 'top', centeredRotation: false, stroke: '#ffffff', strokeWidth: 2,
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

  function importSvgFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const svgText = String(reader.result);
      fabric.loadSVGFromString(svgText, (objects, options) => {
        const valid = (objects || []).filter(Boolean);
        if (!valid.length) {
          alert('Could not import that file — no supported shapes were found in it.');
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
    reader.onerror = () => alert('Could not read that file.');
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
    'strokeAlign', '_strokeWidthPx', 'lineDashStyle', 'cardFinish', 'cardFinishTexture', 'cardFinishOutline',
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
        <span class="editor-side-thumb-card"></span>
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
  if (addBackBtn) {
    addBackBtn.addEventListener('click', () => {
      ensureBackSideUI();
      switchToSide('back');
      renderCardPreview('back');
    });
  }

  // ---- Save to / Import from a local file ----
  // The whole project (both sides' full designs) as one plain JSON file —
  // not the print-ready SVG export (Export / Submit Design, still
  // unbuilt), just enough to reconstruct the editable project exactly as
  // it was, the same way "Save" and "Open" work in a desktop app.
  function getSideSnapshotJSON(side) {
    if (side === currentSide) return undoStack[undoStack.length - 1];
    const stored = sideHistories[side];
    return stored ? stored.undo[stored.undo.length - 1] : null;
  }
  function projectHasBackSide() {
    return currentSide === 'back' || !!sideHistories.back || !!document.querySelector('.editor-side-thumb[data-side="back"]');
  }
  function downloadProjectFile(filename) {
    const hasBack = projectHasBackSide();
    const payload = {
      app: 'business-card-editor',
      version: 1,
      currentSide,
      front: JSON.parse(getSideSnapshotJSON('front') || blankCanvasSnapshot),
      back: hasBack ? JSON.parse(getSideSnapshotJSON('back') || blankCanvasSnapshot) : null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
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
      downloadProjectFile('business-card.json');
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
    const filename = /\.json$/i.test(cleaned) ? cleaned : `${cleaned}.json`;
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
      alert("That file doesn't look like a valid business card design.");
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
    }
    const targetSide = payload.currentSide === 'back' && payload.back ? 'back' : 'front';
    loadSideAndSwitch(targetSide);
    if (payload.back) renderCardPreview('back');
    // The just-loaded file is now what's on screen — nothing to warn
    // about losing until it's actually edited again.
    hasUnsavedChanges = false;
  }
  if (importBtn && importProjectInput) {
    importBtn.addEventListener('click', () => {
      const hasExistingWork = undoStack.length > 1 || projectHasBackSide();
      if (hasExistingWork && !confirm('Importing a file will replace your current design. Continue?')) return;
      importProjectInput.value = '';
      importProjectInput.click();
    });
    importProjectInput.addEventListener('change', () => {
      const file = importProjectInput.files && importProjectInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let payload;
        try {
          payload = JSON.parse(String(reader.result));
        } catch (err) {
          alert("That file couldn't be read as a business card design.");
          return;
        }
        importProjectData(payload);
      };
      reader.readAsText(file);
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
  // composite the actual engraved artwork into exactly that area.
  function drawAluminumCard(ctx, w, h) {
    const margin = Math.min(w, h) * 0.08;
    const cardW = w - margin * 2;
    const cardH = cardW * (CARD_H_PX / CARD_W_PX);
    const rect = { x: margin, y: (h - cardH) / 2, w: cardW, h: cardH, r: cardW * (27 / CARD_W_PX) };

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
    ctx.fillStyle = '#0c0c0c';
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
  // Texture density (from the Finish toolbar's slider) is a real physical
  // value — lines per centimeter, cross-hatched at 45 degrees both ways —
  // so spacing converts directly, no representative curve needed here.
  function textureSpacingPx(linesPerCm) {
    const lpc = Math.max(1, linesPerCm || 25);
    const mm = 10 / lpc;
    return mm * PX_PER_MM;
  }
  // Builds a small tile with a 45-degree diagonal corner-to-corner —
  // repeating that tile is the standard trick for a continuous diagonal
  // hatch, since each tile's line meets its neighbors'. `crossed` adds the
  // opposite diagonal too, crossing in an X (Texture's cross-hatch); left
  // off, it's a single-direction brushed-grain line (White's own look).
  function makeHatchPatternCanvas(tileSizePx, lineColor, lineWidthPx, crossed) {
    const size = Math.max(1, tileSizePx);
    const pc = document.createElement('canvas');
    pc.width = size;
    pc.height = size;
    const pctx = pc.getContext('2d');
    pctx.strokeStyle = lineColor;
    pctx.lineWidth = lineWidthPx;
    pctx.beginPath();
    pctx.moveTo(0, size);
    pctx.lineTo(size, 0);
    if (crossed) {
      pctx.moveTo(0, 0);
      pctx.lineTo(size, size);
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
  function renderStrokeOutlinesToDataURL(snapshotJson, resolutionScale, callback) {
    const off = document.createElement('canvas');
    off.width = Math.round(CARD_W_PX * resolutionScale);
    off.height = Math.round(CARD_H_PX * resolutionScale);
    const staticCanvas = new fabric.StaticCanvas(off);
    staticCanvas.setZoom(resolutionScale);
    staticCanvas.loadFromJSON(snapshotJson, () => {
      // A shape that already carries a real, painted stroke (an SVG import's
      // own outline, or a shape given a border via the Shapes toolbar) gets
      // traced at that actual width — keeping whatever strokeUniform the
      // live object already has, so the preview matches the editor exactly:
      // a raw, never-touched vector stroke scales with the object like any
      // other geometry, while a width dialed in via the Stroke settings
      // field (which sets strokeUniform itself, precisely so it stays put
      // regardless of an imported SVG's own internal scale) stays constant
      // here too. A shape with no real stroke (a filled path/donut shape)
      // has no natural width to preserve, so it falls back to the fixed
      // representative trace width, held constant regardless of scale.
      function hasRealStroke(obj) {
        return !!(obj.stroke && obj.stroke !== 'none' && obj.strokeWidth > 0);
      }
      // The pattern tile's own pixel resolution never changes (always a
      // crisp, fixed HATCH_TILE_SOURCE_PX square) — the real spacing is
      // controlled entirely through patternTransform's scale instead.
      // Sizing the tile bitmap itself to the spacing (the previous
      // approach) rounds to a whole pixel, and every spacing under ~4px
      // (any Texture density past ~22 L/cm, and all of White's fixed
      // 200 L/cm) rounded to the exact same 4px floor — collapsing every
      // one of those densities into an identical, indistinguishable
      // pattern. A fixed-resolution tile scaled by an arbitrary, unrounded
      // factor has no such floor, so it keeps distinguishing densities
      // right down to sub-pixel spacing (visually converging into a
      // near-solid fill as spacing shrinks below the line width, which is
      // physically correct — tightly-packed lines really do read as solid).
      // patternTransform also carries the same avgScale correction as
      // before, canceling out the object's (and its ancestor groups')
      // own accumulated scale.
      const HATCH_TILE_SOURCE_PX = 64;
      function buildHatchFillPattern(obj, linesPerCm, crossed) {
        const { scaleX, scaleY } = fabric.util.qrDecompose(obj.calcTransformMatrix());
        const avgScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2 || 1;
        const spacing = textureSpacingPx(linesPerCm);
        const tileScale = spacing / HATCH_TILE_SOURCE_PX;
        const lineWidthInTile = RENDER_LINE_WIDTH_PX / tileScale;
        const patternCanvas = makeHatchPatternCanvas(HATCH_TILE_SOURCE_PX, 'rgb(250,250,250)', lineWidthInTile, crossed);
        const pattern = new fabric.Pattern({ source: patternCanvas, repeat: 'repeat' });
        const finalScale = tileScale / avgScale;
        pattern.patternTransform = [finalScale, 0, 0, finalScale, 0, 0];
        return pattern;
      }
      // A diagonal silver gradient with a bright highlight band down the
      // middle — the same sheen technique used on the aluminum card
      // background, just applied to the shape's own fill. Percentage
      // gradient units keep it scaled to each shape's own bounding box,
      // so it holds up at any size, aspect ratio, or rotation.
      function buildMetallicFill() {
        return new fabric.Gradient({
          type: 'linear',
          gradientUnits: 'percentage',
          coords: { x1: 0, y1: 0, x2: 1, y2: 1 },
          colorStops: [
            { offset: 0, color: '#3f4144' },
            { offset: 0.12, color: '#6c6f72' },
            { offset: 0.25, color: '#a8abad' },
            { offset: 0.38, color: '#f7f7f7' },
            { offset: 0.45, color: '#ffffff' },
            { offset: 0.52, color: '#f7f7f7' },
            { offset: 0.65, color: '#9a9d9f' },
            { offset: 0.78, color: '#5c5f62' },
            { offset: 0.88, color: '#8e9092' },
            { offset: 1, color: '#3f4144' },
          ],
        });
      }
      function styleForRender(obj) {
        if (obj.type === 'group') {
          obj.getObjects().forEach(styleForRender);
          return;
        }
        const finish = getFinish(obj);
        if (finish === 'metallic') {
          obj.set({ fill: buildMetallicFill(), stroke: null, opacity: 1 });
          return;
        }
        if (finish === 'texture') {
          // Outline traces the shape's own edge on top of the hatch fill —
          // deliberately overriding strokeWidth (obj's real one is the
          // Outline checkbox's own editor-visibility width, wider than the
          // shared render line width) so every line in this preview reads
          // as the same physical thickness, texture hatch included.
          obj.set({
            fill: buildHatchFillPattern(obj, obj.cardFinishTexture, true),
            stroke: obj.cardFinishOutline ? 'rgb(250,250,250)' : null,
            strokeWidth: RENDER_LINE_WIDTH_PX,
            strokeUniform: true,
            opacity: 1,
          });
          return;
        }
        if (finish === 'white') {
          // Plain solid fill, a touch off pure white so Frosted White (the
          // brighter, full-white finish) still reads as a distinct step up.
          obj.set({ fill: 'rgb(240,240,240)', stroke: null, opacity: 1 });
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
        if (hasRealStroke(obj)) {
          obj.set({ fill: null, stroke: 'rgb(250,250,250)', opacity: 1 });
        } else {
          obj.set({ fill: null, stroke: 'rgb(250,250,250)', strokeWidth: RENDER_LINE_WIDTH_PX, strokeUniform: true, opacity: 1 });
        }
      }
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
    const rect = drawAluminumCard(ctx, w, h);
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
    const canvasEl = renderingsBody && renderingsBody.querySelector(`.editor-renderings-canvas[data-side="${side}"]`);
    if (!canvasEl) return;
    const snapshot = side === currentSide
      ? undoStack[undoStack.length - 1]
      : (sideHistories[side] ? sideHistories[side].undo[sideHistories[side].undo.length - 1] : blankCanvasSnapshot);
    paintCardPreview(canvasEl, snapshot);
    // Keep the fullscreen modal live too, if it's open and showing this
    // same side, so an edit made without closing it doesn't go stale.
    if (renderModal && renderModal.classList.contains('is-open') && renderModalSide === side) {
      paintCardPreview(renderModalCanvas, snapshot);
    }
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
  // unioned/subtracted as a whole. Text isn't converted to outlines, so
  // that's the only common shape left out.
  const BOOLEAN_ELIGIBLE_TYPES = ['rect', 'circle', 'ellipse', 'triangle', 'path', 'polygon', 'polyline', 'line', 'group'];
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
  function localPolygonsFor(obj) {
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
  function absolutePolygonsFor(obj) {
    if (obj.type === 'group') {
      return obj.getObjects().flatMap((child) => absolutePolygonsFor(child));
    }
    const matrix = obj.calcTransformMatrix();
    return localPolygonsFor(obj)
      .map(sanitizeRing)
      .filter((ring) => ring.length >= 3)
      .map((ring) => ring.map(([x, y]) => {
        const p = fabric.util.transformPoint({ x, y }, matrix);
        return [p.x, p.y];
      }));
  }
  function polyBoolInputFor(obj) {
    return { regions: absolutePolygonsFor(obj), inverted: false };
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
        cardFinishOutline: styleSource.cardFinishOutline,
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
  function runUnion() {
    const active = fabricCanvas.getActiveObject();
    if (!active) return;
    const selected = active.type === 'activeSelection' ? active.getObjects() : [active];
    const ordered = fabricCanvas.getObjects().filter((o) => selected.includes(o) && BOOLEAN_ELIGIBLE_TYPES.includes(o.type));
    if (ordered.length < 2) return;
    let result;
    try {
      result = polyBoolInputFor(ordered[0]);
      for (let i = 1; i < ordered.length; i++) {
        result = PolyBool.union(result, polyBoolInputFor(ordered[i]));
      }
    } catch (e) {
      alert('Could not combine these shapes — the artwork is too complex for Union to resolve.');
      return;
    }
    if (!result.regions.length) return;
    replaceWithBooleanResult(ordered, result.regions, ordered[ordered.length - 1]);
  }
  // Subtract needs exactly two objects: the front (top) one's overlap is
  // removed from the back (bottom) one, which is what's left afterward
  // (keeping the bottom object's appearance).
  function runSubtract() {
    const active = fabricCanvas.getActiveObject();
    if (!active || active.type !== 'activeSelection') return;
    const selected = active.getObjects();
    const ordered = fabricCanvas.getObjects().filter((o) => selected.includes(o) && BOOLEAN_ELIGIBLE_TYPES.includes(o.type));
    if (ordered.length !== 2) return;
    const [bottom, top] = ordered;
    let result;
    try {
      result = PolyBool.difference(polyBoolInputFor(bottom), polyBoolInputFor(top));
    } catch (e) {
      alert('Could not subtract these shapes — the artwork is too complex for Subtract to resolve.');
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
    const isText = obj.type === 'i-text';
    textToolbar.classList.toggle('mode-text', isText);
    textToolbar.classList.toggle('mode-shape', !isText);
    if (isText) {
      if (fontFamilySelect) fontFamilySelect.value = obj.fontFamily || 'Arial';
      if (fontSizeInput) fontSizeInput.value = Math.round(obj.fontSize || 24);
      alignButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.align === (obj.textAlign || 'left')));
    } else {
      shapeTypeButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.shape === obj.type));
      refreshFillModeUI(obj);
      refreshLineStyleUI(obj);
      refreshCornerRadiusUI(obj);
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
  // Every object/group defaults to White until a finish is explicitly
  // chosen for it — reading through this one helper (instead of a raw
  // `obj.cardFinish`) everywhere means new objects never need to have
  // the default written onto them at creation time.
  function getFinish(obj) {
    return (obj && obj.cardFinish) || 'white';
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
  // Texture's own outline stroke width, once turned on — a plain, real
  // physical value (not the proofing color), same default as the Shapes
  // toolbar's own stroke width field.
  const TEXTURE_OUTLINE_WIDTH_PX = 0.5 * PX_PER_MM;
  function applyFinishToOne(obj, finish, textureAmount, outline) {
    obj.cardFinish = finish;
    obj.cardFinishTexture = finish === 'texture' ? textureAmount : undefined;
    obj.cardFinishOutline = finish === 'texture' ? !!outline : undefined;
    const color = finish === 'texture' && obj.cardFinishOutline
      ? FINISH_COLORS['texture-outline']
      : (FINISH_COLORS[finish] || FINISH_COLORS.white);
    applyFinishColor(obj, color);
    // Outline is purely additive — a texture-finish shape otherwise only
    // ever paints via fill, so the stroke channel is safe to own outright
    // here rather than needing applyFinishColor's fill-vs-stroke guessing.
    if (finish === 'texture') {
      if (obj.cardFinishOutline) {
        obj.set({ stroke: color, strokeWidth: obj.strokeWidth || TEXTURE_OUTLINE_WIDTH_PX, strokeUniform: true });
      } else if (obj.type !== 'line') {
        obj.set({ stroke: null });
      }
    }
  }
  // Applying a finish to a group (or a multi-object selection) sets it on
  // every object inside too, recursively — overriding whatever finish
  // those members had — same as picking Fill/Stroke mode for a whole
  // group already works elsewhere in this file. Selecting one member on
  // its own (via the Layers panel — see selectNestedObject) and changing
  // it only ever reaches this with that one object, so it stays scoped
  // to just that object, same as any plain shape.
  function applyFinishCascade(obj, finish, textureAmount, outline) {
    if (obj.type === 'activeSelection') {
      obj.getObjects().forEach((child) => applyFinishCascade(child, finish, textureAmount, outline));
      return;
    }
    applyFinishToOne(obj, finish, textureAmount, outline);
    if (obj.type === 'group') {
      obj.getObjects().forEach((child) => applyFinishCascade(child, finish, textureAmount, outline));
    }
  }
  function refreshFinishUI(obj) {
    const finish = getFinish(obj);
    finishButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.finish === finish));
    if (finishTextureSlider) finishTextureSlider.classList.toggle('is-visible', finish === 'texture');
    const textureAmount = (obj && obj.cardFinishTexture) || 25;
    if (finishTextureRange) finishTextureRange.value = textureAmount;
    if (finishTextureValue) finishTextureValue.value = textureAmount;
    if (finishTextureOutline) finishTextureOutline.checked = !!(obj && obj.cardFinishOutline);
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
    applyFinishCascade(obj, 'texture', clamped, obj.cardFinishOutline);
    fabricCanvas.requestRenderAll();
    refreshLayersList();
    if (commit) pushHistory();
  }
  function setTextureOutline(checked) {
    const obj = fabricCanvas.getActiveObject();
    if (!obj || obj.cardFinish !== 'texture') return;
    applyFinishCascade(obj, 'texture', obj.cardFinishTexture, checked);
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
      applyFinishCascade(obj, finish, textureAmount, outline);
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
    if (obj && (obj.type === 'i-text' || SHAPE_TYPES.includes(obj.type))) {
      showObjectToolbarFor(obj);
      applyScalingControlsVisibility(obj);
    } else {
      hideObjectToolbar();
    }
  }
  fabricCanvas.on('selection:created', handleSelection);
  fabricCanvas.on('selection:updated', handleSelection);
  fabricCanvas.on('selection:cleared', () => {
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
    clearSnapGuides();
    if (bestX) {
      obj.left += bestX.d;
      drawSnapLine(true, bestX.tx);
    }
    if (bestY) {
      obj.top += bestY.d;
      drawSnapLine(false, bestY.ty);
    }
    if (bestX || bestY) obj.setCoords();
  }
  fabricCanvas.on('mouse:up', clearSnapGuides);

  // Live readouts while dragging the move handle or the rotate handle.
  fabricCanvas.on('object:moving', (opt) => {
    if (!opt.target) return;
    applySnapping(opt.target);
    refreshTransformFields(opt.target);
  });
  fabricCanvas.on('object:rotating', (opt) => {
    if (opt.target) refreshTransformFields(opt.target);
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
      loadFontsBtn.disabled = true;
      loadFontsBtn.title = 'Loading system fonts needs Chrome or Edge — not supported in this browser';
    } else {
      loadFontsBtn.addEventListener('click', async () => {
        try {
          const fonts = await window.queryLocalFonts();
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

  // ---- Escape exits text editing, or deselects ----
  // Fabric doesn't bind either itself (only clicking away or Enter exits
  // editing), but both are the expected shortcut, so wire them up
  // explicitly. Editing takes priority — the first Escape just leaves
  // edit mode, matching how Enter/click-away already behave; a selected-
  // but-not-editing object is deselected outright.
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
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    if (obj.isEditing) {
      obj.exitEditing();
      return;
    }
    fabricCanvas.discardActiveObject();
    fabricCanvas.requestRenderAll();
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
      group: groupActiveSelection,
      ungroup: ungroupActiveObject,
      'remove-from-group': () => removeFromGroup(fabricCanvas.getActiveObject()),
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
        group: !!active && active.type === 'activeSelection',
        ungroup: !!active && active.type === 'group',
        'remove-from-group': !!active && active.type !== 'activeSelection' && isWithinGroupEditSession(active),
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
    try {
      return obj.toDataURL({ format: 'png', multiplier: LAYER_THUMB_SIZE / maxDim });
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
  // ---- Multi-selecting top-level rows from the Layers panel ----
  // Shift-click selects the visual range between this row and the last
  // one clicked (like a file browser); Cmd/Ctrl-click toggles just this
  // row in or out of whatever's currently selected, stacking freely.
  // Only for depth-0 rows — a nested row's "selection" is really a
  // temporary dissolve of its ancestor group(s) (see selectNestedObject),
  // which doesn't have a sensible way to combine with a second, unrelated
  // multi-selected object, so modifier clicks there are ignored.
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
  // Pulls a member permanently out of the group it's currently loose
  // from (see the group-edit session above) — unlike ending the session
  // normally, this one member never gets folded back in. Removing it
  // from the session's own bookkeeping before the rebuild runs means the
  // rebuild's own "is this member still around" filter naturally leaves
  // it out, same trick deleteActiveObjects relies on. Lands directly
  // above the reformed group in the stack (skipHistory on the rebuild
  // itself so the whole thing — rebuild + reposition — is one undo step,
  // not two).
  function removeFromGroup(obj) {
    if (!groupEditSession || !obj) return;
    const levelIdx = groupEditSession.levels.findIndex((members) => members.includes(obj));
    if (levelIdx === -1) return;
    groupEditSession.levels[levelIdx] = groupEditSession.levels[levelIdx].filter((o) => o !== obj);
    const rebuilt = endGroupEditSession(true);
    if (rebuilt && fabricCanvas.getObjects().includes(rebuilt)) {
      fabricCanvas.moveTo(obj, fabricCanvas.getObjects().indexOf(rebuilt) + 1);
    }
    fabricCanvas.setActiveObject(obj);
    handleSelection({ selected: [obj] });
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
          selectNestedObject(obj);
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
}
