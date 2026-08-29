// Business card editor — framework-stage script. Draws the ruler tick
// marks around the canvas, handles switching between the front and back
// side thumbnails, and lets the toolbar buttons be selected. No design/
// canvas functionality (what a selected tool actually does) yet.

const PX_PER_MM = 9; // matches the fixed sizing in card-editor.css

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

// ---- Guides toggle — shows/hides the center-crosshair guide lines on
// the card. (The safe zone is separate and always visible.) ----
const guidesBtn = document.getElementById('toggle-guides');
const editorCardEl = document.getElementById('editor-card');
if (guidesBtn && editorCardEl) {
  guidesBtn.addEventListener('click', () => {
    guidesBtn.classList.toggle('is-active');
    editorCardEl.classList.toggle('show-guides');
  });
}

// ---- Rulers ----
function buildRuler(el, lengthMm, isVertical) {
  const MAJOR_EVERY = 10; // mm
  const MINOR_EVERY = 2; // mm
  for (let mm = 0; mm <= lengthMm; mm += MINOR_EVERY) {
    const isMajor = mm % MAJOR_EVERY === 0;
    const pos = mm * PX_PER_MM;

    const tick = document.createElement('span');
    tick.className = 'ruler-tick ' + (isMajor ? 'major' : 'minor');
    if (isVertical) tick.style.top = `${pos}px`;
    else tick.style.left = `${pos}px`;
    el.appendChild(tick);

    if (isMajor) {
      const label = document.createElement('span');
      label.className = 'ruler-label';
      label.textContent = mm;
      if (isVertical) label.style.top = `${pos}px`;
      else label.style.left = `${pos}px`;
      el.appendChild(label);
    }
  }
}

const rulerTop = document.getElementById('ruler-top');
const rulerLeft = document.getElementById('ruler-left');
if (rulerTop) buildRuler(rulerTop, 86, false);
if (rulerLeft) buildRuler(rulerLeft, 54, true);

// ---- Front/back side switcher ----
const sidesEl = document.getElementById('editor-sides');
const addBackBtn = document.getElementById('add-back-side');
const cardLabel = document.getElementById('editor-card-label');

function setActiveSide(sideName) {
  sidesEl.querySelectorAll('.editor-side-thumb').forEach((thumb) => {
    thumb.classList.toggle('is-active', thumb.dataset.side === sideName);
  });
  if (cardLabel) {
    const name = sideName === 'front' ? 'Front' : 'Back';
    cardLabel.textContent = `${name} — 86 × 54mm`;
  }
}

if (sidesEl) {
  sidesEl.addEventListener('click', (e) => {
    const thumb = e.target.closest('.editor-side-thumb');
    if (thumb) setActiveSide(thumb.dataset.side);
  });
}
// The card label starts as plain static text in the HTML ("Front", no
// dimensions) — run the same update used when switching sides once at
// load so it matches from the start instead of only after the first
// front/back click.
setActiveSide('front');

const renderingsBody = document.getElementById('renderings-body');

if (addBackBtn) {
  addBackBtn.addEventListener('click', () => {
    const backThumb = document.createElement('button');
    backThumb.type = 'button';
    backThumb.className = 'editor-side-thumb';
    backThumb.dataset.side = 'back';
    backThumb.innerHTML = `
      <span class="editor-side-thumb-card"></span>
      <span class="editor-side-thumb-label">Back</span>
    `;
    addBackBtn.replaceWith(backThumb);
    setActiveSide('back');

    // A back side now exists, so the renderings panel should preview
    // both sides — add a second card box alongside the front one.
    if (renderingsBody && !renderingsBody.querySelector('[data-side="back"]')) {
      const backPreview = document.createElement('div');
      backPreview.className = 'editor-renderings-empty';
      backPreview.dataset.side = 'back';
      renderingsBody.appendChild(backPreview);
    }
  });
}

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

