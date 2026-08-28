// Business card editor — framework-stage script. Draws the ruler tick
// marks around the canvas, handles switching between the front and back
// side thumbnails, and lets the toolbar buttons be selected. No design/
// canvas functionality (what a selected tool actually does) yet.

const PX_PER_MM = 9; // matches the fixed sizing in card-editor.css

// ---- Toolbar tool selection ----
// Panel-toggle (Layers) and standalone-toggle (Guides) buttons are
// excluded — neither selects a drawing tool, so they're not part of
// this mutually-exclusive group.
const toolButtons = document.querySelectorAll('.editor-tool:not(.editor-panel-toggle):not(.editor-standalone-toggle)');
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
let zoomLevel = 100;

const canvasFrame = document.querySelector('.editor-canvas-frame');
const zoomValueEl = document.getElementById('zoom-value');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomInBtn = document.getElementById('zoom-in');

function applyZoom() {
  if (canvasFrame) canvasFrame.style.zoom = zoomLevel / 100;
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
      zoomLevel = 100;
      applyZoom();
      centerPanArea();
    });
  }
}

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
      if (!fabricCanvas.getActiveObject()) refreshFillModeUI({ type: currentShapeType });
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
    const base = { originX: 'left', originY: 'top', centeredRotation: false, fill: '#ffffff', left: 0, top: 0 };
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
  }

  let shapeDraw = null; // { type, x0, y0, shape }

  fabricCanvas.on('mouse:down', (opt) => {
    if (!isShapesToolActive() || opt.target) return;
    const pointer = fabricCanvas.getPointer(opt.e);
    const type = currentShapeType;
    const shape = type === 'line' ? makeLine(pointer.x, pointer.y, pointer.x, pointer.y) : makeBoxShape(type);
    if (type !== 'line') fitBoxShape(shape, type, pointer.x, pointer.y, pointer.x, pointer.y);
    fabricCanvas.add(shape);
    fabricCanvas.requestRenderAll();
    shapeDraw = { type, x0: pointer.x, y0: pointer.y, shape };
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

  function finishShapeDraw() {
    if (!shapeDraw) return;
    const { shape, type, x0, y0 } = shapeDraw;
    shapeDraw = null;
    hideShapeDrawLabel();
    const rect = shape.getBoundingRect(true, true);
    if (rect.width < 4 && rect.height < 4) {
      const SIZE = 60; // px — about 6.7mm at PX_PER_MM=9
      if (type === 'line') {
        fabricCanvas.remove(shape);
        const line = makeLine(x0 - SIZE / 2, y0, x0 + SIZE / 2, y0);
        fabricCanvas.add(line);
        finalizeShape(line);
        return;
      }
      fitBoxShape(shape, type, x0 - SIZE / 2, y0 - SIZE / 2, x0 + SIZE / 2, y0 + SIZE / 2);
    }
    finalizeShape(shape);
  }
  fabricCanvas.on('mouse:up', finishShapeDraw);
  // In case the pointer is released outside the canvas element.
  document.addEventListener('pointerup', () => {
    if (shapeDraw) finishShapeDraw();
  });

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
  const SHAPE_TYPES = ['line', 'rect', 'circle', 'triangle'];
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

  // ---- Shape fill vs. stroke, and stroke placement ----
  // Line is always a stroke already (it has no fill concept), so both the
  // fill/stroke toggle and the stroke settings dropdown only apply to
  // rect/circle/triangle.
  const SHAPE_FILL_TYPES = ['rect', 'circle', 'triangle'];
  const fillModeGroup = document.getElementById('shape-fill-mode-group');
  const fillModeButtons = document.querySelectorAll('.editor-shape-fill-btn');
  const strokeSettingsDropdown = document.getElementById('stroke-settings-dropdown');
  const strokeWidthInput = document.getElementById('shape-stroke-width');
  const strokeAlignButtons = document.querySelectorAll('.editor-stroke-align-btn');
  function shapeFillModeFor(obj) {
    return obj.stroke && !obj.fill ? 'stroke' : 'fill';
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
  function makeStrokeClipShapeFor(obj) {
    const common = { left: 0, top: 0, originX: 'center', originY: 'center' };
    if (obj.type === 'circle') return new fabric.Circle({ ...common, radius: obj.radius });
    if (obj.type === 'triangle') return new fabric.Triangle({ ...common, width: obj.width, height: obj.height });
    return new fabric.Rect({ ...common, width: obj.width, height: obj.height });
  }
  // Applies obj._strokeWidthPx (the width the user actually asked for)
  // and obj.strokeAlign to the object's real, renderable strokeWidth/
  // clipPath. Called whenever either of those, or fill/stroke mode,
  // changes — never needs re-running on a plain resize, since the clip
  // shares the object's own transform and scales/rotates/moves with it
  // automatically.
  function applyStrokeRender(obj) {
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
    const applicable = SHAPE_FILL_TYPES.includes(obj.type);
    if (fillModeGroup) fillModeGroup.classList.toggle('is-hidden', !applicable);
    if (!applicable) {
      if (strokeSettingsDropdown) strokeSettingsDropdown.classList.remove('is-visible');
      return;
    }
    const mode = shapeFillModeFor(obj);
    fillModeButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.fillMode === mode));
    if (strokeSettingsDropdown) strokeSettingsDropdown.classList.toggle('is-visible', mode === 'stroke');
    if (mode !== 'stroke') return;
    const widthPx = obj._strokeWidthPx || obj.strokeWidth || 0.5 * PX_PER_MM;
    if (strokeWidthInput) strokeWidthInput.value = (widthPx / PX_PER_MM).toFixed(2);
    const align = obj.strokeAlign || 'center';
    strokeAlignButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.strokeAlign === align));
  }
  fillModeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj || !SHAPE_FILL_TYPES.includes(obj.type)) return;
      setShapeFillMode(obj, btn.dataset.fillMode);
      refreshFillModeUI(obj);
      fabricCanvas.requestRenderAll();
    });
  });
  strokeAlignButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj || shapeFillModeFor(obj) !== 'stroke') return;
      obj.strokeAlign = btn.dataset.strokeAlign;
      applyStrokeRender(obj);
      refreshFillModeUI(obj);
      fabricCanvas.requestRenderAll();
    });
  });

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
    }
    if (typeof obj.getCenterPoint === 'function') refreshTransformFields(obj);
    else clearTransformFields();
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
  }
  function handleSelection(e) {
    const obj = (e.selected && e.selected[0]) || fabricCanvas.getActiveObject();
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
  });

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
  // Live readouts while dragging the move handle or the rotate handle.
  fabricCanvas.on('object:moving', (opt) => {
    if (opt.target) refreshTransformFields(opt.target);
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
  }
  alignButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj) return;
      obj.set('textAlign', btn.dataset.align);
      alignButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      fabricCanvas.requestRenderAll();
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
  });

  // ---- Anchor picker: clicking a point in the dropdown grid sets it ----
  anchorPanelButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const obj = fabricCanvas.getActiveObject();
      if (!obj) return;
      setObjectAnchor(obj, btn.dataset.anchor);
      fabricCanvas.requestRenderAll();
      refreshTransformFields(obj);
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
  }
  commitOnEnterOrBlur(sizeWInput, (val) => applySizeMm('w', val));
  commitOnEnterOrBlur(sizeHInput, (val) => applySizeMm('h', val));

  // ---- Stroke width (only meaningful while a shape is in stroke mode) ----
  commitOnEnterOrBlur(strokeWidthInput, (val) => {
    const obj = fabricCanvas.getActiveObject();
    if (!obj || shapeFillModeFor(obj) !== 'stroke') return;
    obj._strokeWidthPx = Math.max(0.01, val) * PX_PER_MM;
    applyStrokeRender(obj);
    fabricCanvas.requestRenderAll();
    refreshTransformFields(obj);
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
  function alignActiveObject(op) {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    const canvasW = fabricCanvas.getWidth();
    const canvasH = fabricCanvas.getHeight();
    const rect = obj.getBoundingRect(true, true);
    let dx = 0;
    let dy = 0;
    if (op === 'left' || op === 'center' || op === 'center-h') {
      const targetLeft = op === 'left' ? 0 : (canvasW - rect.width) / 2;
      dx = targetLeft - rect.left;
    } else if (op === 'right') {
      dx = canvasW - (rect.left + rect.width);
    }
    if (op === 'top' || op === 'center' || op === 'center-v') {
      const targetTop = op === 'top' ? 0 : (canvasH - rect.height) / 2;
      dy = targetTop - rect.top;
    } else if (op === 'bottom') {
      dy = canvasH - (rect.top + rect.height);
    }
    obj.set({ left: obj.left + dx, top: obj.top + dy });
    obj.setCoords();
    fabricCanvas.requestRenderAll();
    refreshTransformFields(obj);
  }
  objAlignButtons.forEach((btn) => {
    btn.addEventListener('click', () => alignActiveObject(btn.dataset.alignOp));
  });

  // ---- Escape exits text editing ----
  // Fabric doesn't bind this itself (only clicking away or Enter does),
  // but it's the expected shortcut, so wire it up explicitly.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const obj = fabricCanvas.getActiveObject();
    if (obj && obj.isEditing) obj.exitEditing();
  });

  // ---- Delete the selected object ----
  // Skip it while a text object is actively being edited (Backspace/Delete
  // there should just edit the text, which Fabric already handles) and
  // while focus is in one of the toolbar's own inputs.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const obj = fabricCanvas.getActiveObject();
    if (!obj || obj.isEditing) return;
    e.preventDefault();
    fabricCanvas.remove(obj);
    fabricCanvas.discardActiveObject();
    fabricCanvas.requestRenderAll();
    hideObjectToolbar();
  });
}
