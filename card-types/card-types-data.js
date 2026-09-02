// Card type gallery entries (card-editor.html/js) -- the physical
// aluminum blank the design gets engraved onto, picked separately from
// the design itself. Same plain-data-in-a-script-tag approach as
// templates/templates-data.js, for the same reason (fetch() is blocked
// on a page opened straight from disk).
//
// `photo` is left null for every entry for now -- the card-type modal
// shows a plain color-tinted placeholder box until real product photos
// are dropped in here (a data URI or a relative path both work once
// added, since paintCardTypePreview in card-editor.js checks this field
// before falling back to the placeholder).
//
// `swatch` is only a rough placeholder tint standing in for the real
// anodized color until then, not a color-accurate spec.
// Colors/hex values match the shop's own anodized-aluminum swatch chart
// (Clear/Green/Red/Orange/Blue/Violet/Black/Yellow, coded CL/GR/RD/RG/
// BL/VT/BK/YL) — not an arbitrary palette. The "Clear" (bare anodized
// aluminum, no dye) swatch is shown to customers as "Silver", which is
// why it's the one card-editor.js treats as equivalent to the Metallic
// finish (see isSilverCardTypeSelected) despite the swatch chart's own
// "Clear" naming — `id` keeps the `clear-*` form regardless, since it's
// an internal identifier (also embedded in any already-saved .plm file's
// cardTypeId) rather than user-facing text.
window.CARD_TYPES = [
  { id: 'black-016',  color: 'Black',  swatch: '#0d0d0d', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'black-032',  color: 'Black',  swatch: '#0d0d0d', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'clear-016',  color: 'Silver', swatch: '#8b8f94', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'clear-032',  color: 'Silver', swatch: '#8b8f94', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'yellow-016', color: 'Yellow', swatch: '#c9a83f', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'yellow-032', color: 'Yellow', swatch: '#c9a83f', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'red-016',    color: 'Red',    swatch: '#9c2b3a', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'red-032',    color: 'Red',    swatch: '#9c2b3a', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'blue-016',   color: 'Blue',   swatch: '#215bab', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'blue-032',   color: 'Blue',   swatch: '#215bab', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'orange-016', color: 'Orange', swatch: '#c9781f', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'orange-032', color: 'Orange', swatch: '#c9781f', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'violet-016', color: 'Violet', swatch: '#4a2d7d', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'violet-032', color: 'Violet', swatch: '#4a2d7d', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'green-016',  color: 'Green',  swatch: '#2f7a45', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'green-032',  color: 'Green',  swatch: '#2f7a45', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
];
