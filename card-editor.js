// Business card editor — framework-stage script. Draws the ruler tick
// marks around the canvas and handles switching between the front and
// back side thumbnails. No design/canvas functionality yet.

const PX_PER_MM = 6; // matches the fixed sizing in card-editor.css

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
  });
}
