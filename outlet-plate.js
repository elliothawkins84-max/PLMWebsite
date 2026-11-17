// Laser-marked electrical outlet panels: the shared plate model + SVG
// renderer. The exact same file is used by the website's builder
// (outlet-panels.html) and by PLM Job Viewer (renderer/outlet-plate.js), so
// a plate looks identical in both. Standard (4.50in tall) or midsize
// (4.88in tall) wall plates, 1 to 4 gang (midsize 1 to 3); every gang of a
// plate gets the same opening (see TYPES).
(function (root) {
  const PLATE_H_IN = 4.5; // standard height (see SIZES for midsize)
  const GANGS = {
    1: { label: '1-Gang' },
    2: { label: '2-Gang' },
    3: { label: '3-Gang' },
    4: { label: '4-Gang' },
  };
  // Gangs sit 1.8125in apart on every size.
  const GANG_SPACING_IN = 1.8125;
  // Plate sizes: outside dimensions (in) by gang count, with the character
  // limit for the text line (Leviton: Midway is 0.375in taller and wider;
  // +1.81in per gang). Which plates are actually offered in each size is
  // STOCK's job, below.
  const SIZES = {
    standard: { label: 'Standard', heightIn: 4.5, widthIn: { 1: 2.75, 2: 4.56, 3: 6.37, 4: 8.19 }, maxChars: { 1: 14, 2: 24, 3: 36, 4: 46 } },
    midsize: { label: 'Midsize', heightIn: 4.88, widthIn: { 1: 3.13, 2: 4.94, 3: 6.75, 4: 8.56 }, maxChars: { 1: 16, 2: 27, 3: 38, 4: 48 } },
  };
  // The size a plate actually is: midsize only where that gang count comes
  // in midsize, otherwise (and for older orders with no size) standard.
  function sizeFor(gang, size) {
    return SIZES[size] && SIZES[size].widthIn[gang] ? size : 'standard';
  }
  function hasSize(gang, size) {
    return !!(SIZES[size] && SIZES[size].widthIn[gang]);
  }

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
    // Leviton's "Light Almond" (kept under the key 'tan' so older orders
    // still read).
    tan: { label: 'Light Almond', hex: '#e2d5bb' },
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
    // Standard-size character limits by gang (see SIZES / maxCharsFor).
    maxChars: SIZES.standard.maxChars,
  };

  function gangOf(gang) {
    return GANGS[gang] ? Number(gang) : 1;
  }
  function widthOf(gang, size) {
    const g = gangOf(gang);
    return SIZES[sizeFor(g, size)].widthIn[g];
  }
  function heightOf(gang, size) {
    return SIZES[sizeFor(gangOf(gang), size)].heightIn;
  }
  function maxCharsFor(gang, size) {
    const g = gangOf(gang);
    return SIZES[sizeFor(g, size)].maxChars[g];
  }
  // '4.56in W x 4.50in H'
  function dimsLabel(gang, size) {
    return `${widthOf(gang, size).toFixed(2)}in W × ${heightOf(gang, size).toFixed(2)}in H`;
  }
  // Width available for the text line, in inches.
  function textRoomIn(gang, size) {
    return widthOf(gang, size) - TEXT.sideMarginIn * 2;
  }

  let measureCtx = null;
  // How wide `text` prints, in inches (null where there's no canvas).
  // ---- Stock plates ----
  // Only plates Leviton catalogs (Wallplates catalog, section E: Leviton
  // catalog numbers exist for each) are offered, so every plate on an order
  // is one we can simply buy. type -> material -> size -> gang -> the
  // colors it comes in (W white, T light almond, G gray, B black);
  // stainless steel is a single finish (true). Leviton makes no Midway
  // stainless plate.
  const STOCK = {
    toggle: {
      thermoset: { standard: { 1: 'WTG', 2: 'WTG', 3: 'WTG', 4: 'WTG' }, midsize: { 1: 'WT', 2: 'WT', 3: 'WT', 4: 'WT' } },
      nylon: { standard: { 1: 'WTGB', 2: 'WTGB', 3: 'WTGB', 4: 'WTB' }, midsize: { 1: 'WTGB', 2: 'WTGB', 3: 'WTB', 4: 'WT' } },
      stainless: { standard: { 1: true, 2: true, 3: true, 4: true } },
    },
    duplex: {
      thermoset: { standard: { 1: 'WTG', 2: 'WTG', 3: 'W', 4: 'W' }, midsize: { 1: 'WT', 2: 'WT' } },
      nylon: { standard: { 1: 'WTGB', 2: 'WTGB', 3: 'WG' }, midsize: { 1: 'WTGB', 2: 'WTGB' } },
      stainless: { standard: { 1: true, 2: true, 3: true, 4: true } },
    },
    rocker: {
      thermoset: { standard: { 1: 'WTGB', 2: 'WTGB', 3: 'WTGB', 4: 'WTGB' }, midsize: { 1: 'WT', 2: 'WT', 3: 'WT', 4: 'WT' } },
      nylon: { standard: { 1: 'WTGB', 2: 'WTGB', 3: 'WTGB', 4: 'WT' }, midsize: { 1: 'WTGB', 2: 'WTGB', 3: 'WTG', 4: 'WTG' } },
      stainless: { standard: { 1: true, 2: true, 3: true, 4: true } },
    },
    blank: {
      thermoset: { standard: { 1: 'WTG', 2: 'WTG', 3: 'W', 4: 'W' }, midsize: { 1: 'WT', 2: 'WT', 3: 'W' } },
      nylon: { standard: { 1: 'WTGB', 2: 'WTGB', 3: 'WGB' }, midsize: { 1: 'WTGB', 2: 'WTG' } },
      stainless: { standard: { 1: true, 2: true, 3: true, 4: true } },
    },
    single: {
      thermoset: { standard: { 1: 'WT', 2: 'W' }, midsize: { 1: 'WT' } },
      nylon: { standard: { 1: 'WTGB' }, midsize: { 1: 'WT' } },
      stainless: { standard: { 1: true, 2: true } },
    },
  };
  const COLOR_CODE = { white: 'W', tan: 'T', gray: 'G', black: 'B' };
  // The order choices are made in, most important first.
  const STOCK_KEYS = ['type', 'gang', 'size', 'material', 'color'];
  // Every stock plate, as { type, gang, size, material, color } (color null
  // for stainless).
  const STOCK_LIST = [];
  Object.keys(STOCK).forEach((type) => Object.keys(STOCK[type]).forEach((material) => {
    Object.keys(STOCK[type][material]).forEach((size) => Object.keys(STOCK[type][material][size]).forEach((g) => {
      const colors = STOCK[type][material][size][g];
      const gang = Number(g);
      if (colors === true) STOCK_LIST.push({ type, gang, size, material, color: null });
      else Object.keys(COLOR_CODE).forEach((color) => { if (colors.includes(COLOR_CODE[color])) STOCK_LIST.push({ type, gang, size, material, color }); });
    }));
  }));
  // An item's value for a stock key, as STOCK_LIST has it (older orders
  // carry no type or size: duplex, standard).
  function stockValue(it, k) {
    if (k === 'type') return typeOf(it);
    if (k === 'gang') return GANGS[it.gang] ? Number(it.gang) : 1;
    if (k === 'size') return SIZES[it.size] ? it.size : 'standard';
    if (k === 'material') return MATERIALS[it.material] ? it.material : 'thermoset';
    return it[k];
  }
  const same = (c, it, k) => (k === 'color' && c.material === 'stainless') || String(c[k]) === String(stockValue(it, k));
  function isStock(it) {
    return STOCK_LIST.some((c) => STOCK_KEYS.every((k) => same(c, it, k)));
  }
  // The values of `key` that a stock plate has, with the `fixed` keys kept
  // as they are in `it` (e.g. which sizes come in this type and gang count).
  function stockValues(it, key, fixed) {
    const out = new Set();
    STOCK_LIST.forEach((c) => { if (fixed.every((k) => same(c, it, k))) out.add(String(c[key])); });
    return out;
  }
  // The stock plate closest to `it` that keeps the `locked` keys as they
  // are -- keeping as many of the other choices as it can, the more
  // important ones (STOCK_KEYS order) first. Returns `it` with its type,
  // gang, size, material and color set to that plate's (a stainless plate
  // keeps the color it had, for switching back).
  function stockFix(it, locked) {
    let best = null;
    let bestScore = -1;
    STOCK_LIST.forEach((c) => {
      if (!locked.every((k) => same(c, it, k))) return;
      let score = 0;
      STOCK_KEYS.forEach((k, i) => { if (same(c, it, k)) score += 1 << (STOCK_KEYS.length - i); });
      if (score > bestScore) { best = c; bestScore = score; }
    });
    // Nothing keeps every locked choice: let go of the least important.
    if (!best) return locked.length > 1 ? stockFix(it, locked.slice(0, -1)) : { ...it };
    return { ...it, type: best.type, gang: best.gang, size: best.size, material: best.material, color: best.color || it.color };
  }

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
  function textFits(text, gang, size) {
    const w = textWidthIn(caps(text));
    return w == null || w <= textRoomIn(gang, size);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // With opts.dims, dimension lines (|---- 4.56in ----|) are drawn below
  // and to the left of the plate (its size), and on the right the
  // center-to-center spacing of its holes, each in this much extra room
  // (hundredths of an inch).
  const DIM_ROOM = 80;
  // Half the center-to-center spacing of a plate type's holes (hundredths
  // of an inch), measured on the right. From Leviton's dimensional
  // drawings (80703 / PJ8 duplex, 80701 / PJ1 toggle): a duplex's two
  // outlets are 1.53in apart; toggle (and single receptacle) plates screw to
  // the device 2.375in apart; a blank plate screws to the box itself, whose
  // holes are 3-9/32in (3.28in) apart; a rocker/Decora plate (PJ26 /
  // 80401) has screws 3.81in apart, above and below its opening.
  function holeHalfSpacing(type) {
    if (type === 'duplex') return 76.5;
    if (type === 'rocker') return 190.5;
    if (type === 'blank') return 164.0625;
    return 118.75;
  }
  // The SVG's full size in viewBox units, for callers sizing an image of it.
  function svgBox(item, opts) {
    const dims = !!(opts && opts.dims);
    const extra = dims ? DIM_ROOM : 0;
    const right = dims && holeHalfSpacing(typeOf(item)) != null ? DIM_ROOM : 0;
    return { w: widthOf(item.gang, item.size) * 100 + 12 + extra + right, h: heightOf(item.gang, item.size) * 100 + 12 + extra };
  }
  // A solid dimension line from (x1,y1) to (x2,y2) (horizontal or
  // vertical), end bars at both ends and the label in a gap at the middle.
  function dimLine(x1, y1, x2, y2, label, color) {
    const vertical = x1 === x2;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const fs = 24;
    const half = label.length * fs * 0.29 + 10;
    const bar = 14;
    const stroke = `stroke="${color}" stroke-width="2"`;
    let out = '';
    if (vertical) {
      out += `<line x1="${x1}" y1="${y1}" x2="${x1}" y2="${my - half}" ${stroke}/><line x1="${x1}" y1="${my + half}" x2="${x1}" y2="${y2}" ${stroke}/>`;
      out += `<line x1="${x1 - bar}" y1="${y1}" x2="${x1 + bar}" y2="${y1}" ${stroke}/><line x1="${x1 - bar}" y1="${y2}" x2="${x1 + bar}" y2="${y2}" ${stroke}/>`;
      out += `<text x="${mx}" y="${my}" transform="rotate(-90 ${mx} ${my})" text-anchor="middle" dominant-baseline="central" font-family="${TEXT.font}" font-size="${fs}" fill="${color}">${esc(label)}</text>`;
    } else {
      out += `<line x1="${x1}" y1="${y1}" x2="${mx - half}" y2="${y1}" ${stroke}/><line x1="${mx + half}" y1="${y1}" x2="${x2}" y2="${y1}" ${stroke}/>`;
      out += `<line x1="${x1}" y1="${y1 - bar}" x2="${x1}" y2="${y1 + bar}" ${stroke}/><line x1="${x2}" y1="${y1 - bar}" x2="${x2}" y2="${y1 + bar}" ${stroke}/>`;
      out += `<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="central" font-family="${TEXT.font}" font-size="${fs}" fill="${color}">${esc(label)}</text>`;
    }
    return out;
  }

  let uidCounter = 0;
  // An SVG string of one plate. item: { gang, size, type, material, color,
  // text }. Drawn in hundredths of an inch (viewBox width = plate width x
  // 100). opts: { placeholder, className, dims, dimColor }.
  function plateSVG(item, opts) {
    const o = opts || {};
    const gang = gangOf(item.gang);
    const size = sizeFor(gang, item.size);
    const material = MATERIALS[item.material] ? item.material : 'thermoset';
    const stainless = material === 'stainless';
    const color = COLORS[item.color] ? item.color : 'white';
    const mark = MARKS[markFor(material, color)];
    const W = widthOf(gang, size) * 100;
    const H = heightOf(gang, size) * 100;
    const type = typeOf(item);
    const id = `op${(uidCounter += 1)}`;
    const dark = !stainless && color === 'black';
    const base = stainless ? `url(#${id}-steel)` : COLORS[color].hex;

    // Openings (and screws) for one gang, centered at cx, in hundredths of
    // an inch (Leviton's drawings): duplex 1.35in x 1.13in (round with flats
    // top and bottom) 1.53in apart with a center screw; single receptacle a
    // 1.406in round; toggle a 0.406in x 0.942in slot; rocker/decorative a
    // 1.310in x 2.630in opening; blank none.
    // Screws above and below as holeHalfSpacing says.
    const cy = H / 2;
    const r = 67.5;
    const flat = 56.5;
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
        holes += `<path d="${flatRound(cx, cy - 76.5)}"/><path d="${flatRound(cx, cy + 76.5)}"/>`;
        screws += screw(cx, cy);
      } else {
        if (type === 'rocker') holes += `<path d="${roundRect(cx, cy, 131, 263, 5)}"/>`;
        if (type === 'single') holes += `<path d="${circle(cx, cy, 70.3)}"/>`;
        if (type === 'toggle') holes += `<path d="${roundRect(cx, cy, 40.6, 94.2, 4)}"/>`;
        const sh = holeHalfSpacing(type);
        screws += screw(cx, cy - sh) + screw(cx, cy + sh);
      }
    }

    // The text keeps the same spacing above the openings on a taller plate.
    // A blank plate's box screws sit higher than the text line would, so
    // there it goes just below the top screw instead.
    const baseline = type === 'blank'
      ? cy - holeHalfSpacing('blank') + 50
      : (TEXT.baselineIn + (H / 100 - PLATE_H_IN) / 2) * 100;
    const text = caps(item.text).trim();
    const label = text
      ? `<text x="${W / 2}" y="${baseline}" text-anchor="middle" font-family="${TEXT.font}" font-size="${TEXT.sizeIn * 100}" fill="${mark.hex}">${esc(text)}</text>`
      : (o.placeholder ? `<text x="${W / 2}" y="${baseline}" text-anchor="middle" font-family="${TEXT.font}" font-size="${TEXT.sizeIn * 100}" fill="${mark.hex}" opacity="0.25">${esc(o.placeholder)}</text>` : '');

    const room = o.dims ? DIM_ROOM : 0;
    const dimColor = o.dimColor || 'currentColor';
    let dims = o.dims
      ? dimLine(-room + 22, 0, -room + 22, H, `${(H / 100).toFixed(2)} in`, dimColor)
        + dimLine(0, H + room - 22, W, H + room - 22, `${(W / 100).toFixed(2)} in`, dimColor)
      : '';
    // Hole spacing on the right, with dashed guide lines from the
    // right-most gang's hole centers out to it.
    const half = o.dims ? holeHalfSpacing(type) : null;
    const rightRoom = half != null ? DIM_ROOM : 0;
    if (half != null) {
      const x = W + rightRoom - 22;
      const cxLast = W / 2 + ((gang - 1) / 2) * GANG_SPACING_IN * 100;
      const guide = (y) => `<line x1="${cxLast}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="${dimColor}" stroke-width="1.5" stroke-dasharray="6 5" opacity="0.7"/>`;
      dims += guide(cy - half) + guide(cy + half)
        + dimLine(x, cy - half, x, cy + half, `${((half * 2) / 100).toFixed(2)} in`, dimColor);
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-6 - room} -6 ${W + 12 + room + rightRoom} ${H + 12 + room}" class="${esc(o.className || 'outlet-plate-svg')}" role="img" aria-label="${esc(`${GANGS[gang].label} ${SIZES[size].label} ${TYPES[type].label} ${MATERIALS[material].short}${stainless ? '' : ` ${COLORS[color].label}`} outlet plate, ${dimsLabel(gang, size)}${half != null ? `, holes ${((half * 2) / 100).toFixed(2)}in apart` : ''}${text ? `, marked ${text}` : ''}`)}">
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
  ${dims}
</svg>`;
  }

  root.OutletPlate = {
    PLATE_H_IN, GANGS, GANG_SPACING_IN, SIZES, TYPES, MATERIALS, COLORS, MARKS, TEXT,
    STOCK, STOCK_KEYS, isStock, stockValues, stockFix,
    typeOf, caps, markFor, sizeFor, hasSize, widthOf, heightOf, maxCharsFor, dimsLabel,
    textRoomIn, textWidthIn, textFits, svgBox, plateSVG,
  };
})(typeof window !== 'undefined' ? window : globalThis);