// ---- Renderings panel resize (drag the left edge) ----
// The panel has its own explicit width (see card-editor.css); the panel
// itself recentering its contents when resized comes for free from
// .editor-renderings-body's flex centering — nothing extra needed here.
const renderingsPanel = document.getElementById('renderings-panel');
const renderingsResize = document.getElementById('renderings-resize');
const editorMainEl = document.querySelector('.editor-main');
if (renderingsPanel && renderingsResize && editorMainEl) {
  const RENDERINGS_MIN = 260;
  let isResizingRenderings = false;

  renderingsResize.addEventListener('pointerdown', (e) => {
    isResizingRenderings = true;
    renderingsResize.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
  });

  renderingsResize.addEventListener('pointermove', (e) => {
    if (!isResizingRenderings) return;
    const mainRect = editorMainEl.getBoundingClientRect();
    const maxWidth = window.innerWidth * (2 / 3); // matches the CSS max-width: 66.666vw cap
    const newWidth = Math.max(RENDERINGS_MIN, Math.min(maxWidth, mainRect.right - e.clientX));
    renderingsPanel.style.width = `${newWidth}px`;
  });

  const stopResizingRenderings = (e) => {
    if (!isResizingRenderings) return;
    isResizingRenderings = false;
    document.body.style.cursor = '';
    if (renderingsResize.hasPointerCapture(e.pointerId)) renderingsResize.releasePointerCapture(e.pointerId);
  };
  renderingsResize.addEventListener('pointerup', stopResizingRenderings);
  renderingsResize.addEventListener('pointercancel', stopResizingRenderings);
}

