// Laser-marked electrical outlet panels: the shared plate model + SVG
// renderer. The exact same file is used by the website's builder
// (outlet-panels.html) and by PLM Job Viewer (renderer/outlet-plate.js), so
// a plate looks identical in both. Standard-size wall plates, 4.50in tall,
// 1 to 4 gang; every gang of a plate gets the same opening (see TYPES).
(function (root) {
  const PLATE_H_IN = 4.5;
  // Standard-size plate widths by gang count; gangs sit 1.8125in apart.
  const GANGS = {
    1: { label: '1-Gang', widthIn: 2.75 },
    2: { label: '2-Gang', widthIn: 4.56 },
    3: { label: '3-Gang', widthIn: 6.375 },
    4: { label: '4-Gang', widthIn: 8.19 },
  };
  const GANG_SPACING_IN = 1.8125;

  // Plate types. `receptacles` groups the two receptacle types under one
  // "Receptacle" choice with a 1-or-2 option on the website.
  const TYPES = {
    duplex: { label: 'Duplex Receptacle', short: 'Duplex', group: 'receptacle', receptacles: 2 },
    single: { label: 'Single Receptacle', short: 'Single Receptacle', group: 'receptacle', receptacles: 1 },
    toggle: { label: 'Toggle Switch', short: 'Toggle', group: 'toggle' },
    rocker: { label: 'Rocker / Decorative', short: 'Rocker', group: 'rocker' },
    blank: { label: 'Blank', short: 'Blank', group: 'blank' },
  };
  function typeOf(item) {
    return TYPES[item && item.type] ? item.type : 'duplex';
  }

  const MATERIALS = {
    thermoset: { label: 'Durable Thermoset Plastic', short: 'Thermoset' },
    nylon: { label: 'Flexible Thermoplastic Nylon', short: 'Nylon' },
    stainless: { label: 'Stainless Steel', short: 'Stainless Steel' },
  };
  // Plate colors (plastic and nylon only -- stainless is its own finish).
  const COLORS = {
    white: { label: 'White', hex: '#f3f2ec' },
    tan: { label: 'Tan', hex: '#d8c7a3' },
    gray: { label: 'Gray', hex: '#c9cbcd' },
    black: { label: 'Black', hex: '#1f1f20' },
  };
  const MARKS = {
    'dark-gray': { label: 'Dark Gray', hex: '#3d3d3d' },
    white: { label: 'White', hex: '#f4f4f4' },
    black: { label: 'Black', hex: '#141414' },
  };
  // The mark color is set by the plate, never chosen: dark gray on white,
  // tan and gray; white on black; black on stainless steel.
  function markFor(material, color) {
    if (material === 'stainless') return 'black';
    return color === 'black' ? 'white' : 'dark-gray';
  }

  // One fixed text size, always centered across the top of the plate.
  const TEXT = {
    sizeIn: 0.26,
    baselineIn: 0.74,
    sideMarginIn: 0.25,
    font: 'Arial, Helvetica, sans-serif',
    // Character limits by gang, roughly what fits at that size.
    maxChars: { 1: 14, 2: 24, 3: 36, 4: 46 },
  };

  function widthOf(gang) {
    return (GANGS[gang] || GANGS[1]).widthIn;
  }
  // Width available for the text line, in inches.
  function textRoomIn(gang) {
    return widthOf(gang) - TEXT.sideMarginIn * 2;
  }

  let measureCtx = null;
  // How wide `text` prints, in inches (null where there's no canvas).
  function textWidthIn(text) {
    if (typeof document === 'undefined') return null;
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = `100px ${TEXT.font}`;
    return (measureCtx.measureText(String(text || '')).width / 100) * TEXT.sizeIn;
  }
  // Plate text is always all caps.
  function caps(text) {
    return String(text == null ? '' : text).toUpperCase();
  }
  function textFits(text, gang) {
    const w = textWidthIn(caps(text));
    return w == null || w <= textRoomIn(gang);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let uidCounter = 0;
  // An SVG string of one plate. item: { gang, material, color, text }.
  // Drawn in hundredths of an inch (viewBox width = plate width x 100).
  function plateSVG(item, opts) {
    const o = opts || {};
    const gang = GANGS[item.gang] ? Number(item.gang) : 1;
    const material = MATERIALS[item.material] ? item.material : 'thermoset';
    const stainless = material === 'stainless';
    const color = COLORS[item.color] ? item.color : 'white';
    const mark = MARKS[markFor(material, color)];
    const W = widthOf(gang) * 100;
    const H = PLATE_H_IN * 100;
    const type = typeOf(item);
    const id = `op${(uidCounter += 1)}`;
    const dark = !stainless && color === 'black';
    const base = stainless ? `url(#${id}-steel)` : COLORS[color].hex;

    // Openings (and screws) for one gang, centered at cx, in hundredths of
    // an inch: duplex 1.343in x 1.125in (round with flats top and bottom)
    // 1.5in apart with a center screw; single receptacle a 1.406in round;
    // toggle a 0.401in x 0.925in slot; rocker/decorative a 1.310in x 2.630in
    // opening with no screws (screwless plate); blank none. Toggle, single
    // and blank plates have screws 2.375in apart, above and below.
    const cy = H / 2;
    const r = 67.15;
    const flat = 56.25;
    const dx = Math.sqrt(r * r - flat * flat);
    const flatRound = (cx, y) => `M ${cx - dx} ${y - flat} L ${cx + dx} ${y - flat} A ${r} ${r} 0 0 1 ${cx + dx} ${y + flat} L ${cx - dx} ${y + flat} A ${r} ${r} 0 0 1 ${cx - dx} ${y - flat} Z`;
    const roundRect = (cx, y, w, h, rr) => `M ${cx - w / 2 + rr} ${y - h / 2} H ${cx + w / 2 - rr} Q ${cx + w / 2} ${y - h / 2} ${cx + w / 2} ${y - h / 2 + rr} V ${y + h / 2 - rr} Q ${cx + w / 2} ${y + h / 2} ${cx + w / 2 - rr} ${y + h / 2} H ${cx - w / 2 + rr} Q ${cx - w / 2} ${y + h / 2} ${cx - w / 2} ${y + h / 2 - rr} V ${y - h / 2 + rr} Q ${cx - w / 2} ${y - h / 2} ${cx - w / 2 + rr} ${y - h / 2} Z`;
    const circle = (cx, y, rad) => `M ${cx - rad} ${y} A ${rad} ${rad} 0 1 0 ${cx + rad} ${y} A ${rad} ${rad} 0 1 0 ${cx - rad} ${y} Z`;
    const screw = (cx, y) => `<circle cx="${cx}" cy="${y}" r="10" fill="${stainless ? '#9ea3a8' : base}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>`
      + `<line x1="${cx - 6}" y1="${y}" x2="${cx + 6}" y2="${y}" stroke="rgba(0,0,0,0.45)" stroke-width="1.8" stroke-linecap="round"/>`;
    let holes = '';
    let screws = '';
    for (let i = 0; i < gang; i++) {
      const cx = W / 2 + (i - (gang - 1) / 2) * GANG_SPACING_IN * 100;
      if (type === 'duplex') {
        holes += `<path d="${flatRound(cx, cy - 75)}"/><path d="${flatRound(cx, cy + 75)}"/>`;
        screws += screw(cx, cy);
      } else if (type === 'rocker') {
        holes += `<path d="${roundRect(cx, cy, 131, 263, 5)}"/>`;
      } else {
        if (type === 'single') holes += `<path d="${circle(cx, cy, 70.3)}"/>`;
        if (type === 'toggle') holes += `<path d="${roundRect(cx, cy, 40.1, 92.5, 4)}"/>`;
        screws += screw(cx, cy - 118.75) + screw(cx, cy + 118.75);
      }
    }

    const text = caps(item.text).trim();
    const label = text
      ? `<text x="${W / 2}" y="${TEXT.baselineIn * 100}" text-anchor="middle" font-family="${TEXT.font}" font-size="${TEXT.sizeIn * 100}" fill="${mark.hex}">${esc(text)}</text>`
      : (o.placeholder ? `<text x="${W / 2}" y="${TEXT.baselineIn * 100}" text-anchor="middle" font-family="${TEXT.font}" font-size="${TEXT.sizeIn * 100}" fill="${mark.hex}" opacity="0.25">${esc(o.placeholder)}</text>` : '');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 ${W + 12} ${H + 12}" class="${esc(o.className || 'outlet-plate-svg')}" role="img" aria-label="${esc(`${GANGS[gang].label} ${TYPES[type].label} ${MATERIALS[material].short}${stainless ? '' : ` ${COLORS[color].label}`} outlet plate${text ? `, marked ${text}` : ''}`)}">
  <defs>
    <linearGradient id="${id}-steel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f1f3f5"/><stop offset="30%" stop-color="#aab0b6"/><stop offset="55%" stop-color="#e3e6e9"/><stop offset="80%" stop-color="#a3a9af"/><stop offset="100%" stop-color="#d2d6da"/>
    </linearGradient>
    <pattern id="${id}-brush" width="8" height="3" patternUnits="userSpaceOnUse">
      <rect width="8" height="3" fill="none"/><line x1="0" y1="1" x2="8" y2="1" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.7"/><line x1="0" y1="2.5" x2="8" y2="2.5" stroke="#5a6066" stroke-opacity="0.12" stroke-width="0.5"/>
    </pattern>
    <linearGradient id="${id}-light" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="${dark ? 0.10 : 0.35}"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="${dark ? 0.25 : 0.10}"/>
    </linearGradient>
    <mask id="${id}-holes"><rect x="-6" y="-6" width="${W + 12}" height="${H + 12}" fill="#fff"/><g fill="#000">${holes}</g></mask>
  </defs>
  <g mask="url(#${id}-holes)">
    <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="${base}" stroke="rgba(0,0,0,${dark ? 0.6 : 0.22})" stroke-width="2"/>
    ${stainless ? `<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="url(#${id}-brush)"/>` : ''}
    <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="url(#${id}-light)"/>
    <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="6" fill="none" stroke="${dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}" stroke-width="2"/>
  </g>
  <g fill="none" stroke="rgba(0,0,0,${dark ? 0.7 : 0.28})" stroke-width="2.5">${holes}</g>
  ${screws}
  ${label}
</svg>`;
  }

  root.OutletPlate = {
    PLATE_H_IN, GANGS, GANG_SPACING_IN, TYPES, MATERIALS, COLORS, MARKS, TEXT,
    typeOf, caps, markFor, widthOf, textRoomIn, textWidthIn, textFits, plateSVG,
  };
})(typeof window !== 'undefined' ? window : globalThis);
