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
window.CARD_TYPES = [
  { id: 'black-016',  color: 'Black',  swatch: '#1a1a1a', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'black-032',  color: 'Black',  swatch: '#1a1a1a', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'silver-016', color: 'Silver', swatch: '#8b8f94', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'silver-032', color: 'Silver', swatch: '#8b8f94', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'gold-016',   color: 'Gold',   swatch: '#c9a24b', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'gold-032',   color: 'Gold',   swatch: '#c9a24b', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'red-016',    color: 'Red',    swatch: '#b02e2e', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'red-032',    color: 'Red',    swatch: '#b02e2e', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'blue-016',   color: 'Blue',   swatch: '#1d4ed8', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'blue-032',   color: 'Blue',   swatch: '#1d4ed8', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'orange-016', color: 'Orange', swatch: '#d9760e', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'orange-032', color: 'Orange', swatch: '#d9760e', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'violet-016', color: 'Violet', swatch: '#7c3aed', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'violet-032', color: 'Violet', swatch: '#7c3aed', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
  { id: 'green-016',  color: 'Green',  swatch: '#2f6b3a', thicknessIn: '0.016"', thicknessMm: '0.4mm', photo: null },
  { id: 'green-032',  color: 'Green',  swatch: '#2f6b3a', thicknessIn: '0.032"', thicknessMm: '0.8mm', photo: null },
];
