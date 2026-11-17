// outlet-panels.html: build laser-marked outlet plates, list them in an
// order table, and request a quote. Uses the shared plate model/renderer
// (outlet-plate.js) and, from script.js, encodePlmjFile / RFQ_ENDPOINT /
// flagRfqField -- the same quote pipeline as the Round ID Tags page. The
// order goes to the Worker as a .plmj (app: 'outlet-panel-order') that PLM
// Job Viewer opens.
(function () {
  const P = window.OutletPlate;
  if (!P || !document.getElementById('outletPreview')) return;
  const $ = (id) => document.getElementById(id);
  // Plate text is all caps: uppercase it as it's typed (keeping the cursor
  // where it was).
  function forceCaps(input) {
    const upper = input.value.toUpperCase();
    if (upper === input.value) return;
    const { selectionStart, selectionEnd } = input;
    input.value = upper;
    try { input.setSelectionRange(selectionStart, selectionEnd); } catch (e) { /* not focused */ }
  }

  const GANG_OPTIONS = Object.keys(P.GANGS).map((g) => [g, P.GANGS[g].label]);
  const TYPE_OPTIONS = Object.keys(P.TYPES).map((t) => [t, P.TYPES[t].label]);
  const MATERIAL_OPTIONS = Object.keys(P.MATERIALS).map((m) => [m, P.MATERIALS[m].label]);
  const COLOR_OPTIONS = Object.keys(P.COLORS).map((c) => [c, P.COLORS[c].label]);
  // ---- Stock plates only (P.STOCK, Leviton's catalog) ----
  // Each choice is offered only where some stock plate has it, given the
  // choices above it: gangs given the type; size and material given the
  // type and gangs; colors given everything else. Picking something that
  // rules out the rest switches the rest to the closest stock plate.
  const FIXED_FOR = {
    type: [],
    gang: ['type'],
    size: ['type', 'gang'],
    material: ['type', 'gang'],
    color: ['type', 'gang', 'size', 'material'],
  };
  const LOCK_FOR = {
    type: ['type'],
    gang: ['type', 'gang'],
    size: ['type', 'gang', 'size'],
    material: ['type', 'gang', 'material'],
    color: ['type', 'gang', 'size', 'material', 'color'],
  };
  function offered(item, key) {
    return P.stockValues(item, key, FIXED_FOR[key]);
  }
  // "Switched to standard size and white" -- what a choice changed besides
  // itself ('' when nothing).
  function changesNote(before, after, key) {
    const bits = [];
    if (before.gang !== after.gang && key !== 'gang') bits.push(P.GANGS[after.gang].label.toLowerCase());
    if (before.size !== after.size && key !== 'size') bits.push(`${P.SIZES[after.size].label.toLowerCase()} size`);
    if (before.material !== after.material && key !== 'material') bits.push(P.MATERIALS[after.material].short.toLowerCase());
    if (after.material !== 'stainless' && before.color !== after.color && key !== 'color') bits.push(P.COLORS[after.color].label.toLowerCase());
    if (!bits.length) return '';
    const list = bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0];
    return `Switched to ${list} — that's what this plate comes in.`;
  }
  function optionLabel(map, k, ok) {
    return `${map[k].label}${ok ? '' : ' (n/a)'}`;
  }
  function stockOptionsHTML(map, key, item) {
    const ok = offered(item, key);
    return Object.keys(map).map((k) => `<option value="${k}"${String(k) === String(item[key]) ? ' selected' : ''}${ok.has(String(k)) ? '' : ' disabled'}>${optionLabel(map, k, ok.has(String(k)))}</option>`).join('');
  }

  // ---- Builder ----
  const state = { type: 'duplex', gang: 1, size: 'standard', material: 'thermoset', color: 'white', text: '' };
  const stockNote = $('outletStockNote');
  let stockNoteTimer = null;
  // Applies one choice (key = value) and fixes the rest to a stock plate.
  function choose(key, value) {
    const before = { ...state };
    state[key] = value;
    Object.assign(state, P.stockFix(state, LOCK_FOR[key]));
    const note = changesNote(before, state, key);
    clearTimeout(stockNoteTimer);
    stockNote.textContent = note;
    stockNote.hidden = !note;
    if (note) stockNoteTimer = setTimeout(() => { stockNote.hidden = true; }, 5000);
    renderBuilder();
  }
  // Grays out (and disables) the chips no stock plate has.
  function syncStockChips(groupId, attr, key) {
    const ok = offered(state, key);
    $(groupId).querySelectorAll('.chip').forEach((c) => {
      const has = ok.has(String(c.dataset[attr]));
      c.disabled = !has;
      c.classList.toggle('is-unstocked', !has);
      c.title = has ? '' : 'Not made in this plate';
    });
  }
  const preview = $('outletPreview');
  const textInput = $('outletTextInput');
  const fitWarning = $('outletFitWarning');
  const charCount = $('outletCharCount');
  const colorGroup = $('outletColorGroup');
  const markNote = $('outletMarkNote');

  function markSentence(material, color) {
    const mark = P.MARKS[P.markFor(material, color)].label.toLowerCase();
    return material === 'stainless' ? `Stainless steel is marked in ${mark}.` : `Marked in ${mark}.`;
  }
  function setChips(groupId, attr, value) {
    $(groupId).querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c.dataset[attr] === String(value)));
  }
  function renderBuilder() {
    setChips('outletGangChips', 'gang', state.gang);
    setChips('outletSizeChips', 'size', state.size);
    setChips('outletMaterialChips', 'material', state.material);
    setChips('outletColorChips', 'color', state.color);
    syncStockChips('outletGangChips', 'gang', 'gang');
    syncStockChips('outletSizeChips', 'size', 'size');
    syncStockChips('outletMaterialChips', 'material', 'material');
    $('outletSizeNote').textContent = `${P.dimsLabel(state.gang, state.size)}.`;
    const max = P.maxCharsFor(state.gang, state.size);
    textInput.maxLength = max;
    if (textInput.value.length > max) textInput.value = textInput.value.slice(0, max);
    state.text = textInput.value;
    preview.innerHTML = P.plateSVG(state, { placeholder: 'YOUR TEXT', dims: true });
    preview.dataset.gang = state.gang;
    const stainless = state.material === 'stainless';
    // Stainless has no plate color: the color chips stay in place but are
    // grayed out and can't be clicked until another material is picked.
    colorGroup.classList.toggle('is-disabled', stainless);
    if (stainless) {
      colorGroup.querySelectorAll('.chip').forEach((c) => {
        c.disabled = true;
        c.classList.remove('is-unstocked');
        c.title = 'Stainless steel has its own finish — no color choice';
      });
    } else {
      syncStockChips('outletColorChips', 'color', 'color');
    }
    const group = P.TYPES[state.type].group;
    setChips('outletTypeChips', 'group', group);
    setChips('outletReceptacleChips', 'type', state.type);
    $('outletReceptacleGroup').hidden = group !== 'receptacle';
    $('outletBlankNote').hidden = state.type !== 'blank';
    markNote.textContent = markSentence(state.material, state.color);
    charCount.textContent = `— ${state.text.length}/${max}`;
    const fits = P.textFits(state.text.trim(), state.gang, state.size);
    fitWarning.hidden = fits;
    $('outletAddToOrderBtn').disabled = !fits;
  }
  // Plate type: Receptacle remembers whether it was single or duplex.
  let lastReceptacle = 'duplex';
  $('outletTypeChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    choose('type', chip.dataset.group === 'receptacle' ? lastReceptacle : chip.dataset.group);
  });
  $('outletReceptacleChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    lastReceptacle = chip.dataset.type;
    choose('type', chip.dataset.type);
  });
  $('outletGangChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || chip.disabled) return;
    choose('gang', Number(chip.dataset.gang));
  });
  $('outletSizeChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || chip.disabled) return;
    choose('size', chip.dataset.size);
  });
  $('outletMaterialChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || chip.disabled) return;
    choose('material', chip.dataset.material);
  });
  $('outletColorChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || chip.disabled) return;
    choose('color', chip.dataset.color);
  });
  textInput.addEventListener('input', () => { forceCaps(textInput); renderBuilder(); });

  // ---- Order table ----
  const orderBody = $('outletOrderBody');
  function optionsHTML(options, current) {
    return options.map(([v, l]) => `<option value="${v}"${String(v) === String(current) ? ' selected' : ''}>${l}</option>`).join('');
  }
  function rowItem(row) {
    const material = row.querySelector('.outlet-material-select').value;
    return {
      type: row.querySelector('.outlet-type-select').value,
      gang: Number(row.querySelector('.outlet-gang-select').value),
      size: row.querySelector('.outlet-size-select').value,
      material,
      color: material === 'stainless' ? null : row.querySelector('.outlet-color-select').value,
      text: P.caps(row.querySelector('.outlet-text-input').value).trim(),
      qty: Math.max(1, Math.round(Number(row.querySelector('.outlet-qty-input').value) || 1)),
    };
  }
  const ROW_KEYS = { 'outlet-type-select': 'type', 'outlet-gang-select': 'gang', 'outlet-size-select': 'size', 'outlet-material-select': 'material', 'outlet-color-select': 'color' };
  // Keeps a row on a stock plate (changedKey = the select just changed;
  // the others switch to the closest stock plate if they have to) and its
  // color/text fields in step: stainless has no color choice, and the text
  // limit follows the plate.
  function syncRow(row, changedKey) {
    let item = rowItem(row);
    item.color = row.querySelector('.outlet-color-select').value;
    if (changedKey) item = P.stockFix(item, LOCK_FOR[changedKey]);
    else if (!P.isStock(item)) item = P.stockFix(item, ['type']);
    row.querySelector('.outlet-type-select').value = item.type;
    row.querySelector('.outlet-gang-select').innerHTML = stockOptionsHTML(P.GANGS, 'gang', item);
    row.querySelector('.outlet-size-select').innerHTML = stockOptionsHTML(P.SIZES, 'size', item);
    row.querySelector('.outlet-material-select').innerHTML = stockOptionsHTML(P.MATERIALS, 'material', item);
    row.querySelector('.outlet-color-select').innerHTML = stockOptionsHTML(P.COLORS, 'color', item);
    const sizeSelect = row.querySelector('.outlet-size-select');
    sizeSelect.title = P.dimsLabel(item.gang, item.size);
    if (item.material === 'stainless') item.color = null;
    const colorSelect = row.querySelector('.outlet-color-select');
    const stainless = item.material === 'stainless';
    colorSelect.disabled = stainless;
    colorSelect.classList.toggle('is-na', stainless);
    row.querySelector('.outlet-color-na').hidden = !stainless;
    colorSelect.hidden = stainless;
    const text = row.querySelector('.outlet-text-input');
    text.maxLength = P.maxCharsFor(item.gang, item.size);
    if (text.value.length > text.maxLength) text.value = text.value.slice(0, text.maxLength);
    const fits = P.textFits(text.value.trim(), item.gang, item.size);
    text.classList.toggle('is-too-long', !fits);
    text.title = fits ? '' : 'Too long for this plate';
    row.querySelector('.outlet-mark-cell').textContent = `${P.MARKS[P.markFor(item.material, item.color || 'white')].label} mark`;
  }
  function renumber() {
    [...orderBody.querySelectorAll('.tag-order-row')].forEach((row, i) => { row.querySelector('.tag-order-num').textContent = i + 1; });
  }
  function addRow(initial) {
    const it = { type: 'duplex', gang: 1, size: 'standard', material: 'thermoset', color: 'white', text: '', qty: 1, ...(initial || {}) };
    const row = document.createElement('tr');
    row.className = 'tag-order-row';
    row.innerHTML = `
      <td class="tag-order-num"></td>
      <td><select class="outlet-gang-select">${optionsHTML(GANG_OPTIONS, it.gang)}</select></td>
      <td><select class="outlet-size-select">${optionsHTML(Object.keys(P.SIZES).map((k) => [k, P.SIZES[k].label]), it.size)}</select></td>
      <td><select class="outlet-type-select">${optionsHTML(TYPE_OPTIONS, it.type)}</select></td>
      <td><select class="outlet-material-select">${optionsHTML(MATERIAL_OPTIONS, it.material)}</select></td>
      <td>
        <select class="outlet-color-select">${optionsHTML(COLOR_OPTIONS, it.color || 'white')}</select>
        <span class="outlet-color-na" hidden>Stainless</span>
        <div class="outlet-mark-cell"></div>
      </td>
      <td class="tag-order-text-cell"><div class="tag-order-text-row"><input type="text" class="outlet-text-input" placeholder="Text" /></div></td>
      <td><input type="number" class="outlet-qty-input" min="1" step="1" value="${it.qty}" inputmode="numeric" /></td>
      <td><div class="tag-order-actions">
        <button type="button" class="tag-order-view" aria-label="View this plate in the builder above">View</button>
        <button type="button" class="tag-order-remove" aria-label="Remove this plate">✕</button>
      </div></td>`;
    row.querySelector('.outlet-text-input').value = P.caps(it.text);
    orderBody.appendChild(row);
    syncRow(row);
    renumber();
    return row;
  }
  orderBody.addEventListener('input', (e) => {
    const row = e.target.closest('.tag-order-row');
    if (!row) return;
    if (e.target.matches('.outlet-text-input')) forceCaps(e.target);
    syncRow(row);
  });
  orderBody.addEventListener('change', (e) => {
    const row = e.target.closest('.tag-order-row');
    if (!row) return;
    if (e.target.matches('.outlet-qty-input')) e.target.value = rowItem(row).qty;
    syncRow(row, ROW_KEYS[[...e.target.classList].find((c) => ROW_KEYS[c])]);
  });
  orderBody.addEventListener('click', (e) => {
    const row = e.target.closest('.tag-order-row');
    if (!row) return;
    if (e.target.closest('.tag-order-remove')) {
      if (orderBody.querySelectorAll('.tag-order-row').length <= 1) return;
      row.remove();
      renumber();
    } else if (e.target.closest('.tag-order-view')) {
      // Loads this row (always a stock plate) into the builder above.
      const item = rowItem(row);
      if (P.TYPES[item.type].group === 'receptacle') lastReceptacle = item.type;
      Object.assign(state, { type: item.type, gang: item.gang, size: item.size, material: item.material });
      if (item.color) state.color = item.color;
      textInput.value = item.text;
      renderBuilder();
      const top = document.querySelector('.outlet-configurator').getBoundingClientRect().top + window.scrollY - 160;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
  $('outletOrderAddRow').addEventListener('click', () => addRow());

  // "Add to Order List": the builder's plate into the table (taking over
  // an untouched blank row instead of adding another).
  const addBtn = $('outletAddToOrderBtn');
  const addLabel = addBtn.textContent;
  let addTimer = null;
  addBtn.addEventListener('click', () => {
    const item = { type: state.type, gang: state.gang, size: state.size, material: state.material, color: state.material === 'stainless' ? null : state.color, text: state.text.trim(), qty: 1 };
    const blank = [...orderBody.querySelectorAll('.tag-order-row')].find((r) => !r.querySelector('.outlet-text-input').value.trim());
    if (blank) {
      blank.querySelector('.outlet-type-select').value = item.type;
      blank.querySelector('.outlet-gang-select').value = item.gang;
      blank.querySelector('.outlet-size-select').value = item.size;
      blank.querySelector('.outlet-material-select').value = item.material;
      if (item.color) blank.querySelector('.outlet-color-select').value = item.color;
      blank.querySelector('.outlet-text-input').value = item.text;
      syncRow(blank);
    } else {
      addRow(item);
    }
    clearTimeout(addTimer);
    addBtn.classList.add('is-added');
    addBtn.textContent = 'Added ✓';
    addBtn.disabled = true;
    addTimer = setTimeout(() => {
      addBtn.classList.remove('is-added');
      addBtn.textContent = addLabel;
      renderBuilder();
    }, 1800);
  });

  function collectItems() {
    return [...orderBody.querySelectorAll('.tag-order-row')].map((row) => {
      const item = rowItem(row);
      return { ...item, widthIn: P.widthOf(item.gang, item.size), heightIn: P.heightOf(item.gang, item.size), markColor: P.markFor(item.material, item.color) };
    });
  }
  function describe(item) {
    const parts = [`${P.GANGS[item.gang].label} ${P.SIZES[item.size].label} (${P.dimsLabel(item.gang, item.size)})`, P.TYPES[item.type].label, P.MATERIALS[item.material].short];
    if (item.material !== 'stainless') parts.push(P.COLORS[item.color].label);
    return `${parts.join(' · ')} (${P.MARKS[item.markColor].label.toLowerCase()} mark)`;
  }

  // ---- Request a quote ----
  const modal = $('outlet-rfq-modal');
  const successModal = $('outlet-rfq-success-modal');
  const form = $('outletRfqForm');
  const statusEl = $('outletRfqStatus');
  function renderSummary() {
    const groups = new Map();
    let total = 0;
    collectItems().forEach((item) => {
      const key = describe(item);
      groups.set(key, (groups.get(key) || 0) + item.qty);
      total += item.qty;
    });
    $('outletRfqSummaryList').innerHTML = [...groups].map(([label, n]) => `
      <div class="tag-rfq-summary-row"><span class="tag-rfq-summary-count">${n}</span><span class="tag-rfq-summary-dash">-</span><span>${label}</span></div>`).join('')
      + `<div class="tag-rfq-summary-row outlet-rfq-total"><span class="tag-rfq-summary-count">${total}</span><span class="tag-rfq-summary-dash">-</span><span>plate${total === 1 ? '' : 's'} total</span></div>`;
  }
  function openModal() {
    const tooLong = collectItems().some((it) => !P.textFits(it.text, it.gang, it.size));
    if (tooLong) {
      const bad = orderBody.querySelector('.outlet-text-input.is-too-long');
      if (bad) { bad.focus(); bad.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return;
    }
    renderSummary();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }
  function openSuccess() {
    closeModal();
    setTimeout(() => {
      const check = successModal.querySelector('.editor-rfq-success-check');
      if (check) { const parent = check.parentNode; const next = check.nextSibling; parent.removeChild(check); void check.offsetWidth; parent.insertBefore(check, next); }
      successModal.classList.add('is-open');
      successModal.setAttribute('aria-hidden', 'false');
    }, 300);
  }
  function closeSuccess() {
    successModal.classList.remove('is-open');
    successModal.setAttribute('aria-hidden', 'true');
  }
  $('outletQuoteBtn').addEventListener('click', openModal);
  $('outlet-rfq-modal-close').addEventListener('click', closeModal);
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
  successModal.addEventListener('mousedown', (e) => { if (e.target === successModal) closeSuccess(); });
  $('outlet-rfq-success-close-btn').addEventListener('click', closeSuccess);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modal.classList.contains('is-open')) closeModal();
    if (successModal.classList.contains('is-open')) closeSuccess();
  });

  function buildPayload() {
    const fd = new FormData(form);
    return {
      app: 'outlet-panel-order',
      kind: 'plmj',
      version: 1,
      createdAt: new Date().toISOString(),
      specs: { textSizeIn: P.TEXT.sizeIn, placement: 'top center' },
      order: {
        // name, company, email, phone, pickup, shipping + billing address
        // (rfq-contact.js)
        ...window.RfqContact.read(fd),
        discountCode: String(fd.get('discount') || '').trim(),
        message: fd.get('message') || '',
      },
      items: collectItems(),
    };
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const submitLabel = submitBtn.innerHTML;
    statusEl.textContent = '';
    statusEl.className = 'form-status';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    try {
      const payload = buildPayload();
      const fd = new FormData(form);
      const total = payload.items.reduce((n, it) => n + it.qty, 0);
      const lines = payload.items.map((it, i) => `${i + 1}. ${it.qty} x ${describe(it)} — ${it.text || '(no text)'}`);
      const userMessage = String(fd.get('message') || '').trim();
      fd.set('message', [
        `${total} outlet plate${total === 1 ? '' : 's'} requested:`,
        ...lines,
        ...window.RfqContact.lines(payload.order),
      ].join('\n') + (userMessage ? `\n\n${userMessage}` : ''));
      const bytes = await encodePlmjFile(payload);
      const base = (payload.order.name || 'outlet-panels').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'outlet-panels';
      fd.append('attachment', new Blob([bytes], { type: 'application/octet-stream' }), `${base}-outlet-panels.plmj`);
      const res = await fetch(RFQ_ENDPOINT, { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok && data.success) {
        form.reset();
        openSuccess();
      } else {
        statusEl.textContent = data.message || 'Something went wrong — please try again.';
        statusEl.className = 'form-status error';
        if (typeof flagRfqField === 'function') flagRfqField(form, data);
      }
    } catch (err) {
      statusEl.textContent = 'Network error — please try again.';
      statusEl.className = 'form-status error';
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitLabel;
    }
  });

  renderBuilder();
  addRow();
})();