// ---- Fabric.js canvas — the first real (non-placeholder) tool: Text ----
const fabricCanvasEl = document.getElementById('fabric-canvas');
let fabricCanvas = null;
if (fabricCanvasEl && window.fabric) {
  fabricCanvas = new fabric.Canvas('fabric-canvas', {
    width: 774,
    height: 486,
    backgroundColor: '#3a3a3a',
    selection: true,
  });

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
    shapeDrawLabel.textContent = `${(wPx / PX_PER_MM).toFixed(1)} × ${(hPx / PX_PER_MM).toFixed(1)} mm`;
    shapeDrawLabel.style.left = `${nearX + 10}px`;
    shapeDrawLabel.style.top = `${nearY + 10}px`;
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
  const SHAPE_SIZE_MODAL_DEFAULT_MM = 20;
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
    if (shapeSizeModalW) shapeSizeModalW.value = SHAPE_SIZE_MODAL_DEFAULT_MM;
    if (shapeSizeModalH) shapeSizeModalH.value = SHAPE_SIZE_MODAL_DEFAULT_MM;
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
    const wMm = parseFloat(shapeSizeModalW ? shapeSizeModalW.value : '');
    const hMm = parseFloat(shapeSizeModalH ? shapeSizeModalH.value : '');
    if (!(wMm > 0) || (type !== 'line' && !(hMm > 0))) return; // leave the dialog open to fix it
    const wPx = wMm * PX_PER_MM;
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
    const hPx = hMm * PX_PER_MM;
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
        // size otherwise.
        const maxW = fabricCanvas.getWidth();
        const maxH = fabricCanvas.getHeight();
        const overflowScale = Math.min(1, maxW / group.getScaledWidth(), maxH / group.getScaledHeight());
        if (overflowScale < 1) group.scale(group.scaleX * overflowScale);

        group.set({
          left: (fabricCanvas.getWidth() - group.getScaledWidth()) / 2,
          top: (fabricCanvas.getHeight() - group.getScaledHeight()) / 2,
        });
        fabricCanvas.add(group);
        finalizeShape(group);
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
  const shapeUniformCheckbox = document.getElementById('shape-uniform-scale');
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
    const desired = obj._strokeWidthPx || 0.5 * PX_PER_MM;
    if (align === 'center') {
      obj.set({ strokeWidth: desired, clipPath: null });
    } else {
      const clip = makeStrokeClipShapeFor(obj);
      clip.set({ inverted: align === 'outside' });
      obj.set({ strokeWidth: desired * 2, clipPath: clip });
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
    if (strokeWidthInput) strokeWidthInput.value = (widthPx / PX_PER_MM).toFixed(2);
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
    if (obj.type === 'circle') return new fabric.Circle({ ...common, radius: obj.radius });
    if (obj.type === 'ellipse') return new fabric.Ellipse({ ...common, rx: obj.rx, ry: obj.ry });
    if (obj.type === 'triangle') return new fabric.Triangle({ ...common, width: obj.width, height: obj.height });
    if (obj.type === 'polygon' || obj.type === 'polyline') return new fabric.Polygon(obj.points, { ...common });
    if (obj.type === 'path') return new fabric.Path(pathCommandsToString(obj.path), { ...common, fillRule: obj.fillRule });
    return new fabric.Rect({ ...common, width: obj.width, height: obj.height });
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
    const props = {
      left: center.x, top: center.y, originX: 'center', originY: 'center',
      angle: obj.angle, scaleX: obj.scaleX, scaleY: obj.scaleY,
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
    fabricCanvas.discardActiveObject();
    suppressHistoryEvents = true;
    objects.forEach((o) => fabricCanvas.remove(o));
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
  const HISTORY_PROPS = ['strokeAlign', '_strokeWidthPx', 'lineDashStyle'];
  const HISTORY_LIMIT = 50;
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  let undoStack = [];
  let redoStack = [];
  let isRestoringHistory = false;
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
  // Called after every discrete edit settles (never mid-drag) — see the
  // individual call sites throughout this file. Harmless to call more
  // than once for the same edit: identical-to-the-top-of-stack snapshots
  // are skipped, so a Fabric event and an explicit call for the same
  // action don't create a duplicate undo step.
  function pushHistory() {
    if (isRestoringHistory) return;
    const snapshot = JSON.stringify(fabricCanvas.toJSON(HISTORY_PROPS));
    if (undoStack.length && undoStack[undoStack.length - 1] === snapshot) return;
    undoStack.push(snapshot);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
  }
  function restoreHistorySnapshot(snapshot) {
    isRestoringHistory = true;
    fabricCanvas.discardActiveObject();
    hideEdgeIndicator();
    clearSnapGuides();
    fabricCanvas.loadFromJSON(snapshot, () => {
      fabricCanvas.requestRenderAll();
      isRestoringHistory = false;
      hideObjectToolbar();
      refreshLayersList();
      updateUndoRedoButtons();
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
  // truly empty card, instead of having nothing before it to land on.
  pushHistory();

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
      style = { fill: styleSource.stroke, stroke: null, strokeWidth: 0 };
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

  // Text defaults to uniform (its own checkbox, unchecked, means "keep it
  // uniform"); shapes default to free/non-uniform (their checkbox,
  // unchecked, means "don't lock it uniform") — same underlying idea,
  // opposite default, because that's the sensible default for each: text
  // usually shouldn't distort, shapes commonly get stretched freely.
  function isNonUniformAllowed(obj) {
    if (!obj) return false;
    if (obj.type === 'i-text') return !!(nonUniformCheckbox && nonUniformCheckbox.checked);
    return !(shapeUniformCheckbox && shapeUniformCheckbox.checked);
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
    if (posXInput) posXInput.value = (obj.left / PX_PER_MM).toFixed(2);
    if (posYInput) posYInput.value = (obj.top / PX_PER_MM).toFixed(2);
    if (sizeWInput) sizeWInput.value = (displayWidthOf(obj) / PX_PER_MM).toFixed(2);
    if (sizeHInput) sizeHInput.value = (displayHeightOf(obj) / PX_PER_MM).toFixed(2);
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
    }
    const isRealObject = typeof obj.getCenterPoint === 'function';
    if (isRealObject) refreshTransformFields(obj);
    else clearTransformFields();
    if (isRealObject && SHAPE_FILL_TYPES.includes(obj.type)) showEdgeIndicatorFor(obj);
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
  function handleSelection(e) {
    // getActiveObject() first, not e.selected[0]: for a multi-selection,
    // e.selected[0] is just one of the newly-selected members, which
    // would wrongly show that single object's toolbar/edge indicator
    // instead of recognizing the real active object is the whole
    // ActiveSelection.
    const obj = fabricCanvas.getActiveObject() || (e.selected && e.selected[0]);
    if (obj && (obj.type === 'i-text' || SHAPE_TYPES.includes(obj.type))) {
      showObjectToolbarFor(obj);
      applyScalingControlsVisibility(obj);
    } else {
      hideObjectToolbar();
    }
  }
  fabricCanvas.on('selection:created', handleSelection);
  fabricCanvas.on('selection:updated', handleSelection);
  fabricCanvas.on('selection:cleared', hideObjectToolbar);

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
    const w = fabricCanvas.getWidth();
    const h = fabricCanvas.getHeight();
    const targetXs = [0, w / 2, w];
    const targetYs = [0, h / 2, h];
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

  // ---- Position fields (anchor point, mm from the card's top-left) ----
  // obj.left/top already *are* the anchor point's coordinates once
  // originX/Y is set to match it, so this is a direct set — no delta
  // math needed.
  function moveActiveObjectAnchorTo(axis, valueMm) {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    const targetPx = valueMm * PX_PER_MM;
    if (axis === 'x') obj.set({ left: targetPx });
    else obj.set({ top: targetPx });
    obj.setCoords();
    fabricCanvas.requestRenderAll();
    refreshTransformFields(obj);
    pushHistory();
  }
  commitOnEnterOrBlur(posXInput, (val) => moveActiveObjectAnchorTo('x', val));
  commitOnEnterOrBlur(posYInput, (val) => moveActiveObjectAnchorTo('y', val));

  // ---- Size fields (width/height, mm) ----
  // Text, uniform (default): folds into fontSize so both dimensions move
  // together, same anti-distortion approach as corner-drag scaling.
  // Text, non-uniform: only the edited axis's scale changes.
  // Shapes: there's no fontSize equivalent, so it's always scaleX/scaleY
  // directly — uniform mode scales both by the edited axis's ratio,
  // non-uniform mode only touches the one axis.
  function applySizeMm(axis, valueMm) {
    const obj = fabricCanvas.getActiveObject();
    if (!obj || valueMm <= 0) return;
    const targetPx = valueMm * PX_PER_MM;
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
    const px = Math.max(0.01, val) * PX_PER_MM;
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

  // ---- Scaling checkboxes (text's "Non-uniform scale", shapes' "Uniform
  // scale") — only ever one is visible at a time, but both just need to
  // refresh the active object's handle visibility when toggled. ----
  [nonUniformCheckbox, shapeUniformCheckbox].forEach((checkbox) => {
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
    const target = { left: 0, top: 0, width: fabricCanvas.getWidth(), height: fabricCanvas.getHeight() };
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
    fabricCanvas.upperCanvasEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
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
  function layerLabelFor(obj) {
    if (obj.type === 'i-text' || obj.type === 'text') return (obj.text && obj.text.trim()) || 'Text';
    const names = {
      rect: 'Rectangle', circle: 'Circle', triangle: 'Triangle', line: 'Line', path: 'Path', group: 'Group',
      ellipse: 'Ellipse', polygon: 'Polygon', polyline: 'Polyline', image: 'Image',
    };
    return names[obj.type] || obj.type.charAt(0).toUpperCase() + obj.type.slice(1);
  }
  // Groups (from the context menu's Group action, or an imported SVG —
  // see importSvgFile below) default to expanded, showing their own
  // members nested underneath; collapsed state is remembered here across
  // rebuilds since the list itself is rebuilt from scratch every time.
  const collapsedGroups = new Set();
  function refreshLayersList() {
    if (!layersList) return;
    const active = fabricCanvas.getActiveObject();
    const activeMembers = active ? (active.type === 'activeSelection' ? active.getObjects() : [active]) : [];
    const objects = fabricCanvas.getObjects().filter((o) => o.evented !== false);
    if (layersEmpty) layersEmpty.style.display = objects.length ? 'none' : '';
    layersList.innerHTML = '';
    function renderRow(obj, depth) {
      const li = document.createElement('li');
      li.className = 'editor-layer-item';
      li.style.paddingLeft = `${8 + depth * 16}px`;
      const isGroup = obj.type === 'group';
      const children = isGroup ? obj.getObjects() : [];
      const collapsed = collapsedGroups.has(obj);
      if (depth === 0 && activeMembers.includes(obj)) li.classList.add('is-active');
      if (depth > 0) {
        // Nested members are shown for visibility into the group's
        // contents, not as independently selectable/editable objects —
        // Ungroup first to work with one directly.
        li.classList.add('is-child');
      }
      const toggle = isGroup && children.length
        ? `<button type="button" class="editor-layer-toggle" aria-label="${collapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!collapsed}">${collapsed ? '▸' : '▾'}</button>`
        : '<span class="editor-layer-toggle-spacer"></span>';
      li.innerHTML = `${toggle}${LAYER_ICONS[obj.type] || ''}<span class="editor-layer-item-label"></span>`;
      li.querySelector('.editor-layer-item-label').textContent = layerLabelFor(obj);
      if (depth === 0) {
        li.addEventListener('click', (e) => {
          if (e.target.closest('.editor-layer-toggle')) return;
          fabricCanvas.setActiveObject(obj);
          handleSelection({ selected: [obj] });
          fabricCanvas.requestRenderAll();
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
  }
  // Helper overlays (the edge indicator, snap guide lines) are
  // evented:false and never shown in the list anyway, so skip the
  // rebuild for those — otherwise every drag frame's snap-line add/
  // remove would needlessly rebuild this list too.
  fabricCanvas.on('object:added', (opt) => {
    if (opt.target && opt.target.evented === false) return;
    refreshLayersList();
  });
  fabricCanvas.on('object:removed', (opt) => {
    if (opt.target && opt.target.evented === false) return;
    refreshLayersList();
  });
  fabricCanvas.on('selection:created', refreshLayersList);
  fabricCanvas.on('selection:updated', refreshLayersList);
  fabricCanvas.on('selection:cleared', refreshLayersList);
  refreshLayersList();
}
