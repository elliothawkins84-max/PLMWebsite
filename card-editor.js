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
  const isTextToolActive = () => !!(textBtn && textBtn.classList.contains('is-active'));

  // Update the canvas cursor whenever the active tool changes, and show
  // the text formatting toolbar as soon as the Text tool is selected
  // (reflecting the defaults new text will use), not only once a text
  // object is actually selected. Switching to another tool hides it
  // again, unless a text object is still selected.
  toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      fabricCanvas.defaultCursor = btn.id === 'tool-text' ? 'text' : 'default';
      if (btn.id === 'tool-text') {
        showTextToolbarFor({ fontFamily: 'Arial', fontSize: 24, textAlign: 'left' });
      } else if (!fabricCanvas.getActiveObject()) {
        hideTextToolbar();
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
    text.enterEditing();
    fabricCanvas.requestRenderAll();
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
    if (sizeWInput) sizeWInput.value = (obj.getScaledWidth() / PX_PER_MM).toFixed(2);
    if (sizeHInput) sizeHInput.value = (obj.getScaledHeight() / PX_PER_MM).toFixed(2);
  }
  function clearTransformFields() {
    if (rotationInput) rotationInput.value = 0;
    updateAnchorIcon('tl');
    if (posXInput) posXInput.value = '';
    if (posYInput) posYInput.value = '';
    if (sizeWInput) sizeWInput.value = '';
    if (sizeHInput) sizeHInput.value = '';
  }

  function showTextToolbarFor(obj) {
    if (!textToolbar) return;
    textToolbar.classList.add('is-visible');
    if (fontFamilySelect) fontFamilySelect.value = obj.fontFamily || 'Arial';
    if (fontSizeInput) fontSizeInput.value = Math.round(obj.fontSize || 24);
    alignButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.align === (obj.textAlign || 'left')));
    if (typeof obj.getCenterPoint === 'function') refreshTransformFields(obj);
    else clearTransformFields();
  }
  // The toolbar should stay up for as long as the Text tool itself is
  // selected, even once there's no text object to reflect (e.g. the
  // selection was cleared, or the object got deleted) — falls back to
  // showing the tool's defaults instead of hiding.
  function hideTextToolbar() {
    if (!textToolbar) return;
    if (isTextToolActive()) {
      showTextToolbarFor({ fontFamily: 'Arial', fontSize: 24, textAlign: 'left' });
      return;
    }
    textToolbar.classList.remove('is-visible');
  }
  function handleSelection(e) {
    const obj = (e.selected && e.selected[0]) || fabricCanvas.getActiveObject();
    if (obj && obj.type === 'i-text') showTextToolbarFor(obj);
    else hideTextToolbar();
  }
  fabricCanvas.on('selection:created', handleSelection);
  fabricCanvas.on('selection:updated', handleSelection);
  fabricCanvas.on('selection:cleared', hideTextToolbar);

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
    if (!obj || obj.type !== 'i-text') return;
    if (fontSizeInput) fontSizeInput.value = Math.max(1, Math.round(obj.fontSize * ((obj.scaleX + obj.scaleY) / 2)));
    refreshTransformFields(obj);
  });
  fabricCanvas.on('object:modified', (opt) => {
    const obj = opt.target;
    if (!obj) return;
    if (obj.type === 'i-text' && (obj.scaleX !== 1 || obj.scaleY !== 1)) {
      const newSize = Math.max(1, Math.round(obj.fontSize * ((obj.scaleX + obj.scaleY) / 2)));
      obj.set({ fontSize: newSize, scaleX: 1, scaleY: 1 });
      fabricCanvas.requestRenderAll();
      if (fontSizeInput) fontSizeInput.value = newSize;
    }
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

  // ---- Size fields (width/height, mm) — like corner-drag scaling, this
  // folds into fontSize (uniformly) rather than stretching the text. ----
  function applyUniformSizeMm(axis, valueMm) {
    const obj = fabricCanvas.getActiveObject();
    if (!obj || obj.type !== 'i-text' || valueMm <= 0) return;
    const targetPx = valueMm * PX_PER_MM;
    const current = axis === 'w' ? obj.getScaledWidth() : obj.getScaledHeight();
    if (!current) return;
    const ratio = targetPx / current;
    const newSize = Math.max(1, Math.round(obj.fontSize * ratio));
    obj.set({ fontSize: newSize, scaleX: 1, scaleY: 1 });
    obj.setCoords();
    fabricCanvas.requestRenderAll();
    if (fontSizeInput) fontSizeInput.value = newSize;
    refreshTransformFields(obj);
  }
  commitOnEnterOrBlur(sizeWInput, (val) => applyUniformSizeMm('w', val));
  commitOnEnterOrBlur(sizeHInput, (val) => applyUniformSizeMm('h', val));

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
    hideTextToolbar();
  });
}
